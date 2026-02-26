import re
import unicodedata
from typing import Any, Dict, List, Optional

from backend.models import ProcessCase


def _normalize_text(value: Optional[str]) -> str:
    raw = (value or "").strip().lower()
    decomposed = unicodedata.normalize("NFD", raw)
    return "".join(char for char in decomposed if unicodedata.category(char) != "Mn")


def _normalize_score_100(value: Optional[float]) -> float:
    if value is None:
        return 0.0
    score = float(value)
    if 0.0 <= score <= 1.0:
        score *= 100.0
    return max(0.0, min(100.0, score))


def _build_case_context(case: ProcessCase) -> str:
    extracted = case.extracted_fields if isinstance(case.extracted_fields, dict) else {}
    key_facts = extracted.get("key_facts")
    key_facts_text = " ".join(str(item) for item in key_facts) if isinstance(key_facts, list) else ""
    text_parts = [
        str(case.status or ""),
        str(case.ai_summary or ""),
        str(extracted.get("status") or ""),
        str(extracted.get("title") or ""),
        key_facts_text,
    ]
    return _normalize_text(" | ".join(text_parts))


def _detect_transit_judged(case: ProcessCase, normalized_context: str) -> bool:
    status = _normalize_text(case.status)
    patterns = [
        r"\btransitad[oa]\s+em\s+julgado\b",
        r"\btransito\s+em\s+julgado\b",
        r"\bcoisa\s+julgada\b",
        r"\bdecisao\s+transitada\b",
    ]
    if any(re.search(pattern, status) for pattern in patterns):
        return True
    return any(re.search(pattern, normalized_context) for pattern in patterns)


def _detect_grounds(normalized_context: str) -> List[str]:
    catalog = [
        (r"\berro\s+de\s+fato\b", "Erro de fato"),
        (r"\bviolacao\s+manifesta\b|\bviolacao\s+literal\b", "Violacao manifesta de norma juridica"),
        (r"\bprova\s+nova\b|\bdocumento\s+novo\b", "Prova nova"),
        (r"\bfraude\b|\bdolo\b", "Fraude ou dolo processual"),
        (r"\bincompetencia\b", "Incompetencia absoluta"),
        (r"\bimpediment[oa]\b|\bsuspeica[oã]o\b", "Impedimento ou suspeicao"),
        (r"\binconstitucionalidade\b", "Inconstitucionalidade superveniente"),
    ]
    grounds: List[str] = []
    for pattern, label in catalog:
        if re.search(pattern, normalized_context):
            grounds.append(label)
    return grounds


def _value_band_points(claim_value: Optional[float]) -> int:
    if claim_value is None:
        return 0
    if claim_value <= 50000:
        return 3
    if claim_value <= 200000:
        return 6
    return 10


def _data_quality_points(case: ProcessCase) -> int:
    extracted = case.extracted_fields if isinstance(case.extracted_fields, dict) else {}
    populated = 0
    if case.tribunal:
        populated += 1
    if case.judge:
        populated += 1
    if case.action_type:
        populated += 1
    if case.claim_value is not None:
        populated += 1
    if case.status:
        populated += 1
    if case.ai_summary:
        populated += 1
    if isinstance(extracted.get("key_facts"), list) and extracted.get("key_facts"):
        populated += 1

    # Up to 10 points.
    return min(10, int(round((populated / 7.0) * 10)))


def _financial_projection(claim_value: Optional[float], viability_score: int) -> Dict[str, float]:
    if claim_value is None or claim_value <= 0:
        return {
            "estimated_cost_brl": 0.0,
            "projected_upside_brl": 0.0,
            "projected_net_brl": 0.0,
        }

    estimated_cost = max(7000.0, float(claim_value) * 0.035)
    projected_upside = float(claim_value) * (float(viability_score) / 100.0) * 0.55
    projected_net = projected_upside - estimated_cost
    return {
        "estimated_cost_brl": round(estimated_cost, 2),
        "projected_upside_brl": round(projected_upside, 2),
        "projected_net_brl": round(projected_net, 2),
    }


def evaluate_case_rescisoria(case: ProcessCase) -> Dict[str, Any]:
    context = _build_case_context(case)
    transit_judged_detected = _detect_transit_judged(case, context)
    grounds_detected = _detect_grounds(context)
    risk_score = _normalize_score_100(case.risk_score)

    score = 0.0
    if transit_judged_detected:
        score += 35.0
    score += min(25.0, len(grounds_detected) * 8.0)
    score += round((100.0 - risk_score) * 0.2, 2)
    score += float(_value_band_points(case.claim_value))
    score += float(_data_quality_points(case))
    viability_score = max(0, min(100, int(round(score))))

    if viability_score >= 70 and transit_judged_detected:
        eligibility_status = "eligible"
    elif viability_score >= 50:
        eligibility_status = "uncertain"
    else:
        eligibility_status = "ineligible"

    if viability_score >= 70:
        recommendation = "recommend_filing"
        reason = "Potencial rescisorio alto detectado com viabilidade financeira positiva."
    elif viability_score >= 50:
        recommendation = "monitor"
        reason = "Existem indicios rescisorios, mas e recomendado aprofundar validacao juridica."
    else:
        recommendation = "do_not_recommend"
        reason = "Baixa relacao risco-retorno para acao rescisoria no recorte atual."

    return {
        "eligibility_status": eligibility_status,
        "viability_score": viability_score,
        "recommendation": recommendation,
        "grounds_detected": grounds_detected,
        "financial_projection": _financial_projection(case.claim_value, viability_score),
        "transit_judged_detected": bool(transit_judged_detected),
        "reason": reason,
    }


def parse_rescisoria_snapshot(raw_value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw_value, dict):
        return None
    viability = raw_value.get("viability_score")
    if not isinstance(viability, (int, float)):
        return None
    return raw_value
