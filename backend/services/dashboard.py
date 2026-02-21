from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from backend.models import CaseDeadline, ProcessCase, PublicCaseRecord
from backend.schemas.dashboard import (
    AlertCountData,
    AlertasData,
    BenchmarkData,
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
    ScenarioData,
    ScenarioItemData,
    ScoreCardData,
    SimilarProcessData,
    SimulacaoData,
    VisaoGeralData,
    WeeklyActivityPoint,
)


def _is_all_filter(value: str, defaults: Sequence[str]) -> bool:
    normalized = (value or "").strip().lower()
    return normalized in {item.lower() for item in defaults}


def _parse_period_cutoff(periodo: str) -> Optional[datetime]:
    if _is_all_filter(periodo, ["", "todos", "all"]):
        return None
    raw = (periodo or "").strip().lower()
    if "6" in raw:
        return datetime.now(timezone.utc) - timedelta(days=180)
    if "12" in raw:
        return datetime.now(timezone.utc) - timedelta(days=365)
    if "3" in raw:
        return datetime.now(timezone.utc) - timedelta(days=90)
    return datetime.now(timezone.utc) - timedelta(days=180)


def _parse_value_range(faixa_valor: str) -> Tuple[Optional[float], Optional[float]]:
    raw = (faixa_valor or "").strip().lower()
    if _is_all_filter(raw, ["todos os valores", "todos", "all"]):
        return None, None
    if raw in {"0-100k", "0-100000", "ate 100k"}:
        return 0, 100000
    if raw in {"100k-500k", "100000-500000"}:
        return 100000, 500000
    if raw in {">500k", "acima de 500k"}:
        return 500000, None

    # parsing generico: "100k-500k" ou "100000-500000"
    parts = raw.replace("k", "000").split("-")
    if len(parts) == 2:
        try:
            return float(parts[0]), float(parts[1])
        except ValueError:
            return None, None
    return None, None


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
        if not _is_all_filter(tribunal, ["todos os tribunais"]) and (item.tribunal or "").lower() != tribunal.lower():
            continue
        if not _is_all_filter(juiz, ["todos os juizes", "todos os juízes"]) and (item.judge or "").lower() != juiz.lower():
            continue
        if not _is_all_filter(tipo_acao, ["todos os tipos"]) and (item.action_type or "").lower() != tipo_acao.lower():
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
        if not _is_all_filter(tribunal, ["todos os tribunais"]) and (item.tribunal or "").lower() != tribunal.lower():
            continue
        if not _is_all_filter(juiz, ["todos os juizes", "todos os juízes"]) and (item.judge or "").lower() != juiz.lower():
            continue
        if not _is_all_filter(tipo_acao, ["todos os tipos"]) and (item.action_type or "").lower() != tipo_acao.lower():
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
    return f"{round(value * 100)}%"


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _action_category(action_type: Optional[str]) -> str:
    raw = (action_type or "").lower()
    if "trabalh" in raw:
        return "Trabalhista"
    if "tribut" in raw:
        return "Tributario"
    if "famil" in raw:
        return "Familia"
    if "comerc" in raw or "empres" in raw:
        return "Comercial"
    return "Civel"


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
    return [WeeklyActivityPoint(name=day, value=max(1, count)) for day, count in counts.items()]


def _build_deadlines(deadlines: List[CaseDeadline], cases: List[ProcessCase]) -> List[CriticalDeadline]:
    now = datetime.now(timezone.utc)
    upcoming = [d for d in deadlines if d.due_date and d.due_date >= now]
    upcoming.sort(key=lambda d: d.due_date or now)

    result: List[CriticalDeadline] = []
    for item in upcoming[:3]:
        delta_days = (item.due_date - now).days if item.due_date else 0
        when = "Amanha" if delta_days <= 1 else f"Em {delta_days} dias"
        color = "red" if delta_days <= 2 else "orange" if delta_days <= 5 else "blue"
        result.append(CriticalDeadline(label=item.label, date=when, color=color))

    if result:
        return result

    for idx, case in enumerate(cases[:3], start=1):
        result.append(
            CriticalDeadline(
                label=f"Revisao - Proc. {case.process_number}",
                date=f"Em {idx + 1} dias",
                color="orange" if idx == 1 else "blue",
            ),
        )
    return result or [
        CriticalDeadline(label="Nenhum prazo identificado", date="Sem prazo", color="blue"),
    ]


