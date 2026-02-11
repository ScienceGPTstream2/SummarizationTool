/**
 * TemplateVersionHistory - Shows version list with revert capability.
 */

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import {
    Clock,
    RotateCcw,
    ChevronDown,
    ChevronUp,
    FileText,
} from "lucide-react";
import { TemplateVersion } from "../../hooks/useTemplates";

interface TemplateVersionHistoryProps {
    open: boolean;
    onClose: () => void;
    templateName: string;
    currentVersion: number;
    versions: TemplateVersion[];
    loading: boolean;
    onRevert: (version: number) => Promise<void>;
}

function formatDateTime(dateString: string) {
    return new Date(dateString).toLocaleString();
}

export function TemplateVersionHistory({
    open,
    onClose,
    templateName,
    currentVersion,
    versions,
    loading,
    onRevert,
}: TemplateVersionHistoryProps) {
    const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
    const [reverting, setReverting] = useState<number | null>(null);

    const handleRevert = async (version: number) => {
        setReverting(version);
        try {
            await onRevert(version);
        } finally {
            setReverting(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Version History
                    </DialogTitle>
                    <DialogDescription>
                        {templateName} — {versions.length} version
                        {versions.length !== 1 ? "s" : ""}
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="space-y-3 py-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="animate-pulse h-16 bg-muted rounded-lg" />
                        ))}
                    </div>
                ) : versions.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                        <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p>No version history available</p>
                    </div>
                ) : (
                    <div className="space-y-2 py-2">
                        {versions.map((ver) => {
                            const isCurrent = ver.version === currentVersion;
                            const isExpanded = expandedVersion === ver.version;

                            return (
                                <Card
                                    key={ver.id}
                                    className={`transition-colors ${isCurrent
                                            ? "border-primary/50 bg-primary/5"
                                            : "hover:border-muted-foreground/30"
                                        }`}
                                >
                                    <CardContent className="p-3">
                                        <div
                                            className="flex items-center justify-between cursor-pointer"
                                            onClick={() =>
                                                setExpandedVersion(isExpanded ? null : ver.version)
                                            }
                                        >
                                            <div className="flex items-center gap-2">
                                                <Badge
                                                    variant={isCurrent ? "default" : "outline"}
                                                    className="text-xs"
                                                >
                                                    v{ver.version}
                                                </Badge>
                                                {isCurrent && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                                    >
                                                        Current
                                                    </Badge>
                                                )}
                                                <span className="text-xs text-muted-foreground">
                                                    {formatDateTime(ver.created_at)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {!isCurrent && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 text-xs"
                                                        disabled={reverting !== null}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleRevert(ver.version);
                                                        }}
                                                    >
                                                        <RotateCcw className="h-3 w-3 mr-1" />
                                                        {reverting === ver.version
                                                            ? "Reverting..."
                                                            : "Revert"}
                                                    </Button>
                                                )}
                                                {isExpanded ? (
                                                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </div>
                                        </div>

                                        {ver.change_summary && (
                                            <p className="text-sm text-muted-foreground mt-1 ml-1">
                                                {ver.change_summary}
                                            </p>
                                        )}

                                        {isExpanded && (
                                            <div className="mt-3 pt-3 border-t space-y-2">
                                                {ver.entities?.length > 0 && (
                                                    <div>
                                                        <p className="text-xs font-medium text-muted-foreground mb-1">
                                                            Entities ({ver.entities.length})
                                                        </p>
                                                        <div className="space-y-1.5">
                                                            {ver.entities.map((e, i) => (
                                                                <div
                                                                    key={i}
                                                                    className="text-xs bg-muted/50 rounded p-2"
                                                                >
                                                                    <span className="font-medium">{e.name}</span>
                                                                    <p className="text-muted-foreground mt-0.5 line-clamp-2">
                                                                        {e.prompt}
                                                                    </p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {ver.summary_prompt && (
                                                    <div>
                                                        <p className="text-xs font-medium text-muted-foreground mb-1">
                                                            Summary Prompt
                                                        </p>
                                                        <p className="text-xs bg-muted/50 rounded p-2 text-muted-foreground">
                                                            {ver.summary_prompt}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
