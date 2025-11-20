import { useState, useEffect, useRef } from "react";
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
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { Alert, AlertDescription } from "./ui/alert";
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
import {
  ArrowLeft,
  Plus,
  X,
  Sparkles,
  Bot,
  Download,
  FileText,
  File,
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  PlayCircle,
  MapPin,
  Hash,
  Timer,
  StopCircle,
  RefreshCw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocumentData } from "../App";
import {
  generateWordDocument,
  generateMarkdownDocument,
  downloadFile,
} from "./ExportUtils";
import {
  loadStudyTypeTemplate,
  getAvailableStudyTypes,
} from "./TemplateLoader";
import { settingsManager } from "./SettingsManager";
import type { ModelConfig } from "./SettingsManager";
import { EntityPDFViewerBeta } from "./EntityPDFViewerBeta";

interface Reference {
  text: string;
  reference_index?: number;
  best_match?: {
    type: string;
    similarity: number;
    page_number?: number;
    bounding_regions?: Array<{
      page_number: number;
      polygon: number[];
    }>;
    polygon?: number[];
  };
  paragraph_matches?: any[];
  line_matches?: any[];
}

interface Entity {
  name: string;
  prompt: string;
  extracted?: string;
  answer?: string;
  references?: Reference[];
  duration?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface EntityExtractionPageProps {
  onBack: () => void;
  onComplete?: (data: Partial<DocumentData>) => void;
  documentData: DocumentData;
  setDocumentData: (data: DocumentData) => void;
}

export function EntityExtractionPage({
  onBack,
  onComplete,
  documentData,
  setDocumentData,
}: EntityExtractionPageProps) {
  const [selectedStudyType, setSelectedStudyType] = useState(
    documentData.studyType || ""
  );
  const [selectedModel, setSelectedModel] = useState(
    documentData.selectedModel || ""
  );
  const [entities, setEntities] = useState<Entity[]>(
    documentData.entities || []
  );
  const [summaryPrompt, setSummaryPrompt] = useState(
    documentData.summaryPrompt || ""
  );
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showResults, setShowResults] = useState(!!documentData.finalSummary);
  const [extractingEntities, setExtractingEntities] = useState<Set<string>>(
    new Set()
  );
  const [completedEntities, setCompletedEntities] = useState<Set<string>>(
    new Set()
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const [showRerunDialog, setShowRerunDialog] = useState(false);
  const [currentEntityIndex, setCurrentEntityIndex] = useState(0);
  const [isGeneratingParagraph, setIsGeneratingParagraph] = useState(false);
  const [focusedReferenceByEntity, setFocusedReferenceByEntity] = useState<
    Record<number, number | null>
  >({});
  useEffect(() => {
    setFocusedReferenceByEntity((prev) => {
      const updated = { ...prev };
      let changed = false;
      entities.forEach((entity, idx) => {
        const activeIdx = updated[idx];
        if (
          activeIdx !== null &&
          activeIdx !== undefined &&
          (!entity.references || activeIdx >= entity.references.length)
        ) {
          updated[idx] = null;
          changed = true;
        }
      });
      return changed ? updated : prev;
    });
  }, [entities]);

  // Get available study types from templates
  const studyTypes = getAvailableStudyTypes();

  // Get available models from backend API (includes all configured Azure and Gemini models)
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  useEffect(() => {
    const loadModels = async () => {
      // Refresh server config when component mounts to get latest configuration status
      await settingsManager.refreshServerConfig();
      // Get all available models from backend (includes all Azure models from secrets.toml)
      const models = await settingsManager.getAvailableModelsAsync();
      setAvailableModels(models);
    };
    loadModels();
  }, []);

  useEffect(() => {
    if (selectedStudyType && !documentData.entities.length) {
      // Load template entities for the selected study type
      const {
        entities: templateEntities,
        summaryPrompt: templateSummaryPrompt,
      } = loadStudyTypeTemplate(selectedStudyType);
      setEntities(templateEntities);
      setSummaryPrompt(templateSummaryPrompt);
    }
  }, [selectedStudyType, documentData.entities.length]);

  const handleStudyTypeChange = (value: string) => {
    setSelectedStudyType(value);
    // Load template entities for the new study type
    const { entities: templateEntities, summaryPrompt: templateSummaryPrompt } =
      loadStudyTypeTemplate(value);
    setEntities(templateEntities);
    setSummaryPrompt(templateSummaryPrompt);
    setShowResults(false);
    // Reset extraction progress state for new study type
    setExtractingEntities(new Set());
    setCompletedEntities(new Set());
    setCurrentEntityIndex(0);
  };

  const addEntity = () => {
    setEntities([...entities, { name: "", prompt: "" }]);
  };

  const removeEntity = (index: number) => {
    setEntities(entities.filter((_, i) => i !== index));
  };

  const handleReferenceFocus = (entityIdx: number, refIdx: number) => {
    setFocusedReferenceByEntity((prev) => ({
      ...prev,
      [entityIdx]: refIdx,
    }));
  };

  const updateEntity = (
    index: number,
    field: "name" | "prompt",
    value: string
  ) => {
    const updated = entities.map((entity, i) =>
      i === index ? { ...entity, [field]: value } : entity
    );
    setEntities(updated);
  };

  const handleStopExtraction = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsExtracting(false);
      setIsGeneratingParagraph(false);
      setExtractingEntities(new Set());
    }
  };

  const extractSingleEntity = async (
    entity: Entity,
    index: number,
    signal: AbortSignal,
    conversionId: string,
    modelConfig: {
      modelType: string;
      modelId?: string;
      deployment?: string;
      apiVersion?: string;
    },
    token: string
  ) => {
    try {
      // Mark entity as extracting
      setExtractingEntities((prev) => new Set(prev).add(entity.name));
      console.log(`\n🔄 Extracting: ${entity.name}...`);

      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversion_id: conversionId,
          model_type: modelConfig.modelType,
          model_id: modelConfig.modelId,
          deployment: modelConfig.deployment,
          api_version: modelConfig.apiVersion,
          entities: [entity], // Extract only this entity
          max_tokens: 4096,
          temperature: 0.0,
          processor_used: documentData.processorUsed,
        }),
        signal,
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        const detail =
          errBody.detail || errBody.error || "Extraction request failed";
        throw new Error(detail);
      }

      const data = await resp.json();
      const extractedEntities = data.extracted_entities || [];

      // Update this specific entity
      let updatedEntity = { ...entity };
      if (extractedEntities.length > 0) {
        const extracted = extractedEntities[0];
        const meta = extracted.meta || {};
        updatedEntity = {
          ...entity,
          extracted: extracted.extracted,
          answer: extracted.answer || extracted.extracted,
          references: extracted.references || [],
          duration: meta.duration,
          promptTokens: meta.prompt_tokens,
          completionTokens: meta.completion_tokens,
        };

        console.log(
          `✅ ${entity.name}: ${extracted.extracted.substring(0, 50)}...`
        );
      } else {
        updatedEntity = {
          ...entity,
          extracted: "Error: Not found in response",
        };
      }

      // Update UI immediately with this entity's result
      setEntities((prev) => {
        const newEntities = [...prev];
        newEntities[index] = updatedEntity;
        return newEntities;
      });

      // Mark entity as completed
      setExtractingEntities((prev) => {
        const newSet = new Set(prev);
        newSet.delete(entity.name);
        return newSet;
      });
      setCompletedEntities((prev) => new Set(prev).add(entity.name));

      return updatedEntity;
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log(`Extraction aborted for ${entity.name}`);
        throw err;
      }
      console.error(`Error extracting ${entity.name}:`, err);
      const errorEntity = {
        ...entity,
        extracted: `Error: ${err.message}`,
      };

      // Update UI with error
      setEntities((prev) => {
        const newEntities = [...prev];
        newEntities[index] = errorEntity;
        return newEntities;
      });

      // Mark as completed (with error)
      setExtractingEntities((prev) => {
        const newSet = new Set(prev);
        newSet.delete(entity.name);
        return newSet;
      });
      setCompletedEntities((prev) => new Set(prev).add(entity.name));
      return errorEntity;
    }
  };

  const handleRunSingleEntity = async (index: number) => {
    if (isExtracting) return;

    const entity = entities[index];
    if (!entity.name || !entity.prompt) return;

    setIsExtracting(true);
    setShowResults(true); // Show results section immediately so user can see progress/continue
    // Don't reset all completed entities, just this one if it was completed
    setCompletedEntities((prev) => {
      const newSet = new Set(prev);
      newSet.delete(entity.name);
      return newSet;
    });

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      const conversionId = documentData.conversionId;
      if (!conversionId) {
        throw new Error(
          "No conversion ID available. Please run document processing first."
        );
      }

      const modelObj = availableModels.find((m) => m.id === selectedModel);
      let modelTypeToUse = "azure";
      if (modelObj?.category === "google") {
        modelTypeToUse = "gemini";
      } else if (modelObj?.category === "anthropic") {
        modelTypeToUse = "anthropic";
      }

      const token = localStorage.getItem("token") || "";

      const updatedEntity = await extractSingleEntity(
        entity,
        index,
        abortControllerRef.current.signal,
        conversionId,
        {
          modelType: modelTypeToUse,
          modelId: modelObj?.id,
          deployment: modelObj?.deployment,
          apiVersion: modelObj?.api_version,
        },
        token
      );

      // Update parent state with the new entity
      setDocumentData({
        ...documentData,
        entities: entities.map((e, i) => (i === index ? updatedEntity : e)),
      });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        alert(`Extraction failed: ${err.message}`);
      }
    } finally {
      setIsExtracting(false);
      abortControllerRef.current = null;
    }
  };

  const handleRunSummarizationClick = () => {
    // Check if all entities are already extracted
    const allExtracted = entities.every(
      (e) => e.extracted && !e.extracted.startsWith("Error:")
    );

    if (allExtracted && showResults) {
      setShowRerunDialog(true);
    } else {
      // Run only missing entities (or all if none extracted)
      handleRunSummarization(false);
    }
  };

  const handleRunSummarization = async (rerunAll = true) => {
    setShowRerunDialog(false); // Close dialog if it was open
    setIsExtracting(true);
    setShowResults(true); // Show results section immediately

    if (rerunAll) {
      setExtractingEntities(new Set());
      setCompletedEntities(new Set());
      setCurrentEntityIndex(0);
    } else {
      // If not rerunning all, mark existing successful extractions as completed
      const completed = new Set(
        entities
          .filter((e) => e.extracted && !e.extracted.startsWith("Error:"))
          .map((e) => e.name)
      );
      setCompletedEntities(completed);
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const updatedEntities = [...entities];

    try {
      // Ensure we have a conversion id (markdown stored) or fallback to existing extractedText
      const conversionId = documentData.conversionId;
      if (!conversionId) {
        throw new Error(
          "No conversion ID available. Please run document processing first so the markdown is available."
        );
      }

      const modelObj = availableModels.find((m) => m.id === selectedModel);
      // Determine model_type based on category
      let modelTypeToUse = "azure"; // default
      if (modelObj?.category === "google") {
        modelTypeToUse = "gemini";
      } else if (modelObj?.category === "anthropic") {
        modelTypeToUse = "anthropic";
      }
      const modelIdToUse = modelObj?.id; // For Gemini and Anthropic models
      const deploymentToUse = modelObj?.deployment; // For Azure models
      const apiVersionToUse = modelObj?.api_version; // For Azure models

      const token = localStorage.getItem("token") || "";

      // Process entities one by one (sequentially) for real-time feedback
      for (let i = 0; i < updatedEntities.length; i++) {
        if (signal.aborted) break;

        const entity = updatedEntities[i];

        // Skip if not rerunning all AND already extracted successfully
        if (
          !rerunAll &&
          entity.extracted &&
          !entity.extracted.startsWith("Error:")
        ) {
          continue;
        }

        setCurrentEntityIndex(i + 1);

        try {
          const updatedEntity = await extractSingleEntity(
            entity,
            i,
            signal,
            conversionId,
            {
              modelType: modelTypeToUse,
              modelId: modelIdToUse,
              deployment: deploymentToUse,
              apiVersion: apiVersionToUse,
            },
            token
          );
          updatedEntities[i] = updatedEntity;

          // Auto-scroll to the completed entity card
          setTimeout(() => {
            const entityCard = document.getElementById(`entity-card-${i}`);
            if (entityCard) {
              entityCard.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }
          }, 100);
        } catch (err: any) {
          if (err.name === "AbortError") throw err;
          // Continue to next entity if one fails (unless aborted)
        }
      }

      if (signal.aborted) return;

      console.log(
        "\n✅ All entities extracted! Generating paragraph summary...\n"
      );

      // Set state to show we're generating the paragraph and allow UI to update
      setIsGeneratingParagraph(true);

      // Small delay to ensure UI updates before the API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Generate the paragraph summary after all entities are extracted
      const summaryResp = await fetch("/api/generate_paragraph", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entities: updatedEntities,
          summary_prompt: summaryPrompt,
          model_type: modelTypeToUse,
          model_id: modelIdToUse,
          deployment: deploymentToUse,
          api_version: apiVersionToUse,
        }),
        signal,
      });

      if (!summaryResp.ok) {
        const errBody = await summaryResp.json().catch(() => ({}));
        const detail =
          errBody.detail || errBody.error || "Summary generation failed";
        throw new Error(detail);
      }

      const summaryData = await summaryResp.json();
      const finalSummary = summaryData.summary;

      console.log("✅ Summary generated successfully!\n");

      // Persist results to parent state
      setDocumentData({
        ...documentData,
        studyType: selectedStudyType,
        selectedModel: selectedModel,
        entities: updatedEntities,
        summaryPrompt: summaryPrompt,
        finalSummary,
      });

      setEntities(updatedEntities);
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Summarization aborted");
        // Save partial results with all current state
        setDocumentData({
          ...documentData,
          studyType: selectedStudyType,
          selectedModel: selectedModel,
          entities: updatedEntities,
          summaryPrompt: summaryPrompt,
        });
      } else {
        console.error("Extraction error:", err);
        alert(`Extraction failed: ${err.message}`);
        // Save partial results even on error
        setDocumentData({
          ...documentData,
          studyType: selectedStudyType,
          selectedModel: selectedModel,
          entities: updatedEntities,
          summaryPrompt: summaryPrompt,
        });
      }
    } finally {
      setIsExtracting(false);
      setIsGeneratingParagraph(false);
      abortControllerRef.current = null;
    }
  };

  const handleExportWord = async () => {
    setIsExporting(true);
    try {
      const wordBlob = await generateWordDocument(documentData);
      const fileName = `summary-report-${new Date().toISOString().split("T")[0]}.docx`;
      downloadFile(
        wordBlob,
        fileName,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    } catch (error) {
      console.error("Error generating Word document:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMarkdown = () => {
    setIsExporting(true);
    try {
      const markdownContent = generateMarkdownDocument(documentData);
      const fileName = `summary-report-${new Date().toISOString().split("T")[0]}.md`;
      downloadFile(markdownContent, fileName, "text/markdown");
    } catch (error) {
      console.error("Error generating Markdown document:", error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      {/* Rerun Confirmation Dialog */}
      <AlertDialog open={showRerunDialog} onOpenChange={setShowRerunDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Re-run Summarization?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                You have already run the summarization and have results. Running
                it again will overwrite your current extraction results.
              </p>
              <div className="bg-orange-50 border border-orange-200 rounded-md p-3">
                <p className="text-sm font-semibold text-orange-900 mb-1">
                  This will:
                </p>
                <ul className="text-sm text-orange-800 space-y-1 list-disc list-inside">
                  <li>Re-extract all {entities.length} entities</li>
                  <li>Regenerate the paragraph summary</li>
                  <li>Replace existing results with new ones</li>
                </ul>
              </div>
              <p className="text-sm font-medium">
                Are you sure you want to continue?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleRunSummarization(true)}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Yes, Re-run Summarization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h2 className="text-xl">Entity Extraction & Prompt Catalogue</h2>
          <p className="text-muted-foreground">
            Configure entity extraction prompts and select AI model
          </p>
        </div>
      </div>

      <div className="grid gap-6">
        {availableModels.length === 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No AI models are currently available. Loading models from backend
              configuration...
            </AlertDescription>
          </Alert>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle>Study Type Selection</CardTitle>
              <CardDescription>
                Choose your study type to load appropriate extraction prompts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedStudyType}
                onValueChange={handleStudyTypeChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select study type" />
                </SelectTrigger>
                <SelectContent className="max-h-[60vh] sm:max-h-[400px] overflow-y-auto">
                  {studyTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id} className="py-3">
                      <span data-select-trigger-text={type.name} />
                      <div className="flex flex-col gap-1.5 w-full">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">
                            {type.name}
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Model Selection
              </CardTitle>
              <CardDescription>
                Choose the AI model for entity extraction
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedModel}
                onValueChange={setSelectedModel}
                disabled={availableModels.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      availableModels.length === 0
                        ? "Loading models from backend..."
                        : "Select AI model"
                    }
                  >
                    {selectedModel ? (
                      <span className="font-semibold">
                        {
                          availableModels.find((m) => m.id === selectedModel)
                            ?.name
                        }
                      </span>
                    ) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-[60vh] sm:max-h-[400px] overflow-y-auto">
                  {availableModels.map((model) => (
                    <SelectItem
                      key={model.id}
                      value={model.id}
                      className="py-3"
                    >
                      <span data-select-trigger-text={model.name} />
                      <div className="flex flex-col gap-1.5 w-full">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">
                            {model.name}
                          </span>
                          <span className="text-xs font-medium bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800">
                            {model.provider}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground font-medium">
                          {model.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {availableModels.length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Loading models from backend...
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {selectedStudyType && (
          <Card className="border-gray-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Entity Extraction Configuration</CardTitle>
                  <CardDescription>
                    Customize the entities and prompts for extraction (loaded
                    from template)
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={addEntity}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Entity
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {entities.map((entity, index) => {
                const isExtracting = extractingEntities.has(entity.name);
                const isCompleted = completedEntities.has(entity.name);
                const referenceCount = entity.references?.length || 0;
                const promptCharCount = entity.prompt?.length || 0;

                return (
                  <div
                    key={index}
                    id={`entity-card-${index}`}
                    className={`rounded-2xl border p-5 space-y-5 transition-all duration-300 ${
                      isExtracting
                        ? "border-blue-300 bg-blue-50/40 shadow-md"
                        : isCompleted
                          ? "border-emerald-200 bg-emerald-50/30"
                          : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-gray-200 bg-gradient-to-r from-gray-50 to-white px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-blue-900">
                          Entity {index + 1}
                        </span>
                        {isExtracting && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            <Sparkles className="h-3.5 w-3.5 animate-spin" />
                            Extracting
                          </span>
                        )}
                        {isCompleted && !isExtracting && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Completed
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className="rounded-full bg-white px-3 py-1 font-medium shadow-sm">
                          {referenceCount} references
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 font-medium shadow-sm">
                          {promptCharCount} chars
                        </span>
                        {entities.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-muted-foreground"
                            onClick={() => removeEntity(index)}
                            disabled={isExtracting}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                          onClick={() => handleRunSingleEntity(index)}
                          disabled={
                            isExtracting ||
                            !entity.name ||
                            !entity.prompt ||
                            !selectedModel
                          }
                          title={
                            entity.extracted
                              ? "Re-run this entity"
                              : "Run this entity"
                          }
                        >
                          {isExtracting &&
                          extractingEntities.has(entity.name) ? (
                            <Sparkles className="h-3.5 w-3.5 animate-spin" />
                          ) : entity.extracted ? (
                            <RefreshCw className="h-3.5 w-3.5" />
                          ) : (
                            <PlayCircle className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Split Layout: Left (Entity Info) / Right (PDF Viewer) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Left Side: Entity Configuration and Results */}
                      <div className="space-y-4">
                        <div className="grid gap-4">
                          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between">
                              <Label
                                htmlFor={`entity-name-${index}`}
                                className="text-sm font-semibold"
                              >
                                Entity Name
                              </Label>
                              <span className="text-xs text-gray-400">
                                Used in reports & exports
                              </span>
                            </div>
                            <Input
                              id={`entity-name-${index}`}
                              value={entity.name}
                              onChange={(e) =>
                                updateEntity(index, "name", e.target.value)
                              }
                              placeholder="e.g., Authors, Funding Sources, Dose Level"
                              className="mt-3"
                            />
                          </div>

                          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between">
                              <Label
                                htmlFor={`entity-prompt-${index}`}
                                className="text-sm font-semibold"
                              >
                                Extraction Prompt
                              </Label>
                              <span className="text-xs text-gray-500">
                                {promptCharCount} characters
                              </span>
                            </div>
                            <Textarea
                              id={`entity-prompt-${index}`}
                              value={entity.prompt}
                              onChange={(e) =>
                                updateEntity(index, "prompt", e.target.value)
                              }
                              placeholder="Describe what information to extract with few-shot examples..."
                              rows={8}
                              className="mt-3 resize-y min-h-[200px]"
                            />
                          </div>
                        </div>

                        {entity.extracted && (
                          <div className="space-y-4">
                            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-semibold">
                                  Extracted Answer
                                </Label>
                                <span className="text-xs text-gray-500">
                                  Markdown supported
                                </span>
                              </div>
                              <div className="bg-gradient-to-br from-gray-50 to-blue-50 p-3 rounded-lg border border-gray-100 prose prose-sm max-w-none mt-3">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {entity.answer || entity.extracted}
                                </ReactMarkdown>
                              </div>
                            </div>

                            {/* References List */}
                            {entity.references &&
                              entity.references.length > 0 && (
                                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-4">
                                  <div className="flex items-center justify-between mb-3">
                                    <Label className="text-sm font-semibold flex items-center gap-2">
                                      <MapPin className="h-4 w-4 text-blue-600" />
                                      Source References (
                                      {entity.references.length})
                                    </Label>
                                    <span className="text-xs text-gray-500">
                                      Click a reference to jump in the PDF
                                      viewer
                                    </span>
                                  </div>
                                  <div className="border rounded-lg p-3 bg-gray-50 max-h-[360px] min-h-[220px] overflow-y-auto">
                                    <div className="space-y-2">
                                      {entity.references.map((ref, refIdx) => {
                                        const pageNum =
                                          ref.best_match?.page_number ||
                                          ref.best_match?.bounding_regions?.[0]
                                            ?.page_number;
                                        const refColor = `hsl(${
                                          (refIdx * 60) % 360
                                        }, 70%, 50%)`;
                                        const isActive =
                                          focusedReferenceByEntity[index] ===
                                          refIdx;

                                        return (
                                          <div
                                            key={refIdx}
                                            className={`text-xs bg-white p-3 rounded border-2 transition-all cursor-pointer ${
                                              isActive
                                                ? "border-blue-500 shadow-sm bg-blue-50/60"
                                                : "border-gray-200 hover:border-blue-400"
                                            }`}
                                            style={{
                                              borderLeftColor: refColor,
                                              borderLeftWidth: "4px",
                                            }}
                                            onClick={() => {
                                              handleReferenceFocus(
                                                index,
                                                refIdx
                                              );
                                            }}
                                          >
                                            <div className="flex items-start gap-2">
                                              <div
                                                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                                                style={{
                                                  backgroundColor: refColor,
                                                }}
                                              >
                                                {refIdx + 1}
                                              </div>
                                              <div className="flex-1 min-w-0">
                                                <p className="text-gray-700 leading-relaxed">
                                                  {ref.text.length > 120
                                                    ? `${ref.text.substring(0, 120)}...`
                                                    : ref.text}
                                                </p>
                                                {ref.best_match && (
                                                  <div className="flex items-center gap-2 mt-1">
                                                    {pageNum && (
                                                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-200">
                                                        Page {pageNum}
                                                      </span>
                                                    )}
                                                    {/* Similarity hidden per request */}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {entity.duration && (
                                    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 text-sm flex flex-wrap gap-6">
                                      <div className="flex items-center gap-2">
                                        <Hash className="h-4 w-4 text-blue-600" />
                                        <div>
                                          <Label className="text-xs text-gray-500 uppercase tracking-wide">
                                            Tokens
                                          </Label>
                                          <div className="text-base font-semibold text-gray-900">
                                            {entity.promptTokens ?? "-"} in /{" "}
                                            {entity.completionTokens ?? "-"} out
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Timer className="h-4 w-4 text-blue-600" />
                                        <div>
                                          <Label className="text-xs text-gray-500 uppercase tracking-wide">
                                            Time
                                          </Label>
                                          <div className="text-base font-semibold text-gray-900">
                                            {entity.duration.toFixed(2)}s
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                          </div>
                        )}
                      </div>

                      {/* Right Side: PDF Viewer Beta */}
                      <div className="border-l border-gray-200 pl-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="h-4 w-4 text-blue-600" />
                            <Label className="text-sm font-semibold">
                              PDF Viewer Beta
                            </Label>
                            <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">
                              BETA
                            </span>
                          </div>
                          {documentData.fileId && documentData.conversionId ? (
                            <div id={`pdf-viewer-${index}`}>
                              <EntityPDFViewerBeta
                                fileId={documentData.fileId}
                                conversionId={documentData.conversionId}
                                references={entity.references || []}
                                focusedReferenceIndex={
                                  focusedReferenceByEntity[index] ?? null
                                }
                              />
                            </div>
                          ) : (
                            <div className="h-[500px] flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
                              <div className="text-center">
                                <FileText className="h-10 w-10 text-gray-400 mx-auto mb-2" />
                                <p className="text-xs text-gray-500">
                                  PDF viewer not available. Please process a
                                  document first.
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* tokens info moved inside references block */}
                  </div>
                );
              })}

              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle>Paragraph Generator Prompt</CardTitle>
                  <CardDescription>
                    Customize how the extracted entities should be combined into
                    a paragraph. The entities will be automatically included.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={summaryPrompt
                      .replace(/\n*\{\{entities\}\}$/i, "")
                      .trim()}
                    onChange={(e) => {
                      // Ensure {{entities}} placeholder is always appended
                      const userInput = e.target.value.trim();
                      setSummaryPrompt(
                        userInput ? `${userInput}\n\n{{entities}}` : userInput
                      );
                    }}
                    placeholder="Enter the prompt for paragraph generation..."
                    rows={6}
                    className="resize-y min-h-[120px]"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    💡 Tip: The extracted entities will be automatically
                    included below your instructions.
                  </p>
                </CardContent>
              </Card>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleRunSummarizationClick}
                  disabled={
                    (isExtracting && !abortControllerRef.current) ||
                    entities.length === 0 ||
                    entities.some((e) => !e.name || !e.prompt) ||
                    !selectedModel ||
                    availableModels.length === 0
                  }
                  className={`flex-1 transition-all duration-300 ${
                    isExtracting ? "bg-blue-50 border-blue-300 shadow-lg" : ""
                  }`}
                  size="lg"
                >
                  {isExtracting ? (
                    isGeneratingParagraph ? (
                      <>
                        <div className="relative mr-2">
                          <Sparkles className="h-5 w-5 animate-spin text-blue-600" />
                          <div className="absolute inset-0 animate-ping opacity-40">
                            <Sparkles className="h-5 w-5 text-blue-600" />
                          </div>
                        </div>
                        <span className="font-medium">
                          Generating Paragraph Summary...
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="relative mr-2">
                          <Sparkles className="h-5 w-5 animate-spin text-blue-600" />
                          <div className="absolute inset-0 animate-ping opacity-40">
                            <Sparkles className="h-5 w-5 text-blue-600" />
                          </div>
                        </div>
                        <span className="font-medium">
                          Extracting Entity {currentEntityIndex} of{" "}
                          {entities.length}...
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <PlayCircle className="h-5 w-5 mr-2" />
                      <span className="font-medium">
                        Run Entity Extraction & Generate Paragraph
                      </span>
                    </>
                  )}
                </Button>

                {isExtracting && (
                  <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
                    <Button
                      variant="destructive"
                      size="lg"
                      onClick={handleStopExtraction}
                      className="px-8 py-6 rounded-full shadow-2xl text-lg font-semibold hover:scale-105 transition-transform ring-4 ring-white/20 backdrop-blur-sm"
                    >
                      <StopCircle className="h-6 w-6 mr-2 animate-pulse" />
                      Stop Extraction
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {showResults && (
          <>
            <div className="grid lg:grid-cols-2 gap-6">
              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle>Generated Paragraph Summary</CardTitle>
                  <CardDescription>
                    Synthesized paragraph from extracted entities
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96">
                    {documentData.finalSummary ? (
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {documentData.finalSummary}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <p>
                          Paragraph summary will appear here after generation...
                        </p>
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Download className="h-5 w-5" />
                    Export Summary Report
                  </CardTitle>
                  <CardDescription>
                    Download your complete analysis with full pipeline metadata
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4">
                    <Button
                      onClick={handleExportWord}
                      disabled={isExporting}
                      variant="outline"
                      className="flex items-center gap-2"
                    >
                      <File className="h-4 w-4" />
                      {isExporting ? "Exporting..." : "Export as Word (.docx)"}
                    </Button>
                    <Button
                      onClick={handleExportMarkdown}
                      disabled={isExporting}
                      variant="outline"
                      className="flex items-center gap-2"
                    >
                      <FileText className="h-4 w-4" />
                      {isExporting
                        ? "Exporting..."
                        : "Export as Markdown (.md)"}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-3">
                    Both formats include complete pipeline configuration, entity
                    prompts, extraction results, and metadata.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-green-200 bg-green-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    Evaluate Extractions
                  </CardTitle>
                  <CardDescription>
                    Assess extraction quality using AI-powered evaluation
                    metrics
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={() =>
                      onComplete?.({
                        ...documentData,
                        studyType: selectedStudyType,
                        selectedModel: selectedModel,
                        entities: entities,
                        summaryPrompt: summaryPrompt,
                      })
                    }
                    variant="default"
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    Continue to Evaluation
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                  <p className="text-sm text-muted-foreground mt-3">
                    Evaluate your extractions with multiple LLM judges
                    (GPT-5-Mini, Gemini) for quality assessment.
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
