import os
import re
import threading
import uuid as uuid_pkg
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import Cookie, Depends, FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openai import OpenAI
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session

from backend.db import SessionLocal, get_db, init_database
from backend.models import (
    AIUsageLog,
    AIMessage,
    AuthSession,
    CaseDeadline,
    ProcessCase,
    ProcessDocument,
    PublicDataSource,
    StrategicAlert,
    User,
    UserProfile,
)
from backend.schemas.auth import AuthResponse, LoginRequest, ProfileUpdateRequest, RegisterRequest, UserMeResponse
from backend.schemas.cases import (
    CaseAIStatusResponse,
    CaseExtractionPreviewResponse,
    CaseExtractionPayload,
    CaseListItem,
    RescisoriaAnalysisPayload,
    CaseScoresPayload,
    UploadHistoryGeneratedData,
    UploadHistoryItem,
    UploadCaseResponse,
)
from backend.schemas.dashboard import CaseContextData, DashboardData
from backend.schemas.public_data import (
    PublicDataSourceCreate,
    PublicDataSourceItem,
    PublicDataSyncResponse,
    PublicRecordUpsertRequest,
)
from backend.schemas.strategic_alerts import (
    AlertActionTarget,
    StrategicAlertActionResponse,
    StrategicAlertItem,
    StrategicAlertListResponse,
    StrategicAlertScanResponse,
)
from backend.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    name_from_email,
    session_expiry,
    verify_password,
)
from backend.services.cases import (
    analyze_case_with_ai,
    build_case_embedding,
    extract_text_from_document,
    fallback_extract_case_data,
    resolve_process_number,
    save_upload_bytes,
)
from backend.services.dashboard import build_dashboard_data
from backend.services.openai_usage import record_openai_usage
from backend.services.public_data import (
    ensure_default_public_sources,
    normalize_public_record,
    save_public_records,
    sync_enabled_sources,
)
from backend.services.strategic_alerts import (
    SCAN_INTERVAL_MINUTES,
    dismiss_alert,
    get_user_alert_by_id,
    list_user_alerts,
    mark_alert_as_read,
    scan_all_users_once,
    scan_user_now,
)
from backend.services.rescisory import evaluate_case_rescisoria, parse_rescisoria_snapshot

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()
FRONTEND_DIST_DIR = BASE_DIR.parent / "dist" / "public"
FRONTEND_INDEX_FILE = FRONTEND_DIST_DIR / "index.html"

AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "lexscale_session")
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "168"))
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "lax").strip().lower()
if SESSION_COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    SESSION_COOKIE_SAMESITE = "lax"

logger = logging.getLogger("backend.main")
_strategic_alert_scheduler_stop = threading.Event()
_strategic_alert_scheduler_thread: Optional[threading.Thread] = None
_ai_case_scheduler_stop = threading.Event()
_ai_case_scheduler_thread: Optional[threading.Thread] = None

AI_STATUS_QUEUED = "queued"
AI_STATUS_PROCESSING = "processing"
AI_STATUS_COMPLETED = "completed"
AI_STATUS_FAILED_RETRYABLE = "failed_retryable"
AI_STATUS_FAILED = "failed"
AI_STATUS_MANUAL_REVIEW = "manual_review"
AI_STAGE_EXTRACTION = "extraction"
AI_STAGE_ANALYSIS = "analysis_ai"
AI_STAGE_CROSS = "cross_data"
AI_STAGE_PUBLICATION = "publication"
AI_STAGE_COMPLETED = "completed"
AI_STAGE_FAILED = "failed"
AI_PROCESSING_POLL_SECONDS = max(5, int(os.getenv("AI_PROCESSING_POLL_SECONDS", "5")))
AI_MAX_RETRY_ATTEMPTS = max(1, int(os.getenv("AI_MAX_RETRY_ATTEMPTS", "5")))


class ChatRequest(BaseModel):
    prompt: str = Field(min_length=1, description="Mensagem do usuário")
    system_prompt: Optional[str] = Field(
        default="Você é um assistente jurídico objetivo e preciso.",
        description="Contexto de sistema para a IA",
    )
    model: Optional[str] = Field(default=None, description="Modelo opcional")
    temperature: Optional[float] = Field(default=0.2, ge=0, le=2)
    max_output_tokens: Optional[int] = Field(default=600, ge=1, le=4096)


class ChatResponse(BaseModel):
    message_id: str
    text: str
    model: str
    created_at: datetime
    usage: Optional[Dict[str, Any]] = None


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=5, ge=1, le=25)


class HistoryItem(BaseModel):
    message_id: str
    prompt: str
    response: str
    model: str
    created_at: datetime
    usage: Optional[Dict[str, Any]] = None


class SearchResult(HistoryItem):
    distance: float


class AIUsageLogItem(BaseModel):
    id: str
    operation: str
    model: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    estimated_cost_usd: Optional[float] = None
    created_at: datetime
    raw_usage: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None


class AIUsageOperationSummary(BaseModel):
    operation: str
    total_calls: int
    total_tokens: int
    estimated_cost_usd: float


class AIUsageSummaryResponse(BaseModel):
    range_days: int
    range_start: datetime
    range_end: datetime
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    estimated_cost_usd: float
    by_operation: List[AIUsageOperationSummary]


def _relative_time_label(value: Optional[datetime]) -> str:
    if value is None:
        return "agora"
    now = datetime.now(timezone.utc)
    dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    delta_seconds = max(0, int((now - dt).total_seconds()))
    if delta_seconds < 60:
        return "agora"
    if delta_seconds < 3600:
        return f"há {delta_seconds // 60} min"
    if delta_seconds < 86400:
        return f"há {delta_seconds // 3600}h"
    return f"há {delta_seconds // 86400} dia(s)"


def _to_strategic_alert_item(alert) -> StrategicAlertItem:
    action_target = None
    if isinstance(alert.action_target, dict):
        try:
            action_target = AlertActionTarget.model_validate(alert.action_target)
        except Exception:
            action_target = None
    return StrategicAlertItem(
        alert_id=str(alert.id),
        type=alert.category,
        title=alert.title,
        desc=alert.description,
        status=alert.status,
        source=alert.source,
        occurrence_count=max(1, int(alert.occurrence_count or 1)),
        contexts=[str(item) for item in (alert.contexts or []) if str(item).strip()],
        action_target=action_target,
        time=_relative_time_label(alert.notified_at or alert.last_detected_at or alert.created_at),
        created_at=alert.created_at,
        last_detected_at=alert.last_detected_at,
        notified_at=alert.notified_at,
        read_at=alert.read_at,
        dismissed_at=alert.dismissed_at,
    )


def _run_strategic_alert_scheduler() -> None:
    interval_seconds = max(60, SCAN_INTERVAL_MINUTES * 60)
    while not _strategic_alert_scheduler_stop.is_set():
        loop_started = datetime.now(timezone.utc)
        try:
            summary = scan_all_users_once(logger=logger)
            logger.info("Strategic alerts scan completed: %s", summary)
        except Exception:  # noqa: BLE001
            logger.exception("Strategic alerts scan loop failed.")

        elapsed = max(0.0, (datetime.now(timezone.utc) - loop_started).total_seconds())
        wait_seconds = max(5.0, interval_seconds - elapsed)
        _strategic_alert_scheduler_stop.wait(wait_seconds)


