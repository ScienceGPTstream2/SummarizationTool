/**
 * GroupManagementPage — Full-page view for managing user groups and members.
 *
 * Features:
 *   - List of groups the user belongs to with role badges
 *   - Create new group dialog
 *   - Expand a group to view/manage members
 *   - Add/remove members, change roles (admin/owner only)
 */

import { useState, useRef, useMemo } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Textarea } from "../ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import {
  ArrowLeft,
  Plus,
  Users,
  Shield,
  ShieldCheck,
  Crown,
  Eye,
  UserPlus,
  Trash2,
  MoreVertical,
  Loader2,
  AlertCircle,
  Edit,
  ChevronDown,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import {
  useGroups,
  Group,
  GroupMember,
  GroupDetail,
  UserSearchResult,
} from "../../hooks/useGroups";

interface GroupManagementPageProps {
  onBack: () => void;
}

const ROLE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  owner: {
    label: "Owner",
    icon: <Crown className="h-3 w-3" />,
    color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  },
  admin: {
    label: "Admin",
    icon: <ShieldCheck className="h-3 w-3" />,
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  },
  member: {
    label: "Member",
    icon: <Shield className="h-3 w-3" />,
    color: "bg-green-500/10 text-green-600 border-green-500/20",
  },
  viewer: {
    label: "Viewer",
    icon: <Eye className="h-3 w-3" />,
    color: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  },
};

