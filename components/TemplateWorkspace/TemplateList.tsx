/**
 * TemplateList - Displays templates in a filterable grid with scope tabs.
 */


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
} from "lucide-react";
import { Template } from "../../hooks/useTemplates";
import { getAvailableStudyTypes } from "../TemplateLoader";

interface TemplateListProps {
    templates: Template[];
    loading: boolean;
    onSelect: (template: Template) => void;
    onEdit: (template: Template) => void;
    onDelete: (template: Template) => void;
    onFork: (template: Template) => void;
    onToggleImmutable: (template: Template) => void;
    onViewHistory: (template: Template) => void;
    onCreate: () => void;
    onUseBuiltIn: (studyTypeId: string) => void;
    activeTab: string;
    onTabChange: (tab: string) => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
}

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

export function TemplateList({
    templates,
    loading,
    onSelect,
    onEdit,
    onDelete,
    onFork,
    onToggleImmutable,
    onViewHistory,
    onCreate,
    onUseBuiltIn,
    activeTab,
    onTabChange,
    searchQuery,
    onSearchChange,
}: TemplateListProps) {
    const builtInTypes = getAvailableStudyTypes();

    // Filter templates by search
    const filteredTemplates = templates.filter((t) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            t.name.toLowerCase().includes(q) ||
            t.description?.toLowerCase().includes(q) ||
            t.study_type?.toLowerCase().includes(q) ||
            t.tags?.some((tag) => tag.toLowerCase().includes(q))
        );
    });

    return (
        <div className="space-y-4">
            {/* Header */}
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
                <Button onClick={onCreate} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    New Template
                </Button>
            </div>

            {/* Tabs */}
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
                    <TabsTrigger
                        value="built-in"
                    >
                        <FileText className="h-3 w-3 mr-1" />
                        Built-in
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            {/* Built-in templates tab */}
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
            ) : loading ? (
                /* Loading state */
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
            ) : filteredTemplates.length === 0 ? (
                /* Empty state */
                <Card className="border-dashed">
                    <CardContent className="py-12 text-center">
                        <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground mb-2">
                            {searchQuery
                                ? "No templates match your search"
                                : "No templates yet"}
                        </p>
                        <Button variant="outline" size="sm" onClick={onCreate}>
                            <Plus className="h-4 w-4 mr-2" />
                            Create your first template
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                /* Template grid */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredTemplates.map((template) => (
                        <Card
                            key={template.id}
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
                                    {template.study_type && (
                                        <Badge variant="outline" className="text-xs">
                                            {template.study_type}
                                        </Badge>
                                    )}
                                    {template.tags?.map((tag) => (
                                        <Badge
                                            key={tag}
                                            variant="outline"
                                            className="text-xs bg-muted"
                                        >
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
                    ))}
                </div>
            )}
        </div>
    );
}
