import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from backend.models import PublicCaseRecord, PublicDataSource
from backend.schemas.public_data import PublicDataSyncResult

TJDFT_JURISPRUDENCIA_URL = "https://jurisdf.tjdft.jus.br/api/v1/pesquisa"
TRF5_TRANSPARENCIA_TIPO_URL = "https://api-transparencia.trf5.jus.br/api/v1/documento/tipo"

PROCESS_KEYS = ["numero_processo", "process_number", "processo", "processo_numero", "id_processo"]
TRIBUNAL_KEYS = ["tribunal", "orgao_julgador", "court"]
JUDGE_KEYS = ["juiz", "magistrado", "judge", "relator"]
ACTION_TYPE_KEYS = ["classe", "tipo_acao", "assunto", "action_type"]
STATUS_KEYS = ["status", "situacao"]
OUTCOME_KEYS = ["resultado", "outcome", "decisao"]
CLAIM_VALUE_KEYS = ["valor_causa", "claim_value", "valor", "valor_processo"]
FILED_AT_KEYS = ["data_distribuicao", "filed_at", "data_inicio"]
CLOSED_AT_KEYS = ["data_baixa", "closed_at", "data_fim"]
SETTLEMENT_KEYS = ["acordo", "is_settlement"]
SUCCESS_KEYS = ["success", "is_success", "procedente"]
EXTERNAL_ID_KEYS = ["id", "external_id", "uuid", "identificador"]


def ensure_default_public_sources(db: Session) -> None:
    defaults = [
        {
            "name": "tjdft_jurisprudencia",
            "base_url": TJDFT_JURISPRUDENCIA_URL,
            "tribunal": "TJDFT",
            "notes": "API publica oficial do TJDFT (jurisprudencia).",
            "headers": {"Content-Type": "application/json"},
            "enabled": True,
        },
        {
            "name": "trf5_transparencia_documentos",
            "base_url": TRF5_TRANSPARENCIA_TIPO_URL,
            "tribunal": "TRF5",
            "notes": "API publica oficial de transparencia do TRF5.",
            "headers": {},
            "enabled": True,
        },
    ]

    changed = False
    for item in defaults:
        existing = db.query(PublicDataSource).filter(PublicDataSource.name == item["name"]).first()
        if existing:
            continue
        db.add(
            PublicDataSource(
                name=item["name"],
                base_url=item["base_url"],
                tribunal=item["tribunal"],
                notes=item["notes"],
                headers=item["headers"],
                enabled=item["enabled"],
            ),
        )
        changed = True
    if changed:
        db.commit()


