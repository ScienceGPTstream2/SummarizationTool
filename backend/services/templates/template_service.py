"""
Template Service

Provides business logic for managing prompt templates with versioning,
scope-based permissions, and fork capabilities.
"""

from typing import Optional, Dict, Any, List
from datetime import datetime

from services.database.supabase_db_service import get_db_service
from services.groups.group_service import get_group_service


class TemplateService:
    """Service for managing prompt templates"""

    def __init__(self):
        self.db = get_db_service()
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
    ) -> Dict[str, Any]:
        """
        Create a new template.

        Args:
            user_id: Creating user's ID
            name: Template name
            entities: List of {name, prompt} objects
            scope: 'user', 'group', or 'global'
            owner_group_id: Required for group-scoped templates
            description: Optional description
            study_type: Optional study type category
            system_prompt: Optional system prompt
            summary_prompt: Optional summary prompt
            variables: Optional list of variable definitions
            tags: Optional list of tags
            is_immutable: Whether template is immutable

        Returns:
            Created template
        """
        # Validate scope
        if scope not in ("user", "group", "global"):
            raise ValueError("Invalid scope. Must be: user, group, or global")

        # Validate group scope
        if scope == "group":
            if not owner_group_id:
                raise ValueError("owner_group_id required for group-scoped templates")
            # Check user is a member who can create
            role = self.group_service._get_role(owner_group_id, user_id)
            if role not in ("member", "admin", "owner"):
                raise ValueError("Not authorized to create templates for this group")

        # Build template data
        data = {
            "name": name,
            "description": description,
            "study_type": study_type,
            "scope": scope,
            "system_prompt": system_prompt,
            "entities": entities,
            "summary_prompt": summary_prompt,
            "variables": variables or [],
            "tags": tags or [],
            "is_immutable": is_immutable,
            "version": 1,
            "created_by": user_id,
        }

        # Set owner based on scope
        if scope == "user":
            data["owner_user_id"] = user_id
            data["owner_group_id"] = None
        elif scope == "group":
            data["owner_user_id"] = None
            data["owner_group_id"] = owner_group_id
        else:  # global - only via service role
            data["owner_user_id"] = None
            data["owner_group_id"] = None

        result = self.db.client.table("prompt_templates").insert(data).execute()

        if not result.data:
            raise ValueError("Failed to create template")

        return result.data[0]

    def get_template(
        self,
        template_id: str,
        user_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Get a template by ID with permission check.

        Args:
            template_id: Template ID
            user_id: Requesting user ID

        Returns:
            Template or None if not found/not authorized
        """
        result = (
            self.db.client.table("prompt_templates")
            .select("*")
            .eq("id", template_id)
            .execute()
        )

        if not result.data:
            return None

        template = result.data[0]

        # Check access
        if not self._can_read(template, user_id):
            return None

        # Add permission info
        template["can_edit"] = self._can_edit(template, user_id)
        template["is_owner"] = self._is_owner(template, user_id)

        return template

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
        """
        List templates accessible to a user with filtering.

        Args:
            user_id: Requesting user ID
            scope: Filter by scope (user, group, global)
            study_type: Filter by study type
            tags: Filter by tags (any match)
            search: Search in name and description
            limit: Max results
            offset: Pagination offset

        Returns:
            List of accessible templates
        """
        # Get user's groups
        user_groups = self.group_service.list_user_groups(user_id)
        group_ids = [g["id"] for g in user_groups]
        group_name_map = {g["id"]: g["name"] for g in user_groups}

        # Build query
        query = self.db.client.table("prompt_templates").select("*")

        # Apply scope filter
        if scope:
            query = query.eq("scope", scope)

        # Apply study type filter
        if study_type:
            query = query.eq("study_type", study_type)

        # Apply search
        if search:
            query = query.or_(f"name.ilike.%{search}%,description.ilike.%{search}%")

        # Order and paginate
        query = query.order("updated_at", desc=True).range(offset, offset + limit - 1)

        result = query.execute()
        templates = result.data or []

        # Filter by access permissions (post-query for complex logic)
        accessible = []
        for template in templates:
            if self._can_read(template, user_id, group_ids):
                template["can_edit"] = self._can_edit(template, user_id, group_ids)
                template["is_owner"] = self._is_owner(template, user_id, group_ids)
                # Enrich group-scoped templates with group name
                if template["scope"] == "group" and template.get("owner_group_id"):
                    gid = template["owner_group_id"]
                    if gid in group_name_map:
                        template["group_name"] = group_name_map[gid]
                    else:
                        # Fallback: look up the group name
                        try:
                            grp = self.group_service.get_group(gid)
                            if grp:
                                template["group_name"] = grp.get("name")
                                group_name_map[gid] = grp.get("name", "")
                        except Exception:
                            template["group_name"] = None
                accessible.append(template)

        # Apply tags filter (post-query for array overlap)
        if tags:
            accessible = [
                t for t in accessible
                if any(tag in (t.get("tags") or []) for tag in tags)
            ]

        return accessible

    def update_template(
        self,
        template_id: str,
        user_id: str,
        updates: Dict[str, Any],
        change_summary: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Update a template. Creates a version entry if content changed.

        Args:
            template_id: Template ID
            user_id: Requesting user ID
            updates: Fields to update
            change_summary: Description of changes

        Returns:
            Updated template or None if not authorized
        """
        template = self.get_template(template_id, user_id)
        if not template:
            return None

        if not self._can_edit(template, user_id):
            return None

        # Filter allowed fields
        allowed = {
            "name", "description", "study_type", "system_prompt",
            "entities", "summary_prompt", "variables", "tags", "is_immutable"
        }
        data = {k: v for k, v in updates.items() if k in allowed}

        if not data:
            return template

        # The database trigger will handle versioning
        result = (
            self.db.client.table("prompt_templates")
            .update(data)
            .eq("id", template_id)
            .execute()
        )

        return result.data[0] if result.data else None

    def delete_template(self, template_id: str, user_id: str) -> bool:
        """
        Delete a template. Requires ownership.

        Args:
            template_id: Template ID
            user_id: Requesting user ID

        Returns:
            True if deleted, False if not authorized
        """
        template = self.get_template(template_id, user_id)
        if not template:
            return False

        # Check delete permission (stricter than edit)
        if template["scope"] == "user":
            if template["owner_user_id"] != user_id:
                return False
        elif template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            if role not in ("admin", "owner"):
                return False
        elif template["scope"] == "global":
            # Global templates can be deleted by their creator
            if template.get("created_by") != user_id:
                return False

        self.db.client.table("prompt_templates").delete().eq("id", template_id).execute()
        return True

    # ==========================================
    # Version Operations
    # ==========================================

    def get_version_history(
        self,
        template_id: str,
        user_id: str,
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Get version history for a template.

        Args:
            template_id: Template ID
            user_id: Requesting user ID

        Returns:
            List of versions or None if not authorized
        """
        template = self.get_template(template_id, user_id)
        if not template:
            return None

        result = (
            self.db.client.table("template_versions")
            .select("*")
            .eq("template_id", template_id)
            .order("version", desc=True)
            .execute()
        )

        return result.data or []

    def revert_to_version(
        self,
        template_id: str,
        version: int,
        user_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Revert a template to a previous version.

        Args:
            template_id: Template ID
            version: Version number to revert to
            user_id: Requesting user ID

        Returns:
            Updated template or None if not authorized
        """
        template = self.get_template(template_id, user_id)
        if not template:
            return None

        if not self._can_edit(template, user_id):
            return None

        # Get the version to revert to
        result = (
            self.db.client.table("template_versions")
            .select("*")
            .eq("template_id", template_id)
            .eq("version", version)
            .execute()
        )

        if not result.data:
            return None

        old_version = result.data[0]

        # Update with old content
        updates = {
            "system_prompt": old_version["system_prompt"],
            "entities": old_version["entities"],
            "summary_prompt": old_version["summary_prompt"],
            "variables": old_version["variables"],
        }

        return self.update_template(template_id, user_id, updates)

    # ==========================================
    # Fork Operations
    # ==========================================

    def fork_template(
        self,
        template_id: str,
        user_id: str,
        new_name: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Create a personal copy of a template.

        Args:
            template_id: Template to fork
            user_id: User creating the fork
            new_name: Optional new name (defaults to "Copy of [original]")

        Returns:
            New template or None if source not accessible
        """
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
        """
        Change the scope of a template (publish/unpublish).

        Permission rules:
        - user -> group: user must be member/admin/owner of target group
        - user -> global: only the template creator
        - group -> user: group admin/owner can unpublish back to personal
        - group -> global: group admin/owner
        - global -> user/group: only the original creator

        Args:
            template_id: Template ID
            user_id: Requesting user ID
            new_scope: Target scope ('user', 'group', 'global')
            owner_group_id: Required when new_scope='group'

        Returns:
            Updated template or None if not authorized
        """
        if new_scope not in ("user", "group", "global"):
            raise ValueError("Invalid scope. Must be: user, group, or global")

        if new_scope == "group" and not owner_group_id:
            raise ValueError("owner_group_id required when changing to group scope")

        template = self.get_template(template_id, user_id)
        if not template:
            return None

        old_scope = template["scope"]

        if old_scope == new_scope:
            return template  # No change

        # Permission checks based on transition
        if old_scope == "user":
            # Only the owner can change scope of their personal template
            if template["owner_user_id"] != user_id:
                return None
            if new_scope == "group":
                role = self.group_service._get_role(owner_group_id, user_id)
                if role not in ("member", "admin", "owner"):
                    return None

        elif old_scope == "group":
            # Group admin/owner can change scope
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            if role not in ("admin", "owner"):
                return None
            if new_scope == "group" and owner_group_id != template["owner_group_id"]:
                # Moving to a different group: check membership in target group
                target_role = self.group_service._get_role(owner_group_id, user_id)
                if target_role not in ("member", "admin", "owner"):
                    return None

        elif old_scope == "global":
            # Only the original creator can change scope of global templates
            if template.get("created_by") != user_id:
                return None

        # Build update data based on new scope
        update_data: Dict[str, Any] = {"scope": new_scope}
        if new_scope == "user":
            update_data["owner_user_id"] = user_id
            update_data["owner_group_id"] = None
        elif new_scope == "group":
            update_data["owner_user_id"] = None
            update_data["owner_group_id"] = owner_group_id
        elif new_scope == "global":
            update_data["owner_user_id"] = None
            update_data["owner_group_id"] = None

        result = (
            self.db.client.table("prompt_templates")
            .update(update_data)
            .eq("id", template_id)
            .execute()
        )

        return result.data[0] if result.data else None

    # ==========================================
    # Permission Operations
    # ==========================================

    def set_immutable(
        self,
        template_id: str,
        user_id: str,
        is_immutable: bool,
    ) -> Optional[Dict[str, Any]]:
        """
        Set template immutability. Requires ownership.

        Args:
            template_id: Template ID
            user_id: Requesting user ID
            is_immutable: New immutability state

        Returns:
            Updated template or None if not authorized
        """
        template = self.get_template(template_id, user_id)
        if not template:
            return None

        # Only owner can change immutability
        if template["scope"] == "user":
            if template["owner_user_id"] != user_id:
                return None
        elif template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            if role not in ("admin", "owner"):
                return None
        else:
            return None

        result = (
            self.db.client.table("prompt_templates")
            .update({"is_immutable": is_immutable})
            .eq("id", template_id)
            .execute()
        )

        return result.data[0] if result.data else None

    def set_permission(
        self,
        template_id: str,
        target_user_id: str,
        can_read: bool,
        can_write: bool,
        granting_user_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Set per-user permission override.

        Args:
            template_id: Template ID
            target_user_id: User to grant/revoke permissions
            can_read: Read permission
            can_write: Write permission
            granting_user_id: User performing the action

        Returns:
            Permission record or None if not authorized
        """
        template = self.get_template(template_id, granting_user_id)
        if not template:
            return None

        # Check if user can manage permissions
        if template["scope"] == "user":
            if template["owner_user_id"] != granting_user_id:
                return None
        elif template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], granting_user_id)
            if role not in ("admin", "owner"):
                return None
        else:
            return None

        data = {
            "template_id": template_id,
            "user_id": target_user_id,
            "can_read": can_read,
            "can_write": can_write,
            "granted_by": granting_user_id,
        }

        result = (
            self.db.client.table("template_permissions")
            .upsert(data, on_conflict="template_id,user_id")
            .execute()
        )

        return result.data[0] if result.data else None

    def get_permissions(
        self,
        template_id: str,
        user_id: str,
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Get all permission overrides for a template.

        Args:
            template_id: Template ID
            user_id: Requesting user ID

        Returns:
            List of permissions or None if not authorized
        """
        template = self.get_template(template_id, user_id)
        if not template:
            return None

        # Check if user can view permissions
        if template["scope"] == "user":
            if template["owner_user_id"] != user_id:
                return None
        elif template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            if role not in ("admin", "owner"):
                return None

        result = (
            self.db.client.table("template_permissions")
            .select("*")
            .eq("template_id", template_id)
            .execute()
        )

        return result.data or []

    def remove_permission(
        self,
        template_id: str,
        target_user_id: str,
        removing_user_id: str,
    ) -> bool:
        """
        Remove a permission override.

        Args:
            template_id: Template ID
            target_user_id: User whose permission to remove
            removing_user_id: User performing the action

        Returns:
            True if removed, False if not authorized
        """
        template = self.get_template(template_id, removing_user_id)
        if not template:
            return False

        # Check if user can manage permissions
        if template["scope"] == "user":
            if template["owner_user_id"] != removing_user_id:
                return False
        elif template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], removing_user_id)
            if role not in ("admin", "owner"):
                return False
        else:
            return False

        self.db.client.table("template_permissions").delete().eq(
            "template_id", template_id
        ).eq("user_id", target_user_id).execute()
        return True

    # ==========================================
    # Helper Methods
    # ==========================================

    def _can_read(
        self,
        template: Dict[str, Any],
        user_id: str,
        user_group_ids: Optional[List[str]] = None,
    ) -> bool:
        """Check if user can read a template"""
        # Global templates are readable by all
        if template["scope"] == "global":
            return True

        # User scope: must be owner
        if template["scope"] == "user":
            if template["owner_user_id"] == user_id:
                return True

        # Group scope: must be member
        if template["scope"] == "group":
            if user_group_ids is None:
                user_groups = self.group_service.list_user_groups(user_id)
                user_group_ids = [g["id"] for g in user_groups]
            if template["owner_group_id"] in user_group_ids:
                return True

        # Check per-user override
        perm = (
            self.db.client.table("template_permissions")
            .select("can_read")
            .eq("template_id", template["id"])
            .eq("user_id", user_id)
            .execute()
        )
        if perm.data and perm.data[0]["can_read"]:
            return True

        return False

    def _can_edit(
        self,
        template: Dict[str, Any],
        user_id: str,
        user_group_ids: Optional[List[str]] = None,
    ) -> bool:
        """Check if user can edit a template"""
        # Cannot edit immutable templates
        if template.get("is_immutable"):
            return False

        # Check per-user override first (explicit deny)
        perm = (
            self.db.client.table("template_permissions")
            .select("can_write")
            .eq("template_id", template["id"])
            .eq("user_id", user_id)
            .execute()
        )
        if perm.data:
            if not perm.data[0]["can_write"]:
                return False
            return True  # Explicit grant

        # User scope: must be owner
        if template["scope"] == "user":
            return template["owner_user_id"] == user_id

        # Group scope: must be member with write role
        if template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            return role in ("member", "admin", "owner")

        # Global scope: not editable (only via service role)
        return False

    def _is_owner(
        self,
        template: Dict[str, Any],
        user_id: str,
        user_group_ids: Optional[List[str]] = None,
    ) -> bool:
        """Check if user is the owner/admin of a template (can manage lock/delete)"""
        if template["scope"] == "user":
            return template["owner_user_id"] == user_id
        if template["scope"] == "group":
            role = self.group_service._get_role(template["owner_group_id"], user_id)
            return role in ("admin", "owner")
        if template["scope"] == "global":
            # Global templates: the creator is the owner
            return template.get("created_by") == user_id
        return False


# Singleton instance
_template_service: Optional[TemplateService] = None


def get_template_service() -> TemplateService:
    """Get the singleton template service instance"""
    global _template_service
    if _template_service is None:
        _template_service = TemplateService()
    return _template_service
