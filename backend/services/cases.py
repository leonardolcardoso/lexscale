import json
import logging
import os
import re
import uuid
from dataclasses import dataclass
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
    if len(cleaned) < 4 or len(cleaned) > 120:
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
        "relator",
        "revisor",
        "imprimir",
        "gerar",
        "documento",
    }
    lowered_tokens = [_normalize_text_for_match(token) for token in tokens]
    if any(token in blocked for token in lowered_tokens):
        return False

    particles = {"de", "da", "do", "dos", "das", "e"}
    meaningful = [token for token in lowered_tokens if token not in particles]
    return len(meaningful) >= 2


# Partículas para manter em minúsculo na exibição do nome (ex.: "João da Silva")
_NAME_PARTICLES = frozenset({"de", "da", "do", "dos", "das", "e"})


def _normalize_text_for_authority_search(text: str) -> str:
    """Normaliza texto antes das regex: espaços Unicode -> espaço, para PDFs com caracteres especiais."""
    if not text:
        return text
    # Espaços Unicode comuns em PDFs (NBSP, thin space, etc.) -> espaço normal
    for char in ("\u00a0", "\u2003", "\u2002", "\u2009", "\u202f", "\u205f"):
        text = text.replace(char, " ")
    return unicode_normalize("NFC", text)


def _normalize_person_name_display(name: str) -> str:
    """Normaliza nome para exibição: DANIEL LACERDA PEREIRA -> Daniel Lacerda Pereira; partículas em minúsculo."""
    if not name or not name.strip():
        return name.strip()
    words = re.split(r"\s+", name.strip())
    result = []
    for w in words:
        if not w:
            continue
        low = w.lower()
        if low in _NAME_PARTICLES:
            result.append(low)
        else:
            # Primeira letra maiúscula, resto minúsculo (preserva hífens: Maria-Clara)
            result.append(w[0].upper() + (w[1:].lower() if len(w) > 1 else ""))
    return " ".join(result)


# Zonas onde o nome do juiz costuma aparecer (evita varrer o documento inteiro em arquivos grandes).
# Aplica-se a DIVERSOS tipos de documento: TJ, TRF, TRT, TST, TSE, PJe, e-Proc, PDFs escaneados, etc.
_JUDGE_HEAD_CHARS = 22_000   # início: capa, cabeçalho, decisão
_JUDGE_TAIL_CHARS = 20_000   # final: assinaturas (varia por sistema: PJe tem URLs no fim; TJ/TRT outros formatos)

# Referência para extração de autoridades (pesquisa em documentos judiciais brasileiros – múltiplos cenários):
# - Justiça Estadual (TJ): Juiz(a) de Direito, Juiz(a) da Xª Vara Cível/Criminal/Fazenda/Família,
#   Desembargador(a), Des., Relator(a), Rel., Revisor(a), Rev., Presidente, Pres., Corregedor.
# - Justiça Federal: Juiz(a) Federal (Substituto/Convocado/Titular), Juiz(a) da Xª Vara Federal,
#   Desembargador Federal, Ministro(a) (STF, STJ, TST, TSE).
# - Justiça do Trabalho: Juiz(a) do Trabalho, Vara do Trabalho, TRT.
# - Assinaturas: "Assinado por", "Assinado eletronicamente por" (PJe), "À disposição", "Dado e passado",
#   "Brasília/DF" + data + nome, Dr./Dra. + nome. Cargo e nome constam na assinatura eletrônica (e-Proc).
# - Abreviações padronizadas (STJ/STF/TRTs etc.): Min.=Ministro, Des.=Desembargador, Rel.=Relator, Rev.=Revisor.

