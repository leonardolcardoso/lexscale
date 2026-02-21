import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.db import SessionLocal, get_db, init_database
from backend.models import AIMessage, CaseDeadline, ProcessCase, ProcessDocument, PublicDataSource
from backend.schemas.cases import (
    CaseExtractionPayload,
    CaseListItem,
    CaseScoresPayload,
    UploadCaseResponse,
)
from backend.schemas.dashboard import DashboardData
from backend.schemas.public_data import (
    PublicDataSourceCreate,
    PublicDataSourceItem,
    PublicDataSyncResponse,
    PublicRecordUpsertRequest,
)
from backend.services.cases import (
    analyze_case_with_ai,
    build_case_embedding,
    extract_text_from_document,
    fallback_case_scores,
    fallback_extract_case_data,
    resolve_process_number,
    save_upload_bytes,
)
from backend.services.dashboard import build_dashboard_data
from backend.services.public_data import (
    ensure_default_public_sources,
    normalize_public_record,
    save_public_records,
    sync_enabled_sources,
)

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()


class ChatRequest(BaseModel):
    prompt: str = Field(min_length=1, description="Mensagem do usuario")
    system_prompt: Optional[str] = Field(
        default="Voce e um assistente juridico objetivo e preciso.",
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


def _get_openai_client(optional: bool = False) -> Optional[OpenAI]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        if optional:
            return None
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY nao configurada no ambiente.",
        )
    return OpenAI(api_key=api_key)


def _create_embedding(client: OpenAI, value: str) -> List[float]:
    embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    dimensions = int(os.getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536"))
    response = client.embeddings.create(model=embedding_model, input=value, dimensions=dimensions)
    return response.data[0].embedding


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


app = FastAPI(title="LexScale Backend (Python)", version="0.2.0")

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


@app.get("/api/dashboard", response_model=DashboardData)
def get_dashboard_data(
    tribunal: str = Query(default="Todos os Tribunais"),
    juiz: str = Query(default="Todos os Juizes"),
    tipo_acao: str = Query(default="Todos os Tipos"),
    faixa_valor: str = Query(default="Todos os Valores"),
    periodo: str = Query(default="Ultimos 6 meses"),
    db: Session = Depends(get_db),
) -> DashboardData:
    return build_dashboard_data(
        db=db,
        tribunal=tribunal,
        juiz=juiz,
        tipo_acao=tipo_acao,
        faixa_valor=faixa_valor,
        periodo=periodo,
    )


@app.get("/api/cases", response_model=List[CaseListItem])
def list_cases(
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> List[CaseListItem]:
    rows = db.query(ProcessCase).order_by(ProcessCase.created_at.desc()).limit(limit).all()
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
            created_at=item.created_at,
        )
        for item in rows
    ]


@app.post("/api/cases/upload", response_model=UploadCaseResponse)
async def upload_case(
    file: UploadFile = File(...),
    process_number: Optional[str] = Form(default=None),
    tribunal: Optional[str] = Form(default=None),
    judge: Optional[str] = Form(default=None),
    action_type: Optional[str] = Form(default=None),
    claim_value: Optional[float] = Form(default=None),
    status: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
) -> UploadCaseResponse:
    original_filename = file.filename or "processo.bin"
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    storage_path = save_upload_bytes(original_filename, payload)
    extracted_text = extract_text_from_document(storage_path, original_filename, file.content_type)
    if not extracted_text:
        extracted_text = "Nao foi possivel extrair texto automaticamente deste arquivo."

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
    scores: CaseScoresPayload = fallback_case_scores(extraction, extracted_text)

    client = _get_openai_client(optional=True)
    case_embedding = None
    if client:
        try:
            extraction, scores = analyze_case_with_ai(
                client=client,
                text=extracted_text,
                filename=original_filename,
                process_number=process_number_norm,
                tribunal=tribunal_norm,
                judge=judge_norm,
                action_type=action_type_norm,
                claim_value=claim_value,
            )
        except Exception:
            # fallback local ja montado acima.
            pass

        try:
            case_embedding = build_case_embedding(client, extracted_text)
        except Exception:
            case_embedding = None

    final_process_number = resolve_process_number(process_number_norm, extraction.process_number)
    case = ProcessCase(
        process_number=final_process_number,
        title=extraction.title,
        tribunal=extraction.tribunal,
        judge=extraction.judge,
        action_type=extraction.action_type,
        claim_value=extraction.claim_value or claim_value,
        status=status_norm or extraction.status or "em_andamento",
        extracted_fields=extraction.model_dump(mode="json"),
        ai_summary=scores.ai_summary,
        success_probability=scores.success_probability,
        settlement_probability=scores.settlement_probability,
        expected_decision_months=scores.expected_decision_months,
        risk_score=scores.risk_score,
        complexity_score=scores.complexity_score,
        case_embedding=case_embedding,
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

    return UploadCaseResponse(
        case_id=str(case.id),
        process_number=case.process_number,
        extracted=extraction,
        scores=scores,
        created_at=case.created_at,
    )


@app.get("/api/public-data/sources", response_model=List[PublicDataSourceItem])
def list_public_sources(db: Session = Depends(get_db)) -> List[PublicDataSourceItem]:
    sources = db.query(PublicDataSource).order_by(PublicDataSource.created_at.desc()).all()
    return [_to_source_item(source) for source in sources]


@app.post("/api/public-data/sources", response_model=PublicDataSourceItem)
def upsert_public_source(payload: PublicDataSourceCreate, db: Session = Depends(get_db)) -> PublicDataSourceItem:
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
def sync_public_data(db: Session = Depends(get_db)) -> PublicDataSyncResponse:
    results = sync_enabled_sources(db)
    return PublicDataSyncResponse(results=results)


@app.post("/api/public-data/records")
def upsert_public_records(payload: PublicRecordUpsertRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
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
def ai_chat(payload: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
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

    usage = getattr(response, "usage", None)
    usage_dict = usage.model_dump() if usage and hasattr(usage, "model_dump") else None

    prompt_embedding = None
    try:
        prompt_embedding = _create_embedding(client, payload.prompt)
    except Exception:
        prompt_embedding = None

    message = AIMessage(
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
def ai_history(limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)) -> List[HistoryItem]:
    messages = db.query(AIMessage).order_by(AIMessage.created_at.desc()).limit(limit).all()
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
def ai_search(payload: SearchRequest, db: Session = Depends(get_db)) -> List[SearchResult]:
    client = _get_openai_client(optional=False)
    try:
        query_embedding = _create_embedding(client, payload.query)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Falha ao gerar embedding: {exc}") from exc

    distance = AIMessage.prompt_embedding.l2_distance(query_embedding).label("distance")
    rows = (
        db.query(AIMessage, distance)
        .filter(AIMessage.prompt_embedding.isnot(None))
        .order_by(distance)
        .limit(payload.limit)
        .all()
    )

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


@app.on_event("startup")
def on_startup() -> None:
    try:
        init_database()
        with SessionLocal() as db:
            ensure_default_public_sources(db)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Falha ao inicializar Postgres/pgvector: {exc}") from exc
