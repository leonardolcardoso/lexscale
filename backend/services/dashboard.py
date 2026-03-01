import json
import logging
import os
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
from uuid import UUID

from openai import OpenAI
from sqlalchemy.orm import Session

from backend.models import CaseDeadline, ProcessCase, PublicCaseRecord
from backend.services.openai_usage import record_openai_usage
from backend.schemas.dashboard import (
    AcoesRescisoriasData,
    AlertCountData,
    AlertasData,
    BenchmarkData,
    CaseContextData,
    CriticalDeadline,
    DashboardData,
    DashboardFiltersData,
    DetailedAlertData,
    HeatmapRowData,
    ImpactMetricData,
    InsightItem,
    InteligenciaData,
    MetricCardData,
    RadarPoint,
    RescisoriaCandidateData,
    RescisoriaFinancialProjectionData,
    RescisoriaKPIData,
    ScenarioData,
    ScenarioItemData,
    ScoreCardData,
    SimilarProcessData,
    SimulacaoData,
    VisaoGeralData,
    WeeklyActivityPoint,
)
from backend.services.rescisory import evaluate_case_rescisoria, parse_rescisoria_snapshot

logger = logging.getLogger("backend.services.dashboard")

BENCHMARK_MIN_USER_OBSERVATIONS = 10
BENCHMARK_MIN_MARKET_OBSERVATIONS = 30


def _is_all_filter(value: str, defaults: Sequence[str]) -> bool:
    normalized = _normalize_text(value)
    return normalized in {_normalize_text(item) for item in defaults}


def _normalize_text(value: str) -> str:
    raw = (value or "").strip().lower()
    decomposed = unicodedata.normalize("NFD", raw)
    return "".join(char for char in decomposed if unicodedata.category(char) != "Mn")


def _parse_period_cutoff(periodo: str) -> Optional[datetime]:
    if _is_all_filter(periodo, ["", "todos", "all"]):
        return None
    raw = _normalize_text(periodo)
    if "12" in raw:
        return datetime.now(timezone.utc) - timedelta(days=365)
    if "6" in raw:
        return datetime.now(timezone.utc) - timedelta(days=180)
    if "3" in raw:
        return datetime.now(timezone.utc) - timedelta(days=90)
    return datetime.now(timezone.utc) - timedelta(days=180)


def _parse_value_range(faixa_valor: str) -> Tuple[Optional[float], Optional[float]]:
    raw = _normalize_text(faixa_valor)
    if _is_all_filter(raw, ["todos os valores", "todos", "all"]):
        return None, None
    if raw in {"0-100k", "0-100000", "ate 100k"}:
        return 0, 100000
    if raw in {"100k-500k", "100000-500000"}:
        return 100000, 500000
    if raw in {">500k", "acima de 500k"}:
        return 500000, None

    parts = raw.replace("k", "000").split("-")
    if len(parts) == 2:
        try:
            return float(parts[0]), float(parts[1])
        except ValueError:
            return None, None
    return None, None


