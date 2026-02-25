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


class CaseScoresPayload(BaseModel):
    success_probability: float = Field(ge=0, le=1)
    settlement_probability: float = Field(ge=0, le=1)
    expected_decision_months: float = Field(ge=0)
    risk_score: float = Field(ge=0, le=100)
    complexity_score: float = Field(ge=0, le=100)
    ai_summary: str


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
