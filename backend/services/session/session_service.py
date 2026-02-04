"""
Session service for managing user extraction sessions

This service now uses Supabase PostgreSQL for storage instead of JSON files.
"""

import os
from pathlib import Path
from typing import Optional, List, Dict, Any
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
from services.database import get_db_service, SupabaseDBService


class SessionService:
    """Service for managing user sessions with database storage"""

    def __init__(self):
        self.db: SupabaseDBService = get_db_service()
        # Cache for document lookups to avoid repeated queries
        self._doc_cache: Dict[str, List[Dict[str, Any]]] = {}

    def _parse_timestamp(self, ts_str: Optional[str]) -> datetime:
        """Parse timestamp string with variable microsecond precision"""
        if not ts_str:
            return datetime.utcnow()

        try:
            # Try standard parsing first
            return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except ValueError:
            # Manual Fix for variable precision
            if ts_str.endswith("+00:00"):
                main_part = ts_str[:-6]
                timezone = "+00:00"
            elif ts_str.endswith("Z"):
                main_part = ts_str[:-1]
                timezone = "+00:00"
            else:
                main_part = ts_str
                timezone = ""

            # Pad microseconds to 6 digits if present
            if "." in main_part:
                date_part, micro_part = main_part.split(".")
                if len(micro_part) < 6:
                    micro_part = micro_part.ljust(6, "0")
                elif len(micro_part) > 6:
                    micro_part = micro_part[:6]
                main_part = f"{date_part}.{micro_part}"

            try:
                return datetime.fromisoformat(f"{main_part}{timezone}")
            except ValueError:
                # Fallback to UTC now if parsing fails completely
                print(
                    f"Warning: Failed to parse timestamp {ts_str}, defaulting to utcnow"
                )
                return datetime.utcnow()

    def create_session(self, request: CreateSessionRequest) -> Session:
        """Create a new session for a user"""
        # Prepare configuration as dict
        config_dict = {}
        if request.configuration:
            config_dict = request.configuration.model_dump()

        # Create in database
        db_session = self.db.create_session(
            user_id=request.user_id,
            name=request.name or "Untitled Session",
            last_step=request.last_step or "upload",
            configuration=config_dict,
            evaluation_config=request.evaluation_config or {},
            files_config=request.files_config or {},
        )
        # Create documents if provided
        documents = []
        if request.documents:
            for doc in request.documents:
                db_doc = self.db.create_document(
                    session_id=db_session["id"],
                    user_id=request.user_id,
                    file_hash=doc.file_hash,
                    filename=doc.filename,
                )
                documents.append(
                    SessionDocument(
                        **{
                            "file_hash": db_doc["file_hash"],
                            "filename": db_doc["filename"],
                        }
                    )
                )

        # Convert to Session model
        return Session(
            session_id=db_session["id"],
            user_id=request.user_id,
            name=db_session["name"],
            status=db_session["status"],
            last_step=db_session.get("last_step", "upload"),
            evaluation_config=db_session.get("evaluation_config", {}),
            files_config=db_session.get("files_config", {}),
            created_at=self._parse_timestamp(db_session["created_at"]),
            updated_at=self._parse_timestamp(db_session["updated_at"]),
            configuration=(
                SessionConfiguration(**config_dict)
                if config_dict
                else SessionConfiguration()
            ),
            documents=documents,
            extraction_results=[],
            evaluation_results=[],
        )

    def get_session(self, user_id: str, session_id: str) -> Optional[Session]:
        """Get a session by ID with all related data"""
        db_session = self.db.get_session(session_id, user_id)

        if not db_session:
            return None

        return self._db_to_session(db_session)

    def list_sessions(self, user_id: str) -> List[SessionSummary]:
        """List all sessions for a user"""
        db_sessions = self.db.list_sessions(user_id)

        summaries = []
        for db_session in db_sessions:
            summary = SessionSummary(
                session_id=db_session["id"],
                name=db_session["name"],
                status=db_session["status"],
                last_step=db_session.get("last_step", "upload"),
                study_type=db_session.get("study_type"),
                created_at=self._parse_timestamp(db_session["created_at"]),
                updated_at=self._parse_timestamp(db_session["updated_at"]),
                document_count=db_session.get("document_count", 0),
                document_names=db_session.get("document_names", []),
                extraction_count=db_session.get("extraction_count", 0),
                evaluation_count=0,  # TODO: Add evaluation count query
            )
            summaries.append(summary)

        return summaries

    def update_session(
        self, user_id: str, session_id: str, request: UpdateSessionRequest
    ) -> Optional[Session]:
        """Update an existing session"""
        updates = {}

        if request.name is not None:
            updates["name"] = request.name
        if request.status is not None:
            updates["status"] = request.status
        if request.configuration is not None:
            updates["configuration"] = request.configuration.model_dump()
        if request.last_step is not None:
            updates["last_step"] = request.last_step
        # Fetch existing session once if we need to merge configs
        existing_session = None
        if request.evaluation_config is not None or request.files_config is not None:
            existing_session = self.db.get_session(session_id, user_id)

        if request.evaluation_config is not None:
            # Merge evaluation_config with existing instead of replacing
            existing_eval_config = (
                existing_session.get("evaluation_config", {})
                if existing_session
                else {}
            )
            merged_eval_config = {**existing_eval_config, **request.evaluation_config}
            updates["evaluation_config"] = merged_eval_config
        if request.files_config is not None:
            # Merge files_config with existing instead of replacing
            # This preserves ground_truths and other per-file configs when updating one file
            existing_files_config = (
                existing_session.get("files_config", {}) if existing_session else {}
            )

            # Deep merge: for each file, merge its config
            merged_files_config = {**existing_files_config}
            for file_id, file_config in request.files_config.items():
                if file_id in merged_files_config:
                    # Merge with existing file config
                    merged_files_config[file_id] = {
                        **merged_files_config[file_id],
                        **file_config,
                    }
                else:
                    merged_files_config[file_id] = file_config
            updates["files_config"] = merged_files_config
        if updates:
            self.db.update_session(session_id, user_id, updates)

        # Handle document updates
        if request.documents is not None:
            # Get existing documents
            existing_docs = self.db.get_documents_by_session(session_id)
            existing_hashes = {d["file_hash"] for d in existing_docs}

            # Add new documents
            for doc in request.documents:
                if doc.file_hash not in existing_hashes:
                    self.db.create_document(
                        session_id=session_id,
                        user_id=user_id,
                        file_hash=doc.file_hash,
                        filename=doc.filename,
                    )

        # Handle extraction results updates
        if request.extraction_results is not None:
            # Get document mapping (file_hash -> document_id)
            docs = self.db.get_documents_by_session(session_id)
            # For now, use session_id for extractions without specific document
            for result in request.extraction_results:
                # Find matching document if possible
                doc_id = None
                if docs:
                    doc_id = docs[0]["id"]  # Default to first document

                self.db.upsert_extraction_result(
                    session_id=session_id,
                    document_id=doc_id,
                    entity_name=result.entity_name,
                    model_id=result.model_id,
                    extracted_text=result.extracted_text,
                    bbox_references=result.references,
                    status=result.status,
                    error_message=result.error_message,
                )

        # Handle evaluation results updates
        if request.evaluation_results is not None:
            # Get extraction results mapping
            extractions = self.db.get_extraction_results_by_session(session_id)
            extraction_map = {
                (e["entity_name"], e["model_id"]): e["id"] for e in extractions
            }

            for eval_result in request.evaluation_results:
                extraction_id = extraction_map.get(
                    (eval_result.entity_name, eval_result.model_id)
                )
                if extraction_id:
                    for score in eval_result.scores:
                        self.db.upsert_evaluation_result(
                            extraction_result_id=extraction_id,
                            metric=score.metric,
                            score=score.score,
                            reasoning=score.reasoning,
                            judge_model=score.judge_model,
                            human_score=eval_result.human_score,
                            ground_truth=eval_result.ground_truth,
                        )

        # Return updated session
        return self.get_session(user_id, session_id)

    def delete_session(self, user_id: str, session_id: str) -> bool:
        """Delete a session (cascades to all related data)"""
        return self.db.delete_session(session_id, user_id)

    def add_extraction_result(
        self,
        user_id: str,
        session_id: str,
        result: ExtractionResult,
        document_id: Optional[str] = None,
    ) -> Optional[Session]:
        """Add or update an extraction result in a session"""
        # Use fast insert then return session
        success = self.add_extraction_result_fast(
            user_id, session_id, result, document_id
        )
        if not success:
            return None
        return self.get_session(user_id, session_id)

    def add_extraction_result_fast(
        self,
        user_id: str,
        session_id: str,
        result: ExtractionResult,
        document_id: Optional[str] = None,
    ) -> bool:
        """Fast upsert extraction result without returning full session"""
        # If no document_id provided, try to find one from cache or session
        if not document_id:
            # Check cache first
            if session_id in self._doc_cache:
                docs = self._doc_cache[session_id]
            else:
                docs = self.db.get_documents_by_session(session_id)
                self._doc_cache[session_id] = docs

            if docs:
                # If file_hash provided, find specific document
                if result.file_hash:
                    matched_doc = next(
                        (d for d in docs if d.get("file_hash") == result.file_hash),
                        None,
                    )
                    if matched_doc:
                        document_id = matched_doc["id"]
                    else:
                        # Do NOT fallback - fail the operation to prevent cross-contamination
                        return False
                else:
                    # Only use first document as fallback for single-file sessions
                    if len(docs) == 1:
                        document_id = docs[0]["id"]
                    else:
                        return False

        if not document_id:
            return False

        self.db.upsert_extraction_result(
            session_id=session_id,
            document_id=document_id,
            entity_name=result.entity_name,
            model_id=result.model_id,
            extracted_text=result.extracted_text,
            bbox_references=result.references,
            status=result.status,
            error_message=result.error_message,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            duration_ms=result.duration_ms,
            cost=result.cost,
        )

        return True

    def add_evaluation_result(
        self, user_id: str, session_id: str, result: EvaluationResult
    ) -> Optional[Session]:
        """Add or update an evaluation result in a session"""
        success = self.add_evaluation_result_fast(user_id, session_id, result)
        if not success:
            return None
        return self.get_session(user_id, session_id)

    def add_evaluation_result_fast(
        self, user_id: str, session_id: str, result: EvaluationResult
    ) -> bool:
        """Fast upsert evaluation result without returning full session"""
        # Find the extraction result
        extractions = self.db.get_extraction_results_by_session(session_id)
        extraction_id = None

        # If file_hash is provided, look up the document_id first
        target_document_id = result.document_id
        if result.file_hash and not target_document_id:
            # Look up document by file_hash to get document_id
            documents = self.db.get_documents_by_session(session_id)
            for doc in documents:
                if doc.get("file_hash") == result.file_hash:
                    target_document_id = doc.get("id")
                    break

        for ext in extractions:
            # Match by entity_name and model_id
            if (
                ext["entity_name"] == result.entity_name
                and ext["model_id"] == result.model_id
            ):
                # If we have a target document, also match by document_id
                if target_document_id:
                    if ext.get("document_id") == target_document_id:
                        extraction_id = ext["id"]
                        break
                else:
                    # No document specified, use first match (legacy behavior)
                    extraction_id = ext["id"]
                    break

        if not extraction_id:
            print(
                f"Warning: No extraction found for {result.entity_name}/{result.model_id}"
                + (f" in document {target_document_id}" if target_document_id else "")
            )
            return False

        # Add each score as a separate evaluation result
        if result.scores:
            # Check if this is a human_score_update request (has judge_model but metric is human_score_update)
            is_human_score_update = any(
                score.metric == "human_score_update" and score.judge_model
                for score in result.scores
            )

            if is_human_score_update and result.human_score is not None:
                # Update human_score only for the specific judge_model
                for score in result.scores:
                    if score.metric == "human_score_update" and score.judge_model:
                        # Find existing evaluations for this judge_model
                        existing_evals = self.db.get_evaluation_results_by_extraction(
                            extraction_id
                        )
                        judge_found = False
                        # Update ALL metrics for this judge_model (not just the first one)
                        for eval_result in existing_evals:
                            if eval_result.get("judge_model") == score.judge_model:
                                # Update this specific judge's evaluation with human_score
                                self.db.upsert_evaluation_result(
                                    extraction_result_id=extraction_id,
                                    metric=eval_result["metric"],
                                    score=eval_result.get("score"),
                                    reasoning=eval_result.get("reasoning"),
                                    judge_model=score.judge_model,
                                    human_score=result.human_score,
                                    ground_truth=result.ground_truth
                                    or eval_result.get("ground_truth"),
                                )
                                judge_found = True
                                # NOTE: Don't break here! Update ALL metrics for this judge
                        # If no evaluation found for this judge, skip saving silently
                        # This can happen if the source model wasn't evaluated with this judge
            else:
                # Regular evaluation scores - save each one
                for score in result.scores:
                    self.db.upsert_evaluation_result(
                        extraction_result_id=extraction_id,
                        metric=score.metric,
                        score=score.score,
                        reasoning=score.reasoning,
                        judge_model=score.judge_model,
                        human_score=result.human_score,
                        ground_truth=result.ground_truth,
                    )
        elif result.human_score is not None:
            # If no scores but we have human_score, update ALL existing evaluations for this extraction
            # This is legacy behavior for backward compatibility
            existing_evals = self.db.get_evaluation_results_by_extraction(extraction_id)
            if existing_evals:
                for eval_result in existing_evals:
                    self.db.upsert_evaluation_result(
                        extraction_result_id=extraction_id,
                        metric=eval_result["metric"],
                        score=eval_result.get("score"),
                        reasoning=eval_result.get("reasoning"),
                        judge_model=eval_result.get("judge_model"),
                        human_score=result.human_score,
                        ground_truth=result.ground_truth
                        or eval_result.get("ground_truth"),
                    )
            else:
                # No existing evaluations, create a placeholder for human score
                self.db.upsert_evaluation_result(
                    extraction_result_id=extraction_id,
                    metric="human_evaluation",
                    score=None,
                    reasoning=None,
                    judge_model=None,
                    human_score=result.human_score,
                    ground_truth=result.ground_truth,
                )

        return True

    def clear_cache(self, session_id: Optional[str] = None):
        """Clear document cache for a session or all sessions"""
        if session_id:
            self._doc_cache.pop(session_id, None)
        else:
            self._doc_cache.clear()

    def _db_to_session(self, db_session: Dict[str, Any]) -> Session:
        """Convert database session to Session model"""
        # Parse configuration
        config_data = db_session.get("configuration", {})
        configuration = (
            SessionConfiguration(**config_data)
            if config_data
            else SessionConfiguration()
        )

        # Parse documents - include id for matching extraction results
        documents = []
        for doc in db_session.get("documents", []):
            documents.append(
                SessionDocument(
                    id=doc[
                        "id"
                    ],  # CRITICAL: Include ID for matching extraction results
                    file_hash=doc["file_hash"],
                    filename=doc["filename"],
                )
            )

        # Parse extraction results
        extraction_results = []
        for ext in db_session.get("extraction_results", []):
            extraction_results.append(
                ExtractionResult(
                    entity_name=ext["entity_name"],
                    model_id=ext["model_id"],
                    document_id=ext.get(
                        "document_id"
                    ),  # CRITICAL: Include document_id for multi-file sessions
                    extracted_text=ext.get("extracted_text"),
                    references=ext.get("bbox_references"),
                    status=ext.get("status", "pending"),
                    error_message=ext.get("error_message"),
                    extracted_at=(
                        self._parse_timestamp(ext["extracted_at"])
                        if ext.get("extracted_at")
                        else None
                    ),
                    # Token usage and cost tracking
                    prompt_tokens=ext.get("prompt_tokens"),
                    completion_tokens=ext.get("completion_tokens"),
                    duration_ms=ext.get("duration_ms"),
                    cost=ext.get("cost"),
                )
            )

        # Parse evaluation results (group by document_id + entity_name + model_id)
        # This preserves per-document granularity for human scores
        eval_by_extraction = {}
        for eval_res in db_session.get("evaluation_results", []):
            # Find the matching extraction
            for ext in db_session.get("extraction_results", []):
                if ext["id"] == eval_res["extraction_result_id"]:
                    # Include document_id in key to maintain per-document scores
                    key = (ext["document_id"], ext["entity_name"], ext["model_id"])
                    if key not in eval_by_extraction:
                        eval_by_extraction[key] = {
                            "document_id": ext["document_id"],
                            "entity_name": ext["entity_name"],
                            "model_id": ext["model_id"],
                            "ground_truth": eval_res.get("ground_truth"),
                            "human_score": eval_res.get("human_score"),
                            "evaluated_at": eval_res.get("evaluated_at"),
                            "scores": [],
                        }
                    else:
                        # IMPORTANT: Update human_score and ground_truth from ANY matching eval_res
                        # to ensure we capture the most recent values (they could be on any row)
                        if eval_res.get("human_score") is not None:
                            eval_by_extraction[key]["human_score"] = eval_res.get(
                                "human_score"
                            )
                        if eval_res.get("ground_truth"):
                            eval_by_extraction[key]["ground_truth"] = eval_res.get(
                                "ground_truth"
                            )
                        if eval_res.get("evaluated_at"):
                            eval_by_extraction[key]["evaluated_at"] = eval_res.get(
                                "evaluated_at"
                            )

                    eval_by_extraction[key]["scores"].append(
                        {
                            "metric": eval_res["metric"],
                            "score": eval_res.get("score"),
                            "reasoning": eval_res.get("reasoning"),
                            "judge_model": eval_res.get("judge_model"),
                            "human_score": eval_res.get(
                                "human_score"
                            ),  # Include per-judge human_score
                        }
                    )
                    break

        evaluation_results = []
        for data in eval_by_extraction.values():
            from schemas.sessions import EvaluationScore

            scores = [EvaluationScore(**s) for s in data["scores"]]
            evaluation_results.append(
                EvaluationResult(
                    document_id=data.get("document_id"),
                    entity_name=data["entity_name"],
                    model_id=data["model_id"],
                    ground_truth=data.get("ground_truth"),
                    scores=scores,
                    human_score=data.get("human_score"),
                    evaluated_at=(
                        self._parse_timestamp(data["evaluated_at"])
                        if data.get("evaluated_at")
                        else None
                    ),
                )
            )

        # Parse timestamps
        created_at = self._parse_timestamp(db_session.get("created_at"))
        updated_at = self._parse_timestamp(db_session.get("updated_at"))

        return Session(
            session_id=db_session["id"],
            user_id=db_session["user_id"],
            name=db_session["name"],
            status=db_session["status"],
            last_step=db_session.get("last_step", "upload"),
            evaluation_config=db_session.get("evaluation_config", {}),
            files_config=db_session.get("files_config", {}),
            created_at=created_at,
            updated_at=updated_at,
            configuration=configuration,
            documents=documents,
            extraction_results=extraction_results,
            evaluation_results=evaluation_results,
        )


# Singleton instance
_session_service: Optional[SessionService] = None


def get_session_service() -> SessionService:
    """Get the singleton session service instance"""
    global _session_service
    if _session_service is None:
        _session_service = SessionService()
    return _session_service
