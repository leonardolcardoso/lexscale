import os
import re
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session, sessionmaker

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL não configurada. Defina em backend/.env para conectar no Postgres.",
    )

# Some providers (and templates) expose DATABASE_URL using placeholders like
# "postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}".
# SQLAlchemy cannot parse that string directly, so we expand ${VAR} using
# the current process environment.
def _expand_env_placeholders(value: str) -> str:
    pattern = re.compile(r"\$\{([^}]+)\}")

    def _replace(match: re.Match[str]) -> str:
        var_name = match.group(1)
        return os.getenv(var_name, match.group(0))

    return pattern.sub(_replace, value)


DATABASE_URL = _expand_env_placeholders(DATABASE_URL)

# Normalize Postgres URLs so SQLAlchemy recognizes the dialect correctly.
# Some providers use the shorthand "postgres://", which SQLAlchemy treats
# as an unknown dialect ("postgres"). We rewrite it to "postgresql://".
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


def _is_truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_database() -> None:
    from backend.models import Base

    allow_data_migrations = _is_truthy(os.getenv("DB_ALLOW_DATA_MIGRATIONS", "true"))

    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

        # On a brand new database the tables might not exist yet when this
        # function runs. The ALTER TABLE / CREATE INDEX statements below are
        # safe to skip in that case, because Base.metadata.create_all will
        # create the full schema afterwards.
        try:
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS user_id UUID"),
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_process_cases_user_id ON process_cases (user_id)"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS ai_status TEXT"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS dashboard_snapshot JSON"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS rescisoria_snapshot JSON"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS ai_stage TEXT"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS ai_stage_label TEXT"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS ai_progress_percent INTEGER"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS ai_stage_updated_at TIMESTAMPTZ"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS ai_attempts INTEGER"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS ai_last_error TEXT"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS ai_next_retry_at TIMESTAMPTZ"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS public_sync_triggered BOOLEAN"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS public_sync_status TEXT"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS public_sync_elapsed_ms INTEGER"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS public_sync_source_count INTEGER"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS public_sync_error_count INTEGER"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS public_sync_at TIMESTAMPTZ"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS authority_display TEXT"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS user_party TEXT"),
            )
            if allow_data_migrations:
                connection.execute(
                    text("UPDATE process_cases SET ai_status = COALESCE(ai_status, 'queued')"),
                )
                connection.execute(
                    text("UPDATE process_cases SET ai_stage = COALESCE(ai_stage, 'extraction')"),
                )
                connection.execute(
                    text("UPDATE process_cases SET ai_progress_percent = COALESCE(ai_progress_percent, 0)"),
                )
                connection.execute(
                    text("UPDATE process_cases SET ai_attempts = COALESCE(ai_attempts, 0)"),
                )
                connection.execute(
                    text("UPDATE process_cases SET public_sync_triggered = COALESCE(public_sync_triggered, false)"),
                )
                connection.execute(
                    text(
                        "UPDATE process_cases "
                        "SET authority_display = COALESCE("
                        "NULLIF(trim(authority_display), ''), "
                        "NULLIF(trim(extracted_fields->>'authority_display'), ''), "
                        "NULLIF(trim(judge), '')"
                        ") "
                        "WHERE authority_display IS NULL "
                        "OR trim(authority_display) = ''",
                    ),
                )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_process_cases_ai_status ON process_cases (ai_status)"),
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_process_cases_ai_stage ON process_cases (ai_stage)"),
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_process_cases_ai_next_retry_at ON process_cases (ai_next_retry_at)"),
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_process_cases_public_sync_triggered ON process_cases (public_sync_triggered)"),
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_process_cases_public_sync_status ON process_cases (public_sync_status)"),
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_process_cases_authority_display ON process_cases (authority_display)"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS strategic_alerts ADD COLUMN IF NOT EXISTS action_target JSON"),
            )
            connection.execute(
                text("ALTER TABLE IF EXISTS ai_messages ADD COLUMN IF NOT EXISTS user_id UUID"),
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_ai_messages_user_id ON ai_messages (user_id)"),
            )
        except ProgrammingError as exc:  # table might not exist yet on fresh DB
            # If the error is "relation ... does not exist", ignore it and
            # rely on metadata.create_all() to create the full schema.
            message = str(getattr(exc.orig, "pgerror", "")) or str(exc)
            if "does not exist" not in message:
                raise
    Base.metadata.create_all(bind=engine)

    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_strategic_alerts_user_status_last_detected "
                "ON strategic_alerts (user_id, status, last_detected_at DESC)",
            ),
        )


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
