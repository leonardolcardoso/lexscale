from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class DeadlinePayload(BaseModel):
    label: str
    due_date: Optional[datetime] = None
    severity: Optional[str] = None


class CaseExtractionPayload(BaseModel):
    process_number: Optional[str] = None
    title: Optional[str] = None
    tribunal: Optional[str] = None
    judge: Optional[str] = None
    action_type: Optional[str] = None
    claim_value: Optional[float] = None
    status: Optional[str] = None
    parties: Dict[str, Any] = Field(default_factory=dict)
    key_facts: List[str] = Field(default_factory=list)
    deadlines: List[DeadlinePayload] = Field(default_factory=list)
    authority_display: Optional[str] = None
    public_benchmark: Optional[Dict[str, Any]] = None


class CaseScoresPayload(BaseModel):
    success_probability: float = Field(ge=0, le=1)
    settlement_probability: float = Field(ge=0, le=1)
    expected_decision_months: float = Field(ge=0)
    risk_score: float = Field(ge=0, le=100)
    complexity_score: float = Field(ge=0, le=100)
    ai_summary: str


class RescisoriaFinancialProjectionPayload(BaseModel):
    estimated_cost_brl: float = Field(default=0.0, ge=0)
    projected_upside_brl: float = Field(default=0.0, ge=0)
    projected_net_brl: float = 0.0


class RescisoriaAnalysisPayload(BaseModel):
    eligibility_status: str
    viability_score: int = Field(ge=0, le=100)
    recommendation: str
    grounds_detected: List[str] = Field(default_factory=list)
    financial_projection: RescisoriaFinancialProjectionPayload = Field(
        default_factory=RescisoriaFinancialProjectionPayload,
    )
    transit_judged_detected: Optional[bool] = None
    reason: Optional[str] = None


class UploadCaseResponse(BaseModel):
    case_id: str
    process_number: str
    extracted: CaseExtractionPayload
    scores: Optional[CaseScoresPayload] = None
    ai_status: str
    ai_attempts: int = 0
    ai_stage: str = "extraction"
    ai_stage_label: Optional[str] = None
    ai_progress_percent: int = 0
    ai_stage_updated_at: Optional[datetime] = None
    ai_next_retry_at: Optional[datetime] = None
    ai_last_error: Optional[str] = None
    created_at: datetime


class CaseExtractionPreviewResponse(BaseModel):
    process_number: str
    extracted: CaseExtractionPayload


class CaseListItem(BaseModel):
    case_id: str
    process_number: str
    tribunal: Optional[str] = None
    judge: Optional[str] = None
    authority_display: Optional[str] = None
    action_type: Optional[str] = None
    claim_value: Optional[float] = None
    status: Optional[str] = None
    success_probability: Optional[float] = None
    settlement_probability: Optional[float] = None
    expected_decision_months: Optional[float] = None
    risk_score: Optional[float] = None
    complexity_score: Optional[float] = None
    ai_status: str = "queued"
    ai_attempts: int = 0
    ai_stage: str = "extraction"
    ai_stage_label: Optional[str] = None
    ai_progress_percent: int = 0
    ai_stage_updated_at: Optional[datetime] = None
    ai_next_retry_at: Optional[datetime] = None
    ai_processed_at: Optional[datetime] = None
    ai_last_error: Optional[str] = None
    rescisoria: Optional[RescisoriaAnalysisPayload] = None
    created_at: datetime


class CaseAIStatusResponse(BaseModel):
    case_id: str
    ai_status: str
    ai_attempts: int = 0
    ai_stage: str = "extraction"
    ai_stage_label: Optional[str] = None
    ai_progress_percent: int = 0
    ai_stage_updated_at: Optional[datetime] = None
    ai_next_retry_at: Optional[datetime] = None
    ai_processed_at: Optional[datetime] = None
    ai_last_error: Optional[str] = None


class UploadHistoryGeneratedData(BaseModel):
    extracted: CaseExtractionPayload = Field(default_factory=CaseExtractionPayload)
    success_probability: Optional[float] = None
    settlement_probability: Optional[float] = None
    expected_decision_months: Optional[float] = None
    risk_score: Optional[float] = None
    complexity_score: Optional[float] = None
    ai_summary: Optional[str] = None
    rescisoria: Optional[RescisoriaAnalysisPayload] = None
    favorable_to_user_pct: Optional[float] = None  # êxito favorável ao usuário (0-100)
    favorable_to_counterparty_pct: Optional[float] = None  # êxito favorável à contraparte (0-100)


class UploadHistoryItem(BaseModel):
    case_id: str
    process_number: str
    user_party: Optional[str] = None  # "author" | "defendant"
    case_title: Optional[str] = None
    filename: Optional[str] = None
    content_type: Optional[str] = None
    tribunal: Optional[str] = None
    judge: Optional[str] = None
    authority_display: Optional[str] = None
    action_type: Optional[str] = None
    claim_value: Optional[float] = None
    status: Optional[str] = None
    ai_status: str = "queued"
    ai_attempts: int = 0
    ai_stage: str = "extraction"
    ai_stage_label: Optional[str] = None
    ai_progress_percent: int = 0
    ai_stage_updated_at: Optional[datetime] = None
    ai_next_retry_at: Optional[datetime] = None
    ai_processed_at: Optional[datetime] = None
    ai_last_error: Optional[str] = None
    created_at: datetime
    generated_data: UploadHistoryGeneratedData = Field(default_factory=UploadHistoryGeneratedData)


class UploadHistoryFilterOptions(BaseModel):
    judges: List[str] = Field(default_factory=list)
    tribunals: List[str] = Field(default_factory=list)
    action_types: List[str] = Field(default_factory=list)


class UploadHistoryListResponse(BaseModel):
    items: List[UploadHistoryItem] = Field(default_factory=list)
    total_count: int = 0
    page: int = 1
    page_size: int = 20
    total_pages: int = 0
