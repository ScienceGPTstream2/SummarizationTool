"""
SQLAlchemy Database Service

Drop-in replacement for SupabaseDBService.
Uses SQLAlchemy models and Alembic-managed Postgres directly.
All public method signatures are identical to supabase_db_service.py.
"""

import uuid as _uuid_module
from datetime import datetime
from typing import Optional, Dict, Any, List

from sqlalchemy import select, update, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from models import (
    AppSession,
    Document,
    ExtractionResult,
    EvaluationResult,
    UserPreferences,
    LoginHistory,
    UserPromptTemplate,
    Group,
    UserGroup,
    User,
    get_db_session,
)
from models.base import db_session_scope
from utils.text_utils import sanitize_text as _sanitize_text

# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _row_to_dict(obj) -> Dict[str, Any]:
    """Convert a SQLAlchemy model instance to a plain dict.

    Uses column .key (Python attribute name) as dict keys.
    Converts uuid.UUID → str and datetime → ISO-format string.
    """
    result: Dict[str, Any] = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.key)
        if isinstance(val, _uuid_module.UUID):
            val = str(val)
        elif isinstance(val, datetime):
            val = val.isoformat()
        result[col.key] = val
    return result


def _to_uuid(value) -> Optional[_uuid_module.UUID]:
    """Convert a string or UUID to uuid.UUID, or return None."""
    if value is None:
        return None
    if isinstance(value, _uuid_module.UUID):
        return value
    try:
        return _uuid_module.UUID(str(value))
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Service class
# ---------------------------------------------------------------------------