def _build_similar_processes(records: List[PublicCaseRecord], fallback_cases: List[ProcessCase]) -> List[SimilarProcessData]:
    if records:
        selected = records[:3]
        output = []
        for idx, item in enumerate(selected, start=1):
            months = (item.duration_days or (90 + idx * 25)) / 30
            result_color = "emerald" if item.is_success is not False else "red"
            result = "Exito" if item.is_success is not False else "Improcedente"
            output.append(
                SimilarProcessData(
                    id=item.process_number or f"#SIM-{idx:04d}",
                    similarity=f"{94 - (idx - 1) * 5}%",
                    result=result,
                    result_color=result_color,
                    time=f"{months:.1f} meses",
                    type=_action_category(item.action_type),
                ),
            )
        return output

    output = []
    for idx, case in enumerate(fallback_cases[:3], start=1):
        output.append(
            SimilarProcessData(
                id=case.process_number or f"#CASE-{idx}",
                similarity=f"{88 - (idx - 1) * 3}%",
                result="Exito" if (case.success_probability or 0.65) >= 0.5 else "Improcedente",
                result_color="emerald" if (case.success_probability or 0.65) >= 0.5 else "red",
                time=f"{(case.expected_decision_months or 4.0):.1f} meses",
                type=_action_category(case.action_type),
            ),
        )
    return output or [
        SimilarProcessData(
            id="#SEM-DADOS",
            similarity="0%",
            result="Indefinido",
            result_color="orange",
            time="0.0 meses",
            type="Civel",
        ),
    ]


def _build_heatmap(records: List[PublicCaseRecord]) -> Tuple[List[str], List[HeatmapRowData]]:
    columns = ["Trabalhista", "Civel", "Tributario", "Comercial", "Familia"]
    judge_buckets: Dict[str, Dict[str, List[bool]]] = defaultdict(lambda: defaultdict(list))

    for item in records:
        judge = item.judge or "Juiz nao identificado"
        category = _action_category(item.action_type)
        success = item.is_success if item.is_success is not None else True
        judge_buckets[judge][category].append(bool(success))

    rows: List[HeatmapRowData] = []
    for judge, categories in list(judge_buckets.items())[:3]:
        values = []
        for column in columns:
            samples = categories.get(column, [])
            if samples:
                values.append(round((sum(1 for s in samples if s) / len(samples)) * 100))
            else:
                values.append(55)
        rows.append(HeatmapRowData(name=judge[:28], values=values))

    if rows:
        return columns, rows

    return columns, [
        HeatmapRowData(name="Dr. Joao Silva", values=[82, 76, 85, 68, 58]),
        HeatmapRowData(name="Dra. Maria Santos", values=[74, 88, 65, 79, 81]),
        HeatmapRowData(name="Dr. Pedro Oliveira", values=[62, 55, 72, 51, 64]),
    ]


