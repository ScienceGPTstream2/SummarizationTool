"""Session service for managing user extraction sessions"""

import os
import json
from pathlib import Path
from typing import Optional, List
from datetime import datetime

from schemas.sessions import (
    Session,
    SessionConfiguration,
    SessionDocument,
    ExtractionResult,
    EvaluationResult,
    CreateSessionRequest,
    UpdateSessionRequest,
    SessionSummary,
)


class SessionService:
    """Service for managing user sessions with file-based storage"""
    
    def __init__(self, base_path: str = None):
        if base_path is None:
            # Default to backend/files/users
            self.base_path = Path(__file__).parent.parent.parent / "files" / "users"
        else:
            self.base_path = Path(base_path)
    
    def _get_user_sessions_dir(self, user_id: str) -> Path:
        """Get the sessions directory for a user"""
        return self.base_path / user_id / "sessions"
    
    def _get_session_path(self, user_id: str, session_id: str) -> Path:
        """Get the path to a session's JSON file"""
        return self._get_user_sessions_dir(user_id) / session_id / "session.json"
    
    def _ensure_session_dir(self, user_id: str, session_id: str) -> Path:
        """Ensure the session directory exists"""
        session_dir = self._get_user_sessions_dir(user_id) / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir
    
    def create_session(self, request: CreateSessionRequest) -> Session:
        """Create a new session for a user"""
        # Create session with defaults
        session = Session(
            user_id=request.user_id,
            name=request.name or "Untitled Session",
            configuration=request.configuration or SessionConfiguration(),
            documents=request.documents or [],
        )
        
        # Ensure directory exists
        self._ensure_session_dir(request.user_id, session.session_id)
        
        # Save session
        self._save_session(session)
        
        return session
    
    def get_session(self, user_id: str, session_id: str) -> Optional[Session]:
        """Get a session by ID"""
        session_path = self._get_session_path(user_id, session_id)
        
        if not session_path.exists():
            return None
        
        try:
            with open(session_path, "r") as f:
                data = json.load(f)
            return Session(**data)
        except Exception as e:
            print(f"Error loading session {session_id}: {e}")
            return None
    
    def list_sessions(self, user_id: str) -> List[SessionSummary]:
        """List all sessions for a user"""
        sessions_dir = self._get_user_sessions_dir(user_id)
        
        if not sessions_dir.exists():
            return []
        
        summaries = []
        for session_dir in sessions_dir.iterdir():
            if session_dir.is_dir():
                session_file = session_dir / "session.json"
                if session_file.exists():
                    try:
                        with open(session_file, "r") as f:
                            data = json.load(f)
                        
                        summary = SessionSummary(
                            session_id=data.get("session_id", session_dir.name),
                            name=data.get("name", "Untitled"),
                            status=data.get("status", "draft"),
                            created_at=datetime.fromisoformat(data.get("created_at", datetime.utcnow().isoformat())),
                            updated_at=datetime.fromisoformat(data.get("updated_at", datetime.utcnow().isoformat())),
                            document_count=len(data.get("documents", [])),
                            extraction_count=len(data.get("extraction_results", [])),
                            evaluation_count=len(data.get("evaluation_results", [])),
                        )
                        summaries.append(summary)
                    except Exception as e:
                        print(f"Error loading session {session_dir.name}: {e}")
        
        # Sort by updated_at descending (most recent first)
        summaries.sort(key=lambda x: x.updated_at, reverse=True)
        return summaries
    
    def update_session(self, user_id: str, session_id: str, request: UpdateSessionRequest) -> Optional[Session]:
        """Update an existing session"""
        session = self.get_session(user_id, session_id)
        
        if session is None:
            return None
        
        # Update fields if provided
        if request.name is not None:
            session.name = request.name
        if request.status is not None:
            session.status = request.status
        if request.configuration is not None:
            session.configuration = request.configuration
        if request.documents is not None:
            session.documents = request.documents
        if request.extraction_results is not None:
            session.extraction_results = request.extraction_results
        if request.evaluation_results is not None:
            session.evaluation_results = request.evaluation_results
        
        # Update timestamp
        session.updated_at = datetime.utcnow()
        
        # Save updated session
        self._save_session(session)
        
        return session
    
    def delete_session(self, user_id: str, session_id: str) -> bool:
        """Delete a session and its directory"""
        session_dir = self._get_user_sessions_dir(user_id) / session_id
        
        if not session_dir.exists():
            return False
        
        try:
            # Remove all files in the session directory
            import shutil
            shutil.rmtree(session_dir)
            return True
        except Exception as e:
            print(f"Error deleting session {session_id}: {e}")
            return False
    
    def add_extraction_result(
        self, 
        user_id: str, 
        session_id: str, 
        result: ExtractionResult
    ) -> Optional[Session]:
        """Add or update an extraction result in a session"""
        session = self.get_session(user_id, session_id)
        
        if session is None:
            return None
        
        # Check if result already exists (update) or is new (add)
        existing_idx = None
        for idx, existing in enumerate(session.extraction_results):
            if existing.entity_name == result.entity_name and existing.model_id == result.model_id:
                existing_idx = idx
                break
        
        if existing_idx is not None:
            session.extraction_results[existing_idx] = result
        else:
            session.extraction_results.append(result)
        
        session.updated_at = datetime.utcnow()
        self._save_session(session)
        
        return session
    
    def add_evaluation_result(
        self, 
        user_id: str, 
        session_id: str, 
        result: EvaluationResult
    ) -> Optional[Session]:
        """Add or update an evaluation result in a session"""
        session = self.get_session(user_id, session_id)
        
        if session is None:
            return None
        
        # Check if result already exists (update) or is new (add)
        existing_idx = None
        for idx, existing in enumerate(session.evaluation_results):
            if existing.entity_name == result.entity_name and existing.model_id == result.model_id:
                existing_idx = idx
                break
        
        if existing_idx is not None:
            session.evaluation_results[existing_idx] = result
        else:
            session.evaluation_results.append(result)
        
        session.updated_at = datetime.utcnow()
        self._save_session(session)
        
        return session
    
    def _save_session(self, session: Session) -> None:
        """Save a session to disk"""
        session_path = self._get_session_path(session.user_id, session.session_id)
        
        # Ensure directory exists
        session_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Convert to dict with datetime handling
        data = session.model_dump(mode="json")
        
        with open(session_path, "w") as f:
            json.dump(data, f, indent=2, default=str)


# Singleton instance
_session_service: Optional[SessionService] = None


def get_session_service() -> SessionService:
    """Get the singleton session service instance"""
    global _session_service
    if _session_service is None:
        _session_service = SessionService()
    return _session_service
