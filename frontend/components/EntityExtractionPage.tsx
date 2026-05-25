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
import { Slider } from "./ui/slider";
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
import { DocumentData } from "../App";
import { MarkdownViewer } from "./MarkdownViewer";
import {
  generateWordDocument,
  generateMarkdownDocument,
  downloadFile,
  EntityExportOptions,
} from "./ExportUtils";
import { loadStudyTypeTemplate } from "./TemplateLoader";
import { TemplatePicker, ResolvedTemplate } from "./TemplatePicker";
import { settingsManager } from "./SettingsManager";
import type { ModelConfig } from "./SettingsManager";
import {
  EntityPDFViewerBeta,
  loadDocumentAnalysis,
  loadPdfDocument,
} from "./EntityPDFViewerBeta";
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
  cost?: number;
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
      cost?: number;
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
  statusMessage?: string; // Extra message like "Retrying..." or "Succeeded after N retries"
};

interface EntityExtractionPageProps {
  onBack: () => void;
  onComplete?: (data: Partial<DocumentData>) => void;
  onNavigateForward?: () => void;
  documentData: DocumentData;
  setDocumentData: React.Dispatch<React.SetStateAction<DocumentData>>;
  onInFlightChange?: (step: "extraction" | null) => void;
  onInvalidateDownstream?: () => void;
}

