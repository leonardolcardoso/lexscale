import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL nao configurada. Defina em backend/.env para conectar no Postgres.",
    )

# For URLs like "postgresql://..." SQLAlchemy defaults to the psycopg2 driver.
# We only install psycopg (psycopg3), so we normalize the URL to explicitly
# use the psycopg dialect instead of requiring psycopg2.
if DATABASE_URL.startswith("postgresql://") and "+psycopg" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_database() -> None:
    from backend.models import Base

    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text("ALTER TABLE IF EXISTS process_cases ADD COLUMN IF NOT EXISTS user_id UUID"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_process_cases_user_id ON process_cases (user_id)"))
        connection.execute(text("ALTER TABLE IF EXISTS ai_messages ADD COLUMN IF NOT EXISTS user_id UUID"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_messages_user_id ON ai_messages (user_id)"))
    Base.metadata.create_all(bind=engine)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
