"""
Supabase Database Service

Provides a wrapper around the Supabase client for database operations.
Uses the service role key to bypass RLS for backend operations.
"""

import os
from typing import Optional, Dict, Any, List
from datetime import datetime
from supabase import create_client, Client

# Environment variables are loaded from secrets.toml via core/config.py


class SupabaseDBService:
    """Service for interacting with Supabase PostgreSQL database"""

    def __init__(self):
        self.url = os.getenv("SUPABASE_URL", "http://localhost:8000")
        self.service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not self.service_key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY not configured")

        # Create client with service role key (bypasses RLS)
        self.client: Client = create_client(self.url, self.service_key)

    # ==========================================
    # Session Operations
    # ==========================================

    def create_session(
        self,
        user_id: str,
        name: str = "Untitled Session",
        last_step: str = "upload",
        configuration: Optional[Dict[str, Any]] = None,
        evaluation_config: Optional[Dict[str, Any]] = None,
        files_config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a new session for a user"""
        data = {
            "user_id": user_id,
            "name": name,
            "status": "in_progress",
            "last_step": last_step,
            "configuration": configuration or {},
            "evaluation_config": evaluation_config or {},
            "files_config": files_config or {},
        }

        result = self.client.table("sessions").insert(data).execute()
        return result.data[0] if result.data else None

    def get_session(self, session_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Get a session by ID with related documents and extraction counts"""
        result = (
            self.client.table("sessions")
            .select("*")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
        )

        if not result.data:
            return None

        session = result.data[0]

        # Get documents for this session
        docs_result = (
            self.client.table("documents")
            .select("*")
            .eq("session_id", session_id)
            .execute()
        )
        session["documents"] = docs_result.data or []

        # Get extraction results - order by entity_name for consistent ordering
        extractions_result = (
            self.client.table("extraction_results")
            .select("*")
            .eq("session_id", session_id)
            .order("entity_name")
            .order("model_id")
            .execute()
        )
        session["extraction_results"] = extractions_result.data or []

        # Get evaluation results for extractions - order for consistent results
        if session["extraction_results"]:
            extraction_ids = [e["id"] for e in session["extraction_results"]]
            evals_result = (
                self.client.table("evaluation_results")
                .select("*")
                .in_("extraction_result_id", extraction_ids)
                .order("extraction_result_id")
                .order("judge_model")
                .order("metric")
                .execute()
            )
            session["evaluation_results"] = evals_result.data or []
        else:
            session["evaluation_results"] = []

        return session

    def list_sessions(
        self, user_id: str, limit: int = 50, offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List all sessions for a user with counts and document names"""
        result = (
            self.client.table("sessions")
            .select(
                "id, name, status, last_step, configuration, evaluation_config, files_config, created_at, updated_at"
            )
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )

        sessions = result.data or []

        if not sessions:
            return sessions

        # Batch get counts and document info for all sessions
        session_ids = [s["id"] for s in sessions]

        # Get documents with filenames for all sessions
        docs_result = (
            self.client.table("documents")
            .select("session_id, filename")
            .in_("session_id", session_ids)
            .execute()
        )
        docs_by_session: Dict[str, List[str]] = {}
        for doc in docs_result.data or []:
            sid = doc["session_id"]
            if sid not in docs_by_session:
                docs_by_session[sid] = []
            docs_by_session[sid].append(doc["filename"])

        # Get extraction counts for all sessions
        ext_result = (
            self.client.table("extraction_results")
            .select("session_id")
            .in_("session_id", session_ids)
            .execute()
        )
        ext_counts: Dict[str, int] = {}
        for ext in ext_result.data or []:
            sid = ext["session_id"]
            ext_counts[sid] = ext_counts.get(sid, 0) + 1

        # Apply counts and document names to sessions
        for session in sessions:
            sid = session["id"]
            doc_names = docs_by_session.get(sid, [])
            session["document_count"] = len(doc_names)
            session["document_names"] = doc_names
            session["extraction_count"] = ext_counts.get(sid, 0)
            # Extract study_type from configuration
            config = session.get("configuration", {})
            session["study_type"] = config.get("study_type") if config else None

        return sessions

    def update_session(
        self, session_id: str, user_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a session"""
        # Filter out None values
        data = {k: v for k, v in updates.items() if v is not None}

        result = (
            self.client.table("sessions")
            .update(data)
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
        )

        return result.data[0] if result.data else None

    def delete_session(self, session_id: str, user_id: str) -> bool:
        """Delete a session (cascades to documents, extractions, evaluations)"""
        result = (
            self.client.table("sessions")
            .delete()
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
        )

        return len(result.data) > 0 if result.data else False

    # ==========================================
    # Auth History Operations
    # ==========================================

    def record_login(
        self,
        user_id: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Record a user login event"""
        data = {
            "user_id": user_id,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "login_at": datetime.utcnow().isoformat(),
        }

        result = self.client.table("login_history").insert(data).execute()
        return result.data[0] if result.data else None

    # ==========================================
    # Document Operations
    # ==========================================

    def create_document(
        self,
        user_id: str,
        file_hash: str,
        filename: str,
        session_id: Optional[str] = None,
        file_path: Optional[str] = None,
        study_type: Optional[str] = None,
        processor_used: Optional[str] = None,
        parse_cost: Optional[float] = None,
        page_count: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Create a document record"""
        data = {
            "session_id": session_id,
            "user_id": user_id,
            "file_hash": file_hash,
            "filename": filename,
            "file_path": file_path,
            "study_type": study_type,
            "processing_status": "pending",
        }
        if parse_cost is not None:
            data["parse_cost"] = parse_cost
        if page_count is not None:
            data["page_count"] = page_count
        if processor_used is not None:
            data["processor_used"] = processor_used

        result = self.client.table("documents").insert(data).execute()
        return result.data[0] if result.data else None

    def get_document(self, document_id: str) -> Optional[Dict[str, Any]]:
        """Get a document by ID"""
        result = (
            self.client.table("documents").select("*").eq("id", document_id).execute()
        )

        return result.data[0] if result.data else None

    def get_documents_by_session(self, session_id: str) -> List[Dict[str, Any]]:
        """Get all documents for a session"""
        result = (
            self.client.table("documents")
            .select("*")
            .eq("session_id", session_id)
            .execute()
        )

        return result.data or []

    def get_parse_cost_by_file_hash(self, file_hash: str) -> Optional[float]:
        """Return any previously stored parse_cost for this file_hash across all sessions.

        Used as a Tier-4 fallback for Docling cached docs whose metadata.json predates the
        parse_duration_seconds field — looks up the cost that was stored during the original
        fresh processing run (potentially in a different session).
        """
        try:
            result = (
                self.client.table("documents")
                .select("parse_cost")
                .eq("file_hash", file_hash)
                .gt("parse_cost", 0)
                .limit(1)
                .execute()
            )
            if result.data:
                return float(result.data[0]["parse_cost"])
        except Exception as e:
            print(f"[COST_TRACKER] get_parse_cost_by_file_hash failed: {e}")
        return None

    def list_user_documents(self, user_id: str) -> List[Dict[str, Any]]:
        """Get all documents for a user (from all sessions)"""
        # Select distinct document by file_hash to avoid duplicates in the list view
        # if a file is used in multiple sessions. However, Supabase/PG doesn't support
        # SELECT DISTINCT ON with the Python client easily without raw SQL.
        # So we fetch all and deduplicate in Python.
        result = (
            self.client.table("documents")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )

        docs = result.data or []

        # Deduplicate by file_hash, keeping the most recent one
        seen_hashes = set()
        unique_docs = []

        for doc in docs:
            if doc["file_hash"] not in seen_hashes:
                seen_hashes.add(doc["file_hash"])
                unique_docs.append(doc)

        return unique_docs

    def update_document(
        self, document_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a document"""
        data = {k: v for k, v in updates.items() if v is not None}

        result = (
            self.client.table("documents").update(data).eq("id", document_id).execute()
        )

        return result.data[0] if result.data else None

    def update_document_processing(
        self,
        document_id: str,
        processor_used: str,
        status: str,
        extracted_text_path: Optional[str] = None,
        error: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update document processing status"""
        data = {
            "processor_used": processor_used,
            "processing_status": status,
            "extracted_text_path": extracted_text_path,
            "processing_error": error,
        }

        if status == "completed":
            data["processed_at"] = datetime.utcnow().isoformat()

        return self.update_document(document_id, data)

    # ==========================================
    # Extraction Result Operations
    # ==========================================

    def upsert_extraction_result(
        self,
        session_id: str,
        document_id: str,
        entity_name: str,
        model_id: str,
        extracted_text: Optional[str] = None,
        bbox_references: Optional[List[Dict[str, Any]]] = None,
        status: str = "pending",
        error_message: Optional[str] = None,
        prompt_tokens: Optional[int] = None,
        completion_tokens: Optional[int] = None,
        duration_ms: Optional[int] = None,
        cost: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Create or update an extraction result"""
        data = {
            "session_id": session_id,
            "document_id": document_id,
            "entity_name": entity_name,
            "model_id": model_id,
            "extracted_text": extracted_text,
            "bbox_references": bbox_references,
            "status": status,
            "error_message": error_message,
        }
        # Only include cost/token fields if they have values, so a second write
        # without these fields never overwrites an already-persisted cost.
        if prompt_tokens is not None:
            data["prompt_tokens"] = prompt_tokens
        if completion_tokens is not None:
            data["completion_tokens"] = completion_tokens
        if duration_ms is not None:
            data["duration_ms"] = duration_ms
        if cost is not None:
            data["cost"] = cost

        if status == "completed":
            data["extracted_at"] = datetime.utcnow().isoformat()

        result = (
            self.client.table("extraction_results")
            .upsert(data, on_conflict="document_id,entity_name,model_id")
            .execute()
        )

        return result.data[0] if result.data else None

    def update_extraction_cost(self, extraction_id: str, cost: float) -> None:
        """Backfill a recomputed extraction cost into the DB."""
        try:
            self.client.table("extraction_results").update({"cost": cost}).eq(
                "id", extraction_id
            ).execute()
        except Exception as e:
            print(f"[COST_TRACKER] Failed to backfill extraction cost: {e}")

    def get_extraction_results_by_session(
        self, session_id: str
    ) -> List[Dict[str, Any]]:
        """Get all extraction results for a session"""
        result = (
            self.client.table("extraction_results")
            .select("*, documents(filename, study_type)")
            .eq("session_id", session_id)
            .execute()
        )

        return result.data or []

    def get_extraction_results_by_document(
        self, document_id: str
    ) -> List[Dict[str, Any]]:
        """Get all extraction results for a document"""
        result = (
            self.client.table("extraction_results")
            .select("*")
            .eq("document_id", document_id)
            .execute()
        )

        return result.data or []

    # ==========================================
    # Evaluation Result Operations
    # ==========================================

    def upsert_evaluation_result(
        self,
        extraction_result_id: str,
        metric: str,
        score: Optional[float] = None,
        reasoning: Optional[str] = None,
        judge_model: Optional[str] = None,
        human_score: Optional[float] = None,
        ground_truth: Optional[str] = None,
        evaluation_cost: Optional[float] = None,
        evaluation_time: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Create or update an evaluation result"""
        data = {
            "extraction_result_id": extraction_result_id,
            "metric": metric,
            "score": score,
            "reasoning": reasoning,
            "judge_model": judge_model,
            "human_score": human_score,
            "ground_truth": ground_truth,
            "evaluated_at": datetime.utcnow().isoformat(),
        }
        # Only include cost/time if provided (to avoid overwriting existing values)
        if evaluation_cost is not None:
            data["evaluation_cost"] = evaluation_cost
        if evaluation_time is not None:
            data["evaluation_time"] = evaluation_time

        result = (
            self.client.table("evaluation_results")
            .upsert(data, on_conflict="extraction_result_id,metric,judge_model")
            .execute()
        )

        return result.data[0] if result.data else None

    def get_evaluation_results_by_extraction(
        self, extraction_result_id: str
    ) -> List[Dict[str, Any]]:
        """Get all evaluation results for an extraction"""
        result = (
            self.client.table("evaluation_results")
            .select("*")
            .eq("extraction_result_id", extraction_result_id)
            .execute()
        )

        return result.data or []

    # ==========================================
    # User Preferences Operations
    # ==========================================

    def get_or_create_preferences(self, user_id: str) -> Dict[str, Any]:
        """Get user preferences, creating defaults if not exists"""
        result = (
            self.client.table("user_preferences")
            .select("*")
            .eq("user_id", user_id)
            .execute()
        )

        if result.data:
            return result.data[0]

        # Create default preferences
        data = {
            "user_id": user_id,
            "default_models": [],
            "default_temperature": 0.0,
            "settings": {},
        }

        result = self.client.table("user_preferences").insert(data).execute()
        return result.data[0] if result.data else data

    def update_preferences(
        self, user_id: str, updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update user preferences"""
        data = {k: v for k, v in updates.items() if v is not None}

        result = (
            self.client.table("user_preferences")
            .upsert({"user_id": user_id, **data})
            .execute()
        )

        return result.data[0] if result.data else None

    # ==========================================
    # User Prompt Templates Operations
    # ==========================================

    def save_prompt_template(
        self,
        user_id: str,
        name: str,
        entity_name: str,
        prompt_content: str,
        study_type: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Save or update a user's custom prompt template"""
        data = {
            "user_id": user_id,
            "name": name,
            "entity_name": entity_name,
            "prompt_content": prompt_content,
            "study_type": study_type,
            "system_prompt": system_prompt,
        }

        result = (
            self.client.table("user_prompt_templates")
            .upsert(data, on_conflict="user_id,name,entity_name")
            .execute()
        )

        return result.data[0] if result.data else None

    def get_prompt_templates(
        self, user_id: str, study_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get user's custom prompt templates"""
        query = (
            self.client.table("user_prompt_templates")
            .select("*")
            .eq("user_id", user_id)
        )

        if study_type:
            query = query.eq("study_type", study_type)

        result = query.execute()
        return result.data or []

    def delete_prompt_template(self, template_id: str, user_id: str) -> bool:
        """Delete a prompt template"""
        result = (
            self.client.table("user_prompt_templates")
            .delete()
            .eq("id", template_id)
            .eq("user_id", user_id)
            .execute()
        )

        return len(result.data) > 0 if result.data else False

    # ==========================================
    # Session Metrics Operations
    # ==========================================

    def increment_session_metrics(
        self,
        session_id: str,
        cost: float = 0.0,
        latency: float = 0.0,
    ) -> bool:
        """Increment session metrics (total_cost, total_latency, total_calls)"""
        try:
            # Use RPC to atomically increment values
            # First get current values
            result = (
                self.client.table("sessions")
                .select("total_cost, total_latency, total_calls")
                .eq("id", session_id)
                .execute()
            )

            if not result.data:
                print(f"[DB] Session {session_id} not found for metrics update")
                return False

            current = result.data[0]
            new_cost = float(current.get("total_cost") or 0) + cost
            new_latency = float(current.get("total_latency") or 0) + latency
            new_calls = int(current.get("total_calls") or 0) + 1

            # Update with new values
            self.client.table("sessions").update(
                {
                    "total_cost": new_cost,
                    "total_latency": new_latency,
                    "total_calls": new_calls,
                }
            ).eq("id", session_id).execute()

            return True
        except Exception as e:
            print(f"[DB] Failed to increment session metrics: {e}")
            return False

    def get_session_metrics(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get session metrics from sessions table"""
        try:
            result = (
                self.client.table("sessions")
                .select("total_cost, total_latency, total_calls")
                .eq("id", session_id)
                .execute()
            )

            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            print(f"[DB] Failed to get session metrics: {e}")
            return None

    def reset_session_metrics(self, session_id: str) -> bool:
        """Reset session metrics to zero"""
        try:
            self.client.table("sessions").update(
                {
                    "total_cost": 0,
                    "total_latency": 0,
                    "total_calls": 0,
                }
            ).eq("id", session_id).execute()
            return True
        except Exception as e:
            print(f"[DB] Failed to reset session metrics: {e}")
            return False


# Singleton instance
_db_service: Optional[SupabaseDBService] = None


def get_db_service() -> SupabaseDBService:
    """Get the singleton database service instance"""
    global _db_service
    if _db_service is None:
        _db_service = SupabaseDBService()
    return _db_service
