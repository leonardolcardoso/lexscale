from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class CaseContextData(BaseModel):
    case_id: str
    process_number: str
    case_title: Optional[str] = None
    user_party: Optional[Literal["author", "defendant"]] = None


class MetricCardData(BaseModel):
    title: str
    value: str
    subtitle: str
    footer: str
    color: str
    updated: Optional[str] = None
    warning: Optional[str] = None
    value_favorable_to_user: Optional[str] = None
    value_favorable_to_counterparty: Optional[str] = None


class ScoreCardData(BaseModel):
    title: str
    value: int = Field(ge=0, le=100)
    color: str


class RadarPoint(BaseModel):
    subject: str
    current: int = Field(ge=0, le=100)
    cluster_avg: int = Field(ge=0, le=100)


class InsightItem(BaseModel):
    title: str
    text: str


class WeeklyActivityPoint(BaseModel):
    name: str
    value: int = Field(ge=0)


class CriticalDeadline(BaseModel):
    label: str
    date: str
    color: str


class SimilarProcessData(BaseModel):
    id: str
    similarity: str
    result: str
    result_color: str = "emerald"
    time: str
    type: str


class HeatmapRowData(BaseModel):
    name: str
    values: List[int] = Field(min_length=5, max_length=5)


class BenchmarkData(BaseModel):
    label: str
    user: str
    market: str
    trend: str
    trend_color: str
    unit: str = ""


class ScenarioItemData(BaseModel):
    label: str
    val: str
    color: Optional[str] = None
    value_favorable_to_user: Optional[str] = None
    value_favorable_to_counterparty: Optional[str] = None


class ScenarioData(BaseModel):
    title: str
    tag: str
    tag_color: str
    data: List[ScenarioItemData]
    footer: str


class ImpactMetricData(BaseModel):
    label: str
    title: str
    val: str
    trend: str
    trend_bg: str
    icon: str


class ActionTargetData(BaseModel):
    tab: str
    module: Optional[str] = None
    case_id: Optional[str] = None
    reason: Optional[str] = None


class AlertCountData(BaseModel):
    count: int = Field(ge=0)
    label: str
    color: str


class DetailedAlertData(BaseModel):
    type: str
    title: str
    time: str
    desc: str
    action_target: Optional[ActionTargetData] = None


class RescisoriaFinancialProjectionData(BaseModel):
    estimated_cost_brl: float = 0.0
    projected_upside_brl: float = 0.0
    projected_net_brl: float = 0.0


class RescisoriaCandidateData(BaseModel):
    case_id: str
    process_number: str
    eligibility_status: str
    viability_score: int = Field(ge=0, le=100)
    recommendation: str
    grounds_detected: List[str] = Field(default_factory=list)
    financial_projection: RescisoriaFinancialProjectionData = Field(default_factory=RescisoriaFinancialProjectionData)


class RescisoriaKPIData(BaseModel):
    label: str
    value: str
    tone: str = "blue"


class AcoesRescisoriasData(BaseModel):
    summary: str = ""
    kpis: List[RescisoriaKPIData] = Field(default_factory=list)
    candidates: List[RescisoriaCandidateData] = Field(default_factory=list)


class DashboardFiltersData(BaseModel):
    tribunal: str
    juiz: str
    tipo_acao: str
    faixa_valor: str
    periodo: str


class VisaoGeralData(BaseModel):
    stats: List[MetricCardData]
    scores: List[ScoreCardData]
    radar: List[RadarPoint]
    insights: List[InsightItem]
    weekly_activity: List[WeeklyActivityPoint]
    critical_deadlines: List[CriticalDeadline]


class InteligenciaData(BaseModel):
    similar_processes: List[SimilarProcessData]
    heatmap_columns: List[str]
    heatmap_rows: List[HeatmapRowData]
    benchmark: List[BenchmarkData]
    acoes_rescisorias: AcoesRescisoriasData = Field(default_factory=AcoesRescisoriasData)


class SimulacaoData(BaseModel):
    description: str
    scenarios: List[ScenarioData]
    impact_metrics: List[ImpactMetricData]


class AlertasData(BaseModel):
    counts: List[AlertCountData]
    details: List[DetailedAlertData]


class DashboardData(BaseModel):
    updated_label: str
    filters: DashboardFiltersData
    visao_geral: VisaoGeralData
    inteligencia: InteligenciaData
    simulacoes: SimulacaoData
    alertas: AlertasData
    generated_at: datetime
    case_context: Optional[CaseContextData] = None
