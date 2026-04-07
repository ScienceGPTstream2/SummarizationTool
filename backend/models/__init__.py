"""
SQLAlchemy Models Package

All database models for the application, including Better Auth tables.
"""

from models.base import Base, get_engine, get_session_factory, get_db_session, DATABASE_URL
from models.user import User, Account, AuthSession, Verification
from models.app_session import AppSession
from models.document import Document
from models.extraction import ExtractionResult
from models.evaluation import EvaluationResult
from models.group import Group, UserGroup
from models.template import PromptTemplate, TemplateVersion, TemplatePermission, TemplateFolder
from models.preferences import UserPreferences, LoginHistory, UserPromptTemplate
from models.eval_job import EvalJobRecord

__all__ = [
    "Base",
    "get_engine",
    "get_session_factory",
    "get_db_session",
    "DATABASE_URL",
    # Better Auth tables
    "User",
    "Account",
    "AuthSession",
    "Verification",
    # App tables
    "AppSession",
    "Document",
    "ExtractionResult",
    "EvaluationResult",
    "Group",
    "UserGroup",
    "PromptTemplate",
    "TemplateVersion",
    "TemplatePermission",
    "TemplateFolder",
    "UserPreferences",
    "LoginHistory",
    "EvalJobRecord",
]
