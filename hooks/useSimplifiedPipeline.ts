import { useState, useCallback, useRef } from "react";
import { getValidToken } from "../utils/authUtils";
import {
  selectBestModel,
  modelConfigToSelection,
  ModelConfig,
  ModelSelectionResult,
} from "../utils/modelSelection";
import {
  generateWordDocument,
  downloadFile,
  EntityExportOptions,
} from "../components/ExportUtils";
import { DocumentData } from "../App";

export type FileStage =
  | "queued"
  | "uploading"
  | "processing"
  | "extracting"
  | "summarizing"
  | "exporting"
  | "complete"
  | "error";

export interface FileProgress {
  fileName: string;
  stage: FileStage;
  entityIndex: number;
  totalEntities: number;
  error?: string;
}

export interface ExtractedEntity {
  name: string;
  extracted: string;
}

export interface FileResult {
  fileName: string;
  summary: string;
  entities: ExtractedEntity[];
  docData: DocumentData;
  exportOptions: EntityExportOptions;
}

export interface PipelineOptions {
  processor?: string;
  modelOverride?: ModelConfig | null;
}

export interface PipelineState {
  running: boolean;
  fileProgress: FileProgress[];
  completedCount: number;
  totalFiles: number;
  error?: string;
}

const STAGE_LABEL: Record<FileStage, string> = {
  queued: "Queued",
  uploading: "Uploading",
  processing: "Processing document",
  extracting: "Extracting entities",
  summarizing: "Generating summary",
  exporting: "Creating report",
  complete: "Complete",
  error: "Error",
};

export { STAGE_LABEL };

export function useSimplifiedPipeline() {
  const [state, setState] = useState<PipelineState>({
    running: false,
    fileProgress: [],
    completedCount: 0,
    totalFiles: 0,
  });

  const [results, setResults] = useState<FileResult[]>([]);
  const abortRef = useRef(false);

  const updateFile = useCallback(
    (index: number, update: Partial<FileProgress>) => {
      setState((prev) => {
        const next = [...prev.fileProgress];
        next[index] = { ...next[index], ...update };
        const completedCount = next.filter(
          (f) => f.stage === "complete" || f.stage === "error"
        ).length;
        return { ...prev, fileProgress: next, completedCount };
      });
    },
    []
  );

  const processOneFile = useCallback(
    async (
      file: File,
      fileIndex: number,
      token: string,
      bestModel: ModelSelectionResult,
      processorOverride: string,
      studyType: string,
      templateEntities: Array<{ name: string; prompt: string }>,
      summaryPrompt: string
    ): Promise<FileResult> => {
      const fileHash = await uploadFile(file, fileIndex, token, updateFile);
      if (abortRef.current) throw new Error("Cancelled");

      updateFile(fileIndex, { stage: "processing" });
      const processorUsed = await processDocument(
        fileHash,
        processorOverride,
        token
      );
      if (abortRef.current) throw new Error("Cancelled");

      updateFile(fileIndex, {
        stage: "extracting",
        entityIndex: 0,
        totalEntities: templateEntities.length,
      });
      const extractedEntities = await extractAllEntities(
        fileHash,
        templateEntities,
        bestModel,
        processorUsed,
        token,
        fileIndex,
        updateFile,
        abortRef
      );

      updateFile(fileIndex, { stage: "summarizing" });
      const finalSummary = await generateSummary(
        extractedEntities,
        summaryPrompt,
        bestModel,
        token
      );
      if (abortRef.current) throw new Error("Cancelled");

      updateFile(fileIndex, { stage: "complete" });

      const studyTypeId =
        studyType === "epidemiology"
          ? "level-1-epidemiology"
          : studyType === "toxicology"
            ? "level-1-in-vivo"
            : studyType;

      const docData: DocumentData = {
        file,
        fileId: fileHash,
        parser: processorUsed,
        extractedText: "",
        annotatedOutput: "",
        studyType: studyTypeId,
        selectedModel: bestModel.modelId,
        entities: extractedEntities,
        finalSummary,
        processorUsed,
      };

      const exportOptions: EntityExportOptions = {
        selectedModel: bestModel.modelId,
        summaryPrompt,
      };

      return {
        fileName: file.name,
        summary: finalSummary,
        entities: extractedEntities.map((e) => ({
          name: e.name,
          extracted: e.extracted,
        })),
        docData,
        exportOptions,
      };
    },
    [updateFile]
  );

  const run = useCallback(
    async (
      files: File[],
      studyType: string,
      templateEntities: Array<{ name: string; prompt: string }>,
      summaryPrompt: string,
      options?: PipelineOptions
    ) => {
      abortRef.current = false;
      setResults([]);

      const initialProgress: FileProgress[] = files.map((f) => ({
        fileName: f.name,
        stage: "queued" as FileStage,
        entityIndex: 0,
        totalEntities: templateEntities.length,
      }));

      setState({
        running: true,
        fileProgress: initialProgress,
        completedCount: 0,
        totalFiles: files.length,
      });

      try {
        const token = await getValidToken();
        if (!token) throw new Error("Not authenticated");

        let bestModel: ModelSelectionResult;
        if (options?.modelOverride) {
          bestModel = modelConfigToSelection(options.modelOverride);
        } else {
          bestModel = await selectBestModel();
        }

        const processorOverride = options?.processor || "auto";

        // Process all files in parallel
        const settled = await Promise.allSettled(
          files.map((file, idx) =>
            processOneFile(
              file,
              idx,
              token,
              bestModel,
              processorOverride,
              studyType,
              templateEntities,
              summaryPrompt
            )
          )
        );

        const fileResults: FileResult[] = [];
        for (let i = 0; i < settled.length; i++) {
          const result = settled[i];
          if (result.status === "fulfilled") {
            fileResults.push(result.value);
          } else {
            const msg =
              result.reason instanceof Error
                ? result.reason.message
                : "Unknown error";
            updateFile(i, { stage: "error", error: msg });
          }
        }

        setResults(fileResults);
        setState((prev) => ({
          ...prev,
          running: false,
          error:
            fileResults.length === 0
              ? "All files failed to process"
              : fileResults.length < files.length
                ? `${files.length - fileResults.length} of ${files.length} files had errors`
                : undefined,
        }));
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "An unknown error occurred";
        setState((prev) => ({
          ...prev,
          running: false,
          error: message,
        }));
      }
    },
    [processOneFile, updateFile]
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setState({
      running: false,
      fileProgress: [],
      completedCount: 0,
      totalFiles: 0,
    });
    setResults([]);
  }, []);

  const downloadResults = useCallback(
    async (includeEntities: boolean) => {
      for (const result of results) {
        const blob = await generateWordDocument(result.docData, {
          ...result.exportOptions,
          includeEntities,
        });
        const baseName = result.fileName.replace(/\.pdf$/i, "");
        downloadFile(
          blob,
          `${baseName}_extraction_report.docx`,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
      }
    },
    [results]
  );

  const downloadSingleResult = useCallback(
    async (result: FileResult, includeEntities: boolean) => {
      const blob = await generateWordDocument(result.docData, {
        ...result.exportOptions,
        includeEntities,
      });
      const baseName = result.fileName.replace(/\.pdf$/i, "");
      downloadFile(
        blob,
        `${baseName}_extraction_report.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    },
    []
  );

  return { state, results, run, reset, downloadResults, downloadSingleResult };
}

// ── Helper functions ──

async function uploadFile(
  file: File,
  fileIndex: number,
  token: string,
  updateFile: (index: number, update: Partial<FileProgress>) => void
): Promise<string> {
  updateFile(fileIndex, { stage: "uploading" });

  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed for ${file.name}: ${err}`);
  }
  const data = await res.json();
  return data.file_hash as string;
}

async function processDocument(
  fileHash: string,
  processor: string,
  token: string
): Promise<string> {
  const res = await fetch(`/api/documents/process/file/${fileHash}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ processor }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Processing failed: ${err}`);
  }
  const data = await res.json();
  return (data.processor_used as string) || "azure_doc_intelligence";
}

