/**
 * TemplatePicker – unified picker for both built-in and user-created templates.
 *
 * Usage:
 *   <TemplatePicker
 *     value={selectedId}
 *     onSelect={(id, resolved) => { ... }}
 *     triggerClassName="w-[250px]"
 *   />
 *
 * `resolved` contains { entities, summaryPrompt } ready to use directly.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
    Search,
    FileText,
    Users,
    Globe,
    User,
    Check,
    ChevronRight,
    Loader2,
} from "lucide-react";
import { getAvailableStudyTypes, loadStudyTypeTemplate } from "./TemplateLoader";
import { useTemplates, Template } from "../hooks/useTemplates";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolvedTemplate {
    entities: { name: string; prompt: string }[];
    summaryPrompt: string;
}

interface TemplatePickerProps {
    /** Currently selected template id (built-in study-type id OR user-template UUID) */
    value?: string;
    /** Called when user confirms a selection */
    onSelect: (id: string, resolved: ResolvedTemplate) => void;
    className?: string;
    triggerClassName?: string;
    /** Label shown on trigger button when nothing is selected */
    placeholder?: string;
    disabled?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SCOPE_COLOR: Record<string, string> = {
    user: "text-blue-600 border-blue-200 bg-blue-50",
    group: "text-purple-600 border-purple-200 bg-purple-50",
    global: "text-green-600 border-green-200 bg-green-50",
};

function resolveBuiltIn(id: string): ResolvedTemplate {
    const t = loadStudyTypeTemplate(id);
    return { entities: t.entities, summaryPrompt: t.summaryPrompt };
}