def _normalize_probability(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return _clamp(float(value), 0.0, 1.0)


def _normalize_score_100(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    score = float(value)
    # Defensive normalization: some AI responses may come as 0-1.
    if 0 <= score <= 1:
        score *= 100
    return _clamp(score, 0.0, 100.0)


def _filter_cases(
    cases: List[ProcessCase],
    tribunal: str,
    juiz: str,
    tipo_acao: str,
    faixa_valor: str,
    periodo: str,
) -> List[ProcessCase]:
    min_value, max_value = _parse_value_range(faixa_valor)
    cutoff = _parse_period_cutoff(periodo)
    filtered = []
    for item in cases:
        if not _is_all_filter(tribunal, ["todos os tribunais"]) and _normalize_text(item.tribunal or "") != _normalize_text(tribunal):
            continue
        if not _is_all_filter(juiz, ["todos os juizes", "todos os juízes"]) and _normalize_text(item.judge or "") != _normalize_text(juiz):
            continue
        if not _is_all_filter(tipo_acao, ["todos os tipos"]) and _normalize_text(item.action_type or "") != _normalize_text(tipo_acao):
            continue
        if min_value is not None and (item.claim_value is None or item.claim_value < min_value):
            continue
        if max_value is not None and (item.claim_value is None or item.claim_value > max_value):
            continue
        if cutoff and item.created_at and item.created_at < cutoff:
            continue
        filtered.append(item)
    return filtered


def _filter_public_records(
    records: List[PublicCaseRecord],
    tribunal: str,
    juiz: str,
    tipo_acao: str,
    faixa_valor: str,
    periodo: str,
) -> List[PublicCaseRecord]:
    min_value, max_value = _parse_value_range(faixa_valor)
    cutoff = _parse_period_cutoff(periodo)
    filtered = []
    for item in records:
        if not _is_all_filter(tribunal, ["todos os tribunais"]) and _normalize_text(item.tribunal or "") != _normalize_text(tribunal):
            continue
        if not _is_all_filter(juiz, ["todos os juizes", "todos os juízes"]) and _normalize_text(item.judge or "") != _normalize_text(juiz):
            continue
        if not _is_all_filter(tipo_acao, ["todos os tipos"]) and _normalize_text(item.action_type or "") != _normalize_text(tipo_acao):
            continue
        if min_value is not None and (item.claim_value is None or item.claim_value < min_value):
            continue
        if max_value is not None and (item.claim_value is None or item.claim_value > max_value):
            continue
        if cutoff and item.created_at and item.created_at < cutoff:
            continue
        filtered.append(item)
    return filtered


def _safe_mean(values: List[float], default: float) -> float:
    return float(mean(values)) if values else default


def _pct(value: float) -> str:
    return f"{round(_clamp(value, 0.0, 1.0) * 100)}%"


def _has_min_benchmark_sample(user_count: int, market_count: int) -> bool:
    return user_count >= BENCHMARK_MIN_USER_OBSERVATIONS and market_count >= BENCHMARK_MIN_MARKET_OBSERVATIONS


def _benchmark_confidence(user_count: int, market_count: int) -> Tuple[str, str]:
    if user_count <= 0 or market_count <= 0:
        return "low", "Baixa"

    user_ratio = user_count / BENCHMARK_MIN_USER_OBSERVATIONS
    market_ratio = market_count / BENCHMARK_MIN_MARKET_OBSERVATIONS
    coverage = min(user_ratio, market_ratio)

    if coverage >= 2.0:
        return "high", "Alta"
    if coverage >= 1.3:
        return "medium", "Média"
    return "low", "Baixa"


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _action_category(action_type: Optional[str]) -> str:
    raw = _normalize_text(action_type or "")
    if "trabalh" in raw:
        return "Trabalhista"
    if "tribut" in raw:
        return "Tributário"
    if "famil" in raw:
        return "Família"
    if "comerc" in raw or "empres" in raw:
        return "Comercial"
    return "Cível"


def _build_rescisoria_data(cases: List[ProcessCase]) -> AcoesRescisoriasData:
    evaluated: List[Dict[str, Any]] = []
    for case in cases:
        existing = parse_rescisoria_snapshot(case.rescisoria_snapshot)
        snapshot = existing or (evaluate_case_rescisoria(case) if (case.ai_status or "") == "completed" else None)
        if not snapshot:
            continue

        financial = snapshot.get("financial_projection") if isinstance(snapshot.get("financial_projection"), dict) else {}
        evaluated.append(
            {
                "case_id": str(case.id),
                "process_number": case.process_number or f"Caso {str(case.id)[:8]}",
                "eligibility_status": str(snapshot.get("eligibility_status") or "uncertain"),
                "viability_score": int(max(0, min(100, int(snapshot.get("viability_score") or 0)))),
                "recommendation": str(snapshot.get("recommendation") or "monitor"),
                "grounds_detected": [str(item) for item in (snapshot.get("grounds_detected") or []) if str(item).strip()],
                "financial_projection": RescisoriaFinancialProjectionData(
                    estimated_cost_brl=float(financial.get("estimated_cost_brl") or 0.0),
                    projected_upside_brl=float(financial.get("projected_upside_brl") or 0.0),
                    projected_net_brl=float(financial.get("projected_net_brl") or 0.0),
                ),
            },
        )

    evaluated.sort(key=lambda item: item["viability_score"], reverse=True)
    top_candidates = evaluated[:8]
    total = len(evaluated)
    eligible_count = sum(1 for item in evaluated if item["eligibility_status"] == "eligible")
    uncertain_count = sum(1 for item in evaluated if item["eligibility_status"] == "uncertain")
    average_score = round(mean([item["viability_score"] for item in evaluated]), 1) if evaluated else 0.0

    if total == 0:
        summary = "Sem base suficiente para triagem de ações rescisórias neste recorte."
    else:
        summary = (
            f"Triagem rescisória com {total} caso(s) analisado(s); "
            f"{eligible_count} com recomendação de ajuizamento imediato."
        )

    return AcoesRescisoriasData(
        summary=summary,
        kpis=[
            RescisoriaKPIData(label="Casos avaliados", value=str(total), tone="blue"),
            RescisoriaKPIData(label="Elegíveis", value=str(eligible_count), tone="emerald"),
            RescisoriaKPIData(label="Em monitoramento", value=str(uncertain_count), tone="orange"),
            RescisoriaKPIData(label="Score médio", value=f"{average_score:.1f}", tone="cyan"),
        ],
        candidates=[
            RescisoriaCandidateData(
                case_id=item["case_id"],
                process_number=item["process_number"],
                eligibility_status=item["eligibility_status"],
                viability_score=item["viability_score"],
                recommendation=item["recommendation"],
                grounds_detected=item["grounds_detected"],
                financial_projection=item["financial_projection"],
            )
            for item in top_candidates
        ],
    )


def _extract_response_text(response: Any) -> str:
    text = getattr(response, "output_text", None)
    if text:
        return text

    output = getattr(response, "output", None) or []
    for item in output:
        if getattr(item, "type", "") != "message":
            continue
        content = getattr(item, "content", None) or []
        for part in content:
            if getattr(part, "type", "") in {"output_text", "text"}:
                part_text = getattr(part, "text", None)
                if part_text:
                    return part_text
    return ""


def _extract_first_json(raw: str) -> Dict[str, Any]:
    if not raw:
        return {}
    cleaned = raw.strip()
    fenced = re.search(r"```json\s*(\{.*?\})\s*```", cleaned, flags=re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    if cleaned.startswith("{") and cleaned.endswith("}"):
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            return {}
    return {}


def _build_weekday_activity(cases: List[ProcessCase]) -> List[WeeklyActivityPoint]:
    day_map = {"Mon": "Seg", "Tue": "Ter", "Wed": "Qua", "Thu": "Qui", "Fri": "Sex"}
    counts = {code: 0 for code in day_map.values()}
    now = datetime.now(timezone.utc)

    for item in cases:
        if not item.created_at:
            continue
        if item.created_at < now - timedelta(days=35):
            continue
        weekday = item.created_at.strftime("%a")
        label = day_map.get(weekday)
        if label:
            counts[label] += 1

    return [WeeklyActivityPoint(name=day, value=count) for day, count in counts.items()]


def _build_deadlines(deadlines: List[CaseDeadline]) -> List[CriticalDeadline]:
    now = datetime.now(timezone.utc)
    upcoming = [d for d in deadlines if d.due_date and d.due_date >= now]
    upcoming.sort(key=lambda d: d.due_date or now)

    result: List[CriticalDeadline] = []
    for item in upcoming[:3]:
        delta_days = (item.due_date - now).days if item.due_date else 0
        when = "Hoje" if delta_days <= 0 else "Amanha" if delta_days == 1 else f"Em {delta_days} dias"
        color = "red" if delta_days <= 2 else "orange" if delta_days <= 5 else "blue"
        result.append(CriticalDeadline(label=item.label, date=when, color=color))

    if result:
        return result
    return [CriticalDeadline(label="Sem prazos críticos", date="Sem prazo", color="blue")]


def _value_score(current: Optional[float], reference: Optional[float]) -> int:
    if current is None or current <= 0:
        return 0
    if reference is None or reference <= 0:
        return 50
    ratio = current / reference
    return int(round(_clamp(ratio * 50, 0, 100)))


def _record_outcome(item: PublicCaseRecord) -> Tuple[str, str]:
    if item.is_success is True:
        return "Êxito", "emerald"
    if item.is_success is False:
        return "Improcedente", "red"
    if item.is_settlement is True:
        return "Acordo", "blue"
    return "Sem desfecho", "orange"


def _build_similarity_reference(
    user_cases: List[ProcessCase],
    global_cases: List[ProcessCase],
    public_records: List[PublicCaseRecord],
) -> Dict[str, Optional[Union[float, str]]]:
    ref_cases = user_cases or global_cases

    action = None
    tribunal = None

    action_counter = Counter([_action_category(item.action_type) for item in ref_cases if item.action_type])
    if action_counter:
        action = action_counter.most_common(1)[0][0]

    tribunal_counter = Counter([(item.tribunal or "") for item in ref_cases if item.tribunal])
    if tribunal_counter:
        tribunal = tribunal_counter.most_common(1)[0][0]

    claim_values = [item.claim_value for item in ref_cases if item.claim_value is not None]
    if not claim_values:
        claim_values = [item.claim_value for item in public_records if item.claim_value is not None]

    months_values = [item.expected_decision_months for item in ref_cases if item.expected_decision_months is not None]
    if not months_values:
        months_values = [(item.duration_days or 0) / 30 for item in public_records if item.duration_days]

    return {
        "action": action,
        "tribunal": tribunal,
        "claim": _safe_mean([float(v) for v in claim_values], 0.0) if claim_values else None,
        "months": _safe_mean([float(v) for v in months_values], 0.0) if months_values else None,
    }


def _score_similarity(record: PublicCaseRecord, reference: Dict[str, Optional[Union[float, str]]]) -> Optional[int]:
    parts: List[float] = []

    ref_action = reference.get("action")
    if isinstance(ref_action, str):
        parts.append(1.0 if _action_category(record.action_type) == ref_action else 0.0)

    ref_tribunal = reference.get("tribunal")
    if isinstance(ref_tribunal, str) and ref_tribunal:
        parts.append(1.0 if (record.tribunal or "").lower() == ref_tribunal.lower() else 0.0)

    ref_claim = reference.get("claim")
    if isinstance(ref_claim, (int, float)) and ref_claim > 0 and record.claim_value is not None:
        delta = abs(float(record.claim_value) - float(ref_claim)) / max(float(ref_claim), 1.0)
        parts.append(1.0 - _clamp(delta, 0.0, 1.0))

    ref_months = reference.get("months")
    if isinstance(ref_months, (int, float)) and ref_months > 0 and record.duration_days:
        record_months = float(record.duration_days) / 30.0
        delta = abs(record_months - float(ref_months)) / max(float(ref_months), 1.0)
        parts.append(1.0 - _clamp(delta, 0.0, 1.0))

    if not parts:
        return None
    return int(round(_safe_mean(parts, 0.0) * 100))


def _build_similar_processes(
    records: List[PublicCaseRecord],
    user_cases: List[ProcessCase],
    global_cases: List[ProcessCase],
) -> List[SimilarProcessData]:
    if not records:
        return []

    reference = _build_similarity_reference(user_cases, global_cases, records)

    scored: List[Tuple[Optional[int], PublicCaseRecord]] = []
    for item in records:
        scored.append((_score_similarity(item, reference), item))

    scored.sort(key=lambda pair: ((pair[0] is None), -(pair[0] or 0), pair[1].created_at or datetime.min.replace(tzinfo=timezone.utc)))

    output: List[SimilarProcessData] = []
    for similarity, item in scored[:3]:
        result, result_color = _record_outcome(item)
        if item.duration_days:
            time_label = f"{(item.duration_days / 30.0):.1f} meses"
        else:
            time_label = "N/D"

        output.append(
            SimilarProcessData(
                id=item.process_number or item.external_id or "SEM-ID",
                similarity=f"{similarity}%" if similarity is not None else "N/D",
                result=result,
                result_color=result_color,
                time=time_label,
                type=_action_category(item.action_type),
            ),
        )
    return output


def _build_heatmap(records: List[PublicCaseRecord]) -> Tuple[List[str], List[HeatmapRowData]]:
    columns = ["Trabalhista", "Cível", "Tributário", "Comercial", "Família"]
    judge_buckets: Dict[str, Dict[str, List[bool]]] = defaultdict(lambda: defaultdict(list))

    for item in records:
        if item.is_success is None:
            continue
        judge = item.judge or "Juiz não identificado"
        category = _action_category(item.action_type)
        judge_buckets[judge][category].append(bool(item.is_success))

    rows: List[HeatmapRowData] = []
    ranked_judges = sorted(
        judge_buckets.items(),
        key=lambda item: sum(len(values) for values in item[1].values()),
        reverse=True,
    )

    for judge, categories in ranked_judges[:3]:
        values: List[int] = []
        for column in columns:
            samples = categories.get(column, [])
            if not samples:
                values.append(0)
                continue
            success_ratio = sum(1 for s in samples if s) / len(samples)
            values.append(int(round(success_ratio * 100)))
        rows.append(HeatmapRowData(name=judge[:28], values=values))

    return columns, rows


def _top_terms(values: List[str], limit: int = 4) -> List[str]:
    cleaned = [item.strip() for item in values if item and item.strip()]
    if not cleaned:
        return []
    return [item for item, _count in Counter(cleaned).most_common(limit)]


def _generate_ai_narratives(
    client: Optional[OpenAI],
    context: Dict[str, Any],
    db: Optional[Session],
    user_id: Optional[UUID],
) -> Dict[str, Any]:
    if client is None:
        return {}

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    system_prompt = (
        "Você é um analista jurídico no Brasil. "
        "Receberá métricas agregadas anonimizadas. "
        "Responda SOMENTE JSON válido, sem markdown."
    )
    perspective_rules = ""
    if context.get("perspective") and context.get("success_interpretation"):
        perspective_rules = (
            "\n- Há uma perspectiva do usuário no contexto (perspective_label e success_interpretation). "
            "Ao falar de êxito ou probabilidade de sucesso, use explicitamente 'favorável a você' ou 'favorável à contraparte' conforme a interpretação."
        )
    user_prompt = (
        "Use apenas os dados a seguir para gerar interpretações.\n"
        "Retorne JSON com este formato exato:\n"
        "{\n"
        '  "insights": [{"title": "...", "text": "..."}],\n'
        '  "scenario_notes": {"A": "...", "B": "...", "C": "..."},\n'
        '  "alert_notes": {"critical": "...", "warning": "...", "opportunity": "..."}\n'
        "}\n"
        "Regras:\n"
        "- Escreva em pt-BR objetivo.\n"
        "- No máximo 3 insights.\n"
        "- Não invente fontes nem números fora do contexto.\n"
        "- Não cite nomes de pessoas."
        + perspective_rules
        + "\n\n"
        f"Contexto: {json.dumps(context, ensure_ascii=True)}"
    )

    try:
        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_output_tokens=900,
        )
        record_openai_usage(
            db=db,
            logger=logger,
            operation="dashboard.generate_ai_narratives.responses",
            model=model,
            usage=getattr(response, "usage", None),
            user_id=user_id,
            context={"feature": "dashboard_narratives"},
        )
        parsed = _extract_first_json(_extract_response_text(response))
    except Exception:
        return {}

    insights = parsed.get("insights") if isinstance(parsed, dict) else None
    if isinstance(insights, list):
        normalized_insights = []
        for item in insights[:3]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "Insight")[:80]
            text = str(item.get("text") or "").strip()[:360]
            if text:
                normalized_insights.append({"title": title, "text": text})
    else:
        normalized_insights = []

    scenario_notes = parsed.get("scenario_notes") if isinstance(parsed, dict) else None
    alert_notes = parsed.get("alert_notes") if isinstance(parsed, dict) else None

    return {
        "insights": normalized_insights,
        "scenario_notes": scenario_notes if isinstance(scenario_notes, dict) else {},
        "alert_notes": alert_notes if isinstance(alert_notes, dict) else {},
    }


def build_dashboard_data(
    db: Session,
    user_id: UUID,
    tribunal: str = "Todos os Tribunais",
    juiz: str = "Todos os Juízes",
    tipo_acao: str = "Todos os Tipos",
    faixa_valor: str = "Todos os Valores",
    periodo: str = "Últimos 6 meses",
    ai_client: Optional[OpenAI] = None,
    case_context: Optional[CaseContextData] = None,
) -> DashboardData:
    all_user_cases = (
        db.query(ProcessCase)
        .filter(ProcessCase.user_id == user_id)
        .order_by(ProcessCase.created_at.desc())
        .all()
    )
    all_cases_global = db.query(ProcessCase).order_by(ProcessCase.created_at.desc()).all()
    all_public = db.query(PublicCaseRecord).order_by(PublicCaseRecord.created_at.desc()).all()

    case_ids = [item.id for item in all_user_cases]
    if case_ids:
        all_deadlines = (
            db.query(CaseDeadline)
            .filter(CaseDeadline.case_id.in_(case_ids))
            .order_by(CaseDeadline.due_date.asc())
            .all()
        )
    else:
        all_deadlines = []

    filtered_user_cases = _filter_cases(all_user_cases, tribunal, juiz, tipo_acao, faixa_valor, periodo)
    filtered_global_cases = _filter_cases(all_cases_global, tribunal, juiz, tipo_acao, faixa_valor, periodo)
    filtered_public = _filter_public_records(all_public, tribunal, juiz, tipo_acao, faixa_valor, periodo)

    user_success_values: List[float] = []
    for item in filtered_user_cases:
        prob = _normalize_probability(item.success_probability)
        if prob is not None:
            user_success_values.append(prob)
    success_values: List[float] = list(user_success_values)
    success_values += [1.0 if item.is_success else 0.0 for item in filtered_public if item.is_success is not None]

    user_settlement_values: List[float] = []
    for item in filtered_user_cases:
        prob = _normalize_probability(item.settlement_probability)
        if prob is not None:
            user_settlement_values.append(prob)
    settlement_values: List[float] = list(user_settlement_values)
    settlement_values += [1.0 if item.is_settlement else 0.0 for item in filtered_public if item.is_settlement is not None]

    user_months_values = [float(item.expected_decision_months) for item in filtered_user_cases if item.expected_decision_months is not None]
    months_values = list(user_months_values)
    months_values += [(item.duration_days or 0) / 30 for item in filtered_public if item.duration_days]

    risk_values = [
        score
        for score in (_normalize_score_100(item.risk_score) for item in filtered_user_cases)
        if score is not None
    ]
    complexity_values = [
        score
        for score in (_normalize_score_100(item.complexity_score) for item in filtered_user_cases)
        if score is not None
    ]

    success_rate = _safe_mean(success_values, 0.0)
    settlement_rate = _safe_mean(settlement_values, 0.0)
    avg_months = _safe_mean(months_values, 0.0)

    risk_score = _safe_mean(risk_values, _clamp((1 - success_rate) * 100, 0, 100) if success_values else 0.0)
    complexity_score = _safe_mean(complexity_values, _clamp(35 + (avg_months * 6), 0, 100) if months_values else 0.0)

    market_success_values: List[float] = []
    for item in filtered_global_cases:
        prob = _normalize_probability(item.success_probability)
        if prob is not None:
            market_success_values.append(prob)
    market_success_values += [1.0 if item.is_success else 0.0 for item in filtered_public if item.is_success is not None]

    market_settlement_values: List[float] = []
    for item in filtered_global_cases:
        prob = _normalize_probability(item.settlement_probability)
        if prob is not None:
            market_settlement_values.append(prob)
    market_settlement_values += [1.0 if item.is_settlement else 0.0 for item in filtered_public if item.is_settlement is not None]

    market_months_values = [
        float(item.expected_decision_months)
        for item in filtered_global_cases
        if item.expected_decision_months is not None
    ]
    market_months_values += [(item.duration_days or 0) / 30 for item in filtered_public if item.duration_days]

    market_risk_values = [
        score
        for score in (_normalize_score_100(item.risk_score) for item in filtered_global_cases)
        if score is not None
    ]
    market_complexity_values = [
        score
        for score in (_normalize_score_100(item.complexity_score) for item in filtered_global_cases)
        if score is not None
    ]

    market_success = _safe_mean(market_success_values, 0.0)
    market_settlement = _safe_mean(market_settlement_values, 0.0)
    market_months = _safe_mean(market_months_values, 0.0)
    market_risk = _safe_mean(
        market_risk_values,
        _clamp((1 - market_success) * 100, 0, 100) if market_success_values else 0.0,
    )
    market_complexity = _safe_mean(
        market_complexity_values,
        _clamp(35 + (market_months * 6), 0, 100) if market_months_values else 0.0,
    )

    user_claim_values = [float(item.claim_value) for item in filtered_user_cases if item.claim_value is not None]
    market_claim_values = [float(item.claim_value) for item in filtered_global_cases if item.claim_value is not None]
    market_claim_values += [float(item.claim_value) for item in filtered_public if item.claim_value is not None]
    user_claim = _safe_mean(user_claim_values, 0.0)
    market_claim = _safe_mean(market_claim_values, 0.0)

    sample_user = len(filtered_user_cases)
    sample_public = len(filtered_public)
    sample_total = sample_user + sample_public
    market_sample_total = len(filtered_global_cases) + len(filtered_public)
    user_success_sample_count = len(user_success_values)
    user_settlement_sample_count = len(user_settlement_values)
    user_duration_sample_count = len(user_months_values)
    market_success_sample_count = len(market_success_values)
    market_settlement_sample_count = len(market_settlement_values)
    market_duration_sample_count = len(market_months_values)
    success_sample_count = len(success_values)
    settlement_sample_count = len(settlement_values)
    duration_sample_count = len(months_values)
    risk_sample_count = len(risk_values) if risk_values else len(success_values)
    projection_sample_count = max(success_sample_count, settlement_sample_count, duration_sample_count, risk_sample_count)

    filtered_case_ids = {item.id for item in filtered_user_cases}
    filtered_deadlines = [item for item in all_deadlines if item.case_id in filtered_case_ids]

    weekly_activity = _build_weekday_activity(filtered_user_cases)
    critical_deadlines = _build_deadlines(filtered_deadlines)
    similar_processes = _build_similar_processes(filtered_public, filtered_user_cases, filtered_global_cases)
    heatmap_columns, heatmap_rows = _build_heatmap(filtered_public)

    updated_label = "Atualizado: agora" if sample_total > 0 else "Atualizado: sem dados para os filtros"

    ai_context = {
        "filters": {
            "tribunal": tribunal,
            "juiz": juiz,
            "tipo_acao": tipo_acao,
            "faixa_valor": faixa_valor,
            "periodo": periodo,
        },
        "samples": {
            "user_cases": sample_user,
            "public_records": sample_public,
            "market_cases": len(filtered_global_cases),
            "success_observations": success_sample_count,
            "settlement_observations": settlement_sample_count,
            "duration_observations": duration_sample_count,
            "risk_observations": risk_sample_count,
        },
        "metrics": {
            "success_rate": round(success_rate, 4),
            "settlement_rate": round(settlement_rate, 4),
            "avg_months": round(avg_months, 2),
            "risk_score": round(risk_score, 2),
            "complexity_score": round(complexity_score, 2),
            "market_success": round(market_success, 4),
            "market_settlement": round(market_settlement, 4),
            "market_months": round(market_months, 2),
            "market_risk": round(market_risk, 2),
            "market_complexity": round(market_complexity, 2),
        },
        "top_terms": {
            "user_tribunals": _top_terms([item.tribunal or "" for item in filtered_user_cases]),
            "user_actions": _top_terms([_action_category(item.action_type) for item in filtered_user_cases]),
            "public_actions": _top_terms([_action_category(item.action_type) for item in filtered_public]),
        },
    }
    if case_context and case_context.user_party:
        ai_context["perspective"] = case_context.user_party
        ai_context["perspective_label"] = "Autor" if case_context.user_party == "author" else "Réu"
        ai_context["success_interpretation"] = (
            "success_rate é a taxa de êxito do AUTOR da ação. "
            f"O usuário está como {ai_context['perspective_label']}: nos insights e nas notas de cenário, "
            "quando falar de probabilidade de êxito, use 'favorável a você' ou 'favorável à contraparte' para deixar claro a quem o resultado beneficia."
        )
    enable_ai_narratives = os.getenv("DASHBOARD_ENABLE_AI_NARRATIVES", "0").strip().lower() in {"1", "true", "yes", "on"}
    ai_narratives = (
        _generate_ai_narratives(
            client=ai_client,
            context=ai_context,
            db=db,
            user_id=user_id,
        )
        if enable_ai_narratives
        else {}
    )

    ai_insights = ai_narratives.get("insights", [])
    if len(ai_insights) >= 3:
        insight_items = [InsightItem(title=item["title"], text=item["text"]) for item in ai_insights[:3]]
    else:
        insight_items = [
            InsightItem(
                title="Panorama da carteira",
                text=(
                    f"Recorte atual com {sample_user} casos do usuário e {sample_public} registros públicos; "
                    f"{projection_sample_count} observações válidas nos indicadores."
                ),
            ),
            InsightItem(
                title="Comparativo com o mercado",
                text=f"Êxito em {_pct(success_rate)} vs mercado em {_pct(market_success)}; acordo em {_pct(settlement_rate)} vs {_pct(market_settlement)}.",
            ),
            InsightItem(
                title="Risco e prazo",
                text=f"Risco médio {risk_score:.1f}/100 e tempo médio {avg_months:.1f} meses para os filtros aplicados.",
            ),
        ]

    success_value_text = _pct(success_rate) if success_values else "N/D"
    settlement_value_text = _pct(settlement_rate) if settlement_values else "N/D"
    months_value_text = f"~{avg_months:.1f} meses" if months_values else "N/D"

    user_party_val = case_context.user_party if case_context else None
    favorable_to_user_pct: Optional[str] = None
    favorable_to_counterparty_pct: Optional[str] = None
    if user_party_val and success_values:
        if user_party_val == "author":
            favorable_to_user_pct = _pct(success_rate)
            favorable_to_counterparty_pct = _pct(1.0 - success_rate)
        else:
            favorable_to_user_pct = _pct(1.0 - success_rate)
            favorable_to_counterparty_pct = _pct(success_rate)

    acordo_footer = f"Baseado em {settlement_sample_count} eventos de acordo identificados."
    if case_context:
        acordo_footer += " Chance de resolução por acordo; não indica favorabilidade entre as partes."

    visao_geral = VisaoGeralData(
        stats=[
            MetricCardData(
                title="Probabilidade de Êxito",
                value=success_value_text,
                subtitle=(
                    f"Intervalo observado: {max(0, round((success_rate - 0.05) * 100))}% - "
                    f"{min(100, round((success_rate + 0.05) * 100))}%"
                    if success_values
                    else "Sem amostra suficiente para calcular êxito."
                ),
                footer=f"Baseado em {success_sample_count} observações com desfecho válido (usuário + público).",
                color="blue",
                updated=datetime.now().strftime("Atualizado em %d/%m/%Y às %H:%M"),
                value_favorable_to_user=favorable_to_user_pct,
                value_favorable_to_counterparty=favorable_to_counterparty_pct,
            ),
            MetricCardData(
                title="Probabilidade de Acordo",
                value=settlement_value_text,
                subtitle=(
                    f"Intervalo observado: {max(0, round((settlement_rate - 0.07) * 100))}% - "
                    f"{min(100, round((settlement_rate + 0.07) * 100))}%"
                    if settlement_values
                    else "Sem amostra suficiente para calcular acordo."
                ),
                footer=acordo_footer,
                color="blue",
                updated=datetime.now().strftime("Atualizado em %d/%m/%Y às %H:%M"),
            ),
            MetricCardData(
                title="Tempo Estimado de Decisão",
                value=months_value_text,
                subtitle=(
                    f"Faixa observada no recorte: {max(0.5, avg_months - 0.7):.1f} - {avg_months + 0.7:.1f} meses"
                    if months_values
                    else "Sem amostra suficiente para calcular tempo médio."
                ),
                footer=f"Calculado a partir de {duration_sample_count} observações de tempo (internas + públicas).",
                color="orange",
                warning="Amostra limitada: interpretar com cautela" if duration_sample_count < 15 and duration_sample_count > 0 else None,
            ),
        ],
        scores=[
            ScoreCardData(title="Risco", value=int(round(risk_score)), color="red"),
            ScoreCardData(title="Chance de Êxito", value=int(round(success_rate * 100)), color="emerald"),
            ScoreCardData(title="Chance de Acordo", value=int(round(settlement_rate * 100)), color="blue"),
            ScoreCardData(title="Complexidade", value=int(round(complexity_score)), color="orange"),
        ],
        radar=[
            RadarPoint(subject="Complexidade", current=int(round(complexity_score)), cluster_avg=int(round(market_complexity))),
            RadarPoint(subject="Chance Êxito", current=int(round(success_rate * 100)), cluster_avg=int(round(market_success * 100))),
            RadarPoint(subject="Valor", current=_value_score(user_claim if user_claim > 0 else None, market_claim if market_claim > 0 else None), cluster_avg=_value_score(market_claim if market_claim > 0 else None, market_claim if market_claim > 0 else None)),
            RadarPoint(
                subject="Tempo",
                current=int(round(_clamp(100 - (avg_months * 12), 0, 100))) if avg_months else 0,
                cluster_avg=int(round(_clamp(100 - (market_months * 12), 0, 100))) if market_months else 0,
            ),
            RadarPoint(subject="Risco", current=int(round(risk_score)), cluster_avg=int(round(market_risk))),
        ],
        insights=insight_items,
        weekly_activity=weekly_activity,
        critical_deadlines=critical_deadlines,
    )

    user_success_rate = _safe_mean(user_success_values, 0.0)
    user_settlement_rate = _safe_mean(user_settlement_values, 0.0)
    user_avg_months = _safe_mean(user_months_values, 0.0)

    success_comparable = _has_min_benchmark_sample(user_success_sample_count, market_success_sample_count)
    settlement_comparable = _has_min_benchmark_sample(user_settlement_sample_count, market_settlement_sample_count)
    duration_comparable = _has_min_benchmark_sample(user_duration_sample_count, market_duration_sample_count)

    if success_comparable:
        exito_gap = round((user_success_rate - market_success) * 100)
        success_trend = f"{exito_gap:+d}% vs mercado"
        success_trend_color = "emerald" if exito_gap >= 0 else "orange"
    else:
        success_trend = "Amostra insuficiente"
        success_trend_color = "blue"

    if settlement_comparable:
        acordo_gap = round((user_settlement_rate - market_settlement) * 100)
        settlement_trend = f"{acordo_gap:+d}% vs mercado"
        settlement_trend_color = "emerald" if acordo_gap >= 0 else "orange"
    else:
        settlement_trend = "Amostra insuficiente"
        settlement_trend_color = "blue"

    if duration_comparable and market_months > 0:
        months_gap = round(((market_months - user_avg_months) / market_months) * 100)
        if months_gap >= 0:
            months_trend = f"{months_gap}% mais rápido"
            months_trend_color = "emerald"
        else:
            months_trend = f"{abs(months_gap)}% mais lento"
            months_trend_color = "orange"
    elif duration_comparable:
        months_trend = "Sem base comparável"
        months_trend_color = "blue"
    else:
        months_trend = "Amostra insuficiente"
        months_trend_color = "blue"

    benchmark_success_user = _pct(user_success_rate) if user_success_sample_count > 0 else "N/D"
    benchmark_success_market = _pct(market_success) if market_success_sample_count > 0 else "N/D"
    benchmark_settlement_user = _pct(user_settlement_rate) if user_settlement_sample_count > 0 else "N/D"
    benchmark_settlement_market = _pct(market_settlement) if market_settlement_sample_count > 0 else "N/D"
    benchmark_months_user = f"{user_avg_months:.1f}" if user_duration_sample_count > 0 else "N/D"
    benchmark_months_market = f"{market_months:.1f}" if market_duration_sample_count > 0 else "N/D"
    success_confidence_level, success_confidence_label = _benchmark_confidence(user_success_sample_count, market_success_sample_count)
    duration_confidence_level, duration_confidence_label = _benchmark_confidence(user_duration_sample_count, market_duration_sample_count)
    settlement_confidence_level, settlement_confidence_label = _benchmark_confidence(
        user_settlement_sample_count,
        market_settlement_sample_count,
    )

    acoes_rescisorias = _build_rescisoria_data(filtered_user_cases)

    inteligencia = InteligenciaData(
        similar_processes=similar_processes,
        heatmap_columns=heatmap_columns,
        heatmap_rows=heatmap_rows,
        benchmark=[
            BenchmarkData(
                label="Taxa de Êxito",
                user=benchmark_success_user,
                market=benchmark_success_market,
                trend=success_trend,
                trend_color=success_trend_color,
                sample_user=user_success_sample_count,
                sample_market=market_success_sample_count,
                min_user_observations=BENCHMARK_MIN_USER_OBSERVATIONS,
                min_market_observations=BENCHMARK_MIN_MARKET_OBSERVATIONS,
                is_comparable=success_comparable,
                confidence_level=success_confidence_level,
                confidence_label=success_confidence_label,
            ),
            BenchmarkData(
                label="Tempo Médio",
                user=benchmark_months_user,
                market=benchmark_months_market,
                trend=months_trend,
                trend_color=months_trend_color,
                unit="meses",
                sample_user=user_duration_sample_count,
                sample_market=market_duration_sample_count,
                min_user_observations=BENCHMARK_MIN_USER_OBSERVATIONS,
                min_market_observations=BENCHMARK_MIN_MARKET_OBSERVATIONS,
                is_comparable=duration_comparable,
                confidence_level=duration_confidence_level,
                confidence_label=duration_confidence_label,
            ),
            BenchmarkData(
                label="Taxa de Acordo",
                user=benchmark_settlement_user,
                market=benchmark_settlement_market,
                trend=settlement_trend,
                trend_color=settlement_trend_color,
                sample_user=user_settlement_sample_count,
                sample_market=market_settlement_sample_count,
                min_user_observations=BENCHMARK_MIN_USER_OBSERVATIONS,
                min_market_observations=BENCHMARK_MIN_MARKET_OBSERVATIONS,
                is_comparable=settlement_comparable,
                confidence_level=settlement_confidence_level,
                confidence_label=settlement_confidence_label,
            ),
        ],
        acoes_rescisorias=acoes_rescisorias,
    )

    baseline_success = success_rate if success_values else market_success
    baseline_risk = risk_score if (risk_values or success_values) else market_risk
    baseline_months = avg_months if months_values else market_months
    baseline_value = user_claim if user_claim > 0 else market_claim

    has_projection_base = projection_sample_count > 0 and (
        baseline_success > 0 or baseline_risk > 0 or baseline_months > 0 or baseline_value > 0
    )

    if has_projection_base:
        scenario_a_success = _clamp(baseline_success - 0.03, 0.0, 1.0)
        scenario_b_success = _clamp(baseline_success, 0.0, 1.0)
        scenario_c_success = _clamp(baseline_success + 0.02, 0.0, 1.0)

        scenario_a_value = baseline_value * 0.82 if baseline_value else 0
        scenario_b_value = baseline_value * 1.05 if baseline_value else 0
        scenario_c_value = baseline_value * 0.95 if baseline_value else 0

        scenario_a_months = max(0.5, baseline_months * 0.45) if baseline_months else 0
        scenario_b_months = baseline_months
        scenario_c_months = max(1.0, baseline_months * 0.75) if baseline_months else 0

        scenario_a_risk = _clamp(baseline_risk * 0.45, 0, 100)
        scenario_b_risk = _clamp(baseline_risk, 0, 100)
        scenario_c_risk = _clamp(baseline_risk * 0.75, 0, 100)
    else:
        scenario_a_success = scenario_b_success = scenario_c_success = 0.0
        scenario_a_value = scenario_b_value = scenario_c_value = 0.0
        scenario_a_months = scenario_b_months = scenario_c_months = 0.0
        scenario_a_risk = scenario_b_risk = scenario_c_risk = 0.0

    scenario_notes = ai_narratives.get("scenario_notes", {})
    note_a = str(scenario_notes.get("A") or f"Projeção com base em {projection_sample_count} observações válidas do recorte.")
    note_b = str(scenario_notes.get("B") or f"Projeção com base em {projection_sample_count} observações válidas do recorte.")
    note_c = str(scenario_notes.get("C") or f"Projeção com base em {projection_sample_count} observações válidas do recorte.")

    def _scenario_favorable(success: float) -> Tuple[Optional[str], Optional[str]]:
        if not case_context or not case_context.user_party or not has_projection_base:
            return None, None
        if case_context.user_party == "author":
            return _pct(success), _pct(1.0 - success)
        return _pct(1.0 - success), _pct(success)

    s_a_user, s_a_counter = _scenario_favorable(scenario_a_success)
    s_b_user, s_b_counter = _scenario_favorable(scenario_b_success)
    s_c_user, s_c_counter = _scenario_favorable(scenario_c_success)

    simulacoes = SimulacaoData(
        description=(
            "Cenários estimados por IA com cruzamento entre dados do usuário, base pública e contexto global anônimo do banco."
            if has_projection_base
            else "Sem base histórica suficiente para projetar cenários neste recorte."
        ),
        scenarios=[
            ScenarioData(
                title="Cenário A: Acordo Imediato",
                tag="RECOMENDADO",
                tag_color="emerald",
                data=[
                    ScenarioItemData(
                        label="Probabilidade de Sucesso",
                        val=_pct(scenario_a_success) if has_projection_base else "N/D",
                        color="emerald",
                        value_favorable_to_user=s_a_user,
                        value_favorable_to_counterparty=s_a_counter,
                    ),
                    ScenarioItemData(label="Valor Estimado", val=(f"R$ {scenario_a_value:,.0f}".replace(",", ".") if scenario_a_value else "N/D")),
                    ScenarioItemData(label="Tempo Estimado", val=(f"{scenario_a_months:.1f} meses" if scenario_a_months else "N/D")),
                    ScenarioItemData(label="Nível de Risco", val=(f"{scenario_a_risk:.0f}%" if has_projection_base else "N/D"), color="emerald"),
                ],
                footer=note_a[:180],
            ),
            ScenarioData(
                title="Cenário B: Julgamento Final",
                tag="EQUILIBRADO",
                tag_color="blue",
                data=[
                    ScenarioItemData(
                        label="Probabilidade de Sucesso",
                        val=_pct(scenario_b_success) if has_projection_base else "N/D",
                        color="emerald",
                        value_favorable_to_user=s_b_user,
                        value_favorable_to_counterparty=s_b_counter,
                    ),
                    ScenarioItemData(label="Valor Estimado", val=(f"R$ {scenario_b_value:,.0f}".replace(",", ".") if scenario_b_value else "N/D")),
                    ScenarioItemData(label="Tempo Estimado", val=(f"{scenario_b_months:.1f} meses" if scenario_b_months else "N/D")),
                    ScenarioItemData(label="Nível de Risco", val=(f"{scenario_b_risk:.0f}%" if has_projection_base else "N/D"), color="orange"),
                ],
                footer=note_b[:180],
            ),
            ScenarioData(
                title="Cenário C: Estratégia Alternativa",
                tag="ALTERNATIVA",
                tag_color="orange",
                data=[
                    ScenarioItemData(
                        label="Probabilidade de Sucesso",
                        val=_pct(scenario_c_success) if has_projection_base else "N/D",
                        color="orange",
                        value_favorable_to_user=s_c_user,
                        value_favorable_to_counterparty=s_c_counter,
                    ),
                    ScenarioItemData(label="Valor Estimado", val=(f"R$ {scenario_c_value:,.0f}".replace(",", ".") if scenario_c_value else "N/D")),
                    ScenarioItemData(label="Tempo Estimado", val=(f"{scenario_c_months:.1f} meses" if scenario_c_months else "N/D")),
                    ScenarioItemData(label="Nível de Risco", val=(f"{scenario_c_risk:.0f}%" if has_projection_base else "N/D"), color="blue"),
                ],
                footer=note_c[:180],
            ),
        ],
        impact_metrics=[
            ImpactMetricData(
                label="MELHOR VALOR",
                icon="trophy",
                title="Cenário B",
                val=(f"R$ {scenario_b_value:,.0f} estimado".replace(",", ".") if scenario_b_value else "N/D"),
                trend=(f"+{round(((scenario_b_value - scenario_a_value) / scenario_a_value) * 100)}% vs Cenário A" if scenario_a_value else "Sem base"),
                trend_bg="bg-blue-50",
            ),
            ImpactMetricData(
                label="MENOR RISCO",
                icon="shield",
                title="Cenário A",
                val=(f"{scenario_a_risk:.0f}% de risco" if has_projection_base else "N/D"),
                trend=(f"-{round((scenario_b_risk - scenario_a_risk))} pts vs Cenário B" if has_projection_base else "Sem base"),
                trend_bg="bg-emerald-50",
            ),
            ImpactMetricData(
                label="MAIS RÁPIDO",
                icon="zap",
                title="Cenário A",
                val=(f"{scenario_a_months:.1f} meses" if scenario_a_months else "N/D"),
                trend=(f"-{round((scenario_b_months - scenario_a_months), 1)} meses vs Cenário B" if scenario_b_months and scenario_a_months else "Sem base"),
                trend_bg="bg-orange-50",
            ),
        ],
    )

    alert_notes = ai_narratives.get("alert_notes", {})

    details: List[DetailedAlertData] = []
    if market_months > 0 and avg_months > market_months and duration_sample_count > 0:
        details.append(
            DetailedAlertData(
                type="critical",
                title="Tempo acima do benchmark",
                time="agora",
                desc=str(
                    alert_notes.get("critical")
                    or f"Tempo médio atual de {avg_months:.1f} meses, acima do benchmark de {market_months:.1f} meses."
                )[:280],
            ),
        )

    if risk_score >= 45 and risk_sample_count > 0:
        details.append(
            DetailedAlertData(
                type="warning",
                title="Risco processual elevado",
                time="agora",
                desc=str(
                    alert_notes.get("warning")
                    or f"Score de risco em {risk_score:.1f}/100 para os filtros aplicados."
                )[:280],
            ),
        )

    if settlement_values and settlement_rate >= market_settlement:
        details.append(
            DetailedAlertData(
                type="opportunity",
                title="Janela favorável para acordo",
                time="agora",
                desc=str(
                    alert_notes.get("opportunity")
                    or f"Taxa de acordo no recorte ({_pct(settlement_rate)}) está acima ou igual ao benchmark ({_pct(market_settlement)})."
                )[:280],
            ),
        )

    details.append(
        DetailedAlertData(
            type="info",
            title="Base recalculada",
            time="agora",
            desc=(
                f"Dashboard recomputado com {sample_user} casos do usuário, "
                f"{sample_public} registros públicos e {market_sample_total} registros no contexto de mercado."
            ),
        ),
    )

    critical_count = sum(1 for item in details if item.type == "critical")
    warning_count = sum(1 for item in details if item.type == "warning")
    opportunity_count = sum(1 for item in details if item.type == "opportunity")
    info_count = sum(1 for item in details if item.type == "info")

    alertas = AlertasData(
        counts=[
            AlertCountData(count=critical_count, label="CRÍTICOS", color="red"),
            AlertCountData(count=warning_count, label="ATENÇÃO", color="orange"),
            AlertCountData(count=info_count, label="INFORMATIVOS", color="blue"),
            AlertCountData(count=opportunity_count, label="OPORTUNIDADES", color="emerald"),
        ],
        details=details,
    )

    return DashboardData(
        updated_label=updated_label,
        filters=DashboardFiltersData(
            tribunal=tribunal,
            juiz=juiz,
            tipo_acao=tipo_acao,
            faixa_valor=faixa_valor,
            periodo=periodo,
        ),
        visao_geral=visao_geral,
        inteligencia=inteligencia,
        simulacoes=simulacoes,
        alertas=alertas,
        generated_at=datetime.now(timezone.utc),
        case_context=case_context,
    )
