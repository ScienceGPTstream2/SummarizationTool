"""
Group Service

Provides business logic for managing user groups and memberships.
"""

import uuid as _uuid_module
from typing import Optional, Dict, Any, List
from datetime import datetime

from sqlalchemy import select, delete, update
from models import Group, UserGroup, User
from models.base import get_db_session, db_session_scope


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


class GroupService:
    """Service for managing groups and memberships"""

    # ==========================================
    # Group CRUD Operations
    # ==========================================

    def create_group(
        self,
        user_id: str,
        name: str,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new group with the user as owner."""
        with db_session_scope() as db:
            group = Group(
                name=name,
                description=description,
                created_by=user_id,
            )
            db.add(group)
            db.flush()

            membership = UserGroup(
                user_id=user_id,
                group_id=group.id,
                role="owner",
            )
            db.add(membership)
            db.flush()
            return _row_to_dict(group)

    def get_group(
        self, group_id: str, user_id: str, is_system_admin: bool = False
    ) -> Optional[Dict[str, Any]]:
        """Get a group by ID with members."""
        db = get_db_session()
        try:
            gid = _to_uuid(group_id)

            if not is_system_admin:
                membership = db.execute(
                    select(UserGroup).where(
                        UserGroup.group_id == gid,
                        UserGroup.user_id == user_id,
                    )
                ).scalar_one_or_none()
                if membership is None:
                    return None

            group = db.execute(
                select(Group).where(Group.id == gid)
            ).scalar_one_or_none()
            if group is None:
                return None

            group_dict = _row_to_dict(group)

            if is_system_admin:
                group_dict["user_role"] = "system_admin"
            else:
                m = db.execute(
                    select(UserGroup).where(
                        UserGroup.group_id == gid,
                        UserGroup.user_id == user_id,
                    )
                ).scalar_one_or_none()
                group_dict["user_role"] = m.role if m else None

            members = db.execute(
                select(UserGroup).where(UserGroup.group_id == gid)
            ).scalars().all()
            member_dicts = [_row_to_dict(m) for m in members]
            group_dict["members"] = self._enrich_members_with_profiles(member_dicts, db)
            return group_dict
        finally:
            db.close()

    def list_user_groups(self, user_id: str) -> List[Dict[str, Any]]:
        """List all groups a user belongs to."""
        db = get_db_session()
        try:
            memberships = db.execute(
                select(UserGroup).where(UserGroup.user_id == user_id)
            ).scalars().all()

            if not memberships:
                return []

            group_ids = [m.group_id for m in memberships]
            role_map = {str(m.group_id): m.role for m in memberships}

            groups = db.execute(
                select(Group)
                .where(Group.id.in_(group_ids))
                .order_by(Group.name)
            ).scalars().all()

            # Batch count members per group
            from sqlalchemy import func
            count_rows = db.execute(
                select(UserGroup.group_id, func.count().label("cnt"))
                .where(UserGroup.group_id.in_(group_ids))
                .group_by(UserGroup.group_id)
            ).all()
            count_map = {str(r.group_id): r.cnt for r in count_rows}

            result = []
            for g in groups:
                d = _row_to_dict(g)
                d["user_role"] = role_map.get(str(g.id), "member")
                d["member_count"] = count_map.get(str(g.id), 0)
                result.append(d)
            return result
        finally:
            db.close()

    def update_group(
        self,
        group_id: str,
        user_id: str,
        updates: Dict[str, Any],
        is_system_admin: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Update a group. Requires admin or owner role."""
        if not is_system_admin and not self._has_admin_role(group_id, user_id):
            return None

        allowed = {"name", "description"}
        data = {k: v for k, v in updates.items() if k in allowed and v is not None}
        if not data:
            return self.get_group(group_id, user_id, is_system_admin)

        with db_session_scope() as db:
            group = db.execute(
                select(Group).where(Group.id == _to_uuid(group_id))
            ).scalar_one_or_none()
            if group is None:
                return None
            for k, v in data.items():
                setattr(group, k, v)
            group.updated_at = datetime.utcnow()
            db.flush()
            return _row_to_dict(group)

    def delete_group(
        self, group_id: str, user_id: str, is_system_admin: bool = False
    ) -> bool:
        """Delete a group. Requires owner role."""
        if not is_system_admin:
            role = self._get_role(group_id, user_id)
            if role != "owner":
                return False

        with db_session_scope() as db:
            db.execute(delete(Group).where(Group.id == _to_uuid(group_id)))
        return True

    # ==========================================
    # Membership Operations
    # ==========================================

    def get_group_members(
        self, group_id: str, user_id: str, is_system_admin: bool = False
    ) -> Optional[List[Dict[str, Any]]]:
        """Get all members of a group."""
        if not is_system_admin and not self._is_member(group_id, user_id):
            return None

        db = get_db_session()
        try:
            members = db.execute(
                select(UserGroup)
                .where(UserGroup.group_id == _to_uuid(group_id))
                .order_by(UserGroup.role)
            ).scalars().all()
            member_dicts = [_row_to_dict(m) for m in members]
            return self._enrich_members_with_profiles(member_dicts, db)
        finally:
            db.close()

    def add_member(
        self,
        group_id: str,
        target_user_id: str,
        role: str,
        requesting_user_id: str,
        is_system_admin: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Add a member to a group. Requires admin or owner role."""
        if not is_system_admin and not self._has_admin_role(group_id, requesting_user_id):
            return None

        if role == "owner":
            role = "admin"

        # Check if already a member
        existing_role = self._get_role(group_id, target_user_id)
        if existing_role is not None:
            return self.update_member_role(group_id, target_user_id, role, requesting_user_id, is_system_admin)

        with db_session_scope() as db:
            membership = UserGroup(
                user_id=target_user_id,
                group_id=_to_uuid(group_id),
                role=role,
            )
            db.add(membership)
            db.flush()
            return _row_to_dict(membership)

    def update_member_role(
        self,
        group_id: str,
        target_user_id: str,
        new_role: str,
        requesting_user_id: str,
        is_system_admin: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Update a member's role."""
        gid = _to_uuid(group_id)

        # Cannot change to/from owner
        target_role = self._get_role(group_id, target_user_id)
        if target_role == "owner" or new_role == "owner":
            return None

        if not is_system_admin:
            requester_role = self._get_role(group_id, requesting_user_id)
            if requester_role not in ("admin", "owner"):
                return None
            if new_role == "admin" and requester_role != "owner":
                return None

        with db_session_scope() as db:
            m = db.execute(
                select(UserGroup).where(
                    UserGroup.group_id == gid,
                    UserGroup.user_id == target_user_id,
                )
            ).scalar_one_or_none()
            if m is None:
                return None
            m.role = new_role
            db.flush()
            return _row_to_dict(m)

    def remove_member(
        self,
        group_id: str,
        target_user_id: str,
        requesting_user_id: str,
        is_system_admin: bool = False,
    ) -> bool:
        """Remove a member from a group."""
        gid = _to_uuid(group_id)

        if target_user_id == requesting_user_id:
            if self._is_only_owner(group_id, target_user_id):
                return False
            with db_session_scope() as db:
                db.execute(
                    delete(UserGroup).where(
                        UserGroup.group_id == gid,
                        UserGroup.user_id == target_user_id,
                    )
                )
            return True

        if is_system_admin:
            if self._get_role(group_id, target_user_id) == "owner":
                return False
        else:
            if not self._has_admin_role(group_id, requesting_user_id):
                return False
            if self._get_role(group_id, target_user_id) == "owner":
                return False

        with db_session_scope() as db:
            db.execute(
                delete(UserGroup).where(
                    UserGroup.group_id == gid,
                    UserGroup.user_id == target_user_id,
                )
            )
        return True

    # ==========================================
    # Helper Methods
    # ==========================================

    def _is_member(self, group_id: str, user_id: str) -> bool:
        db = get_db_session()
        try:
            m = db.execute(
                select(UserGroup).where(
                    UserGroup.group_id == _to_uuid(group_id),
                    UserGroup.user_id == user_id,
                )
            ).scalar_one_or_none()
            return m is not None
        finally:
            db.close()

    def _get_role(self, group_id: str, user_id: str) -> Optional[str]:
        db = get_db_session()
        try:
            m = db.execute(
                select(UserGroup).where(
                    UserGroup.group_id == _to_uuid(group_id),
                    UserGroup.user_id == user_id,
                )
            ).scalar_one_or_none()
            return m.role if m else None
        finally:
            db.close()

    def _has_admin_role(self, group_id: str, user_id: str) -> bool:
        return self._get_role(group_id, user_id) in ("admin", "owner")

    def _is_only_owner(self, group_id: str, user_id: str) -> bool:
        db = get_db_session()
        try:
            owners = db.execute(
                select(UserGroup).where(
                    UserGroup.group_id == _to_uuid(group_id),
                    UserGroup.role == "owner",
                )
            ).scalars().all()
            return len(owners) == 1 and owners[0].user_id == user_id
        finally:
            db.close()

    def _enrich_members_with_profiles(
        self, members: List[Dict[str, Any]], db=None
    ) -> List[Dict[str, Any]]:
        """Enrich member records with user profile info from the user table."""
        if not members:
            return members

        close_db = db is None
        if db is None:
            db = get_db_session()

        try:
            user_ids = [m["user_id"] for m in members]
            users = db.execute(
                select(User).where(User.id.in_(user_ids))
            ).scalars().all()
            user_map = {u.id: u for u in users}

            for member in members:
                u = user_map.get(member["user_id"])
                if u:
                    member["display_name"] = u.name or u.email
                    member["email"] = u.email
                    member["avatar_url"] = u.image
                else:
                    member.setdefault("display_name", None)
                    member.setdefault("email", None)
                    member.setdefault("avatar_url", None)
        finally:
            if close_db:
                db.close()

        return members


# Singleton instance
_group_service: Optional[GroupService] = None


def get_group_service() -> GroupService:
    """Get the singleton group service instance"""
    global _group_service
    if _group_service is None:
        _group_service = GroupService()
    return _group_service
