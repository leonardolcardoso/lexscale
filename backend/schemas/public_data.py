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
