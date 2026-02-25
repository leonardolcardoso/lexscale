import hashlib
import logging
import os
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID

from sqlalchemy import case, func, text
from sqlalchemy.orm import Session

from backend.db import SessionLocal
from backend.models import ProcessCase, StrategicAlert, User
from backend.schemas.dashboard import AlertCountData, AlertasData, DetailedAlertData
from backend.services.dashboard import build_dashboard_data

ALERT_CATEGORY_ORDER: Dict[str, int] = {
    "critical": 0,
    "warning": 1,
    "opportunity": 2,
    "info": 3,
}

DEFAULT_FILTER_SCOPE = (
    "Todos os Tribunais",
    "Todos os Juízes",
    "Todos os Tipos",
    "Todos os Valores",
    "Últimos 6 meses",
)

DEFAULT_FILTER_SCOPE_EXTENDED = (
    "Todos os Tribunais",
    "Todos os Juízes",
    "Todos os Tipos",
    "Todos os Valores",
    "Últimos 12 meses",
)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(1, value)


SCAN_INTERVAL_MINUTES = _env_int("STRATEGIC_ALERT_SCAN_INTERVAL_MINUTES", 30)
MAX_SCAN_SCOPES = _env_int("STRATEGIC_ALERT_MAX_SCOPES", 8)
COOLDOWN_CRITICAL_MINUTES = _env_int("STRATEGIC_ALERT_COOLDOWN_CRITICAL_MINUTES", 60)
COOLDOWN_WARNING_MINUTES = _env_int("STRATEGIC_ALERT_COOLDOWN_WARNING_MINUTES", 180)
COOLDOWN_OPPORTUNITY_MINUTES = _env_int("STRATEGIC_ALERT_COOLDOWN_OPPORTUNITY_MINUTES", 240)
COOLDOWN_INFO_MINUTES = _env_int("STRATEGIC_ALERT_COOLDOWN_INFO_MINUTES", 360)
SCAN_ADVISORY_LOCK_KEY = _env_int("STRATEGIC_ALERT_SCAN_LOCK_KEY", 91350231)


@dataclass(frozen=True)
class ScanScope:
    tribunal: str
    juiz: str
    tipo_acao: str
    faixa_valor: str
    periodo: str

    def as_tuple(self) -> Tuple[str, str, str, str, str]:
        return (self.tribunal, self.juiz, self.tipo_acao, self.faixa_valor, self.periodo)

    def label(self) -> str:
        return f"{self.tribunal} | {self.tipo_acao} | {self.periodo}"


@dataclass
class AlertCandidate:
    category: str
    title: str
    description: str
    fingerprint: str
    contexts: Set[str] = field(default_factory=set)


def _normalize_category(raw: str) -> str:
    normalized = (raw or "").strip().lower()
    if "crit" in normalized:
        return "critical"
    if "warn" in normalized or "aten" in normalized:
        return "warning"
    if "oppor" in normalized or "oportun" in normalized:
        return "opportunity"
    return "info"


def _category_rank(category: str) -> int:
    return ALERT_CATEGORY_ORDER.get(category, 999)


def _cooldown_for_category(category: str) -> timedelta:
    if category == "critical":
        return timedelta(minutes=COOLDOWN_CRITICAL_MINUTES)
    if category == "warning":
        return timedelta(minutes=COOLDOWN_WARNING_MINUTES)
    if category == "opportunity":
        return timedelta(minutes=COOLDOWN_OPPORTUNITY_MINUTES)
    return timedelta(minutes=COOLDOWN_INFO_MINUTES)


