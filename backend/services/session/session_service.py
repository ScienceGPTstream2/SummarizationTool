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
from services.telemetry.cost_tracker import cost_tracker, infer_provider_from_model_id


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
                try:
                    db_doc = self.db.create_document(
                        session_id=db_session["id"],
                        user_id=request.user_id,
                        file_hash=doc.file_hash,
                        filename=doc.filename,
                        processor_used=doc.processor_used,
                        parse_cost=doc.parse_cost,
                        page_count=doc.page_count,
                        parse_duration_seconds=doc.parse_duration_seconds,
                    )
                    if db_doc is None:
                        print(
                            f"[SESSION] Warning: create_document returned None for {doc.filename}, skipping"
                        )
                        continue
                    documents.append(
                        SessionDocument(
                            **{
                                "file_hash": db_doc["file_hash"],
                                "filename": db_doc["filename"],
                                "processor_used": db_doc.get("processor_used"),
                                "parse_cost": db_doc.get("parse_cost"),
                                "page_count": db_doc.get("page_count"),
                            }
                        )
                    )
                except Exception as e:
                    print(f"[SESSION] Error creating document {doc.filename}: {e}")
                    # Continue — don't let one failed doc abort the whole session

            # If ALL document inserts failed, clean up the orphaned session row
            if not documents:
                print(
                    f"[SESSION] All {len(request.documents)} document inserts failed"
                    f" — deleting orphaned session {db_session['id']}"
                )
                try:
                    self.db.delete_session(db_session["id"], request.user_id)
                except Exception as cleanup_err:
                    print(f"[SESSION] Could not delete orphaned session: {cleanup_err}")
                raise RuntimeError("Failed to insert any documents for this session")

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

        # Fetch LIGHTWEIGHT session (no joins) if we need to merge configs
        existing_session_basic = None
        if request.evaluation_config is not None or request.files_config is not None:
            existing_session_basic = self.db.get_session_basic(session_id, user_id)

        if request.evaluation_config is not None:
            # Merge evaluation_config with existing instead of replacing
            existing_eval_config = (
                existing_session_basic.get("evaluation_config", {})
                if existing_session_basic
                else {}
            )
            merged_eval_config = {**existing_eval_config, **request.evaluation_config}
            updates["evaluation_config"] = merged_eval_config
        if request.files_config is not None:
            # Merge files_config with existing instead of replacing
            # This preserves ground_truths and other per-file configs when updating one file
            existing_files_config = (
                existing_session_basic.get("files_config", {})
                if existing_session_basic
                else {}
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

        # Check if this is a config-only update (no documents/extractions/evaluations)
        has_heavy_updates = (
            request.documents is not None
            or request.extraction_results is not None
            or request.evaluation_results is not None
        )

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
                        processor_used=doc.processor_used,
                        parse_cost=doc.parse_cost,
                        page_count=doc.page_count,
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
                    prompt_tokens=result.prompt_tokens,
                    completion_tokens=result.completion_tokens,
                    duration_ms=result.duration_ms,
                    cost=result.cost,
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

        # For config-only updates, return a lightweight session to avoid
        # expensive joins (documents, extractions, evaluations).
        # The frontend only checks response.ok for these PATCH calls.
        if not has_heavy_updates:
            basic = self.db.get_session_basic(session_id, user_id)
            if basic is None:
                return None
            config_data = basic.get("configuration", {})
            return Session(
                session_id=basic["id"],
                user_id=basic["user_id"],
                name=basic["name"],
                status=basic["status"],
                last_step=basic.get("last_step", "upload"),
                evaluation_config=basic.get("evaluation_config", {}),
                files_config=basic.get("files_config", {}),
                created_at=self._parse_timestamp(basic.get("created_at")),
                updated_at=self._parse_timestamp(basic.get("updated_at")),
                configuration=(
                    SessionConfiguration(**config_data)
                    if config_data
                    else SessionConfiguration()
                ),
                documents=[],
                extraction_results=[],
                evaluation_results=[],
            )

        # Return full session for heavy updates
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

        # Fallback for __paragraph_summary__ when model_id is empty or doesn't match
        # This handles the case where paragraphSummaryModel isn't set in frontend state
        if not extraction_id and result.entity_name == "__paragraph_summary__":
            for ext in extractions:
                if ext["entity_name"] == "__paragraph_summary__":
                    if target_document_id:
                        if ext.get("document_id") == target_document_id:
                            extraction_id = ext["id"]
                            break
                    else:
                        extraction_id = ext["id"]
                        break
            if extraction_id:
                print(
                    f"[Eval] Used entity-name-only fallback for __paragraph_summary__ "
                    f"(sent model_id='{result.model_id}', extraction model_id='{ext.get('model_id','')}')"
                )

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
                        print(
                            f"[Eval] human_score_update: extraction_id={extraction_id}, "
                            f"entity={result.entity_name}, judge={score.judge_model}, "
                            f"human_score={result.human_score}, "
                            f"existing_evals={len(existing_evals)}, "
                            f"existing_judges={[e.get('judge_model') for e in existing_evals]}"
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
                                print(
                                    f"[Eval] ✅ Updated human_score for judge={score.judge_model}, "
                                    f"metric={eval_result['metric']}"
                                )
                                # NOTE: Don't break here! Update ALL metrics for this judge
                        if not judge_found:
                            print(
                                f"[Eval] ⚠️ No existing eval found for judge={score.judge_model}. "
                                f"Creating placeholder for entity={result.entity_name}"
                            )
                            # Create a placeholder evaluation if none exists
                            # This handles the case where paragraph eval was never generated
                            # via /api/paragraph-evaluation/generate
                            self.db.upsert_evaluation_result(
                                extraction_result_id=extraction_id,
                                metric=(
                                    "paragraph_human_eval"
                                    if result.entity_name == "__paragraph_summary__"
                                    else "human_evaluation"
                                ),
                                score=None,
                                reasoning=None,
                                judge_model=score.judge_model,
                                human_score=result.human_score,
                                ground_truth=result.ground_truth,
                            )
            else:
                # Regular evaluation scores - save each one
                # Calculate per-score cost/time (distribute evenly across metrics)
                num_scores = len(result.scores) if result.scores else 1
                per_score_cost = (
                    (result.evaluation_cost / num_scores)
                    if result.evaluation_cost
                    else None
                )
                per_score_time = (
                    (result.evaluation_time / num_scores)
                    if result.evaluation_time
                    else None
                )
                for score in result.scores:
                    self.db.upsert_evaluation_result(
                        extraction_result_id=extraction_id,
                        metric=score.metric,
                        score=score.score,
                        reasoning=score.reasoning,
                        judge_model=score.judge_model,
                        human_score=result.human_score,
                        ground_truth=result.ground_truth,
                        evaluation_cost=per_score_cost,
                        evaluation_time=per_score_time,
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

    # ==========================================
    # Session Sharing
    # ==========================================

    def share_session(
        self, user_id: str, session_id: str, group_id: str
    ) -> Optional[Dict[str, Any]]:
        """Share a session with a group. Only the session owner can share."""
        # Verify the user is a member of the target group
        user_groups = self.db.get_user_group_ids(user_id)
        if group_id not in user_groups:
            return None
        return self.db.share_session(session_id, user_id, group_id)

    def unshare_session(
        self, user_id: str, session_id: str
    ) -> Optional[Dict[str, Any]]:
        """Remove sharing from a session."""
        return self.db.unshare_session(session_id, user_id)

    def list_shared_sessions(self, user_id: str) -> List[SessionSummary]:
        """List sessions shared with groups the user belongs to."""
        group_ids = self.db.get_user_group_ids(user_id)
        if not group_ids:
            return []

        db_sessions = self.db.list_shared_sessions(user_id, group_ids)

        # Resolve group names and sharer names for display
        group_name_cache: Dict[str, str] = {}
        sharer_name_cache: Dict[str, str] = {}

        summaries = []
        for db_session in db_sessions:
            # Resolve group name
            gid = db_session.get("shared_with_group_id")
            group_name = None
            if gid:
                if gid not in group_name_cache:
                    group_name_cache[gid] = (
                        self.db.get_group_name(gid) or "Unknown Group"
                    )
                group_name = group_name_cache[gid]

            # Resolve sharer display name
            sid = db_session.get("shared_by")
            sharer_name = None
            if sid:
                if sid not in sharer_name_cache:
                    sharer_name_cache[sid] = (
                        self.db.get_user_display_name(sid) or "Unknown User"
                    )
                sharer_name = sharer_name_cache[sid]

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
                evaluation_count=0,
                # Extra fields for shared session display
                shared_by_name=sharer_name,
                shared_group_name=group_name,
                shared_at=(
                    self._parse_timestamp(db_session["shared_at"])
                    if db_session.get("shared_at")
                    else None
                ),
                owner_user_id=db_session.get("user_id"),
            )
            summaries.append(summary)

        return summaries

    def get_session_for_shared_view(
        self, requesting_user_id: str, session_id: str
    ) -> Optional[Session]:
        """Get a shared session for viewing. Verifies the requesting user has access via group membership."""
        # Get the session (we need to bypass the user_id check since this is a shared session)
        result = (
            self.db.client.table("sessions")
            .select("*")
            .eq("id", session_id)
            .not_.is_("shared_with_group_id", "null")
            .execute()
        )
        if not result.data:
            return None

        db_session = result.data[0]

        # Verify the requesting user is in the shared group
        group_id = db_session.get("shared_with_group_id")
        if not group_id:
            return None

        user_groups = self.db.get_user_group_ids(requesting_user_id)
        if group_id not in user_groups:
            return None

        # Load full session data (documents, extractions, evaluations)
        docs_result = (
            self.db.client.table("documents")
            .select("*")
            .eq("session_id", session_id)
            .execute()
        )
        db_session["documents"] = docs_result.data or []

        db_session["extraction_results"] = self.db._fetch_all(
            "extraction_results",
            lambda t: t.select("*")
            .eq("session_id", session_id)
            .order("entity_name")
            .order("model_id"),
        )

        if db_session["extraction_results"]:
            extraction_ids = [e["id"] for e in db_session["extraction_results"]]
            all_evals: List[Dict[str, Any]] = []
            batch_size = 50
            for i in range(0, len(extraction_ids), batch_size):
                batch = extraction_ids[i : i + batch_size]
                eval_result = (
                    self.db.client.table("evaluation_results")
                    .select("*")
                    .in_("extraction_result_id", batch)
                    .order("extraction_result_id")
                    .order("judge_model")
                    .order("metric")
                    .execute()
                )
                all_evals.extend(eval_result.data or [])
            db_session["evaluation_results"] = all_evals
        else:
            db_session["evaluation_results"] = []

        return self._db_to_session(db_session)

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
            parse_cost = doc.get("parse_cost")
            # Deterministic recompute fallback: if parse_cost is missing OR 0
            # (e.g., stored as 0 from a previous run where estimation failed),
            # recompute from page_count + processor_used and backfill the DB.
            if not parse_cost:
                processor_used = doc.get("processor_used")
                page_count = doc.get("page_count") or 0
                parse_duration_seconds = doc.get("parse_duration_seconds") or 0.0
                # Only attempt recompute when we have at least one meaningful input.
                # Docling uses cost_per_minute (needs duration); Azure DI uses cost_per_page
                # (needs page_count). Pass both so the formula works for either processor.
                if processor_used and (page_count or parse_duration_seconds):
                    try:
                        parse_cost = cost_tracker.estimate_call_cost(
                            provider="azure",
                            model=processor_used,
                            prompt_tokens=0,
                            completion_tokens=0,
                            page_count=page_count,
                            duration=parse_duration_seconds,
                        )
                        if parse_cost:
                            self.db.update_document(
                                doc["id"], {"parse_cost": parse_cost}
                            )
                    except Exception as e:
                        print(f"[COST_TRACKER] parse_cost recompute failed: {e}")

            documents.append(
                SessionDocument(
                    id=doc[
                        "id"
                    ],  # CRITICAL: Include ID for matching extraction results
                    file_hash=doc["file_hash"],
                    filename=doc["filename"],
                    processor_used=doc.get("processor_used"),
                    parse_cost=parse_cost,
                    page_count=doc.get("page_count"),
                    parse_duration_seconds=doc.get("parse_duration_seconds"),
                )
            )

        # Parse extraction results
        extraction_results = []
        for ext in db_session.get("extraction_results", []):
            cost = ext.get("cost")
            # Deterministic recompute fallback: if cost is missing OR stored as 0
            # (which happens when pricing lookup fails), recompute from token counts.
            if not cost:
                pt = ext.get("prompt_tokens")
                ct = ext.get("completion_tokens")
                if pt is not None or ct is not None:
                    try:
                        provider = infer_provider_from_model_id(ext.get("model_id", ""))
                        _recomputed = cost_tracker.estimate_call_cost(
                            provider=provider,
                            model=ext.get("model_id", ""),
                            prompt_tokens=pt,
                            completion_tokens=ct,
                        )
                        if _recomputed:
                            cost = _recomputed
                            self.db.update_extraction_cost(ext["id"], cost)
                        # else: cost stays None → shows "—" not "0.000000"
                    except Exception as e:
                        print(f"[COST_TRACKER] extraction cost recompute failed: {e}")

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
                    cost=cost,
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
                            "human_score": eval_res.get("human_score"),
                            "evaluation_cost": eval_res.get("evaluation_cost"),
                            "evaluation_time": eval_res.get("evaluation_time"),
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
