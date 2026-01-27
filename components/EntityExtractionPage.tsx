import { useState, useEffect, useRef } from "react";
import { pLimit } from "../utils/concurrency";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  ArrowLeft,
  Plus,
  X,
  Sparkles,
  Bot,
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
  Loader2,
  Clock,
  Eye,
  Info,
  ChevronDown,
  ChevronUp,
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
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { authenticatedFetch } from "../utils/authUtils";

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
  systemPrompt?: string; // Per-entity system prompt
  extracted?: string;
  answer?: string;
  references?: Reference[];
  duration?: number;
  promptTokens?: number;
  completionTokens?: number;
  // NEW: Store extraction results for multiple models
  extractionsByModel?: Record<
    string,
    {
      extracted: string;
      answer?: string;
      references?: Reference[];
      duration?: number;
      promptTokens?: number;
      completionTokens?: number;
    }
  >;
}

type FileStatus = {
  status:
    | "idle"
    | "queued"
    | "processing"
    | "generating_summary"
    | "completed"
    | "error";
  currentEntityIndex: number;
  totalEntities: number;
  currentEntityName?: string;
};

interface EntityExtractionPageProps {
  onBack: () => void;
  onComplete?: (data: Partial<DocumentData>) => void;
  documentData: DocumentData;
  setDocumentData: React.Dispatch<React.SetStateAction<DocumentData>>;
}