class SQLAlchemyDBService:
    """Database service using SQLAlchemy / Azure Postgres directly."""

    # ======================================================================
    # Session Operations
    # ======================================================================

    def create_session(
        self,
        user_id: str,
        name: str = "Untitled Session",
        last_step: str = "upload",
        configuration: Optional[Dict[str, Any]] = None,
        evaluation_config: Optional[Dict[str, Any]] = None,
        files_config: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        with db_session_scope() as db:
            sess = AppSession(
                user_id=user_id,
                name=name,
                status="in_progress",
                last_step=last_step,
                configuration=configuration or {},
                evaluation_config=evaluation_config or {},
                files_config=files_config or {},
            )
            db.add(sess)
            db.flush()
            return _row_to_dict(sess)

    def get_session(self, session_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Get a session with its documents, extraction results, and evaluations."""
        db = get_db_session()
        try:
            sess = db.execute(
                select(AppSession).where(
                    AppSession.id == _to_uuid(session_id),
                    AppSession.user_id == user_id,
                )
            ).scalar_one_or_none()

            if sess is None:
                return None

            session_dict = _row_to_dict(sess)
            sid = _to_uuid(session_id)

            # Documents
            docs = (
                db.execute(select(Document).where(Document.session_id == sid))
                .scalars()
                .all()
            )
            session_dict["documents"] = [_row_to_dict(d) for d in docs]

            # Extraction results
            exts = (
                db.execute(
                    select(ExtractionResult)
                    .where(ExtractionResult.session_id == sid)
                    .order_by(ExtractionResult.entity_name, ExtractionResult.model_id)
                )
                .scalars()
                .all()
            )
            session_dict["extraction_results"] = [_row_to_dict(e) for e in exts]

            # Evaluation results (batch by extraction IDs)
            if session_dict["extraction_results"]:
                ext_ids = [
                    _to_uuid(e["id"]) for e in session_dict["extraction_results"]
                ]
                evals = (
                    db.execute(
                        select(EvaluationResult)
                        .where(EvaluationResult.extraction_result_id.in_(ext_ids))
                        .order_by(
                            EvaluationResult.extraction_result_id,
                            EvaluationResult.judge_model,
                            EvaluationResult.metric,
                        )
                    )
                    .scalars()
                    .all()
                )
                session_dict["evaluation_results"] = [_row_to_dict(ev) for ev in evals]
            else:
                session_dict["evaluation_results"] = []

            return session_dict
        finally:
            db.close()

    def list_sessions(
        self, user_id: str, limit: int = 50, offset: int = 0
    ) -> List[Dict[str, Any]]:
        db = get_db_session()
        try:
            sessions = (
                db.execute(
                    select(AppSession)
                    .where(AppSession.user_id == user_id)
                    .order_by(AppSession.updated_at.desc())
                    .offset(offset)
                    .limit(limit)
                )
                .scalars()
                .all()
            )

            if not sessions:
                return []

            result = [_row_to_dict(s) for s in sessions]
            session_ids = [_to_uuid(s["id"]) for s in result]

            # Batch-fetch document filenames
            docs = db.execute(
                select(Document.session_id, Document.filename).where(
                    Document.session_id.in_(session_ids)
                )
            ).all()
            docs_by_session: Dict[str, List[str]] = {}
            for doc in docs:
                sid = str(doc.session_id)
                docs_by_session.setdefault(sid, []).append(doc.filename)

            # Batch-fetch extraction counts
            from sqlalchemy import func

            ext_counts_rows = db.execute(
                select(ExtractionResult.session_id, func.count().label("cnt"))
                .where(ExtractionResult.session_id.in_(session_ids))
                .group_by(ExtractionResult.session_id)
            ).all()
            ext_counts: Dict[str, int] = {
                str(r.session_id): r.cnt for r in ext_counts_rows
            }

            for s in result:
                sid = s["id"]
                doc_names = docs_by_session.get(sid, [])
                s["document_count"] = len(doc_names)
                s["document_names"] = doc_names
                s["extraction_count"] = ext_counts.get(sid, 0)
                config = s.get("configuration", {})
                s["study_type"] = config.get("study_type") if config else None

            return result
        finally:
            db.close()

    def get_session_basic(
        self, session_id: str, user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Lightweight session fetch — no joins."""
        db = get_db_session()
        try:
            sess = db.execute(
                select(AppSession).where(
                    AppSession.id == _to_uuid(session_id),
                    AppSession.user_id == user_id,
                )
            ).scalar_one_or_none()
            return _row_to_dict(sess) if sess else None
        finally:
            db.close()

    def update_session(
        self, session_id: str, user_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        data = {k: v for k, v in updates.items() if v is not None}
        if not data:
            return self.get_session_basic(session_id, user_id)

        with db_session_scope() as db:
            sess = db.execute(
                select(AppSession).where(
                    AppSession.id == _to_uuid(session_id),
                    AppSession.user_id == user_id,
                )
            ).scalar_one_or_none()
            if sess is None:
                return None
            for key, val in data.items():
                if hasattr(sess, key):
                    setattr(sess, key, val)
            sess.updated_at = datetime.utcnow()
            db.flush()
            return _row_to_dict(sess)

    def delete_session(self, session_id: str, user_id: str) -> bool:
        with db_session_scope() as db:
            result = db.execute(
                delete(AppSession).where(
                    AppSession.id == _to_uuid(session_id),
                    AppSession.user_id == user_id,
                )
            )
            return result.rowcount > 0

    def get_session_for_shared_view(
        self, requesting_user_id: str, session_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Load a shared session for a user who is not the owner.
        Verifies group membership before returning data.
        """
        db = get_db_session()
        try:
            sid = _to_uuid(session_id)
            sess = db.execute(
                select(AppSession).where(
                    AppSession.id == sid,
                    AppSession.shared_with_group_id.is_not(None),
                )
            ).scalar_one_or_none()
            if sess is None:
                return None

            group_id = sess.shared_with_group_id
            if not group_id:
                return None

            # Verify membership
            membership = db.execute(
                select(UserGroup).where(
                    UserGroup.user_id == requesting_user_id,
                    UserGroup.group_id == group_id,
                )
            ).scalar_one_or_none()
            if membership is None:
                return None

            session_dict = _row_to_dict(sess)

            docs = (
                db.execute(select(Document).where(Document.session_id == sid))
                .scalars()
                .all()
            )
            session_dict["documents"] = [_row_to_dict(d) for d in docs]

            exts = (
                db.execute(
                    select(ExtractionResult)
                    .where(ExtractionResult.session_id == sid)
                    .order_by(ExtractionResult.entity_name, ExtractionResult.model_id)
                )
                .scalars()
                .all()
            )
            session_dict["extraction_results"] = [_row_to_dict(e) for e in exts]

            if session_dict["extraction_results"]:
                ext_ids = [
                    _to_uuid(e["id"]) for e in session_dict["extraction_results"]
                ]
                evals = (
                    db.execute(
                        select(EvaluationResult)
                        .where(EvaluationResult.extraction_result_id.in_(ext_ids))
                        .order_by(
                            EvaluationResult.extraction_result_id,
                            EvaluationResult.judge_model,
                            EvaluationResult.metric,
                        )
                    )
                    .scalars()
                    .all()
                )
                session_dict["evaluation_results"] = [_row_to_dict(ev) for ev in evals]
            else:
                session_dict["evaluation_results"] = []

            return session_dict
        finally:
            db.close()

    # ======================================================================
    # Auth History Operations
    # ======================================================================

    def record_login(
        self,
        user_id: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        with db_session_scope() as db:
            entry = LoginHistory(
                user_id=user_id,
                ip_address=ip_address,
                user_agent=user_agent,
                login_at=datetime.utcnow(),
            )
            db.add(entry)
            db.flush()
            return _row_to_dict(entry)

    # ======================================================================
    # Document Operations
    # ======================================================================

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
        parse_duration_seconds: Optional[float] = None,
    ) -> Optional[Dict[str, Any]]:
        with db_session_scope() as db:
            doc = Document(
                session_id=_to_uuid(session_id),
                user_id=user_id,
                file_hash=file_hash,
                filename=filename,
                file_path=file_path,
                study_type=study_type,
                processor_used=processor_used,
                processing_status="pending",
                parse_cost=parse_cost,
                page_count=page_count,
                parse_duration_seconds=parse_duration_seconds,
            )
            db.add(doc)
            db.flush()
            return _row_to_dict(doc)

    def get_document(self, document_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_session()
        try:
            doc = db.execute(
                select(Document).where(Document.id == _to_uuid(document_id))
            ).scalar_one_or_none()
            return _row_to_dict(doc) if doc else None
        finally:
            db.close()

    def get_documents_by_session(self, session_id: str) -> List[Dict[str, Any]]:
        db = get_db_session()
        try:
            docs = (
                db.execute(
                    select(Document).where(Document.session_id == _to_uuid(session_id))
                )
                .scalars()
                .all()
            )
            return [_row_to_dict(d) for d in docs]
        finally:
            db.close()

    def get_parse_cost_by_file_hash(self, file_hash: str) -> Optional[float]:
        db = get_db_session()
        try:
            row = db.execute(
                select(Document.parse_cost)
                .where(
                    Document.file_hash == file_hash,
                    Document.parse_cost.is_not(None),
                    Document.parse_cost > 0,
                )
                .order_by(Document.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            return float(row) if row is not None else None
        except Exception as e:
            print(f"[DB] get_parse_cost_by_file_hash failed: {e}")
            return None
        finally:
            db.close()

    def list_user_documents(self, user_id: str) -> List[Dict[str, Any]]:
        db = get_db_session()
        try:
            docs = (
                db.execute(
                    select(Document)
                    .where(Document.user_id == user_id)
                    .order_by(Document.created_at.desc())
                )
                .scalars()
                .all()
            )

            # Deduplicate by file_hash (keep most recent)
            seen: set = set()
            unique = []
            for d in docs:
                if d.file_hash not in seen:
                    seen.add(d.file_hash)
                    unique.append(_row_to_dict(d))
            return unique
        finally:
            db.close()

    def update_document(
        self, document_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        data = {k: v for k, v in updates.items() if v is not None}
        if not data:
            return self.get_document(document_id)

        with db_session_scope() as db:
            doc = db.execute(
                select(Document).where(Document.id == _to_uuid(document_id))
            ).scalar_one_or_none()
            if doc is None:
                return None
            for key, val in data.items():
                if hasattr(doc, key):
                    setattr(doc, key, val)
            doc.updated_at = datetime.utcnow()
            db.flush()
            return _row_to_dict(doc)

    def update_document_processing(
        self,
        document_id: str,
        processor_used: str,
        status: str,
        extracted_text_path: Optional[str] = None,
        error: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        data: Dict[str, Any] = {
            "processor_used": processor_used,
            "processing_status": status,
        }
        if extracted_text_path is not None:
            data["extracted_text_path"] = extracted_text_path
        if error is not None:
            data["processing_error"] = error
        if status == "completed":
            data["processed_at"] = datetime.utcnow()
        return self.update_document(document_id, data)

    # ======================================================================
    # Extraction Result Operations
    # ======================================================================

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
    ) -> Optional[Dict[str, Any]]:
        insert_values: Dict[str, Any] = {
            "session_id": _to_uuid(session_id),
            "document_id": _to_uuid(document_id),
            "entity_name": entity_name,
            "model_id": model_id,
            "extracted_text": _sanitize_text(extracted_text),
            "bbox_references": bbox_references,
            "status": status,
            "error_message": _sanitize_text(error_message),
        }
        if status == "completed":
            insert_values["extracted_at"] = datetime.utcnow()
        if prompt_tokens is not None:
            insert_values["prompt_tokens"] = prompt_tokens
        if completion_tokens is not None:
            insert_values["completion_tokens"] = completion_tokens
        if duration_ms is not None:
            insert_values["duration_ms"] = duration_ms
        if cost is not None:
            insert_values["cost"] = cost

        # Build SET clause for DO UPDATE — only fields that were provided
        update_set: Dict[str, Any] = {
            "extracted_text": insert_values["extracted_text"],
            "bbox_references": insert_values["bbox_references"],
            "status": status,
            "error_message": insert_values["error_message"],
            "updated_at": datetime.utcnow(),
        }
        if status == "completed":
            update_set["extracted_at"] = insert_values["extracted_at"]
        if prompt_tokens is not None:
            update_set["prompt_tokens"] = prompt_tokens
        if completion_tokens is not None:
            update_set["completion_tokens"] = completion_tokens
        if duration_ms is not None:
            update_set["duration_ms"] = duration_ms
        if cost is not None:
            update_set["cost"] = cost

        with db_session_scope() as db:
            stmt = (
                pg_insert(ExtractionResult)
                .values(**insert_values)
                .on_conflict_do_update(
                    constraint="uq_extraction_doc_entity_model",
                    set_=update_set,
                )
                .returning(ExtractionResult)
            )
            result = db.execute(stmt).scalar_one_or_none()
            if result is None:
                return None
            return _row_to_dict(result)

    def update_extraction_cost(self, extraction_id: str, cost: float) -> None:
        try:
            with db_session_scope() as db:
                db.execute(
                    update(ExtractionResult)
                    .where(ExtractionResult.id == _to_uuid(extraction_id))
                    .values(cost=cost)
                )
        except Exception as e:
            print(f"[COST_TRACKER] Failed to backfill extraction cost: {e}")

    def get_extraction_results_by_session(
        self, session_id: str
    ) -> List[Dict[str, Any]]:
        db = get_db_session()
        try:
            exts = (
                db.execute(
                    select(ExtractionResult)
                    .where(ExtractionResult.session_id == _to_uuid(session_id))
                    .order_by(ExtractionResult.entity_name, ExtractionResult.model_id)
                )
                .scalars()
                .all()
            )
            return [_row_to_dict(e) for e in exts]
        finally:
            db.close()

    def get_extraction_results_by_document(
        self, document_id: str
    ) -> List[Dict[str, Any]]:
        db = get_db_session()
        try:
            exts = (
                db.execute(
                    select(ExtractionResult).where(
                        ExtractionResult.document_id == _to_uuid(document_id)
                    )
                )
                .scalars()
                .all()
            )
            return [_row_to_dict(e) for e in exts]
        finally:
            db.close()

    # ======================================================================
    # Evaluation Result Operations
    # ======================================================================

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
    ) -> Optional[Dict[str, Any]]:
        now = datetime.utcnow()
        insert_values: Dict[str, Any] = {
            "extraction_result_id": _to_uuid(extraction_result_id),
            "metric": metric,
            "score": score,
            "reasoning": _sanitize_text(reasoning),
            "judge_model": judge_model,
            "human_score": human_score,
            "ground_truth": _sanitize_text(ground_truth),
            "evaluated_at": now,
        }
        if evaluation_cost is not None:
            insert_values["evaluation_cost"] = evaluation_cost
        if evaluation_time is not None:
            insert_values["evaluation_time"] = evaluation_time

        update_set: Dict[str, Any] = {
            "score": score,
            "reasoning": insert_values["reasoning"],
            "human_score": human_score,
            "ground_truth": insert_values["ground_truth"],
            "evaluated_at": now,
            "updated_at": now,
        }
        if evaluation_cost is not None:
            update_set["evaluation_cost"] = evaluation_cost
        if evaluation_time is not None:
            update_set["evaluation_time"] = evaluation_time

        with db_session_scope() as db:
            stmt = (
                pg_insert(EvaluationResult)
                .values(**insert_values)
                .on_conflict_do_update(
                    constraint="uq_eval_extraction_metric_judge",
                    set_=update_set,
                )
                .returning(EvaluationResult)
            )
            result = db.execute(stmt).scalar_one_or_none()
            return _row_to_dict(result) if result else None

    def get_evaluation_results_by_extraction(
        self, extraction_result_id: str
    ) -> List[Dict[str, Any]]:
        db = get_db_session()
        try:
            evals = (
                db.execute(
                    select(EvaluationResult).where(
                        EvaluationResult.extraction_result_id
                        == _to_uuid(extraction_result_id)
                    )
                )
                .scalars()
                .all()
            )
            return [_row_to_dict(ev) for ev in evals]
        finally:
            db.close()

    # ======================================================================
    # User Preferences Operations
    # ======================================================================

    def get_or_create_preferences(self, user_id: str) -> Dict[str, Any]:
        db = get_db_session()
        try:
            prefs = db.execute(
                select(UserPreferences).where(UserPreferences.user_id == user_id)
            ).scalar_one_or_none()
            if prefs:
                return _row_to_dict(prefs)
        finally:
            db.close()

        # Create defaults
        with db_session_scope() as db:
            prefs = UserPreferences(
                user_id=user_id,
                default_models=[],
                default_temperature=0.0,
                settings={},
            )
            db.add(prefs)
            db.flush()
            return _row_to_dict(prefs)

    def update_preferences(
        self, user_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        data = {k: v for k, v in updates.items() if v is not None}
        with db_session_scope() as db:
            # Upsert on user_id unique constraint
            prefs = db.execute(
                select(UserPreferences).where(UserPreferences.user_id == user_id)
            ).scalar_one_or_none()
            if prefs is None:
                prefs = UserPreferences(user_id=user_id)
                db.add(prefs)
            for key, val in data.items():
                if hasattr(prefs, key):
                    setattr(prefs, key, val)
            prefs.updated_at = datetime.utcnow()
            db.flush()
            return _row_to_dict(prefs)

    # ======================================================================
    # User Prompt Templates Operations
    # ======================================================================

    def save_prompt_template(
        self,
        user_id: str,
        name: str,
        entity_name: str,
        prompt_content: str,
        study_type: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        with db_session_scope() as db:
            existing = db.execute(
                select(UserPromptTemplate).where(
                    UserPromptTemplate.user_id == user_id,
                    UserPromptTemplate.name == name,
                    UserPromptTemplate.entity_name == entity_name,
                )
            ).scalar_one_or_none()

            if existing:
                existing.prompt_content = prompt_content
                if study_type is not None:
                    existing.study_type = study_type
                if system_prompt is not None:
                    existing.system_prompt = system_prompt
                existing.updated_at = datetime.utcnow()
                db.flush()
                return _row_to_dict(existing)
            else:
                tmpl = UserPromptTemplate(
                    user_id=user_id,
                    name=name,
                    entity_name=entity_name,
                    prompt_content=prompt_content,
                    study_type=study_type,
                    system_prompt=system_prompt,
                )
                db.add(tmpl)
                db.flush()
                return _row_to_dict(tmpl)

    def get_prompt_templates(
        self, user_id: str, study_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        db = get_db_session()
        try:
            q = select(UserPromptTemplate).where(UserPromptTemplate.user_id == user_id)
            if study_type:
                q = q.where(UserPromptTemplate.study_type == study_type)
            rows = db.execute(q).scalars().all()
            return [_row_to_dict(r) for r in rows]
        finally:
            db.close()

    def delete_prompt_template(self, template_id: str, user_id: str) -> bool:
        with db_session_scope() as db:
            result = db.execute(
                delete(UserPromptTemplate).where(
                    UserPromptTemplate.id == _to_uuid(template_id),
                    UserPromptTemplate.user_id == user_id,
                )
            )
            return result.rowcount > 0

    # ======================================================================
    # Session Sharing Operations
    # ======================================================================

    def share_session(
        self,
        session_id: str,
        user_id: str,
        group_id: str,
    ) -> Optional[Dict[str, Any]]:
        with db_session_scope() as db:
            sess = db.execute(
                select(AppSession).where(
                    AppSession.id == _to_uuid(session_id),
                    AppSession.user_id == user_id,
                )
            ).scalar_one_or_none()
            if sess is None:
                return None
            sess.shared_with_group_id = _to_uuid(group_id)
            sess.shared_by = user_id
            sess.shared_at = datetime.utcnow()
            db.flush()
            return _row_to_dict(sess)

    def unshare_session(
        self,
        session_id: str,
        user_id: str,
    ) -> Optional[Dict[str, Any]]:
        with db_session_scope() as db:
            sess = db.execute(
                select(AppSession).where(
                    AppSession.id == _to_uuid(session_id),
                    AppSession.user_id == user_id,
                )
            ).scalar_one_or_none()
            if sess is None:
                return None
            sess.shared_with_group_id = None
            sess.shared_by = None
            sess.shared_at = None
            db.flush()
            return _row_to_dict(sess)

    def list_shared_sessions(
        self, user_id: str, group_ids: List[str]
    ) -> List[Dict[str, Any]]:
        if not group_ids:
            return []

        group_uuids = [_to_uuid(g) for g in group_ids]
        db = get_db_session()
        try:
            sessions = (
                db.execute(
                    select(AppSession)
                    .where(
                        AppSession.shared_with_group_id.in_(group_uuids),
                        AppSession.user_id != user_id,
                    )
                    .order_by(AppSession.shared_at.desc())
                    .limit(50)
                )
                .scalars()
                .all()
            )

            if not sessions:
                return []

            result = [_row_to_dict(s) for s in sessions]
            session_ids = [_to_uuid(s["id"]) for s in result]

            docs = db.execute(
                select(Document.session_id, Document.filename).where(
                    Document.session_id.in_(session_ids)
                )
            ).all()
            docs_by_session: Dict[str, List[str]] = {}
            for doc in docs:
                sid = str(doc.session_id)
                docs_by_session.setdefault(sid, []).append(doc.filename)

            from sqlalchemy import func

            ext_counts_rows = db.execute(
                select(ExtractionResult.session_id, func.count().label("cnt"))
                .where(ExtractionResult.session_id.in_(session_ids))
                .group_by(ExtractionResult.session_id)
            ).all()
            ext_counts: Dict[str, int] = {
                str(r.session_id): r.cnt for r in ext_counts_rows
            }

            for s in result:
                sid = s["id"]
                doc_names = docs_by_session.get(sid, [])
                s["document_count"] = len(doc_names)
                s["document_names"] = doc_names
                s["extraction_count"] = ext_counts.get(sid, 0)
                config = s.get("configuration", {})
                s["study_type"] = config.get("study_type") if config else None

            return result
        finally:
            db.close()

    def get_user_group_ids(self, user_id: str) -> List[str]:
        db = get_db_session()
        try:
            rows = db.execute(
                select(UserGroup.group_id).where(UserGroup.user_id == user_id)
            ).all()
            return [str(r.group_id) for r in rows]
        finally:
            db.close()

    def get_group_name(self, group_id: str) -> Optional[str]:
        db = get_db_session()
        try:
            row = db.execute(
                select(Group.name).where(Group.id == _to_uuid(group_id))
            ).scalar_one_or_none()
            return row
        finally:
            db.close()

    def get_user_display_name(self, user_id: str) -> Optional[str]:
        """Get a user's display name from the Better Auth user table."""
        db = get_db_session()
        try:
            user = db.execute(
                select(User).where(User.id == user_id)
            ).scalar_one_or_none()
            if user:
                return user.name or user.email
            return None
        except Exception:
            return None
        finally:
            db.close()

    # ======================================================================
    # Session Metrics Operations
    # ======================================================================

    def increment_session_metrics(
        self,
        session_id: str,
        cost: float = 0.0,
        latency: float = 0.0,
    ) -> bool:
        """Atomically increment session metrics via a single SQL UPDATE."""
        try:
            with db_session_scope() as db:
                db.execute(
                    update(AppSession)
                    .where(AppSession.id == _to_uuid(session_id))
                    .values(
                        total_cost=AppSession.total_cost + cost,
                        total_latency=AppSession.total_latency + latency,
                        total_calls=AppSession.total_calls + 1,
                    )
                )
            return True
        except Exception as e:
            print(f"[DB] Failed to increment session metrics: {e}")
            return False

    def get_session_metrics(self, session_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_session()
        try:
            row = db.execute(
                select(
                    AppSession.total_cost,
                    AppSession.total_latency,
                    AppSession.total_calls,
                ).where(AppSession.id == _to_uuid(session_id))
            ).first()
            if row:
                return {
                    "total_cost": row.total_cost,
                    "total_latency": row.total_latency,
                    "total_calls": row.total_calls,
                }
            return None
        except Exception as e:
            print(f"[DB] Failed to get session metrics: {e}")
            return None
        finally:
            db.close()

    def reset_session_metrics(self, session_id: str) -> bool:
        try:
            with db_session_scope() as db:
                db.execute(
                    update(AppSession)
                    .where(AppSession.id == _to_uuid(session_id))
                    .values(total_cost=0.0, total_latency=0.0, total_calls=0)
                )
            return True
        except Exception as e:
            print(f"[DB] Failed to reset session metrics: {e}")
            return False


# ---------------------------------------------------------------------------
# Singleton factory
# ---------------------------------------------------------------------------

_db_service: Optional[SQLAlchemyDBService] = None


def get_db_service() -> SQLAlchemyDBService:
    """Get the singleton database service instance."""
    global _db_service
    if _db_service is None:
        _db_service = SQLAlchemyDBService()
    return _db_service