def _start_strategic_alert_scheduler() -> None:
    global _strategic_alert_scheduler_thread
    if _strategic_alert_scheduler_thread and _strategic_alert_scheduler_thread.is_alive():
        return
    _strategic_alert_scheduler_stop.clear()
    _strategic_alert_scheduler_thread = threading.Thread(
        target=_run_strategic_alert_scheduler,
        name="strategic-alerts-scheduler",
        daemon=True,
    )
    _strategic_alert_scheduler_thread.start()
    logger.info("Strategic alerts scheduler started (interval=%s min).", SCAN_INTERVAL_MINUTES)


def _stop_strategic_alert_scheduler() -> None:
    global _strategic_alert_scheduler_thread
    _strategic_alert_scheduler_stop.set()
    if _strategic_alert_scheduler_thread and _strategic_alert_scheduler_thread.is_alive():
        _strategic_alert_scheduler_thread.join(timeout=5)
    _strategic_alert_scheduler_thread = None


def _parse_cors_origins(raw: str) -> List[str]:
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


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


def _normalize_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _is_valid_email(value: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value))


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite=SESSION_COOKIE_SAMESITE,
        max_age=SESSION_TTL_HOURS * 3600,
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")


def _serve_frontend_path(path: str) -> FileResponse:
    if not FRONTEND_INDEX_FILE.exists():
        raise HTTPException(status_code=404, detail="Frontend não encontrado.")

    relative = (path or "").lstrip("/")
    if relative:
        candidate = (FRONTEND_DIST_DIR / relative).resolve()
        try:
            candidate.relative_to(FRONTEND_DIST_DIR.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Caminho inválido.") from exc
        if candidate.is_file():
            return FileResponse(candidate)

    return FileResponse(FRONTEND_INDEX_FILE)


def _get_openai_client(optional: bool = False) -> Optional[OpenAI]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        if optional:
            return None
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY não configurada no ambiente.",
        )
    return OpenAI(api_key=api_key)


