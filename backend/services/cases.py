import json
import logging
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unicodedata import normalize as unicode_normalize
from uuid import UUID

from openai import OpenAI
from pypdf import PdfReader
from docx import Document
from sqlalchemy.orm import Session

from backend.schemas.cases import CaseExtractionPayload, CaseScoresPayload, DeadlinePayload
from backend.services.openai_usage import record_openai_usage

PROCESS_NUMBER_REGEX = r"\d{7}\s*-\s*\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}"
NUP_NUMBER_REGEX = r"\d{5}\.\d{6}/\d{4}-\d{2}"
MONEY_REGEX = r"R\$\s*\d+(?:[\.\s]\d{3})*(?:,\d{2})?"
logger = logging.getLogger("backend.services.cases")


def ensure_upload_dir() -> Path:
    base_dir = Path(__file__).resolve().parents[1]
    upload_dir = base_dir / "storage" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def sanitize_filename(name: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", name)
    return safe[:180] if safe else "documento.bin"


def save_upload_bytes(filename: str, payload: bytes) -> Path:
    upload_dir = ensure_upload_dir()
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    final_name = f"{stamp}_{uuid.uuid4().hex[:8]}_{sanitize_filename(filename)}"
    full_path = upload_dir / final_name
    full_path.write_bytes(payload)
    return full_path


def extract_text_from_document(path: Path, original_filename: str, content_type: Optional[str]) -> str:
    suffix = path.suffix.lower()
    raw_text = ""

    if suffix in {".txt", ".md", ".csv", ".json"}:
        raw_text = path.read_text(encoding="utf-8", errors="ignore")
    elif suffix == ".pdf":
        reader = PdfReader(str(path))
        pages = [(page.extract_text() or "") for page in reader.pages]
        raw_text = "\n".join(pages)
    elif suffix == ".docx":
        doc = Document(str(path))
        raw_text = "\n".join(paragraph.text for paragraph in doc.paragraphs)
    else:
        # Fallback para alguns content-types textuais.
        if content_type and content_type.startswith("text/"):
            raw_text = path.read_text(encoding="utf-8", errors="ignore")

    return raw_text.strip()


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


def _parse_brl_to_float(raw_value: str) -> Optional[float]:
    if not raw_value:
        return None
    value = re.sub(r"[^\d,\.]", "", raw_value or "")
    if not value:
        return None
    value = value.replace(".", "").replace(",", ".")
    try:
        return float(value)
    except ValueError:
        return None


def _normalize_text_for_match(value: str) -> str:
    normalized = unicode_normalize("NFD", value or "")
    return "".join(char for char in normalized if ord(char) < 128).lower()


def _extract_cnj_reference(process_number: Optional[str]) -> Tuple[Optional[str], Optional[int]]:
    if not process_number:
        return None, None
    compact = re.sub(r"\s+", "", process_number)
    cnj_match = re.match(r"^\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}$", compact)
    if not cnj_match:
        return None, None
    return cnj_match.group(1), int(cnj_match.group(2))


def _normalize_tribunal_label(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    compact = re.sub(r"\s+", "", value.upper())
    regional_match = re.match(r"^(TRF|TRT)-?0?(\d{1,2})$", compact)
    if regional_match:
        return f"{regional_match.group(1)}{int(regional_match.group(2))}"
    if re.match(r"^TJ[A-Z]{2,3}$", compact):
        return compact
    return value.strip()


def _extract_tribunal_from_header(text: str) -> Optional[str]:
    head = "\n".join(text.splitlines()[:140])
    federal_match = re.search(r"Tribunal\s+Regional\s+Federal\s+da\s+(\d+)[ªa]\s+Regi[aã]o", head, flags=re.IGNORECASE)
    if federal_match:
        return f"TRF{int(federal_match.group(1))}"

    trabalho_match = re.search(r"Tribunal\s+Regional\s+do\s+Trabalho\s+da\s+(\d+)[ªa]\s+Regi[aã]o", head, flags=re.IGNORECASE)
    if trabalho_match:
        return f"TRT{int(trabalho_match.group(1))}"

    trf_match = re.search(r"\bTRF-?\s*(\d+)\b", head, flags=re.IGNORECASE)
    if trf_match:
        return f"TRF{int(trf_match.group(1))}"

    trt_match = re.search(r"\bTRT-?\s*(\d+)\b", head, flags=re.IGNORECASE)
    if trt_match:
        return f"TRT{int(trt_match.group(1))}"

    return None


def _looks_like_person_name(candidate: str) -> bool:
    if not candidate:
        return False
    cleaned = re.sub(r"\s+", " ", candidate).strip(" .,:;-")
    if len(cleaned) < 6 or len(cleaned) > 120:
        return False
    if any(char.isdigit() for char in cleaned):
        return False

    tokens = re.findall(r"[A-Za-zÀ-ÿ]+", cleaned)
    if len(tokens) < 2:
        return False

    blocked = {
        "juizo",
        "juiz",
        "juiza",
        "grau",
        "origem",
        "vara",
        "tribunal",
        "federal",
        "substituto",
        "instancia",
        "processo",
    }
    lowered_tokens = [_normalize_text_for_match(token) for token in tokens]
    if any(token in blocked for token in lowered_tokens):
        return False

    particles = {"de", "da", "do", "dos", "das", "e"}
    meaningful = [token for token in lowered_tokens if token not in particles]
    return len(meaningful) >= 2


def _extract_judge_name(text: str) -> Optional[str]:
    head = "\n".join(text.splitlines()[:280])
    patterns = [
        r"(?:Ju[ií]z(?:a)?(?:\s+Federal)?(?:\s+Convocado)?|Magistrad[oa]|Relator(?:a)?|Desembargador(?:a)?(?:\s+Federal)?|Ministro(?:a)?)\s*[:\-]\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})",
        r"Assinado\s+por\s*[:\-]\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})",
        r"(?:Ju[ií]z(?:a)?\s+Federal)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})(?:\s*[,\.]|$)",
        r"(?:À\s+disposi[cç][aã]o|À\s+disposicao)[,\s]+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})",
        r"(?:Dr\.?|Dra\.?)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,6})\s*(?:\n|,|\s+Juiz|\s+Ju[ií]za)",
        r"Juiz\s+(?:da|de)\s+\d+[ªa]?\s+Vara\s+Federal[^.]*?[:\-]\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})",
    ]
    for pattern in patterns:
        for found in re.finditer(pattern, head, flags=re.IGNORECASE | re.MULTILINE):
            candidate = re.sub(r"\s+", " ", found.group(1)).strip(" .,:;-")
            if _looks_like_person_name(candidate):
                return candidate[:140]
    return None


def _extract_claim_value_heuristic(text: str) -> Optional[float]:
    preferred_patterns = [
        r"valor(?:\s+atualizado)?\s+da\s+causa.{0,160}?(R\$\s*[\d\.\,\s]+)",
        r"causa.{0,80}?(R\$\s*[\d\.\,\s]+)",
    ]
    for pattern in preferred_patterns:
        found = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if not found:
            continue
        parsed = _parse_brl_to_float(found.group(1))
        if parsed is not None:
            return parsed

    fallback_window = text[:35000]
    for found in re.finditer(MONEY_REGEX, fallback_window):
        parsed = _parse_brl_to_float(found.group(0))
        if parsed is None:
            continue
        context = _normalize_text_for_match(fallback_window[max(0, found.start() - 80) : found.end() + 80])
        if parsed < 10:
            continue
        if any(term in context for term in ["multa", "honorario", "custa", "diaria", "sucumb", "astreinte", "milhao", "bilhao"]):
            continue
        return parsed
    return None


def _extract_deadlines_heuristic(text: str) -> List[DeadlinePayload]:
    matches = re.findall(r"(\d{2}/\d{2}/\d{4})", text)
    deadlines: List[DeadlinePayload] = []
    for idx, raw_date in enumerate(matches[:5], start=1):
        due_date = None
        try:
            due_date = datetime.strptime(raw_date, "%d/%m/%Y")
        except ValueError:
            due_date = None
        deadlines.append(DeadlinePayload(label=f"Prazo {idx}", due_date=due_date, severity="media"))
    return deadlines


def fallback_extract_case_data(
    text: str,
    process_number: Optional[str],
    tribunal: Optional[str],
    judge: Optional[str],
    action_type: Optional[str],
    claim_value: Optional[float],
) -> CaseExtractionPayload:
    search_window = text[:35000]
    process_number_match = re.search(PROCESS_NUMBER_REGEX, search_window)
    nup_number_match = re.search(NUP_NUMBER_REGEX, search_window)
    extracted_process = _normalize_process_number(process_number_match.group(0)) if process_number_match else None
    extracted_nup = _normalize_nup_number(nup_number_match.group(0)) if nup_number_match else None
    process_number_final = process_number or extracted_process or extracted_nup

    tribunal_match = tribunal or _infer_tribunal_from_reference(process_number_final, search_window)
    if not tribunal_match:
        tribunal_match = _extract_tribunal_from_header(search_window)
    if not tribunal_match:
        tribunal_match = _search_first(search_window, [r"\bTJ[A-Z]{2}\b", r"\bTRT-?\d+\b", r"\bTRF-?\d+\b"])
    tribunal_match = _normalize_tribunal_label(tribunal_match)

    judge_match = judge or _extract_judge_name(search_window)
    action_type_final = action_type or _guess_action_type(search_window, process_number_final)

    claim_value_final = claim_value
    if claim_value_final is None:
        claim_value_final = _extract_claim_value_heuristic(text)

    return CaseExtractionPayload(
        process_number=process_number_final,
        title=_guess_title(search_window),
        tribunal=tribunal_match,
        judge=judge_match,
        action_type=action_type_final,
        claim_value=claim_value_final,
        status=_guess_status(search_window),
        parties={"author": None, "defendant": None},
        key_facts=_extract_key_facts(search_window),
        deadlines=_extract_deadlines_heuristic(search_window),
    )


def _search_first(text: str, patterns: List[str], group: int = 0) -> Optional[str]:
    for pattern in patterns:
        found = re.search(pattern, text, flags=re.IGNORECASE)
        if found:
            value = found.group(group).strip()
            return value[:140]
    return None


def _guess_action_type(text: str, process_number: Optional[str]) -> str:
    ramo, _ = _extract_cnj_reference(process_number)
    if ramo == "5":
        return "Trabalhista"
    if ramo == "4":
        return "Cível"

    lowered = _normalize_text_for_match(text)
    if re.search(r"\bclt\b", lowered) or any(term in lowered for term in ["reclamacao trabalhista", "dissidio", "justica do trabalho", "vara do trabalho"]):
        return "Trabalhista"
    if "tribut" in lowered:
        return "Tributário"
    if "famil" in lowered:
        return "Família"
    if any(term in lowered for term in ["falencia", "recuperacao judicial", "societar", "direito comercial"]):
        return "Comercial"
    if any(term in lowered for term in ["cumprimento de decisao", "oficio", "procuradoria", "administrativo", "militar"]):
        return "Cível"
    return "Cível"


def _guess_status(text: str) -> str:
    lowered = _normalize_text_for_match(text)
    if re.search(r"homolog\w+\s+acordo", lowered):
        return "acordo"
    if "sentenca" in lowered:
        return "sentenca"
    if "recurso" in lowered or "apelacao" in lowered:
        return "em_recurso"
    if "acordo" in lowered:
        return "acordo"
    return "em_andamento"


def _guess_title(text: str) -> Optional[str]:
    first_line = text.splitlines()[0].strip() if text else ""
    if not first_line:
        return None
    return first_line[:160]


def _extract_key_facts(text: str) -> List[str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    facts = [line for line in lines[:6] if len(line) > 25]
    return facts[:3]


def _normalize_process_number(value: str) -> str:
    compact = re.sub(r"\s+", "", value or "")
    return compact


def _normalize_nup_number(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def _infer_tribunal_from_reference(process_number: Optional[str], text: str) -> Optional[str]:
    ramo, orgao = _extract_cnj_reference(process_number)
    if ramo == "4" and orgao is not None:
        return f"TRF{orgao}"
    if ramo == "5" and orgao is not None:
        return f"TRT{orgao}"

    lowered = text.lower()
    region_match = re.search(r"(\d+)[ªa]\s+regi[aã]o", lowered)
    if region_match and ("procuradoria-regional da uniao" in lowered or "trf" in lowered):
        return f"TRF{int(region_match.group(1))}"

    return _extract_tribunal_from_header(text)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def fallback_case_scores(extraction: CaseExtractionPayload, text: str) -> CaseScoresPayload:
    length_factor = _clamp(len(text) / 12000.0, 0, 1)
    claim_factor = 0.5
    if extraction.claim_value:
        claim_factor = _clamp(extraction.claim_value / 200000.0, 0, 1)

    success = _clamp(0.72 - (claim_factor * 0.08) + (0.05 * (1 - length_factor)), 0.35, 0.92)
    settlement = _clamp(0.58 + (0.15 * claim_factor), 0.25, 0.95)
    months = round(2.2 + (length_factor * 4.5) + (claim_factor * 1.8), 2)
    risk = round(_clamp((1 - success) * 100 + (length_factor * 8), 5, 95), 1)
    complexity = round(_clamp((length_factor * 70) + (claim_factor * 30), 10, 95), 1)

    summary = (
        f"Análise inicial: probabilidade de êxito estimada em {round(success * 100)}%, "
        f"chance de acordo em {round(settlement * 100)}% e tempo médio de {months} meses."
    )
    return CaseScoresPayload(
        success_probability=round(success, 4),
        settlement_probability=round(settlement, 4),
        expected_decision_months=months,
        risk_score=risk,
        complexity_score=complexity,
        ai_summary=summary,
    )


def analyze_case_with_ai(
    client: OpenAI,
    text: str,
    filename: str,
    process_number: Optional[str],
    tribunal: Optional[str],
    judge: Optional[str],
    action_type: Optional[str],
    claim_value: Optional[float],
    db: Optional[Session] = None,
    user_id: Optional[UUID] = None,
    usage_operation: str = "cases.analyze_case_with_ai.responses",
) -> Tuple[CaseExtractionPayload, CaseScoresPayload]:
    truncated = text[:18000] if text else ""
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    system_prompt = (
        "Você é um analista jurídico no Brasil. "
        "Extraia dados estruturados e retorne APENAS JSON válido."
    )
    user_prompt = (
        "Analise o documento judicial abaixo e responda com JSON no formato:\n"
        "{\n"
        '  "extraction": {\n'
        '    "process_number": "...", "title": "...", "tribunal": "...", "judge": "...",\n'
        '    "action_type": "...", "claim_value": 0,\n'
        '    "status": "...", "parties": {"author": "...", "defendant": "..."},\n'
        '    "key_facts": ["..."], "deadlines": [{"label":"...", "due_date":"YYYY-MM-DD", "severity":"baixa|media|alta"}]\n'
        "  },\n"
        '  "scores": {\n'
        '    "success_probability": 0.0,\n'
        '    "settlement_probability": 0.0,\n'
        '    "expected_decision_months": 0.0,\n'
        '    "risk_score": 0.0,\n'
        '    "complexity_score": 0.0,\n'
        '    "ai_summary": "..."\n'
        "  }\n"
        "}\n\n"
        f"Contexto do upload: arquivo={filename}, process_number={process_number}, tribunal={tribunal}, juiz={judge}, tipo_acao={action_type}, claim_value={claim_value}\n\n"
        "Documento:\n"
        f"{truncated}"
    )

    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
        max_output_tokens=1400,
    )
    record_openai_usage(
        db=db,
        logger=logger,
        operation=usage_operation,
        model=model,
        usage=getattr(response, "usage", None),
        user_id=user_id,
        context={"feature": "case_enrichment"},
    )
    raw = _extract_response_text(response)
    parsed = _extract_first_json(raw)

    extraction_payload = parsed.get("extraction") or {}
    scores_payload = parsed.get("scores") or {}

    deadlines = []
    for item in extraction_payload.get("deadlines", []) or []:
        due_date = None
        due_raw = item.get("due_date")
        if due_raw:
            try:
                due_date = datetime.fromisoformat(str(due_raw))
            except ValueError:
                due_date = None
        deadlines.append(
            DeadlinePayload(
                label=str(item.get("label") or "Prazo"),
                due_date=due_date,
                severity=item.get("severity"),
            ),
        )

    extraction = CaseExtractionPayload(
        process_number=extraction_payload.get("process_number") or process_number,
        title=extraction_payload.get("title"),
        tribunal=extraction_payload.get("tribunal") or tribunal,
        judge=extraction_payload.get("judge") or judge,
        action_type=extraction_payload.get("action_type") or action_type,
        claim_value=extraction_payload.get("claim_value") or claim_value,
        status=extraction_payload.get("status"),
        parties=extraction_payload.get("parties") or {},
        key_facts=extraction_payload.get("key_facts") or [],
        deadlines=deadlines,
    )

    scores = CaseScoresPayload(
        success_probability=float(scores_payload.get("success_probability", 0.72)),
        settlement_probability=float(scores_payload.get("settlement_probability", 0.58)),
        expected_decision_months=float(scores_payload.get("expected_decision_months", 4.2)),
        risk_score=float(scores_payload.get("risk_score", 45)),
        complexity_score=float(scores_payload.get("complexity_score", 50)),
        ai_summary=str(scores_payload.get("ai_summary") or ""),
    )
    return extraction, scores


def build_case_embedding(
    client: OpenAI,
    text: str,
    db: Optional[Session] = None,
    user_id: Optional[UUID] = None,
    usage_operation: str = "cases.build_case_embedding.embeddings",
) -> Optional[List[float]]:
    snippet = text[:6000].strip()
    if not snippet:
        return None
    embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    dimensions = int(os.getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536"))
    response = client.embeddings.create(model=embedding_model, input=snippet, dimensions=dimensions)
    record_openai_usage(
        db=db,
        logger=logger,
        operation=usage_operation,
        model=embedding_model,
        usage=getattr(response, "usage", None),
        user_id=user_id,
        context={"feature": "case_embedding"},
    )
    return response.data[0].embedding


def resolve_process_number(preferred: Optional[str], extracted: Optional[str]) -> str:
    if preferred:
        return preferred
    if extracted:
        return extracted
    now = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return f"TEMP-{now}-{uuid.uuid4().hex[:6]}"
