"""
Folder Service

Provides business logic for managing template folders.
Folders are hierarchical and scope-aware (user / group / global).
"""

from typing import Optional, Dict, Any, List

from services.database.supabase_db_service import get_db_service
from services.groups.group_service import get_group_service


class FolderService:
    """Service for managing template folders."""

    def __init__(self):
        self.db = get_db_service()
        self.group_service = get_group_service()

    # ------------------------------------------------------------------
    # Permission helpers
    # ------------------------------------------------------------------

    def _can_manage_folder(self, user_id: str, scope: str, owner_group_id: Optional[str] = None) -> bool:
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
                role = self.group_service.get_user_role(owner_group_id, user_id)
                return role in ("admin", "owner")
            except Exception:
                return False
        if scope == "global":
            # TODO: replace with proper admin check when role system is in place
            return True
        return False

    def _get_folder_owner(self, folder_id: str) -> Dict[str, Any]:
        """Fetch a folder row to inspect ownership."""
        result = (
            self.db.client.table("template_folders")
            .select("*")
            .eq("id", folder_id)
            .single()
            .execute()
        )
        if not result.data:
            raise ValueError(f"Folder {folder_id} not found")
        return result.data

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
        query = (
            self.db.client.table("template_folders")
            .select("*")
            .eq("scope", scope)
        )

        if scope == "user":
            query = query.eq("owner_user_id", user_id)
        elif scope == "group" and owner_group_id:
            query = query.eq("owner_group_id", owner_group_id)
        # For global, no extra filter needed

        # Filter by parent level
        if parent_id is None:
            query = query.is_("parent_id", "null")
        else:
            query = query.eq("parent_id", parent_id)

        result = query.order("name").execute()
        return result.data or []

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
            raise PermissionError(f"You do not have permission to create folders in {scope} scope")

        # Validate parent belongs to the same scope/owner
        if parent_id:
            parent = self._get_folder_owner(parent_id)
            if parent["scope"] != scope:
                raise ValueError("Parent folder must be in the same scope")
            if scope == "group" and parent.get("owner_group_id") != owner_group_id:
                raise ValueError("Parent folder must belong to the same group")

        data: Dict[str, Any] = {
            "name": name.strip(),
            "scope": scope,
            "created_by": user_id,
        }
        if scope == "user":
            data["owner_user_id"] = user_id
        elif scope == "group":
            if not owner_group_id:
                raise ValueError("owner_group_id is required for group-scope folders")
            data["owner_group_id"] = owner_group_id
        # global: neither

        if parent_id:
            data["parent_id"] = parent_id

        result = self.db.client.table("template_folders").insert(data).execute()
        if not result.data:
            raise RuntimeError("Failed to create folder")
        return result.data[0]

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

        if not self._can_manage_folder(user_id, folder["scope"], folder.get("owner_group_id")):
            # Also allow the original creator
            if folder.get("created_by") != user_id:
                raise PermissionError("You do not have permission to rename this folder")

        result = (
            self.db.client.table("template_folders")
            .update({"name": new_name.strip()})
            .eq("id", folder_id)
            .execute()
        )
        if not result.data:
            raise RuntimeError("Failed to rename folder")
        return result.data[0]

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

        if not self._can_manage_folder(user_id, folder["scope"], folder.get("owner_group_id")):
            if folder.get("created_by") != user_id:
                raise PermissionError("You do not have permission to delete this folder")

        # Check if folder still has templates
        templates_result = (
            self.db.client.table("prompt_templates")
            .select("id", count="exact")
            .eq("folder_id", folder_id)
            .execute()
        )
        if templates_result.count and templates_result.count > 0:
            raise ValueError("Cannot delete a folder that still contains templates. Move or delete them first.")

        # Check if folder still has subfolders
        subfolders_result = (
            self.db.client.table("template_folders")
            .select("id", count="exact")
            .eq("parent_id", folder_id)
            .execute()
        )
        if subfolders_result.count and subfolders_result.count > 0:
            raise ValueError("Cannot delete a folder that still contains subfolders.")

        result = (
            self.db.client.table("template_folders")
            .delete()
            .eq("id", folder_id)
            .execute()
        )
        return {"deleted": folder_id}


_folder_service: Optional[FolderService] = None


def get_folder_service() -> FolderService:
    global _folder_service
    if _folder_service is None:
        _folder_service = FolderService()
    return _folder_service