def _pick_first(item: Dict[str, Any], keys: List[str]) -> Any:
    for key in keys:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace("R$", "").replace(" ", "").replace(".", "").replace(",", ".")
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _to_bool(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        raw = value.strip().lower()
        if raw in {"true", "1", "sim", "yes", "procedente", "ganho", "provido", "parcialmente provido"}:
            return True
        if raw in {"false", "0", "nao", "não", "no", "improcedente", "perda", "improvido"}:
            return False
    return None


def _to_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        raw = value.strip().replace("Z", "+00:00")
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
            try:
                parsed = datetime.strptime(raw, fmt)
                return parsed.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        try:
            parsed = datetime.fromisoformat(raw)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            return None
    return None


def _extract_claim_value_from_text(*parts: Optional[str]) -> Optional[float]:
    merged = " ".join([part for part in parts if part]).replace("\n", " ")
    match = re.search(r"R\$\s*([\d\.\,]+)", merged)
    if not match:
        return None
    return _to_float(match.group(1))


def _extract_success_from_decision(text: Optional[str]) -> Optional[bool]:
    if not text:
        return None
    lowered = text.lower()
    if "improvido" in lowered or "improcedente" in lowered:
        return False
    if "provido" in lowered or "procedente" in lowered:
        return True
    return None


def _extract_settlement_from_text(*parts: Optional[str]) -> Optional[bool]:
    merged = " ".join([part for part in parts if part]).lower()
    if "acordo" in merged:
        return True
    return None


def extract_items_from_payload(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("items", "data", "results", "rows", "registros", "resultado"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        if payload:
            return [payload]
    return []


def normalize_public_record(item: Dict[str, Any], source: Optional[PublicDataSource] = None) -> Dict[str, Any]:
    external_id = _pick_first(item, EXTERNAL_ID_KEYS)
    process_number = _pick_first(item, PROCESS_KEYS)
    tribunal = _pick_first(item, TRIBUNAL_KEYS) or (source.tribunal if source else None)
    judge = _pick_first(item, JUDGE_KEYS)
    action_type = _pick_first(item, ACTION_TYPE_KEYS)
    status = _pick_first(item, STATUS_KEYS)
    outcome = _pick_first(item, OUTCOME_KEYS)
    claim_value = _to_float(_pick_first(item, CLAIM_VALUE_KEYS))
    filed_at = _to_datetime(_pick_first(item, FILED_AT_KEYS))
    closed_at = _to_datetime(_pick_first(item, CLOSED_AT_KEYS))
    is_settlement = _to_bool(_pick_first(item, SETTLEMENT_KEYS))
    is_success = _to_bool(_pick_first(item, SUCCESS_KEYS))

    duration_days = None
    if filed_at and closed_at:
        duration_days = max(1, (closed_at - filed_at).days)

    try:
        raw_data = json.loads(json.dumps(item, default=str))
    except Exception:
        raw_data = {"raw": str(item)}

    return {
        "external_id": str(external_id) if external_id is not None else None,
        "process_number": str(process_number) if process_number is not None else None,
        "tribunal": str(tribunal) if tribunal is not None else None,
        "judge": str(judge) if judge is not None else None,
        "action_type": str(action_type) if action_type is not None else None,
        "status": str(status) if status is not None else None,
        "outcome": str(outcome) if outcome is not None else None,
        "claim_value": claim_value,
        "filed_at": filed_at,
        "closed_at": closed_at,
        "duration_days": duration_days,
        "is_settlement": is_settlement,
        "is_success": is_success,
        "raw_data": raw_data,
    }


def _normalize_tjdft_item(item: Dict[str, Any]) -> Dict[str, Any]:
    decisao = item.get("decisao")
    ementa = item.get("ementa")
    judgment = _to_datetime(item.get("dataJulgamento"))
    filed = _to_datetime(item.get("dataPublicacao"))
    if filed and judgment and judgment > filed:
        filed, judgment = judgment, filed

    return {
        "external_id": str(item.get("uuid") or item.get("identificador") or item.get("sequencial") or ""),
        "process_number": item.get("processo"),
        "tribunal": "TJDFT",
        "judge": item.get("nomeRelator"),
        "action_type": item.get("descricaoOrgaoJulgador") or item.get("codigoClasseCnj"),
        "status": "julgado",
        "outcome": decisao,
        "claim_value": _extract_claim_value_from_text(ementa, decisao),
        "filed_at": filed,
        "closed_at": judgment,
        "duration_days": max(1, (judgment - filed).days) if filed and judgment else None,
        "is_settlement": _extract_settlement_from_text(decisao, ementa),
        "is_success": _extract_success_from_decision(decisao),
        "raw_data": json.loads(json.dumps(item, default=str)),
    }


def _normalize_trf5_tipo_item(item: Dict[str, Any]) -> Dict[str, Any]:
    external_id = item.get("id")
    descricao = item.get("descricao")
    periodo = item.get("listaPeriodo")
    return {
        "external_id": f"trf5-doc-{external_id}",
        "process_number": f"TRF5-DOC-{external_id}",
        "tribunal": "TRF5",
        "judge": None,
        "action_type": descricao,
        "status": "publicado",
        "outcome": periodo,
        "claim_value": None,
        "filed_at": None,
        "closed_at": None,
        "duration_days": None,
        "is_settlement": None,
        "is_success": None,
        "raw_data": json.loads(json.dumps(item, default=str)),
    }


def fetch_public_records_from_source(source: PublicDataSource) -> Tuple[List[Dict[str, Any]], List[str]]:
    errors: List[str] = []

    if source.base_url == TJDFT_JURISPRUDENCIA_URL:
        return fetch_tjdft_records(source)
    if source.base_url == TRF5_TRANSPARENCIA_TIPO_URL:
        return fetch_trf5_records(source)

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(source.base_url, headers=source.headers or {})
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:  # noqa: BLE001
        return [], [f"Falha ao buscar fonte {source.name}: {exc}"]

    items = extract_items_from_payload(payload)
    normalized = [normalize_public_record(item, source) for item in items]
    return normalized, errors


def fetch_tjdft_records(source: PublicDataSource) -> Tuple[List[Dict[str, Any]], List[str]]:
    errors: List[str] = []
    page_size = int(os.getenv("PUBLIC_SYNC_TJDFT_PAGE_SIZE", "40"))
    query = os.getenv("PUBLIC_SYNC_TJDFT_QUERY", "direito civil")
    payload = {"query": query, "pagina": 0, "tamanho": page_size}
    headers = {"Content-Type": "application/json"}
    headers.update(source.headers or {})
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(source.base_url, headers=headers, json=payload)
            response.raise_for_status()
            body = response.json()
    except Exception as exc:  # noqa: BLE001
        return [], [f"Falha TJDFT ({source.name}): {exc}"]

    raw_items = body.get("registros") or []
    normalized = [_normalize_tjdft_item(item) for item in raw_items if isinstance(item, dict)]
    return normalized, errors


def fetch_trf5_records(source: PublicDataSource) -> Tuple[List[Dict[str, Any]], List[str]]:
    errors: List[str] = []
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(source.base_url, headers=source.headers or {})
            response.raise_for_status()
            body = response.json()
    except Exception as exc:  # noqa: BLE001
        return [], [f"Falha TRF5 ({source.name}): {exc}"]

    raw_items = body.get("resultado") or []
    normalized = [_normalize_trf5_tipo_item(item) for item in raw_items if isinstance(item, dict)]
    return normalized, errors


def _find_existing_record(
    db: Session,
    source: Optional[PublicDataSource],
    normalized: Dict[str, Any],
) -> Optional[PublicCaseRecord]:
    if not source:
        return None

    external_id = normalized.get("external_id")
    process_number = normalized.get("process_number")

    if external_id:
        existing = (
            db.query(PublicCaseRecord)
            .filter(PublicCaseRecord.source_id == source.id)
            .filter(PublicCaseRecord.external_id == external_id)
            .first()
        )
        if existing:
            return existing

    if process_number:
        return (
            db.query(PublicCaseRecord)
            .filter(PublicCaseRecord.source_id == source.id)
            .filter(PublicCaseRecord.process_number == process_number)
            .first()
        )
    return None


def save_public_records(
    db: Session,
    records: List[Dict[str, Any]],
    source: Optional[PublicDataSource],
) -> int:
    changed = 0
    for normalized in records:
        existing = _find_existing_record(db, source, normalized)
        if existing:
            existing.external_id = normalized.get("external_id")
            existing.process_number = normalized.get("process_number")
            existing.tribunal = normalized.get("tribunal")
            existing.judge = normalized.get("judge")
            existing.action_type = normalized.get("action_type")
            existing.status = normalized.get("status")
            existing.outcome = normalized.get("outcome")
            existing.claim_value = normalized.get("claim_value")
            existing.filed_at = normalized.get("filed_at")
            existing.closed_at = normalized.get("closed_at")
            existing.duration_days = normalized.get("duration_days")
            existing.is_settlement = normalized.get("is_settlement")
            existing.is_success = normalized.get("is_success")
            existing.raw_data = normalized.get("raw_data")
            changed += 1
            continue

        record = PublicCaseRecord(
            source_id=source.id if source else None,
            external_id=normalized.get("external_id"),
            process_number=normalized.get("process_number"),
            tribunal=normalized.get("tribunal"),
            judge=normalized.get("judge"),
            action_type=normalized.get("action_type"),
            status=normalized.get("status"),
            outcome=normalized.get("outcome"),
            claim_value=normalized.get("claim_value"),
            filed_at=normalized.get("filed_at"),
            closed_at=normalized.get("closed_at"),
            duration_days=normalized.get("duration_days"),
            is_settlement=normalized.get("is_settlement"),
            is_success=normalized.get("is_success"),
            raw_data=normalized.get("raw_data"),
        )
        db.add(record)
        changed += 1
    return changed


def sync_enabled_sources(db: Session) -> List[PublicDataSyncResult]:
    sources = db.query(PublicDataSource).filter(PublicDataSource.enabled.is_(True)).all()
    results: List[PublicDataSyncResult] = []

    for source in sources:
        if source.base_url.startswith("manual://"):
            source.last_status = "manual_skip"
            source.last_error = None
            source.last_sync_at = datetime.now(timezone.utc)
            results.append(
                PublicDataSyncResult(
                    source_name=source.name,
                    fetched_items=0,
                    inserted_items=0,
                    errors=[],
                ),
            )
            continue

        normalized_records, errors = fetch_public_records_from_source(source)
        changed = 0
        if not errors:
            changed = save_public_records(db, normalized_records, source)
            source.last_status = "success"
            source.last_error = None
            source.last_sync_at = datetime.now(timezone.utc)
        else:
            source.last_status = "error"
            source.last_error = "; ".join(errors)[:800]
            source.last_sync_at = datetime.now(timezone.utc)

        results.append(
            PublicDataSyncResult(
                source_name=source.name,
                fetched_items=len(normalized_records),
                inserted_items=changed,
                errors=errors,
            ),
        )

    db.commit()
    return results