def _fingerprint(category: str, title: str) -> str:
    normalized = f"{category.strip().lower()}|{title.strip().lower()}"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _safe_dt(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _format_relative(now: datetime, value: Optional[datetime]) -> str:
    if value is None:
        return "agora"
    dt = _safe_dt(value)
    if dt is None:
        return "agora"
    delta_seconds = max(0, int((now - dt).total_seconds()))
    if delta_seconds < 60:
        return "agora"
    if delta_seconds < 3600:
        minutes = delta_seconds // 60
        return f"há {minutes} min"
    if delta_seconds < 86400:
        hours = delta_seconds // 3600
        return f"há {hours}h"
    days = delta_seconds // 86400
    return f"há {days} dia(s)"


def _unique_non_empty(values: Sequence[Optional[str]], limit: int) -> List[str]:
    cleaned = [str(item).strip() for item in values if item and str(item).strip()]
    if not cleaned:
        return []
    ranking = Counter(cleaned).most_common(limit)
    return [item for item, _count in ranking]


def _build_scan_scopes(db: Session, user_id: UUID) -> List[ScanScope]:
    rows = (
        db.query(ProcessCase.tribunal, ProcessCase.action_type)
        .filter(ProcessCase.user_id == user_id)
        .order_by(ProcessCase.created_at.desc())
        .limit(400)
        .all()
    )

    top_tribunals = _unique_non_empty([row[0] for row in rows], limit=2)
    top_actions = _unique_non_empty([row[1] for row in rows], limit=2)

    candidate_scopes: List[ScanScope] = [
        ScanScope(*DEFAULT_FILTER_SCOPE),
        ScanScope(*DEFAULT_FILTER_SCOPE_EXTENDED),
    ]

    for tribunal in top_tribunals:
        candidate_scopes.append(
            ScanScope(tribunal, "Todos os Juízes", "Todos os Tipos", "Todos os Valores", "Últimos 6 meses"),
        )
    for action in top_actions:
        candidate_scopes.append(
            ScanScope("Todos os Tribunais", "Todos os Juízes", action, "Todos os Valores", "Últimos 6 meses"),
        )
    for tribunal in top_tribunals:
        for action in top_actions:
            candidate_scopes.append(
                ScanScope(tribunal, "Todos os Juízes", action, "Todos os Valores", "Últimos 6 meses"),
            )

    deduped: List[ScanScope] = []
    seen: Set[Tuple[str, str, str, str, str]] = set()
    for scope in candidate_scopes:
        key = scope.as_tuple()
        if key in seen:
            continue
        deduped.append(scope)
        seen.add(key)
        if len(deduped) >= MAX_SCAN_SCOPES:
            break
    return deduped


def _collect_candidates_for_user(db: Session, user_id: UUID) -> List[AlertCandidate]:
    candidate_map: Dict[str, AlertCandidate] = {}
    scopes = _build_scan_scopes(db, user_id)
    for scope in scopes:
        dashboard = build_dashboard_data(
            db=db,
            user_id=user_id,
            tribunal=scope.tribunal,
            juiz=scope.juiz,
            tipo_acao=scope.tipo_acao,
            faixa_valor=scope.faixa_valor,
            periodo=scope.periodo,
            ai_client=None,
        )
        for detail in dashboard.alertas.details:
            category = _normalize_category(detail.type)
            fingerprint = _fingerprint(category, detail.title)
            existing = candidate_map.get(fingerprint)
            if existing is None:
                existing = AlertCandidate(
                    category=category,
                    title=detail.title,
                    description=detail.desc,
                    fingerprint=fingerprint,
                )
                candidate_map[fingerprint] = existing

            # Keep most severe category and the longest description when merged.
            if _category_rank(category) < _category_rank(existing.category):
                existing.category = category
            if len((detail.desc or "").strip()) > len((existing.description or "").strip()):
                existing.description = detail.desc

            existing.contexts.add(scope.label())

    return sorted(candidate_map.values(), key=lambda item: (_category_rank(item.category), item.title.lower()))


def scan_user_now(db: Session, user_id: UUID, now: Optional[datetime] = None) -> Dict[str, int]:
    current_now = now or datetime.now(timezone.utc)
    candidates = _collect_candidates_for_user(db, user_id)
    fingerprints = [item.fingerprint for item in candidates]

    existing_by_fingerprint: Dict[str, StrategicAlert] = {}
    if fingerprints:
        rows = (
            db.query(StrategicAlert)
            .filter(
                StrategicAlert.user_id == user_id,
                StrategicAlert.fingerprint.in_(fingerprints),
            )
            .all()
        )
        existing_by_fingerprint = {item.fingerprint: item for item in rows}

    created = 0
    updated = 0
    notified = 0

    for candidate in candidates:
        alert = existing_by_fingerprint.get(candidate.fingerprint)
        cooldown = _cooldown_for_category(candidate.category)
        contexts = sorted(candidate.contexts)

        if alert is None:
            db.add(
                StrategicAlert(
                    user_id=user_id,
                    category=candidate.category,
                    title=candidate.title,
                    description=candidate.description,
                    fingerprint=candidate.fingerprint,
                    status="new",
                    source="strategic_scan",
                    occurrence_count=1,
                    contexts=contexts,
                    first_detected_at=current_now,
                    last_detected_at=current_now,
                    notified_at=current_now,
                ),
            )
            created += 1
            notified += 1
            continue

        alert.category = candidate.category
        alert.title = candidate.title
        alert.description = candidate.description
        alert.source = "strategic_scan"
        alert.contexts = contexts
        alert.last_detected_at = current_now
        alert.occurrence_count = int(alert.occurrence_count or 0) + 1

        should_notify = False
        if alert.notified_at is None:
            should_notify = True
        else:
            previous_notified = _safe_dt(alert.notified_at) or current_now
            should_notify = previous_notified + cooldown <= current_now

        if should_notify:
            alert.status = "new"
            alert.notified_at = current_now
            alert.read_at = None
            alert.dismissed_at = None
            notified += 1

        updated += 1

    db.commit()
    return {
        "scanned": len(candidates),
        "created": created,
        "updated": updated,
        "notified": notified,
    }


def scan_all_users_once(logger: Optional[logging.Logger] = None) -> Dict[str, int]:
    log = logger or logging.getLogger(__name__)
    summary = {"users": 0, "scanned": 0, "created": 0, "updated": 0, "notified": 0, "errors": 0, "skipped": 0}

    with SessionLocal() as db:
        lock_acquired = bool(
            db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": SCAN_ADVISORY_LOCK_KEY}).scalar(),
        )
        if not lock_acquired:
            summary["skipped"] = 1
            return summary

        user_ids = [row[0] for row in db.query(User.id).all()]
        summary["users"] = len(user_ids)

        try:
            for user_id in user_ids:
                try:
                    result = scan_user_now(db, user_id=user_id)
                    summary["scanned"] += result["scanned"]
                    summary["created"] += result["created"]
                    summary["updated"] += result["updated"]
                    summary["notified"] += result["notified"]
                except Exception:  # noqa: BLE001
                    db.rollback()
                    summary["errors"] += 1
                    log.exception("Falha ao gerar alertas estratégicos para user_id=%s", user_id)
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": SCAN_ADVISORY_LOCK_KEY})
            db.commit()

    return summary


def _alert_order_expr():
    return case(
        (StrategicAlert.status == "new", 0),
        (StrategicAlert.status == "read", 1),
        else_=2,
    )


def list_user_alerts(
    db: Session,
    user_id: UUID,
    status: str = "active",
    limit: int = 50,
) -> List[StrategicAlert]:
    query = db.query(StrategicAlert).filter(StrategicAlert.user_id == user_id)

    normalized_status = (status or "active").strip().lower()
    if normalized_status == "new":
        query = query.filter(StrategicAlert.status == "new")
    elif normalized_status == "read":
        query = query.filter(StrategicAlert.status == "read")
    elif normalized_status == "dismissed":
        query = query.filter(StrategicAlert.status == "dismissed")
    elif normalized_status == "active":
        query = query.filter(StrategicAlert.status.in_(["new", "read"]))

    return (
        query.order_by(_alert_order_expr(), StrategicAlert.last_detected_at.desc(), StrategicAlert.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )


def build_dashboard_alerts_from_store(
    db: Session,
    user_id: UUID,
    detail_limit: int = 25,
) -> Optional[AlertasData]:
    active_alerts = list_user_alerts(db=db, user_id=user_id, status="active", limit=detail_limit)
    if not active_alerts:
        return None

    count_rows = (
        db.query(StrategicAlert.category, func.count(StrategicAlert.id))
        .filter(
            StrategicAlert.user_id == user_id,
            StrategicAlert.status.in_(["new", "read"]),
        )
        .group_by(StrategicAlert.category)
        .all()
    )
    counts_map = {str(category): int(count) for category, count in count_rows}
    now = datetime.now(timezone.utc)

    details = [
        DetailedAlertData(
            type=_normalize_category(item.category),
            title=item.title,
            time=_format_relative(now, item.notified_at or item.last_detected_at or item.created_at),
            desc=item.description,
        )
        for item in active_alerts
    ]

    counts = [
        AlertCountData(count=counts_map.get("critical", 0), label="CRITICOS", color="red"),
        AlertCountData(count=counts_map.get("warning", 0), label="ATENCAO", color="orange"),
        AlertCountData(count=counts_map.get("info", 0), label="INFORMATIVOS", color="blue"),
        AlertCountData(count=counts_map.get("opportunity", 0), label="OPORTUNIDADES", color="emerald"),
    ]
    return AlertasData(counts=counts, details=details)


def get_user_alert_by_id(db: Session, user_id: UUID, alert_id: UUID) -> Optional[StrategicAlert]:
    return (
        db.query(StrategicAlert)
        .filter(
            StrategicAlert.id == alert_id,
            StrategicAlert.user_id == user_id,
        )
        .first()
    )


def mark_alert_as_read(db: Session, alert: StrategicAlert) -> StrategicAlert:
    now = datetime.now(timezone.utc)
    if alert.status != "dismissed":
        alert.status = "read"
    alert.read_at = now
    db.commit()
    db.refresh(alert)
    return alert


def dismiss_alert(db: Session, alert: StrategicAlert) -> StrategicAlert:
    now = datetime.now(timezone.utc)
    alert.status = "dismissed"
    alert.dismissed_at = now
    db.commit()
    db.refresh(alert)
    return alert
