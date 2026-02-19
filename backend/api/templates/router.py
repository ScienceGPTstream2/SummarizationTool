"""Templates API Router - CRUD operations for prompt templates"""

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional, List, Any

from core.dependencies import get_current_user
from services.templates.template_service import get_template_service

router = APIRouter(prefix="/api/templates", tags=["templates"])


# ==========================================
# Request/Response Models
# ==========================================


class EntityModel(BaseModel):
    name: str
    prompt: str


class VariableModel(BaseModel):
    name: str
    description: Optional[str] = None
    default: Optional[str] = None


class CreateTemplateRequest(BaseModel):
    name: str
    entities: List[EntityModel]
    scope: str = "user"  # user, group, global
    owner_group_id: Optional[str] = None
    description: Optional[str] = None
    study_type: Optional[str] = None
    system_prompt: Optional[str] = None
    summary_prompt: Optional[str] = None
    variables: Optional[List[VariableModel]] = None
    tags: Optional[List[str]] = None
    is_immutable: bool = False


class UpdateTemplateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    study_type: Optional[str] = None
    system_prompt: Optional[str] = None
    entities: Optional[List[EntityModel]] = None
    summary_prompt: Optional[str] = None
    variables: Optional[List[VariableModel]] = None
    tags: Optional[List[str]] = None
    is_immutable: Optional[bool] = None
    change_summary: Optional[str] = None


class SetImmutableRequest(BaseModel):
    is_immutable: bool


class SetPermissionRequest(BaseModel):
    user_id: str
    can_read: bool = True
    can_write: bool = False


class ForkTemplateRequest(BaseModel):
    new_name: Optional[str] = None


class ChangeScopeRequest(BaseModel):
    new_scope: str  # 'user', 'group', or 'global'
    owner_group_id: Optional[str] = None  # Required when new_scope='group'


class TemplateResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    study_type: Optional[str]
    scope: str
    owner_user_id: Optional[str]
    owner_group_id: Optional[str]
    system_prompt: Optional[str]
    entities: List[Any]
    summary_prompt: Optional[str]
    variables: Optional[List[Any]]
    tags: Optional[List[str]]
    is_immutable: bool
    version: int
    created_by: Optional[str]
    created_at: str
    updated_at: str
    can_edit: Optional[bool] = None
    is_owner: Optional[bool] = None
    group_name: Optional[str] = None


class VersionResponse(BaseModel):
    id: str
    template_id: str
    version: int
    system_prompt: Optional[str]
    entities: List[Any]
    summary_prompt: Optional[str]
    variables: Optional[List[Any]]
    changed_by: Optional[str]
    change_summary: Optional[str]
    created_at: str


class PermissionResponse(BaseModel):
    id: str
    template_id: str
    user_id: str
    can_read: bool
    can_write: bool
    granted_by: Optional[str]
    created_at: str


# ==========================================
# Template CRUD Endpoints
# ==========================================


