"""
Template Service

Provides business logic for managing prompt templates with versioning,
scope-based permissions, and fork capabilities.
"""

import uuid as _uuid_module
from typing import Optional, Dict, Any, List
from datetime import datetime

from sqlalchemy import select, delete, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert

from models import (
    PromptTemplate,
    TemplateVersion,
    TemplatePermission,
    Group,
)
from models.base import get_db_session, db_session_scope
from services.groups.group_service import get_group_service


def _to_uuid(value):
    if value is None:
        return None
    if isinstance(value, _uuid_module.UUID):
        return value
    try:
        return _uuid_module.UUID(str(value))
    except (ValueError, AttributeError):
        return None


def _row_to_dict(obj) -> Dict[str, Any]:
    result = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.key)
        if isinstance(val, _uuid_module.UUID):
            val = str(val)
        elif isinstance(val, datetime):
            val = val.isoformat()
        result[col.key] = val
    return result


class TemplateService:
    """Service for managing prompt templates"""

    def __init__(self):
        self.group_service = get_group_service()

    # ==========================================
    # Template CRUD Operations
    # ==========================================

    def create_template(
        self,
        user_id: str,
        name: str,
        entities: List[Dict[str, str]],
        scope: str = "user",
        owner_group_id: Optional[str] = None,
        description: Optional[str] = None,
        study_type: Optional[str] = None,
        system_prompt: Optional[str] = None,
        summary_prompt: Optional[str] = None,
        variables: Optional[List[Dict[str, Any]]] = None,
        tags: Optional[List[str]] = None,
        is_immutable: bool = False,
        folder_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new template."""
        if scope not in ("user", "group", "global"):
            raise ValueError("Invalid scope. Must be: user, group, or global")

        if scope == "group":
            if not owner_group_id:
                raise ValueError("owner_group_id required for group-scoped templates")
            role = self.group_service._get_role(owner_group_id, user_id)
            if role not in ("member", "admin", "owner"):
                raise ValueError("Not authorized to create templates for this group")

        with db_session_scope() as db:
            tmpl = PromptTemplate(
                name=name,
                description=description,
                study_type=study_type,
                scope=scope,
                system_prompt=system_prompt,
                entities=entities,
                summary_prompt=summary_prompt,
                variables=variables or [],
                tags=tags or [],
                is_immutable=is_immutable,
                version=1,
                created_by=user_id,
                owner_user_id=user_id if scope == "user" else None,
                owner_group_id=_to_uuid(owner_group_id) if scope == "group" else None,
                folder_id=_to_uuid(folder_id) if folder_id else None,
            )
            db.add(tmpl)
            db.flush()
            return _row_to_dict(tmpl)

    def get_template(self, template_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Get a template by ID with permission check."""
        db = get_db_session()
        try:
            tmpl = db.execute(
                select(PromptTemplate).where(PromptTemplate.id == _to_uuid(template_id))
            ).scalar_one_or_none()
            if tmpl is None:
                return None

            t = _row_to_dict(tmpl)
            if not self._can_read(t, user_id, db=db):
                return None

            t["can_edit"] = self._can_edit(t, user_id, db=db)
            t["is_owner"] = self._is_owner(t, user_id)
            return t
        finally:
            db.close()

    def list_templates(
        self,
        user_id: str,
        scope: Optional[str] = None,
        study_type: Optional[str] = None,
        tags: Optional[List[str]] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List templates accessible to a user with filtering."""
        user_groups = self.group_service.list_user_groups(user_id)
        group_ids = [g["id"] for g in user_groups]
        group_name_map = {g["id"]: g["name"] for g in user_groups}

        db = get_db_session()
        try:
            q = select(PromptTemplate)
            if scope:
                q = q.where(PromptTemplate.scope == scope)
            if study_type:
                q = q.where(PromptTemplate.study_type == study_type)
            if search:
                q = q.where(
                    or_(
                        PromptTemplate.name.ilike(f"%{search}%"),
                        PromptTemplate.description.ilike(f"%{search}%"),
                    )
                )
            q = q.order_by(PromptTemplate.updated_at.desc()).offset(offset).limit(limit)

            rows = db.execute(q).scalars().all()
            templates = [_row_to_dict(r) for r in rows]

            # Build group name lookup for any unseen group IDs
            extra_group_ids = [
                t["owner_group_id"]
                for t in templates
                if t["scope"] == "group"
                and t.get("owner_group_id")
                and t["owner_group_id"] not in group_name_map
            ]
            if extra_group_ids:
                extra_groups = (
                    db.execute(
                        select(Group).where(
                            Group.id.in_([_to_uuid(g) for g in extra_group_ids])
                        )
                    )
                    .scalars()
                    .all()
                )
                for g in extra_groups:
                    group_name_map[str(g.id)] = g.name

            accessible = []
            for t in templates:
                if not self._can_read(t, user_id, user_group_ids=group_ids, db=db):
                    continue
                t["can_edit"] = self._can_edit(
                    t, user_id, user_group_ids=group_ids, db=db
                )
                t["is_owner"] = self._is_owner(t, user_id, user_group_ids=group_ids)
                if t["scope"] == "group" and t.get("owner_group_id"):
                    t["group_name"] = group_name_map.get(t["owner_group_id"])
                accessible.append(t)

            if tags:
                accessible = [
                    t
                    for t in accessible
                    if any(tag in (t.get("tags") or []) for tag in tags)
                ]

            return accessible
        finally:
            db.close()

    def update_template(
        self,
        template_id: str,
        user_id: str,
        updates: Dict[str, Any],
        change_summary: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update a template. Creates a version snapshot before updating."""
        template = self.get_template(template_id, user_id)
        if not template:
            return None
        if not template.get("can_edit"):
            return None

        allowed = {
            "name",
            "description",
            "study_type",
            "system_prompt",
            "entities",
            "summary_prompt",
            "variables",
            "tags",
            "is_immutable",
            "folder_id",
        }
        data = {k: v for k, v in updates.items() if k in allowed}
        if not data:
            return template

        with db_session_scope() as db:
            tmpl = db.execute(
                select(PromptTemplate).where(PromptTemplate.id == _to_uuid(template_id))
            ).scalar_one_or_none()
            if tmpl is None:
                return None

            # Snapshot current state as a new version before changing
            snapshot = TemplateVersion(
                template_id=tmpl.id,
                version=tmpl.version,
                system_prompt=tmpl.system_prompt,
                entities=tmpl.entities,
                summary_prompt=tmpl.summary_prompt,
                variables=tmpl.variables,
                changed_by=user_id,
                change_summary=change_summary,
            )
            db.add(snapshot)

            for k, v in data.items():
                if k == "folder_id":
                    setattr(tmpl, k, _to_uuid(v) if v else None)
                else:
                    setattr(tmpl, k, v)
            tmpl.version = tmpl.version + 1
            tmpl.updated_at = datetime.utcnow()
            db.flush()
            return _row_to_dict(tmpl)

    def delete_template(self, template_id: str, user_id: str) -> bool:
        """Delete a template. Requires ownership."""
        template = self.get_template(template_id, user_id)
        if not template:
            return False

        if template["scope"] == "user":
            if template["owner_user_id"] != user_id:
                return False
        elif template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            if role not in ("admin", "owner"):
                return False
        elif template["scope"] == "global":
            if template.get("created_by") != user_id:
                return False

        with db_session_scope() as db:
            db.execute(
                delete(PromptTemplate).where(PromptTemplate.id == _to_uuid(template_id))
            )
        return True

    # ==========================================
    # Version Operations
    # ==========================================

    def get_version_history(
        self, template_id: str, user_id: str
    ) -> Optional[List[Dict[str, Any]]]:
        """Get version history for a template."""
        template = self.get_template(template_id, user_id)
        if not template:
            return None

        db = get_db_session()
        try:
            versions = (
                db.execute(
                    select(TemplateVersion)
                    .where(TemplateVersion.template_id == _to_uuid(template_id))
                    .order_by(TemplateVersion.version.desc())
                )
                .scalars()
                .all()
            )
            return [_row_to_dict(v) for v in versions]
        finally:
            db.close()

    def revert_to_version(
        self, template_id: str, version: int, user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Revert a template to a previous version."""
        template = self.get_template(template_id, user_id)
        if not template or not template.get("can_edit"):
            return None

        db = get_db_session()
        try:
            old = db.execute(
                select(TemplateVersion).where(
                    TemplateVersion.template_id == _to_uuid(template_id),
                    TemplateVersion.version == version,
                )
            ).scalar_one_or_none()
        finally:
            db.close()

        if old is None:
            return None

        updates = {
            "system_prompt": old.system_prompt,
            "entities": old.entities,
            "summary_prompt": old.summary_prompt,
            "variables": old.variables,
        }
        return self.update_template(
            template_id,
            user_id,
            updates,
            change_summary=f"Reverted to version {version}",
        )

    # ==========================================
    # Fork Operations
    # ==========================================

    def fork_template(
        self, template_id: str, user_id: str, new_name: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Create a personal copy of a template."""
        source = self.get_template(template_id, user_id)
        if not source:
            return None

        return self.create_template(
            user_id=user_id,
            name=new_name or f"Copy of {source['name']}",
            entities=source["entities"],
            scope="user",
            description=source.get("description"),
            study_type=source.get("study_type"),
            system_prompt=source.get("system_prompt"),
            summary_prompt=source.get("summary_prompt"),
            variables=source.get("variables"),
            tags=source.get("tags"),
            is_immutable=False,
        )

    # ==========================================
    # Scope Change Operations
    # ==========================================

    def change_scope(
        self,
        template_id: str,
        user_id: str,
        new_scope: str,
        owner_group_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Change the scope of a template."""
        if new_scope not in ("user", "group", "global"):
            raise ValueError("Invalid scope. Must be: user, group, or global")
        if new_scope == "group" and not owner_group_id:
            raise ValueError("owner_group_id required when changing to group scope")

        template = self.get_template(template_id, user_id)
        if not template:
            return None

        old_scope = template["scope"]
        if old_scope == new_scope:
            return template

        if old_scope == "user":
            if template["owner_user_id"] != user_id:
                return None
            if new_scope == "group":
                role = self.group_service._get_role(owner_group_id, user_id)
                if role not in ("member", "admin", "owner"):
                    return None
        elif old_scope == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            if role not in ("admin", "owner"):
                return None
            if new_scope == "group" and owner_group_id != template["owner_group_id"]:
                target_role = self.group_service._get_role(owner_group_id, user_id)
                if target_role not in ("member", "admin", "owner"):
                    return None
        elif old_scope == "global":
            if template.get("created_by") != user_id:
                return None

        with db_session_scope() as db:
            tmpl = db.execute(
                select(PromptTemplate).where(PromptTemplate.id == _to_uuid(template_id))
            ).scalar_one_or_none()
            if tmpl is None:
                return None
            tmpl.scope = new_scope
            if new_scope == "user":
                tmpl.owner_user_id = user_id
                tmpl.owner_group_id = None
            elif new_scope == "group":
                tmpl.owner_user_id = None
                tmpl.owner_group_id = _to_uuid(owner_group_id)
            else:
                tmpl.owner_user_id = None
                tmpl.owner_group_id = None
            tmpl.updated_at = datetime.utcnow()
            db.flush()
            return _row_to_dict(tmpl)

    # ==========================================
    # Permission Operations
    # ==========================================

    def set_immutable(
        self, template_id: str, user_id: str, is_immutable: bool
    ) -> Optional[Dict[str, Any]]:
        """Set template immutability. Requires ownership."""
        template = self.get_template(template_id, user_id)
        if not template:
            return None
        if template["scope"] == "user":
            if template["owner_user_id"] != user_id:
                return None
        elif template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            if role not in ("admin", "owner"):
                return None
        else:
            return None

        with db_session_scope() as db:
            tmpl = db.execute(
                select(PromptTemplate).where(PromptTemplate.id == _to_uuid(template_id))
            ).scalar_one_or_none()
            if tmpl is None:
                return None
            tmpl.is_immutable = is_immutable
            tmpl.updated_at = datetime.utcnow()
            db.flush()
            return _row_to_dict(tmpl)

    def set_permission(
        self,
        template_id: str,
        target_user_id: str,
        can_read: bool,
        can_write: bool,
        granting_user_id: str,
    ) -> Optional[Dict[str, Any]]:
        """Set per-user permission override."""
        template = self.get_template(template_id, granting_user_id)
        if not template:
            return None
        if template["scope"] == "user":
            if template["owner_user_id"] != granting_user_id:
                return None
        elif template["scope"] == "group":
            role = self.group_service._get_role(
                template["owner_group_id"], granting_user_id
            )
            if role not in ("admin", "owner"):
                return None
        else:
            return None

        with db_session_scope() as db:
            stmt = (
                pg_insert(TemplatePermission)
                .values(
                    template_id=_to_uuid(template_id),
                    user_id=target_user_id,
                    can_read=can_read,
                    can_write=can_write,
                    granted_by=granting_user_id,
                )
                .on_conflict_do_update(
                    constraint="uq_template_permission",
                    set_={
                        "can_read": can_read,
                        "can_write": can_write,
                        "granted_by": granting_user_id,
                    },
                )
                .returning(TemplatePermission)
            )
            result = db.execute(stmt).scalar_one_or_none()
            return _row_to_dict(result) if result else None

    def get_permissions(
        self, template_id: str, user_id: str
    ) -> Optional[List[Dict[str, Any]]]:
        """Get all permission overrides for a template."""
        template = self.get_template(template_id, user_id)
        if not template:
            return None
        if template["scope"] == "user":
            if template["owner_user_id"] != user_id:
                return None
        elif template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            if role not in ("admin", "owner"):
                return None

        db = get_db_session()
        try:
            perms = (
                db.execute(
                    select(TemplatePermission).where(
                        TemplatePermission.template_id == _to_uuid(template_id)
                    )
                )
                .scalars()
                .all()
            )
            return [_row_to_dict(p) for p in perms]
        finally:
            db.close()

    def remove_permission(
        self, template_id: str, target_user_id: str, removing_user_id: str
    ) -> bool:
        """Remove a permission override."""
        template = self.get_template(template_id, removing_user_id)
        if not template:
            return False
        if template["scope"] == "user":
            if template["owner_user_id"] != removing_user_id:
                return False
        elif template["scope"] == "group":
            role = self.group_service._get_role(
                template["owner_group_id"], removing_user_id
            )
            if role not in ("admin", "owner"):
                return False
        else:
            return False

        with db_session_scope() as db:
            db.execute(
                delete(TemplatePermission).where(
                    TemplatePermission.template_id == _to_uuid(template_id),
                    TemplatePermission.user_id == target_user_id,
                )
            )
        return True

    # ==========================================
    # Helper Methods
    # ==========================================

    def _can_read(
        self,
        template: Dict[str, Any],
        user_id: str,
        user_group_ids: Optional[List[str]] = None,
        db=None,
    ) -> bool:
        if template["scope"] == "global":
            return True
        if template["scope"] == "user" and template["owner_user_id"] == user_id:
            return True
        if template["scope"] == "group":
            if user_group_ids is None:
                user_groups = self.group_service.list_user_groups(user_id)
                user_group_ids = [g["id"] for g in user_groups]
            if template["owner_group_id"] in user_group_ids:
                return True

        # Check per-user override
        perm = self._get_permission(template["id"], user_id, db)
        return bool(perm and perm.can_read)

    def _can_edit(
        self,
        template: Dict[str, Any],
        user_id: str,
        user_group_ids: Optional[List[str]] = None,
        db=None,
    ) -> bool:
        if template.get("is_immutable"):
            return False

        perm = self._get_permission(template["id"], user_id, db)
        if perm is not None:
            return bool(perm.can_write)

        if template["scope"] == "user":
            return template["owner_user_id"] == user_id
        if template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            return role in ("member", "admin", "owner")

        # Global scope: only the original creator can edit
        return template.get("created_by") == user_id

    def _is_owner(
        self,
        template: Dict[str, Any],
        user_id: str,
        user_group_ids: Optional[List[str]] = None,
    ) -> bool:
        if template["scope"] == "user":
            return template["owner_user_id"] == user_id
        if template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            return role in ("admin", "owner")
        if template["scope"] == "global":
            return template.get("created_by") == user_id
        return False

    def _get_permission(self, template_id: str, user_id: str, db=None):
        """Fetch TemplatePermission row or None."""
        close_db = db is None
        if db is None:
            db = get_db_session()
        try:
            return db.execute(
                select(TemplatePermission).where(
                    TemplatePermission.template_id == _to_uuid(template_id),
                    TemplatePermission.user_id == user_id,
                )
            ).scalar_one_or_none()
        finally:
            if close_db:
                db.close()


# Singleton instance
_template_service: Optional[TemplateService] = None


def get_template_service() -> TemplateService:
    """Get the singleton template service instance"""
    global _template_service
    if _template_service is None:
        _template_service = TemplateService()
    return _template_service
