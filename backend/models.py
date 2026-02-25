import os
import uuid
from datetime import datetime, timedelta, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()
EMBEDDING_DIMENSIONS = int(os.getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536"))


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(Text, nullable=False, unique=True)
    password = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    profile = relationship("UserProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    sessions = relationship("AuthSession", back_populates="user", cascade="all, delete-orphan")
    strategic_alerts = relationship("StrategicAlert", back_populates="user", cascade="all, delete-orphan")


class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    first_name = Column(Text, nullable=True)
    last_name = Column(Text, nullable=True)
    company = Column(Text, nullable=True)
    role = Column(Text, nullable=True)
    phone = Column(Text, nullable=True)
    bio = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User", back_populates="profile")


def _default_session_expires_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=7)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(Text, nullable=False, unique=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, default=_default_session_expires_at, index=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user = relationship("User", back_populates="sessions")


class AIMessage(Base):
    __tablename__ = "ai_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    prompt = Column(Text, nullable=False)
    response = Column(Text, nullable=False)
    model = Column(String(120), nullable=False)
    usage = Column(JSON, nullable=True)
    prompt_embedding = Column(Vector(EMBEDDING_DIMENSIONS), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)


class AIUsageLog(Base):
    __tablename__ = "ai_usage_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    operation = Column(String(120), nullable=False, index=True)
    model = Column(String(120), nullable=False, index=True)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    total_tokens = Column(Integer, nullable=False, default=0, index=True)
    estimated_cost_usd = Column(Float, nullable=True)
    raw_usage = Column(JSON, nullable=True)
    context = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)


class ProcessCase(Base):
    __tablename__ = "process_cases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    process_number = Column(Text, nullable=False, index=True)
    title = Column(Text, nullable=True)
    tribunal = Column(Text, nullable=True, index=True)
    judge = Column(Text, nullable=True, index=True)
    action_type = Column(Text, nullable=True, index=True)
    claim_value = Column(Float, nullable=True, index=True)
    status = Column(Text, nullable=True, default="novo")
    extracted_fields = Column(JSON, nullable=True)
    ai_summary = Column(Text, nullable=True)
    success_probability = Column(Float, nullable=True)
    settlement_probability = Column(Float, nullable=True)
    expected_decision_months = Column(Float, nullable=True)
    risk_score = Column(Float, nullable=True)
    complexity_score = Column(Float, nullable=True)
    case_embedding = Column(Vector(EMBEDDING_DIMENSIONS), nullable=True)
    ai_status = Column(Text, nullable=False, default="queued", index=True)
    ai_stage = Column(Text, nullable=False, default="extraction", index=True)
    ai_stage_label = Column(Text, nullable=True)
    ai_progress_percent = Column(Integer, nullable=False, default=0)
    ai_stage_updated_at = Column(DateTime(timezone=True), nullable=True)
    ai_attempts = Column(Integer, nullable=False, default=0)
    ai_last_error = Column(Text, nullable=True)
    ai_next_retry_at = Column(DateTime(timezone=True), nullable=True, index=True)
    ai_processed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    documents = relationship("ProcessDocument", back_populates="case", cascade="all, delete-orphan")
    deadlines = relationship("CaseDeadline", back_populates="case", cascade="all, delete-orphan")


class ProcessDocument(Base):
    __tablename__ = "process_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("process_cases.id"), nullable=False, index=True)
    filename = Column(Text, nullable=False)
    content_type = Column(Text, nullable=True)
    storage_path = Column(Text, nullable=False)
    extracted_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)

    case = relationship("ProcessCase", back_populates="documents")


class CaseDeadline(Base):
    __tablename__ = "case_deadlines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("process_cases.id"), nullable=False, index=True)
    label = Column(Text, nullable=False)
    due_date = Column(DateTime(timezone=True), nullable=True, index=True)
    severity = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    case = relationship("ProcessCase", back_populates="deadlines")


class PublicDataSource(Base):
    __tablename__ = "public_data_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False, unique=True)
    base_url = Column(Text, nullable=False)
    headers = Column(JSON, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    tribunal = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    last_status = Column(Text, nullable=True)
    last_error = Column(Text, nullable=True)
    last_sync_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    records = relationship("PublicCaseRecord", back_populates="source")


class PublicCaseRecord(Base):
    __tablename__ = "public_case_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id = Column(UUID(as_uuid=True), ForeignKey("public_data_sources.id"), nullable=True, index=True)
    external_id = Column(Text, nullable=True, index=True)
    process_number = Column(Text, nullable=True, index=True)
    tribunal = Column(Text, nullable=True, index=True)
    judge = Column(Text, nullable=True, index=True)
    action_type = Column(Text, nullable=True, index=True)
    status = Column(Text, nullable=True)
    outcome = Column(Text, nullable=True)
    claim_value = Column(Float, nullable=True, index=True)
    filed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    duration_days = Column(Integer, nullable=True)
    is_settlement = Column(Boolean, nullable=True)
    is_success = Column(Boolean, nullable=True)
    raw_data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)

    source = relationship("PublicDataSource", back_populates="records")


class StrategicAlert(Base):
    __tablename__ = "strategic_alerts"
    __table_args__ = (
        UniqueConstraint("user_id", "fingerprint", name="uq_strategic_alert_user_fingerprint"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String(24), nullable=False, index=True)  # critical|warning|opportunity|info
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=False)
    fingerprint = Column(String(64), nullable=False, index=True)
    status = Column(String(24), nullable=False, default="new", index=True)  # new|read|dismissed
    source = Column(String(64), nullable=False, default="dashboard_scan")
    occurrence_count = Column(Integer, nullable=False, default=1)
    contexts = Column(JSON, nullable=True)
    first_detected_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_detected_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    notified_at = Column(DateTime(timezone=True), nullable=True, index=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    dismissed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User", back_populates="strategic_alerts")
