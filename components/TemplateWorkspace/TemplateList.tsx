/**
 * TemplateList - Displays templates in a filterable grid with scope tabs
 * and a folder/directory navigation system.
 *
 * Folder behaviour by scope:
 *   user   → user's own subfolders at root
 *   group  → each group appears as a top-level "folder"; within a group,
 *             user can create subfolders
 *   global → global subfolders at root
 *   all    → flat view, no folder navigation (search only)
 *   built-in → static built-in study types, no folders
 */

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import {
  Search,
  Plus,
  MoreVertical,
  Edit,
  GitFork,
  Trash2,
  Lock,
  Unlock,
  Clock,
  Users,
  Globe,
  User,
  FileText,
  Share2,
  ChevronRight,
  Home,
  FolderPlus,
  Folder,
  MoveRight,
} from "lucide-react";
import { Template } from "../../hooks/useTemplates";
import { Folder as FolderType, useFolders } from "../../hooks/useFolders";
import { getAvailableStudyTypes } from "../TemplateLoader";
import { FolderCard } from "./FolderCard";

// ─── Types ───────────────────────────────────────────────────────────────────

// Stack entry for breadcrumb navigation
interface BreadcrumbEntry {
  id: string | null; // null = root
  name: string;
  groupId?: string; // only set when inside a group (group scope)
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TemplateListProps {
  templates: Template[];
  loading: boolean;
  onSelect: (template: Template) => void;
  onEdit: (template: Template) => void;
  onDelete: (template: Template) => void;
  onFork: (template: Template) => void;
  onToggleImmutable: (template: Template) => void;
  onViewHistory: (template: Template) => void;
  onChangeScope?: (template: Template) => void;
  onCreate: (folderId?: string | null) => void;
  onUseBuiltIn: (studyTypeId: string) => void;
  onMoveTemplate?: (
    template: Template,
    folderId: string | null
  ) => Promise<void>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  // Groups (needed to render "group folders")
  groups?: Array<{ id: string; name: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const scopeIcon = (scope: string) => {
  switch (scope) {
    case "user":
      return <User className="h-3 w-3" />;
    case "group":
      return <Users className="h-3 w-3" />;
    case "global":
      return <Globe className="h-3 w-3" />;
    default:
      return <FileText className="h-3 w-3" />;
  }
};

const scopeColor = (scope: string) => {
  switch (scope) {
    case "user":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "group":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
    case "global":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    default:
      return "";
  }
};

function formatDate(dateString: string) {
  const d = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TemplateList({
  templates,
  loading,
  onSelect,
  onEdit,
  onDelete,
  onFork,
  onToggleImmutable,
  onViewHistory,
  onChangeScope,
  onCreate,
  onUseBuiltIn,
  onMoveTemplate,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  groups = [],
}: TemplateListProps) {
  const builtInTypes = getAvailableStudyTypes();

  // ── Folder navigation state ──────────────────────────────────────────────
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([
    { id: null, name: "Root" },
  ]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  // Current node: last entry in breadcrumb
  const currentEntry = breadcrumb[breadcrumb.length - 1];
  const currentFolderId = currentEntry.id;
  const inGroupRoot = activeTab === "group" && breadcrumb.length === 1;

  // ── Folders hook ─────────────────────────────────────────────────────────
  const {
    folders,
    clearFolders,
    fetchFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    loading: foldersLoading,
  } = useFolders();

  // ── New-folder dialog ────────────────────────────────────────────────────
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderBusy, setNewFolderBusy] = useState(false);

  // ── Move-template dialog ─────────────────────────────────────────────────
  const [moveTemplate, setMoveTemplate] = useState<Template | null>(null);
  const [moveTargetFolder, setMoveTargetFolder] = useState<string | null>(null);

  // ── Reset navigation when changing tabs ─────────────────────────────────
  useEffect(() => {
    setBreadcrumb([{ id: null, name: "Root" }]);
    setActiveGroupId(null);
    clearFolders(); // prevent stale folders from a different scope showing briefly
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load folders whenever the navigation context changes ─────────────────
  useEffect(() => {
    if (activeTab === "all" || activeTab === "built-in") return;
    if (activeTab === "group" && !activeGroupId) return; // showing group list, not folders

    fetchFolders(
      activeTab === "group" ? "group" : activeTab,
      currentFolderId,
      activeGroupId
    );
  }, [activeTab, currentFolderId, activeGroupId, fetchFolders]);

  // ── Navigate into a folder ───────────────────────────────────────────────
  const enterFolder = (folder: FolderType) => {
    clearFolders(); // clear immediately so old sibling-level folders don't persist
    setBreadcrumb((prev) => [
      ...prev,
      { id: folder.id, name: folder.name, groupId: activeGroupId ?? undefined },
    ]);
  };

  // ── Navigate into a group (group tab top-level) ───────────────────────────
  const enterGroup = (group: { id: string; name: string }) => {
    clearFolders();
    setActiveGroupId(group.id);
    setBreadcrumb([{ id: null, name: group.name, groupId: group.id }]);
  };

  // ── Breadcrumb click ─────────────────────────────────────────────────────
  const navigateTo = (index: number) => {
    clearFolders();
    const slice = breadcrumb.slice(0, index + 1);
    setBreadcrumb(slice);
    // Restore groupId context from the target entry
    const target = slice[slice.length - 1];
    setActiveGroupId(target.groupId ?? null);
  };

  // ── Back to group list ───────────────────────────────────────────────────
  const backToGroupList = () => {
    clearFolders();
    setBreadcrumb([{ id: null, name: "Root" }]);
    setActiveGroupId(null);
  };

  // ── Create folder ────────────────────────────────────────────────────────
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setNewFolderBusy(true);
    await createFolder(
      newFolderName.trim(),
      activeTab === "group" ? "group" : activeTab,
      currentFolderId,
      activeGroupId
    );
    setNewFolderBusy(false);
    setNewFolderName("");
    setNewFolderOpen(false);
    // Refresh
    fetchFolders(
      activeTab === "group" ? "group" : activeTab,
      currentFolderId,
      activeGroupId
    );
  };

  // ── Handle template move ─────────────────────────────────────────────────
  const handleMoveTemplate = async () => {
    if (!moveTemplate) return;
    if (onMoveTemplate) {
      await onMoveTemplate(moveTemplate, moveTargetFolder);
    }
    setMoveTemplate(null);
    setMoveTargetFolder(null);
  };

  // ── Filter templates to the current folder / search ──────────────────────
  const filteredTemplates = templates.filter((t) => {
    // Scope filter
    if (activeTab !== "all") {
      if (t.scope !== activeTab) return false;
      // Group scope: only show templates belonging to the active group
      if (
        activeTab === "group" &&
        activeGroupId &&
        t.owner_group_id !== activeGroupId
      )
        return false;
    }

    // Folder filter (only when not searching)
    if (!searchQuery && activeTab !== "all") {
      // null folder_id means root
      const templateFolder = t.folder_id ?? null;
      if (templateFolder !== currentFolderId) return false;
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.study_type?.toLowerCase().includes(q) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    return true;
  });

  // ── Show folder navigation? ───────────────────────────────────────────────
  // Only when on a scoped tab (not "all" / "built-in") and not actively searching
  const showFolderNav =
    activeTab !== "all" && activeTab !== "built-in" && !searchQuery;

  // ─── Build breadcrumb display ─────────────────────────────────────────────
  const breadcrumbDisplay = () => {
    if (activeTab === "group" && !activeGroupId) return null;
    return (
      <div className="flex items-center gap-1 text-sm text-muted-foreground mb-3 flex-wrap">
        {activeTab === "group" && (
          <>
            <button
              className="hover:text-foreground flex items-center gap-1"
              onClick={backToGroupList}
            >
              <Home className="h-3.5 w-3.5" />
              Groups
            </button>
            <ChevronRight className="h-3.5 w-3.5" />
          </>
        )}
        {activeTab !== "group" && (
          <>
            <button
              className="hover:text-foreground flex items-center gap-1"
              onClick={() => navigateTo(0)}
            >
              <Home className="h-3.5 w-3.5" />
              {activeTab === "user"
                ? "My Templates"
                : activeTab === "global"
                  ? "Global"
                  : "Root"}
            </button>
          </>
        )}
        {breadcrumb.map((entry, idx) => {
          if (idx === 0) return null;
          const isLast = idx === breadcrumb.length - 1;
          return (
            <span key={idx} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5" />
              {isLast ? (
                <span className="text-foreground font-medium">
                  {entry.name}
                </span>
              ) : (
                <button
                  className="hover:text-foreground"
                  onClick={() => navigateTo(idx)}
                >
                  {entry.name}
                </button>
              )}
            </span>
          );
        })}
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* New Folder button — only in scoped tabs */}
          {showFolderNav && !inGroupRoot && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewFolderOpen(true)}
            >
              <FolderPlus className="h-4 w-4 mr-2" />
              New Folder
            </Button>
          )}
          <Button
            onClick={() => onCreate(currentFolderId)}
            size="sm"
            disabled={activeTab === "group" && !activeGroupId}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="user">
            <User className="h-3 w-3 mr-1" />
            My Templates
          </TabsTrigger>
          <TabsTrigger value="group">
            <Users className="h-3 w-3 mr-1" />
            Group
          </TabsTrigger>
          <TabsTrigger value="global">
            <Globe className="h-3 w-3 mr-1" />
            Global
          </TabsTrigger>
          <TabsTrigger value="built-in">
            <FileText className="h-3 w-3 mr-1" />
            Built-in
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ── Built-in tab ── */}
      {activeTab === "built-in" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {builtInTypes.map((st) => (
            <Card
              key={st.id}
              className="cursor-pointer hover:shadow-md transition-shadow border-dashed"
              onClick={() => onUseBuiltIn(st.id)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  {st.name}
                </CardTitle>
                <CardDescription className="text-xs">
                  Built-in template • Click to create a copy
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="outline" className="text-xs">
                  {st.id}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : activeTab === "group" && !activeGroupId ? (
        /* ── Group tab: top-level — show each group as a folder ── */
        groups.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">
                You are not a member of any groups.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((group) => {
              const count = templates.filter(
                (t) => t.owner_group_id === group.id
              ).length;
              return (
                <Card
                  key={group.id}
                  className="cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all bg-gradient-to-br from-purple-50 to-white border-purple-100"
                  onClick={() => enterGroup(group)}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <Users className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {group.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {count} template{count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : loading || foldersLoading ? (
        /* ── Loading ── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-3 bg-muted rounded w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* ── Scoped tabs with folder navigation ── */
        <>
          {/* Breadcrumb */}
          {showFolderNav && breadcrumbDisplay()}

          {/* Folder cards */}
          {showFolderNav && folders.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {folders.map((folder) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  onClick={enterFolder}
                  onRename={async (f, name) => {
                    await renameFolder(f.id, name);
                  }}
                  onDelete={async (f) => {
                    const ok = await deleteFolder(f.id);
                    if (!ok)
                      alert(
                        "Could not delete folder. Make sure it is empty first."
                      );
                  }}
                />
              ))}
            </div>
          )}

          {/* Separator between folders and templates (only when both exist) */}
          {showFolderNav &&
            folders.length > 0 &&
            filteredTemplates.length > 0 && (
              <div className="border-t pt-2">
                <p className="text-xs text-muted-foreground mb-3">
                  Templates in this folder
                </p>
              </div>
            )}

          {/* Template grid or empty state */}
          {filteredTemplates.length === 0 && folders.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground mb-2">
                  {searchQuery
                    ? "No templates match your search"
                    : "No templates here yet"}
                </p>
                {!searchQuery && (
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {showFolderNav && !inGroupRoot && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setNewFolderOpen(true)}
                      >
                        <FolderPlus className="h-4 w-4 mr-2" />
                        New Folder
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onCreate(currentFolderId)}
                      disabled={activeTab === "group" && !activeGroupId}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      New Template
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : filteredTemplates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onSelect={onSelect}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onFork={onFork}
                  onToggleImmutable={onToggleImmutable}
                  onViewHistory={onViewHistory}
                  onChangeScope={onChangeScope}
                  onMove={(t) => setMoveTemplate(t)}
                  showMove={showFolderNav}
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      {/* ── New Folder Dialog ── */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>
              Create a subfolder to organise your templates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              id="folder-name"
              autoFocus
              placeholder="e.g. Clinical Studies"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
              disabled={newFolderBusy}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewFolderOpen(false)}
              disabled={newFolderBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || newFolderBusy}
            >
              {newFolderBusy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Move Template Dialog ── */}
      {moveTemplate && (
        <Dialog
          open={!!moveTemplate}
          onOpenChange={(v) => !v && setMoveTemplate(null)}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Move Template</DialogTitle>
              <DialogDescription>
                Choose a folder for <strong>{moveTemplate.name}</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2 max-h-60 overflow-y-auto">
              {/* Root option */}
              <button
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 hover:bg-muted transition-colors ${moveTargetFolder === null ? "bg-blue-50 text-blue-700" : ""}`}
                onClick={() => setMoveTargetFolder(null)}
              >
                <Home className="h-4 w-4" />
                Root (no folder)
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 hover:bg-muted transition-colors ${moveTargetFolder === f.id ? "bg-blue-50 text-blue-700" : ""}`}
                  onClick={() => setMoveTargetFolder(f.id)}
                >
                  <Folder className="h-4 w-4 text-amber-500" />
                  {f.name}
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMoveTemplate(null)}>
                Cancel
              </Button>
              <Button onClick={handleMoveTemplate}>
                <MoveRight className="h-4 w-4 mr-2" />
                Move
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── TemplateCard sub-component ───────────────────────────────────────────────

function TemplateCard({
  template,
  onSelect,
  onEdit,
  onDelete,
  onFork,
  onToggleImmutable,
  onViewHistory,
  onChangeScope,
  onMove,
  showMove,
}: {
  template: Template;
  onSelect: (t: Template) => void;
  onEdit: (t: Template) => void;
  onDelete: (t: Template) => void;
  onFork: (t: Template) => void;
  onToggleImmutable: (t: Template) => void;
  onViewHistory: (t: Template) => void;
  onChangeScope?: (t: Template) => void;
  onMove: (t: Template) => void;
  showMove: boolean;
}) {
  return (
    <Card
      className="group cursor-pointer hover:shadow-md transition-all hover:border-primary/30"
      onClick={() => onSelect(template)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base leading-tight pr-2">
            {template.name}
            {template.is_immutable && (
              <Lock className="inline h-3 w-3 ml-1.5 text-amber-500" />
            )}
          </CardTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {template.can_edit && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(template);
                  }}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onFork(template);
                }}
              >
                <GitFork className="h-4 w-4 mr-2" />
                Fork
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onViewHistory(template);
                }}
              >
                <Clock className="h-4 w-4 mr-2" />
                History
              </DropdownMenuItem>
              {showMove && template.can_edit && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove(template);
                  }}
                >
                  <MoveRight className="h-4 w-4 mr-2" />
                  Move to Folder
                </DropdownMenuItem>
              )}
              {template.is_owner && onChangeScope && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onChangeScope(template);
                  }}
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  Publish to…
                </DropdownMenuItem>
              )}
              {template.is_owner && (
                <>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleImmutable(template);
                    }}
                  >
                    {template.is_immutable ? (
                      <>
                        <Unlock className="h-4 w-4 mr-2" />
                        Unlock
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4 mr-2" />
                        Lock
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(template);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {template.description && (
          <CardDescription className="text-xs line-clamp-2">
            {template.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="pb-3">
        <div className="flex flex-wrap gap-1.5 mb-2">
          <Badge
            variant="secondary"
            className={`text-xs ${scopeColor(template.scope)}`}
          >
            {scopeIcon(template.scope)}
            <span className="ml-1">{template.scope}</span>
          </Badge>
          {template.scope === "group" && template.group_name && (
            <Badge variant="outline" className="text-xs">
              <Users className="h-3 w-3 mr-1" />
              {template.group_name}
            </Badge>
          )}
          {template.study_type && (
            <Badge variant="outline" className="text-xs">
              {template.study_type}
            </Badge>
          )}
          {template.tags?.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs bg-muted">
              {tag}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {template.entities?.length || 0} entities • v{template.version}
          </span>
          <span>{formatDate(template.updated_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
