"""Groups API Router - CRUD operations for user groups"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List

from core.dependencies import get_current_user
from services.groups.group_service import get_group_service

router = APIRouter(prefix="/api/groups", tags=["groups"])


# ==========================================
# Request/Response Models
# ==========================================


class CreateGroupRequest(BaseModel):
    name: str
    description: Optional[str] = None


class UpdateGroupRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class AddMemberRequest(BaseModel):
    user_id: str
    role: str = "member"  # viewer, member, admin


class UpdateMemberRoleRequest(BaseModel):
    role: str  # viewer, member, admin


class GroupResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_by: Optional[str]
    created_at: str
    updated_at: str
    user_role: Optional[str] = None
    member_count: Optional[int] = None


class MemberResponse(BaseModel):
    user_id: str
    role: str
    joined_at: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    avatar_url: Optional[str] = None


class GroupDetailResponse(GroupResponse):
    members: List[MemberResponse] = []


# ==========================================
# Group CRUD Endpoints
# ==========================================


@router.get("", response_model=List[GroupResponse])
async def list_groups(current_user: dict = Depends(get_current_user)):
    """List all groups the current user belongs to"""
    service = get_group_service()
    groups = service.list_user_groups(current_user["id"])
    return groups


@router.post("", response_model=GroupResponse, status_code=201)
async def create_group(
    request: CreateGroupRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create a new group with current user as owner"""
    service = get_group_service()
    try:
        group = service.create_group(
            user_id=current_user["id"],
            name=request.name,
            description=request.description,
        )
        group["user_role"] = "owner"
        return group
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{group_id}", response_model=GroupDetailResponse)
async def get_group(
    group_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a group by ID with members"""
    service = get_group_service()
    group = service.get_group(
        group_id, current_user["id"], is_system_admin=current_user.get("is_admin", False)
    )

    if not group:
        raise HTTPException(
            status_code=404,
            detail="Group not found or you don't have access",
        )

    return group


@router.put("/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: str,
    request: UpdateGroupRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update a group. Requires admin or owner role (or system admin)."""
    service = get_group_service()
    group = service.update_group(
        group_id=group_id,
        user_id=current_user["id"],
        updates=request.model_dump(exclude_none=True),
        is_system_admin=current_user.get("is_admin", False),
    )

    if not group:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to update this group",
        )

    return group


@router.delete("/{group_id}", status_code=204)
async def delete_group(
    group_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a group. Requires owner role (or system admin)."""
    service = get_group_service()
    deleted = service.delete_group(
        group_id, current_user["id"], is_system_admin=current_user.get("is_admin", False)
    )

    if not deleted:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to delete this group. Only owners can delete groups.",
        )


# ==========================================
# Membership Endpoints
# ==========================================


@router.get("/{group_id}/members", response_model=List[MemberResponse])
async def get_group_members(
    group_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get all members of a group"""
    service = get_group_service()
    members = service.get_group_members(
        group_id, current_user["id"], is_system_admin=current_user.get("is_admin", False)
    )

    if members is None:
        raise HTTPException(
            status_code=404,
            detail="Group not found or you don't have access",
        )

    return members


@router.post("/{group_id}/members", response_model=MemberResponse, status_code=201)
async def add_member(
    group_id: str,
    request: AddMemberRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add a member to a group. Requires admin or owner role (or system admin)."""
    # Validate role
    if request.role not in ("viewer", "member", "admin"):
        raise HTTPException(
            status_code=400,
            detail="Invalid role. Must be: viewer, member, or admin",
        )

    service = get_group_service()
    membership = service.add_member(
        group_id=group_id,
        target_user_id=request.user_id,
        role=request.role,
        requesting_user_id=current_user["id"],
        is_system_admin=current_user.get("is_admin", False),
    )

    if not membership:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to add members to this group",
        )

    return membership


@router.put("/{group_id}/members/{user_id}", response_model=MemberResponse)
async def update_member_role(
    group_id: str,
    user_id: str,
    request: UpdateMemberRoleRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update a member's role. Requires admin or owner role (or system admin)."""
    # Validate role
    if request.role not in ("viewer", "member", "admin"):
        raise HTTPException(
            status_code=400,
            detail="Invalid role. Must be: viewer, member, or admin",
        )

    service = get_group_service()
    membership = service.update_member_role(
        group_id=group_id,
        target_user_id=user_id,
        new_role=request.role,
        requesting_user_id=current_user["id"],
        is_system_admin=current_user.get("is_admin", False),
    )

    if not membership:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to update member roles",
        )

    return membership


@router.delete("/{group_id}/members/{user_id}", status_code=204)
async def remove_member(
    group_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a member from a group. Users can remove themselves, admins/system admins can remove others."""
    service = get_group_service()
    removed = service.remove_member(
        group_id=group_id,
        target_user_id=user_id,
        requesting_user_id=current_user["id"],
        is_system_admin=current_user.get("is_admin", False),
    )

    if not removed:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to remove this member",
        )


# ==========================================
# User Search (for Add Member)
# ==========================================


class UserSearchResult(BaseModel):
    user_id: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    avatar_url: Optional[str] = None


@router.get("/users/search", response_model=List[UserSearchResult])
async def search_users(
    q: str,
    group_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Search users by name, email, or user ID for adding to groups."""
    if not q or len(q) < 2:
        return []

    service = get_group_service()
    query_lower = q.lower().strip()

    # Get existing group members to exclude them
    existing_member_ids: set = set()
    if group_id:
        try:
            members = service.db.client.table("user_groups") \
                .select("user_id") \
                .eq("group_id", group_id) \
                .execute()
            existing_member_ids = {m["user_id"] for m in (members.data or [])}
        except Exception:
            pass

    results: List[UserSearchResult] = []

    # 1. Try exact/partial UUID match first
    try:
        # If query looks like a UUID prefix, search for users starting with it
        users_resp = service.db.client.auth.admin.list_users()
        if users_resp:
            for user in users_resp:
                if user.id in existing_member_ids:
                    continue

                meta = user.user_metadata or {}
                display_name = (
                    meta.get("full_name")
                    or meta.get("name")
                    or meta.get("preferred_username")
                    or meta.get("user_name")
                )
                email = user.email or ""
                avatar_url = meta.get("avatar_url")

                # Match against user_id, display_name, or email
                if (
                    query_lower in (user.id or "").lower()
                    or query_lower in (display_name or "").lower()
                    or query_lower in email.lower()
                ):
                    results.append(
                        UserSearchResult(
                            user_id=user.id,
                            display_name=display_name,
                            email=email,
                            avatar_url=avatar_url,
                        )
                    )

                if len(results) >= 10:
                    break
    except Exception:
        pass

    return results
