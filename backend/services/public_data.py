import csv
import io
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx
from sqlalchemy.orm import Session

from backend.models import PublicCaseRecord, PublicDataSource
from backend.schemas.public_data import PublicDataSyncResult

TJDFT_JURISPRUDENCIA_URL = "https://jurisdf.tjdft.jus.br/api/v1/pesquisa"
TRF5_TRANSPARENCIA_TIPO_URL = "https://api-transparencia.trf5.jus.br/api/v1/documento/tipo"
DADOS_GOV_BR_BASE_URL = "https://dados.gov.br"
DADOS_GOV_BR_DATASET_LIST_URL = f"{DADOS_GOV_BR_BASE_URL}/dados/api/publico/conjuntos-dados"
DADOS_GOV_BR_AUTH_HEADER = "chave-api-dados-abertos"

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
    dados_gov_br_api_key = os.getenv("DADOS_GOV_BR_API_KEY", "").strip()
    dados_headers: Dict[str, str] = {}
    if dados_gov_br_api_key:
        dados_headers[DADOS_GOV_BR_AUTH_HEADER] = dados_gov_br_api_key

    defaults = [
        {
            "name": "tjdft_jurisprudencia",
            "base_url": TJDFT_JURISPRUDENCIA_URL,
            "tribunal": "TJDFT",
            "notes": "API pública oficial do TJDFT (jurisprudência).",
            "headers": {"Content-Type": "application/json"},
            "enabled": True,
        },
        {
            "name": "trf5_transparencia_documentos",
            "base_url": TRF5_TRANSPARENCIA_TIPO_URL,
            "tribunal": "TRF5",
            "notes": "API pública oficial de transparência do TRF5.",
            "headers": {},
            "enabled": True,
        },
        {
            "name": "dados_gov_br_catalogo_piloto",
            "base_url": DADOS_GOV_BR_DATASET_LIST_URL,
            "tribunal": "BR",
            "notes": (
                "Catálogo de dados.gov.br (piloto). "
                "Configure DADOS_GOV_BR_API_KEY para habilitar autenticação da API."
            ),
            "headers": dados_headers,
            "enabled": bool(dados_gov_br_api_key),
        },
    ]

    changed = False
    for item in defaults:
        existing = db.query(PublicDataSource).filter(PublicDataSource.name == item["name"]).first()
        if existing:
            # Keep existing source records, but refresh bootstrap defaults for
            # the dados.gov.br pilot source when token is provided later.
            if item["name"] == "dados_gov_br_catalogo_piloto":
                existing_headers = dict(existing.headers or {})
                if dados_gov_br_api_key and existing_headers.get(DADOS_GOV_BR_AUTH_HEADER) != dados_gov_br_api_key:
                    # Always refresh to the env token to avoid stale credentials
                    # persisted in the database.
                    existing_headers[DADOS_GOV_BR_AUTH_HEADER] = dados_gov_br_api_key
                    existing.headers = existing_headers
                    changed = True
                if dados_gov_br_api_key and not existing.enabled:
                    existing.enabled = True
                    changed = True
                if not existing.notes:
                    existing.notes = item["notes"]
                    changed = True
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


def _is_dados_gov_br_source(source: PublicDataSource) -> bool:
    base_url = (source.base_url or "").lower()
    return "dados.gov.br" in base_url and "/dados/api/publico/conjuntos-dados" in base_url


def _has_header_case_insensitive(headers: Dict[str, str], key: str) -> bool:
    key_lower = key.lower()
    return any((header_key or "").lower() == key_lower for header_key in headers)


def _build_source_headers(source: PublicDataSource) -> Dict[str, str]:
    headers: Dict[str, str] = dict(source.headers or {})
    if _is_dados_gov_br_source(source):
        token = os.getenv("DADOS_GOV_BR_API_KEY", "").strip()
        if token:
            # Environment token takes precedence over persisted headers.
            headers[DADOS_GOV_BR_AUTH_HEADER] = token
        elif not _has_header_case_insensitive(headers, DADOS_GOV_BR_AUTH_HEADER):
            # Keep compatibility with previously saved sources.
            pass
        headers.setdefault("Accept", "application/json")
    return headers