# (regex, rótulo do cargo para exibir como "Cargo: Nome")
_JUDGE_PATTERNS: List[Tuple[str, str]] = [
    (r"(?:Ju[ií]z(?:a)?(?:\s+Federal)?(?:\s+Convocado)?(?:\s+Substituto)?(?:\s+Titular)?|Magistrad[oa]|Relator(?:a)?|Desembargador(?:a)?(?:\s+Federal)?|Ministro(?:a)?)\s*[:\-]\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})", "Autoridade"),
    (r"(?:Assinado\s+(?:eletronicamente\s+)?por|Assinado\s+por)\s*[:\-]\s*\n?\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})", "Assinatura"),
    (r"(?:Ju[ií]z(?:a)?\s+Federal)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})(?:\s*[,\.]|$)", "Juiz Federal"),
    (r"(?:Ju[ií]z(?:a)?\s+de\s+Direito)\s*[:\-]?\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})(?:\s*[,\.\n]|$)", "Juiz de Direito"),
    (r"(?:À\s+disposi[cç][aã]o|À\s+disposicao)[,\s]+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})", "À disposição"),
    (r"(?:Dado\s+e\s+passado|Lavrado\s+em)[^.]*?[,\s]+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})", "Autoridade"),
    (r"(?:Dr\.?|Dra\.?)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,6})\s*(?:\n|,|\s+Juiz|\s+Ju[ií]za)", "Autoridade"),
    (r"Juiz\s+(?:da|de)\s+\d+[ªa]?\s+Vara\s+Federal[^.]*?[:\-]\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})", "Juiz da Vara Federal"),
    (r"Juiz\s+(?:da|de)\s+\d+[ªa]?\s+Vara\s+(?:C[ií]vel|Criminal|Fazenda|Fam[ií]lia)[^.]*?[:\-]?\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})", "Juiz da Vara"),
    (r"(?:Ju[ií]z(?:a)?\s+do\s+Trabalho)\s*[:\-]?\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})(?:\s*[,\.\n]|$)", "Juiz do Trabalho"),
    (r"([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){2,5})\s*\n\s*Ju[ií]z\s+Federal(?:\s+Substituto)?(?:\s+da\s+\d+[ªa]?\s+Vara)?", "Juiz Federal (1º grau)"),
    (r"([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){2,5})\s*\n\s*Ju[ií]z(?:a)?\s+de\s+Direito(?:\s+da\s+\d+[ªa]?\s+Vara)?", "Juiz de Direito (1º grau)"),
    # Tribunal (TRF/TJ): "Desembargador Federal NAME" ou "Desembargador Federal\nNAME\nRelator" (PJe e outros)
    (r"Desembargador\s+Federal\s*\n\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*){1,6})\s*(?:\n|\r|$)", "Desembargador Federal / Relator"),
    (r"Desembargador\s+Federal\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*){1,6}?)\s*(?:\n|\r|\s*Relator|$)", "Desembargador Federal / Relator"),
    (r"Desembargador(?:a)?\s+(?!Federal)([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*){1,6})\s*(?:\n|\r|\s*Rel\.|$)", "Desembargador"),
    (r"Des\.\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*){1,6})(?:\s*[,\.\n]|\s+-\s+Rel\.|$)", "Desembargador"),
    (r"Min\.\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*){1,6})(?:\s*[,\.\n]|\s+-\s+Rel\.|$)", "Ministro"),
    (r"(?:Rel\.|Revisor)\s+[:\-]?\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,6})", "Relator / Revisor"),
    (r"Juiz\s+(?:da|de)\s+(?:da\s+)?\d+[ªa]?\s+(?:C[aâ]mara|Turma)[^.]*?[:\-]\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,8})", "Juiz da Câmara / Turma"),
    (r"Presidente\s*[:\-]\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*(?:\s+(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*|de|da|do|dos|das|e)){1,6})", "Presidente"),
]

# Cargos que indicam autoridade responsável pelo processo (decisão do tribunal).
# Cobrem 1º grau (juiz da causa) e 2º grau / tribunais (relator, desembargador, ministro).
_PRIMARY_ROLES_FROM_TAIL = frozenset({"Desembargador Federal / Relator", "Assinatura", "Desembargador", "Ministro", "Relator / Revisor"})
_PRIMARY_ROLES_FROM_HEAD = frozenset({
    "Juiz Federal (1º grau)", "Juiz de Direito (1º grau)", "Juiz da Vara Federal", "Juiz da Vara",
    "Juiz Federal", "Juiz de Direito", "Juiz do Trabalho",
})


