"""
Group and Membership Models

User groups for sharing sessions and templates.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column,
    String,
    Text,
    DateTime,
    ForeignKey,
    Index,
    CheckConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from models.base import Base


class Group(Base):
    """
    A user group for sharing sessions and templates.

    Replaces the Supabase 'groups' table.
    """

    __tablename__ = "groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    created_by = Column(String(36), ForeignKey("user.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_groups_created_by", "created_by"),
        Index("idx_groups_name", "name"),
    )


class UserGroup(Base):
    """
    User-group membership with roles.
    Roles: viewer, member, admin, owner

    Replaces the Supabase 'user_groups' table.
    """

    __tablename__ = "user_groups"

    user_id = Column(
        String(36), ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role = Column(Text, default="member")
    joined_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "role IN ('viewer', 'member', 'admin', 'owner')", name="ck_user_groups_role"
        ),
        Index("idx_user_groups_user_id", "user_id"),
        Index("idx_user_groups_group_id", "group_id"),
    )