def _build_url_with_default_query(base_url: str, defaults: Dict[str, str]) -> str:
    parsed = urlparse(base_url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    for key, value in defaults.items():
        if key not in query and value:
            query[key] = [value]
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


def _extract_dataset_id_from_source_url(source_url: str) -> Optional[str]:
    parsed = urlparse(source_url)
    marker = "/dados/api/publico/conjuntos-dados/"
    if marker not in parsed.path:
        return None
    dataset_id = parsed.path.split(marker, 1)[1].split("/", 1)[0].strip()
    return dataset_id or None


def _fetch_json(
    url: str,
    headers: Dict[str, str],
    params: Optional[Dict[str, str]] = None,
) -> Tuple[Optional[Any], Optional[str]]:
    try:
        with httpx.Client(timeout=30.0, follow_redirects=False) as client:
            response = client.get(url, headers=headers, params=params)
    except Exception as exc:  # noqa: BLE001
        return None, f"Falha de conexão ao buscar {url}: {exc}"

    if response.status_code in {301, 302, 303, 307, 308}:
        location = (response.headers.get("location") or "").lower()
        if "signin" in location or "login" in location:
            return (
                None,
                "autenticação obrigatória. Configure o header "
                f"{DADOS_GOV_BR_AUTH_HEADER} na fonte ou a variável DADOS_GOV_BR_API_KEY.",
            )
        return None, f"redirecionamento inesperado ({response.status_code}) para {response.headers.get('location')}"

    if response.status_code >= 400:
        detail = (response.text or "").strip().replace("\n", " ")
        if len(detail) > 200:
            detail = f"{detail[:200]}..."
        return None, f"HTTP {response.status_code} ao buscar {url}: {detail}"

    try:
        return response.json(), None
    except ValueError:
        return None, f"resposta não é JSON em {url}"


def _extract_dados_resources(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    for key in ("recursos", "resourcesFormatado", "resourcesAcessoRapido", "resources"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _select_dados_resource(resources: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not resources:
        return None

    selected_resource_id = os.getenv("DADOS_GOV_BR_RESOURCE_ID", "").strip()
    if selected_resource_id:
        for resource in resources:
            if str(resource.get("id") or "").strip() == selected_resource_id:
                return resource

    def resource_score(resource: Dict[str, Any]) -> int:
        tipo = str(resource.get("tipo") or "").upper()
        formato = str(resource.get("formato") or resource.get("format") or "").lower()
        score = 0
        if tipo == "API":
            score += 4
        if "json" in formato:
            score += 3
        if tipo == "DADOS":
            score += 2
        if "csv" in formato:
            score += 1
        return score

    return max(resources, key=resource_score)


def _decode_text_payload(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _fetch_resource_rows(
    resource: Dict[str, Any],
    headers: Dict[str, str],
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    resource_url = str(resource.get("link") or resource.get("url") or "").strip()
    if not resource_url:
        return [], "recurso sem URL/link"

    try:
        with httpx.Client(timeout=45.0, follow_redirects=True) as client:
            response = client.get(resource_url, headers=headers)
    except Exception as exc:  # noqa: BLE001
        return [], f"falha ao buscar recurso piloto ({resource_url}): {exc}"

    if response.status_code >= 400:
        return [], f"HTTP {response.status_code} no recurso piloto ({resource_url})"

    max_items = max(1, int(os.getenv("DADOS_GOV_BR_PILOT_MAX_ITEMS", "50")))
    format_hint = str(resource.get("formato") or resource.get("format") or "").lower()
    content_type = str(response.headers.get("content-type") or "").lower()

    if "json" in format_hint or "json" in content_type:
        try:
            payload = response.json()
        except ValueError:
            return [], f"recurso piloto respondeu conteúdo inválido para JSON ({resource_url})"
        items = extract_items_from_payload(payload)
        return items[:max_items], None

    if "csv" in format_hint or "csv" in content_type or resource_url.lower().endswith(".csv"):
        text_payload = _decode_text_payload(response.content)
        reader = csv.DictReader(io.StringIO(text_payload))
        rows = [row for row in reader if isinstance(row, dict)]
        return rows[:max_items], None

    return [], "formato de recurso piloto não suportado no conector inicial (use JSON/API ou CSV)"


def _build_dados_metadata_record(
    source: PublicDataSource,
    dataset: Dict[str, Any],
    resource: Optional[Dict[str, Any]],
    resource_error: Optional[str],
    imported_rows: int,
) -> Dict[str, Any]:
    dataset_id = str(dataset.get("id") or "unknown")
    dataset_title = str(dataset.get("title") or dataset.get("nome") or "dataset_dados_gov_br")
    organization = dataset.get("nomeOrganizacao") or dataset.get("organizationTitle")
    dataset_updated = (
        dataset.get("ultimaAtualizacaoDados")
        or dataset.get("dataAtualizacao")
        or dataset.get("metadata_modified")
    )

    raw_data: Dict[str, Any] = {
        "source": "dados.gov.br",
        "dataset_id": dataset_id,
        "dataset_title": dataset_title,
        "organization": organization,
        "resource_id": resource.get("id") if resource else None,
        "resource_title": resource.get("titulo") if resource else None,
        "resource_format": resource.get("formato") if resource else None,
        "resource_url": (resource.get("link") or resource.get("url")) if resource else None,
        "imported_rows": imported_rows,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    if resource_error:
        raw_data["pilot_resource_error"] = resource_error

    return {
        "external_id": f"dadosgovbr-dataset-{dataset_id}",
        "process_number": f"DADOS-GOV-BR-{dataset_id}",
        "tribunal": source.tribunal or "BR",
        "judge": None,
        "action_type": dataset_title,
        "status": "catalogado",
        "outcome": str(organization) if organization else None,
        "claim_value": None,
        "filed_at": _to_datetime(dataset_updated),
        "closed_at": None,
        "duration_days": None,
        "is_settlement": None,
        "is_success": None,
        "raw_data": raw_data,
    }


def _normalize_dados_resource_row(
    source: PublicDataSource,
    dataset: Dict[str, Any],
    resource: Dict[str, Any],
    item: Dict[str, Any],
    index: int,
) -> Dict[str, Any]:
    dataset_id = str(dataset.get("id") or "unknown")
    resource_id = str(resource.get("id") or "unknown")
    dataset_title = str(dataset.get("title") or dataset.get("nome") or "dados.gov.br")
    resource_title = str(resource.get("titulo") or resource.get("name") or resource_id)
    resource_url = str(resource.get("link") or resource.get("url") or "")
    resource_format = str(resource.get("formato") or resource.get("format") or "")

    normalized = normalize_public_record(item, source)
    if not normalized.get("external_id"):
        normalized["external_id"] = f"dadosgovbr-{dataset_id}-{resource_id}-{index}"
    if not normalized.get("process_number"):
        normalized["process_number"] = f"DADOS-GOV-BR-{dataset_id}-{index}"
    if not normalized.get("tribunal"):
        normalized["tribunal"] = source.tribunal or "BR"
    if not normalized.get("action_type"):
        normalized["action_type"] = dataset_title
    if not normalized.get("status"):
        normalized["status"] = "importado"

    original_raw = normalized.get("raw_data")
    normalized["raw_data"] = {
        "source": "dados.gov.br",
        "dataset_id": dataset_id,
        "dataset_title": dataset_title,
        "resource_id": resource_id,
        "resource_title": resource_title,
        "resource_format": resource_format,
        "resource_url": resource_url,
        "row": original_raw,
    }
    return normalized


def fetch_dados_gov_br_records(source: PublicDataSource) -> Tuple[List[Dict[str, Any]], List[str]]:
    headers = _build_source_headers(source)

    dataset_id = os.getenv("DADOS_GOV_BR_DATASET_ID", "").strip() or _extract_dataset_id_from_source_url(source.base_url)
    dataset: Optional[Dict[str, Any]] = None

    if dataset_id:
        detail_url = f"{DADOS_GOV_BR_DATASET_LIST_URL}/{dataset_id}"
        dataset_payload, error = _fetch_json(detail_url, headers)
        if error:
            return [], [f"Falha dados.gov.br ({source.name}): {error}"]
        if not isinstance(dataset_payload, dict):
            return [], [f"Falha dados.gov.br ({source.name}): resposta inválida no detalhamento do dataset."]
        dataset = dataset_payload
    else:
        pilot_query = os.getenv("DADOS_GOV_BR_PILOT_QUERY", "justica").strip()
        pilot_page = os.getenv("DADOS_GOV_BR_PAGE", "1").strip() or "1"
        list_url = _build_url_with_default_query(
            source.base_url or DADOS_GOV_BR_DATASET_LIST_URL,
            {"pagina": pilot_page, "nomeConjuntoDados": pilot_query},
        )
        payload, error = _fetch_json(list_url, headers)
        if error:
            return [], [f"Falha dados.gov.br ({source.name}): {error}"]

        items = extract_items_from_payload(payload)
        if not items:
            return [], [f"Falha dados.gov.br ({source.name}): nenhum dataset retornado para o piloto."]
        chosen = items[0]
        chosen_id = str(chosen.get("id") or "").strip()
        if not chosen_id:
            return [], [f"Falha dados.gov.br ({source.name}): dataset sem identificador."]

        detail_url = f"{DADOS_GOV_BR_DATASET_LIST_URL}/{chosen_id}"
        detail_payload, detail_error = _fetch_json(detail_url, headers)
        if detail_error:
            return [], [f"Falha dados.gov.br ({source.name}): {detail_error}"]
        if not isinstance(detail_payload, dict):
            return [], [f"Falha dados.gov.br ({source.name}): resposta inválida no detalhamento do dataset."]
        dataset = detail_payload

    if not dataset:
        return [], [f"Falha dados.gov.br ({source.name}): não foi possível carregar o dataset."]

    resources = _extract_dados_resources(dataset)
    selected_resource = _select_dados_resource(resources)

    normalized_records: List[Dict[str, Any]] = []
    resource_error: Optional[str] = None
    imported_rows = 0

    if selected_resource:
        rows, resource_error = _fetch_resource_rows(selected_resource, headers)
        imported_rows = len(rows)
        for index, row in enumerate(rows, start=1):
            normalized_records.append(_normalize_dados_resource_row(source, dataset, selected_resource, row, index))

    normalized_records.insert(
        0,
        _build_dados_metadata_record(
            source=source,
            dataset=dataset,
            resource=selected_resource,
            resource_error=resource_error,
            imported_rows=imported_rows,
        ),
    )
    return normalized_records, []


def fetch_public_records_from_source(source: PublicDataSource) -> Tuple[List[Dict[str, Any]], List[str]]:
    errors: List[str] = []

    if source.base_url == TJDFT_JURISPRUDENCIA_URL:
        return fetch_tjdft_records(source)
    if source.base_url == TRF5_TRANSPARENCIA_TIPO_URL:
        return fetch_trf5_records(source)
    if _is_dados_gov_br_source(source):
        return fetch_dados_gov_br_records(source)

    try:
        headers = _build_source_headers(source)
        with httpx.Client(timeout=30.0) as client:
            response = client.get(source.base_url, headers=headers)
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
