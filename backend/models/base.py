"""
SQLAlchemy Base Configuration

Engine, session factory, and Base declarative class.
Reads DATABASE_URL from environment or .env file.
"""

import os
from pathlib import Path
from contextlib import contextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session


def _load_dotenv():
    """Load backend/.env into os.environ (minimal, no dependencies)."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        os.environ.setdefault(key, value)


_load_dotenv()


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models"""

    pass


def _build_database_url() -> str:
    """Build the database URL from environment variables."""
    # Check for explicit DATABASE_URL first
    url = os.getenv("DATABASE_URL")
    if url:
        # Convert asyncpg:// to psycopg2 for sync engine if needed
        if url.startswith("postgresql+asyncpg://"):
            url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
        return url

    # Build from individual components
    host = os.getenv("POSTGRES_HOST", "sciencegptsream2pg.postgres.database.azure.com")
    port = os.getenv("POSTGRES_PORT", "5432")
    user = os.getenv("POSTGRES_USER", "sciencegpt")
    password = os.getenv("POSTGRES_PASSWORD", "")
    database = os.getenv("POSTGRES_DB", "summarization_tool")
    sslmode = os.getenv("POSTGRES_SSLMODE", "require")

    return f"postgresql://{user}:{password}@{host}:{port}/{database}?sslmode={sslmode}"


DATABASE_URL = _build_database_url()

# Global engine and session factory (lazy initialization)
_engine = None
_session_factory = None


def get_engine():
    """Get or create the SQLAlchemy engine (singleton)."""
    global _engine
    if _engine is None:
        _engine = create_engine(
            DATABASE_URL,
            # 1 worker per replica × up to 5 replicas = 5-25 persistent connections.
            # pool_size=5 keeps idle connections low; max_overflow=10 handles bursts.
            # Total worst-case: 5 replicas × 15 = 75 connections (well within PG limits).
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,  # Test connections before using them
            pool_recycle=300,  # Recycle connections every 5 minutes
            echo=False,  # Set True for SQL debugging
        )
    return _engine


def get_session_factory() -> sessionmaker:
    """Get or create the session factory (singleton)."""
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _session_factory


def get_db_session() -> Session:
    """Create a new database session. Caller is responsible for closing it."""
    factory = get_session_factory()
    return factory()


@contextmanager
def db_session_scope():
    """Context manager that provides a transactional scope around operations.

    Usage:
        with db_session_scope() as session:
            session.add(obj)
            # auto-commits on success, auto-rollbacks on exception
    """
    session = get_db_session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
