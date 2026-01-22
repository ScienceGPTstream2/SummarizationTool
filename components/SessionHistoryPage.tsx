import { useState, useEffect } from "react";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "./ui/table";
import { Button } from "./ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "./ui/dropdown-menu";
import { Badge } from "./ui/badge";
import {
    Trash2,
    MoreHorizontal,
    RotateCcw,
    FileText,
    Activity
} from "lucide-react";
import { SessionSummary } from "../types/session";
import { toast } from "sonner";

interface SessionHistoryPageProps {
    userId: string;
    onRestoreSession: (sessionId: string) => void;
    onBack: () => void;
}

export function SessionHistoryPage({ userId, onRestoreSession, onBack }: SessionHistoryPageProps) {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [loading, setLoading] = useState(true);

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

    const handleDeleteSession = async (sessionId: string) => {
        if (!confirm("Are you sure you want to delete this session? This action cannot be undone.")) {
            return;
        }

        try {
            const response = await fetch(`/api/sessions/${sessionId}?user_id=${userId}`, {
                method: "DELETE",
            });

            if (!response.ok) throw new Error("Failed to delete session");

            toast.success("Session deleted successfully");
            // Remove from local state
            setSessions(prev => prev.filter(s => s.session_id !== sessionId));
        } catch (error) {
            console.error("Error deleting session:", error);
            toast.error("Failed to delete session");
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case "completed": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
            case "in_progress": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
            default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
        }
    };

    return (
        <div className="container mx-auto py-8 px-4 max-w-6xl">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Session History</h1>
                    <p className="text-muted-foreground">
                        Manage your past extraction sessions and results.
                    </p>
                </div>
                <Button variant="outline" onClick={onBack}>
                    Back to Dashboard
                </Button>
            </div>

            <div className="bg-white dark:bg-slate-950 rounded-lg border shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[300px]">Session Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Documents</TableHead>
                            <TableHead>Extractions</TableHead>
                            <TableHead>Last Updated</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                    Loading history...
                                </TableCell>
                            </TableRow>
                        ) : sessions.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                                    <div className="flex flex-col items-center gap-2">
                                        <Activity className="h-8 w-8 opacity-20" />
                                        <p>No extraction sessions found.</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            sessions.map((session) => (
                                <TableRow key={session.session_id}>
                                    <TableCell className="font-medium">
                                        <div className="flex flex-col">
                                            <span className="text-base font-semibold">{session.name}</span>
                                            <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                                                {session.session_id.split('-')[0]}...
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={getStatusColor(session.status)}>
                                            {session.status.replace("_", " ")}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                            <FileText className="h-4 w-4" />
                                            {session.document_count}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                            <Activity className="h-4 w-4" />
                                            {session.extraction_count}
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
                                            hour12: true
                                        })}
                                    </TableCell>
                                    <TableCell className="text-right">
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
                                                        onClick={() => handleDeleteSession(session.session_id)}
                                                    >
                                                        <Trash2 className="h-4 w-4 mr-2" />
                                                        Delete Session
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
