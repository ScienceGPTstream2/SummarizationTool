import { useState, useEffect, useRef } from "react";
import { authenticatedFetch } from "../utils/authUtils";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Trash2,
  MoreHorizontal,
  RotateCcw,
  FileText,
  Activity,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Pencil,
  Check,
  X,
  Share2,
  Users,
  LinkIcon,
  Copy,
} from "lucide-react";
import { SessionSummary } from "../types/session";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { useGroups, Group } from "../hooks/useGroups";

interface SessionHistoryPageProps {
  userId: string;
  onRestoreSession: (sessionId: string) => void;
  onRestoreSharedSession?: (sessionId: string) => void;
  onBack: () => void;
  onSessionDeleted?: (sessionId: string) => void;
}

// Helper to format study type for display
const formatStudyType = (studyType?: string | null): string => {
  if (!studyType) return "";
  return studyType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

// Helper to generate a display name for the session
const getDisplayName = (session: SessionSummary): string => {
  // If name is auto-generated (ends with "... Session"), create a better one
  if (session.name.endsWith("... Session") || session.name.includes(".pdf")) {
    const studyType = formatStudyType(session.study_type);
    const date = new Date(session.created_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    if (studyType) {
      return `${studyType} - ${date}`;
    }
    if (session.document_count === 1 && session.document_names.length > 0) {
      // Single file: use truncated filename
      const filename = session.document_names[0];
      const baseName = filename.replace(/\.[^/.]+$/, ""); // Remove extension
      return baseName.length > 30
        ? baseName.substring(0, 30) + "..."
        : baseName;
    }
    return `Session - ${date}`;
  }
  return session.name;
};

export function SessionHistoryPage({
  userId,
  onRestoreSession,
  onRestoreSharedSession,
  onBack,
  onSessionDeleted,
}: SessionHistoryPageProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sharedSessions, setSharedSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("my-history");
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set()
  );

  // Inline rename state
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Share dialog state
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTargetSession, setShareTargetSession] =
    useState<SessionSummary | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [shareLoading, setShareLoading] = useState(false);

  // Groups hook for sharing
  const { groups, loading: groupsLoading } = useGroups();

  const toggleExpanded = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetch(`/api/sessions`);
      if (!response.ok) throw new Error("Failed to fetch sessions");
      const data = await response.json();
      setSessions(data.sessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      toast.error("Failed to load session history");
    } finally {
      setLoading(false);
    }
  };

  const fetchSharedSessions = async () => {
    try {
      setSharedLoading(true);
      const response = await authenticatedFetch(
        `/api/sessions/shared/list`
      );
      if (!response.ok) throw new Error("Failed to fetch shared sessions");
      const data = await response.json();
      setSharedSessions(data.sessions);
    } catch (error) {
      console.error("Error fetching shared sessions:", error);
      toast.error("Failed to load shared sessions");
    } finally {
      setSharedLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [userId]);

  // Fetch shared sessions when tab switches to shared
  useEffect(() => {
    if (activeTab === "shared-history" && sharedSessions.length === 0) {
      fetchSharedSessions();
    }
  }, [activeTab]);

  // ==========================================
  // Inline Rename
  // ==========================================

  const startEditing = (session: SessionSummary) => {
    setEditingSessionId(session.session_id);
    setEditingName(getDisplayName(session));
    // Focus the input after render
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const cancelEditing = () => {
    setEditingSessionId(null);
    setEditingName("");
  };

  const saveRename = async () => {
    if (!editingSessionId || !editingName.trim()) {
      cancelEditing();
      return;
    }

    const trimmedName = editingName.trim();

    try {
      const response = await authenticatedFetch(`/api/sessions/${editingSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!response.ok) throw new Error("Failed to rename session");

      // Update local state
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === editingSessionId ? { ...s, name: trimmedName } : s
        )
      );
      toast.success("Session renamed");
    } catch (error) {
      console.error("Error renaming session:", error);
      toast.error("Failed to rename session");
    } finally {
      cancelEditing();
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveRename();
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  };

  // ==========================================
  // Share / Unshare
  // ==========================================

  const openShareDialog = (session: SessionSummary) => {
    setShareTargetSession(session);
    setSelectedGroupId("");
    setShareDialogOpen(true);
  };

  const handleShare = async () => {
    if (!shareTargetSession || !selectedGroupId) return;

    setShareLoading(true);
    try {
      const response = await authenticatedFetch(
        `/api/sessions/${shareTargetSession.session_id}/share`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            group_id: selectedGroupId,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to share session");
      }

      const groupName =
        groups.find((g) => g.id === selectedGroupId)?.name || "group";
      toast.success(`Session shared with ${groupName}`);
      setShareDialogOpen(false);
    } catch (error: any) {
      console.error("Error sharing session:", error);
      toast.error(error.message || "Failed to share session");
    } finally {
      setShareLoading(false);
    }
  };

  const handleUnshare = async (sessionId: string) => {
    try {
      const response = await authenticatedFetch(
        `/api/sessions/${sessionId}/share`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Failed to unshare");
      toast.success("Session sharing removed");
    } catch (error) {
      console.error("Error unsharing:", error);
      toast.error("Failed to remove sharing");
    }
  };

  // ==========================================
  // Delete
  // ==========================================

  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  const handleDeleteClick = (sessionId: string) => {
    setSessionToDelete(sessionId);
  };

  const confirmDeleteSession = async () => {
    if (!sessionToDelete) return;

    try {
      const response = await authenticatedFetch(
        `/api/sessions/${sessionToDelete}`,
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to delete session");

      toast.success("Session deleted successfully");
      setSessions((prev) =>
        prev.filter((s) => s.session_id !== sessionToDelete)
      );

      if (onSessionDeleted) {
        onSessionDeleted(sessionToDelete);
      }
    } catch (error) {
      console.error("Error deleting session:", error);
      toast.error("Failed to delete session");
    } finally {
      setSessionToDelete(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "in_progress":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  // ==========================================
  // Render helpers
  // ==========================================

  const renderSessionRow = (
    session: SessionSummary,
    isShared: boolean = false
  ) => {
    const isExpanded = expandedSessions.has(session.session_id);
    const displayName = getDisplayName(session);
    const isEditing = editingSessionId === session.session_id;

    return (
      <TableRow
        key={session.session_id}
        className="group cursor-pointer hover:bg-muted/50"
        onClick={() => {
          if (isEditing) return;
          if (isShared && onRestoreSharedSession) {
            onRestoreSharedSession(session.session_id);
          } else {
            onRestoreSession(session.session_id);
          }
        }}
      >
        <TableCell className="font-medium">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {isEditing ? (
                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={saveRename}
                    className="text-base font-semibold border border-primary rounded px-2 py-0.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 w-[220px]"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      saveRename();
                    }}
                  >
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelEditing();
                    }}
                  >
                    <X className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </div>
              ) : (
                <>
                  <span className="text-base font-semibold hover:underline">
                    {displayName}
                  </span>
                  {!isShared && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(session);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Rename session"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </>
              )}
              {session.study_type && (
                <Badge variant="secondary" className="text-xs font-normal">
                  <FlaskConical className="h-3 w-3 mr-1" />
                  {formatStudyType(session.study_type)}
                </Badge>
              )}
            </div>
            {isShared && session.shared_by_name && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                <span>
                  Shared by {session.shared_by_name}
                  {session.shared_group_name &&
                    ` · ${session.shared_group_name}`}
                </span>
              </div>
            )}
            <span className="text-xs text-muted-foreground font-mono">
              {session.session_id.split("-")[0]}...
            </span>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={getStatusColor(session.status)}>
            {session.status === "completed" ? "Finished" : "In Progress"}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                session.document_names.length > 0 &&
                  toggleExpanded(session.session_id);
              }}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              disabled={session.document_names.length === 0}
            >
              <FileText className="h-4 w-4" />
              <span>
                {session.document_count} file
                {session.document_count !== 1 ? "s" : ""}
              </span>
              {session.document_names.length > 0 &&
                (isExpanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                ))}
            </button>
            {isExpanded && session.document_names.length > 0 && (
              <div className="mt-1 ml-5 space-y-0.5">
                {session.document_names.map((name, idx) => (
                  <div
                    key={idx}
                    className="text-xs text-muted-foreground truncate max-w-[200px]"
                    title={name}
                  >
                    {name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {new Date(
            isShared && session.shared_at
              ? session.shared_at
              : session.updated_at
          ).toLocaleString("en-US", {
            timeZone: "America/New_York",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
        </TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (isShared && onRestoreSharedSession) {
                  onRestoreSharedSession(session.session_id);
                } else {
                  onRestoreSession(session.session_id);
                }
              }}
            >
              {isShared ? (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Restore Copy
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restore
                </>
              )}
            </Button>
            {!isShared && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => startEditing(session)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openShareDialog(session)}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Share to Group
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleUnshare(session.session_id)}
                  >
                    <LinkIcon className="h-4 w-4 mr-2" />
                    Remove Sharing
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-700 focus:bg-red-50"
                    onClick={() => handleDeleteClick(session.session_id)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Session
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const renderEmptyState = (message: string) => (
    <TableRow>
      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <Activity className="h-8 w-8 opacity-20" />
          <p>{message}</p>
        </div>
      </TableCell>
    </TableRow>
  );

  const renderLoadingState = () => (
    <TableRow>
      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
        Loading history...
      </TableCell>
    </TableRow>
  );

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Session History
          </h1>
          <p className="text-muted-foreground">
            Manage your past extraction sessions and results.
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          Create New Session
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="my-history" className="gap-2">
            <FileText className="h-4 w-4" />
            My History
            {sessions.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {sessions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="shared-history" className="gap-2">
            <Share2 className="h-4 w-4" />
            Shared History
            {sharedSessions.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {sharedSessions.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* My History Tab */}
        <TabsContent value="my-history">
          <div className="bg-white dark:bg-slate-950 rounded-lg border shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Session Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Documents</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? renderLoadingState()
                  : sessions.length === 0
                    ? renderEmptyState("No extraction sessions found.")
                    : sessions.map((session) =>
                        renderSessionRow(session, false)
                      )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Shared History Tab */}
        <TabsContent value="shared-history">
          <div className="bg-white dark:bg-slate-950 rounded-lg border shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Session Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Documents</TableHead>
                  <TableHead>Shared</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sharedLoading
                  ? renderLoadingState()
                  : sharedSessions.length === 0
                    ? renderEmptyState(
                        "No shared sessions found. Sessions shared to your groups will appear here."
                      )
                    : sharedSessions.map((session) =>
                        renderSessionRow(session, true)
                      )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Share to Group Dialog */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Share Session
            </DialogTitle>
            <DialogDescription>
              Share &quot;
              {shareTargetSession && getDisplayName(shareTargetSession)}&quot;
              with a group. All group members will be able to view and clone
              this session.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Group</label>
              {groupsLoading ? (
                <p className="text-sm text-muted-foreground">
                  Loading groups...
                </p>
              ) : groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You don&apos;t belong to any groups yet. Create a group first
                  from the Groups page.
                </p>
              ) : (
                <Select
                  value={selectedGroupId}
                  onValueChange={setSelectedGroupId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a group..." />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group: Group) => (
                      <SelectItem key={group.id} value={group.id}>
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span>{group.name}</span>
                          {group.member_count != null && (
                            <span className="text-xs text-muted-foreground">
                              ({group.member_count} members)
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <p>
                <strong>Note:</strong> Sessions can currently be shared with one
                group at a time. Sharing to a new group will replace the
                previous share.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShareDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleShare}
              disabled={!selectedGroupId || shareLoading}
            >
              {shareLoading ? "Sharing..." : "Share"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!sessionToDelete}
        onOpenChange={(open) => !open && setSessionToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              session and remove all extracted data from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteSession}
              className="bg-red-600 hover:bg-red-700 text-white focus:ring-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