function resolveUserTemplate(t: Template): ResolvedTemplate {
    return {
        entities: (t.entities || []).map((e) => ({ name: e.name, prompt: e.prompt })),
        summaryPrompt: t.summary_prompt || "",
    };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TemplatePicker({
    value,
    onSelect,
    triggerClassName,
    placeholder = "Select Template",
    disabled = false,
}: TemplatePickerProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    // Built-in templates (static)
    const builtInTypes = useMemo(() => getAvailableStudyTypes(), []);

    // User-created templates from API
    const { templates: apiTemplates, loading: apiLoading } = useTemplates();

    // Derive a display label for the trigger
    const displayLabel = useMemo(() => {
        if (!value) return placeholder;
        // Check built-in first
        const builtin = builtInTypes.find((t) => t.id === value);
        if (builtin) return builtin.name;
        // Check API templates
        const api = apiTemplates.find((t) => t.id === value);
        if (api) return api.name;
        return value;
    }, [value, builtInTypes, apiTemplates, placeholder]);

    // Filtered built-in list
    const filteredBuiltIn = useMemo(() => {
        if (!search) return builtInTypes;
        const q = search.toLowerCase();
        return builtInTypes.filter((t) => t.name.toLowerCase().includes(q));
    }, [builtInTypes, search]);

    // Filtered API templates
    const filteredApiTemplates = useMemo(() => {
        if (!search) return apiTemplates;
        const q = search.toLowerCase();
        return apiTemplates.filter(
            (t) =>
                t.name.toLowerCase().includes(q) ||
                t.description?.toLowerCase().includes(q) ||
                t.study_type?.toLowerCase().includes(q) ||
                (t as any).group_name?.toLowerCase().includes(q)
        );
    }, [apiTemplates, search]);

    // Group user templates by scope
    const apiByScope = useMemo(() => {
        const personal = filteredApiTemplates.filter((t) => t.scope === "user");
        const group = filteredApiTemplates.filter((t) => t.scope === "group");
        const global = filteredApiTemplates.filter((t) => t.scope === "global");
        return { personal, group, global };
    }, [filteredApiTemplates]);

    const handleSelectBuiltIn = useCallback(
        (id: string) => {
            onSelect(id, resolveBuiltIn(id));
            setOpen(false);
        },
        [onSelect]
    );

    const handleSelectApiTemplate = useCallback(
        (t: Template) => {
            onSelect(t.id, resolveUserTemplate(t));
            setOpen(false);
        },
        [onSelect]
    );

    // Reset search when dialog closes
    useEffect(() => {
        if (!open) setSearch("");
    }, [open]);

    const hasAnyApiTemplates =
        apiByScope.personal.length > 0 ||
        apiByScope.group.length > 0 ||
        apiByScope.global.length > 0;

    const hasAnyBuiltIn = filteredBuiltIn.length > 0;
    const hasNoResults = !hasAnyBuiltIn && !hasAnyApiTemplates;

    return (
        <>
            {/* Trigger */}
            <Button
                variant="outline"
                className={`justify-between font-normal ${triggerClassName ?? ""}`}
                onClick={() => !disabled && setOpen(true)}
                disabled={disabled}
                type="button"
            >
                <span className="truncate text-left">{displayLabel}</span>
                <ChevronRight className="h-4 w-4 ml-2 shrink-0 opacity-50" />
            </Button>

            {/* Picker dialog */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col gap-0 p-0">
                    <DialogHeader className="px-4 pt-4 pb-3 border-b">
                        <DialogTitle>Choose a Template</DialogTitle>
                        <DialogDescription>
                            Select a built-in study type or one of your custom templates.
                        </DialogDescription>
                        <div className="relative mt-2">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                autoFocus
                                placeholder="Search templates…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </DialogHeader>

                    <div className="overflow-y-auto flex-1 p-4 space-y-5">
                        {/* Loading */}
                        {apiLoading && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading your templates…
                            </div>
                        )}

                        {/* No results */}
                        {hasNoResults && !apiLoading && (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                No templates match &ldquo;{search}&rdquo;
                            </p>
                        )}

                        {/* ── Built-in / Study Types ── */}
                        {hasAnyBuiltIn && (
                            <section>
                                <div className="flex items-center gap-2 mb-2">
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                        Built-in Study Types
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 gap-1">
                                    {filteredBuiltIn.map((type) => (
                                        <TemplateRow
                                            key={type.id}
                                            label={type.name}
                                            isSelected={value === type.id}
                                            onClick={() => handleSelectBuiltIn(type.id)}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* ── Personal Templates ── */}
                        {apiByScope.personal.length > 0 && (
                            <TemplateSection
                                icon={<User className="h-4 w-4 text-blue-500" />}
                                label="My Templates"
                                templates={apiByScope.personal}
                                selectedId={value}
                                onSelect={handleSelectApiTemplate}
                                scopeColor={SCOPE_COLOR.user}
                            />
                        )}

                        {/* ── Group Templates ── */}
                        {apiByScope.group.length > 0 && (
                            <TemplateSection
                                icon={<Users className="h-4 w-4 text-purple-500" />}
                                label="Group Templates"
                                templates={apiByScope.group}
                                selectedId={value}
                                onSelect={handleSelectApiTemplate}
                                scopeColor={SCOPE_COLOR.group}
                                showGroup
                            />
                        )}

                        {/* ── Global Templates ── */}
                        {apiByScope.global.length > 0 && (
                            <TemplateSection
                                icon={<Globe className="h-4 w-4 text-green-500" />}
                                label="Global Templates"
                                templates={apiByScope.global}
                                selectedId={value}
                                onSelect={handleSelectApiTemplate}
                                scopeColor={SCOPE_COLOR.global}
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface TemplateSectionProps {
    icon: React.ReactNode;
    label: string;
    templates: Template[];
    selectedId?: string;
    onSelect: (t: Template) => void;
    scopeColor: string;
    showGroup?: boolean;
}

function TemplateSection({
    icon,
    label,
    templates,
    selectedId,
    onSelect,
    showGroup,
}: TemplateSectionProps) {
    return (
        <section>
            <div className="flex items-center gap-2 mb-2">
                {icon}
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {label}
                </span>
            </div>
            <div className="grid grid-cols-1 gap-1">
                {templates.map((t) => (
                    <TemplateRow
                        key={t.id}
                        label={t.name}
                        description={t.description ?? undefined}
                        meta={showGroup && t.group_name ? t.group_name : t.study_type ?? undefined}
                        isSelected={selectedId === t.id}
                        isImmutable={t.is_immutable}
                        onClick={() => onSelect(t)}
                    />
                ))}
            </div>
        </section>
    );
}

interface TemplateRowProps {
    label: string;
    description?: string;
    meta?: string;
    isSelected?: boolean;
    isImmutable?: boolean;
    onClick: () => void;
}

function TemplateRow({ label, description, meta, isSelected, isImmutable, onClick }: TemplateRowProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border transition-colors ${isSelected
                ? "border-primary bg-primary/5 text-primary"
                : "border-transparent hover:border-border hover:bg-accent/50"
                }`}
        >
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{label}</span>
                    {isImmutable && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                            locked
                        </Badge>
                    )}
                </div>
                {description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{description}</p>
                )}
                {meta && (
                    <span className="text-xs text-muted-foreground">{meta}</span>
                )}
            </div>
            {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
        </button>
    );
}