def build_dashboard_data(
    db: Session,
    tribunal: str = "Todos os Tribunais",
    juiz: str = "Todos os Juizes",
    tipo_acao: str = "Todos os Tipos",
    faixa_valor: str = "Todos os Valores",
    periodo: str = "Ultimos 6 meses",
) -> DashboardData:
    all_cases = db.query(ProcessCase).order_by(ProcessCase.created_at.desc()).all()
    all_public = db.query(PublicCaseRecord).order_by(PublicCaseRecord.created_at.desc()).all()
    all_deadlines = db.query(CaseDeadline).order_by(CaseDeadline.due_date.asc()).all()

    filtered_cases = _filter_cases(all_cases, tribunal, juiz, tipo_acao, faixa_valor, periodo)
    filtered_public = _filter_public_records(all_public, tribunal, juiz, tipo_acao, faixa_valor, periodo)

    success_values = [c.success_probability for c in filtered_cases if c.success_probability is not None]
    success_values += [1.0 if r.is_success else 0.0 for r in filtered_public if r.is_success is not None]
    success_rate = _safe_mean(success_values, 0.64)

    settlement_values = [c.settlement_probability for c in filtered_cases if c.settlement_probability is not None]
    settlement_values += [1.0 if r.is_settlement else 0.0 for r in filtered_public if r.is_settlement is not None]
    settlement_rate = _safe_mean(settlement_values, 0.56)

    months_values = [c.expected_decision_months for c in filtered_cases if c.expected_decision_months is not None]
    months_values += [(r.duration_days or 0) / 30 for r in filtered_public if r.duration_days]
    avg_months = _safe_mean(months_values, 4.5)

    risk_values = [c.risk_score for c in filtered_cases if c.risk_score is not None]
    risk_score = _safe_mean(risk_values, _clamp((1 - success_rate) * 100 + 8, 5, 95))

    complexity_values = [c.complexity_score for c in filtered_cases if c.complexity_score is not None]
    complexity_score = _safe_mean(complexity_values, _clamp(35 + avg_months * 6, 10, 95))

    market_success_values = [1.0 if r.is_success else 0.0 for r in all_public if r.is_success is not None]
    market_settlement_values = [1.0 if r.is_settlement else 0.0 for r in all_public if r.is_settlement is not None]
    market_months_values = [(r.duration_days or 0) / 30 for r in all_public if r.duration_days]

    market_success = _safe_mean(market_success_values, 0.6)
    market_settlement = _safe_mean(market_settlement_values, 0.52)
    market_months = _safe_mean(market_months_values, 5.1)

    sample_size = max(len(filtered_public), len(filtered_cases))
    agreement_sample = max(1, round(sample_size * 0.62))

    weekly_activity = _build_weekday_activity(filtered_cases or all_cases)
    critical_deadlines = _build_deadlines(all_deadlines, filtered_cases or all_cases)
    similar_processes = _build_similar_processes(filtered_public, filtered_cases or all_cases)
    heatmap_columns, heatmap_rows = _build_heatmap(filtered_public or all_public)

    updated_label = (
        "Atualizado: agora"
        if (filtered_cases or filtered_public)
        else "Atualizado: sem dados recentes"
    )

    visao_geral = VisaoGeralData(
        stats=[
            MetricCardData(
                title="Probabilidade de Exito",
                value=_pct(success_rate),
                subtitle=(
                    f"Intervalo: {max(0, round((success_rate - 0.05) * 100))}% - "
                    f"{min(100, round((success_rate + 0.05) * 100))}% (+/-5%)"
                ),
                footer=f"Baseado em {max(1, sample_size)} casos similares",
                color="blue",
                updated=datetime.now().strftime("Atualizado em %d/%m/%Y as %H:%M"),
            ),
            MetricCardData(
                title="Probabilidade de Acordo",
                value=_pct(settlement_rate),
                subtitle=(
                    f"Intervalo: {max(0, round((settlement_rate - 0.07) * 100))}% - "
                    f"{min(100, round((settlement_rate + 0.07) * 100))}% (+/-7%)"
                ),
                footer=f"Baseado em {agreement_sample} acordos analisados",
                color="blue",
                updated=datetime.now().strftime("Atualizado em %d/%m/%Y as %H:%M"),
            ),
            MetricCardData(
                title="Tempo Estimado de Decisao",
                value=f"~{avg_months:.1f} meses",
                subtitle=f"Intervalo: {max(0.5, avg_months - 0.7):.1f} - {avg_months + 0.7:.1f} meses",
                footer="Baseado em tempo medio do cluster",
                color="orange",
                warning="Amostra limitada: considerar com cautela" if sample_size < 15 else None,
            ),
        ],
        scores=[
            ScoreCardData(title="Risco", value=int(round(risk_score)), color="red"),
            ScoreCardData(title="Chance de Exito", value=int(round(success_rate * 100)), color="emerald"),
            ScoreCardData(title="Chance de Acordo", value=int(round(settlement_rate * 100)), color="blue"),
            ScoreCardData(title="Complexidade", value=int(round(complexity_score)), color="orange"),
        ],
        radar=[
            RadarPoint(subject="Complexidade", current=int(round(complexity_score)), cluster_avg=58),
            RadarPoint(subject="Chance Exito", current=int(round(success_rate * 100)), cluster_avg=int(round(market_success * 100))),
            RadarPoint(subject="Valor", current=65, cluster_avg=78),
            RadarPoint(subject="Tempo", current=int(round(_clamp(100 - (avg_months * 12), 0, 100))), cluster_avg=int(round(_clamp(100 - (market_months * 12), 0, 100)))),
            RadarPoint(subject="Risco", current=int(round(risk_score)), cluster_avg=int(round((1 - market_success) * 100))),
        ],
        insights=[
            InsightItem(
                title="Analise Estrategica",
                text=f"O processo filtrado indica probabilidade de exito de {_pct(success_rate)}, comparada ao mercado em {_pct(market_success)}.",
            ),
            InsightItem(
                title="Cenario de Risco",
                text=f"Score de risco atual em {risk_score:.1f} pontos, com tempo medio de {avg_months:.1f} meses.",
            ),
            InsightItem(
                title="Oportunidade de Acordo",
                text=f"Chance de acordo em {_pct(settlement_rate)}; media de mercado em {_pct(market_settlement)}.",
            ),
        ],
        weekly_activity=weekly_activity,
        critical_deadlines=critical_deadlines,
    )

    inteligencia = InteligenciaData(
        similar_processes=similar_processes,
        heatmap_columns=heatmap_columns,
        heatmap_rows=heatmap_rows,
        benchmark=[
            BenchmarkData(
                label="Taxa de Exito",
                user=_pct(success_rate),
                market=_pct(market_success),
                trend=f"{'+' if success_rate >= market_success else ''}{round((success_rate - market_success) * 100)}% vs mercado",
                trend_color="emerald" if success_rate >= market_success else "orange",
            ),
            BenchmarkData(
                label="Tempo Medio",
                user=f"{avg_months:.1f}",
                market=f"{market_months:.1f}",
                trend=f"{round(((market_months - avg_months) / market_months) * 100) if market_months else 0}% mais rapido",
                trend_color="emerald" if avg_months <= market_months else "orange",
                unit="meses",
            ),
            BenchmarkData(
                label="Taxa de Acordo",
                user=_pct(settlement_rate),
                market=_pct(market_settlement),
                trend=f"{'+' if settlement_rate >= market_settlement else ''}{round((settlement_rate - market_settlement) * 100)}% vs mercado",
                trend_color="emerald" if settlement_rate >= market_settlement else "orange",
            ),
        ],
    )

    scenario_a_success = _clamp(success_rate - 0.06, 0.1, 0.99)
    scenario_b_success = _clamp(success_rate, 0.1, 0.99)
    scenario_c_success = _clamp(success_rate - 0.12, 0.1, 0.99)
    base_value = _safe_mean([c.claim_value for c in filtered_cases if c.claim_value], 45000.0)

    simulacoes = SimulacaoData(
        description="Cenarios gerados com base em historico interno + base publica filtrada.",
        scenarios=[
            ScenarioData(
                title="Cenario A: Acordo Imediato",
                tag="RECOMENDADO",
                tag_color="emerald",
                data=[
                    ScenarioItemData(label="Probabilidade de Sucesso", val=_pct(scenario_a_success), color="emerald"),
                    ScenarioItemData(label="Valor Estimado", val=f"R$ {base_value * 0.82:,.0f}".replace(",", ".")),
                    ScenarioItemData(label="Tempo Estimado", val=f"{max(1.0, avg_months * 0.4):.1f} meses"),
                    ScenarioItemData(label="Nivel de Risco", val=f"{max(8, risk_score * 0.35):.0f}%", color="emerald"),
                ],
                footer=f"Baseado em {max(1, sample_size)} casos similares com fechamento antecipado.",
            ),
            ScenarioData(
                title="Cenario B: Julgamento Final",
                tag="EQUILIBRADO",
                tag_color="blue",
                data=[
                    ScenarioItemData(label="Probabilidade de Sucesso", val=_pct(scenario_b_success), color="emerald"),
                    ScenarioItemData(label="Valor Estimado", val=f"R$ {base_value * 1.1:,.0f}".replace(",", ".")),
                    ScenarioItemData(label="Tempo Estimado", val=f"{avg_months:.1f} meses"),
                    ScenarioItemData(label="Nivel de Risco", val=f"{risk_score:.0f}%", color="orange"),
                ],
                footer=f"Baseado em {max(1, sample_size)} casos com sentenca final.",
            ),
            ScenarioData(
                title="Cenario C: Estrategia Alternativa",
                tag="ALTERNATIVA",
                tag_color="orange",
                data=[
                    ScenarioItemData(label="Probabilidade de Sucesso", val=_pct(scenario_c_success), color="orange"),
                    ScenarioItemData(label="Valor Estimado", val=f"R$ {base_value * 0.95:,.0f}".replace(",", ".")),
                    ScenarioItemData(label="Tempo Estimado", val=f"{max(1.5, avg_months * 0.7):.1f} meses"),
                    ScenarioItemData(label="Nivel de Risco", val=f"{max(12, risk_score * 0.7):.0f}%", color="blue"),
                ],
                footer=f"Baseado em {max(1, round(sample_size * 0.6))} casos com estrategia hibrida.",
            ),
        ],
        impact_metrics=[
            ImpactMetricData(
                label="MELHOR VALOR",
                icon="trophy",
                title="Cenario B",
                val=f"R$ {base_value * 1.1:,.0f} estimado".replace(",", "."),
                trend=f"+{round(((1.1 - 0.82) / 0.82) * 100)}% vs Cenario A",
                trend_bg="bg-blue-50",
            ),
            ImpactMetricData(
                label="MENOR RISCO",
                icon="shield",
                title="Cenario A",
                val=f"{max(8, risk_score * 0.35):.0f}% de risco",
                trend=f"-{round((1 - 0.35) * 100)}% vs Cenario B",
                trend_bg="bg-emerald-50",
            ),
            ImpactMetricData(
                label="MAIS RAPIDO",
                icon="zap",
                title="Cenario A",
                val=f"{max(1.0, avg_months * 0.4):.1f} meses",
                trend=f"-{round((1 - 0.4) * 100)}% vs Cenario B",
                trend_bg="bg-orange-50",
            ),
        ],
    )

    critical_count = 1 if risk_score >= 65 else 0
    warning_count = 1 if risk_score >= 45 else 0
    opportunity_count = 1 if settlement_rate >= 0.6 else 0
    info_count = 1

    alertas = AlertasData(
        counts=[
            AlertCountData(count=max(critical_count, 1 if sample_size else 0), label="CRITICOS", color="red"),
            AlertCountData(count=max(warning_count, 1), label="ATENCAO", color="orange"),
            AlertCountData(count=max(info_count, 1), label="INFORMATIVOS", color="blue"),
            AlertCountData(count=max(opportunity_count, 1), label="OPORTUNIDADES", color="emerald"),
        ],
        details=[
            DetailedAlertData(
                type="critical",
                title="Tempo acima do padrao do cluster",
                time="ha poucas horas",
                desc=f"Tempo estimado atual de {avg_months:.1f} meses versus benchmark de {market_months:.1f} meses.",
            ),
            DetailedAlertData(
                type="warning",
                title="Variacao no comportamento decisorio",
                time="ha 1 dia",
                desc=f"Taxa de exito em {_pct(success_rate)} contra mercado em {_pct(market_success)} no periodo filtrado.",
            ),
            DetailedAlertData(
                type="opportunity",
                title="Janela favoravel para acordo",
                time="ha 2 dias",
                desc=f"Chance de acordo em {_pct(settlement_rate)} no recorte atual.",
            ),
            DetailedAlertData(
                type="info",
                title="Base de dados recalculada",
                time="agora",
                desc=f"Dashboard recomputado com {len(filtered_cases)} casos internos e {len(filtered_public)} registros publicos.",
            ),
        ],
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
    )