async function extractAllEntities(
  fileHash: string,
  templateEntities: Array<{ name: string; prompt: string }>,
  bestModel: ModelSelectionResult,
  processorUsed: string,
  token: string,
  fileIndex: number,
  updateFile: (index: number, update: Partial<FileProgress>) => void,
  abortRef: React.MutableRefObject<boolean>
): Promise<
  Array<{
    name: string;
    prompt: string;
    extracted: string;
    references?: any[];
    duration?: number;
    promptTokens?: number;
    completionTokens?: number;
  }>
> {
  // Send all entities in a single batched request (matching EntityExtractionPage pattern)
  const extractBody = {
    conversion_id: fileHash,
    entities: templateEntities.map((e) => ({
      name: e.name,
      prompt: e.prompt,
    })),
    model_type: bestModel.modelType,
    model_id: bestModel.modelId,
    deployment: bestModel.deployment,
    api_version: bestModel.apiVersion,
    processor_used: processorUsed,
    temperature: 0.0,
  };

  const res = await fetch("/api/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(extractBody),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Extraction failed: ${err}`);
  }

  const data = await res.json();
  const extracted: Array<{
    name: string;
    prompt: string;
    extracted: string;
    references?: any[];
    duration?: number;
    promptTokens?: number;
    completionTokens?: number;
  }> = [];

  const entityResults = data.extracted_entities || [];
  for (let ei = 0; ei < entityResults.length; ei++) {
    if (abortRef.current) throw new Error("Cancelled");
    const entityResult = entityResults[ei];
    const meta = entityResult.meta || {};
    extracted.push({
      name: entityResult.name,
      prompt:
        templateEntities.find((t) => t.name === entityResult.name)?.prompt ||
        "",
      extracted: entityResult.extracted || "",
      references: entityResult.references,
      duration: meta.duration,
      promptTokens: meta.prompt_tokens,
      completionTokens: meta.completion_tokens,
    });
    updateFile(fileIndex, { entityIndex: ei + 1 });
  }

  return extracted;
}

async function generateSummary(
  extractedEntities: Array<{ name: string; extracted: string }>,
  summaryPrompt: string,
  bestModel: ModelSelectionResult,
  token: string
): Promise<string> {
  const body = {
    entities: extractedEntities.map((e) => ({
      name: e.name,
      extracted: e.extracted,
    })),
    summary_prompt: summaryPrompt,
    model_type: bestModel.modelType,
    model_id: bestModel.modelId,
    deployment: bestModel.deployment,
    api_version: bestModel.apiVersion,
    temperature: 0.0,
  };

  const res = await fetch("/api/generate_paragraph", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const data = await res.json();
    return (data.summary as string) || "";
  }
  return "";
}
