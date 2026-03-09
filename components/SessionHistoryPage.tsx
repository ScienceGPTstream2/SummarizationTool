import { useState, useEffect } from "react";

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
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Badge } from "./ui/badge";
import {
  Trash2,
  MoreHorizontal,
  RotateCcw,
  FileText,
  Activity,
  ChevronDown,
  ChevronUp,
  FlaskConical,
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

interface SessionHistoryPageProps {
  userId: string;
  onRestoreSession: (sessionId: string) => void;
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
  onBack,
  onSessionDeleted,
}: SessionHistoryPageProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set()
  );

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
      const response = await fetch(`/api/sessions?user_id=${userId}`);
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

  useEffect(() => {
    fetchSessions();
  }, [userId]);

  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  const handleDeleteClick = (sessionId: string) => {
    setSessionToDelete(sessionId);
  };

  const confirmDeleteSession = async () => {
    if (!sessionToDelete) return;

    try {
      const response = await fetch(
        `/api/sessions/${sessionToDelete}?user_id=${userId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("Failed to delete session");

      toast.success("Session deleted successfully");
      // Remove from local state
      setSessions((prev) =>
        prev.filter((s) => s.session_id !== sessionToDelete)
      );

      // Notify parent
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
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  Loading history...
                </TableCell>
              </TableRow>
            ) : sessions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <Activity className="h-8 w-8 opacity-20" />
                    <p>No extraction sessions found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((session) => {
                const isExpanded = expandedSessions.has(session.session_id);
                const displayName = getDisplayName(session);

                return (
                  <TableRow
                    key={session.session_id}
                    className="group cursor-pointer hover:bg-muted/50"
                    onClick={() => onRestoreSession(session.session_id)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold hover:underline">
                            {displayName}
                          </span>
                          {session.study_type && (
                            <Badge
                              variant="secondary"
                              className="text-xs font-normal"
                            >
                              <FlaskConical className="h-3 w-3 mr-1" />
                              {formatStudyType(session.study_type)}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          {session.session_id.split("-")[0]}...
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={getStatusColor(session.status)}
                      >
                        {session.status === "completed"
                          ? "Finished"
                          : "In Progress"}
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
                      {new Date(session.updated_at).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRestoreSession(session.session_id)}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Restore
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-700 focus:bg-red-50"
                              onClick={() =>
                                handleDeleteClick(session.session_id)
                              }
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Session
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

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
