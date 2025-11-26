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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";

import { Badge } from "./ui/badge";
import {
  ArrowLeft,
  Play,
  Settings,
  FileText,
  Bot,
  Plus,
  Trash2,
  Save,
  RotateCcw,
} from "lucide-react";
import { DocumentData } from "../App";
import {
  loadStudyTypeTemplate,
  getAvailableStudyTypes,
} from "./TemplateLoader";
import { settingsManager, ModelConfig } from "./SettingsManager";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";

interface BatchStudySelectionPageProps {
  onBack: () => void;
  onComplete: (data: Partial<DocumentData>) => void;
  documentData: DocumentData;
}

interface EntityConfig {
  name: string;
  prompt: string;
}

interface FileConfig {
  studyType: string;
  entities: EntityConfig[];
  summaryPrompt: string;
}

export function BatchStudySelectionPage({
  onBack,
  onComplete,
  documentData,
}: BatchStudySelectionPageProps) {
  const [files] = useState(documentData.uploadedFiles || []);
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [globalModel, setGlobalModel] = useState<string>("");

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

  const studyTypes = getAvailableStudyTypes();

  useEffect(() => {
    const loadModels = async () => {
      await settingsManager.refreshServerConfig();
      const models = await settingsManager.getAvailableModelsAsync();
      setAvailableModels(models);

      // Set default model to GPT-5 Mini if available, then GPT-4o, otherwise first available
      const gpt5mini = models.find(
        (m) =>
          m.id.includes("gpt-5-mini") ||
          m.name.toLowerCase().includes("gpt-5 mini")
      );
      const gpt4o = models.find((m) => m.id.includes("gpt-4o"));

      if (gpt5mini) {
        setGlobalModel(gpt5mini.id);
      } else if (gpt4o) {
        setGlobalModel(gpt4o.id);
      } else if (models.length > 0) {
        setGlobalModel(models[0].id);
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

  const handleStudyTypeChange = (fileId: string, studyType: string) => {
    // Save current config before switching
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

    // Check if we have a saved config for the new study type
    const savedConfig = savedConfigs[fileId]?.[studyType];

    if (savedConfig) {
      // Restore saved config
      setFileConfigs((prev) => ({
        ...prev,
        [fileId]: savedConfig,
      }));
    } else {
      // Load from template
      const template = loadStudyTypeTemplate(studyType);
      setFileConfigs((prev) => ({
        ...prev,
        [fileId]: {
          studyType,
          entities: template.entities,
          summaryPrompt: template.summaryPrompt,
        },
      }));
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
      setFileConfigs((prev) => {
        const next = {
          ...prev,
          [editingFileId]: tempConfig,
        };
        console.log("New fileConfigs:", next);
        return next;
      });
      setEditingFileId(null);
      setTempConfig(null);
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

  const handleBatchRun = () => {
    // Validate that all files have a study type selected
    const missingConfigs = files.filter((f) => !fileConfigs[f.fileId]);
    if (missingConfigs.length > 0) {
      alert("Please select a study type for all files.");
      return;
    }

    // Update documentData with selected study types and model
    const updatedFiles = files.map((f) => {
      const config = fileConfigs[f.fileId];

      return {
        ...f,
        studyType: config.studyType,
        selectedModel: globalModel,
        entities: config.entities,
        summaryPrompt: config.summaryPrompt,
        // Reset extraction results if study type changed (though here we assume fresh start or overwrite)
        finalSummary: undefined,
      };
    });

    onComplete({
      uploadedFiles: updatedFiles,
    });
  };

  return (
    <div className="container mx-auto max-w-5xl">
      <div className="flex items-center gap-4 mb-6">
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

      <div className="grid gap-6">
        {/* Global Model Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Global Model Selection
            </CardTitle>
            <CardDescription>
              Select the AI model to use for all documents (Default: GPT-4o)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={globalModel}
              onValueChange={setGlobalModel}
              disabled={availableModels.length === 0}
            >
              <SelectTrigger className="w-full md:w-[400px]">
                <SelectValue placeholder="Select AI Model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.name}</span>
                      <Badge variant="outline" className="text-xs font-normal">
                        {model.provider}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                      {(file.file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-1 md:justify-end">
                  <Select
                    value={fileConfigs[file.fileId]?.studyType || ""}
                    onValueChange={(val) =>
                      handleStudyTypeChange(file.fileId, val)
                    }
                  >
                    <SelectTrigger className="w-full md:w-[250px]">
                      <SelectValue placeholder="Select Study Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {studyTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

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

        <div className="flex justify-end pt-4">
          <Button
            size="lg"
            onClick={handleBatchRun}
            className="w-full md:w-auto gap-2"
            disabled={files.length === 0}
          >
            <Play className="h-4 w-4" />
            Batch Run ({files.length} documents)
          </Button>
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
                          className="text-sm min-h-[60px] focus-visible:ring-blue-500"
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
                  className="min-h-[120px] focus-visible:ring-blue-500"
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
    </div>
  );
}
