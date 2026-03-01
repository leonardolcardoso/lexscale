#!/usr/bin/env python3
"""Validação local do benchmark: abaixo, no limite e acima da amostra mínima.

Rodar da raiz do repo:
  .venv/bin/python backend/test_dashboard_benchmark_thresholds.py
"""

import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Permitir import do backend ao rodar como script.
repo_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo_root))

from backend.models import Base, ProcessCase  # noqa: E402
import backend.services.dashboard as dashboard  # noqa: E402


def _patched_weekday_activity(cases: List[ProcessCase]):
    # SQLite em memória devolve datetimes sem timezone; este patch só evita ruído
    # no bloco de atividade semanal para validar exclusivamente o benchmark.
    day_map = {"Mon": "Seg", "Tue": "Ter", "Wed": "Qua", "Thu": "Qui", "Fri": "Sex"}
    counts = {code: 0 for code in day_map.values()}
    now = datetime.now()
    for item in cases:
        if not item.created_at:
            continue
        created = item.created_at.replace(tzinfo=None) if getattr(item.created_at, "tzinfo", None) else item.created_at
        if created < now - timedelta(days=35):
            continue
        weekday = created.strftime("%a")
        label = day_map.get(weekday)
        if label:
            counts[label] += 1
    return [dashboard.WeeklyActivityPoint(name=day, value=count) for day, count in counts.items()]


def _add_cases(
    db,
    *,
    user_id: uuid.UUID,
    other_user_id: uuid.UUID,
    tribunal: str,
    judge: str,
    action: str,
    n_user: int,
    n_other: int,
):
    now = datetime.now()
    seq = 0
    for i in range(n_user):
        seq += 1
        db.add(
            ProcessCase(
                user_id=user_id,
                process_number=f"USR-{tribunal}-{seq:04d}",
                tribunal=tribunal,
                judge=judge,
                action_type=action,
                claim_value=120000,
                success_probability=0.72 if i % 2 == 0 else 0.66,
                settlement_probability=0.41 if i % 3 == 0 else 0.37,
                expected_decision_months=8.5 if i % 2 == 0 else 9.2,
                risk_score=38,
                complexity_score=44,
                ai_status="queued",
                created_at=now,
            )
        )
    for i in range(n_other):
        seq += 1
        db.add(
            ProcessCase(
                user_id=other_user_id,
                process_number=f"MKT-{tribunal}-{seq:04d}",
                tribunal=tribunal,
                judge=judge,
                action_type=action,
                claim_value=130000,
                success_probability=0.61 if i % 2 == 0 else 0.58,
                settlement_probability=0.33 if i % 3 == 0 else 0.29,
                expected_decision_months=10.4 if i % 2 == 0 else 11.0,
                risk_score=49,
                complexity_score=53,
                ai_status="queued",
                created_at=now,
            )
        )


def _extract_benchmark(data) -> Dict[str, Dict[str, object]]:
    result: Dict[str, Dict[str, object]] = {}
    for item in data.inteligencia.benchmark:
        result[item.label] = {
            "trend": item.trend,
            "is_comparable": item.is_comparable,
            "sample_user": item.sample_user,
            "sample_market": item.sample_market,
            "min_user": item.min_user_observations,
            "min_market": item.min_market_observations,
            "confidence_label": item.confidence_label,
        }
    return result


def _assert_scenario(name: str, benchmark: Dict[str, Dict[str, object]], *, comparable: bool, expected_confidence: str):
    labels = ["Taxa de Êxito", "Tempo Médio", "Taxa de Acordo"]
    for label in labels:
        item = benchmark[label]
        if item["is_comparable"] != comparable:
            raise AssertionError(f"{name} | {label}: is_comparable esperado {comparable}, recebido {item['is_comparable']}")
        if item["confidence_label"] != expected_confidence:
            raise AssertionError(
                f"{name} | {label}: confidence_label esperado {expected_confidence}, recebido {item['confidence_label']}"
            )
        if comparable and str(item["trend"]).strip().lower() == "amostra insuficiente":
            raise AssertionError(f"{name} | {label}: trend não deveria ser 'Amostra insuficiente'")
        if not comparable and str(item["trend"]).strip().lower() != "amostra insuficiente":
            raise AssertionError(f"{name} | {label}: trend deveria ser 'Amostra insuficiente'")


def main() -> int:
    dashboard._build_weekday_activity = _patched_weekday_activity

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    user_id = uuid.uuid4()
    other_user_id = uuid.uuid4()

    scenarios = [
        {
            "name": "Abaixo do mínimo",
            "tribunal": "TJSP",
            "judge": "Dr. A",
            "action": "Cível",
            "n_user": 8,
            "n_other": 22,
            "expect_comparable": False,
            "expect_confidence": "Baixa",
        },
        {
            "name": "No limite",
            "tribunal": "TJRJ",
            "judge": "Dra. B",
            "action": "Trabalhista",
            "n_user": 10,
            "n_other": 20,
            "expect_comparable": True,
            "expect_confidence": "Baixa",
        },
        {
            "name": "Acima do mínimo",
            "tribunal": "TRF3",
            "judge": "Dr. C",
            "action": "Comercial",
            "n_user": 25,
            "n_other": 65,
            "expect_comparable": True,
            "expect_confidence": "Alta",
        },
    ]

    with Session() as db:
        for scenario in scenarios:
            _add_cases(
                db,
                user_id=user_id,
                other_user_id=other_user_id,
                tribunal=scenario["tribunal"],
                judge=scenario["judge"],
                action=scenario["action"],
                n_user=scenario["n_user"],
                n_other=scenario["n_other"],
            )
        db.commit()

        for scenario in scenarios:
            data = dashboard.build_dashboard_data(
                db,
                user_id=user_id,
                tribunal=scenario["tribunal"],
                juiz=scenario["judge"],
                tipo_acao=scenario["action"],
                faixa_valor="Todos os Valores",
                periodo="Todos",
                ai_client=None,
                case_context=None,
            )
            benchmark = _extract_benchmark(data)
            _assert_scenario(
                scenario["name"],
                benchmark,
                comparable=bool(scenario["expect_comparable"]),
                expected_confidence=str(scenario["expect_confidence"]),
            )

            print(f"OK: {scenario['name']}")
            for label in ["Taxa de Êxito", "Tempo Médio", "Taxa de Acordo"]:
                item = benchmark[label]
                print(
                    f"  - {label}: trend='{item['trend']}', comparable={item['is_comparable']}, "
                    f"sample={item['sample_user']}/{item['sample_market']}, "
                    f"min={item['min_user']}/{item['min_market']}, confidence={item['confidence_label']}"
                )

    print("Validação concluída: 3/3 cenários aprovados.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
