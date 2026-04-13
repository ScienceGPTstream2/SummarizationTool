import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { Checkbox } from "./ui/checkbox";

import { Badge } from "./ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  Play,
  Settings,
  FileText,
  Bot,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  CheckSquare,
  Square,
  AlertTriangle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";
import { DocumentData } from "../App";
import { loadStudyTypeTemplate } from "./TemplateLoader";
import { TemplatePicker, ResolvedTemplate } from "./TemplatePicker";
import { settingsManager, ModelConfig } from "./SettingsManager";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";

interface BatchStudySelectionPageProps {
  onBack: () => void;
  onComplete: (data: Partial<DocumentData>) => void;
  onNavigateForward?: () => void;
  documentData: DocumentData;
  hasExtractionResults?: boolean;
  onInvalidateDownstream?: () => void;
}

interface EntityConfig {
  name: string;
  prompt: string;
}

interface FileConfig {
  studyType: string;
  entities: EntityConfig[];
  summaryPrompt: string;
  paragraphSystemPrompt?: string;
}

export function BatchStudySelectionPage({
  onBack,
  onComplete,
  onNavigateForward,
  documentData,
  hasExtractionResults,
  onInvalidateDownstream,
}: BatchStudySelectionPageProps) {
  const [showRerunWarning, setShowRerunWarning] = useState(false);
  const [files] = useState(documentData.uploadedFiles || []);
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>(
    documentData.selectedModels || []
  );

  // Store configuration per file
  const [fileConfigs, setFileConfigs] = useState<Record<string, FileConfig>>(
    {}
  );
  // Store history of configs per file and study type to restore when switching back
  const [savedConfigs, setSavedConfigs] = useState<
    Record<string, Record<string, FileConfig>>
  >({});

  // Dialog state
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [tempConfig, setTempConfig] = useState<FileConfig | null>(null);

  // studyTypes constant removed — TemplatePicker handles both built-in and user templates

  useEffect(() => {
    // Load models asynchronously in background without blocking UI
    const loadModels = async () => {
      const models = await settingsManager.getAvailableModelsAsync();
      setAvailableModels(models);

      // Auto-select Gemini 2.5 Flash Lite by default only if nothing selected yet
      // (including from restored session data)
      if (selectedModels.length === 0 && !documentData.selectedModels?.length) {
        const gemini25FlashLite = models.find(
          (m) =>
            m.id.toLowerCase().includes("gemini") &&
            m.id.toLowerCase().includes("2.5") &&
            (m.id.toLowerCase().includes("flash") ||
              m.id.toLowerCase().includes("lite"))
        );

        const defaultModels: string[] = [];
        if (gemini25FlashLite) {
          defaultModels.push(gemini25FlashLite.id);
        } else {
          // Fallback: select first Gemini model or first model overall
          const anyGemini = models.find((m) =>
            m.id.toLowerCase().includes("gemini")
          );
          if (anyGemini) {
            defaultModels.push(anyGemini.id);
          } else if (models.length > 0) {
            defaultModels.push(models[0].id);
          }
        }

        setSelectedModels(defaultModels);
      }
    };
    loadModels();
  }, []);

  // Initialize configs from existing data if available
  useEffect(() => {
    setFileConfigs((prev) => {
      const newConfigs = { ...prev };
      let hasChanges = false;

      files.forEach((f) => {
        // Only initialize if not already present in state
        if (!newConfigs[f.fileId]) {
          hasChanges = true;
          if (f.studyType) {
            // If already has config in file object, use it
            if (f.entities && f.summaryPrompt) {
              newConfigs[f.fileId] = {
                studyType: f.studyType,
                entities: f.entities.map((e) => ({
                  name: e.name,
                  prompt: e.prompt,
                })),
                summaryPrompt: f.summaryPrompt,
              };
            } else {
              // Otherwise load from template
              const template = loadStudyTypeTemplate(f.studyType);
              newConfigs[f.fileId] = {
                studyType: f.studyType,
                entities: template.entities,
                summaryPrompt: template.summaryPrompt,
              };
            }
          }
        }
      });

      return hasChanges ? newConfigs : prev;
    });
  }, [files]);

  // Auto-save when selectedModels changes - save models even if no study types selected yet
  useEffect(() => {
    if (documentData.sessionId && selectedModels.length > 0) {
      // Save selected models to session, even if no file configs yet
      syncSessionConfigs(documentData.sessionId, fileConfigs);
    }
  }, [selectedModels]);

  const handleStudyTypeChange = (
    fileId: string,
    studyType: string,
    resolved?: ResolvedTemplate
  ) => {
    const currentConfig = fileConfigs[fileId];
    if (currentConfig) {
      setSavedConfigs((prev) => ({
        ...prev,
        [fileId]: {
          ...(prev[fileId] || {}),
          [currentConfig.studyType]: currentConfig,
        },
      }));
    }

    const savedConfig = savedConfigs[fileId]?.[studyType];

    if (savedConfig) {
      const newConfigs = {
        ...fileConfigs,
        [fileId]: savedConfig,
      };
      setFileConfigs(newConfigs);
      if (documentData.sessionId) {
        syncSessionConfigs(documentData.sessionId, newConfigs);
      }
    } else {
      const template = resolved ?? loadStudyTypeTemplate(studyType);
      const newConfigs = {
        ...fileConfigs,
        [fileId]: {
          studyType,
          entities: template.entities,
          summaryPrompt: template.summaryPrompt,
        },
      };
      setFileConfigs(newConfigs);
      if (documentData.sessionId) {
        syncSessionConfigs(documentData.sessionId, newConfigs);
      }
    }

    if (hasExtractionResults) {
      onInvalidateDownstream?.();
    }
  };

  const handleEditConfig = (fileId: string) => {
    if (fileConfigs[fileId]) {
      console.log("Editing config for:", fileId, fileConfigs[fileId]);
      setTempConfig(JSON.parse(JSON.stringify(fileConfigs[fileId]))); // Deep copy
      setEditingFileId(fileId);
    } else {
      console.warn("No config found for:", fileId);
    }
  };

  const handleSaveConfig = () => {
    if (editingFileId && tempConfig) {
      console.log("Saving config for:", editingFileId, tempConfig);
      const newConfigs = {
        ...fileConfigs,
        [editingFileId]: tempConfig,
      };
      setFileConfigs(newConfigs);
      setEditingFileId(null);
      setTempConfig(null);

      // Auto-save to database
      if (documentData.sessionId) {
        syncSessionConfigs(documentData.sessionId, newConfigs);
      }
    }
  };

  const syncSessionConfigs = async (
    sessionId: string,
    configs: Record<string, FileConfig>
  ) => {
    try {
      const token = await import("../utils/authUtils").then((m) =>
        m.getValidToken()
      );
      const user = await import("../utils/authUtils").then((m) =>
        m.getCurrentUser()
      );
      if (!token || !user) return;

      // Map to backend schema
      const files_config: Record<string, any> = {};
      Object.entries(configs).forEach(([fileId, config]) => {
        files_config[fileId] = {
          study_type: config.studyType,
          entities: config.entities.map((e) => ({
            name: e.name,
            prompt: e.prompt,
          })),
          summary_prompt: config.summaryPrompt,
          paragraph_system_prompt: config.paragraphSystemPrompt,
        };
      });

      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: user.id,
          configuration: {
            selected_models: selectedModels,
          },
          files_config: files_config, // Top-level, not nested in configuration
        }),
      });
      if (!response.ok) {
        console.error("Failed to save session config:", await response.text());
      } else {
        console.log("✅ Session configurations auto-saved");
      }
    } catch (error) {
      console.error("Failed to auto-save session configurations:", error);
    }
  };

  const handleAddEntity = () => {
    if (tempConfig) {
      setTempConfig({
        ...tempConfig,
        entities: [
          ...tempConfig.entities,
          { name: "New Entity", prompt: "Extract..." },
        ],
      });
    }
  };

  const handleRemoveEntity = (index: number) => {
    if (tempConfig) {
      const newEntities = [...tempConfig.entities];
      newEntities.splice(index, 1);
      setTempConfig({
        ...tempConfig,
        entities: newEntities,
      });
    }
  };

  const handleEntityChange = (
    index: number,
    field: "name" | "prompt",
    value: string
  ) => {
    if (tempConfig) {
      const newEntities = [...tempConfig.entities];
      newEntities[index] = { ...newEntities[index], [field]: value };
      setTempConfig({
        ...tempConfig,
        entities: newEntities,
      });
    }
  };

  const handleResetConfig = () => {
    if (tempConfig) {
      const template = loadStudyTypeTemplate(tempConfig.studyType);
      setTempConfig({
        ...tempConfig,
        entities: template.entities,
        summaryPrompt: template.summaryPrompt,
      });
    }
  };

  // Helper functions for multi-model selection
  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId]
    );
    if (hasExtractionResults) {
      onInvalidateDownstream?.();
    }
  };

  const toggleCategory = (modelIds: string[], selectAll: boolean) => {
    setSelectedModels((prev) => {
      if (selectAll) {
        const newModels = modelIds.filter((id) => !prev.includes(id));
        return [...prev, ...newModels];
      } else {
        return prev.filter((id) => !modelIds.includes(id));
      }
    });
    if (hasExtractionResults) {
      onInvalidateDownstream?.();
    }
  };

  const getCategorySelection = (modelIds: string[]) => {
    const selected = modelIds.filter((id) =>
      selectedModels.includes(id)
    ).length;
    return {
      selected,
      total: modelIds.length,
      allSelected: selected === modelIds.length,
      someSelected: selected > 0 && selected < modelIds.length,
    };
  };

  const executeBatchRun = () => {
    const updatedFiles = files.map((f) => {
      const config = fileConfigs[f.fileId];
      return {
        ...f,
        studyType: config.studyType,
        selectedModels: selectedModels,
        entities: config.entities,
        summaryPrompt: config.summaryPrompt,
        finalSummary: undefined,
      };
    });

    onComplete({
      uploadedFiles: updatedFiles,
      selectedModels: selectedModels,
    });
  };

  const handleBatchRun = () => {
    const missingConfigs = files.filter((f) => !fileConfigs[f.fileId]);
    if (missingConfigs.length > 0) {
      alert("Please select a study type for all files.");
      return;
    }

    if (selectedModels.length === 0) {
      alert("Please select at least one AI model.");
      return;
    }

    if (hasExtractionResults) {
      setShowRerunWarning(true);
      return;
    }

    executeBatchRun();
  };

  return (
    <div className="container mx-auto max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-2xl font-semibold">Batch Study Selection</h2>
            <p className="text-muted-foreground">
              Configure study types for your documents before extraction
            </p>
          </div>
        </div>
        {onNavigateForward && (
          <Button
            variant="outline"
            size="sm"
            onClick={onNavigateForward}
            className="border-green-600 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
          >
            Continue to Extraction
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>

      <div className="grid gap-6">
        {/* Multi-Model Selection */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  AI Models Selection
                </CardTitle>
                <CardDescription>
                  Select one or more AI models to use for entity extraction
                  across all documents
                </CardDescription>
              </div>
              <Badge variant="secondary" className="text-sm">
                {selectedModels.length} selected
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" defaultValue={[]} className="w-full">
              {/* Azure OpenAI Models */}
              {(() => {
                const azureModels = availableModels.filter((m) =>
                  m.provider?.toLowerCase().includes("azure")
                );
                if (azureModels.length === 0) return null;

                const azureIds = azureModels.map((m) => m.id);
                const selection = getCategorySelection(azureIds);

                return (
                  <AccordionItem value="azure">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Azure OpenAI</span>
                          <Badge variant="outline" className="text-xs">
                            {selection.selected}/{selection.total}
                          </Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b">
                          <span className="text-sm text-muted-foreground">
                            {azureModels.length} model
                            {azureModels.length !== 1 ? "s" : ""} available
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              toggleCategory(azureIds, !selection.allSelected)
                            }
                          >
                            {selection.allSelected ? (
                              <>
                                <CheckSquare className="h-3 w-3 mr-1" />
                                Deselect All
                              </>
                            ) : (
                              <>
                                <Square className="h-3 w-3 mr-1" />
                                Select All
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {azureModels.map((model) => (
                            <div
                              key={model.id}
                              className="flex items-start space-x-2 p-2 rounded-md border hover:bg-accent/50 transition-colors"
                            >
                              <Checkbox
                                id={model.id}
                                checked={selectedModels.includes(model.id)}
                                onCheckedChange={() => toggleModel(model.id)}
                                className="mt-1"
                              />
                              <div className="flex-1 space-y-1 min-w-0">
                                <Label
                                  htmlFor={model.id}
                                  className="text-sm font-medium leading-none cursor-pointer"
                                >
                                  {model.name}
                                </Label>
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {model.description || model.provider}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })()}

              {/* Vertex AI Models */}
              {(() => {
                const vertexModels = availableModels.filter(
                  (m) =>
                    m.provider?.toLowerCase().includes("vertex") ||
                    m.provider?.toLowerCase().includes("google")
                );
                if (vertexModels.length === 0) return null;

                const vertexIds = vertexModels.map((m) => m.id);
                const selection = getCategorySelection(vertexIds);

                return (
                  <AccordionItem value="vertex">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">
                            Vertex AI (Google)
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {selection.selected}/{selection.total}
                          </Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b">
                          <span className="text-sm text-muted-foreground">
                            {vertexModels.length} model
                            {vertexModels.length !== 1 ? "s" : ""} available
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              toggleCategory(vertexIds, !selection.allSelected)
                            }
                          >
                            {selection.allSelected ? (
                              <>
                                <CheckSquare className="h-3 w-3 mr-1" />
                                Deselect All
                              </>
                            ) : (
                              <>
                                <Square className="h-3 w-3 mr-1" />
                                Select All
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {vertexModels.map((model) => (
                            <div
                              key={model.id}
                              className="flex items-start space-x-2 p-2 rounded-md border hover:bg-accent/50 transition-colors"
                            >
                              <Checkbox
                                id={model.id}
                                checked={selectedModels.includes(model.id)}
                                onCheckedChange={() => toggleModel(model.id)}
                                className="mt-1"
                              />
                              <div className="flex-1 space-y-1 min-w-0">
                                <Label
                                  htmlFor={model.id}
                                  className="text-sm font-medium leading-none cursor-pointer"
                                >
                                  {model.name}
                                </Label>
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {model.description || model.provider}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })()}

              {/* Anthropic Models */}
              {(() => {
                const anthropicModels = availableModels.filter(
                  (m) =>
                    m.provider?.toLowerCase().includes("anthropic") ||
                    m.provider?.toLowerCase().includes("claude")
                );
                if (anthropicModels.length === 0) return null;

                const anthropicIds = anthropicModels.map((m) => m.id);
                const selection = getCategorySelection(anthropicIds);

                return (
                  <AccordionItem value="anthropic">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Anthropic</span>
                          <Badge variant="outline" className="text-xs">
                            {selection.selected}/{selection.total}
                          </Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b">
                          <span className="text-sm text-muted-foreground">
                            {anthropicModels.length} model
                            {anthropicModels.length !== 1 ? "s" : ""} available
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              toggleCategory(
                                anthropicIds,
                                !selection.allSelected
                              )
                            }
                          >
                            {selection.allSelected ? (
                              <>
                                <CheckSquare className="h-3 w-3 mr-1" />
                                Deselect All
                              </>
                            ) : (
                              <>
                                <Square className="h-3 w-3 mr-1" />
                                Select All
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {anthropicModels.map((model) => (
                            <div
                              key={model.id}
                              className="flex items-start space-x-2 p-2 rounded-md border hover:bg-accent/50 transition-colors"
                            >
                              <Checkbox
                                id={model.id}
                                checked={selectedModels.includes(model.id)}
                                onCheckedChange={() => toggleModel(model.id)}
                                className="mt-1"
                              />
                              <div className="flex-1 space-y-1 min-w-0">
                                <Label
                                  htmlFor={model.id}
                                  className="text-sm font-medium leading-none cursor-pointer"
                                >
                                  {model.name}
                                </Label>
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {model.description || model.provider}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })()}

              {/* Meta Llama Models */}
              {(() => {
                const llamaModels = availableModels.filter(
                  (m) =>
                    m.provider?.toLowerCase().includes("meta") ||
                    m.provider?.toLowerCase().includes("llama")
                );
                if (llamaModels.length === 0) return null;

                const llamaIds = llamaModels.map((m) => m.id);
                const selection = getCategorySelection(llamaIds);

                return (
                  <AccordionItem value="llama">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Meta AI (Llama)</span>
                          <Badge variant="outline" className="text-xs">
                            {selection.selected}/{selection.total}
                          </Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b">
                          <span className="text-sm text-muted-foreground">
                            {llamaModels.length} model
                            {llamaModels.length !== 1 ? "s" : ""} available
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              toggleCategory(llamaIds, !selection.allSelected)
                            }
                          >
                            {selection.allSelected ? (
                              <>
                                <CheckSquare className="h-3 w-3 mr-1" />
                                Deselect All
                              </>
                            ) : (
                              <>
                                <Square className="h-3 w-3 mr-1" />
                                Select All
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {llamaModels.map((model) => (
                            <div
                              key={model.id}
                              className="flex items-start space-x-2 p-2 rounded-md border hover:bg-accent/50 transition-colors"
                            >
                              <Checkbox
                                id={model.id}
                                checked={selectedModels.includes(model.id)}
                                onCheckedChange={() => toggleModel(model.id)}
                                className="mt-1"
                              />
                              <div className="flex-1 space-y-1 min-w-0">
                                <Label
                                  htmlFor={model.id}
                                  className="text-sm font-medium leading-none cursor-pointer"
                                >
                                  {model.name}
                                </Label>
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {model.description || model.provider}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })()}

              {/* Macbook LLM Models */}
              {(() => {
                const macbookModels = availableModels.filter((m) =>
                  m.provider?.toLowerCase().includes("macbook")
                );
                if (macbookModels.length === 0) return null;

                const macbookIds = macbookModels.map((m) => m.id);
                const selection = getCategorySelection(macbookIds);

                return (
                  <AccordionItem value="macbook">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Macbook LLM</span>
                          <Badge variant="outline" className="text-xs">
                            {selection.selected}/{selection.total}
                          </Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b">
                          <span className="text-sm text-muted-foreground">
                            {macbookModels.length} model
                            {macbookModels.length !== 1 ? "s" : ""} available
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              toggleCategory(macbookIds, !selection.allSelected)
                            }
                          >
                            {selection.allSelected ? (
                              <>
                                <CheckSquare className="h-3 w-3 mr-1" />
                                Deselect All
                              </>
                            ) : (
                              <>
                                <Square className="h-3 w-3 mr-1" />
                                Select All
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {macbookModels.map((model) => (
                            <div
                              key={model.id}
                              className="flex items-start space-x-2 p-2 rounded-md border hover:bg-accent/50 transition-colors"
                            >
                              <Checkbox
                                id={model.id}
                                checked={selectedModels.includes(model.id)}
                                onCheckedChange={() => toggleModel(model.id)}
                                className="mt-1"
                              />
                              <div className="flex-1 space-y-1 min-w-0">
                                <Label
                                  htmlFor={model.id}
                                  className="text-sm font-medium leading-none cursor-pointer"
                                >
                                  {model.name}
                                </Label>
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {model.description || model.provider}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })()}
            </Accordion>
          </CardContent>
        </Card>

        {/* File List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Documents Configuration</CardTitle>
            <CardDescription>
              Select the study type for each document. You can customize the
              entities and prompts for each file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {files.map((file) => (
              <div
                key={file.fileId}
                className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-[200px]">
                  <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex flex-col">
                    <span
                      className="font-medium truncate max-w-[200px] md:max-w-[300px]"
                      title={file.file.name}
                    >
                      {file.file.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {/* Get file size from: uploadResult.file_size, file.file.size, or show PDF indicator */}
                      {(() => {
                        const size =
                          file.uploadResult?.file_size ?? file.file?.size ?? 0;
                        return size > 0
                          ? `${(size / 1024 / 1024).toFixed(2)} MB`
                          : "PDF Document";
                      })()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-1 md:justify-end">
                  <TemplatePicker
                    value={fileConfigs[file.fileId]?.studyType || ""}
                    onSelect={(id, resolved) =>
                      handleStudyTypeChange(file.fileId, id, resolved)
                    }
                    triggerClassName="w-full md:w-[280px]"
                    placeholder="Select Template"
                  />

                  {fileConfigs[file.fileId] && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditConfig(file.fileId)}
                      className="gap-2"
                    >
                      <Settings className="h-4 w-4" />
                      Edit Config
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between pt-4 gap-4">
          {onNavigateForward && (
            <p className="text-sm text-muted-foreground">
              Previous extraction results are available.{" "}
              <button
                onClick={onNavigateForward}
                className="text-green-600 hover:underline font-medium"
              >
                Skip to Extraction →
              </button>
            </p>
          )}
          <div className="flex-shrink-0 ml-auto">
            <Button
              size="lg"
              onClick={handleBatchRun}
              className="gap-2"
              disabled={files.length === 0}
            >
              <Play className="h-4 w-4" />
              {hasExtractionResults ? "Re-run Extraction" : "Batch Run"} (
              {files.length} documents)
            </Button>
          </div>
        </div>
      </div>

      {/* Edit Configuration Dialog */}
      <Dialog
        open={!!editingFileId}
        onOpenChange={(open) => !open && setEditingFileId(null)}
      >
        <DialogContent className="sm:max-w-6xl w-[90vw] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Configuration</DialogTitle>
            <DialogDescription>
              Customize extraction entities and prompts for this specific
              document.
            </DialogDescription>
          </DialogHeader>

          {tempConfig && (
            <div className="flex-1 overflow-y-auto pr-2 space-y-6 py-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-medium">
                    Entities to Extract
                  </Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddEntity}
                    className="gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    Add Entity
                  </Button>
                </div>

                <div className="space-y-3">
                  {tempConfig.entities.map((entity, idx) => (
                    <div
                      key={idx}
                      className="flex gap-3 items-start p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors"
                    >
                      <div className="flex-1 space-y-3">
                        <Input
                          value={entity.name}
                          onChange={(e) =>
                            handleEntityChange(idx, "name", e.target.value)
                          }
                          placeholder="Entity Name"
                          className="font-medium focus-visible:ring-blue-500"
                        />
                        <Textarea
                          value={entity.prompt}
                          onChange={(e) =>
                            handleEntityChange(idx, "prompt", e.target.value)
                          }
                          placeholder="Extraction instructions for this entity..."
                          className="text-sm min-h-[60px] focus-visible:ring-blue-500 resize-y"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveEntity(idx)}
                        className="text-muted-foreground hover:text-destructive mt-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <Label className="text-base font-medium">Summary Prompt</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Instructions for generating the final paragraph summary from
                  the extracted entities.
                </p>
                <Textarea
                  value={tempConfig.summaryPrompt}
                  onChange={(e) =>
                    setTempConfig({
                      ...tempConfig,
                      summaryPrompt: e.target.value,
                    })
                  }
                  className="min-h-[120px] focus-visible:ring-blue-500 resize-y"
                  placeholder="Enter instructions for the final summary..."
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="ghost"
              onClick={handleResetConfig}
              className="text-muted-foreground hover:text-foreground gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Reset to Default
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditingFileId(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveConfig} className="gap-2">
                <Save className="h-4 w-4" />
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rerun confirmation dialog */}
      <AlertDialog
        open={showRerunWarning}
        onOpenChange={(open) => !open && setShowRerunWarning(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Overwrite Existing Results?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Running extraction again will overwrite your existing extraction
              results and invalidate any evaluation results. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowRerunWarning(false);
                executeBatchRun();
              }}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Yes, Re-run Extraction
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
