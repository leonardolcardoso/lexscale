from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class AlertActionTarget(BaseModel):
    tab: str
    module: Optional[str] = None
    case_id: Optional[str] = None
    reason: Optional[str] = None


class StrategicAlertItem(BaseModel):
    alert_id: str
    type: str
    title: str
    desc: str
    status: str
    source: str
    occurrence_count: int = Field(ge=1)
    contexts: List[str] = Field(default_factory=list)
    action_target: Optional[AlertActionTarget] = None
    time: str
    created_at: datetime
    last_detected_at: datetime
    notified_at: Optional[datetime] = None
    read_at: Optional[datetime] = None
    dismissed_at: Optional[datetime] = None


class StrategicAlertListResponse(BaseModel):
    total: int = Field(ge=0)
    status_filter: str
    generated_at: datetime
    items: List[StrategicAlertItem]


class StrategicAlertActionResponse(BaseModel):
    ok: bool = True
    alert: StrategicAlertItem


class StrategicAlertScanResponse(BaseModel):
    ok: bool = True
    scanned: int = Field(ge=0)
    created: int = Field(ge=0)
    updated: int = Field(ge=0)
    notified: int = Field(ge=0)