function RoleBadge({ role }: { role: string }) {
  const config = ROLE_CONFIG[role] || ROLE_CONFIG.viewer;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${config.color}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function GroupManagementPage({ onBack }: GroupManagementPageProps) {
  const {
    groups,
    loading,
    error,
    createGroup,
    updateGroup,
    deleteGroup,
    getGroupDetail,
    addMember,
    updateMemberRole,
    removeMember,
    searchUsers,
  } = useGroups();

  // Create group dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit group dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [updating, setUpdating] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Expanded groups (multi-expand)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set()
  );
  const [groupDetails, setGroupDetails] = useState<Map<string, GroupDetail>>(
    new Map()
  );
  const [loadingDetailIds, setLoadingDetailIds] = useState<Set<string>>(
    new Set()
  );

  // Group search
  const [groupSearchQuery, setGroupSearchQuery] = useState("");

  // Add member (tracks which group)
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null);
  const [newMemberUserId, setNewMemberUserId] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("member");
  const [addingMember, setAddingMember] = useState(false);

  // User search (for add member dialog)
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(
    null
  );
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Remove member
  const [removeMemberTarget, setRemoveMemberTarget] =
    useState<GroupMember | null>(null);
  const [removeMemberGroupId, setRemoveMemberGroupId] = useState<string | null>(
    null
  );

  // Action error
  const [actionError, setActionError] = useState<string | null>(null);

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    if (!groupSearchQuery.trim()) return groups;
    const q = groupSearchQuery.toLowerCase().trim();
    return groups.filter((group) => {
      // Match group name
      if (group.name.toLowerCase().includes(q)) return true;
      if (group.description?.toLowerCase().includes(q)) return true;
      // Match member display names in cached details
      const detail = groupDetails.get(group.id);
      if (detail) {
        return detail.members.some(
          (m) =>
            m.display_name?.toLowerCase().includes(q) ||
            m.email?.toLowerCase().includes(q)
        );
      }
      return false;
    });
  }, [groups, groupSearchQuery, groupDetails]);

  const loadGroupDetail = async (groupId: string) => {
    setLoadingDetailIds((prev) => new Set(prev).add(groupId));
    setActionError(null);
    try {
      const detail = await getGroupDetail(groupId);
      setGroupDetails((prev) => new Map(prev).set(groupId, detail));
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setLoadingDetailIds((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreating(true);
    setActionError(null);
    try {
      await createGroup({
        name: newGroupName.trim(),
        description: newGroupDesc.trim() || undefined,
      });
      setCreateOpen(false);
      setNewGroupName("");
      setNewGroupDesc("");
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleEditGroup = async () => {
    if (!editGroup || !editName.trim()) return;
    setUpdating(true);
    setActionError(null);
    try {
      await updateGroup(editGroup.id, {
        name: editName.trim(),
        description: editDesc.trim() || undefined,
      });
      setEditOpen(false);
      setEditGroup(null);
      if (expandedGroupIds.has(editGroup.id)) {
        loadGroupDetail(editGroup.id);
      }
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteGroup(deleteTarget.id);
      setExpandedGroupIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      setGroupDetails((prev) => {
        const next = new Map(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      setDeleteTarget(null);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleAddMember = async () => {
    const userId = selectedUser?.user_id || newMemberUserId.trim();
    if (!addMemberGroupId || !userId) return;
    setAddingMember(true);
    setActionError(null);
    try {
      await addMember(addMemberGroupId, userId, newMemberRole);
      const gid = addMemberGroupId;
      setAddMemberGroupId(null);
      resetAddMemberState();
      loadGroupDetail(gid);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setAddingMember(false);
    }
  };

  const resetAddMemberState = () => {
    setNewMemberUserId("");
    setNewMemberRole("member");
    setUserSearchQuery("");
    setSearchResults([]);
    setSelectedUser(null);
  };

  const handleSearchInput = (value: string) => {
    setUserSearchQuery(value);
    setSelectedUser(null);
    setNewMemberUserId("");

    // Clear previous debounce timer
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (value.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchUsers(
          value.trim(),
          addMemberGroupId || undefined
        );
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const handleSelectUser = (user: UserSearchResult) => {
    setSelectedUser(user);
    setNewMemberUserId(user.user_id);
    setUserSearchQuery(user.display_name || user.email || user.user_id);
    setSearchResults([]);
  };

  const handleUpdateRole = async (
    groupId: string,
    userId: string,
    newRole: string
  ) => {
    setActionError(null);
    try {
      await updateMemberRole(groupId, userId, newRole);
      loadGroupDetail(groupId);
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleRemoveMember = async () => {
    if (!removeMemberGroupId || !removeMemberTarget) return;
    setActionError(null);
    try {
      await removeMember(removeMemberGroupId, removeMemberTarget.user_id);
      setRemoveMemberTarget(null);
      setRemoveMemberGroupId(null);
      loadGroupDetail(removeMemberGroupId);
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const openEditDialog = (group: Group) => {
    setEditGroup(group);
    setEditName(group.name);
    setEditDesc(group.description || "");
    setEditOpen(true);
  };

  const toggleExpand = (groupId: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
        // Load detail if not cached
        if (!groupDetails.has(groupId)) {
          loadGroupDetail(groupId);
        }
      }
      return next;
    });
  };

  const canManageGroup = (group: Group) => {
    return group.user_role === "admin" || group.user_role === "owner";
  };

  const canDeleteGroup = (group: Group) => {
    return group.user_role === "owner";
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" />
              Groups
            </h2>
            <p className="text-sm text-muted-foreground">
              Manage your groups and team members
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Group
        </Button>
      </div>

      {/* Error banner */}
      {(error || actionError) && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error || actionError}
          {actionError && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-xs"
              onClick={() => setActionError(null)}
            >
              Dismiss
            </Button>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && groups.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="font-medium text-lg mb-1">No groups yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a group to collaborate on templates with your team.
            </p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Group
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Group list */}
      {!loading && groups.length > 0 && (
        <div className="space-y-3">
          {/* Group search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={groupSearchQuery}
              onChange={(e) => setGroupSearchQuery(e.target.value)}
              placeholder="Search groups by name or member..."
              className="pl-9 pr-9"
            />
            {groupSearchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-7 w-7"
                onClick={() => setGroupSearchQuery("")}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {filteredGroups.length === 0 && groupSearchQuery.trim() && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No groups match &ldquo;{groupSearchQuery}&rdquo;
            </p>
          )}
          {filteredGroups.map((group) => (
            <Card
              key={group.id}
              className={`transition-colors ${expandedGroupIds.has(group.id) ? "border-primary/30" : ""}`}
            >
              {/* Group header row */}
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div
                    className="flex items-center gap-3 cursor-pointer flex-1"
                    onClick={() => toggleExpand(group.id)}
                  >
                    {expandedGroupIds.has(group.id) ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        {group.name}
                        <RoleBadge role={group.user_role || "viewer"} />
                      </CardTitle>
                      {group.description && (
                        <CardDescription className="mt-0.5 truncate">
                          {group.description}
                        </CardDescription>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {group.member_count || 0}{" "}
                      {(group.member_count || 0) === 1 ? "member" : "members"}
                    </span>
                    {canManageGroup(group) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => openEditDialog(group)}
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            Edit Group
                          </DropdownMenuItem>
                          {canDeleteGroup(group) && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setDeleteTarget(group)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete Group
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </CardHeader>

              {/* Expanded: members list */}
              {expandedGroupIds.has(group.id) &&
                (() => {
                  const detail = groupDetails.get(group.id);
                  const isLoading = loadingDetailIds.has(group.id);
                  return (
                    <CardContent className="pt-2 border-t">
                      {isLoading ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : detail ? (
                        <div className="space-y-3">
                          {/* Members header */}
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium text-muted-foreground">
                              Members
                            </h4>
                            {canManageGroup(group) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setAddMemberGroupId(group.id)}
                              >
                                <UserPlus className="h-3 w-3 mr-1" />
                                Add Member
                              </Button>
                            )}
                          </div>

                          {/* Members table */}
                          <div className="rounded-md border">
                            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
                              <span>Member</span>
                              <span>Role</span>
                              <span className="w-8" />
                            </div>
                            {detail.members.map((member: GroupMember) => (
                              <div
                                key={member.user_id}
                                className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2.5 items-center border-b last:border-b-0 hover:bg-muted/20"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {member.avatar_url ? (
                                    <img
                                      src={member.avatar_url}
                                      alt=""
                                      className="h-7 w-7 rounded-full flex-shrink-0 border border-border"
                                    />
                                  ) : (
                                    <div className="h-7 w-7 rounded-full flex-shrink-0 bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                                      {(member.display_name ||
                                        member.email ||
                                        "?")[0]?.toUpperCase()}
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">
                                      {member.display_name ||
                                        member.email ||
                                        "Unknown User"}
                                    </div>
                                    <div
                                      className="text-xs text-muted-foreground font-mono truncate"
                                      title={member.user_id}
                                    >
                                      {member.user_id}
                                    </div>
                                  </div>
                                </div>
                                {canManageGroup(group) &&
                                member.role !== "owner" ? (
                                  <Select
                                    value={member.role}
                                    onValueChange={(v) =>
                                      handleUpdateRole(
                                        group.id,
                                        member.user_id,
                                        v
                                      )
                                    }
                                  >
                                    <SelectTrigger className="h-7 w-28 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="viewer">
                                        Viewer
                                      </SelectItem>
                                      <SelectItem value="member">
                                        Member
                                      </SelectItem>
                                      <SelectItem value="admin">
                                        Admin
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <RoleBadge role={member.role} />
                                )}
                                {canManageGroup(group) &&
                                member.role !== "owner" ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive/60 hover:text-destructive"
                                    onClick={() => {
                                      setRemoveMemberTarget(member);
                                      setRemoveMemberGroupId(group.id);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                ) : (
                                  <div className="w-7" />
                                )}
                              </div>
                            ))}
                            {detail.members.length === 0 && (
                              <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                                No members yet
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  );
                })()}
            </Card>
          ))}
        </div>
      )}

      {/* ======================== */}
      {/* Dialogs                  */}
      {/* ======================== */}

      {/* Create Group Dialog */}
      {createOpen && (
        <Dialog
          open={createOpen}
          onOpenChange={(o) => !o && setCreateOpen(false)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Group</DialogTitle>
              <DialogDescription>
                Create a new group to collaborate on templates.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="group-name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="group-name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g., Toxicology Team"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-desc">Description</Label>
                <Textarea
                  id="group-desc"
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="Optional description..."
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateGroup}
                disabled={creating || !newGroupName.trim()}
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Group Dialog */}
      {editOpen && editGroup && (
        <Dialog open={editOpen} onOpenChange={(o) => !o && setEditOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Group</DialogTitle>
              <DialogDescription>
                Update the group name or description.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-desc">Description</Label>
                <Textarea
                  id="edit-desc"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={updating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleEditGroup}
                disabled={updating || !editName.trim()}
              >
                {updating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Add Member Dialog */}
      {addMemberGroupId && (
        <Dialog
          open={!!addMemberGroupId}
          onOpenChange={(o) => {
            if (!o) {
              setAddMemberGroupId(null);
              resetAddMemberState();
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Member</DialogTitle>
              <DialogDescription>
                Search for a user by name, email, or user ID.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Search input */}
              <div className="space-y-2">
                <Label htmlFor="member-search">
                  Find User <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="member-search"
                    value={userSearchQuery}
                    onChange={(e) => handleSearchInput(e.target.value)}
                    placeholder="Type a name, email, or user ID..."
                    className="pl-9"
                    autoFocus
                    autoComplete="off"
                  />
                  {searching && (
                    <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>

                {/* Search results dropdown */}
                {searchResults.length > 0 && !selectedUser && (
                  <div className="rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                    {searchResults.map((user) => (
                      <button
                        key={user.user_id}
                        type="button"
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-accent transition-colors border-b last:border-b-0"
                        onClick={() => handleSelectUser(user)}
                      >
                        {user.avatar_url ? (
                          <img
                            src={user.avatar_url}
                            alt=""
                            className="h-7 w-7 rounded-full flex-shrink-0 border border-border"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full flex-shrink-0 bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                            {(user.display_name ||
                              user.email ||
                              "?")[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">
                            {user.display_name || user.email || "Unknown"}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono truncate">
                            {user.user_id}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No results */}
                {userSearchQuery.trim().length >= 2 &&
                  !searching &&
                  searchResults.length === 0 &&
                  !selectedUser && (
                    <p className="text-xs text-muted-foreground px-1">
                      No users found. You can paste a user ID directly.
                    </p>
                  )}

                {/* Selected user preview */}
                {selectedUser && (
                  <div className="flex items-center gap-2.5 p-2.5 rounded-md border bg-accent/30">
                    {selectedUser.avatar_url ? (
                      <img
                        src={selectedUser.avatar_url}
                        alt=""
                        className="h-8 w-8 rounded-full border border-border"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                        {(selectedUser.display_name ||
                          selectedUser.email ||
                          "?")[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {selectedUser.display_name || selectedUser.email}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {selectedUser.user_id}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        setSelectedUser(null);
                        setNewMemberUserId("");
                        setUserSearchQuery("");
                      }}
                    >
                      Change
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={newMemberRole} onValueChange={setNewMemberRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">
                      Viewer — can view group templates
                    </SelectItem>
                    <SelectItem value="member">
                      Member — can create and edit templates
                    </SelectItem>
                    <SelectItem value="admin">
                      Admin — can manage members and templates
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setAddMemberGroupId(null);
                  resetAddMemberState();
                }}
                disabled={addingMember}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddMember}
                disabled={
                  addingMember || (!selectedUser && !newMemberUserId.trim())
                }
              >
                {addingMember ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4 mr-2" />
                )}
                Add Member
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Group Confirmation */}
      {deleteTarget && (
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Group</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{deleteTarget.name}"? This will
                also remove all group-scoped templates. This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteGroup}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Delete Group
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Remove Member Confirmation */}
      {removeMemberTarget && (
        <AlertDialog
          open={!!removeMemberTarget}
          onOpenChange={(o) => !o && setRemoveMemberTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Member</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove user "
                {removeMemberTarget.email || removeMemberTarget.user_id}" from
                this group?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRemoveMember}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