export function EntityExtractionPage({
  onBack,
  onComplete,
  onNavigateForward,
  documentData,
  setDocumentData,
  onInFlightChange,
  onInvalidateDownstream,
}: EntityExtractionPageProps) {
  const sessionIdRef = useRef<string | null>(documentData.sessionId || null);

  // Ensure ref stays in sync if documentData updates
  useEffect(() => {
    if (documentData.sessionId) {
      sessionIdRef.current = documentData.sessionId;
    }
  }, [documentData.sessionId]);

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

  // Track the last synced session
  const lastSyncedSessionRef = useRef<string | null>(null);

  const [selectedFileId, setSelectedFileId] = useState<string>(
    files.length > 0 ? files[0].fileId : ""
  );
  const selectedFileIdRef = useRef(selectedFileId);
  const prefetchedAnalysisIdsRef = useRef<Set<string>>(new Set());

  // Sync files when session changes (e.g., after session restore)
  useEffect(() => {
    if (
      !documentData.sessionId ||
      !documentData.uploadedFiles ||
      documentData.uploadedFiles.length === 0
    ) {
      return;
    }

    if (lastSyncedSessionRef.current !== documentData.sessionId) {
      console.log(
        "[EntityExtractionPage] Session changed, syncing files:",
        documentData.sessionId,
        `(${documentData.uploadedFiles.length} files)`
      );
      setFiles(documentData.uploadedFiles);
      lastSyncedSessionRef.current = documentData.sessionId;

      if (documentData.uploadedFiles.length > 0) {
        setSelectedFileId(documentData.uploadedFiles[0].fileId);
      }
    }
    // Also include uploadedFiles.length so that if the same session is restored
    // again (e.g. after a failed restore attempt) the sync still fires.
  }, [documentData.sessionId, documentData.uploadedFiles?.length]);

  const currentFile =
    files.find((f) => f.fileId === selectedFileId) || files[0];

  const getFileDocumentId = (file?: any): string | null => {
    if (!file) return null;

    return (
      file.processingResult?.conversionId ||
      file.conversionId ||
      file.fileId ||
      (files.length === 1 ? documentData.conversionId || null : null)
    );
  };

  const getFileProcessorUsed = (file?: any): string | undefined => {
    if (!file) return undefined;

    return (
      file.processingResult?.processorUsed ||
      file.processorUsed ||
      (files.length === 1 ? documentData.processorUsed : undefined)
    );
  };

  const currentFileDocumentId = getFileDocumentId(currentFile);
  const currentFileProcessorUsed = getFileProcessorUsed(currentFile);

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

  // Per-file, per-model temperature map for paragraph generation
  // Structure: { fileId: { modelId: temperature } }
  const [fileModelTemperatures, setFileModelTemperatures] = useState<
    Record<string, Record<string, number>>
  >(() => {
    // Initialize from uploaded files' model_temperatures (restored from files_config)
    const initial: Record<string, Record<string, number>> = {};
    documentData.uploadedFiles?.forEach((f: any) => {
      if (f.modelTemperatures && Object.keys(f.modelTemperatures).length > 0) {
        initial[f.fileId] = f.modelTemperatures;
      }
    });
    // Fallback: if global modelTemperatures exists (legacy), apply to all files
    if (
      Object.keys(initial).length === 0 &&
      documentData.modelTemperatures &&
      Object.keys(documentData.modelTemperatures).length > 0
    ) {
      documentData.uploadedFiles?.forEach((f: any) => {
        initial[f.fileId] = { ...documentData.modelTemperatures! };
      });
    }
    return initial;
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

  // Cancel any in-flight extraction if the component unmounts (e.g. user navigates back)
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const [showRerunDialog, setShowRerunDialog] = useState(false);
  const [currentEntityIndex, setCurrentEntityIndex] = useState(0);
  const [isGeneratingParagraph, setIsGeneratingParagraph] = useState(false);
  const [focusedReferenceByEntity, setFocusedReferenceByEntity] = useState<
    Record<number, number | null>
  >({});
  const [focusedReferenceTriggerByEntity, setFocusedReferenceTriggerByEntity] =
    useState<Record<number, number>>({});
  const [figures, setFigures] = useState<any[]>([]);

  // Track processing status for each file independently
  const [fileProcessingStatus, setFileProcessingStatus] = useState<
    Record<string, FileStatus>
  >({});

  // Batch processing state
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  // "Rerun Failed" state: tracks per-file-per-model in-flight rerun counts
  const [isRerunningFailed, setIsRerunningFailed] = useState(false);
  const [rerunFailedProgress, setRerunFailedProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

  // Report in-flight status to parent for navigation guards
  useEffect(() => {
    const busy =
      isExtracting ||
      isGeneratingParagraph ||
      isBatchRunning ||
      isRerunningFailed;
    onInFlightChange?.(busy ? "extraction" : null);
    return () => onInFlightChange?.(null);
  }, [isExtracting, isGeneratingParagraph, isBatchRunning, isRerunningFailed]);

  // Helper to create session
  const createSession = async () => {
    // If we already have a session ID from App.tsx or previous creation, return it
    if (sessionIdRef.current) return sessionIdRef.current;

    try {
      const user = await import("../utils/authUtils").then((m) =>
        m.getCurrentUser()
      );
      if (!user) return null;

      const token = await import("../utils/authUtils").then((m) =>
        m.getValidToken()
      );
      if (!token) return null;

      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: user.id,
          name: documentData.sharedSourceName
            ? `Copy of ${documentData.sharedSourceName}`
            : `${currentFile.file?.name || "Extraction"} Session`,
          configuration: {
            study_type: selectedStudyType,
            selected_models: availableModels
              .filter(
                (m) =>
                  currentFile.selectedModels?.includes(m.id) ||
                  m.id === selectedModel
              )
              .map((m) => m.id),
            entities: entities.map((e) => ({
              name: e.name,
              prompt: e.prompt,
              system_prompt: e.systemPrompt,
            })),
            summary_prompt: summaryPrompt,
            temperature: temperature,
            model_temperatures: modelTemperatures,
          },
          documents: files
            .filter((f) => f.fileId)
            .map((f) => ({
              file_hash: f.fileId,
              filename: f.file?.name || "Document",
              processor_used: f.processorUsed,
              parse_cost: f.processingResult?.parse_cost,
              page_count: f.processingResult?.page_count,
              parse_duration_seconds: f.processingResult?.parseDuration,
            })),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        sessionIdRef.current = data.session_id;
        return data.session_id;
      }
    } catch (error) {
      console.error("Error creating session:", error);
    }
    return null;
  };

  // Helper to save result
  const saveExtractionResult = async (
    sessionId: string,
    entity: Entity,
    fileId?: string
  ) => {
    try {
      const user = await import("../utils/authUtils").then((m) =>
        m.getCurrentUser()
      );
      if (!user) return;

      const token = await import("../utils/authUtils").then((m) =>
        m.getValidToken()
      );
      if (!token) return;

      // Find which model produced the result
      // simplified: assume first selected model or 'selectedModel' if singular
      // For multi-model, we might need to iterate extractionsByModel

      // If we have extractionsByModel, save each
      if (entity.extractionsByModel) {
        for (const [modelId, data] of Object.entries(
          entity.extractionsByModel
        )) {
          const modelData = data as {
            extracted?: string;
            references?: any[];
            promptTokens?: number;
            completionTokens?: number;
            duration?: number;
            cost?: number;
          };
          await fetch(
            `/api/sessions/${sessionId}/extractions?user_id=${user.id}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                entity_name: entity.name,
                model_id: modelId,
                extracted_text: modelData.extracted,
                references: modelData.references || [],
                status: "completed",
                extracted_at: new Date().toISOString(),
                file_hash: fileId,
                // Include token usage data
                prompt_tokens: modelData.promptTokens,
                completion_tokens: modelData.completionTokens,
                duration_ms: modelData.duration
                  ? Math.round(modelData.duration * 1000)
                  : undefined,
                cost: modelData.cost,
              }),
            }
          );
        }
      } else {
        // Legacy/Single fallback
        await fetch(
          `/api/sessions/${sessionId}/extractions?user_id=${user.id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              entity_name: entity.name,
              model_id: selectedModel, // Best guess
              extracted_text: entity.extracted,
              references: entity.references || [],
              status: "completed",
              extracted_at: new Date().toISOString(),
              file_hash: fileId,
              // Include token usage data
              prompt_tokens: entity.promptTokens,
              completion_tokens: entity.completionTokens,
              duration_ms: entity.duration
                ? Math.round(entity.duration * 1000)
                : undefined,
              cost: entity.cost,
            }),
          }
        );
      }
    } catch (error) {
      console.error("Error saving extraction result:", error);
    }
  };

  // Sync model selection ONLY when the file selection changes (not when files data updates)
  const prevSelectedFileIdRef = useRef<string>(selectedFileId);
  useEffect(() => {
    selectedFileIdRef.current = selectedFileId;
  }, [selectedFileId]);

  useEffect(() => {
    if (selectedFileId !== prevSelectedFileIdRef.current) {
      prevSelectedFileIdRef.current = selectedFileId;
      const file = files.find((f) => f.fileId === selectedFileId);
      if (file) {
        const preSelectedModels =
          file.selectedModels || documentData.selectedModels || [];
        if (preSelectedModels.length > 0) {
          setSelectedModel(preSelectedModels[0]);
        } else {
          setSelectedModel(file.selectedModel || "");
        }
      }
    }
  }, [selectedFileId]);

  // Sync other state when file selection or file data changes
  const syncedViewFileIdRef = useRef<string | null>(null);
  useEffect(() => {
    const file = files.find((f) => f.fileId === selectedFileId);
    if (file) {
      const didSwitchFile = syncedViewFileIdRef.current !== file.fileId;
      syncedViewFileIdRef.current = file.fileId;

      setSelectedStudyType(file.studyType || "");
      setEntities(file.entities || []);
      setSummaryPrompt(file.summaryPrompt || "");
      setShowResults(
        !!file.finalSummary ||
          !!(
            file.summariesByModel &&
            Object.keys(file.summariesByModel).length > 0
          )
      );
      // Reset extraction progress for view
      setExtractingEntities(new Set());
      setCompletedEntities(new Set());
      setCurrentEntityIndex(0);
      if (didSwitchFile) {
        setFocusedReferenceByEntity({});
        setFocusedReferenceTriggerByEntity({});
      }
    }
  }, [selectedFileId, files]);

  // CRITICAL: Update displayed entity results when user switches models
  useEffect(() => {
    const sourceEntities = currentFile?.entities || [];
    if (!selectedModel || sourceEntities.length === 0) return;

    console.log(
      `🔄 Syncing displayed entity results for file ${currentFile?.fileId || "unknown"} with model: ${selectedModel}`
    );

    // Update entities to show results from the selected model
    setEntities(
      sourceEntities.map((entity: Entity) => {
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
            cost: modelResult.cost,
          };
        }
        // Otherwise keep existing data
        return entity;
      })
    );
  }, [selectedModel, selectedFileId, currentFile?.entities]); // Also run when switching files/restoring

  // Pre-fetch analysis payloads so bounding boxes appear immediately when
  // switching between documents in the viewer.
  useEffect(() => {
    files.forEach((file) => {
      const documentId = getFileDocumentId(file);
      if (!documentId || prefetchedAnalysisIdsRef.current.has(documentId)) {
        return;
      }

      prefetchedAnalysisIdsRef.current.add(documentId);
      loadDocumentAnalysis(documentId, {
        timeoutMs: 15000,
      }).catch((err) => {
        prefetchedAnalysisIdsRef.current.delete(documentId);
        console.warn(
          `[EntityExtractionPage] Background analysis prefetch failed for ${documentId}:`,
          err
        );
      });
    });
  }, [files]);

  // Pre-fetch PDFs to avoid backend bottleneck during entity extraction
  // This loads PDFs through PDF.js and caches them, just like EntityPDFViewerBeta does
  const preFetchPDFs = async (pendingFiles: any[]) => {
    console.log(
      "[Pre-fetch] Starting PDF pre-fetch for",
      pendingFiles.length,
      "files"
    );

    // Fetch all PDFs using PDF.js (they'll be cached in pdfDocumentCache)
    const fetchPromises = pendingFiles.map(async (file) => {
      try {
        await loadPdfDocument(file.fileId, {
          timeoutMs: 45000,
        });

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
    await createSession();
    setIsBatchRunning(true);
    onInvalidateDownstream?.();
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

    // Process all pending files concurrently
    try {
      await Promise.all(pendingFiles.map((file) => processFile(file)));
    } catch (error) {
      console.error("Batch processing error:", error);
    } finally {
      setIsBatchRunning(false);
    }
  };

  // Auto-generate paragraph evaluation ground truth in background after paragraph creation.
  // Fires-and-forgets; updates state with the ground truth on success.
  const triggerParagraphEvalGeneration = async (
    fileId: string,
    entityOrder: string[],
    paragraphModelId: string
  ) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !fileId) return;

    try {
      const resp = await authenticatedFetch(
        "/api/paragraph-evaluation/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            file_hash: fileId,
            user_id: undefined, // backend resolves from auth token
            entity_order: entityOrder,
          }),
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        // Update files state so EvaluationPage sees the ground truth immediately
        setFiles((prev) =>
          prev.map((f) =>
            f.fileId === fileId
              ? {
                  ...f,
                  paragraphSummaryModel: paragraphModelId,
                  paragraphEvaluation: {
                    groundTruth: data.ground_truth,
                    humanScore: f.paragraphEvaluation?.humanScore ?? null,
                  },
                }
              : f
          )
        );
        setDocumentData((prev) => ({
          ...prev,
          uploadedFiles: (prev.uploadedFiles || []).map((f) =>
            f.fileId === fileId
              ? {
                  ...f,
                  paragraphSummaryModel: paragraphModelId,
                  paragraphEvaluation: {
                    groundTruth: data.ground_truth,
                    humanScore:
                      (f as any).paragraphEvaluation?.humanScore ?? null,
                  },
                }
              : f
          ),
        }));
        console.log(
          `[ParagraphEval] Ground truth generated for file ${fileId}, length=${data.ground_truth?.length}`
        );
      }
    } catch (err) {
      console.warn(
        "[ParagraphEval] Background ground truth generation failed:",
        err
      );
      // Don't surface errors to user — this is a background operation
    }
  };

  const processFile = async (file: any) => {
    const conversionId = getFileDocumentId(file);
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

    const updatedEntities = [...(file.entities || [])];

    // ── Batched extraction: send ALL entities per model in ONE HTTP request ──
    // Instead of N_entities × N_models individual requests (hitting browser's
    // 6-connection HTTP/1.1 limit), we send N_models requests total. The backend
    // runs each entity as an independent LLM call via asyncio.gather — quality
    // is identical, but HTTP overhead drops by ~16× (for 16 entities).
    //
    // Bench results: baseline 101s → batched 60s (41% faster, 5 docs × 4 entities × 2 models)

    setFileProcessingStatus((prev) => ({
      ...prev,
      [file.fileId]: {
        status: "processing",
        currentEntityIndex: 0,
        totalEntities: updatedEntities.length,
        currentEntityName: `All entities (${modelsToUse.length} model${modelsToUse.length !== 1 ? "s" : ""})`,
        statusMessage: `Sending ${updatedEntities.length} entities × ${modelsToUse.length} models in ${modelsToUse.length} batched request${modelsToUse.length !== 1 ? "s" : ""}`,
      },
    }));

    // Filter entities that need extraction (skip already-extracted unless error or placeholder)
    const entitiesToExtract = updatedEntities.filter(
      (e) => !e.extracted || e.extracted.startsWith("Error:") || e.extracted === "No result"
    );

    if (entitiesToExtract.length === 0) {
      // All entities already extracted — skip to summary
      setFileProcessingStatus((prev) => ({
        ...prev,
        [file.fileId]: {
          ...prev[file.fileId],
          currentEntityIndex: updatedEntities.length,
          statusMessage: "All entities already extracted",
        },
      }));
    } else {
      // Separate macbook models from cloud models
      const macbookModels = modelsToUse.filter((mId: string) => {
        const mObj = availableModels.find((m) => m.id === mId);
        return mObj?.provider?.toLowerCase().includes("macbook");
      });
      const cloudModels = modelsToUse.filter(
        (mId: string) => !macbookModels.includes(mId)
      );

      const hasMacbook = macbookModels.length > 0;

      // Show a "slow models" notice after a threshold
      const slowThresholdMs = hasMacbook
        ? 15000 // Macbook serialization is inherently slow, show sooner
        : Math.max(30000, modelsToUse.length * 15000);
      const retryMsgTimer = setTimeout(() => {
        setFileProcessingStatus((prev) => ({
          ...prev,
          [file.fileId]: {
            ...prev[file.fileId],
            statusMessage: hasMacbook
              ? `Macbook models process one entity at a time for reliability\u2014this is slower but ensures stable results\u2026`
              : `Waiting for model responses\u2014reasoning models (o3, o1) can take 1\u20132 minutes\u2026`,
          },
        }));
      }, slowThresholdMs);

      let completedModels = 0;
      const processorUsed = getFileProcessorUsed(file);

      // ── Cloud models: batched concurrently (existing fast path) ──
      const cloudResults: Array<{
        modelId: string;
        resultsByEntity: Record<string, any>;
        success: boolean;
      }> = [];
      if (cloudModels.length > 0) {
        const cloudModelResults = await Promise.all(
          cloudModels.map(async (modelId: string) => {
            try {
              const resultsByEntity = await extractAllEntitiesForModelBatched(
                entitiesToExtract,
                conversionId,
                modelId,
                processorUsed,
                undefined,
                sessionIdRef.current || undefined
              );
              completedModels++;
              setFileProcessingStatus((prev) => ({
                ...prev,
                [file.fileId]: {
                  ...prev[file.fileId],
                  currentEntityIndex: Math.round(
                    (completedModels / modelsToUse.length) *
                      updatedEntities.length
                  ),
                  statusMessage: `Model ${completedModels}/${modelsToUse.length} complete`,
                },
              }));
              // Show extracted text and references immediately after each cloud model batch
              // so bounding boxes appear without waiting for all models to finish
              if (selectedFileIdRef.current === file.fileId) {
                setEntities((prevEntities) =>
                  prevEntities.map((e) => {
                    const r = resultsByEntity[e.name];
                    if (!r) return e;
                    return {
                      ...e,
                      extracted: r.extracted ?? e.extracted,
                      answer: r.answer ?? r.extracted ?? e.answer,
                      references: r.references || e.references || [],
                    };
                  })
                );
              }
              return { modelId, resultsByEntity, success: true };
            } catch (err) {
              console.error(
                `Error in batched extraction for model ${modelId} on file ${file.fileId}:`,
                err
              );
              completedModels++;
              return { modelId, resultsByEntity: {}, success: false };
            }
          })
        );
        cloudResults.push(...cloudModelResults);
      }

      // ── Macbook models: send ONE entity at a time per model for reliability ──
      // This prevents GPU VRAM overload on the MacBook by ensuring only one
      // LLM inference runs at a time. We process each macbook model sequentially,
      // and within each model, send entities one-by-one with live UI updates.
      const macbookResults: Array<{
        modelId: string;
        resultsByEntity: Record<string, any>;
        success: boolean;
      }> = [];
      if (macbookModels.length > 0) {
        for (const modelId of macbookModels) {
          const modelObj = availableModels.find((m) => m.id === modelId);
          const modelName = modelObj?.name || modelId;
          const resultsByEntity: Record<string, any> = {};

          console.log(
            `🐢 Macbook serialized extraction: ${entitiesToExtract.length} entities × model "${modelName}" (one at a time)`
          );

          for (let eIdx = 0; eIdx < entitiesToExtract.length; eIdx++) {
            const entity = entitiesToExtract[eIdx];
            setFileProcessingStatus((prev) => ({
              ...prev,
              [file.fileId]: {
                ...prev[file.fileId],
                currentEntityIndex: eIdx + 1,
                totalEntities: entitiesToExtract.length,
                currentEntityName: `${entity.name} (${modelName})`,
                statusMessage: `Macbook: entity ${eIdx + 1}/${entitiesToExtract.length} — serialized for GPU reliability`,
              },
            }));

            try {
              // Send a SINGLE entity per request — mirrors extractEntityFromApi
              const modelConfig = {
                modelType: "macbook" as string,
                modelId: modelObj?.id,
                deployment: modelObj?.deployment,
                apiVersion: modelObj?.api_version,
              };

              const singleResult = await extractEntityFromApi(
                entity,
                conversionId,
                modelConfig,
                processorUsed,
                undefined, // signal
                sessionIdRef.current || undefined
              );

              resultsByEntity[entity.name] = {
                extracted: singleResult.extracted,
                answer: singleResult.answer || singleResult.extracted,
                references: singleResult.references || [],
                duration: singleResult.duration,
                promptTokens: singleResult.promptTokens,
                completionTokens: singleResult.completionTokens,
                cost: singleResult.cost ?? undefined,
              };

              // Show text and references immediately as each entity finishes — don't wait for all to complete
              if (selectedFileIdRef.current === file.fileId) {
                setEntities((prevEntities) =>
                  prevEntities.map((e) =>
                    e.name === entity.name
                      ? {
                          ...e,
                          extracted: singleResult.extracted,
                          answer: singleResult.answer || singleResult.extracted,
                          references: singleResult.references || [],
                        }
                      : e
                  )
                );
              }

              console.log(
                `  ✅ Macbook entity "${entity.name}" done (${eIdx + 1}/${entitiesToExtract.length})`
              );
            } catch (err) {
              console.error(
                `  ❌ Macbook entity "${entity.name}" failed:`,
                err
              );
              const errText = `Error: ${err instanceof Error ? err.message : String(err)}`;
              resultsByEntity[entity.name] = {
                extracted: errText,
              };
              // Show error text immediately too
              if (selectedFileIdRef.current === file.fileId) {
                setEntities((prevEntities) =>
                  prevEntities.map((e) =>
                    e.name === entity.name ? { ...e, extracted: errText } : e
                  )
                );
              }
            }
          }

          completedModels++;
          macbookResults.push({ modelId, resultsByEntity, success: true });
        }
      }

      // Combine cloud + macbook results
      const modelResults = [...cloudResults, ...macbookResults];

      clearTimeout(retryMsgTimer);

      // Merge results from all models into each entity's extractionsByModel
      for (let i = 0; i < updatedEntities.length; i++) {
        const entity = updatedEntities[i];
        // Skip entities that were already successfully extracted (but not "No result" placeholders)
        if (entity.extracted && !entity.extracted.startsWith("Error:") && entity.extracted !== "No result")
          continue;

        const extractionsByModel: Record<string, any> = {
          ...(entity.extractionsByModel || {}),
        };

        for (const { modelId, resultsByEntity, success } of modelResults) {
          if (!success) continue;
          const entityResult = resultsByEntity[entity.name];
          if (entityResult) {
            extractionsByModel[modelId] = entityResult;
          }
        }

        // Pick primary model's result for display
        const primaryData =
          extractionsByModel[primaryModelId] ||
          Object.values(extractionsByModel)[0];

        updatedEntities[i] = {
          ...entity,
          extractionsByModel,
          extracted: primaryData?.extracted || "No result",
          answer: primaryData?.answer,
          references: primaryData?.references || [],
          duration: primaryData?.duration,
          promptTokens: primaryData?.promptTokens,
          completionTokens: primaryData?.completionTokens,
          cost: primaryData?.cost,
        };
      }

      // Update files + documentData state with all results at once
      setFiles((prev) =>
        prev.map((f) =>
          f.fileId === file.fileId ? { ...f, entities: updatedEntities } : f
        )
      );
      setDocumentData((prev) => ({
        ...prev,
        uploadedFiles: prev.uploadedFiles?.map((f) =>
          f.fileId === file.fileId ? { ...f, entities: updatedEntities } : f
        ),
      }));

      // Persist extraction results to session
      if (sessionIdRef.current) {
        for (const entity of updatedEntities) {
          if (entity.extracted && !entity.extracted.startsWith("Error:")) {
            try {
              await saveExtractionResult(
                sessionIdRef.current,
                entity,
                file.fileId
              );
            } catch (err) {
              console.error(`Error saving extraction for ${entity.name}:`, err);
            }
          }
        }
      }

      setFileProcessingStatus((prev) => ({
        ...prev,
        [file.fileId]: {
          ...prev[file.fileId],
          currentEntityIndex: updatedEntities.length,
          statusMessage: undefined,
        },
      }));
    }

    // Generate summary
    setFileProcessingStatus((prev) => ({
      ...prev,
      [file.fileId]: {
        ...prev[file.fileId],
        status: "generating_summary",
        statusMessage: undefined,
      },
    }));

    // Show a "slow models" notice after a threshold that scales with model count
    const summarySlowThresholdMs = Math.max(30000, modelsToUse.length * 10000);
    const summaryRetryMsgTimer = setTimeout(() => {
      setFileProcessingStatus((prev) => ({
        ...prev,
        [file.fileId]: {
          ...prev[file.fileId],
          statusMessage: `Waiting for model responses\u2014reasoning models (o3, o1) can take 1\u20132 minutes\u2026`,
        },
      }));
    }, summarySlowThresholdMs);

    try {
      // Generate paragraph summaries for ALL selected models — show each as it arrives
      const fileId = file.fileId;
      let completedCount = 0;

      const summaryPromises = modelsToUse.map(async (mId: string) => {
        const mObj = availableModels.find((m) => m.id === mId);
        if (!mObj) return;

        const mType = getModelType(mObj.provider || "", mObj.id);

        // Use per-model entity results if available
        const modelEntities = updatedEntities.map((e: any) => {
          if (e.extractionsByModel?.[mId]) {
            return { ...e, extracted: e.extractionsByModel[mId].extracted };
          }
          return e;
        });

        try {
          const resp = await authenticatedFetch("/api/generate_paragraph", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entities: modelEntities,
              summary_prompt: file.summaryPrompt,
              model_type: mType,
              model_id: mObj.id,
              deployment: mObj.deployment,
              api_version: mObj.api_version,
              temperature:
                mObj.supports_temperature !== false
                  ? getModelTemperature(mId, fileId)
                  : undefined,
              session_id: sessionIdRef.current,
              file_hash: fileId,
            }),
          });

          if (resp.ok) {
            const data = await resp.json();
            // Immediately show this model's result
            updateParagraphForModel(fileId, mId, data.summary, data.meta?.cost);
            completedCount++;
          }
        } catch {
          // silently skip failed models
        }
      });

      await Promise.all(summaryPromises);
      clearTimeout(summaryRetryMsgTimer);

      if (completedCount > 0) {
        setFileProcessingStatus((prev) => ({
          ...prev,
          [fileId]: {
            ...prev[fileId],
            status: "completed",
          },
        }));

        // Auto-generate paragraph evaluation ground truth in background
        const entityOrder = updatedEntities.map((e: any) => e.name);
        const paragraphModelId =
          file.selectedModels?.[0] || file.selectedModel || "";
        triggerParagraphEvalGeneration(
          file.fileId,
          entityOrder,
          paragraphModelId
        );
      }
    } catch (err) {
      clearTimeout(summaryRetryMsgTimer);
      console.error(`Error generating summary for file ${file.fileId}:`, err);
      setFileProcessingStatus((prev) => ({
        ...prev,
        [file.fileId]: {
          ...prev[file.fileId],
          status: "error",
          statusMessage: undefined,
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

  // studyTypes removed — TemplatePicker handles both built-in and user templates

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

  // Helper: get the temperature for a specific model on a specific file
  const getModelTemperature = (modelId: string, fileId?: string): number => {
    const fId = fileId || selectedFileId;
    const fileTemps = fileModelTemperatures[fId];
    if (fileTemps?.[modelId] !== undefined) {
      return fileTemps[modelId];
    }
    const modelObj = availableModels.find((m) => m.id === modelId);
    return modelObj?.default_temperature ?? 0.5;
  };

  // Derived: current temperature for the selected model on the current file
  const temperature = getModelTemperature(selectedModel, selectedFileId);

  // Convenience: get the per-model temperature map for the current file (for session save)
  const modelTemperatures = fileModelTemperatures[selectedFileId] || {};

  // Setter: update temperature for the currently selected model on the current file
  const setTemperature = (value: number) => {
    setFileModelTemperatures((prev) => ({
      ...prev,
      [selectedFileId]: {
        ...(prev[selectedFileId] || {}),
        [selectedModel]: value,
      },
    }));
  };

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

  // Auto-generate missing paragraphs for restored sessions
  // When all entities are extracted but some models are missing paragraphs,
  // automatically generate them so the user sees per-model results immediately.
  const autoGenTriggeredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (
      !currentFile?.fileId ||
      !availableModels.length ||
      isGeneratingParagraph ||
      isExtracting ||
      isBatchRunning
    )
      return;

    // Skip if already triggered for this file
    if (autoGenTriggeredRef.current.has(currentFile.fileId)) return;

    const fileEntities = currentFile.entities || [];
    const allExtracted =
      fileEntities.length > 0 &&
      fileEntities.every(
        (e: any) => e.extracted && !e.extracted.startsWith("Error:")
      );
    if (!allExtracted) return;

    const preSelectedModels =
      currentFile.selectedModels || documentData.selectedModels || [];
    const allModelIds =
      preSelectedModels.length > 0 ? preSelectedModels : [selectedModel];
    const existingSummaries = currentFile.summariesByModel || {};
    const missingModels = allModelIds.filter(
      (id: string) => !existingSummaries[id]
    );

    if (missingModels.length > 0 && Object.keys(existingSummaries).length > 0) {
      // There's at least one existing summary but some models are missing
      console.log(
        `[Auto-Gen] Restored session missing paragraphs for ${missingModels.length} models, auto-generating...`
      );
      autoGenTriggeredRef.current.add(currentFile.fileId);
      generateParagraphsForAllModels();
    }
  }, [
    currentFile?.fileId,
    availableModels.length,
    isGeneratingParagraph,
    isExtracting,
    isBatchRunning,
  ]);

  // Fetch figures for PDF viewer
  useEffect(() => {
    let isCancelled = false;
    const retryTimeouts: ReturnType<typeof setTimeout>[] = [];
    const conversionId = currentFileDocumentId;

    setFigures([]);

    const fetchFigures = async (retryCount = 0) => {
      if (!conversionId) return;

      try {
        const response = await authenticatedFetch(
          `/api/documents/${conversionId}/figures`,
          {}
        );

        if (isCancelled) return;

        if (!response.ok) {
          if (response.status === 404 && retryCount < 4) {
            const timeout = setTimeout(
              () => {
                if (!isCancelled) {
                  fetchFigures(retryCount + 1);
                }
              },
              (retryCount + 1) * 1000
            );
            retryTimeouts.push(timeout);
          }
          return;
        }

        const data = await response.json();
        if (isCancelled) return;
        setFigures(data.figures || []);
        console.log(
          `[EntityExtractionPage] Fetched ${data.figures?.length || 0} figures for PDF viewer`
        );
      } catch (err) {
        if (retryCount < 4) {
          const timeout = setTimeout(
            () => {
              if (!isCancelled) {
                fetchFigures(retryCount + 1);
              }
            },
            (retryCount + 1) * 1000
          );
          retryTimeouts.push(timeout);
          return;
        }
        console.error("Error fetching figures:", err);
      }
    };

    fetchFigures();

    return () => {
      isCancelled = true;
      retryTimeouts.forEach((timeout) => clearTimeout(timeout));
    };
  }, [currentFileDocumentId]);

  // Debug: Log figures when they change
  useEffect(() => {
    if (figures.length > 0) {
      console.log(
        "[EntityExtractionPage] Figures loaded for PDF viewer:",
        figures.map((f) => ({
          id: f.id,
          page: f.page,
          caption: f.caption?.substring(0, 50),
        }))
      );
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

      // Sync to backend if session active to ensure configuration is saved
      if (sessionIdRef.current) {
        updateSessionConfiguration(
          sessionIdRef.current,
          templateEntities,
          undefined,
          templateSummaryPrompt,
          "" // Default paragraph system prompt
        );
      }
    }
  }, [selectedStudyType, entities.length, currentFile]);

  // Auto-save prompts, entities, and model temperatures when they change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (sessionIdRef.current) {
        updateSessionConfiguration(
          sessionIdRef.current,
          entities,
          undefined,
          summaryPrompt,
          paragraphSystemPrompt
        );
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [summaryPrompt, paragraphSystemPrompt, entities, fileModelTemperatures]);

  const updateSessionConfiguration = async (
    sessionId: string,
    currentEntities: Entity[],
    overrideStudyType?: string,
    currentSummaryPrompt?: string,
    currentParagraphSystemPrompt?: string,
    status?: string
  ) => {
    try {
      const user = await import("../utils/authUtils").then((m) =>
        m.getCurrentUser()
      );
      const token = await import("../utils/authUtils").then((m) =>
        m.getValidToken()
      );
      if (!user || !token) return;

      // Use override, or selectedStudyType, or fallback to currentFile's studyType
      const studyTypeToSave =
        overrideStudyType !== undefined
          ? overrideStudyType
          : selectedStudyType || currentFile?.studyType || "";

      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: user.id,
          configuration: {
            study_type: studyTypeToSave,
            selected_models:
              availableModels.length > 0
                ? availableModels
                    .filter(
                      (m) =>
                        currentFile.selectedModels?.includes(m.id) ||
                        m.id === selectedModel
                    )
                    .map((m) => m.id)
                : (currentFile.selectedModels || [selectedModel]).filter(
                    Boolean
                  ),
            entities: currentEntities.map((e) => ({
              name: e.name,
              prompt: e.prompt,
              system_prompt: e.systemPrompt,
            })),
            summary_prompt:
              currentSummaryPrompt !== undefined
                ? currentSummaryPrompt
                : summaryPrompt,
            paragraph_system_prompt:
              currentParagraphSystemPrompt !== undefined
                ? currentParagraphSystemPrompt
                : paragraphSystemPrompt,
            temperature: temperature,
            model_temperatures: modelTemperatures,
            // Keep per-file config in sync
            files_config: {
              ...(documentData.uploadedFiles || []).reduce(
                (acc: any, f: any) => {
                  if (f.fileId === selectedFileId) {
                    acc[f.fileId] = {
                      study_type: studyTypeToSave,
                      entities: currentEntities.map((e) => ({
                        name: e.name,
                        prompt: e.prompt,
                        system_prompt: e.systemPrompt,
                      })),
                      summary_prompt:
                        currentSummaryPrompt !== undefined
                          ? currentSummaryPrompt
                          : summaryPrompt,
                      paragraph_system_prompt:
                        currentParagraphSystemPrompt !== undefined
                          ? currentParagraphSystemPrompt
                          : paragraphSystemPrompt,
                      model_temperatures: fileModelTemperatures[f.fileId] || {},
                    };
                  } else if (f.entities) {
                    // Preserve existing if available
                    acc[f.fileId] = {
                      study_type: f.studyType,
                      entities: f.entities.map((e: any) => ({
                        name: e.name,
                        prompt: e.prompt,
                        system_prompt: e.systemPrompt,
                      })),
                      summary_prompt: f.summaryPrompt,
                      paragraph_system_prompt: f.paragraphSystemPrompt,
                      model_temperatures: fileModelTemperatures[f.fileId] || {},
                    };
                  }
                  return acc;
                },
                {}
              ),
            },
          },
          status: status,
        }),
      });
    } catch (error) {
      console.error("Failed to sync session config:", error);
    }
  };

  const handleStudyTypeChange = (
    value: string,
    resolved?: ResolvedTemplate
  ) => {
    setSelectedStudyType(value);
    // Use resolved template from TemplatePicker or fall back to built-in loader
    const { entities: templateEntities, summaryPrompt: templateSummaryPrompt } =
      resolved ?? loadStudyTypeTemplate(value);
    setEntities(templateEntities);
    setSummaryPrompt(templateSummaryPrompt);
    setShowResults(false);
    // Reset extraction progress state for new study type
    setExtractingEntities(new Set());
    setCompletedEntities(new Set());
    setCurrentEntityIndex(0);

    // Update files state to persist changes locally when switching files
    setFiles((prev) =>
      prev.map((f) =>
        f.fileId === selectedFileId
          ? {
              ...f,
              studyType: value,
              entities: templateEntities,
              summaryPrompt: templateSummaryPrompt,
            }
          : f
      )
    );

    // Sync with backend if session active
    if (sessionIdRef.current) {
      updateSessionConfiguration(sessionIdRef.current, templateEntities, value);
    }
  };

  const addEntity = () => {
    const updated = [...entities, { name: "", prompt: "" }];
    setEntities(updated);

    // Update files state
    setFiles((prev) =>
      prev.map((f) =>
        f.fileId === selectedFileId ? { ...f, entities: updated } : f
      )
    );

    if (sessionIdRef.current) {
      updateSessionConfiguration(sessionIdRef.current, updated);
    }
  };

  const removeEntity = (index: number) => {
    const updated = entities.filter((_, i) => i !== index);
    setEntities(updated);

    setFiles((prev) =>
      prev.map((f) =>
        f.fileId === selectedFileId ? { ...f, entities: updated } : f
      )
    );

    if (sessionIdRef.current) {
      updateSessionConfiguration(sessionIdRef.current, updated);
    }

    // Entity list changed — downstream evaluation results are now stale
    onInvalidateDownstream?.();
  };

  const handleReferenceFocus = (entityIdx: number, refIdx: number) => {
    setFocusedReferenceByEntity((prev) => ({
      ...prev,
      [entityIdx]: refIdx,
    }));
    setFocusedReferenceTriggerByEntity((prev) => ({
      ...prev,
      [entityIdx]: (prev[entityIdx] ?? 0) + 1,
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

  // Helper for API call (single entity — used by per-entity re-run button)
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
    signal?: AbortSignal,
    sessionId?: string
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
        max_tokens: 8192,
        temperature: 0.0,
        processor_used: processorUsed,
        session_id: sessionId,
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
        cost: meta.cost ?? undefined,
      };
    }

    return {
      ...entity,
      extracted: "Error: Not found in response",
    };
  };

  // ── Batched extraction: ALL entities in ONE HTTP request per model ──────
  // Each entity still gets its own independent LLM call on the backend
  // (asyncio.gather inside /api/extract). We just avoid the browser's
  // 6-connection HTTP/1.1 bottleneck by packing them into fewer requests.
  const extractAllEntitiesForModelBatched = async (
    allEntities: Entity[],
    conversionId: string,
    modelId: string,
    processorUsed?: string,
    signal?: AbortSignal,
    sessionId?: string
  ): Promise<
    Record<
      string,
      {
        extracted: string;
        answer?: string;
        references?: Reference[];
        duration?: number;
        promptTokens?: number;
        completionTokens?: number;
        cost?: number;
      }
    >
  > => {
    const modelObj = availableModels.find((m) => m.id === modelId);
    if (!modelObj) {
      console.warn(`Model ${modelId} not found in available models`);
      return {};
    }

    // Map provider to backend model_type
    let modelType = "azure";
    const provider = modelObj.provider?.toLowerCase() || "";
    if (provider.includes("google") || provider.includes("gemini")) {
      modelType = "gemini";
    } else if (provider.includes("anthropic")) {
      modelType = "anthropic";
    } else if (provider.includes("azure")) {
      modelType = "azure";
    } else if (provider.includes("meta") || provider.includes("llama")) {
      modelType = modelObj.id?.startsWith("azure-") ? "azure-llama" : "llama";
    } else if (provider.includes("cohere")) {
      modelType = "cohere";
    } else if (provider.includes("macbook")) {
      modelType = "macbook";
    }

    console.log(
      `  📦 Batched extraction: ${allEntities.length} entities → 1 HTTP request for model ${modelObj.name}`
    );

    const resp = await authenticatedFetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversion_id: conversionId,
        model_type: modelType,
        model_id: modelObj.id,
        deployment: modelObj.deployment,
        api_version: modelObj.api_version,
        entities: allEntities.map((e) => ({
          name: e.name,
          prompt: e.prompt,
          system_prompt: e.systemPrompt || undefined,
        })),
        max_tokens: 8192,
        temperature: 0.0,
        processor_used: processorUsed,
        session_id: sessionId,
      }),
      signal,
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(
        errBody.detail || errBody.error || "Batched extraction request failed"
      );
    }

    const data = await resp.json();
    const extractedEntities = data.extracted_entities || [];

    // Build a map keyed by entity name
    const resultsByEntity: Record<string, any> = {};
    for (const extracted of extractedEntities) {
      const meta = extracted.meta || {};
      resultsByEntity[extracted.name] = {
        extracted: extracted.extracted,
        answer: extracted.answer || extracted.extracted,
        references: extracted.references || [],
        duration: meta.duration,
        promptTokens: meta.prompt_tokens,
        completionTokens: meta.completion_tokens,
        cost: meta.cost ?? undefined,
      };
    }

    return resultsByEntity;
  };

  // Internal helper to run extraction with multiple models
  const extractEntityWithModelsInternal = async (
    entity: Entity,
    conversionId: string,
    selectedModelIds: string[],
    processorUsed?: string,
    signal?: AbortSignal,
    sessionId?: string
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
        // Azure-hosted Llama has id "azure-{deployment}"; GCP Llama has id "meta/..."
        modelType = modelObj.id?.startsWith("azure-") ? "azure-llama" : "llama";
      } else if (provider.includes("cohere")) {
        modelType = "cohere";
      } else if (provider.includes("macbook")) {
        modelType = "macbook";
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
          signal,
          sessionId
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
          cost: result.cost ?? undefined,
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
          currentFileProcessorUsed,
          signal,
          sessionIdRef.current || undefined
        );

      // Use the currently selected model's result as the main display
      // If the selected model wasn't run (e.g. batch mode with different selection), fallback to first result
      const currentModelResult =
        extractionsByModel[selectedModel] || results[0]?.result;

      // Merge new results into existing extractionsByModel — do not discard
      // prior results for models that weren't re-run in this call.
      const mergedExtractionsByModel = {
        ...(entity.extractionsByModel || {}),
        ...extractionsByModel,
      };

      const updatedEntity = {
        ...entity,
        extractionsByModel: mergedExtractionsByModel,
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

  const handleRunSingleEntity = async (index: number) => {
    if (isExtracting || isRerunningFailed) return;

    const entity = entities[index];
    if (!entity.name || !entity.prompt) return;

    setIsExtracting(true);
    setShowResults(true);
    onInvalidateDownstream?.();
    // Don't reset all completed entities, just this one if it was completed
    setCompletedEntities((prev) => {
      const newSet = new Set(prev);
      newSet.delete(entity.name);
      return newSet;
    });

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      const conversionId = currentFileDocumentId;
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

      const allModels =
        preSelectedModels.length > 0 ? preSelectedModels : [selectedModel];

      // Only rerun models that failed or have no result for this entity.
      // If the entity looks healthy (deliberate re-run), use all models.
      const isEntityFailed =
        !entity.extracted || entity.extracted.startsWith("Error:") || entity.extracted === "No result";
      let modelsToUse = allModels;
      if (isEntityFailed) {
        const failedModels = allModels.filter((modelId: string) => {
          const result = entity.extractionsByModel?.[modelId];
          return !result?.extracted || result.extracted.startsWith("Error:") || result.extracted === "No result";
        });
        if (failedModels.length > 0) modelsToUse = failedModels;
      }

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

      // Save single entity result
      if (sessionIdRef.current) {
        saveExtractionResult(
          sessionIdRef.current,
          updatedEntity,
          currentFile.fileId
        );
      } else {
        // Try create session lazily
        const newId = await createSession();
        if (newId) {
          saveExtractionResult(newId, updatedEntity, currentFile.fileId);
        }
      }

      // Update parent state with the new entity
      // (removed legacy setDocumentData call)

      // Update files state — use functional updater to get latest prev state,
      // and use prev file's entity list to avoid stale closure over `entities`.
      setFiles((prev) =>
        prev.map((f) =>
          f.fileId === selectedFileId
            ? {
                ...f,
                entities: (f.entities || []).map((e: Entity, i: number) =>
                  i === index ? updatedEntity : e
                ),
              }
            : f
        )
      );

      // Sync documentData using functional updater form to avoid stale closure
      setDocumentData((prev) => ({
        ...prev,
        uploadedFiles: (prev.uploadedFiles || []).map((f) =>
          f.fileId === selectedFileId
            ? {
                ...f,
                entities: (f.entities || []).map((e: Entity, i: number) =>
                  i === index ? updatedEntity : e
                ),
              }
            : f
        ),
      }));
    } catch (err: any) {
      if (err.name !== "AbortError") {
        alert(`Extraction failed: ${err.message} `);
      }
    } finally {
      setIsExtracting(false);
      abortControllerRef.current = null;
    }
  };

  // Rerun all failed or not-yet-extracted entities for the current file.
  // "Failed" = entity.extracted starts with "Error:" or is missing.
  // Uses all pre-selected models (same as the original extraction run).
  // Progress is surfaced via rerunFailedProgress state.
  const handleRerunFailedEntities = async () => {
    if (isExtracting || isBatchRunning || isRerunningFailed) return;

    const conversionId = currentFileDocumentId;
    if (!conversionId) {
      alert("No conversion ID available. Please process a document first.");
      return;
    }

    const preSelectedModels =
      currentFile?.selectedModels || documentData.selectedModels || [];
    const modelsToUse =
      preSelectedModels.length > 0 ? preSelectedModels : [selectedModel];

    // An entity needs rerun if ANY selected model has a failure or no result.
    const failedEntities = entities.filter((e) =>
      modelsToUse.some((modelId: string) => {
        const result = e.extractionsByModel?.[modelId];
        return !result?.extracted || result.extracted.startsWith("Error:") || result.extracted === "No result";
      })
    );

    if (failedEntities.length === 0) return;

    const processorUsed = currentFileProcessorUsed;

    // Ensure we have a session
    if (!sessionIdRef.current) {
      await createSession();
    }

    setIsRerunningFailed(true);
    onInvalidateDownstream?.();
    setRerunFailedProgress({ completed: 0, total: failedEntities.length });

    // Clear error state from failed entities so they show as extracting
    setExtractingEntities(
      (prev) => new Set([...prev, ...failedEntities.map((e) => e.name)])
    );

    console.log(
      `[RerunFailed] Rerunning ${failedEntities.length} failed/missing entities with ${modelsToUse.length} model(s)`
    );

    try {
      // Use the batched approach: send all failed entities per model in one request
      // (same pattern as processFile for cloud models)
      const modelResults: Array<{
        modelId: string;
        resultsByEntity: Record<string, any>;
        success: boolean;
      }> = [];

      const macbookModels = modelsToUse.filter((mId: string) => {
        const mObj = availableModels.find((m) => m.id === mId);
        return mObj?.provider?.toLowerCase().includes("macbook");
      });
      const cloudModels = modelsToUse.filter(
        (mId: string) => !macbookModels.includes(mId)
      );

      // Cloud models: run only the entities that failed for each specific model
      if (cloudModels.length > 0) {
        const cloudResults = await Promise.all(
          cloudModels.map(async (modelId: string) => {
            const entitiesForModel = failedEntities.filter((e) => {
              const result = e.extractionsByModel?.[modelId];
              return (
                !result?.extracted || result.extracted.startsWith("Error:") || result.extracted === "No result"
              );
            });
            if (entitiesForModel.length === 0) {
              return { modelId, resultsByEntity: {}, success: true };
            }
            try {
              const resultsByEntity = await extractAllEntitiesForModelBatched(
                entitiesForModel,
                conversionId,
                modelId,
                processorUsed,
                undefined,
                sessionIdRef.current || undefined
              );
              return { modelId, resultsByEntity, success: true };
            } catch (err) {
              console.error(`[RerunFailed] Model ${modelId} failed:`, err);
              return { modelId, resultsByEntity: {}, success: false };
            }
          })
        );
        modelResults.push(...cloudResults);
      }

      // Macbook models: sequential, only entities that failed for this model
      for (const modelId of macbookModels) {
        const modelObj = availableModels.find((m) => m.id === modelId);
        const resultsByEntity: Record<string, any> = {};
        const entitiesForModel = failedEntities.filter((e) => {
          const result = e.extractionsByModel?.[modelId];
          return !result?.extracted || result.extracted.startsWith("Error:") || result.extracted === "No result";
        });
        for (const entity of entitiesForModel) {
          try {
            const modelConfig = {
              modelType: "macbook" as string,
              modelId: modelObj?.id,
              deployment: modelObj?.deployment,
              apiVersion: modelObj?.api_version,
            };
            const singleResult = await extractEntityFromApi(
              entity,
              conversionId,
              modelConfig,
              processorUsed,
              undefined,
              sessionIdRef.current || undefined
            );
            resultsByEntity[entity.name] = {
              extracted: singleResult.extracted,
              answer: singleResult.answer || singleResult.extracted,
              references: singleResult.references || [],
              duration: singleResult.duration,
              promptTokens: singleResult.promptTokens,
              completionTokens: singleResult.completionTokens,
              cost: singleResult.cost ?? undefined,
            };
          } catch (err) {
            const errText = `Error: ${err instanceof Error ? err.message : String(err)}`;
            resultsByEntity[entity.name] = { extracted: errText };
          }
        }
        modelResults.push({ modelId, resultsByEntity, success: true });
      }

      // Merge results back into entities — compute updated list once, apply to both setters
      let completed = 0;
      const mergedEntities = entities.map((entity) => {
        const wasFailed =
          !entity.extracted || entity.extracted.startsWith("Error:") || entity.extracted === "No result";
        if (!wasFailed) return entity;

        const newExtractionsByModel: Record<string, any> = {
          ...(entity.extractionsByModel || {}),
        };

        for (const { modelId, resultsByEntity, success } of modelResults) {
          if (!success) continue;
          const entityResult = resultsByEntity[entity.name];
          if (entityResult) {
            newExtractionsByModel[modelId] = entityResult;
          }
        }

        // Pick primary model's result for display
        const primaryData =
          newExtractionsByModel[selectedModel] ||
          Object.values(newExtractionsByModel)[0];

        completed++;

        return {
          ...entity,
          extractionsByModel: newExtractionsByModel,
          extracted: primaryData?.extracted || "No result",
          answer: primaryData?.answer,
          references: primaryData?.references || [],
          duration: primaryData?.duration,
          promptTokens: primaryData?.promptTokens,
          completionTokens: primaryData?.completionTokens,
          cost: primaryData?.cost,
        };
      });

      setRerunFailedProgress({ completed, total: failedEntities.length });
      setEntities(mergedEntities);

      // Sync files state so the parent documentData stays consistent
      setFiles((prev) =>
        prev.map((f) =>
          f.fileId === selectedFileId ? { ...f, entities: mergedEntities } : f
        )
      );

      // Sync documentData so downstream pages (e.g. eval page) see updated entities
      setDocumentData((prev) => ({
        ...prev,
        uploadedFiles: (prev.uploadedFiles || []).map((f) =>
          f.fileId === selectedFileId ? { ...f, entities: mergedEntities } : f
        ),
      }));

      console.log(
        `[RerunFailed] Done — ${completed}/${failedEntities.length} entities updated`
      );
    } catch (err) {
      console.error("[RerunFailed] Unexpected error:", err);
    } finally {
      setIsRerunningFailed(false);
      setRerunFailedProgress(null);
      setExtractingEntities((prev) => {
        const next = new Set(prev);
        failedEntities.forEach((e) => next.delete(e.name));
        return next;
      });
    }
  };

  // Helper: determine model_type from provider string
  // modelId is used to distinguish Azure-hosted Llama ("azure-llama") from GCP Llama ("llama")
  const getModelType = (providerStr: string, modelId?: string): string => {
    const p = providerStr.toLowerCase();
    if (p.includes("google") || p.includes("gemini")) return "gemini";
    if (p.includes("anthropic")) return "anthropic";
    if (p.includes("meta") || p.includes("llama"))
      return modelId?.startsWith("azure-") ? "azure-llama" : "llama";
    if (p.includes("cohere")) return "cohere";
    if (p.includes("macbook")) return "macbook";
    return "azure";
  };

  // Generate paragraph for a SINGLE model (used for Regenerate when user changes temp/prompt)
  const generateSummaryForModel = async (modelId: string) => {
    const modelObj = availableModels.find((m) => m.id === modelId);
    if (!modelObj) throw new Error(`Model ${modelId} not found`);

    const modelTypeToUse = getModelType(modelObj.provider || "", modelObj.id);

    // Use per-model entity results if available
    const modelEntities = entities.map((e) => {
      if (e.extractionsByModel?.[modelId]) {
        return { ...e, extracted: e.extractionsByModel[modelId].extracted };
      }
      return e;
    });

    console.log(
      `[Paragraph Generation] Model: ${modelObj.name} (${modelId}), type: ${modelTypeToUse}`
    );

    const resp = await authenticatedFetch("/api/generate_paragraph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entities: modelEntities,
        summary_prompt: summaryPrompt.includes("{{entities}}")
          ? summaryPrompt
          : `${summaryPrompt}\n\n{{entities}}`,
        system_prompt: paragraphSystemPrompt || undefined,
        model_type: modelTypeToUse,
        model_id: modelObj.id,
        deployment: modelObj.deployment,
        api_version: modelObj.api_version,
        temperature:
          modelObj.supports_temperature !== false
            ? getModelTemperature(modelId)
            : undefined,
        session_id: sessionIdRef.current,
        file_hash: currentFile?.fileId,
      }),
    });

    if (!resp.ok) throw new Error("Summary generation failed");
    const data = await resp.json();
    return {
      summary: data.summary as string,
      cost: data.meta?.cost as number | undefined,
    };
  };

  // Generate paragraphs for ALL selected models that don't have one yet
  // Helper: update files & documentData with a single model's paragraph result
  const updateParagraphForModel = (
    fileId: string,
    modelId: string,
    summary: string,
    cost?: number
  ) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.fileId === fileId
          ? {
              ...f,
              finalSummary: f.finalSummary || summary,
              summariesByModel: {
                ...(f.summariesByModel || {}),
                [modelId]: summary,
              },
              ...(cost != null && {
                paragraphSummaryCost: (f.paragraphSummaryCost || 0) + cost,
              }),
            }
          : f
      )
    );
    setDocumentData((prev) => ({
      ...prev,
      uploadedFiles: prev.uploadedFiles?.map((f) =>
        f.fileId === fileId
          ? {
              ...f,
              finalSummary: f.finalSummary || summary,
              summariesByModel: {
                ...(f.summariesByModel || {}),
                [modelId]: summary,
              },
              ...(cost != null && {
                paragraphSummaryCost: (f.paragraphSummaryCost || 0) + cost,
              }),
            }
          : f
      ),
    }));
  };

  // Generate paragraphs for all models — each result shows immediately as it arrives
  // If forceModelIds is provided, regenerate only those (even if they already have a summary)
  const generateParagraphsForAllModels = async (forceModelIds?: string[]) => {
    setIsGeneratingParagraph(true);
    try {
      const preSelectedModels =
        currentFile?.selectedModels || documentData.selectedModels || [];
      const allModelIds =
        preSelectedModels.length > 0 ? preSelectedModels : [selectedModel];

      // Determine which models need paragraphs
      const existingSummaries = currentFile?.summariesByModel || {};
      const modelsToGenerate = forceModelIds
        ? forceModelIds
        : allModelIds.filter((id: string) => !existingSummaries[id]);

      if (modelsToGenerate.length === 0) {
        console.log(
          "[Paragraph Generation] All models already have paragraphs"
        );
        return;
      }

      console.log(
        `[Paragraph Generation] Generating for ${modelsToGenerate.length} models: ${modelsToGenerate.join(", ")}`
      );

      const fileId = selectedFileId;

      // Fire all requests concurrently, but update UI as each one completes
      const promises = modelsToGenerate.map(async (modelId: string) => {
        try {
          const { summary, cost } = await generateSummaryForModel(modelId);
          console.log(
            `✅ Paragraph generated for ${availableModels.find((m) => m.id === modelId)?.name || modelId}`
          );
          // Immediately show this model's result in the UI
          updateParagraphForModel(fileId, modelId, summary, cost);
          return { modelId, success: true };
        } catch (err) {
          console.error(`Failed to generate paragraph for ${modelId}:`, err);
          return { modelId, success: false };
        }
      });

      // Wait for all to settle (UI already updated incrementally)
      await Promise.all(promises);

      // Persist config once at the end
      if (sessionIdRef.current) {
        await updateSessionConfiguration(
          sessionIdRef.current,
          entities,
          undefined,
          summaryPrompt,
          paragraphSystemPrompt
        );
      }
    } catch (err) {
      console.error("Paragraph generation error:", err);
    } finally {
      setIsGeneratingParagraph(false);
    }
  };

  // Regenerate paragraph for the currently selected model only (user changed temp/prompt)
  const regenerateSummaryForCurrentModel = async () => {
    setIsGeneratingParagraph(true);
    try {
      const { summary } = await generateSummaryForModel(selectedModel);
      const summaryModelId = selectedModel;

      if (sessionIdRef.current) {
        await updateSessionConfiguration(
          sessionIdRef.current,
          entities,
          undefined,
          summaryPrompt,
          paragraphSystemPrompt
          // Do NOT pass "completed" - status only changes after evaluation
        );
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.fileId === selectedFileId
            ? {
                ...f,
                finalSummary: summary,
                summaryPrompt,
                paragraphSystemPrompt,
              }
            : f
        )
      );
      setDocumentData((prev) => ({
        ...prev,
        uploadedFiles: prev.uploadedFiles?.map((f) =>
          f.fileId === selectedFileId
            ? {
                ...f,
                finalSummary: summary,
                summaryPrompt,
                paragraphSystemPrompt,
              }
            : f
        ),
      }));

      // Auto-generate paragraph evaluation ground truth in background
      const entityOrder = entities.map((e: any) => e.name);
      triggerParagraphEvalGeneration(
        currentFile?.fileId || selectedFileId,
        entityOrder,
        summaryModelId || ""
      );
    } catch (err) {
      console.error("Summary regeneration error:", err);
      alert("Failed to regenerate summary");
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
      // Check if the current model already has a paragraph
      const hasCurrentModelSummary =
        currentFile?.summariesByModel?.[selectedModel];
      if (hasCurrentModelSummary) {
        // User explicitly wants to regenerate (changed temp/prompt)
        regenerateSummaryForCurrentModel();
      } else {
        // Generate paragraphs for all models that are missing
        generateParagraphsForAllModels();
      }
    } else {
      // Run only missing entities (or all if none extracted)
      handleRunSummarization(false);
    }
  };

  const handleRunSummarization = async (rerunAll = true) => {
    setShowRerunDialog(false);
    setIsExtracting(true);
    setShowResults(true);

    // Re-running extraction invalidates evaluation results
    onInvalidateDownstream?.();

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
      const conversionId = currentFileDocumentId;
      if (!conversionId) {
        throw new Error(
          "No conversion ID available. Please run document processing first so the markdown is available."
        );
      }

      // Create session if not exists
      if (!sessionIdRef.current) {
        await createSession();
      }
      const activeSessionId = sessionIdRef.current;

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

            // Save result to session if we have one
            if (activeSessionId) {
              saveExtractionResult(
                activeSessionId,
                updatedEntity,
                currentFile.fileId
              );
            }
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
        "\n✅ All entities extracted! Generating paragraph summaries for all models...\n"
      );

      // Set state to show we're generating the paragraph and allow UI to update
      setIsGeneratingParagraph(true);

      // Small delay to ensure UI updates before the API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (selectedFileIdRef.current === currentFile.fileId) {
        setEntities(updatedEntities);
      }

      // Update the current file's entities immediately (before paragraph generation)
      setFiles((prev) =>
        prev.map((f) =>
          f.fileId === currentFile.fileId
            ? { ...f, entities: updatedEntities }
            : f
        )
      );
      setDocumentData((prev) => ({
        ...prev,
        uploadedFiles: (prev.uploadedFiles || []).map((f) =>
          f.fileId === currentFile.fileId
            ? { ...f, entities: updatedEntities }
            : f
        ),
      }));
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Summarization aborted");
        // Save partial results with all current state
        setFiles((prev) =>
          prev.map((f) =>
            f.fileId === currentFile.fileId
              ? { ...f, entities: updatedEntities }
              : f
          )
        );

        setDocumentData((prev) => ({
          ...prev,
          uploadedFiles: (prev.uploadedFiles || []).map((f) =>
            f.fileId === currentFile.fileId
              ? { ...f, entities: updatedEntities }
              : f
          ),
        }));
      } else {
        console.error("Extraction error:", err);
        alert(`Extraction failed: ${err.message} `);

        // Save partial results even on error
        setFiles((prev) =>
          prev.map((f) =>
            f.fileId === currentFile.fileId
              ? { ...f, entities: updatedEntities }
              : f
          )
        );

        setDocumentData((prev) => ({
          ...prev,
          uploadedFiles: (prev.uploadedFiles || []).map((f) =>
            f.fileId === currentFile.fileId
              ? { ...f, entities: updatedEntities }
              : f
          ),
        }));
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
      // Use current file data for export, merged with documentData for parser/studyType
      const fileData = {
        ...documentData,
        ...currentFile,
        entities: currentFile.entities,
        finalSummary: currentFile.finalSummary,
        fileId: currentFile.fileId,
      };

      // Pass model-specific options so the export shows the correct model's results
      const exportOptions: EntityExportOptions = {
        selectedModel,
        summaryPrompt,
        paragraphSystemPrompt,
      };

      const wordBlob = await generateWordDocument(fileData, exportOptions);
      const fileName = `summary-report-${currentFile.file?.name || "document"}.docx`;
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

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
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
        {onNavigateForward &&
          !isExtracting &&
          !isGeneratingParagraph &&
          !isBatchRunning && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNavigateForward}
              className="border-green-600 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
            >
              Continue to Evaluation
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
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
                    status?.status === "completed" ||
                    (!!file.finalSummary &&
                      !isProcessing &&
                      !isGeneratingSummary);
                  const isError = status?.status === "error";

                  return (
                    <div className="flex flex-col items-start text-left">
                      <span className="font-medium truncate w-full">
                        {file.file.name}
                      </span>
                      {isProcessing ? (
                        <div className="flex flex-col">
                          <span className="text-xs text-blue-500 animate-pulse">
                            Processing Entity {status?.currentEntityIndex || 0}/
                            {status?.totalEntities || 0}
                            {status?.currentEntityName
                              ? ` — ${status.currentEntityName}`
                              : ""}
                            ...
                          </span>
                          {status?.statusMessage && (
                            <span className="text-xs text-amber-500 animate-pulse">
                              {status.statusMessage}
                            </span>
                          )}
                        </div>
                      ) : isGeneratingSummary ? (
                        <div className="flex flex-col">
                          <span className="text-xs text-purple-600 animate-pulse">
                            Generating Summary...
                          </span>
                          {status?.statusMessage && (
                            <span className="text-xs text-amber-500 animate-pulse">
                              {status.statusMessage}
                            </span>
                          )}
                        </div>
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
                const fileStatus = fileProcessingStatus[file.fileId]?.status;
                const isProcessing = fileStatus === "processing";
                const isGenerating = fileStatus === "generating_summary";
                const isCompleted =
                  fileStatus === "completed" ||
                  (!!file.finalSummary && !isProcessing && !isGenerating);

                return (
                  <SelectItem key={file.fileId} value={file.fileId}>
                    <div className="flex items-center gap-2">
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
                      ) : isGenerating ? (
                        <Sparkles className="h-4 w-4 text-purple-500 animate-spin flex-shrink-0" />
                      ) : isCompleted ? (
                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : fileStatus === "error" ? (
                        <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                      ) : (
                        <Clock className="h-4 w-4 text-gray-300 flex-shrink-0" />
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="truncate max-w-[300px] font-medium">
                          {file.file?.name || "Document"}
                        </span>
                        {isProcessing ? (
                          <div className="flex flex-col">
                            <span className="text-xs text-blue-600">
                              Processing Entity{" "}
                              {fileProcessingStatus[file.fileId]
                                ?.currentEntityIndex || 0}
                              /
                              {fileProcessingStatus[file.fileId]
                                ?.totalEntities || 0}
                              ...
                            </span>
                            {fileProcessingStatus[file.fileId]
                              ?.statusMessage && (
                              <span className="text-xs text-amber-500">
                                {
                                  fileProcessingStatus[file.fileId]
                                    ?.statusMessage
                                }
                              </span>
                            )}
                          </div>
                        ) : isGenerating ? (
                          <div className="flex flex-col">
                            <span className="text-xs text-purple-600 animate-pulse">
                              Generating Summary...
                            </span>
                            {fileProcessingStatus[file.fileId]
                              ?.statusMessage && (
                              <span className="text-xs text-amber-500">
                                {
                                  fileProcessingStatus[file.fileId]
                                    ?.statusMessage
                                }
                              </span>
                            )}
                          </div>
                        ) : isCompleted ? (
                          <span className="text-xs text-green-600">
                            Completed
                          </span>
                        ) : fileStatus === "error" ? (
                          <span className="text-xs text-red-600">Error</span>
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
              <CardTitle>Template</CardTitle>
              <CardDescription>
                Active extraction template — change to load a different set of
                entities
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplatePicker
                value={selectedStudyType}
                onSelect={(id, resolved) => handleStudyTypeChange(id, resolved)}
                triggerClassName="w-full"
                placeholder="Select a template"
              />
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
                  <div className="flex items-center gap-2">
                    {(() => {
                      const failedCount = entities.filter(
                        (e) => !e.extracted || e.extracted.startsWith("Error:")
                      ).length;
                      if (failedCount === 0) return null;
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRerunFailedEntities}
                          disabled={
                            isExtracting ||
                            isBatchRunning ||
                            isRerunningFailed ||
                            !selectedModel ||
                            availableModels.length === 0
                          }
                          className="border-red-300 text-red-700 hover:bg-red-50 hover:border-red-400"
                          title={`Rerun ${failedCount} failed or missing extraction${failedCount !== 1 ? "s" : ""}`}
                        >
                          {isRerunningFailed ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              {rerunFailedProgress
                                ? `${rerunFailedProgress.completed}/${rerunFailedProgress.total}`
                                : "Rerunning..."}
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Rerun Failed ({failedCount})
                            </>
                          )}
                        </Button>
                      );
                    })()}
                    <Button variant="outline" size="sm" onClick={addEntity}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Entity
                    </Button>
                  </div>
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
                  // Named isThisEntityExtracting to avoid shadowing the outer isExtracting state
                  const isThisEntityExtracting = isProcessingThisFile
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
                        isThisEntityExtracting
                          ? "border-blue-300 bg-blue-50/40 shadow-md"
                          : isCompleted
                            ? "border-emerald-200 bg-emerald-50/30"
                            : entity.extracted?.startsWith("Error:")
                              ? "border-red-200 bg-red-50/20"
                              : "border-gray-200 bg-white"
                      } `}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-gray-200 bg-gradient-to-r from-gray-50 to-white px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-blue-900">
                            Entity {index + 1}
                          </span>
                          {isThisEntityExtracting && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              <Sparkles className="h-3.5 w-3.5 animate-spin" />
                              {fileProcessingStatus[selectedFileId]
                                ?.statusMessage
                                ? "Retrying..."
                                : "Extracting"}
                            </span>
                          )}
                          {isCompleted && !isThisEntityExtracting && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              <CheckCircle className="h-3.5 w-3.5" />
                              Completed
                            </span>
                          )}
                          {entity.extracted?.startsWith("Error:") &&
                            !isThisEntityExtracting &&
                            !isCompleted && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Failed
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
                              disabled={
                                isThisEntityExtracting ||
                                isExtracting ||
                                isBatchRunning
                              }
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-2 hover:bg-blue-50 ${
                              entity.extracted?.startsWith("Error:")
                                ? "text-red-600 hover:text-red-800"
                                : "text-blue-600 hover:text-blue-800"
                            }`}
                            onClick={() => handleRunSingleEntity(index)}
                            disabled={
                              isExtracting ||
                              isBatchRunning ||
                              isRerunningFailed ||
                              !entity.name ||
                              !entity.prompt ||
                              !selectedModel
                            }
                            title={
                              entity.extracted?.startsWith("Error:")
                                ? "Rerun failed extraction"
                                : entity.extracted
                                  ? "Re-run this entity"
                                  : "Run this entity"
                            }
                          >
                            {isThisEntityExtracting ? (
                              <Sparkles className="h-3.5 w-3.5 animate-spin" />
                            ) : entity.extracted?.startsWith("Error:") ? (
                              <RefreshCw className="h-3.5 w-3.5" />
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
                                <div className="bg-gradient-to-br from-gray-50 to-blue-50 p-3 rounded-lg border border-gray-100 mt-3">
                                  <MarkdownViewer
                                    content={
                                      entity.answer || entity.extracted || ""
                                    }
                                  />
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

                                    {(entity.duration != null ||
                                      entity.promptTokens != null ||
                                      entity.completionTokens != null) && (
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
                                              {entity.duration != null
                                                ? entity.duration.toFixed(2)
                                                : "-"}
                                              s
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
                            {currentFile?.fileId && currentFileDocumentId ? (
                              <div id={`pdf-viewer-${index}`}>
                                <EntityPDFViewerBeta
                                  key={`${currentFile.fileId}-${index}`}
                                  fileId={currentFile.fileId}
                                  conversionId={currentFileDocumentId}
                                  processorUsed={currentFileProcessorUsed}
                                  references={entity.references || []}
                                  focusedReferenceIndex={
                                    focusedReferenceByEntity[index] ?? null
                                  }
                                  focusedReferenceTrigger={
                                    focusedReferenceTriggerByEntity[index] ?? 0
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

                    {/* Temperature control */}
                    {(() => {
                      const modelObj = availableModels.find(
                        (m) => m.id === selectedModel
                      );
                      const supportsTemp =
                        modelObj?.supports_temperature ?? true;
                      const defaultTemp = modelObj?.default_temperature ?? 0.5;
                      return (
                        <div
                          className={`space-y-3 rounded-lg border p-3 ${supportsTemp ? "border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50/50"}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Label className="text-sm font-medium">
                                Temperature
                              </Label>
                              <div className="relative group">
                                <Info className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none w-56">
                                  <p className="font-medium mb-1">
                                    What is Temperature?
                                  </p>
                                  <p>
                                    Controls the randomness of the AI output.
                                    Lower values (closer to 0) produce more
                                    focused, deterministic text. Higher values
                                    (closer to 1) produce more creative, varied
                                    text.
                                  </p>
                                  <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-gray-900"></div>
                                </div>
                              </div>
                            </div>
                            <span className="text-sm font-mono tabular-nums text-muted-foreground">
                              {supportsTemp
                                ? temperature.toFixed(2)
                                : defaultTemp.toFixed(2)}
                            </span>
                          </div>
                          {supportsTemp ? (
                            <>
                              <Slider
                                value={[temperature]}
                                onValueChange={([v]) => setTemperature(v)}
                                min={0}
                                max={1}
                                step={0.01}
                                className="w-full"
                              />
                              <div className="flex justify-between text-[10px] text-muted-foreground -mt-1">
                                <span>Precise</span>
                                <span>Creative</span>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-start gap-2 rounded-md bg-amber-100/60 border border-amber-200 px-3 py-2">
                              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                              <p className="text-xs text-amber-800">
                                The selected model (
                                <span className="font-medium">
                                  {modelObj?.name}
                                </span>
                                ) does not support temperature adjustment. It
                                uses a fixed temperature of{" "}
                                {defaultTemp.toFixed(2)}.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

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
                              {(() => {
                                const allExtracted = entities.every(
                                  (e) =>
                                    e.extracted &&
                                    !e.extracted.startsWith("Error:")
                                );
                                if (!allExtracted)
                                  return "Run Entity Extraction & Generate Paragraph";
                                const hasCurrentSummary =
                                  currentFile?.summariesByModel?.[
                                    selectedModel
                                  ];
                                if (hasCurrentSummary)
                                  return `Regenerate Paragraph with ${availableModels.find((m) => m.id === selectedModel)?.name || selectedModel}`;
                                return "Generate Paragraphs for All Models";
                              })()}
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
                                                <div className="text-gray-800 p-4 rounded border border-gray-200 bg-white">
                                                  <MarkdownViewer
                                                    content={
                                                      result.answer ||
                                                      result.extracted ||
                                                      ""
                                                    }
                                                  />
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
                                          <div className="text-gray-800 p-4 rounded border border-gray-200 bg-white">
                                            <MarkdownViewer
                                              content={
                                                entity.answer ||
                                                entity.extracted ||
                                                ""
                                              }
                                            />
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
                    <div className="max-h-[60vh] overflow-y-auto pr-2">
                      {(() => {
                        // Show per-model summary if available, fallback to global finalSummary
                        const perModelSummary =
                          currentFile.summariesByModel?.[selectedModel];
                        const displaySummary =
                          perModelSummary || currentFile.finalSummary;
                        const modelName =
                          availableModels.find((m) => m.id === selectedModel)
                            ?.name || selectedModel;

                        if (displaySummary) {
                          return (
                            <div>
                              {currentFile.summariesByModel &&
                                Object.keys(currentFile.summariesByModel)
                                  .length > 0 && (
                                  <div className="mb-3 flex items-center gap-2">
                                    <span className="text-xs font-medium text-muted-foreground">
                                      Generated by:
                                    </span>
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                      {perModelSummary
                                        ? modelName
                                        : availableModels.find(
                                            (m) =>
                                              m.id ===
                                              Object.keys(
                                                currentFile.summariesByModel
                                              )[0]
                                          )?.name ||
                                          Object.keys(
                                            currentFile.summariesByModel
                                          )[0] ||
                                          "Unknown"}
                                    </span>
                                    {!perModelSummary &&
                                      currentFile.finalSummary && (
                                        <span className="text-xs text-amber-600 italic">
                                          (No summary for {modelName} yet —
                                          showing last generated)
                                        </span>
                                      )}
                                  </div>
                                )}
                              <MarkdownViewer content={displaySummary} />
                            </div>
                          );
                        } else if (
                          isGeneratingParagraph ||
                          fileProcessingStatus[selectedFileId]?.status ===
                            "generating_summary"
                        ) {
                          return (
                            <div className="flex flex-col items-center justify-center h-full text-purple-600 animate-pulse">
                              <Sparkles className="h-8 w-8 mb-2 animate-spin" />
                              <p className="font-medium">
                                Generating Summary...
                              </p>
                              <p className="text-xs text-purple-400 mt-1">
                                Synthesizing extracted entities...
                              </p>
                            </div>
                          );
                        } else {
                          return (
                            <div className="flex items-center justify-center h-full text-muted-foreground">
                              <p>
                                Paragraph summary will appear here after
                                generation...
                              </p>
                            </div>
                          );
                        }
                      })()}
                    </div>
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
                        uploadedFiles: files,
                        studyType: selectedStudyType,
                        selectedModel: selectedModel,
                        entities: entities,
                        summaryPrompt: summaryPrompt,
                      })
                    }
                    variant="default"
                    size="lg"
                    disabled={(() => {
                      // All files must be fully completed (entities extracted + all summaries generated)
                      const anyStillProcessing = files.some((f) => {
                        const fStatus = fileProcessingStatus[f.fileId]?.status;
                        return (
                          fStatus === "processing" ||
                          fStatus === "generating_summary" ||
                          fStatus === "queued"
                        );
                      });
                      // Also check that every file with entities has at least one summary
                      const allHaveSummaries = files.every(
                        (f) =>
                          !f.entities?.length ||
                          f.finalSummary ||
                          (f.summariesByModel &&
                            Object.keys(f.summariesByModel).length > 0)
                      );
                      return anyStillProcessing || !allHaveSummaries;
                    })()}
                    className="w-full bg-green-600 hover:bg-green-700 h-14 text-lg shadow-lg disabled:opacity-50"
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
