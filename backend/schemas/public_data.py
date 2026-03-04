from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class PublicDataSourceCreate(BaseModel):
    name: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    tribunal: Optional[str] = None
    notes: Optional[str] = None
    headers: Dict[str, str] = Field(default_factory=dict)
    enabled: bool = True


class PublicDataSourceItem(BaseModel):
    source_id: str
    name: str
    base_url: str
    tribunal: Optional[str] = None
    notes: Optional[str] = None
    enabled: bool
    last_status: Optional[str] = None
    last_error: Optional[str] = None
    last_sync_at: Optional[datetime] = None


class PublicRecordInput(BaseModel):
    external_id: Optional[str] = None
    process_number: Optional[str] = None
    tribunal: Optional[str] = None
    judge: Optional[str] = None
    action_type: Optional[str] = None
    status: Optional[str] = None
    outcome: Optional[str] = None
    claim_value: Optional[float] = None
    filed_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    duration_days: Optional[int] = None
    is_settlement: Optional[bool] = None
    is_success: Optional[bool] = None
    raw_data: Dict[str, Any] = Field(default_factory=dict)


class PublicRecordUpsertRequest(BaseModel):
    source_name: Optional[str] = None
    records: List[PublicRecordInput]


class PublicDataSyncResult(BaseModel):
    source_name: str
    fetched_items: int
    inserted_items: int
    errors: List[str] = Field(default_factory=list)


class PublicDataSyncResponse(BaseModel):
    results: List[PublicDataSyncResult]


class PublicDataOpsSourceItem(BaseModel):
    name: str
    enabled: bool
    last_status: Optional[str] = None
    last_error: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    minutes_since_last_sync: Optional[int] = None
    is_stale: bool = True


class PublicDataOpsCases(BaseModel):
    period_days: int
    uploads_total: int
    completed_total: int
    processing_total: int
    failed_total: int
    completed_rate_pct: float
    avg_total_processing_seconds: Optional[float] = None
    avg_total_processing_seconds_with_sync: Optional[float] = None
    avg_total_processing_seconds_without_sync: Optional[float] = None


class PublicDataOpsSyncMetrics(BaseModel):
    sync_on_case_processing_enabled: bool
    case_sync_min_freshness_minutes: int
    uploads_with_case_sync: int
    uploads_without_case_sync: int
    case_sync_execution_rate_pct: float
    avg_case_sync_elapsed_ms: Optional[float] = None
    p95_case_sync_elapsed_ms: Optional[float] = None
    sources_enabled_total: int
    sources_last_success: int
    sources_last_error: int
    sources_stale: int


class PublicDataOpsAIUsage(BaseModel):
    period_days: int
    total_calls: int
    total_tokens: int
    total_cost_usd: float
    chunk_summary_calls: int
    responses_calls: int
    embeddings_calls: int


class PublicDataOpsResponse(BaseModel):
    generated_at: datetime
    cases: PublicDataOpsCases
    sync: PublicDataOpsSyncMetrics
    ai_usage: PublicDataOpsAIUsage
    sources: List[PublicDataOpsSourceItem] = Field(default_factory=list)
