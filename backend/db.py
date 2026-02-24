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
        "DATABASE_URL nao configurada. Defina em backend/.env para conectar no Postgres.",
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

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_database() -> None:
    from backend.models import Base

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


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
