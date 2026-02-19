/**
 * TemplateEditor - Full-page editor for creating or editing a template.
 *
 * Uses a two-column layout:
 *   Left sidebar: metadata (name, description, scope, tags)
 *   Main area: entities list + prompts with generous space
 *
 * This replaces the previous cramped dialog approach.
 */

import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Plus,
  Trash2,
  Save,
  RotateCcw,
  AlertCircle,
  ArrowLeft,
  GripVertical,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Template,
  CreateTemplateData,
  UpdateTemplateData,
  TemplateEntity,
} from "../../hooks/useTemplates";
import { Group } from "../../hooks/useGroups";

interface TemplateEditorProps {
  open: boolean;
  onClose: () => void;
  template?: Template | null;
  groups: Group[];
  onSave: (data: CreateTemplateData | UpdateTemplateData) => Promise<void>;
  isCreating?: boolean;
}

export function TemplateEditor({
  open,
  onClose,
  template,
  groups,
  onSave,
  isCreating = false,
}: TemplateEditorProps) {
  const isEdit = !!template && !isCreating;

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [studyType, setStudyType] = useState("");
  const [scope, setScope] = useState("user");
  const [ownerGroupId, setOwnerGroupId] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [summaryPrompt, setSummaryPrompt] = useState("");
  const [entities, setEntities] = useState<TemplateEntity[]>([
    { name: "", prompt: "" },
  ]);
  const [tags, setTags] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedEntities, setExpandedEntities] = useState<Set<number>>(
    new Set([0])
  );

  // Initialize form from template
  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || "");
      setStudyType(template.study_type || "");
      setScope(isCreating ? "user" : template.scope);
      setOwnerGroupId(template.owner_group_id || "");
      setSystemPrompt(template.system_prompt || "");
      setSummaryPrompt(template.summary_prompt || "");
      const templateEntities =
        template.entities?.length > 0
          ? template.entities.map((e) => ({
              name: e.name,
              prompt: e.prompt,
            }))
          : [{ name: "", prompt: "" }];
      setEntities(templateEntities);
      setTags(template.tags?.join(", ") || "");
      // Expand all entities on load
      setExpandedEntities(new Set(templateEntities.map((_, i) => i)));
    } else {
      resetForm();
    }
    setChangeSummary("");
    setError(null);
  }, [template, open]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setStudyType("");
    setScope("user");
    setOwnerGroupId("");
    setSystemPrompt("");
    setSummaryPrompt(
      "Take the extracted entities and put them into a single cohesive paragraph. Do not change any of the extracted entities."
    );
    setEntities([{ name: "", prompt: "" }]);
    setTags("");
    setChangeSummary("");
    setError(null);
    setExpandedEntities(new Set([0]));
  };

  const addEntity = () => {
    const newIndex = entities.length;
    setEntities([...entities, { name: "", prompt: "" }]);
    setExpandedEntities(new Set([...expandedEntities, newIndex]));
  };

  const removeEntity = (index: number) => {
    if (entities.length <= 1) return;
    setEntities(entities.filter((_, i) => i !== index));
    const newExpanded = new Set<number>();
    expandedEntities.forEach((i) => {
      if (i < index) newExpanded.add(i);
      else if (i > index) newExpanded.add(i - 1);
    });
    setExpandedEntities(newExpanded);
  };

  const updateEntity = (
    index: number,
    field: "name" | "prompt",
    value: string
  ) => {
    const updated = [...entities];
    updated[index] = { ...updated[index], [field]: value };
    setEntities(updated);
  };

  const toggleEntity = (index: number) => {
    const next = new Set(expandedEntities);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setExpandedEntities(next);
  };

  const expandAll = () => {
    setExpandedEntities(new Set(entities.map((_, i) => i)));
  };

  const collapseAll = () => {
    setExpandedEntities(new Set());
  };

  const handleSave = async () => {
    // Validate
    if (!name.trim()) {
      setError("Template name is required");
      return;
    }
    const validEntities = entities.filter(
      (e) => e.name.trim() && e.prompt.trim()
    );
    if (validEntities.length === 0) {
      setError("At least one entity with name and prompt is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const parsedTags = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (isEdit) {
        const data: UpdateTemplateData = {
          name: name.trim(),
          description: description.trim() || undefined,
          study_type: studyType.trim() || undefined,
          system_prompt: systemPrompt.trim() || undefined,
          entities: validEntities,
          summary_prompt: summaryPrompt.trim() || undefined,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
          change_summary: changeSummary.trim() || undefined,
        };
        await onSave(data);
      } else {
        const data: CreateTemplateData = {
          name: name.trim(),
          entities: validEntities,
          scope,
          owner_group_id: scope === "group" ? ownerGroupId : undefined,
          description: description.trim() || undefined,
          study_type: studyType.trim() || undefined,
          system_prompt: systemPrompt.trim() || undefined,
          summary_prompt: summaryPrompt.trim() || undefined,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        };
        await onSave(data);
      }
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border bg-background/95 backdrop-blur flex-shrink-0">
        <div className="container mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-border" />
            <h2 className="text-lg font-semibold">
              {isEdit ? `Edit Template` : "Create New Template"}
            </h2>
            {isEdit && template && (
              <Badge variant="outline" className="text-xs">
                v{template.version}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetForm}
                disabled={saving}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving} size="sm">
              <Save className="h-4 w-4 mr-2" />
              {saving
                ? "Saving..."
                : isEdit
                  ? "Save Changes"
                  : "Create Template"}
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Error banner */}
        {error && (
          <div className="container mx-auto max-w-7xl px-4 mt-3">
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 px-2 text-xs"
                onClick={() => setError(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {/* Main content: two-column layout */}
        <div className="container mx-auto max-w-7xl px-4 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
            {/* Left sidebar: metadata */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Template Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="template-name">
                      Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="template-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., RCT Extraction"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="template-study-type">Study Type</Label>
                    <Input
                      id="template-study-type"
                      value={studyType}
                      onChange={(e) => setStudyType(e.target.value)}
                      placeholder="e.g., rct, cohort"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="template-description">Description</Label>
                    <Textarea
                      id="template-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Brief description of what this template extracts..."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="template-tags">
                      Tags (comma-separated)
                    </Label>
                    <Input
                      id="template-tags"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="clinical, outcomes"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Scope card - only for creation */}
              {!isEdit && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                      Visibility
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Scope</Label>
                      <Select value={scope} onValueChange={setScope}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">Personal</SelectItem>
                          <SelectItem value="group">Group</SelectItem>
                          <SelectItem value="global">Global</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {scope === "group" && (
                      <div className="space-y-2">
                        <Label>Group</Label>
                        <Select
                          value={ownerGroupId}
                          onValueChange={setOwnerGroupId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select group..." />
                          </SelectTrigger>
                          <SelectContent>
                            {groups.map((g) => (
                              <SelectItem key={g.id} value={g.id}>
                                {g.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Change summary - only for editing */}
              {isEdit && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                      Version Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <Label htmlFor="template-change-summary">
                        Change Summary
                      </Label>
                      <Input
                        id="template-change-summary"
                        value={changeSummary}
                        onChange={(e) => setChangeSummary(e.target.value)}
                        placeholder="What changed..."
                      />
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right main area: entities + prompts */}
            <div className="space-y-4">
              {/* Entities section */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                      Entities <span className="text-destructive">*</span>
                      <span className="ml-2 text-xs font-normal normal-case">
                        ({entities.length}{" "}
                        {entities.length === 1 ? "entity" : "entities"})
                      </span>
                    </CardTitle>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={expandAll}
                      >
                        Expand All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={collapseAll}
                      >
                        Collapse All
                      </Button>
                      <div className="w-px h-4 bg-border mx-1" />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={addEntity}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Entity
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {entities.map((entity, index) => (
                    <div
                      key={index}
                      className="border rounded-lg bg-muted/20 transition-colors hover:bg-muted/40"
                    >
                      {/* Entity header - always visible */}
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
                        onClick={() => toggleEntity(index)}
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                        {expandedEntities.has(index) ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <Badge
                          variant="secondary"
                          className="text-xs h-5 w-5 p-0 flex items-center justify-center flex-shrink-0"
                        >
                          {index + 1}
                        </Badge>
                        <span className="font-medium text-sm flex-1 truncate">
                          {entity.name || "(unnamed entity)"}
                        </span>
                        {!expandedEntities.has(index) && entity.prompt && (
                          <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                            {entity.prompt.slice(0, 80)}
                            ...
                          </span>
                        )}
                        {entities.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive/60 hover:text-destructive flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeEntity(index);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      {/* Entity body - collapsible */}
                      {expandedEntities.has(index) && (
                        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/50">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">
                              Entity Name
                            </Label>
                            <Input
                              value={entity.name}
                              onChange={(e) =>
                                updateEntity(index, "name", e.target.value)
                              }
                              placeholder="e.g., Study Design"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">
                              Extraction Prompt
                            </Label>
                            <Textarea
                              value={entity.prompt}
                              onChange={(e) =>
                                updateEntity(index, "prompt", e.target.value)
                              }
                              placeholder="Describe what this entity should extract from the document..."
                              rows={4}
                              className="font-mono text-sm resize-y min-h-[100px]"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Add entity footer */}
                  <button
                    onClick={addEntity}
                    className="w-full border border-dashed rounded-lg py-3 text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted/30 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add another entity
                  </button>
                </CardContent>
              </Card>

              {/* Prompts section */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Prompts
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="template-system-prompt">
                      System Prompt{" "}
                      <span className="text-xs text-muted-foreground font-normal">
                        (optional)
                      </span>
                    </Label>
                    <Textarea
                      id="template-system-prompt"
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="Optional system-level instruction for the LLM..."
                      rows={4}
                      className="font-mono text-sm resize-y min-h-[80px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-summary-prompt">
                      Summary Prompt
                    </Label>
                    <Textarea
                      id="template-summary-prompt"
                      value={summaryPrompt}
                      onChange={(e) => setSummaryPrompt(e.target.value)}
                      placeholder="Prompt for generating the final summary paragraph..."
                      rows={4}
                      className="font-mono text-sm resize-y min-h-[80px]"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