export function EntityExtractionPage({
  onBack,
  onComplete,
  documentData,
  setDocumentData,
}: EntityExtractionPageProps) {
  const [files, setFiles] = useState<any[]>(() => {
    if (documentData.uploadedFiles && documentData.uploadedFiles.length > 0) {
      return documentData.uploadedFiles;
    }
    // Backward compatibility
    return [
      {
        fileId: documentData.fileId || "single",
        file: documentData.file,
        studyType: documentData.studyType,
        selectedModel: documentData.selectedModel,
        entities: documentData.entities,
        summaryPrompt: documentData.summaryPrompt,
        finalSummary: documentData.finalSummary,
        processingResult: {
          conversionId: documentData.conversionId,
          processorUsed: documentData.processorUsed,
        },
      },
    ];
  });

  const [selectedFileId, setSelectedFileId] = useState<string>(
    files.length > 0 ? files[0].fileId : ""
  );

  const currentFile =
    files.find((f) => f.fileId === selectedFileId) || files[0];

  const [selectedStudyType, setSelectedStudyType] = useState(
    currentFile?.studyType || ""
  );

  // Initialize with first pre-selected model
  const [selectedModel, setSelectedModel] = useState(() => {
    const preSelectedModels =
      currentFile?.selectedModels || documentData.selectedModels || [];
    return preSelectedModels.length > 0
      ? preSelectedModels[0]
      : currentFile?.selectedModel || "";
  });

  const [entities, setEntities] = useState<Entity[]>(
    currentFile?.entities || []
  );
  const [summaryPrompt, setSummaryPrompt] = useState(
    currentFile?.summaryPrompt || ""
  );
  const [paragraphSystemPrompt, setParagraphSystemPrompt] = useState(
    currentFile?.paragraphSystemPrompt ||
      "You are a scientific writing assistant. Your task is to synthesize extracted information into a cohesive, well-structured paragraph while maintaining complete accuracy."
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
  const [figures, setFigures] = useState<any[]>([]);

  // Track processing status for each file independently
  const [fileProcessingStatus, setFileProcessingStatus] = useState<
    Record<string, FileStatus>
  >({});

  // Batch processing state
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  // Sync state when selected file changes
  useEffect(() => {
    const file = files.find((f) => f.fileId === selectedFileId);
    if (file) {
      setSelectedStudyType(file.studyType || "");

      // Initialize with first pre-selected model
      const preSelectedModels =
        file.selectedModels || documentData.selectedModels || [];
      if (preSelectedModels.length > 0) {
        setSelectedModel(preSelectedModels[0]);
      } else {
        setSelectedModel(file.selectedModel || "");
      }

      setEntities(file.entities || []);
      setSummaryPrompt(file.summaryPrompt || "");
      setShowResults(!!file.finalSummary);
      // Reset extraction progress for view
      setExtractingEntities(new Set());
      setCompletedEntities(new Set());
      setCurrentEntityIndex(0);
    }
  }, [selectedFileId, files]);

  // CRITICAL: Update displayed entity results when user switches models
  useEffect(() => {
    if (!selectedModel || entities.length === 0) return;

    console.log(`🔄 Switching to model: ${selectedModel}`);

    // Update entities to show results from the selected model
    setEntities((prevEntities) =>
      prevEntities.map((entity) => {
        // If entity has multi-model results, swap to selected model's results
        if (
          entity.extractionsByModel &&
          entity.extractionsByModel[selectedModel]
        ) {
          const modelResult = entity.extractionsByModel[selectedModel];
          return {
            ...entity,
            extracted: modelResult.extracted,
            answer: modelResult.answer,
            references: modelResult.references || [],
            duration: modelResult.duration,
            promptTokens: modelResult.promptTokens,
            completionTokens: modelResult.completionTokens,
          };
        }
        // Otherwise keep existing data
        return entity;
      })
    );
  }, [selectedModel]); // Run when model changes

  // Pre-fetch PDFs to avoid backend bottleneck during entity extraction
  // This loads PDFs through PDF.js and caches them, just like EntityPDFViewerBeta does
  const preFetchPDFs = async (pendingFiles: any[]) => {
    console.log(
      "[Pre-fetch] Starting PDF pre-fetch for",
      pendingFiles.length,
      "files"
    );

    // Import PDF.js dynamically
    // @ts-ignore
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

    // Fetch all PDFs using PDF.js (they'll be cached in pdfDocumentCache)
    const fetchPromises = pendingFiles.map(async (file) => {
      try {
        // Check if already in cache (from EntityPDFViewerBeta)
        const { pdfDocumentCache } = await import("./EntityPDFViewerBeta");
        if (pdfDocumentCache.has(file.fileId)) {
          console.log(
            `[Pre-fetch] ✅ Already cached: ${file.file?.name || file.fileId}`
          );
          return;
        }

        // Load through PDF.js to match EntityPDFViewerBeta's caching
        const loadingTask = pdfjsLib.getDocument({
          url: `/api/files/${file.fileId}`,
          disableAutoFetch: false,
          disableStream: false,
        });

        const pdfDoc = await loadingTask.promise;

        // Cache the resolved document (same as EntityPDFViewerBeta)
        pdfDocumentCache.set(file.fileId, pdfDoc);

        console.log(
          `[Pre-fetch] ✅ Cached PDF for ${file.file?.name || file.fileId}`
        );
      } catch (err) {
        console.warn(
          `[Pre-fetch] Failed to pre-fetch PDF for ${file.fileId}:`,
          err
        );
        // Non-fatal, continue with other fetches
      }
    });

    await Promise.all(fetchPromises);
    console.log("[Pre-fetch] All PDFs pre-fetched and cached in PDF.js");
  };

  // Parallel Batch Processing
  const startBatchProcessing = async () => {
    setIsBatchRunning(true);
    const pendingFiles = files.filter((f) => f.studyType && !f.finalSummary);

    // Initialize status for all pending files
    const initialStatus: Record<string, FileStatus> = {};
    pendingFiles.forEach((f) => {
      initialStatus[f.fileId] = {
        status: "queued",
        currentEntityIndex: 0,
        totalEntities: f.entities?.length || 0,
        currentEntityName: f.entities?.[0]?.name,
      };
    });
    setFileProcessingStatus((prev) => ({ ...prev, ...initialStatus }));

    // Pre-fetch all PDFs BEFORE starting entity extraction
    // This prevents backend bottleneck when switching files during processing
    try {
      await preFetchPDFs(pendingFiles);
    } catch (err) {
      console.error(
        "[Pre-fetch] PDF pre-fetch failed, continuing anyway:",
        err
      );
    }

    // Limit concurrency to 5 to prevent UI freeze
    const limit = pLimit(5);

    // Process all pending files with concurrency limit
    try {
      await Promise.all(
        pendingFiles.map((file) => limit(() => processFile(file)))
      );
    } catch (error) {
      console.error("Batch processing error:", error);
    } finally {
      setIsBatchRunning(false);
    }
  };

  const processFile = async (file: any) => {
    const conversionId =
      file.processingResult?.conversionId || documentData.conversionId;
    if (!conversionId) return;


    // Determine models to use: prefer file-specific selection, fallback to global selection
    const modelsToUse =
      file.selectedModels && file.selectedModels.length > 0
        ? file.selectedModels
        : selectedModel
          ? [selectedModel]
          : [];

    if (modelsToUse.length === 0) {
      console.warn(`No models selected for file ${file.fileId}`);
      return;
    }

    // For summary generation later, pick the first model as primary if needed,
    // or we might need to update summary generation to be multi-model aware too.
    // For now, we'll stick to the logic of using the first available model for summary
    // or the one matching "selectedModel" if present.
    const primaryModelId = modelsToUse.includes(selectedModel)
      ? selectedModel
      : modelsToUse[0];
    const primaryModelObj = availableModels.find(
      (m) => m.id === primaryModelId
    );

    const updatedEntities = [...(file.entities || [])];

    // Process entities for this file
    for (let i = 0; i < updatedEntities.length; i++) {
      try {
        const entity = updatedEntities[i];

        // Update status
        setFileProcessingStatus((prev) => ({
          ...prev,
          [file.fileId]: {
            status: "processing",
            currentEntityIndex: i + 1,
            totalEntities: updatedEntities.length,
            currentEntityName: entity.name,
          },
        }));

        if (entity.extracted && !entity.extracted.startsWith("Error:"))
          continue;

        // Use the shared internal extraction logic
        const { results, extractionsByModel } =
          await extractEntityWithModelsInternal(
            entity,
            conversionId,
            modelsToUse,
            file.processingResult?.processorUsed || documentData.processorUsed
          );

        // Determine primary result for display/storage
        const primaryResult =
          extractionsByModel[primaryModelId] || results[0]?.result;

        const updatedEntity = {
          ...entity,
          extractionsByModel,
          extracted: primaryResult?.extracted || "No result",
          answer: primaryResult?.answer,
          references: primaryResult?.references || [],
          duration: primaryResult?.duration,
          promptTokens: primaryResult?.promptTokens,
          completionTokens: primaryResult?.completionTokens,
        };

        updatedEntities[i] = updatedEntity;

        // Update files state incrementally to show progress
        setFiles((prev) =>
          prev.map((f) =>
            f.fileId === file.fileId ? { ...f, entities: updatedEntities } : f
          )
        );
      } catch (err) {
        console.error(`Error processing entity for file ${file.fileId}:`, err);
      }
    }

    // Generate summary
    setFileProcessingStatus((prev) => ({
      ...prev,
      [file.fileId]: {
        ...prev[file.fileId],
        status: "generating_summary",
      },
    }));

    try {
      // Determine model type for summary
      let modelTypeToUse = "azure";
      const provider = primaryModelObj?.provider?.toLowerCase() || "";
      if (provider.includes("google") || provider.includes("gemini")) {
        modelTypeToUse = "gemini";
      } else if (provider.includes("anthropic")) {
        modelTypeToUse = "anthropic";
      } else if (provider.includes("meta") || provider.includes("llama")) {
        modelTypeToUse = "llama";
      }

      const summaryResp = await authenticatedFetch("/api/generate_paragraph", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entities: updatedEntities,
          summary_prompt: file.summaryPrompt,
          model_type: modelTypeToUse,
          model_id: primaryModelObj?.id,
          deployment: primaryModelObj?.deployment,
          api_version: primaryModelObj?.api_version,
        }),
      });

      if (summaryResp.ok) {
        const summaryData = await summaryResp.json();
        setFiles((prev) =>
          prev.map((f) =>
            f.fileId === file.fileId
              ? {
                  ...f,
                  entities: updatedEntities,
                  finalSummary: summaryData.summary,
                }
              : f
          )
        );

        // Update parent data
        setDocumentData((prev) => ({
          ...prev,
          uploadedFiles: prev.uploadedFiles?.map((f) =>
            f.fileId === file.fileId
              ? {
                  ...f,
                  entities: updatedEntities,
                  finalSummary: summaryData.summary,
                }
              : f
          ),
        }));

        // Mark as completed immediately
        setFileProcessingStatus((prev) => ({
          ...prev,
          [file.fileId]: {
            ...prev[file.fileId],
            status: "completed",
          },
        }));
      }
    } catch (err) {
      console.error(`Error generating summary for file ${file.fileId}:`, err);
      setFileProcessingStatus((prev) => ({
        ...prev,
        [file.fileId]: {
          ...prev[file.fileId],
          status: "error",
        },
      }));
    } finally {
      // No cleanup needed here
    }
  };

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

  // Auto-start batch if coming from selection page with pending items
  useEffect(() => {
    const pendingFiles = files.filter(
      (f) =>
        f.studyType &&
        !f.finalSummary &&
        !f.entities?.some((e: any) => e.extracted)
    );
    if (
      pendingFiles.length > 0 &&
      !isBatchRunning &&
      !isExtracting &&
      availableModels.length > 0
    ) {
      startBatchProcessing();
    }
  }, [availableModels]);

  // Fetch figures for PDF viewer
  useEffect(() => {
    const fetchFigures = async () => {
      if (!currentFile.processingResult?.conversionId) return;

      try {
        const response = await authenticatedFetch(
          `/api/documents/${currentFile.processingResult.conversionId}/figures`,
          {
          }
        );

        if (response.ok) {
          const data = await response.json();
          setFigures(data.figures || []);
          console.log(`[EntityExtractionPage] Fetched ${data.figures?.length || 0} figures for PDF viewer`);
        }
      } catch (err) {
        console.error("Error fetching figures:", err);
      }
    };

    fetchFigures();
  }, [currentFile.processingResult?.conversionId]);

  // Debug: Log figures when they change
  useEffect(() => {
    if (figures.length > 0) {
      console.log('[EntityExtractionPage] Figures loaded for PDF viewer:', figures.map(f => ({ id: f.id, page: f.page, caption: f.caption?.substring(0, 50) })));
    }
  }, [figures]);

  useEffect(() => {
    if (
      selectedStudyType &&
      !entities.length &&
      !currentFile?.entities?.length
    ) {
      // Load template entities for the selected study type
      const {
        entities: templateEntities,
        summaryPrompt: templateSummaryPrompt,
      } = loadStudyTypeTemplate(selectedStudyType);
      setEntities(templateEntities);
      setSummaryPrompt(templateSummaryPrompt);
    }
  }, [selectedStudyType, entities.length, currentFile]);

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
    field: "name" | "prompt" | "systemPrompt",
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

  // Helper for API call
  const extractEntityFromApi = async (
    entity: Entity,
    conversionId: string,
    modelConfig: {
      modelType: string;
      modelId?: string;
      deployment?: string;
      apiVersion?: string;
    },
    processorUsed?: string,
    signal?: AbortSignal
  ) => {
    const resp = await authenticatedFetch("/api/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversion_id: conversionId,
        model_type: modelConfig.modelType,
        model_id: modelConfig.modelId,
        deployment: modelConfig.deployment,
        api_version: modelConfig.apiVersion,
        entities: [
          {
            name: entity.name,
            prompt: entity.prompt,
            system_prompt: entity.systemPrompt || undefined,
          },
        ],
        max_tokens: 4096,
        temperature: 0.0,
        processor_used: processorUsed,
      }),
      signal,
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(
        errBody.detail || errBody.error || "Extraction request failed"
      );
    }

    const data = await resp.json();
    const extractedEntities = data.extracted_entities || [];

    if (extractedEntities.length > 0) {
      const extracted = extractedEntities[0];
      const meta = extracted.meta || {};
      return {
        ...entity,
        extracted: extracted.extracted,
        answer: extracted.answer || extracted.extracted,
        references: extracted.references || [],
        duration: meta.duration,
        promptTokens: meta.prompt_tokens,
        completionTokens: meta.completion_tokens,
      };
    }

    return {
      ...entity,
      extracted: "Error: Not found in response",
    };
  };

  // Internal helper to run extraction with multiple models
  const extractEntityWithModelsInternal = async (
    entity: Entity,
    conversionId: string,
    selectedModelIds: string[],
    processorUsed?: string,
    signal?: AbortSignal
  ) => {
    // Run ALL selected models concurrently
    const modelPromises = selectedModelIds.map(async (modelId) => {
      const modelObj = availableModels.find((m) => m.id === modelId);
      if (!modelObj) {
        console.warn(`Model ${modelId} not found in available models`);
        return { modelId, result: null };
      }

      // Map provider to backend model_type ("azure", "gemini", "anthropic", "llama")
      let modelType = "azure";
      const provider = modelObj.provider?.toLowerCase() || "";

      if (provider.includes("google") || provider.includes("gemini")) {
        modelType = "gemini";
      } else if (provider.includes("anthropic")) {
        modelType = "anthropic";
      } else if (provider.includes("azure")) {
        modelType = "azure";
      } else if (provider.includes("meta") || provider.includes("llama")) {
        modelType = "llama";
      }

      const modelConfig = {
        modelType,
        modelId: modelObj.id,
        deployment: modelObj.deployment,
        apiVersion: modelObj.api_version,
      };

      console.log(`  ▶️ Starting extraction with model: ${modelObj.name}`);

      try {
        const result = await extractEntityFromApi(
          entity,
          conversionId,
          modelConfig,
          processorUsed,
          signal
        );
        return { modelId, result };
      } catch (error: any) {
        console.error(
          `Error extracting ${entity.name} with ${modelId}:`,
          error
        );
        return {
          modelId,
          result: {
            ...entity,
            extracted: `Error: ${error.message}`,
            answer: `Error: ${error.message}`,
          },
        };
      }
    });

    // Wait for all models to complete
    const results = await Promise.all(modelPromises);

    // Build extractionsByModel object
    const extractionsByModel: Record<string, any> = {};
    results.forEach(({ modelId, result }) => {
      if (result) {
        extractionsByModel[modelId] = {
          extracted: result.extracted,
          answer: result.answer || result.extracted,
          references: result.references || [],
          duration: result.duration,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
      }
    });

    return {
      results,
      extractionsByModel,
    };
  };

  // NEW: Extract entity with ALL selected models concurrently
  const extractEntityWithAllModels = async (
    entity: Entity,
    index: number,
    signal: AbortSignal,
    conversionId: string,
    selectedModelIds: string[]
  ) => {
    try {
      // Mark entity as extracting
      setExtractingEntities((prev) => new Set(prev).add(entity.name));

      const { results, extractionsByModel } =
        await extractEntityWithModelsInternal(
          entity,
          conversionId,
          selectedModelIds,
          currentFile.processingResult?.processorUsed ||
            documentData.processorUsed,
          signal
        );

      // Use the currently selected model's result as the main display
      // If the selected model wasn't run (e.g. batch mode with different selection), fallback to first result
      const currentModelResult =
        extractionsByModel[selectedModel] || results[0]?.result;

      const updatedEntity = {
        ...entity,
        extractionsByModel,
        // For backward compatibility and display:
        extracted: currentModelResult?.extracted || "No result",
        answer: currentModelResult?.answer,
        references: currentModelResult?.references || [],
        duration: currentModelResult?.duration,
        promptTokens: currentModelResult?.promptTokens,
        completionTokens: currentModelResult?.completionTokens,
      };

      // Update UI with results
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

  // LEGACY: Old single entity extraction function - replaced by extractEntityWithAllModels
  /*
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
    }
  ) => {
    try {
      // Mark entity as extracting
      setExtractingEntities((prev) => new Set(prev).add(entity.name));

      const updatedEntity = await extractEntityFromApi(
        entity,
        conversionId,
        modelConfig,
        currentFile.processingResult?.processorUsed ||
        documentData.processorUsed,
        signal
      );

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
  */

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
      const conversionId =
        currentFile.processingResult?.conversionId || documentData.conversionId;
      if (!conversionId) {
        throw new Error(
          "No conversion ID available. Please run document processing first."
        );
      }



      // Get pre-selected models
      const preSelectedModels =
        currentFile?.selectedModels || documentData.selectedModels || [];

      console.log("🔍 Debug Model Selection:", {
        currentFileSelectedModels: currentFile?.selectedModels,
        documentDataSelectedModels: documentData.selectedModels,
        preSelectedModels,
        selectedModelFallback: selectedModel,
      });

      const modelsToUse =
        preSelectedModels.length > 0 ? preSelectedModels : [selectedModel];

      console.log(
        `🚀 Running entity extraction with ${modelsToUse.length} model(s): `,
        modelsToUse
      );

      const updatedEntity = await extractEntityWithAllModels(
        entity,
        index,
        abortControllerRef.current.signal,
        conversionId,
        modelsToUse
      );

      // Update parent state with the new entity
      // Update parent state with the new entity
      // (removed legacy setDocumentData call)

      // Update files state
      setFiles((prev) =>
        prev.map((f) =>
          f.fileId === selectedFileId
            ? {
                ...f,
                entities: entities.map((e, i) =>
                  i === index ? updatedEntity : e
                ),
              }
            : f
        )
      );

      // Update parent
      setDocumentData({
        ...documentData,
        uploadedFiles: files.map((f) =>
          f.fileId === selectedFileId
            ? {
                ...f,
                entities: entities.map((e, i) =>
                  i === index ? updatedEntity : e
                ),
              }
            : f
        ),
      });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        alert(`Extraction failed: ${err.message} `);
      }
    } finally {
      setIsExtracting(false);
      abortControllerRef.current = null;
    }
  };

  // NEW: Generate summary only (without extraction)
  const generateSummaryOnly = async () => {
    setIsGeneratingParagraph(true);

    try {
      const modelObj = availableModels.find((m) => m.id === selectedModel);
      let modelTypeToUse = "azure";
      const provider = modelObj?.provider?.toLowerCase() || "";
      if (provider.includes("google") || provider.includes("gemini")) {
        modelTypeToUse = "gemini";
      } else if (provider.includes("anthropic")) {
        modelTypeToUse = "anthropic";
      } else if (provider.includes("meta") || provider.includes("llama")) {
        modelTypeToUse = "llama";
      }

      const summaryResp = await authenticatedFetch("/api/generate_paragraph", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entities: entities,
          summary_prompt: summaryPrompt.includes("{{entities}}")
            ? summaryPrompt
            : `${summaryPrompt}\n\n{{entities}}`,
          system_prompt: paragraphSystemPrompt || undefined,
          model_type: modelTypeToUse,
          model_id: modelObj?.id,
          deployment: modelObj?.deployment,
          api_version: modelObj?.api_version,
        }),
      });

      if (!summaryResp.ok) {
        throw new Error("Summary generation failed");
      }

      const summaryData = await summaryResp.json();
      const finalSummary = summaryData.summary;

      // Update state
      setFiles((prev) =>
        prev.map((f) =>
          f.fileId === selectedFileId
            ? { ...f, finalSummary, summaryPrompt }
            : f
        )
      );
      setDocumentData((prev) => ({
        ...prev,
        uploadedFiles: prev.uploadedFiles?.map((f) =>
          f.fileId === selectedFileId
            ? { ...f, finalSummary, summaryPrompt }
            : f
        ),
      }));
    } catch (err) {
      console.error("Summary generation error:", err);
      alert("Failed to generate summary");
    } finally {
      setIsGeneratingParagraph(false);
    }
  };

  const handleRunSummarizationClick = () => {
    // Check if all entities are already extracted
    const allExtracted = entities.every(
      (e) => e.extracted && !e.extracted.startsWith("Error:")
    );

    if (allExtracted) {
      // Just generate summary
      generateSummaryOnly();
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
      const conversionId =
        currentFile.processingResult?.conversionId || documentData.conversionId;
      if (!conversionId) {
        throw new Error(
          "No conversion ID available. Please run document processing first so the markdown is available."
        );
      }

      const modelObj = availableModels.find((m) => m.id === selectedModel);
      // Determine model_type based on provider
      let modelTypeToUse = "azure"; // default
      const provider = modelObj?.provider?.toLowerCase() || "";
      if (provider.includes("google") || provider.includes("gemini")) {
        modelTypeToUse = "gemini";
      } else if (provider.includes("anthropic")) {
        modelTypeToUse = "anthropic";
      } else if (provider.includes("meta") || provider.includes("llama")) {
        modelTypeToUse = "llama";
      }
      const modelIdToUse = modelObj?.id; // For Gemini and Anthropic models
      const deploymentToUse = modelObj?.deployment; // For Azure models
      const apiVersionToUse = modelObj?.api_version; // For Azure models



      // Pre-fetch the PDF to avoid backend bottleneck during entity extraction
      try {
        console.log("[Pre-fetch] Caching PDF before entity extraction...");
      const pdfResponse = await authenticatedFetch(
        `/api/files/${currentFile.fileId}`
      );
        if (pdfResponse.ok) {
          await pdfResponse.blob(); // Force browser to cache
          console.log("[Pre-fetch] ✅ PDF cached successfully");
        }
      } catch (err) {
        console.warn(
          "[Pre-fetch] Failed to pre-fetch PDF, continuing anyway:",
          err
        );
      }

      // Set initial batch state immediately
      // This part of the code seems to be for a batch file processing scenario,
      // but handleRunSummarization is currently designed for entities within a single file.
      // Applying the change as requested, assuming `setIsBatchRunning` and `processFile`
      // are defined elsewhere or this function is being refactored for batch file processing.
      // Note: `files` and `processFile` are not defined in the provided context of handleRunSummarization.
      // This might lead to runtime errors if not accompanied by other changes.
      // setIsBatchRunning(true); // Uncomment if setIsBatchRunning is defined and needed here
      // setIsExtracting(true); // Already set above

      // Initialize processing state for all files
      // const initialFilesState = files.map(f => ({
      //   ...f,
      //   // If it's the first file, mark as processing immediately
      //   status: f.fileId === files[0].fileId ? "processing" : "pending"
      // }));
      // Note: In a real app we'd update the parent state here, but for now we rely on local state updates
      // during the process loop.

      // for (let i = 0; i < files.length; i++) {
      //   if (abortControllerRef.current?.signal.aborted) break;

      //   const file = files[i];

      //   // Update selection to show current file being processed
      //   setSelectedFileId(file.fileId);

      //   // Small delay to allow UI to update
      //   await new Promise(resolve => setTimeout(resolve, 100));

      //   try {
      //     await processFile(file, i, files.length);
      //   } catch (error) {
      //     console.error(`Error processing file ${ file.fileId }: `, error);
      //     // Continue to next file even if one fails
      //   }
      // }

      // Process entities with concurrency limit
      const CONCURRENCY_LIMIT = 5;
      let currentIndex = 0;
      const totalEntities = updatedEntities.length;

      const processNextEntity = async () => {
        while (currentIndex < totalEntities) {
          if (signal.aborted) break;

          // Atomically capture and increment index
          const i = currentIndex++;
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
            // Get pre-selected models
            const preSelectedModels =
              currentFile?.selectedModels || documentData.selectedModels || [];
            const modelsToUse =
              preSelectedModels.length > 0
                ? preSelectedModels
                : [selectedModel];

            const updatedEntity = await extractEntityWithAllModels(
              entity,
              i,
              signal,
              conversionId,
              modelsToUse
            );
            updatedEntities[i] = updatedEntity;
          } catch (err: any) {
            if (err.name === "AbortError") throw err;
            // Continue to next entity if one fails (unless aborted)
            console.error(`Error processing entity ${i}:`, err);
          }
        }
      };

      // Start workers
      const workers = Array(CONCURRENCY_LIMIT)
        .fill(null)
        .map(() => processNextEntity());

      await Promise.all(workers);

      if (signal.aborted) return;

      console.log(
        "\n✅ All entities extracted! Generating paragraph summary...\n"
      );

      // Set state to show we're generating the paragraph and allow UI to update
      setIsGeneratingParagraph(true);

      // Small delay to ensure UI updates before the API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Generate the paragraph summary after all entities are extracted
      const summaryResp = await authenticatedFetch("/api/generate_paragraph", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entities: updatedEntities,
          summary_prompt: summaryPrompt.includes("{{entities}}")
            ? summaryPrompt
            : `${summaryPrompt}\n\n{{entities}}`,
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

      setEntities(updatedEntities);

      // Update files state
      const updatedFiles = files.map((f) =>
        f.fileId === selectedFileId
          ? {
              ...f,
              studyType: selectedStudyType,
              selectedModel: selectedModel,
              entities: updatedEntities,
              summaryPrompt: summaryPrompt,
              finalSummary,
            }
          : f
      );
      setFiles(updatedFiles);

      // Update parent
      setDocumentData({
        ...documentData,
        uploadedFiles: updatedFiles,
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Summarization aborted");
        // Save partial results with all current state
        const updatedFiles = files.map((f) =>
          f.fileId === selectedFileId
            ? {
                ...f,
                studyType: selectedStudyType,
                selectedModel: selectedModel,
                entities: updatedEntities,
                summaryPrompt: summaryPrompt,
              }
            : f
        );
        setFiles(updatedFiles);

        setDocumentData({
          ...documentData,
          uploadedFiles: updatedFiles,
        });
      } else {
        console.error("Extraction error:", err);
        alert(`Extraction failed: ${err.message} `);

        // Save partial results even on error
        const updatedFiles = files.map((f) =>
          f.fileId === selectedFileId
            ? {
                ...f,
                studyType: selectedStudyType,
                selectedModel: selectedModel,
                entities: updatedEntities,
                summaryPrompt: summaryPrompt,
              }
            : f
        );
        setFiles(updatedFiles);

        setDocumentData({
          ...documentData,
          uploadedFiles: updatedFiles,
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
      // Use current file data for export
      const fileData = {
        ...documentData,
        ...currentFile,
        entities: currentFile.entities,
        finalSummary: currentFile.finalSummary,
        fileId: currentFile.fileId,
      };

      const wordBlob = await generateWordDocument(fileData);
      const fileName = `summary - report - ${currentFile.file?.name || "document"}.docx`;
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
      // Use current file data for export
      const fileData = {
        ...documentData,
        ...currentFile,
        entities: currentFile.entities,
        finalSummary: currentFile.finalSummary,
        fileId: currentFile.fileId,
      };

      const markdownContent = generateMarkdownDocument(fileData);
      const fileName = `summary - report - ${currentFile.file?.name || "document"}.md`;
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

      {/* File Selector for Batch */}
      {files.length > 0 && (
        <div className="mb-6">
          <Label className="mb-2 block">Select Document to View/Extract</Label>
          <Select
            value={selectedFileId}
            onValueChange={setSelectedFileId}
            disabled={isExtracting && !isBatchRunning} // Disable manual switch if extracting single file, but allow if batch is running (actually better to disable to avoid confusion)
          >
            <SelectTrigger className="w-full md:w-[400px] h-auto py-2">
              <SelectValue placeholder="Select document">
                {(() => {
                  const file = files.find((f) => f.fileId === selectedFileId);
                  if (!file) return "Select document";
                  const status = fileProcessingStatus[file.fileId];
                  const isProcessing = status?.status === "processing";
                  const isGeneratingSummary =
                    status?.status === "generating_summary";
                  const isCompleted =
                    !!file.finalSummary || status?.status === "completed";
                  const isError = status?.status === "error";

                  return (
                    <div className="flex flex-col items-start text-left">
                      <span className="font-medium truncate w-full">
                        {file.file.name}
                      </span>
                      {isProcessing ? (
                        <span className="text-xs text-blue-500 animate-pulse">
                          Processing Entity {status?.currentEntityIndex || 0}/
                          {status?.totalEntities || 0}...
                        </span>
                      ) : isGeneratingSummary ? (
                        <span className="text-xs text-purple-600 animate-pulse">
                          Generating Summary...
                        </span>
                      ) : isCompleted ? (
                        <span className="text-xs text-green-600">
                          Completed
                        </span>
                      ) : isError ? (
                        <span className="text-xs text-red-600">Error</span>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {status?.status === "queued" ? "Queued" : "Idle"}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {files.map((file) => {
                const isProcessing =
                  fileProcessingStatus[file.fileId]?.status === "processing";
                const isCompleted = !!file.finalSummary;

                return (
                  <SelectItem key={file.fileId} value={file.fileId}>
                    <div className="flex items-center gap-2">
                      {isCompleted ? (
                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : isProcessing ? (
                        <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
                      ) : fileProcessingStatus[file.fileId]?.status ===
                        "error" ? (
                        <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                      ) : fileProcessingStatus[file.fileId]?.status ===
                        "generating_summary" ? (
                        <Sparkles className="h-4 w-4 text-purple-500 animate-spin flex-shrink-0" />
                      ) : (
                        <Clock className="h-4 w-4 text-gray-300 flex-shrink-0" />
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="truncate max-w-[300px] font-medium">
                          {file.file?.name || "Document"}
                        </span>
                        {isProcessing ? (
                          <span className="text-xs text-blue-600">
                            Processing Entity{" "}
                            {fileProcessingStatus[file.fileId]
                              ?.currentEntityIndex || 0}
                            /
                            {fileProcessingStatus[file.fileId]?.totalEntities ||
                              0}
                            ...
                          </span>
                        ) : isCompleted ? (
                          <span className="text-xs text-green-600">
                            Completed
                          </span>
                        ) : fileProcessingStatus[file.fileId]?.status ===
                          "error" ? (
                          <span className="text-xs text-red-600">Error</span>
                        ) : fileProcessingStatus[file.fileId]?.status ===
                          "generating_summary" ? (
                          <span className="text-xs text-purple-600 animate-pulse">
                            Generating Summary...
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Queued</span>
                        )}
                      </div>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

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
              <CardTitle>Selected Study Type</CardTitle>
              <CardDescription>
                Study type configured during batch study selection
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedStudyType}
                onValueChange={handleStudyTypeChange}
                disabled={true}
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
                Selected AI Model(s)
              </CardTitle>
              <CardDescription>
                {selectedModel && availableModels.length > 0 ? (
                  <span className="font-medium text-foreground">
                    Currently viewing:{" "}
                    {availableModels.find((m) => m.id === selectedModel)
                      ?.name || "Unknown"}
                  </span>
                ) : (
                  "Select from pre-configured models to view extraction results"
                )}
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
                  {(() => {
                    // Filter to only show pre-selected models
                    const preSelectedModels =
                      currentFile?.selectedModels ||
                      documentData.selectedModels ||
                      [];
                    const filteredModels =
                      preSelectedModels.length > 0
                        ? availableModels.filter((m) =>
                            preSelectedModels.includes(m.id)
                          )
                        : availableModels;

                    return filteredModels.map((model) => (
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
                    ));
                  })()}
                </SelectContent>
              </Select>

              {(() => {
                const preSelectedModels =
                  currentFile?.selectedModels ||
                  documentData.selectedModels ||
                  [];
                if (preSelectedModels.length > 0) {
                  return (
                    <p className="text-sm text-muted-foreground mt-2">
                      Showing {preSelectedModels.length} pre-selected model
                      {preSelectedModels.length !== 1 ? "s" : ""} from study
                      selection
                    </p>
                  );
                }
                return availableModels.length === 0 ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    Loading models from backend...
                  </p>
                ) : null;
              })()}
            </CardContent>
          </Card>
        </div>

        {selectedStudyType && (
          <>
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
                  // Check global status first, then fall back to local state
                  const fileStatus = fileProcessingStatus[selectedFileId];
                  const isProcessingThisFile =
                    fileStatus?.status === "processing";

                  // If batch processing this file, use the global status index
                  // Otherwise use the local extractingEntities set
                  const isExtracting = isProcessingThisFile
                    ? index + 1 === fileStatus.currentEntityIndex
                    : extractingEntities.has(entity.name);

                  const isCompleted =
                    completedEntities.has(entity.name) ||
                    (isProcessingThisFile &&
                      index + 1 < fileStatus.currentEntityIndex);
                  const referenceCount = entity.references?.length || 0;
                  const promptCharCount = entity.prompt?.length || 0;

                  return (
                    <div
                      key={index}
                      id={`entity - card - ${index} `}
                      className={`rounded - 2xl border p - 5 space - y - 5 transition - all duration - 300 ${
                        isExtracting
                          ? "border-blue-300 bg-blue-50/40 shadow-md"
                          : isCompleted
                            ? "border-emerald-200 bg-emerald-50/30"
                            : "border-gray-200 bg-white"
                      } `}
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
                                  htmlFor={`entity - name - ${index} `}
                                  className="text-sm font-semibold"
                                >
                                  Entity Name
                                </Label>
                                <span className="text-xs text-gray-400">
                                  Used in reports & exports
                                </span>
                              </div>
                              <Input
                                id={`entity - name - ${index} `}
                                value={entity.name}
                                onChange={(e) =>
                                  updateEntity(index, "name", e.target.value)
                                }
                                placeholder="e.g., Authors, Funding Sources, Dose Level"
                                className="mt-3"
                              />
                            </div>

                            {/* System Prompt Section (Collapsible) */}
                            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = [...entities];
                                  (
                                    updated[index] as any
                                  )._systemPromptExpanded = !(
                                    updated[index] as any
                                  )._systemPromptExpanded;
                                  setEntities(updated);
                                }}
                                className="w-full flex items-center justify-between text-left"
                              >
                                <div className="flex items-center gap-2">
                                  <Label className="text-sm font-semibold cursor-pointer">
                                    System Prompt
                                  </Label>
                                  <div className="relative group">
                                    <Info className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                                      Defines the AI's role and behavior.
                                      <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-gray-900"></div>
                                    </div>
                                  </div>
                                </div>
                                {(entity as any)._systemPromptExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-gray-400" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-gray-400" />
                                )}
                              </button>
                              {(entity as any)._systemPromptExpanded && (
                                <Textarea
                                  id={`entity-system-prompt-${index}`}
                                  value={
                                    entity.systemPrompt ||
                                    "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt."
                                  }
                                  onChange={(e) =>
                                    updateEntity(
                                      index,
                                      "systemPrompt",
                                      e.target.value
                                    )
                                  }
                                  placeholder="Describe the AI's role and expertise..."
                                  rows={3}
                                  className="mt-3 resize-y min-h-[80px] text-sm"
                                />
                              )}
                            </div>

                            {/* Extraction Prompt (User Prompt) Section */}
                            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Label
                                    htmlFor={`entity - prompt - ${index} `}
                                    className="text-sm font-semibold"
                                  >
                                    Extraction Prompt
                                  </Label>
                                  <div className="relative group">
                                    <Info className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                                      The specific extraction instruction for
                                      this entity.
                                      <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-gray-900"></div>
                                    </div>
                                  </div>
                                </div>
                                <span className="text-xs text-gray-500">
                                  {promptCharCount} characters
                                </span>
                              </div>
                              <Textarea
                                id={`entity - prompt - ${index} `}
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
                                        {entity.references.map(
                                          (ref, refIdx) => {
                                            const pageNum =
                                              ref.best_match?.page_number ||
                                              ref.best_match
                                                ?.bounding_regions?.[0]
                                                ?.page_number;
                                            const refColor = `hsl(${(refIdx * 60) % 360}, 70%, 50%)`;
                                            const isActive =
                                              focusedReferenceByEntity[
                                                index
                                              ] === refIdx;

                                            return (
                                              <div
                                                key={refIdx}
                                                className={`text - xs bg - white p - 3 rounded border - 2 transition - all cursor - pointer ${
                                                  isActive
                                                    ? "border-blue-500 shadow-sm bg-blue-50/60"
                                                    : "border-gray-200 hover:border-blue-400"
                                                } `}
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
                                                    className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
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
                                          }
                                        )}
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
                                              {entity.completionTokens ?? "-"}{" "}
                                              out
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
                            {documentData.fileId &&
                            documentData.conversionId ? (
                              <div id={`pdf - viewer - ${index} `}>
                                <EntityPDFViewerBeta
                                  key={`${currentFile.fileId} -${index} `}
                                  fileId={currentFile.fileId}
                                  conversionId={
                                    currentFile.processingResult
                                      ?.conversionId ||
                                    documentData.conversionId
                                  }
                                  references={entity.references || []}
                                  focusedReferenceIndex={
                                    focusedReferenceByEntity[index] ?? null
                                  }
                                  figures={figures}
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

                {/* Summary Generation Indicator removed as per user request */}
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-6 mt-6">
              <div className="flex flex-col h-full">
                <Card className="border-gray-200 h-full flex flex-col">
                  <CardHeader>
                    <CardTitle>Paragraph Generator Prompt</CardTitle>
                    <CardDescription>
                      Customize how the extracted entities should be combined
                      into a paragraph. The entities will be automatically
                      included.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col space-y-4">
                    {/* System Prompt Section (Collapsible) */}
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <button
                        type="button"
                        onClick={() => {
                          const btn = document.getElementById(
                            "paragraph-system-prompt-toggle"
                          );
                          const content = document.getElementById(
                            "paragraph-system-prompt-content"
                          );
                          if (btn && content) {
                            const isExpanded =
                              content.classList.contains("hidden");
                            content.classList.toggle("hidden");
                            btn.setAttribute(
                              "aria-expanded",
                              String(isExpanded)
                            );
                          }
                        }}
                        id="paragraph-system-prompt-toggle"
                        aria-expanded="false"
                        className="w-full flex items-center justify-between text-left"
                      >
                        <div className="flex items-center gap-2">
                          <Label className="text-sm font-medium cursor-pointer">
                            System Prompt
                          </Label>
                          <div className="relative group">
                            <Info className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                              Defines the AI's role for paragraph generation.
                              <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-gray-900"></div>
                            </div>
                          </div>
                        </div>
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      </button>
                      <div
                        id="paragraph-system-prompt-content"
                        className="hidden mt-3"
                      >
                        <Textarea
                          value={paragraphSystemPrompt}
                          onChange={(e) =>
                            setParagraphSystemPrompt(e.target.value)
                          }
                          placeholder="Describe the AI's role for paragraph generation..."
                          rows={3}
                          className="resize-y min-h-[80px] text-sm bg-white"
                        />
                      </div>
                    </div>

                    {/* User Prompt Section */}
                    <div className="flex-1 flex flex-col">
                      <div className="flex items-center gap-2 mb-2">
                        <Label className="text-sm font-medium">
                          User Prompt
                        </Label>
                        <div className="relative group">
                          <Info className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                            The specific instructions for generating the
                            paragraph.
                            <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-gray-900"></div>
                          </div>
                        </div>
                      </div>
                      <Textarea
                        value={summaryPrompt}
                        onChange={(e) => setSummaryPrompt(e.target.value)}
                        placeholder="Enter the prompt for paragraph generation..."
                        className="resize-none flex-1 min-h-[250px]"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      💡 Tip: The extracted entities will be automatically
                      included below your instructions.
                    </p>
                    <div className="mt-4 flex gap-3">
                      <Button
                        variant="outline"
                        onClick={handleRunSummarizationClick}
                        disabled={
                          (isExtracting && !abortControllerRef.current) ||
                          isGeneratingParagraph ||
                          entities.length === 0 ||
                          entities.some((e) => !e.name || !e.prompt) ||
                          !selectedModel ||
                          availableModels.length === 0
                        }
                        className={`flex-1 transition-all duration-300 ${
                          isExtracting || isGeneratingParagraph
                            ? "bg-blue-50 border-blue-300 shadow-lg"
                            : ""
                        }`}
                        size="lg"
                      >
                        {isExtracting || isGeneratingParagraph ? (
                          isGeneratingParagraph ? (
                            <>
                              <div className="relative mr-2">
                                <Sparkles className="h-5 w-5 animate-spin text-blue-600" />
                                <div className="absolute inset-0 animate-ping opacity-40">
                                  <Sparkles className="h-5 w-5 text-blue-600" />
                                </div>
                              </div>
                              <span className="font-medium">
                                Regenerating Paragraph Summary...
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
                              {entities.every(
                                (e) =>
                                  e.extracted &&
                                  !e.extracted.startsWith("Error:")
                              )
                                ? "Regenerate Paragraph"
                                : "Run Entity Extraction & Generate Paragraph"}
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
              </div>
              <div className="flex flex-col h-full">
                <Card className="border-gray-200 h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Generated Paragraph Summary</span>
                      <div className="flex gap-2">
                        {/* View All Extraction Results Button */}
                        {entities.some((e) => e.extracted) && (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs"
                                title="View all extraction results"
                              >
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                View All Results
                              </Button>
                            </DialogTrigger>
                            <DialogContent
                              className="max-h-[85vh] overflow-y-auto"
                              style={{ width: "70vw", maxWidth: "70vw" }}
                            >
                              <DialogHeader>
                                <DialogTitle className="text-xl">
                                  All Extraction Results
                                </DialogTitle>
                                <DialogDescription>
                                  Complete extraction details for{" "}
                                  {entities.filter((e) => e.extracted).length}{" "}
                                  of {entities.length} entities
                                </DialogDescription>
                              </DialogHeader>

                              <div className="space-y-6 mt-4">
                                {entities
                                  .filter((e) => e.extracted)
                                  .map((entity, idx) => (
                                    <div
                                      key={idx}
                                      className="border border-gray-200 rounded-lg p-6 space-y-6 bg-white shadow-sm"
                                    >
                                      {/* Entity Header */}
                                      <div className="flex flex-col gap-2 pb-4 border-b border-gray-100">
                                        <div className="flex items-center gap-3">
                                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-sm">
                                            {idx + 1}
                                          </div>
                                          <h3 className="text-xl font-semibold text-gray-900">
                                            {entity.name}
                                          </h3>
                                        </div>
                                        <div className="bg-gray-50 p-3 rounded text-xs text-gray-600 font-mono whitespace-pre-wrap">
                                          {entity.prompt}
                                        </div>
                                      </div>

                                      {/* Multi-Model Results */}
                                      {entity.extractionsByModel ? (
                                        <div className="grid gap-6">
                                          {Object.entries(
                                            entity.extractionsByModel
                                          ).map(([modelId, result]) => {
                                            const modelName =
                                              availableModels.find(
                                                (m) => m.id === modelId
                                              )?.name || modelId;
                                            return (
                                              <div
                                                key={modelId}
                                                className="space-y-3"
                                              >
                                                <h4 className="font-medium text-sm text-gray-900 flex items-center gap-2 bg-gray-100 px-3 py-2 rounded w-fit">
                                                  <Bot className="h-4 w-4" />
                                                  {modelName}
                                                </h4>
                                                <div className="prose prose-sm max-w-none text-gray-800 p-4 rounded border border-gray-200 bg-white">
                                                  <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                  >
                                                    {result.answer ||
                                                      result.extracted}
                                                  </ReactMarkdown>
                                                </div>

                                                {/* References */}
                                                {result.references &&
                                                  result.references.length >
                                                    0 && (
                                                    <div className="pl-4 border-l-2 border-gray-200">
                                                      <p className="text-xs font-semibold text-gray-500 mb-2">
                                                        Sources:
                                                      </p>
                                                      <div className="space-y-2">
                                                        {result.references.map(
                                                          (
                                                            ref: any,
                                                            rIdx: number
                                                          ) => (
                                                            <div
                                                              key={rIdx}
                                                              className="text-xs text-gray-600 bg-gray-50 p-2 rounded"
                                                            >
                                                              {ref.text}
                                                            </div>
                                                          )
                                                        )}
                                                      </div>
                                                    </div>
                                                  )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        /* Fallback for single model (legacy) */
                                        <div className="space-y-3">
                                          <div className="prose prose-sm max-w-none text-gray-800 p-4 rounded border border-gray-200 bg-white">
                                            <ReactMarkdown
                                              remarkPlugins={[remarkGfm]}
                                            >
                                              {entity.answer ||
                                                entity.extracted}
                                            </ReactMarkdown>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                              </div>
                            </DialogContent>
                          </Dialog>
                        )}
                        <Button
                          onClick={handleExportWord}
                          disabled={isExporting}
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          title="Export as Word"
                        >
                          <File className="h-3.5 w-3.5 mr-1" />
                          Word
                        </Button>
                        <Button
                          onClick={handleExportMarkdown}
                          disabled={isExporting}
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          title="Export as Markdown"
                        >
                          <FileText className="h-3.5 w-3.5 mr-1" />
                          MD
                        </Button>
                      </div>
                    </CardTitle>
                    <CardDescription>
                      Synthesized paragraph from extracted entities
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-96">
                      {currentFile.finalSummary ? (
                        <div className="prose prose-sm max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {currentFile.finalSummary}
                          </ReactMarkdown>
                        </div>
                      ) : isGeneratingParagraph ||
                        fileProcessingStatus[selectedFileId]?.status ===
                          "generating_summary" ? (
                        <div className="flex flex-col items-center justify-center h-full text-purple-600 animate-pulse">
                          <Sparkles className="h-8 w-8 mb-2 animate-spin" />
                          <p className="font-medium">Generating Summary...</p>
                          <p className="text-xs text-purple-400 mt-1">
                            Synthesizing extracted entities...
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                          <p>
                            Paragraph summary will appear here after
                            generation...
                          </p>
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </div>

            {showResults &&
              !isExtracting &&
              !isGeneratingParagraph &&
              !isBatchRunning && (
                <div className="mt-6">
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
                    size="lg"
                    className="w-full bg-green-600 hover:bg-green-700 h-14 text-lg shadow-lg"
                  >
                    Continue to Evaluation
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </Button>
                  <p className="text-center text-sm text-muted-foreground mt-3">
                    Evaluate your extractions with multiple LLM judges
                    (GPT-5-Mini, Gemini) for quality assessment.
                  </p>
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );
}
