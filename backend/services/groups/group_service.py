"""
Group Service

Provides business logic for managing user groups and memberships.
Uses service role key to bypass RLS for backend operations.
"""

from typing import Optional, Dict, Any, List
from datetime import datetime

from services.database.supabase_db_service import get_db_service


class GroupService:
    """Service for managing groups and memberships"""

    def __init__(self):
        self.db = get_db_service()

    # ==========================================
    # Group CRUD Operations
    # ==========================================

    def create_group(
        self,
        user_id: str,
        name: str,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a new group with the user as owner.

        Args:
            user_id: ID of the user creating the group
            name: Group name
            description: Optional group description

        Returns:
            Created group with membership
        """
        # Create the group
        group_data = {
            "name": name,
            "description": description,
            "created_by": user_id,
        }
        result = self.db.client.table("groups").insert(group_data).execute()

        if not result.data:
            raise ValueError("Failed to create group")

        group = result.data[0]

        # Add creator as owner
        membership_data = {
            "user_id": user_id,
            "group_id": group["id"],
            "role": "owner",
        }
        self.db.client.table("user_groups").insert(membership_data).execute()

        return group

    def get_group(
        self, group_id: str, user_id: str, is_system_admin: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Get a group by ID with members.

        Args:
            group_id: Group ID
            user_id: Requesting user ID (for permission check)
            is_system_admin: If True, bypass permission checks

        Returns:
            Group with members or None if not found/not authorized
        """
        # System admins can access any group
        if not is_system_admin:
            # Check if user is a member
            membership = (
                self.db.client.table("user_groups")
                .select("role")
                .eq("group_id", group_id)
                .eq("user_id", user_id)
                .execute()
            )

            if not membership.data:
                return None

        # Get group
        result = self.db.client.table("groups").select("*").eq("id", group_id).execute()

        if not result.data:
            return None

        group = result.data[0]

        # Set role
        if is_system_admin:
            group["user_role"] = "system_admin"
        else:
            membership = (
                self.db.client.table("user_groups")
                .select("role")
                .eq("group_id", group_id)
                .eq("user_id", user_id)
                .execute()
            )
            group["user_role"] = membership.data[0]["role"] if membership.data else None

        # Get members
        members_result = (
            self.db.client.table("user_groups")
            .select("user_id, role, joined_at")
            .eq("group_id", group_id)
            .execute()
        )
        group["members"] = self._enrich_members_with_profiles(members_result.data or [])

        return group

    def list_user_groups(self, user_id: str) -> List[Dict[str, Any]]:
        """
        List all groups a user belongs to.

        Args:
            user_id: User ID

        Returns:
            List of groups with user's role in each
        """
        # Get user's memberships
        memberships = (
            self.db.client.table("user_groups")
            .select("group_id, role")
            .eq("user_id", user_id)
            .execute()
        )

        if not memberships.data:
            return []

        group_ids = [m["group_id"] for m in memberships.data]
        role_map = {m["group_id"]: m["role"] for m in memberships.data}

        # Get groups
        result = (
            self.db.client.table("groups")
            .select("*")
            .in_("id", group_ids)
            .order("name")
            .execute()
        )

        groups = result.data or []

        # Add user's role to each group
        for group in groups:
            group["user_role"] = role_map.get(group["id"], "member")

            # Get member count
            members = (
                self.db.client.table("user_groups")
                .select("user_id")
                .eq("group_id", group["id"])
                .execute()
            )
            group["member_count"] = len(members.data) if members.data else 0

        return groups

    def update_group(
        self,
        group_id: str,
        user_id: str,
        updates: Dict[str, Any],
        is_system_admin: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """
        Update a group. Requires admin or owner role (or system admin).

        Args:
            group_id: Group ID
            user_id: Requesting user ID
            updates: Fields to update (name, description)
            is_system_admin: If True, bypass permission checks

        Returns:
            Updated group or None if not authorized
        """
        # Check permission (system admins bypass)
        if not is_system_admin and not self._has_admin_role(group_id, user_id):
            return None

        # Filter allowed fields
        allowed = {"name", "description"}
        data = {k: v for k, v in updates.items() if k in allowed and v is not None}

        if not data:
            return self.get_group(group_id, user_id)

        result = (
            self.db.client.table("groups").update(data).eq("id", group_id).execute()
        )

        return result.data[0] if result.data else None

    def delete_group(
        self, group_id: str, user_id: str, is_system_admin: bool = False
    ) -> bool:
        """
        Delete a group. Requires owner role (or system admin).

        Args:
            group_id: Group ID
            user_id: Requesting user ID
            is_system_admin: If True, bypass permission checks

        Returns:
            True if deleted, False if not authorized
        """
        if not is_system_admin:
            # Check if user is owner
            membership = (
                self.db.client.table("user_groups")
                .select("role")
                .eq("group_id", group_id)
                .eq("user_id", user_id)
                .execute()
            )

            if not membership.data or membership.data[0]["role"] != "owner":
                return False

        # Delete group (cascades to memberships)
        self.db.client.table("groups").delete().eq("id", group_id).execute()
        return True

    # ==========================================
    # Membership Operations
    # ==========================================

    def get_group_members(
        self, group_id: str, user_id: str, is_system_admin: bool = False
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Get all members of a group.

        Args:
            group_id: Group ID
            user_id: Requesting user ID
            is_system_admin: If True, bypass permission checks

        Returns:
            List of members or None if not authorized
        """
        # Check if user is a member (system admins bypass)
        if not is_system_admin and not self._is_member(group_id, user_id):
            return None

        result = (
            self.db.client.table("user_groups")
            .select("user_id, role, joined_at")
            .eq("group_id", group_id)
            .order("role")
            .execute()
        )

        return self._enrich_members_with_profiles(result.data or [])

    def add_member(
        self,
        group_id: str,
        target_user_id: str,
        role: str,
        requesting_user_id: str,
        is_system_admin: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """
        Add a member to a group. Requires admin or owner role (or system admin).

        Args:
            group_id: Group ID
            target_user_id: User to add
            role: Role to assign (viewer, member, admin)
            requesting_user_id: User performing the action
            is_system_admin: If True, bypass permission checks

        Returns:
            Created membership or None if not authorized
        """
        # Check permission (system admins bypass)
        if not is_system_admin and not self._has_admin_role(
            group_id, requesting_user_id
        ):
            return None

        # Cannot add someone as owner
        if role == "owner":
            role = "admin"

        # Check if already a member
        existing = (
            self.db.client.table("user_groups")
            .select("*")
            .eq("group_id", group_id)
            .eq("user_id", target_user_id)
            .execute()
        )

        if existing.data:
            # Update role instead
            return self.update_member_role(
                group_id, target_user_id, role, requesting_user_id
            )

        data = {
            "user_id": target_user_id,
            "group_id": group_id,
            "role": role,
        }

        result = self.db.client.table("user_groups").insert(data).execute()
        return result.data[0] if result.data else None

    def update_member_role(
        self,
        group_id: str,
        target_user_id: str,
        new_role: str,
        requesting_user_id: str,
        is_system_admin: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """
        Update a member's role. Requires admin or owner role (or system admin).

        Args:
            group_id: Group ID
            target_user_id: User to update
            new_role: New role
            requesting_user_id: User performing the action
            is_system_admin: If True, bypass permission checks

        Returns:
            Updated membership or None if not authorized
        """
        # System admins can do anything
        if is_system_admin:
            # Cannot change owner role or make someone owner
            target_role = self._get_role(group_id, target_user_id)
            if target_role == "owner" or new_role == "owner":
                return None

            result = (
                self.db.client.table("user_groups")
                .update({"role": new_role})
                .eq("group_id", group_id)
                .eq("user_id", target_user_id)
                .execute()
            )
            return result.data[0] if result.data else None

        # Check permission
        requester_role = self._get_role(group_id, requesting_user_id)
        if requester_role not in ("admin", "owner"):
            return None

        # Only owners can promote to admin
        if new_role == "admin" and requester_role != "owner":
            return None

        # Cannot change owner role
        target_role = self._get_role(group_id, target_user_id)
        if target_role == "owner":
            return None

        # Cannot make someone owner (transfer ownership is separate)
        if new_role == "owner":
            return None

        result = (
            self.db.client.table("user_groups")
            .update({"role": new_role})
            .eq("group_id", group_id)
            .eq("user_id", target_user_id)
            .execute()
        )

        return result.data[0] if result.data else None

    def remove_member(
        self,
        group_id: str,
        target_user_id: str,
        requesting_user_id: str,
        is_system_admin: bool = False,
    ) -> bool:
        """
        Remove a member from a group.

        Args:
            group_id: Group ID
            target_user_id: User to remove
            requesting_user_id: User performing the action
            is_system_admin: If True, bypass permission checks (can still not remove owners)

        Returns:
            True if removed, False if not authorized
        """
        # Users can remove themselves
        if target_user_id == requesting_user_id:
            # Cannot leave if you're the only owner
            if self._is_only_owner(group_id, target_user_id):
                return False

            self.db.client.table("user_groups").delete().eq("group_id", group_id).eq(
                "user_id", target_user_id
            ).execute()
            return True

        # System admins can remove anyone except owners
        if is_system_admin:
            target_role = self._get_role(group_id, target_user_id)
            if target_role == "owner":
                return False
            self.db.client.table("user_groups").delete().eq("group_id", group_id).eq(
                "user_id", target_user_id
            ).execute()
            return True

        # Otherwise need admin role
        if not self._has_admin_role(group_id, requesting_user_id):
            return False

        # Cannot remove owners
        target_role = self._get_role(group_id, target_user_id)
        if target_role == "owner":
            return False

        self.db.client.table("user_groups").delete().eq("group_id", group_id).eq(
            "user_id", target_user_id
        ).execute()
        return True

    # ==========================================
    # Helper Methods
    # ==========================================

    def _is_member(self, group_id: str, user_id: str) -> bool:
        """Check if user is any member of the group"""
        result = (
            self.db.client.table("user_groups")
            .select("user_id")
            .eq("group_id", group_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(result.data)

    def _get_role(self, group_id: str, user_id: str) -> Optional[str]:
        """Get user's role in a group"""
        result = (
            self.db.client.table("user_groups")
            .select("role")
            .eq("group_id", group_id)
            .eq("user_id", user_id)
            .execute()
        )
        return result.data[0]["role"] if result.data else None

    def _has_admin_role(self, group_id: str, user_id: str) -> bool:
        """Check if user has admin or owner role"""
        role = self._get_role(group_id, user_id)
        return role in ("admin", "owner")

    def _is_only_owner(self, group_id: str, user_id: str) -> bool:
        """Check if user is the only owner of the group"""
        owners = (
            self.db.client.table("user_groups")
            .select("user_id")
            .eq("group_id", group_id)
            .eq("role", "owner")
            .execute()
        )
        return len(owners.data) == 1 and owners.data[0]["user_id"] == user_id

    def _enrich_members_with_profiles(
        self, members: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Enrich member records with user profile info (name, email) from Supabase auth."""
        if not members:
            return members

        for member in members:
            try:
                user_resp = self.db.client.auth.admin.get_user_by_id(member["user_id"])
                if user_resp and user_resp.user:
                    user = user_resp.user
                    # Try to get a display name from user_metadata (OAuth providers set this)
                    meta = user.user_metadata or {}
                    member["display_name"] = (
                        meta.get("full_name")
                        or meta.get("name")
                        or meta.get("preferred_username")
                        or meta.get("user_name")
                        or None
                    )
                    member["email"] = user.email
                    member["avatar_url"] = meta.get("avatar_url")
            except Exception:
                # If lookup fails, leave the fields empty
                pass

        return members


# Singleton instance
_group_service: Optional[GroupService] = None


def get_group_service() -> GroupService:
    """Get the singleton group service instance"""
    global _group_service
    if _group_service is None:
        _group_service = GroupService()
    return _group_service