def _extract_authorities(text: str) -> Tuple[Optional[str], Optional[str]]:
    """Retorna (primary_name, display_string). primary = autoridade responsável pelo processo (para IA/filtros)."""
    if not text or not text.strip():
        return None, None
    text = _normalize_text_for_authority_search(text)

    collected: List[Tuple[str, str, bool]] = []  # (role_label, name, from_tail)

    def search_in(zone: str, from_tail: bool) -> None:
        for pattern, role_label in _JUDGE_PATTERNS:
            for found in re.finditer(pattern, zone, flags=re.IGNORECASE | re.MULTILINE):
                candidate = re.sub(r"\s+", " ", found.group(1)).strip(" .,:;-")
                # evita que "Relator" / "Revisor" venham colados ao nome
                for suffix in (" Relator", " Revisor", " Relatora", " Revisora"):
                    if candidate.endswith(suffix):
                        candidate = candidate[: -len(suffix)].strip()
                        break
                if _looks_like_person_name(candidate):
                    collected.append((role_label, _normalize_person_name_display(candidate)[:120], from_tail))
                    break

    head = text[:_JUDGE_HEAD_CHARS]
    search_in(head, from_tail=False)
    if len(text) > _JUDGE_TAIL_CHARS:
        tail = text[-_JUDGE_TAIL_CHARS:]
        search_in(tail, from_tail=True)

    # Fallback: se não achou nada no tail (ex.: PDF com muitas URLs no fim), usa um tail maior
    if not collected and len(text) > _JUDGE_TAIL_CHARS:
        larger_tail_size = min(len(text), 40_000)
        if larger_tail_size > _JUDGE_TAIL_CHARS:
            search_in(text[-larger_tail_size:], from_tail=True)
    # Último recurso: em documentos com estrutura atípica (tail muito longo, assinatura no meio, etc.),
    # procura em TODO o texto pelos padrões mais comuns em qualquer ramo (TJ, TRF, TRT, PJe, e-Proc).
    _FALLBACK_FULLTEXT_ROLES = frozenset({
        "Assinatura", "Desembargador Federal / Relator", "À disposição", "Desembargador",
        "Juiz Federal (1º grau)", "Juiz de Direito (1º grau)", "Juiz Federal", "Juiz de Direito",
        "Juiz da Vara Federal", "Juiz da Vara", "Juiz do Trabalho", "Ministro", "Relator / Revisor",
    })
    if not collected:
        for pattern, role_label in _JUDGE_PATTERNS:
            if role_label not in _FALLBACK_FULLTEXT_ROLES:
                continue
            for found in re.finditer(pattern, text, flags=re.IGNORECASE | re.MULTILINE):
                candidate = re.sub(r"\s+", " ", found.group(1)).strip(" .,:;-")
                for suffix in (" Relator", " Revisor", " Relatora", " Revisora"):
                    if candidate.endswith(suffix):
                        candidate = candidate[: -len(suffix)].strip()
                        break
                if _looks_like_person_name(candidate):
                    collected.append((role_label, _normalize_person_name_display(candidate)[:120], True))
                    break

    # Último recurso: padrão bem permissivo para "Assinado ... por : NOME" (variações de espaço/encoding)
    if not collected:
        loose = re.search(
            r"(?:Assinado|assinado)\s+(?:eletronicamente\s+)?por\s*[:\-]\s*[\r\n]*\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ\'\.\-]*(?:\s+[A-ZÀ-Ýa-zÀ-ÿ\'\.\-]+){1,10})",
            text,
            flags=re.IGNORECASE | re.MULTILINE,
        )
        if loose:
            candidate = re.sub(r"\s+", " ", loose.group(1)).strip(" .,:;-")
            words = candidate.split()
            if len(words) > 8:
                candidate = " ".join(words[:8])
            if _looks_like_person_name(candidate):
                collected.append(("Assinatura", _normalize_person_name_display(candidate)[:120], True))
        if not collected:
            loose2 = re.search(
                r"Desembargador\s+Federal\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ\'\.\-]+(?:\s+[A-ZÀ-Ýa-zÀ-ÿ\'\.\-]+){1,6})",
                text,
                flags=re.IGNORECASE,
            )
            if loose2:
                candidate = re.sub(r"\s+", " ", loose2.group(1)).strip(" .,:;-")
                for suffix in (" Relator", " Revisor"):
                    if candidate.endswith(suffix):
                        candidate = candidate[: -len(suffix)].strip()
                        break
                if _looks_like_person_name(candidate):
                    collected.append(("Desembargador Federal / Relator", _normalize_person_name_display(candidate)[:120], True))

    # Fallback por busca literal (sem regex): quando o PDF tem encoding/forma diferente
    if not collected:
        text_lower = text.lower()
        # "Assinado eletronicamente por: NOME" ou "Assinado por: NOME"
        for marker in ("assinado eletronicamente por", "assinado por"):
            idx = text_lower.find(marker)
            if idx == -1:
                continue
            chunk = text[idx + len(marker) : idx + len(marker) + 120]
            colon = chunk.find(":")
            if colon != -1:
                raw_name = chunk[colon + 1 :].split("\n")[0].split("\r")[0].strip()
                # Remove data no formato dd/mm/aaaa no fim
                raw_name = re.sub(r"\s*\d{1,2}/\d{1,2}/\d{4}.*$", "", raw_name).strip()
                candidate = re.sub(r"\s+", " ", raw_name).strip(" .,:;-")[:80]
                words = candidate.split()
                if len(words) > 8:
                    candidate = " ".join(words[:8])
                if candidate and _looks_like_person_name(candidate):
                    collected.append(("Assinatura", _normalize_person_name_display(candidate)[:120], True))
                    break
        if not collected:
            idx = text_lower.find("desembargador federal")
            if idx != -1:
                skip = len("desembargador federal")
                after_federal = text[idx + skip : idx + skip + 200].strip()
                if after_federal:
                    first_line = after_federal.split("\n")[0].split("\r")[0].strip()
                    first_line = re.sub(r"\s*Relator\s*$", "", first_line, flags=re.IGNORECASE).strip()
                    candidate = re.sub(r"\s+", " ", first_line).strip(" .,:;-")[:80]
                    words = candidate.split()
                    if len(words) > 8:
                        candidate = " ".join(words[:8])
                    if candidate and _looks_like_person_name(candidate):
                        collected.append(("Desembargador Federal / Relator", _normalize_person_name_display(candidate)[:120], True))

    if not collected:
        return None, None

    # Exibição: "Juiz: Daniel Lacerda Pereira" (nomes já normalizados acima)
    display_parts = [f"{r}: {n}" for r, n, _ in collected]
    display_string = "; ".join(display_parts)

    primary_name = None
    for role_label, name, from_tail in collected:
        if from_tail and role_label in _PRIMARY_ROLES_FROM_TAIL:
            primary_name = name
            break
    if primary_name is None:
        for role_label, name, from_tail in collected:
            if not from_tail and role_label in _PRIMARY_ROLES_FROM_HEAD:
                primary_name = name
                break
    if primary_name is None:
        primary_name = collected[0][1]

    return primary_name, display_string


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

    primary_judge, authority_display = _extract_authorities(text)
    judge_match = judge or primary_judge
    # Se temos texto de autoridades mas primary ficou None, usa o primeiro nome do display (ex.: "Des.: João Silva" -> João Silva)
    if authority_display and not judge_match and ": " in authority_display:
        first_part = authority_display.split(";")[0].strip()
        if ": " in first_part:
            judge_match = first_part.split(": ", 1)[1].strip()[:120]
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
        authority_display=authority_display,
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
    user_party: Optional[str] = None,
    public_context: Optional[Dict[str, Any]] = None,
) -> Tuple[CaseExtractionPayload, CaseScoresPayload]:
    model = os.getenv("OPENAI_CASE_ANALYSIS_MODEL", "").strip() or os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    temperature = _safe_float(os.getenv("CASE_AI_TEMPERATURE", "0"), 0.0)
    temperature = max(0.0, min(1.2, temperature))
    max_output_tokens = max(1200, int(_safe_float(os.getenv("CASE_AI_MAX_OUTPUT_TOKENS", "2200"), 2200)))
    document_context = _build_document_context_with_ai(
        client=client,
        model=model,
        text=text,
        db=db,
        user_id=user_id,
        usage_operation=usage_operation,
    )
    system_prompt = (
        "Você é um analista jurídico no Brasil com foco em precisão factual. "
        "Extraia dados estruturados, compare com contexto externo quando fornecido e retorne APENAS JSON válido."
    )
    perspective_instruction = ""
    if user_party in ("author", "defendant"):
        side = "Autor" if user_party == "author" else "Réu"
        perspective_instruction = (
            f"\n\nPerspectiva: o usuário que enviou este processo atua como **{side}**. "
            "O campo 'success_probability' deve ser a probabilidade de vitória do AUTOR da ação (0 a 1). "
            f"No campo 'ai_summary', quando falar de êxito ou resultado, deixe explícito se o cenário é favorável ao usuário (que é {side}) ou à contraparte."
        )
    public_context_records = []
    public_context_summary: Dict[str, Any] = {}
    if isinstance(public_context, dict):
        maybe_records = public_context.get("records")
        if isinstance(maybe_records, list):
            public_context_records = [item for item in maybe_records if isinstance(item, dict)][:10]
        maybe_summary = public_context.get("summary")
        if isinstance(maybe_summary, dict):
            public_context_summary = maybe_summary
    public_context_block = ""
    if public_context_records or public_context_summary:
        public_context_block = (
            "\n\nContexto externo sincronizado (bases públicas já carregadas no sistema):\n"
            f"Resumo: {json.dumps(public_context_summary, ensure_ascii=False)}\n"
            f"Amostra de registros: {json.dumps(public_context_records, ensure_ascii=False)}\n"
            "Regra: use esse contexto para benchmark e comparação probabilística, sem afirmar certeza absoluta."
        )
    user_prompt = (
        "Analise o documento judicial abaixo e responda com JSON no formato:\n"
        "{\n"
        '  "extraction": {\n'
        '    "process_number": "...", "title": "...", "tribunal": "...", "judge": "...",\n'
        '    "action_type": "...", "claim_value": 0,\n'
        '    "status": "...", "parties": {"author": "...", "defendant": "..."},\n'
        '    "key_facts": ["..."], "deadlines": [{"label":"...", "due_date":"YYYY-MM-DD", "severity":"baixa|media|alta"}], "authority_display":"..."\n'
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
        "Regra: success_probability = probabilidade de vitória do AUTOR da ação (valor entre 0 e 1)."
        + perspective_instruction
        + "\n\n"
        "Regra para o campo 'judge': indique APENAS o nome da autoridade RESPONSÁVEL pelo processo. "
        "Se houver várias autoridades (ex.: juiz de 1º grau e desembargador relator), escolha a que de fato "
        "decide o processo neste documento: em decisão de tribunal, use o relator/desembargador que assina; "
        "em sentença de 1º grau, use o juiz que profere a sentença.\n"
        "Referência (como autoridades costumam aparecer): Justiça Estadual: Juiz(a) de Direito, Juiz(a) da Xª Vara Cível/Criminal/Fazenda/Família, "
        "Desembargador(a), Relator(a), Revisor(a), Presidente (turma/câmara), Corregedor. Justiça Federal: Juiz(a) Federal (Substituto/Convocado/Titular), "
        "Desembargador Federal, Ministro (STF/STJ/TST). Assinaturas: 'Assinado por', 'Assinado eletronicamente por', 'À disposição', 'Dado e passado'. "
        "Abreviações: Min.=Ministro, Des.=Desembargador, Rel.=Relator, Rev.=Revisor.\n\n"
        f"Contexto do upload: arquivo={filename}, process_number={process_number}, tribunal={tribunal}, juiz={judge}, tipo_acao={action_type}, claim_value={claim_value}\n\n"
        f"Contexto de cobertura do documento: mode={document_context.mode}, blocos={document_context.chunk_count}\n"
        + public_context_block
        + "\n\nDocumento/Mapa consolidado:\n"
        + document_context.text
    )

    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_output_tokens=max_output_tokens,
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

    raw_claim = extraction_payload.get("claim_value")
    claim_value_final = claim_value
    if raw_claim is not None:
        parsed_claim = _safe_float(raw_claim, -1.0)
        if parsed_claim > 0:
            claim_value_final = parsed_claim

    extraction = CaseExtractionPayload(
        process_number=extraction_payload.get("process_number") or process_number,
        title=extraction_payload.get("title"),
        tribunal=extraction_payload.get("tribunal") or tribunal,
        judge=extraction_payload.get("judge") or judge,
        action_type=extraction_payload.get("action_type") or action_type,
        claim_value=claim_value_final,
        status=extraction_payload.get("status"),
        parties=extraction_payload.get("parties") or {},
        key_facts=extraction_payload.get("key_facts") or [],
        deadlines=deadlines,
        authority_display=extraction_payload.get("authority_display"),
    )

    success_probability = _safe_float(scores_payload.get("success_probability"), 0.68)
    settlement_probability = _safe_float(scores_payload.get("settlement_probability"), 0.52)
    expected_decision_months = _safe_float(scores_payload.get("expected_decision_months"), 6.0)
    risk_score = _safe_float(scores_payload.get("risk_score"), 45.0)
    complexity_score = _safe_float(scores_payload.get("complexity_score"), 50.0)

    if success_probability > 1:
        success_probability /= 100.0
    if settlement_probability > 1:
        settlement_probability /= 100.0
    success_probability = max(0.0, min(1.0, success_probability))
    settlement_probability = max(0.0, min(1.0, settlement_probability))
    expected_decision_months = max(0.0, expected_decision_months)
    if 0.0 <= risk_score <= 1.0:
        risk_score *= 100.0
    if 0.0 <= complexity_score <= 1.0:
        complexity_score *= 100.0
    risk_score = max(0.0, min(100.0, risk_score))
    complexity_score = max(0.0, min(100.0, complexity_score))
    ai_summary = str(scores_payload.get("ai_summary") or "").strip()
    if not ai_summary:
        ai_summary = (
            f"Análise consolidada em {document_context.chunk_count} bloco(s): "
            f"êxito do autor em {round(success_probability * 100)}%, "
            f"acordo em {round(settlement_probability * 100)}%, "
            f"tempo estimado de {expected_decision_months:.1f} meses."
        )

    scores = CaseScoresPayload(
        success_probability=round(success_probability, 4),
        settlement_probability=round(settlement_probability, 4),
        expected_decision_months=round(expected_decision_months, 2),
        risk_score=round(risk_score, 2),
        complexity_score=round(complexity_score, 2),
        ai_summary=ai_summary[:4000],
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


def _is_truthy(value: str) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _safe_float(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if parsed != parsed:  # NaN
        return default
    if parsed in {float("inf"), float("-inf")}:
        return default
    return parsed


def _chunk_text(text: str, chunk_size: int, overlap: int, max_chunks: int) -> List[str]:
    if not text or not text.strip():
        return []

    size = max(4000, int(chunk_size))
    overlap_safe = max(0, min(int(overlap), size // 3))
    step = max(1200, size - overlap_safe)
    chunks: List[str] = []
    cursor = 0

    while cursor < len(text) and len(chunks) < max(1, int(max_chunks)):
        end = min(len(text), cursor + size)
        chunk = text[cursor:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        cursor += step

    return chunks


@dataclass
class _DocumentContext:
    text: str
    chunk_count: int
    mode: str


def _build_document_context_with_ai(
    client: OpenAI,
    model: str,
    text: str,
    db: Optional[Session],
    user_id: Optional[UUID],
    usage_operation: str,
) -> _DocumentContext:
    chunk_size = int(os.getenv("CASE_AI_CHUNK_SIZE", "14000"))
    chunk_overlap = int(os.getenv("CASE_AI_CHUNK_OVERLAP", "1200"))
    max_chunks = int(os.getenv("CASE_AI_MAX_CHUNKS", "8"))
    full_document_enabled = _is_truthy(os.getenv("CASE_AI_FULL_DOCUMENT_ENABLED", "1"))

    if not text:
        return _DocumentContext(text="", chunk_count=0, mode="empty")

    chunks = _chunk_text(text=text, chunk_size=chunk_size, overlap=chunk_overlap, max_chunks=max_chunks)
    if not full_document_enabled or len(chunks) <= 1:
        return _DocumentContext(text=text[:18000], chunk_count=max(1, len(chunks)), mode="single_pass")

    summary_model = os.getenv("OPENAI_CASE_SUMMARY_MODEL", "").strip() or model
    summaries: List[str] = []
    for idx, chunk in enumerate(chunks, start=1):
        try:
            chunk_prompt = (
                "Você está mapeando um processo judicial grande em blocos. "
                "Resuma este bloco em JSON no formato:\n"
                '{'
                '"key_facts": ["..."], '
                '"deadlines": ["..."], '
                '"authorities": ["..."], '
                '"amounts": ["..."], '
                '"signals": ["..."]'
                "}\n"
                "Regras: máximo 8 itens por lista; linguagem objetiva; sem inventar dados.\n\n"
                f"Bloco {idx}/{len(chunks)}:\n{chunk}"
            )
            response = client.responses.create(
                model=summary_model,
                input=[
                    {"role": "system", "content": "Você resume blocos de documentos jurídicos para análise forense."},
                    {"role": "user", "content": chunk_prompt},
                ],
                temperature=0.0,
                max_output_tokens=420,
            )
            record_openai_usage(
                db=db,
                logger=logger,
                operation=f"{usage_operation}.chunk_summary",
                model=summary_model,
                usage=getattr(response, "usage", None),
                user_id=user_id,
                context={"feature": "case_enrichment_chunk_summary", "chunk_index": idx, "chunk_total": len(chunks)},
            )
            summary_text = (_extract_response_text(response) or "").strip()
        except Exception:
            summary_text = ""
        if not summary_text:
            local_facts = _extract_key_facts(chunk[:8000])
            summary_text = json.dumps(
                {
                    "key_facts": local_facts,
                    "deadlines": [deadline.label for deadline in _extract_deadlines_heuristic(chunk[:8000])],
                    "authorities": [],
                    "amounts": re.findall(MONEY_REGEX, chunk[:8000])[:5],
                    "signals": ["fallback_local_summary"],
                },
                ensure_ascii=False,
            )
        summaries.append(f"[bloco {idx}/{len(chunks)}]\n{summary_text[:1800]}")

    head = text[:3500].strip()
    tail = text[-3500:].strip() if len(text) > 7000 else ""
    assembled = (
        "MAPA CONSOLIDADO DO DOCUMENTO (cobertura por blocos):\n"
        + "\n\n".join(summaries)
        + "\n\nTRECHO INICIAL DO DOCUMENTO:\n"
        + head
    )
    if tail:
        assembled += "\n\nTRECHO FINAL DO DOCUMENTO:\n" + tail

    return _DocumentContext(text=assembled[:120000], chunk_count=len(chunks), mode="map_reduce")
