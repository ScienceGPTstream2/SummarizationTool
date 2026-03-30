"""
Folder Service

Provides business logic for managing template folders.
Folders are hierarchical and scope-aware (user / group / global).
"""

import uuid as _uuid_module
from typing import Optional, Dict, Any, List
from datetime import datetime

from sqlalchemy import select, delete
from models import TemplateFolder, PromptTemplate
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


class FolderService:
    """Service for managing template folders."""

    def __init__(self):
        self.group_service = get_group_service()

    # ------------------------------------------------------------------
    # Permission helpers
    # ------------------------------------------------------------------

    def _can_manage_folder(
        self, user_id: str, scope: str, owner_group_id: Optional[str] = None
    ) -> bool:
        """
        Returns True if user_id is allowed to create/modify/delete folders
        in the given scope.
          user  → always (it's their own scope)
          group → must be admin or owner of the group
          global → must be a global admin (any user in a group named 'global-admin',
                   or we fall back to allowing any authenticated user for now)
        """
        if scope == "user":
            return True
        if scope == "group" and owner_group_id:
            try:
                role = self.group_service._get_role(owner_group_id, user_id)
                return role in ("admin", "owner")
            except Exception:
                return False
        if scope == "global":
            # TODO: replace with proper admin check when role system is in place
            return True
        return False

    def _get_folder_owner(self, folder_id: str) -> Dict[str, Any]:
        """Fetch a folder row to inspect ownership."""
        db = get_db_session()
        try:
            folder = db.execute(
                select(TemplateFolder).where(TemplateFolder.id == _to_uuid(folder_id))
            ).scalar_one_or_none()
            if folder is None:
                raise ValueError(f"Folder {folder_id} not found")
            return _row_to_dict(folder)
        finally:
            db.close()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_folders(
        self,
        user_id: str,
        scope: str,
        parent_id: Optional[str] = None,
        owner_group_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        List folders the user can see.

        For 'user' scope: returns only folders owned by user_id.
        For 'group' scope: returns folders owned by owner_group_id, optionally
                           filtered by parent_id.
        For 'global' scope: returns all global folders at the requested level.
        """
        db = get_db_session()
        try:
            query = select(TemplateFolder).where(TemplateFolder.scope == scope)

            if scope == "user":
                query = query.where(TemplateFolder.owner_user_id == user_id)
            elif scope == "group" and owner_group_id:
                query = query.where(TemplateFolder.owner_group_id == _to_uuid(owner_group_id))
            # For global, no extra filter needed

            # Filter by parent level
            if parent_id is None:
                query = query.where(TemplateFolder.parent_id.is_(None))
            else:
                query = query.where(TemplateFolder.parent_id == _to_uuid(parent_id))

            query = query.order_by(TemplateFolder.name)
            folders = db.execute(query).scalars().all()
            return [_row_to_dict(f) for f in folders]
        finally:
            db.close()

    def create_folder(
        self,
        user_id: str,
        name: str,
        scope: str,
        parent_id: Optional[str] = None,
        owner_group_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a new folder.

        Validates:
        - User has permission to manage folders in this scope
        - If parent_id is given, the parent belongs to the same scope / owner
        """
        if not name or not name.strip():
            raise ValueError("Folder name cannot be empty")

        if not self._can_manage_folder(user_id, scope, owner_group_id):
            raise PermissionError(
                f"You do not have permission to create folders in {scope} scope"
            )

        # Validate parent belongs to the same scope/owner
        if parent_id:
            parent = self._get_folder_owner(parent_id)
            if parent["scope"] != scope:
                raise ValueError("Parent folder must be in the same scope")
            if scope == "group" and parent.get("owner_group_id") != owner_group_id:
                raise ValueError("Parent folder must belong to the same group")

        with db_session_scope() as db:
            kwargs: Dict[str, Any] = {
                "name": name.strip(),
                "scope": scope,
                "created_by": user_id,
            }
            if scope == "user":
                kwargs["owner_user_id"] = user_id
            elif scope == "group":
                if not owner_group_id:
                    raise ValueError("owner_group_id is required for group-scope folders")
                kwargs["owner_group_id"] = _to_uuid(owner_group_id)
            # global: neither

            if parent_id:
                kwargs["parent_id"] = _to_uuid(parent_id)

            folder = TemplateFolder(**kwargs)
            db.add(folder)
            db.flush()
            return _row_to_dict(folder)

    def rename_folder(
        self,
        user_id: str,
        folder_id: str,
        new_name: str,
    ) -> Dict[str, Any]:
        """Rename a folder. Only the creator or a scope-level manager can rename."""
        if not new_name or not new_name.strip():
            raise ValueError("Folder name cannot be empty")

        folder = self._get_folder_owner(folder_id)

        if not self._can_manage_folder(
            user_id, folder["scope"], folder.get("owner_group_id")
        ):
            # Also allow the original creator
            if folder.get("created_by") != user_id:
                raise PermissionError(
                    "You do not have permission to rename this folder"
                )

        with db_session_scope() as db:
            f = db.execute(
                select(TemplateFolder).where(TemplateFolder.id == _to_uuid(folder_id))
            ).scalar_one_or_none()
            if f is None:
                raise RuntimeError("Failed to rename folder")
            f.name = new_name.strip()
            f.updated_at = datetime.utcnow()
            db.flush()
            return _row_to_dict(f)

    def delete_folder(
        self,
        user_id: str,
        folder_id: str,
    ) -> Dict[str, Any]:
        """
        Delete a folder. Fails if the folder still contains templates or subfolders
        (cascade must be done explicitly by the caller).
        Allows deletion only by the creator or a scope manager.
        """
        folder = self._get_folder_owner(folder_id)

        if not self._can_manage_folder(
            user_id, folder["scope"], folder.get("owner_group_id")
        ):
            if folder.get("created_by") != user_id:
                raise PermissionError(
                    "You do not have permission to delete this folder"
                )

        db = get_db_session()
        try:
            # Check if folder still has templates
            template_count = db.execute(
                select(PromptTemplate).where(PromptTemplate.folder_id == _to_uuid(folder_id))
            ).scalars().all()
            if template_count:
                raise ValueError(
                    "Cannot delete a folder that still contains templates. Move or delete them first."
                )

            # Check if folder still has subfolders
            subfolders = db.execute(
                select(TemplateFolder).where(TemplateFolder.parent_id == _to_uuid(folder_id))
            ).scalars().all()
            if subfolders:
                raise ValueError("Cannot delete a folder that still contains subfolders.")
        finally:
            db.close()

        with db_session_scope() as db:
            db.execute(
                delete(TemplateFolder).where(TemplateFolder.id == _to_uuid(folder_id))
            )
        return {"deleted": folder_id}


_folder_service: Optional[FolderService] = None


def get_folder_service() -> FolderService:
    global _folder_service
    if _folder_service is None:
        _folder_service = FolderService()
    return _folder_service
