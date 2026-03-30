"""
Prompt Template Models

Templates for entity extraction prompts with versioning and permissions.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, DateTime, ForeignKey, Index,
    UniqueConstraint, CheckConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from models.base import Base


class TemplateFolder(Base):
    """
    Folder for organising prompt templates hierarchically.
    Supports user, group, and global scope.
    """
    __tablename__ = "template_folders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    scope = Column(Text, nullable=False, default="user")  # user | group | global
    owner_user_id = Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=True)
    owner_group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("template_folders.id", ondelete="CASCADE"), nullable=True)
    created_by = Column(String(36), ForeignKey("user.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("scope IN ('user', 'group', 'global')", name="ck_template_folders_scope"),
        Index("idx_template_folders_scope", "scope"),
        Index("idx_template_folders_owner_user", "owner_user_id"),
        Index("idx_template_folders_owner_group", "owner_group_id"),
        Index("idx_template_folders_parent", "parent_id"),
    )


class PromptTemplate(Base):
    """
    A prompt template for entity extraction.
    
    Replaces the Supabase 'prompt_templates' table.
    """
    __tablename__ = "prompt_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    study_type = Column(Text, nullable=True)

    # Scope: user, group, or global
    scope = Column(Text, nullable=False, default="user")
    owner_user_id = Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=True)
    owner_group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)

    # Template content
    system_prompt = Column(Text, nullable=True)
    entities = Column(JSONB, nullable=False, default=list)    # [{name, prompt}]
    summary_prompt = Column(Text, nullable=True)
    variables = Column(JSONB, default=list)                   # [{name, description, default}]

    # Immutability control
    is_immutable = Column(Boolean, default=False)

    # Metadata
    tags = Column(ARRAY(Text), default=list)
    is_default = Column(Boolean, default=False)
    version = Column(Integer, default=1)
    
    # Folder organization
    folder_id = Column(UUID(as_uuid=True), nullable=True)

    created_by = Column(String(36), ForeignKey("user.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("scope IN ('user', 'group', 'global')", name="ck_templates_scope"),
        Index("idx_prompt_templates_scope", "scope"),
        Index("idx_prompt_templates_owner_user", "owner_user_id"),
        Index("idx_prompt_templates_owner_group", "owner_group_id"),
        Index("idx_prompt_templates_study_type", "study_type"),
        Index("idx_prompt_templates_created_by", "created_by"),
    )


class TemplateVersion(Base):
    """
    Version history for prompt templates.
    
    Replaces the Supabase 'template_versions' table.
    """
    __tablename__ = "template_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID(as_uuid=True), ForeignKey("prompt_templates.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False)

    # Snapshot of template content at this version
    system_prompt = Column(Text, nullable=True)
    entities = Column(JSONB, nullable=False)
    summary_prompt = Column(Text, nullable=True)
    variables = Column(JSONB, nullable=True)

    changed_by = Column(String(36), ForeignKey("user.id"), nullable=True)
    change_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("template_id", "version", name="uq_template_version"),
        Index("idx_template_versions_template_id", "template_id"),
    )


class TemplatePermission(Base):
    """
    Per-user permission overrides for templates.
    
    Replaces the Supabase 'template_permissions' table.
    """
    __tablename__ = "template_permissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID(as_uuid=True), ForeignKey("prompt_templates.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    can_read = Column(Boolean, default=True)
    can_write = Column(Boolean, default=False)
    granted_by = Column(String(36), ForeignKey("user.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("template_id", "user_id", name="uq_template_permission"),
        Index("idx_template_permissions_template", "template_id"),
        Index("idx_template_permissions_user", "user_id"),
    )