@router.get("", response_model=List[TemplateResponse])
async def list_templates(
    scope: Optional[str] = Query(
        None, description="Filter by scope: user, group, global"
    ),
    study_type: Optional[str] = Query(None, description="Filter by study type"),
    search: Optional[str] = Query(None, description="Search in name/description"),
    tags: Optional[str] = Query(None, description="Comma-separated tags"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """List accessible templates with filtering"""
    service = get_template_service()

    tag_list = [t.strip() for t in tags.split(",")] if tags else None

    templates = service.list_templates(
        user_id=current_user["id"],
        scope=scope,
        study_type=study_type,
        tags=tag_list,
        search=search,
        limit=limit,
        offset=offset,
    )
    return templates


@router.post("", response_model=TemplateResponse, status_code=201)
async def create_template(
    request: CreateTemplateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create a new template"""
    service = get_template_service()

    try:
        template = service.create_template(
            user_id=current_user["id"],
            name=request.name,
            entities=[e.model_dump() for e in request.entities],
            scope=request.scope,
            owner_group_id=request.owner_group_id,
            description=request.description,
            study_type=request.study_type,
            system_prompt=request.system_prompt,
            summary_prompt=request.summary_prompt,
            variables=(
                [v.model_dump() for v in request.variables]
                if request.variables
                else None
            ),
            tags=request.tags,
            is_immutable=request.is_immutable,
        )
        template["can_edit"] = True
        template["is_owner"] = True
        return template
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a template by ID"""
    service = get_template_service()
    template = service.get_template(template_id, current_user["id"])

    if not template:
        raise HTTPException(
            status_code=404,
            detail="Template not found or you don't have access",
        )

    return template


@router.put("/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: str,
    request: UpdateTemplateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update a template. Creates a new version if content changed."""
    service = get_template_service()

    # Convert entities and variables if present
    updates = request.model_dump(exclude_none=True, exclude={"change_summary"})
    if "entities" in updates:
        updates["entities"] = [
            e.model_dump() if hasattr(e, "model_dump") else e
            for e in updates["entities"]
        ]
    if "variables" in updates:
        updates["variables"] = [
            v.model_dump() if hasattr(v, "model_dump") else v
            for v in updates["variables"]
        ]

    template = service.update_template(
        template_id=template_id,
        user_id=current_user["id"],
        updates=updates,
        change_summary=request.change_summary,
    )

    if not template:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to update this template or template is immutable",
        )

    return template


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a template. Requires ownership."""
    service = get_template_service()
    deleted = service.delete_template(template_id, current_user["id"])

    if not deleted:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to delete this template",
        )


# ==========================================
# Fork and Immutability Endpoints
# ==========================================


@router.post("/{template_id}/fork", response_model=TemplateResponse, status_code=201)
async def fork_template(
    template_id: str,
    request: ForkTemplateRequest = ForkTemplateRequest(),
    current_user: dict = Depends(get_current_user),
):
    """Create a personal copy of a template"""
    service = get_template_service()
    template = service.fork_template(
        template_id=template_id,
        user_id=current_user["id"],
        new_name=request.new_name,
    )

    if not template:
        raise HTTPException(
            status_code=404,
            detail="Template not found or you don't have access",
        )

    template["can_edit"] = True
    template["is_owner"] = True
    return template


@router.put("/{template_id}/scope", response_model=TemplateResponse)
async def change_scope(
    template_id: str,
    request: ChangeScopeRequest,
    current_user: dict = Depends(get_current_user),
):
    """Change the scope of a template (publish/unpublish)"""
    service = get_template_service()
    try:
        template = service.change_scope(
            template_id=template_id,
            user_id=current_user["id"],
            new_scope=request.new_scope,
            owner_group_id=request.owner_group_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not template:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to change template scope",
        )

    return template


@router.put("/{template_id}/immutable", response_model=TemplateResponse)
async def set_immutable(
    template_id: str,
    request: SetImmutableRequest,
    current_user: dict = Depends(get_current_user),
):
    """Set template immutability. Requires ownership."""
    service = get_template_service()
    template = service.set_immutable(
        template_id=template_id,
        user_id=current_user["id"],
        is_immutable=request.is_immutable,
    )

    if not template:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to change immutability",
        )

    return template


# ==========================================
# Version Endpoints
# ==========================================


@router.get("/{template_id}/versions", response_model=List[VersionResponse])
async def get_versions(
    template_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get version history for a template"""
    service = get_template_service()
    versions = service.get_version_history(template_id, current_user["id"])

    if versions is None:
        raise HTTPException(
            status_code=404,
            detail="Template not found or you don't have access",
        )

    return versions


@router.post("/{template_id}/revert/{version}", response_model=TemplateResponse)
async def revert_to_version(
    template_id: str,
    version: int,
    current_user: dict = Depends(get_current_user),
):
    """Revert a template to a previous version"""
    service = get_template_service()
    template = service.revert_to_version(
        template_id=template_id,
        version=version,
        user_id=current_user["id"],
    )

    if not template:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to revert or version not found",
        )

    return template


# ==========================================
# Permission Endpoints
# ==========================================


@router.get("/{template_id}/permissions", response_model=List[PermissionResponse])
async def get_permissions(
    template_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get permission overrides for a template"""
    service = get_template_service()
    permissions = service.get_permissions(template_id, current_user["id"])

    if permissions is None:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to view permissions",
        )

    return permissions


@router.post(
    "/{template_id}/permissions", response_model=PermissionResponse, status_code=201
)
async def set_permission(
    template_id: str,
    request: SetPermissionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Set permission override for a specific user"""
    service = get_template_service()
    permission = service.set_permission(
        template_id=template_id,
        target_user_id=request.user_id,
        can_read=request.can_read,
        can_write=request.can_write,
        granting_user_id=current_user["id"],
    )

    if not permission:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to manage permissions",
        )

    return permission


@router.delete("/{template_id}/permissions/{user_id}", status_code=204)
async def remove_permission(
    template_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a permission override"""
    service = get_template_service()
    removed = service.remove_permission(
        template_id=template_id,
        target_user_id=user_id,
        removing_user_id=current_user["id"],
    )

    if not removed:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to remove permissions",
        )
