"""
End-to-End Test: Better Auth + SQLAlchemy Migration

Tests the minimal flow:
  1. SQLAlchemy models load correctly
  2. Database connection works
  3. Tables can be created
  4. A user + session can be inserted (simulating Better Auth)
  5. The FastAPI auth middleware can validate the session
  
Usage:
  cd backend
  DATABASE_URL=postgresql://... python -m pytest tests/test_auth_migration.py -v
  
  Or for a quick smoke test without pytest:
  cd backend
  DATABASE_URL=postgresql://... python tests/test_auth_migration.py
"""

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Test 1: Models load ──────────────────────────────────────────────────

def test_models_load():
    """All SQLAlchemy models should import and register tables."""
    from models import Base
    
    expected_tables = [
        "user", "account", "session", "verification",  # Better Auth
        "app_sessions", "documents", "extraction_results",
        "evaluation_results", "groups", "user_groups",
        "prompt_templates", "template_versions", "template_permissions",
        "user_preferences", "login_history", "user_prompt_templates",
    ]
    actual = set(Base.metadata.tables.keys())
    
    missing = [t for t in expected_tables if t not in actual]
    assert not missing, f"Missing tables: {missing}"
    print(f"✅ Test 1 PASSED: {len(actual)} tables loaded: {sorted(actual)}")


# ── Test 2: Database connection ──────────────────────────────────────────

def test_db_connection():
    """Can connect to Azure Postgres."""
    from models import get_engine
    
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(
            __import__("sqlalchemy").text("SELECT 1 AS ok")
        )
        row = result.fetchone()
        assert row[0] == 1
    print("✅ Test 2 PASSED: Database connection works")


# ── Test 3: Create tables ───────────────────────────────────────────────

def test_create_tables():
    """Create all tables (idempotent — won't fail if they exist)."""
    from models import Base, get_engine
    
    engine = get_engine()
    Base.metadata.create_all(engine)
    
    # Verify tables exist
    from sqlalchemy import inspect
    inspector = inspect(engine)
    db_tables = set(inspector.get_table_names())
    
    expected = {"user", "account", "session", "app_sessions", "documents"}
    present = expected & db_tables
    assert present == expected, f"Missing in DB: {expected - db_tables}"
    print(f"✅ Test 3 PASSED: Tables created in database: {sorted(db_tables)}")


# ── Test 4: Insert user + session (simulate Better Auth) ────────────────

def test_insert_user_and_session():
    """Simulate what Better Auth does: create a user and session."""
    from models import User, AuthSession, get_db_session
    
    db = next(get_db_session())
    try:
        # Create test user
        test_user_id = str(uuid.uuid4())
        test_user = User(
            id=test_user_id,
            name="Migration Test User",
            email=f"test-{test_user_id[:8]}@example.com",
            email_verified=True,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(test_user)
        db.flush()
        
        # Create session (like Better Auth would)
        test_token = f"test-token-{uuid.uuid4()}"
        test_session = AuthSession(
            id=str(uuid.uuid4()),
            user_id=test_user_id,
            token=test_token,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            ip_address="127.0.0.1",
            user_agent="test-agent",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(test_session)
        db.commit()
        
        print(f"✅ Test 4 PASSED: Created user {test_user.email} with session token {test_token[:20]}...")
        return test_token, test_user_id
    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


# ── Test 5: Validate session (like FastAPI middleware) ───────────────────

def test_validate_session(token: str, expected_user_id: str):
    """Simulate what the FastAPI auth middleware does."""
    from sqlalchemy import select
    from models import AuthSession, User, get_db_session
    
    db = next(get_db_session())
    try:
        stmt = (
            select(AuthSession, User)
            .join(User, AuthSession.user_id == User.id)
            .where(AuthSession.token == token)
        )
        result = db.execute(stmt).first()
        assert result is not None, "Session not found!"
        
        auth_session, user = result
        
        # Check not expired
        now = datetime.now(timezone.utc)
        expires = auth_session.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        assert now < expires, "Session should not be expired!"
        
        assert user.id == expected_user_id
        print(f"✅ Test 5 PASSED: Session validated for user {user.email}")
    finally:
        db.close()


# ── Test 6: Create an AppSession (app workflow) ─────────────────────────

def test_create_app_session(user_id: str):
    """Create an extraction workflow session for the user."""
    from models import get_db_session
    from models.app_session import AppSession
    
    db = next(get_db_session())
    try:
        app_session = AppSession(
            id=uuid.uuid4(),
            user_id=user_id,
            name="Migration Test Session",
            status="in_progress",
            last_step="upload",
        )
        db.add(app_session)
        db.commit()
        print(f"✅ Test 6 PASSED: Created app session {app_session.id}")
    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


# ── Cleanup ─────────────────────────────────────────────────────────────

def cleanup_test_data(user_id: str):
    """Remove test data."""
    from sqlalchemy import delete
    from models import User, AuthSession, get_db_session
    from models.app_session import AppSession
    
    db = next(get_db_session())
    try:
        db.execute(delete(AppSession).where(AppSession.user_id == user_id))
        db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
        db.execute(delete(User).where(User.id == user_id))
        db.commit()
        print(f"🧹 Cleanup: removed test data for user {user_id}")
    finally:
        db.close()


# ── Main runner ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("Migration Smoke Test: Better Auth + SQLAlchemy")
    print("=" * 60)
    print()
    
    # Test 1: Models load (no DB needed)
    test_models_load()
    
    # Tests 2-6 need DB connectivity
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url or "localhost" in db_url:
        print()
        print("⚠️  Set DATABASE_URL to run DB tests.")
        print("   Example: DATABASE_URL=postgresql://<user>:<password>@<host>:5432/db python tests/test_auth_migration.py")
        print()
        print("Tests 2-6 SKIPPED (no DB)")
    else:
        print()
        test_db_connection()
        test_create_tables()
        token, user_id = test_insert_user_and_session()
        test_validate_session(token, user_id)
        test_create_app_session(user_id)
        cleanup_test_data(user_id)
    
    print()
    print("=" * 60)
    print("All executed tests PASSED ✅")
    print("=" * 60)