def _create_embedding(
    client: OpenAI,
    value: str,
    db: Optional[Session] = None,
    user_id: Optional[uuid_pkg.UUID] = None,
    usage_operation: str = "main.create_embedding.embeddings",
) -> List[float]:
    embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    dimensions = int(os.getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536"))
    response = client.embeddings.create(model=embedding_model, input=value, dimensions=dimensions)
    record_openai_usage(
        db=db,
        logger=logger,
        operation=usage_operation,
        model=embedding_model,
        usage=getattr(response, "usage", None),
        user_id=user_id,
        context={"feature": "embedding"},
    )
    return response.data[0].embedding


def _retry_delay_minutes(attempt: int) -> int:
    delays = [1, 5, 15, 30, 60, 180]
    idx = max(0, min(len(delays) - 1, attempt - 1))
    return delays[idx]


def _normalize_probability(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return max(0.0, min(1.0, float(value)))


def _normalize_score_100(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    normalized = float(value)
    if 0.0 <= normalized <= 1.0:
        normalized *= 100
    return max(0.0, min(100.0, normalized))


def _set_case_ai_progress(
    case: ProcessCase,
    *,
    stage: str,
    label: str,
    percent: int,
) -> None:
    case.ai_stage = stage
    case.ai_stage_label = (label or "").strip()[:220]
    case.ai_progress_percent = max(0, min(100, int(percent)))
    case.ai_stage_updated_at = datetime.now(timezone.utc)


def _queue_case_ai_processing(db: Session, case: ProcessCase, reset_attempts: bool = False) -> None:
    case.ai_status = AI_STATUS_QUEUED
    if reset_attempts:
        case.ai_attempts = 0
    case.ai_last_error = None
    case.ai_next_retry_at = datetime.now(timezone.utc)
    case.ai_processed_at = None
    _set_case_ai_progress(
        case,
        stage=AI_STAGE_EXTRACTION,
        label="Extração concluída, aguardando análise por IA.",
        percent=25,
    )


def _to_case_ai_status_response(case: ProcessCase) -> CaseAIStatusResponse:
    return CaseAIStatusResponse(
        case_id=str(case.id),
        ai_status=case.ai_status or AI_STATUS_QUEUED,
        ai_attempts=int(case.ai_attempts or 0),
        ai_stage=case.ai_stage or AI_STAGE_EXTRACTION,
        ai_stage_label=case.ai_stage_label,
        ai_progress_percent=int(case.ai_progress_percent or 0),
        ai_stage_updated_at=case.ai_stage_updated_at,
        ai_next_retry_at=case.ai_next_retry_at,
        ai_processed_at=case.ai_processed_at,
        ai_last_error=case.ai_last_error,
    )


def _safe_case_extraction_payload(raw_value: Any) -> CaseExtractionPayload:
    if not isinstance(raw_value, dict):
        return CaseExtractionPayload()
    try:
        return CaseExtractionPayload.model_validate(raw_value)
    except Exception:
        return CaseExtractionPayload()


def _safe_rescisoria_payload(raw_value: Any) -> Optional[RescisoriaAnalysisPayload]:
    parsed = parse_rescisoria_snapshot(raw_value)
    if not parsed:
        return None
    try:
        return RescisoriaAnalysisPayload.model_validate(parsed)
    except Exception:
        return None


def _upsert_proactive_rescisoria_alert(
    db: Session,
    case: ProcessCase,
    rescisoria_snapshot: Dict[str, Any],
) -> None:
    if case.user_id is None:
        return

    viability_score = int(rescisoria_snapshot.get("viability_score") or 0)
    if viability_score < 70:
        return

    process_label = case.process_number or f"Caso {str(case.id)[:8]}"
    financial = rescisoria_snapshot.get("financial_projection") if isinstance(rescisoria_snapshot.get("financial_projection"), dict) else {}
    projected_net = float(financial.get("projected_net_brl") or 0.0)
    fingerprint = f"rescisoria|{case.id}"
    now = datetime.now(timezone.utc)
    action_target = {
        "tab": "inteligencia",
        "module": "acoes-rescisorias",
        "case_id": str(case.id),
        "reason": "potencial_rescisorio",
    }
    description = (
        f"Viabilidade rescisoria em {viability_score}/100 para {process_label}. "
        f"Projecao liquida estimada: R$ {projected_net:,.2f}."
    ).replace(",", "X").replace(".", ",").replace("X", ".")

    alert = (
        db.query(StrategicAlert)
        .filter(
            StrategicAlert.user_id == case.user_id,
            StrategicAlert.fingerprint == fingerprint,
        )
        .first()
    )

    if alert is None:
        db.add(
            StrategicAlert(
                user_id=case.user_id,
                category="opportunity",
                title=f"Potencial de Ações Rescisórias detectado: {process_label}",
                description=description[:420],
                fingerprint=fingerprint,
                status="new",
                source="case_rescisoria",
                action_target=action_target,
                occurrence_count=1,
                contexts=[process_label],
                first_detected_at=now,
                last_detected_at=now,
                notified_at=now,
            ),
        )
        return

    alert.category = "opportunity"
    alert.title = f"Potencial de Ações Rescisórias detectado: {process_label}"
    alert.description = description[:420]
    alert.source = "case_rescisoria"
    alert.action_target = action_target
    alert.contexts = [process_label]
    alert.last_detected_at = now
    alert.occurrence_count = int(alert.occurrence_count or 0) + 1
    alert.status = "new"
    alert.notified_at = now
    alert.read_at = None
    alert.dismissed_at = None


def _resolve_case_value_range_filter(claim_value: Optional[float]) -> str:
    if claim_value is None:
        return "Todos os Valores"
    if claim_value <= 100000:
        return "0-100k"
    if claim_value <= 500000:
        return "100k-500k"
    return ">500k"


def _build_case_dashboard_snapshot(db: Session, user_id: uuid_pkg.UUID, case: ProcessCase) -> DashboardData:
    tribunal_filter = (case.tribunal or "").strip() or "Todos os Tribunais"
    judge_filter = (case.judge or "").strip() or "Todos os Juízes"
    action_filter = (case.action_type or "").strip() or "Todos os Tipos"
    value_range_filter = _resolve_case_value_range_filter(case.claim_value)

    user_party_val: Optional[str] = None
    if case.user_party in ("author", "defendant"):
        user_party_val = case.user_party
    case_context = CaseContextData(
        case_id=str(case.id),
        process_number=case.process_number or "",
        case_title=case.title,
        user_party=user_party_val,
    )

    return build_dashboard_data(
        db=db,
        user_id=user_id,
        tribunal=tribunal_filter,
        juiz=judge_filter,
        tipo_acao=action_filter,
        faixa_valor=value_range_filter,
        periodo="all",
        ai_client=None,
        case_context=case_context,
    )


def _safe_dashboard_snapshot_payload(raw_value: Any) -> Optional[DashboardData]:
    if not isinstance(raw_value, dict):
        return None
    try:
        return DashboardData.model_validate(raw_value)
    except Exception:
        return None


def _persist_case_dashboard_snapshot(db: Session, case: ProcessCase) -> None:
    if case.user_id is None:
        return
    if isinstance(case.dashboard_snapshot, dict):
        return
    snapshot = _build_case_dashboard_snapshot(db=db, user_id=case.user_id, case=case)
    case.dashboard_snapshot = snapshot.model_dump(mode="json")
    db.commit()


def _set_case_ai_failure(db: Session, case: ProcessCase, error: str, retryable: bool) -> None:
    attempt = int(case.ai_attempts or 0)
    message = (error or "Falha desconhecida na análise de IA.").strip()[:800]

    if retryable and attempt < AI_MAX_RETRY_ATTEMPTS:
        case.ai_status = AI_STATUS_FAILED_RETRYABLE
        case.ai_next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=_retry_delay_minutes(attempt))
    else:
        case.ai_status = AI_STATUS_FAILED if retryable else AI_STATUS_MANUAL_REVIEW
        case.ai_next_retry_at = None

    case.ai_last_error = message
    case.ai_processed_at = None
    _set_case_ai_progress(
        case,
        stage=AI_STAGE_FAILED,
        label=message,
        percent=max(int(case.ai_progress_percent or 0), 45),
    )
    db.commit()
    if case.ai_status in {AI_STATUS_FAILED, AI_STATUS_MANUAL_REVIEW}:
        try:
            _persist_case_dashboard_snapshot(db=db, case=case)
        except Exception:
            db.rollback()
            logger.exception("Falha ao persistir snapshot do dashboard para case_id=%s", case.id)


def _process_case_ai_enrichment(case_id: uuid_pkg.UUID) -> None:
    with SessionLocal() as db:
        claimed = (
            db.query(ProcessCase)
            .filter(
                ProcessCase.id == case_id,
                ProcessCase.ai_status.in_([AI_STATUS_QUEUED, AI_STATUS_FAILED_RETRYABLE]),
            )
            .update(
                {
                    ProcessCase.ai_status: AI_STATUS_PROCESSING,
                    ProcessCase.ai_attempts: (ProcessCase.ai_attempts + 1),
                    ProcessCase.ai_last_error: None,
                    ProcessCase.ai_next_retry_at: None,
                    ProcessCase.ai_stage: AI_STAGE_ANALYSIS,
                    ProcessCase.ai_stage_label: "Analisando documento com IA.",
                    ProcessCase.ai_progress_percent: 45,
                    ProcessCase.ai_stage_updated_at: datetime.now(timezone.utc),
                },
                synchronize_session=False,
            )
        )
        db.commit()
        if not claimed:
            return

        case = db.query(ProcessCase).filter(ProcessCase.id == case_id).first()
        if case is None:
            return

        client = _get_openai_client(optional=True)
        if client is None:
            _set_case_ai_failure(db, case, "OPENAI_API_KEY não configurada para análise de IA.", retryable=False)
            return

        document = (
            db.query(ProcessDocument)
            .filter(ProcessDocument.case_id == case.id)
            .order_by(ProcessDocument.created_at.desc())
            .first()
        )
        extracted_text = (document.extracted_text if document and document.extracted_text else "").strip()
        if not extracted_text:
            _set_case_ai_failure(db, case, "Texto do documento indisponível para análise.", retryable=False)
            return

        fallback_extraction = fallback_extract_case_data(
            text=extracted_text,
            process_number=case.process_number,
            tribunal=case.tribunal,
            judge=case.judge,
            action_type=case.action_type,
            claim_value=case.claim_value,
        )

        try:
            extraction, scores = analyze_case_with_ai(
                client=client,
                text=extracted_text,
                filename=document.filename if document else "processo.bin",
                process_number=case.process_number,
                tribunal=case.tribunal,
                judge=case.judge,
                action_type=case.action_type,
                claim_value=case.claim_value,
                db=db,
                user_id=case.user_id,
                usage_operation="cases.async_enrichment.responses",
                user_party=case.user_party if case.user_party in ("author", "defendant") else None,
            )
        except Exception as exc:  # noqa: BLE001
            _set_case_ai_failure(db, case, f"Falha ao analisar caso com IA: {exc}", retryable=True)
            return

        _set_case_ai_progress(
            case,
            stage=AI_STAGE_CROSS,
            label="Cruzando resultados da IA com dados estruturados do processo.",
            percent=72,
        )
        db.commit()

        try:
            case_embedding = build_case_embedding(
                client=client,
                text=extracted_text,
                db=db,
                user_id=case.user_id,
                usage_operation="cases.async_enrichment.embeddings",
            )
        except Exception:
            case_embedding = None

        final_extraction = extraction or fallback_extraction
        if fallback_extraction and getattr(fallback_extraction, "authority_display", None):
            final_extraction = final_extraction.model_copy(update={"authority_display": fallback_extraction.authority_display})
        final_process_number = resolve_process_number(case.process_number, final_extraction.process_number)

        success_probability = _normalize_probability(scores.success_probability)
        settlement_probability = _normalize_probability(scores.settlement_probability)
        expected_decision_months = max(0.0, float(scores.expected_decision_months))
        risk_score = _normalize_score_100(scores.risk_score)
        complexity_score = _normalize_score_100(scores.complexity_score)

        _set_case_ai_progress(
            case,
            stage=AI_STAGE_PUBLICATION,
            label="Publicando resultados e atualizando indicadores do dashboard.",
            percent=90,
        )

        case.process_number = final_process_number
        case.title = final_extraction.title or case.title
        case.tribunal = final_extraction.tribunal or case.tribunal
        case.judge = final_extraction.judge or case.judge
        case.action_type = final_extraction.action_type or case.action_type
        case.claim_value = final_extraction.claim_value or case.claim_value
        case.status = case.status or final_extraction.status or "em_andamento"
        case.extracted_fields = final_extraction.model_dump(mode="json")
        case.ai_summary = (scores.ai_summary or "").strip()
        case.success_probability = success_probability
        case.settlement_probability = settlement_probability
        case.expected_decision_months = expected_decision_months
        case.risk_score = risk_score
        case.complexity_score = complexity_score
        rescisoria_snapshot = evaluate_case_rescisoria(case)
        case.rescisoria_snapshot = rescisoria_snapshot
        _upsert_proactive_rescisoria_alert(db=db, case=case, rescisoria_snapshot=rescisoria_snapshot)
        if case_embedding is not None:
            case.case_embedding = case_embedding

        db.query(CaseDeadline).filter(CaseDeadline.case_id == case.id).delete(synchronize_session=False)
        for deadline in final_extraction.deadlines:
            db.add(
                CaseDeadline(
                    case_id=case.id,
                    label=deadline.label,
                    due_date=deadline.due_date,
                    severity=deadline.severity,
                ),
            )

        case.ai_status = AI_STATUS_COMPLETED
        case.ai_last_error = None
        case.ai_next_retry_at = None
        case.ai_processed_at = datetime.now(timezone.utc)
        _set_case_ai_progress(
            case,
            stage=AI_STAGE_COMPLETED,
            label="Processamento concluído com sucesso.",
            percent=100,
        )
        db.commit()
        try:
            _persist_case_dashboard_snapshot(db=db, case=case)
        except Exception:
            db.rollback()
            logger.exception("Falha ao persistir snapshot do dashboard para case_id=%s", case.id)


def _trigger_case_ai_processing_async(case_id: uuid_pkg.UUID) -> None:
    def _runner() -> None:
        try:
            _process_case_ai_enrichment(case_id)
        except Exception:  # noqa: BLE001
            logger.exception("Falha inesperada no processamento assíncrono imediato da IA para case_id=%s.", case_id)

    worker = threading.Thread(
        target=_runner,
        name=f"ai-case-immediate-{str(case_id)[:8]}",
        daemon=True,
    )
    worker.start()


def _run_ai_case_scheduler() -> None:
    while not _ai_case_scheduler_stop.is_set():
        now = datetime.now(timezone.utc)
        case_ids: List[uuid_pkg.UUID] = []

        try:
            with SessionLocal() as db:
                due_rows = (
                    db.query(ProcessCase.id)
                    .filter(
                        ProcessCase.ai_status.in_([AI_STATUS_QUEUED, AI_STATUS_FAILED_RETRYABLE]),
                        or_(ProcessCase.ai_next_retry_at.is_(None), ProcessCase.ai_next_retry_at <= now),
                    )
                    .order_by(ProcessCase.created_at.asc())
                    .limit(20)
                    .all()
                )
                case_ids = [row.id for row in due_rows]
        except Exception:  # noqa: BLE001
            logger.exception("Falha ao buscar fila de processamento de IA.")

        for case_id in case_ids:
            try:
                _process_case_ai_enrichment(case_id)
            except Exception:  # noqa: BLE001
                logger.exception("Falha inesperada no processamento assíncrono da IA para case_id=%s.", case_id)

        _ai_case_scheduler_stop.wait(AI_PROCESSING_POLL_SECONDS)


def _start_ai_case_scheduler() -> None:
    global _ai_case_scheduler_thread
    if _ai_case_scheduler_thread and _ai_case_scheduler_thread.is_alive():
        return
    _ai_case_scheduler_stop.clear()
    _ai_case_scheduler_thread = threading.Thread(
        target=_run_ai_case_scheduler,
        name="ai-case-scheduler",
        daemon=True,
    )
    _ai_case_scheduler_thread.start()
    logger.info("AI case scheduler started (poll=%s sec).", AI_PROCESSING_POLL_SECONDS)


def _stop_ai_case_scheduler() -> None:
    global _ai_case_scheduler_thread
    _ai_case_scheduler_stop.set()
    if _ai_case_scheduler_thread and _ai_case_scheduler_thread.is_alive():
        _ai_case_scheduler_thread.join(timeout=5)
    _ai_case_scheduler_thread = None


def _to_source_item(source: PublicDataSource) -> PublicDataSourceItem:
    return PublicDataSourceItem(
        source_id=str(source.id),
        name=source.name,
        base_url=source.base_url,
        tribunal=source.tribunal,
        notes=source.notes,
        enabled=source.enabled,
        last_status=source.last_status,
        last_error=source.last_error,
        last_sync_at=source.last_sync_at,
    )


def _build_full_name(first_name: Optional[str], last_name: Optional[str], email: str) -> str:
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    joined = f"{first} {last}".strip()
    if joined:
        return joined
    derived_first, derived_last = name_from_email(email)
    return f"{derived_first} {derived_last}".strip() or email


def _ensure_profile(db: Session, user: User) -> UserProfile:
    profile = db.query(UserProfile).filter(UserProfile.user_id == user.id).first()
    if profile:
        return profile

    first_name, last_name = name_from_email(user.username)
    profile = UserProfile(
        user_id=user.id,
        first_name=first_name or None,
        last_name=last_name or None,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def _to_me_response(user: User, profile: UserProfile) -> UserMeResponse:
    return UserMeResponse(
        user_id=str(user.id),
        email=user.username,
        first_name=profile.first_name,
        last_name=profile.last_name,
        full_name=_build_full_name(profile.first_name, profile.last_name, user.username),
        company=profile.company,
        role=profile.role,
        phone=profile.phone,
        bio=profile.bio,
        created_at=user.created_at,
    )


def get_current_user(
    session_token: Optional[str] = Cookie(default=None, alias=AUTH_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User:
    if not session_token:
        raise HTTPException(status_code=401, detail="Não autenticado.")

    token_hash = hash_session_token(session_token)
    session = (
        db.query(AuthSession)
        .filter(
            AuthSession.token_hash == token_hash,
            AuthSession.revoked_at.is_(None),
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    expires_at = _as_utc(session.expires_at)
    if expires_at and expires_at <= datetime.now(timezone.utc):
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
        raise HTTPException(status_code=401, detail="Sessão expirada.")

    user = db.query(User).filter(User.id == session.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")
    return user


app = FastAPI(title="LexScale Backend (Python)", version="0.3.0")

cors_origins = _parse_cors_origins(
    os.getenv("CORS_ORIGINS", "http://localhost:5000,http://127.0.0.1:5000"),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, str]:
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/api/auth/register", response_model=AuthResponse)
def auth_register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
    email = _normalize_email(payload.email)
    if not _is_valid_email(email):
        raise HTTPException(status_code=400, detail="E-mail inválido.")

    existing = db.query(User).filter(User.username == email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ja existe uma conta com este e-mail.")

    first_name = _normalize_optional_text(payload.first_name)
    last_name = _normalize_optional_text(payload.last_name)
    if not first_name and not last_name:
        derived_first, derived_last = name_from_email(email)
        first_name = derived_first or None
        last_name = derived_last or None

    user = User(username=email, password=hash_password(payload.password))
    db.add(user)
    db.flush()

    profile = UserProfile(
        user_id=user.id,
        first_name=first_name,
        last_name=last_name,
    )
    db.add(profile)

    token = generate_session_token()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_session_token(token),
            expires_at=session_expiry(SESSION_TTL_HOURS),
        ),
    )

    db.commit()
    db.refresh(user)
    db.refresh(profile)

    _set_auth_cookie(response, token)
    return AuthResponse(user=_to_me_response(user, profile))


@app.post("/api/auth/login", response_model=AuthResponse)
def auth_login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
    email = _normalize_email(payload.email)
    if not _is_valid_email(email):
        raise HTTPException(status_code=400, detail="E-mail inválido.")

    user = db.query(User).filter(User.username == email).first()
    if not user or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=401, detail="Credenciais inválidas.")

    profile = db.query(UserProfile).filter(UserProfile.user_id == user.id).first()
    if not profile:
        profile = _ensure_profile(db, user)

    token = generate_session_token()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_session_token(token),
            expires_at=session_expiry(SESSION_TTL_HOURS),
        ),
    )
    db.commit()
    db.refresh(user)

    _set_auth_cookie(response, token)
    return AuthResponse(user=_to_me_response(user, profile))


@app.post("/api/auth/logout")
def auth_logout(
    response: Response,
    session_token: Optional[str] = Cookie(default=None, alias=AUTH_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> Dict[str, bool]:
    if session_token:
        token_hash = hash_session_token(session_token)
        session = (
            db.query(AuthSession)
            .filter(
                AuthSession.token_hash == token_hash,
                AuthSession.revoked_at.is_(None),
            )
            .first()
        )
        if session:
            session.revoked_at = datetime.now(timezone.utc)
            db.commit()

    _clear_auth_cookie(response)
    return {"ok": True}


@app.get("/api/auth/me", response_model=AuthResponse)
def auth_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AuthResponse:
    profile = _ensure_profile(db, current_user)
    return AuthResponse(user=_to_me_response(current_user, profile))


@app.get("/api/profile", response_model=UserMeResponse)
def get_profile(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserMeResponse:
    profile = _ensure_profile(db, current_user)
    return _to_me_response(current_user, profile)


@app.put("/api/profile", response_model=UserMeResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserMeResponse:
    profile = _ensure_profile(db, current_user)
    profile.first_name = _normalize_optional_text(payload.first_name)
    profile.last_name = _normalize_optional_text(payload.last_name)
    profile.company = _normalize_optional_text(payload.company)
    profile.role = _normalize_optional_text(payload.role)
    profile.phone = _normalize_optional_text(payload.phone)
    profile.bio = _normalize_optional_text(payload.bio)

    db.commit()
    db.refresh(profile)
    return _to_me_response(current_user, profile)


@app.get("/api/dashboard", response_model=DashboardData)
def get_dashboard_data(
    tribunal: str = Query(default="Todos os Tribunais"),
    juiz: str = Query(default="Todos os Juízes"),
    tipo_acao: str = Query(default="Todos os Tipos"),
    faixa_valor: str = Query(default="Todos os Valores"),
    periodo: str = Query(default="Últimos 6 meses"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DashboardData:
    ai_client = _get_openai_client(optional=True)
    dashboard = build_dashboard_data(
        db=db,
        user_id=current_user.id,
        tribunal=tribunal,
        juiz=juiz,
        tipo_acao=tipo_acao,
        faixa_valor=faixa_valor,
        periodo=periodo,
        ai_client=ai_client,
    )
    db.commit()
    return dashboard


@app.get("/api/strategic-alerts", response_model=StrategicAlertListResponse)
def get_strategic_alerts(
    status: str = Query(default="active"),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StrategicAlertListResponse:
    normalized_status = (status or "active").strip().lower()
    if normalized_status not in {"active", "new", "read", "dismissed", "all"}:
        raise HTTPException(status_code=400, detail="Status inválido. Use: active|new|read|dismissed|all")

    rows = list_user_alerts(db=db, user_id=current_user.id, status=normalized_status, limit=limit)
    return StrategicAlertListResponse(
        total=len(rows),
        status_filter=normalized_status,
        generated_at=datetime.now(timezone.utc),
        items=[_to_strategic_alert_item(item) for item in rows],
    )


@app.post("/api/strategic-alerts/scan", response_model=StrategicAlertScanResponse)
def trigger_strategic_alert_scan(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StrategicAlertScanResponse:
    result = scan_user_now(db=db, user_id=current_user.id)
    return StrategicAlertScanResponse(
        ok=True,
        scanned=result["scanned"],
        created=result["created"],
        updated=result["updated"],
        notified=result["notified"],
    )


@app.post("/api/strategic-alerts/{alert_id}/read", response_model=StrategicAlertActionResponse)
def read_strategic_alert(
    alert_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StrategicAlertActionResponse:
    try:
        parsed_alert_id = uuid_pkg.UUID(alert_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="ID de alerta inválido.") from exc

    alert = get_user_alert_by_id(db=db, user_id=current_user.id, alert_id=parsed_alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alerta não encontrado.")

    updated_alert = mark_alert_as_read(db=db, alert=alert)
    return StrategicAlertActionResponse(ok=True, alert=_to_strategic_alert_item(updated_alert))


@app.post("/api/strategic-alerts/{alert_id}/dismiss", response_model=StrategicAlertActionResponse)
def dismiss_strategic_alert(
    alert_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StrategicAlertActionResponse:
    try:
        parsed_alert_id = uuid_pkg.UUID(alert_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="ID de alerta inválido.") from exc

    alert = get_user_alert_by_id(db=db, user_id=current_user.id, alert_id=parsed_alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alerta não encontrado.")

    updated_alert = dismiss_alert(db=db, alert=alert)
    return StrategicAlertActionResponse(ok=True, alert=_to_strategic_alert_item(updated_alert))


@app.get("/api/cases", response_model=List[CaseListItem])
def list_cases(
    limit: int = Query(default=50, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[CaseListItem]:
    rows = (
        db.query(ProcessCase)
        .filter(ProcessCase.user_id == current_user.id)
        .order_by(ProcessCase.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        CaseListItem(
            case_id=str(item.id),
            process_number=item.process_number,
            tribunal=item.tribunal,
            judge=item.judge,
            action_type=item.action_type,
            claim_value=item.claim_value,
            status=item.status,
            success_probability=item.success_probability,
            settlement_probability=item.settlement_probability,
            expected_decision_months=item.expected_decision_months,
            risk_score=item.risk_score,
            complexity_score=item.complexity_score,
            ai_status=item.ai_status or AI_STATUS_QUEUED,
            ai_attempts=int(item.ai_attempts or 0),
            ai_stage=item.ai_stage or AI_STAGE_EXTRACTION,
            ai_stage_label=item.ai_stage_label,
            ai_progress_percent=int(item.ai_progress_percent or 0),
            ai_stage_updated_at=item.ai_stage_updated_at,
            ai_next_retry_at=item.ai_next_retry_at,
            ai_processed_at=item.ai_processed_at,
            ai_last_error=item.ai_last_error,
            rescisoria=_safe_rescisoria_payload(item.rescisoria_snapshot),
            created_at=item.created_at,
        )
        for item in rows
    ]


@app.get("/api/cases/{case_id}/dashboard-context", response_model=DashboardData)
def get_case_dashboard_context(
    case_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DashboardData:
    try:
        parsed_case_id = uuid_pkg.UUID(case_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="ID de caso inválido.") from exc

    case = (
        db.query(ProcessCase)
        .filter(
            ProcessCase.id == parsed_case_id,
            ProcessCase.user_id == current_user.id,
        )
        .first()
    )
    if case is None:
        raise HTTPException(status_code=404, detail="Caso não encontrado.")

    stored_snapshot = _safe_dashboard_snapshot_payload(case.dashboard_snapshot)
    if stored_snapshot is not None:
        user_party_val = case.user_party if case.user_party in ("author", "defendant") else None
        case_ctx = CaseContextData(
            case_id=str(case.id),
            process_number=case.process_number or "",
            case_title=case.title,
            user_party=user_party_val,
        )
        if stored_snapshot.case_context is None:
            stored_snapshot = stored_snapshot.model_copy(update={"case_context": case_ctx})
        return stored_snapshot

    if case.ai_status in {AI_STATUS_QUEUED, AI_STATUS_PROCESSING, AI_STATUS_FAILED_RETRYABLE}:
        raise HTTPException(
            status_code=409,
            detail="Snapshot deste upload ainda está sendo consolidado. Aguarde o término da análise.",
        )

    # Fallback for legacy records created before snapshot support.
    snapshot = _build_case_dashboard_snapshot(db=db, user_id=current_user.id, case=case)
    case.dashboard_snapshot = snapshot.model_dump(mode="json")
    db.commit()
    return snapshot


@app.get("/api/cases/upload-history", response_model=List[UploadHistoryItem])
def list_upload_history(
    limit: int = Query(default=60, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[UploadHistoryItem]:
    latest_document_subquery = (
        db.query(
            ProcessDocument.case_id.label("case_id"),
            func.max(ProcessDocument.created_at).label("latest_document_created_at"),
        )
        .group_by(ProcessDocument.case_id)
        .subquery()
    )

    rows = (
        db.query(ProcessCase, ProcessDocument)
        .outerjoin(latest_document_subquery, latest_document_subquery.c.case_id == ProcessCase.id)
        .outerjoin(
            ProcessDocument,
            and_(
                ProcessDocument.case_id == ProcessCase.id,
                ProcessDocument.created_at == latest_document_subquery.c.latest_document_created_at,
            ),
        )
        .filter(ProcessCase.user_id == current_user.id)
        .order_by(func.coalesce(latest_document_subquery.c.latest_document_created_at, ProcessCase.created_at).desc())
        .limit(limit)
        .all()
    )

    items: List[UploadHistoryItem] = []
    for case_item, document_item in rows:
        extracted_payload = _safe_case_extraction_payload(case_item.extracted_fields)
        success_p = case_item.success_probability
        user_party_val = case_item.user_party
        favorable_user: Optional[float] = None
        favorable_counterparty: Optional[float] = None
        if success_p is not None and user_party_val:
            prob = max(0.0, min(1.0, float(success_p)))
            if user_party_val == "author":
                favorable_user = round(prob * 100, 1)
                favorable_counterparty = round((1 - prob) * 100, 1)
            else:
                favorable_counterparty = round(prob * 100, 1)
                favorable_user = round((1 - prob) * 100, 1)
        items.append(
            UploadHistoryItem(
                case_id=str(case_item.id),
                process_number=case_item.process_number,
                user_party=user_party_val,
                case_title=case_item.title,
                filename=document_item.filename if document_item else None,
                content_type=document_item.content_type if document_item else None,
                tribunal=case_item.tribunal,
                judge=case_item.judge,
                action_type=case_item.action_type,
                claim_value=case_item.claim_value,
                status=case_item.status,
                ai_status=case_item.ai_status or AI_STATUS_QUEUED,
                ai_attempts=int(case_item.ai_attempts or 0),
                ai_stage=case_item.ai_stage or AI_STAGE_EXTRACTION,
                ai_stage_label=case_item.ai_stage_label,
                ai_progress_percent=int(case_item.ai_progress_percent or 0),
                ai_stage_updated_at=case_item.ai_stage_updated_at,
                ai_next_retry_at=case_item.ai_next_retry_at,
                ai_processed_at=case_item.ai_processed_at,
                ai_last_error=case_item.ai_last_error,
                created_at=document_item.created_at if document_item and document_item.created_at else case_item.created_at,
                generated_data=UploadHistoryGeneratedData(
                    extracted=extracted_payload,
                    success_probability=case_item.success_probability,
                    settlement_probability=case_item.settlement_probability,
                    expected_decision_months=case_item.expected_decision_months,
                    risk_score=case_item.risk_score,
                    complexity_score=case_item.complexity_score,
                    ai_summary=case_item.ai_summary,
                    rescisoria=_safe_rescisoria_payload(case_item.rescisoria_snapshot),
                    favorable_to_user_pct=favorable_user,
                    favorable_to_counterparty_pct=favorable_counterparty,
                ),
            ),
        )
    return items


@app.post("/api/cases/extract", response_model=CaseExtractionPreviewResponse)
async def extract_case_preview(
    file: UploadFile = File(...),
    process_number: Optional[str] = Form(default=None),
    tribunal: Optional[str] = Form(default=None),
    judge: Optional[str] = Form(default=None),
    action_type: Optional[str] = Form(default=None),
    claim_value: Optional[float] = Form(default=None),
    current_user: User = Depends(get_current_user),
) -> CaseExtractionPreviewResponse:
    del current_user
    original_filename = file.filename or "processo.bin"
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    suffix = Path(original_filename).suffix or ".bin"
    temporary_path: Optional[Path] = None
    extracted_text = ""

    try:
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(payload)
            temp_file.flush()
            os.fsync(temp_file.fileno())
            temporary_path = Path(temp_file.name)
        try:
            extracted_text = extract_text_from_document(
                temporary_path, original_filename, file.content_type
            )
        except Exception as e:
            logger.warning("Falha ao extrair texto do documento %s: %s", original_filename, e)
            extracted_text = ""
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink(missing_ok=True)

    if not extracted_text:
        extracted_text = "Não foi possível extrair texto automaticamente deste arquivo."

    process_number_norm = _normalize_optional_text(process_number)
    tribunal_norm = _normalize_optional_text(tribunal)
    judge_norm = _normalize_optional_text(judge)
    action_type_norm = _normalize_optional_text(action_type)

    extraction: CaseExtractionPayload = fallback_extract_case_data(
        text=extracted_text,
        process_number=process_number_norm,
        tribunal=tribunal_norm,
        judge=judge_norm,
        action_type=action_type_norm,
        claim_value=claim_value,
    )
    # Garantia: se temos authority_display mas judge ficou null, preenche judge a partir do display
    if extraction.judge is None and extraction.authority_display and ": " in extraction.authority_display:
        first_part = extraction.authority_display.split(";")[0].strip()
        if ": " in first_part:
            extraction = extraction.model_copy(
                update={"judge": first_part.split(": ", 1)[1].strip()[:120]}
            )
    # Último recurso no endpoint: texto longo contém assinatura mas extração não achou (ex.: encoding)
    if extraction.judge is None and len(extracted_text) > 10000:
        text_lower = extracted_text.lower()
        for marker in ("assinado eletronicamente por:", "assinado por:"):
            idx = text_lower.find(marker)
            if idx != -1:
                chunk = extracted_text[idx + len(marker) : idx + len(marker) + 100]
                line = chunk.split("\n")[0].split("\r")[0].strip()
                line = re.sub(r"\s*\d{1,2}/\d{1,2}/\d{4}.*$", "", line).strip()
                if len(line) > 4 and not any(c.isdigit() for c in line[:50]):
                    extraction = extraction.model_copy(
                        update={"judge": line[:120], "authority_display": f"Assinatura: {line[:120]}"}
                    )
                    break
        if extraction.judge is None and "desembargador federal" in text_lower:
            idx = text_lower.find("desembargador federal")
            skip = len("desembargador federal")
            after = extracted_text[idx + skip : idx + skip + 150].strip()
            first_line = after.split("\n")[0].split("\r")[0].strip()
            first_line = re.sub(r"\s*relator\s*$", "", first_line, flags=re.IGNORECASE).strip()
            if len(first_line) > 4 and not any(c.isdigit() for c in first_line[:50]):
                extraction = extraction.model_copy(
                    update={
                        "judge": first_line[:120],
                        "authority_display": f"Desembargador Federal / Relator: {first_line[:120]}",
                    }
                )
    logger.info(
        "extract preview: file=%s payload=%s chars extracted=%s judge=%s",
        original_filename,
        len(payload),
        len(extracted_text),
        extraction.judge,
    )
    final_process_number = resolve_process_number(process_number_norm, extraction.process_number)
    return CaseExtractionPreviewResponse(process_number=final_process_number, extracted=extraction)


@app.post("/api/cases/upload", response_model=UploadCaseResponse)
async def upload_case(
    file: UploadFile = File(...),
    process_number: Optional[str] = Form(default=None),
    tribunal: Optional[str] = Form(default=None),
    judge: Optional[str] = Form(default=None),
    action_type: Optional[str] = Form(default=None),
    claim_value: Optional[float] = Form(default=None),
    status: Optional[str] = Form(default=None),
    user_party: Optional[str] = Form(default=None),  # "author" | "defendant"
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UploadCaseResponse:
    original_filename = file.filename or "processo.bin"
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    storage_path = save_upload_bytes(original_filename, payload)
    extracted_text = extract_text_from_document(storage_path, original_filename, file.content_type)
    if not extracted_text:
        extracted_text = "Não foi possível extrair texto automaticamente deste arquivo."

    process_number_norm = _normalize_optional_text(process_number)
    tribunal_norm = _normalize_optional_text(tribunal)
    judge_norm = _normalize_optional_text(judge)
    action_type_norm = _normalize_optional_text(action_type)
    status_norm = _normalize_optional_text(status)

    extraction: CaseExtractionPayload = fallback_extract_case_data(
        text=extracted_text,
        process_number=process_number_norm,
        tribunal=tribunal_norm,
        judge=judge_norm,
        action_type=action_type_norm,
        claim_value=claim_value,
    )

    final_process_number = resolve_process_number(process_number_norm, extraction.process_number)
    user_party_norm: Optional[str] = None
    if user_party:
        raw = (user_party or "").strip().lower()
        if raw in ("author", "autor"):
            user_party_norm = "author"
        elif raw in ("defendant", "reu"):
            user_party_norm = "defendant"

    case = ProcessCase(
        user_id=current_user.id,
        process_number=final_process_number,
        title=extraction.title,
        tribunal=extraction.tribunal,
        judge=extraction.judge,
        action_type=extraction.action_type,
        claim_value=extraction.claim_value or claim_value,
        status=status_norm or extraction.status or "em_andamento",
        extracted_fields=extraction.model_dump(mode="json"),
        ai_summary=None,
        success_probability=None,
        settlement_probability=None,
        expected_decision_months=None,
        risk_score=None,
        complexity_score=None,
        case_embedding=None,
        ai_status=AI_STATUS_QUEUED,
        ai_stage=AI_STAGE_EXTRACTION,
        ai_stage_label="Extração concluída, aguardando análise por IA.",
        ai_progress_percent=25,
        ai_stage_updated_at=datetime.now(timezone.utc),
        ai_attempts=0,
        ai_last_error=None,
        ai_next_retry_at=datetime.now(timezone.utc),
        ai_processed_at=None,
        user_party=user_party_norm if user_party_norm in ("author", "defendant") else None,
    )
    db.add(case)
    db.flush()

    document = ProcessDocument(
        case_id=case.id,
        filename=original_filename,
        content_type=file.content_type,
        storage_path=str(storage_path),
        extracted_text=extracted_text,
    )
    db.add(document)

    for deadline in extraction.deadlines:
        db.add(
            CaseDeadline(
                case_id=case.id,
                label=deadline.label,
                due_date=deadline.due_date,
                severity=deadline.severity,
            ),
        )

    db.commit()
    db.refresh(case)
    _trigger_case_ai_processing_async(case.id)

    return UploadCaseResponse(
        case_id=str(case.id),
        process_number=case.process_number,
        extracted=extraction,
        scores=None,
        ai_status=case.ai_status or AI_STATUS_QUEUED,
        ai_attempts=int(case.ai_attempts or 0),
        ai_stage=case.ai_stage or AI_STAGE_EXTRACTION,
        ai_stage_label=case.ai_stage_label,
        ai_progress_percent=int(case.ai_progress_percent or 0),
        ai_stage_updated_at=case.ai_stage_updated_at,
        ai_next_retry_at=case.ai_next_retry_at,
        ai_last_error=case.ai_last_error,
        created_at=case.created_at,
    )


@app.post("/api/cases/{case_id}/reprocess-ai", response_model=CaseAIStatusResponse)
def reprocess_case_ai(
    case_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CaseAIStatusResponse:
    try:
        parsed_case_id = uuid_pkg.UUID(case_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="ID de caso inválido.") from exc

    case = (
        db.query(ProcessCase)
        .filter(
            ProcessCase.id == parsed_case_id,
            ProcessCase.user_id == current_user.id,
        )
        .first()
    )
    if case is None:
        raise HTTPException(status_code=404, detail="Caso não encontrado.")

    if case.ai_status == AI_STATUS_PROCESSING:
        return _to_case_ai_status_response(case)

    _queue_case_ai_processing(db, case, reset_attempts=True)
    db.commit()
    db.refresh(case)
    _trigger_case_ai_processing_async(case.id)
    return _to_case_ai_status_response(case)


@app.get("/api/cases/{case_id}/ai-status", response_model=CaseAIStatusResponse)
def get_case_ai_status(
    case_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CaseAIStatusResponse:
    try:
        parsed_case_id = uuid_pkg.UUID(case_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="ID de caso inválido.") from exc

    case = (
        db.query(ProcessCase)
        .filter(
            ProcessCase.id == parsed_case_id,
            ProcessCase.user_id == current_user.id,
        )
        .first()
    )
    if case is None:
        raise HTTPException(status_code=404, detail="Caso não encontrado.")
    return _to_case_ai_status_response(case)


@app.delete("/api/cases/{case_id}", status_code=204)
def delete_case(
    case_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    try:
        parsed_case_id = uuid_pkg.UUID(case_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="ID de caso inválido.") from exc

    case = (
        db.query(ProcessCase)
        .filter(
            ProcessCase.id == parsed_case_id,
            ProcessCase.user_id == current_user.id,
        )
        .first()
    )
    if case is None:
        raise HTTPException(status_code=404, detail="Caso não encontrado.")

    # Coletar caminhos dos arquivos antes de deletar (cascade remove os registros)
    paths_to_delete = [Path(doc.storage_path) for doc in case.documents if doc.storage_path]

    db.delete(case)
    db.commit()

    # Remover arquivos do disco para a IA não ter mais o dado
    for path in paths_to_delete:
        try:
            path.unlink(missing_ok=True)
        except OSError as e:
            logger.warning("Não foi possível remover arquivo do caso %s: %s", case_id, e)
    return None


@app.get("/api/public-data/sources", response_model=List[PublicDataSourceItem])
def list_public_sources(
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[PublicDataSourceItem]:
    sources = db.query(PublicDataSource).order_by(PublicDataSource.created_at.desc()).all()
    return [_to_source_item(source) for source in sources]


@app.post("/api/public-data/sources", response_model=PublicDataSourceItem)
def upsert_public_source(
    payload: PublicDataSourceCreate,
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PublicDataSourceItem:
    source = db.query(PublicDataSource).filter(PublicDataSource.name == payload.name).first()
    if source:
        source.base_url = payload.base_url
        source.tribunal = payload.tribunal
        source.notes = payload.notes
        source.headers = payload.headers
        source.enabled = payload.enabled
    else:
        source = PublicDataSource(
            name=payload.name,
            base_url=payload.base_url,
            tribunal=payload.tribunal,
            notes=payload.notes,
            headers=payload.headers,
            enabled=payload.enabled,
        )
        db.add(source)
    db.commit()
    db.refresh(source)
    return _to_source_item(source)


@app.post("/api/public-data/sync", response_model=PublicDataSyncResponse)
def sync_public_data(
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PublicDataSyncResponse:
    results = sync_enabled_sources(db)
    return PublicDataSyncResponse(results=results)


@app.post("/api/public-data/records")
def upsert_public_records(
    payload: PublicRecordUpsertRequest,
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    source = None
    if payload.source_name:
        source = db.query(PublicDataSource).filter(PublicDataSource.name == payload.source_name).first()
        if not source:
            source = PublicDataSource(
                name=payload.source_name,
                base_url=f"manual://{payload.source_name}",
                tribunal=None,
                notes="Fonte manual criada automaticamente",
                headers={},
                enabled=False,
            )
            db.add(source)
            db.flush()
        elif source.base_url.startswith("manual://") and source.enabled:
            source.enabled = False

    normalized = [normalize_public_record(item.model_dump(), source) for item in payload.records]
    inserted = save_public_records(db, normalized, source)
    db.commit()
    return {"inserted": inserted}


@app.post("/api/ai/chat", response_model=ChatResponse)
def ai_chat(
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    model = payload.model or os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    client = _get_openai_client(optional=False)

    input_messages = []
    if payload.system_prompt:
        input_messages.append({"role": "system", "content": payload.system_prompt})
    input_messages.append({"role": "user", "content": payload.prompt})

    try:
        response = client.responses.create(
            model=model,
            input=input_messages,
            temperature=payload.temperature,
            max_output_tokens=payload.max_output_tokens,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Falha ao chamar OpenAI: {exc}") from exc

    text_response = _extract_response_text(response).strip()
    if not text_response:
        raise HTTPException(status_code=502, detail="OpenAI retornou resposta vazia.")

    usage_snapshot = record_openai_usage(
        db=db,
        logger=logger,
        operation="api.ai.chat.responses",
        model=model,
        usage=getattr(response, "usage", None),
        user_id=current_user.id,
        context={"route": "/api/ai/chat"},
    )
    usage_dict = usage_snapshot.get("usage_dict")

    prompt_embedding = None
    try:
        prompt_embedding = _create_embedding(
            client=client,
            value=payload.prompt,
            db=db,
            user_id=current_user.id,
            usage_operation="api.ai.chat.prompt_embedding",
        )
    except Exception:
        prompt_embedding = None

    message = AIMessage(
        user_id=current_user.id,
        prompt=payload.prompt,
        response=text_response,
        model=model,
        usage=usage_dict,
        prompt_embedding=prompt_embedding,
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    return ChatResponse(
        message_id=str(message.id),
        text=text_response,
        model=model,
        usage=usage_dict,
        created_at=message.created_at,
    )


@app.get("/api/ai/history", response_model=List[HistoryItem])
def ai_history(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[HistoryItem]:
    messages = (
        db.query(AIMessage)
        .filter(AIMessage.user_id == current_user.id)
        .order_by(AIMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        HistoryItem(
            message_id=str(item.id),
            prompt=item.prompt,
            response=item.response,
            model=item.model,
            created_at=item.created_at,
            usage=item.usage,
        )
        for item in messages
    ]


@app.post("/api/ai/search", response_model=List[SearchResult])
def ai_search(
    payload: SearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[SearchResult]:
    client = _get_openai_client(optional=False)
    try:
        query_embedding = _create_embedding(
            client=client,
            value=payload.query,
            db=db,
            user_id=current_user.id,
            usage_operation="api.ai.search.query_embedding",
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Falha ao gerar embedding: {exc}") from exc

    distance = AIMessage.prompt_embedding.l2_distance(query_embedding).label("distance")
    rows = (
        db.query(AIMessage, distance)
        .filter(
            AIMessage.user_id == current_user.id,
            AIMessage.prompt_embedding.isnot(None),
        )
        .order_by(distance)
        .limit(payload.limit)
        .all()
    )

    db.commit()

    return [
        SearchResult(
            message_id=str(message.id),
            prompt=message.prompt,
            response=message.response,
            model=message.model,
            created_at=message.created_at,
            usage=message.usage,
            distance=float(distance_value),
        )
        for message, distance_value in rows
    ]


@app.get("/api/ai/usage/summary", response_model=AIUsageSummaryResponse)
def ai_usage_summary(
    days: int = Query(default=30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIUsageSummaryResponse:
    range_end = datetime.now(timezone.utc)
    range_start = range_end - timedelta(days=days)

    totals = (
        db.query(
            func.count(AIUsageLog.id),
            func.coalesce(func.sum(AIUsageLog.input_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.output_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.estimated_cost_usd), 0.0),
        )
        .filter(
            AIUsageLog.user_id == current_user.id,
            AIUsageLog.created_at >= range_start,
        )
        .one()
    )
    total_calls, total_input_tokens, total_output_tokens, total_tokens, estimated_cost_usd = totals

    operation_rows = (
        db.query(
            AIUsageLog.operation,
            func.count(AIUsageLog.id),
            func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.estimated_cost_usd), 0.0),
        )
        .filter(
            AIUsageLog.user_id == current_user.id,
            AIUsageLog.created_at >= range_start,
        )
        .group_by(AIUsageLog.operation)
        .order_by(func.count(AIUsageLog.id).desc(), AIUsageLog.operation.asc())
        .all()
    )

    return AIUsageSummaryResponse(
        range_days=days,
        range_start=range_start,
        range_end=range_end,
        total_calls=int(total_calls or 0),
        total_input_tokens=int(total_input_tokens or 0),
        total_output_tokens=int(total_output_tokens or 0),
        total_tokens=int(total_tokens or 0),
        estimated_cost_usd=float(estimated_cost_usd or 0.0),
        by_operation=[
            AIUsageOperationSummary(
                operation=str(operation),
                total_calls=int(calls or 0),
                total_tokens=int(tokens or 0),
                estimated_cost_usd=float(cost or 0.0),
            )
            for operation, calls, tokens, cost in operation_rows
        ],
    )


@app.get("/api/ai/usage/logs", response_model=List[AIUsageLogItem])
def ai_usage_logs(
    limit: int = Query(default=50, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[AIUsageLogItem]:
    rows = (
        db.query(AIUsageLog)
        .filter(AIUsageLog.user_id == current_user.id)
        .order_by(AIUsageLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        AIUsageLogItem(
            id=str(item.id),
            operation=item.operation,
            model=item.model,
            input_tokens=int(item.input_tokens or 0),
            output_tokens=int(item.output_tokens or 0),
            total_tokens=int(item.total_tokens or 0),
            estimated_cost_usd=float(item.estimated_cost_usd) if item.estimated_cost_usd is not None else None,
            created_at=item.created_at,
            raw_usage=item.raw_usage,
            context=item.context,
        )
        for item in rows
    ]


@app.get("/", include_in_schema=False)
def frontend_root() -> FileResponse:
    return _serve_frontend_path("")


@app.get("/{full_path:path}", include_in_schema=False)
def frontend_catch_all(full_path: str) -> FileResponse:
    if full_path == "health" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Não encontrado.")
    return _serve_frontend_path(full_path)


@app.on_event("startup")
def on_startup() -> None:
    try:
        init_database()
        with SessionLocal() as db:
            ensure_default_public_sources(db)
        _start_strategic_alert_scheduler()
        _start_ai_case_scheduler()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Falha ao inicializar Postgres/pgvector: {exc}") from exc


@app.on_event("shutdown")
def on_shutdown() -> None:
    _stop_strategic_alert_scheduler()
    _stop_ai_case_scheduler()
