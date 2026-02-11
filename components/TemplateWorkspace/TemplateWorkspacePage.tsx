/**
 * TemplateWorkspacePage - Full page component for the template workspace.
 * Orchestrates TemplateList, TemplateEditor, and TemplateVersionHistory.
 */

import { useState, useCallback } from "react";
import { Button } from "../ui/button";
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
import { ArrowLeft, FileText } from "lucide-react";
import {
    useTemplates,
    useTemplateVersions,
    Template,
    CreateTemplateData,
    UpdateTemplateData,
} from "../../hooks/useTemplates";
import { useGroups } from "../../hooks/useGroups";
import { loadStudyTypeTemplate } from "../TemplateLoader";
import { TemplateList } from "./TemplateList";
import { TemplateEditor } from "./TemplateEditor";
import { TemplateVersionHistory } from "./TemplateVersionHistory";

interface TemplateWorkspacePageProps {
    onBack: () => void;
}

export function TemplateWorkspacePage({ onBack }: TemplateWorkspacePageProps) {
    // Data hooks
    const {
        templates,
        loading,
        error,
        filters,
        setFilters,
        fetchTemplates,
        createTemplate,
        updateTemplate,
        deleteTemplate,
        forkTemplate,
        setImmutable,
    } = useTemplates();
    const { groups } = useGroups();

    // Tab and search state
    const [activeTab, setActiveTab] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");

    // Editor state
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
    const [isCreatingFromBuiltIn, setIsCreatingFromBuiltIn] = useState(false);

    // Version history state
    const [historyTemplate, setHistoryTemplate] = useState<Template | null>(null);
    const {
        versions,
        loading: versionsLoading,
        revertToVersion,
    } = useTemplateVersions(historyTemplate?.id || null);

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);

    // Filter templates by tab
    const filteredByTab =
        activeTab === "all"
            ? templates
            : templates.filter((t) => t.scope === activeTab);

    // Handle tab change - also update API filters for efficiency
    const handleTabChange = useCallback(
        (tab: string) => {
            setActiveTab(tab);
            if (tab === "all" || tab === "built-in") {
                setFilters({ ...filters, scope: undefined });
            } else {
                setFilters({ ...filters, scope: tab });
            }
            fetchTemplates(
                tab === "all" || tab === "built-in"
                    ? { ...filters, scope: undefined }
                    : { ...filters, scope: tab }
            );
        },
        [filters]
    );

    // Handlers
    const handleCreate = () => {
        setEditingTemplate(null);
        setIsCreatingFromBuiltIn(false);
        setEditorOpen(true);
    };

    const handleEdit = (template: Template) => {
        setEditingTemplate(template);
        setIsCreatingFromBuiltIn(false);
        setEditorOpen(true);
    };

    const handleSelect = (template: Template) => {
        // Clicking a card opens the editor in view/edit mode
        handleEdit(template);
    };

    const handleFork = async (template: Template) => {
        try {
            await forkTemplate(template.id);
        } catch (err: any) {
            console.error("Fork failed:", err);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await deleteTemplate(deleteTarget.id);
            setDeleteTarget(null);
        } catch (err: any) {
            console.error("Delete failed:", err);
        }
    };

    const handleToggleImmutable = async (template: Template) => {
        try {
            await setImmutable(template.id, !template.is_immutable);
        } catch (err: any) {
            console.error("Toggle immutable failed:", err);
        }
    };

    const handleViewHistory = (template: Template) => {
        setHistoryTemplate(template);
    };

    const handleRevert = async (version: number) => {
        await revertToVersion(version);
        await fetchTemplates();
    };

    const handleSave = async (data: CreateTemplateData | UpdateTemplateData) => {
        if (editingTemplate && !isCreatingFromBuiltIn) {
            await updateTemplate(editingTemplate.id, data as UpdateTemplateData);
        } else {
            await createTemplate(data as CreateTemplateData);
        }
    };

    const handleUseBuiltIn = (studyTypeId: string) => {
        // Load the built-in template and open editor pre-filled for creation
        const template = loadStudyTypeTemplate(studyTypeId);
        const prefilledTemplate: Template = {
            id: "",
            name: studyTypeId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            description: `Created from built-in "${studyTypeId}" template`,
            study_type: studyTypeId,
            scope: "user",
            owner_user_id: null,
            owner_group_id: null,
            system_prompt: null,
            entities: template.entities,
            summary_prompt: template.summaryPrompt,
            variables: [],
            tags: ["built-in"],
            is_immutable: false,
            version: 1,
            created_by: null,
            created_at: "",
            updated_at: "",
            can_edit: true,
            is_owner: true,
        };
        setEditingTemplate(prefilledTemplate);
        setIsCreatingFromBuiltIn(true);
        setEditorOpen(true);
    };

    return (
        <div className="container mx-auto max-w-6xl">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Button variant="outline" size="sm" onClick={onBack}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                </Button>
                <div>
                    <h2 className="text-2xl font-semibold flex items-center gap-2">
                        <FileText className="h-6 w-6" />
                        Template Workspace
                    </h2>
                    <p className="text-muted-foreground">
                        Create, manage, and share extraction templates
                    </p>
                </div>
            </div>

            {/* Error banner */}
            {error && (
                <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                    {error}
                </div>
            )}

            {/* Template List */}
            <TemplateList
                templates={filteredByTab}
                loading={loading}
                onSelect={handleSelect}
                onEdit={handleEdit}
                onDelete={setDeleteTarget}
                onFork={handleFork}
                onToggleImmutable={handleToggleImmutable}
                onViewHistory={handleViewHistory}
                onCreate={handleCreate}
                onUseBuiltIn={handleUseBuiltIn}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
            />

            {/* Template Editor Dialog */}
            {editorOpen && (
                <TemplateEditor
                    open={editorOpen}
                    onClose={() => {
                        setEditorOpen(false);
                        setEditingTemplate(null);
                        setIsCreatingFromBuiltIn(false);
                    }}
                    template={editingTemplate}
                    groups={groups}
                    onSave={handleSave}
                    isCreating={isCreatingFromBuiltIn || !editingTemplate}
                />
            )}

            {/* Version History Dialog */}
            {historyTemplate && (
                <TemplateVersionHistory
                    open={true}
                    onClose={() => setHistoryTemplate(null)}
                    templateName={historyTemplate.name}
                    currentVersion={historyTemplate.version}
                    versions={versions}
                    loading={versionsLoading}
                    onRevert={handleRevert}
                />
            )}

            {/* Delete Confirmation */}
            {deleteTarget && (
                <AlertDialog
                    open={true}
                    onOpenChange={(o) => !o && setDeleteTarget(null)}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Template</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete "{deleteTarget.name}"? This
                                action cannot be undone. All versions will be permanently removed.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleDelete}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                                Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
}
