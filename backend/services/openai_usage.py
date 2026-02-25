import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.models import AIUsageLog

DEFAULT_MODEL_PRICING_USD_PER_1M: Dict[str, Dict[str, float]] = {
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "gpt-4.1-nano": {"input": 0.10, "output": 0.40},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "text-embedding-3-small": {"input": 0.02, "output": 0.0},
    "text-embedding-3-large": {"input": 0.13, "output": 0.0},
}


def _to_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def extract_usage_dict(usage: Any) -> Dict[str, Any]:
    if usage is None:
        return {}
    if isinstance(usage, dict):
        return usage
    if hasattr(usage, "model_dump"):
        dumped = usage.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    return {}


def normalize_token_usage(usage_dict: Dict[str, Any]) -> Dict[str, int]:
    input_tokens = _to_int(usage_dict.get("input_tokens"))
    if input_tokens <= 0:
        input_tokens = _to_int(usage_dict.get("prompt_tokens"))

    output_tokens = _to_int(usage_dict.get("output_tokens"))
    if output_tokens <= 0:
        output_tokens = _to_int(usage_dict.get("completion_tokens"))

    total_tokens = _to_int(usage_dict.get("total_tokens"))
    if total_tokens <= 0:
        total_tokens = input_tokens + output_tokens

    return {
        "input_tokens": max(0, input_tokens),
        "output_tokens": max(0, output_tokens),
        "total_tokens": max(0, total_tokens),
    }


def _pricing_env_slug(model: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", (model or "").upper()).strip("_")


def _read_rate_from_env(model: str, token_side: str) -> Optional[float]:
    side = token_side.upper().strip()
    if side not in {"INPUT", "OUTPUT"}:
        return None

    model_slug = _pricing_env_slug(model)
    keys = [
        f"OPENAI_PRICING_{model_slug}_{side}_PER_1M",
        f"OPENAI_PRICING_DEFAULT_{side}_PER_1M",
    ]
    for key in keys:
        raw = os.getenv(key)
        if raw is None:
            continue
        try:
            return float(raw)
        except ValueError:
            continue
    return None


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> Optional[float]:
    env_input = _read_rate_from_env(model, "INPUT")
    env_output = _read_rate_from_env(model, "OUTPUT")

    input_rate = env_input
    output_rate = env_output

    if input_rate is None or output_rate is None:
        defaults = DEFAULT_MODEL_PRICING_USD_PER_1M.get(model, {})
        if input_rate is None:
            input_rate = defaults.get("input")
        if output_rate is None:
            output_rate = defaults.get("output")

    if input_rate is None and output_rate is None:
        return None

    normalized_input_rate = float(input_rate or 0.0)
    normalized_output_rate = float(output_rate or 0.0)
    total = ((max(0, input_tokens) * normalized_input_rate) + (max(0, output_tokens) * normalized_output_rate)) / 1_000_000
    return round(total, 8)


def _sanitize_context(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if value is None:
        return None
    try:
        json.dumps(value, ensure_ascii=True)
        return value
    except TypeError:
        return {"raw": str(value)}


def record_openai_usage(
    *,
    db: Optional[Session],
    logger: logging.Logger,
    operation: str,
    model: str,
    usage: Any,
    user_id: Optional[UUID] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    usage_dict = extract_usage_dict(usage)
    tokens = normalize_token_usage(usage_dict)
    estimated_cost_usd = estimate_cost_usd(
        model=model,
        input_tokens=tokens["input_tokens"],
        output_tokens=tokens["output_tokens"],
    )

    month_tokens = None
    month_cost_usd = None
    user_month_tokens = None
    user_month_cost_usd = None

    if db is not None:
        try:
            row = AIUsageLog(
                user_id=user_id,
                operation=operation,
                model=model,
                input_tokens=tokens["input_tokens"],
                output_tokens=tokens["output_tokens"],
                total_tokens=tokens["total_tokens"],
                estimated_cost_usd=estimated_cost_usd,
                raw_usage=usage_dict or None,
                context=_sanitize_context(context),
            )
            db.add(row)
            db.flush()

            month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            month_tokens = int(
                db.query(func.coalesce(func.sum(AIUsageLog.total_tokens), 0))
                .filter(AIUsageLog.created_at >= month_start)
                .scalar()
                or 0,
            )
            month_cost_usd = float(
                db.query(func.coalesce(func.sum(AIUsageLog.estimated_cost_usd), 0.0))
                .filter(AIUsageLog.created_at >= month_start)
                .scalar()
                or 0.0,
            )

            if user_id is not None:
                user_month_tokens = int(
                    db.query(func.coalesce(func.sum(AIUsageLog.total_tokens), 0))
                    .filter(
                        AIUsageLog.user_id == user_id,
                        AIUsageLog.created_at >= month_start,
                    )
                    .scalar()
                    or 0,
                )
                user_month_cost_usd = float(
                    db.query(func.coalesce(func.sum(AIUsageLog.estimated_cost_usd), 0.0))
                    .filter(
                        AIUsageLog.user_id == user_id,
                        AIUsageLog.created_at >= month_start,
                    )
                    .scalar()
                    or 0.0,
                )
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("Falha ao persistir log de uso OpenAI (operation=%s, model=%s).", operation, model)

    logger.info(
        (
            "OpenAI usage operation=%s model=%s input_tokens=%s output_tokens=%s total_tokens=%s "
            "estimated_cost_usd=%s month_tokens=%s month_cost_usd=%s user_month_tokens=%s "
            "user_month_cost_usd=%s user_id=%s"
        ),
        operation,
        model,
        tokens["input_tokens"],
        tokens["output_tokens"],
        tokens["total_tokens"],
        estimated_cost_usd,
        month_tokens,
        month_cost_usd,
        user_month_tokens,
        user_month_cost_usd,
        str(user_id) if user_id else None,
    )

    return {
        "usage_dict": usage_dict or None,
        "input_tokens": tokens["input_tokens"],
        "output_tokens": tokens["output_tokens"],
        "total_tokens": tokens["total_tokens"],
        "estimated_cost_usd": estimated_cost_usd,
        "month_tokens": month_tokens,
        "month_cost_usd": month_cost_usd,
        "user_month_tokens": user_month_tokens,
        "user_month_cost_usd": user_month_cost_usd,
    }
