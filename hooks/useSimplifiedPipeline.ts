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

export type PipelineStage =
  | "idle"
  | "uploading"
  | "processing"
  | "extracting"
  | "summarizing"
  | "exporting"
  | "complete"
  | "error";

export interface PipelineProgress {
  stage: PipelineStage;
  fileIndex: number;
  totalFiles: number;
  entityIndex: number;
  totalEntities: number;
  percent: number;
  message: string;
  error?: string;
}

export interface FileResult {
  fileName: string;
  blob: Blob;
}

export interface PipelineOptions {
  processor?: string;
  modelOverride?: ModelConfig | null;
}

const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  idle: 0,
  uploading: 0.1,
  processing: 0.35,
  extracting: 0.8,
  summarizing: 0.9,
  exporting: 0.95,
  complete: 1,
  error: 0,
};

function computePercent(
  stage: PipelineStage,
  fileIndex: number,
  totalFiles: number,
  entityIndex: number,
  totalEntities: number
): number {
  const fileWeight = 1 / Math.max(totalFiles, 1);
  const fileBase = fileIndex * fileWeight;

  const prevStageWeight = getPrevStageWeight(stage);
  const curStageWeight = STAGE_WEIGHTS[stage] ?? 0;
  const stageSpan = curStageWeight - prevStageWeight;

  let intraStageProgress = 0;
  if (stage === "extracting" && totalEntities > 0) {
    intraStageProgress = entityIndex / totalEntities;
  } else if (
    stage === "complete" ||
    stage === "summarizing" ||
    stage === "exporting"
  ) {
    intraStageProgress = 1;
  }

  const fileProgress = prevStageWeight + stageSpan * intraStageProgress;
  return Math.min(Math.round((fileBase + fileWeight * fileProgress) * 100), 100);
}

function getPrevStageWeight(stage: PipelineStage): number {
  const order: PipelineStage[] = [
    "idle",
    "uploading",
    "processing",
    "extracting",
    "summarizing",
    "exporting",
    "complete",
  ];
  const idx = order.indexOf(stage);
  if (idx <= 0) return 0;
  return STAGE_WEIGHTS[order[idx - 1]] ?? 0;
}

export function useSimplifiedPipeline() {
  const [progress, setProgress] = useState<PipelineProgress>({
    stage: "idle",
    fileIndex: 0,
    totalFiles: 0,
    entityIndex: 0,
    totalEntities: 0,
    percent: 0,
    message: "",
  });

  const [results, setResults] = useState<FileResult[]>([]);
  const abortRef = useRef(false);

  const updateProgress = useCallback(
    (
      stage: PipelineStage,
      fileIndex: number,
      totalFiles: number,
      entityIndex: number,
      totalEntities: number,
      message: string,
      error?: string
    ) => {
      const percent = computePercent(
        stage,
        fileIndex,
        totalFiles,
        entityIndex,
        totalEntities
      );
      setProgress({
        stage,
        fileIndex,
        totalFiles,
        entityIndex,
        totalEntities,
        percent,
        message,
        error,
      });
    },
    []
  );

  const run = useCallback(
    async (
      files: File[],
      studyType: "epidemiology" | "toxicology",
      templateEntities: Array<{ name: string; prompt: string }>,
      summaryPrompt: string,
      options?: PipelineOptions
    ) => {
      abortRef.current = false;
      setResults([]);
      const totalFiles = files.length;
      const fileResults: FileResult[] = [];

      try {
        const token = await getValidToken();
        if (!token) throw new Error("Not authenticated");

        updateProgress("uploading", 0, totalFiles, 0, 0, "Selecting best model...");

        let bestModel: ModelSelectionResult;
        if (options?.modelOverride) {
          bestModel = modelConfigToSelection(options.modelOverride);
        } else {
          bestModel = await selectBestModel();
        }

        const processorOverride = options?.processor || "auto";

        for (let fi = 0; fi < files.length; fi++) {
          if (abortRef.current) throw new Error("Cancelled");

          const file = files[fi];
          const fileLabel =
            totalFiles > 1
              ? `File ${fi + 1}/${totalFiles}: ${file.name}`
              : file.name;

          // ── UPLOAD ──
          updateProgress(
            "uploading",
            fi,
            totalFiles,
            0,
            0,
            `Uploading ${fileLabel}...`
          );

          const formData = new FormData();
          formData.append("file", file);
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          if (!uploadRes.ok) {
            const err = await uploadRes.text();
            throw new Error(`Upload failed for ${file.name}: ${err}`);
          }
          const uploadData = await uploadRes.json();
          const fileHash: string = uploadData.file_hash;

          // ── PROCESS ──
          updateProgress(
            "processing",
            fi,
            totalFiles,
            0,
            0,
            `Processing ${fileLabel}...`
          );

          const processRes = await fetch(
            `/api/documents/process/file/${fileHash}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ processor: processorOverride }),
            }
          );
          if (!processRes.ok) {
            const err = await processRes.text();
            throw new Error(`Processing failed for ${file.name}: ${err}`);
          }
          const processData = await processRes.json();
          const processorUsed: string =
            processData.processor_used || "azure_doc_intelligence";

          // ── EXTRACT (per entity for progress) ──
          const totalEntities = templateEntities.length;
          const extractedEntities: Array<{
            name: string;
            prompt: string;
            extracted: string;
            references?: any[];
            duration?: number;
            promptTokens?: number;
            completionTokens?: number;
          }> = [];

          for (let ei = 0; ei < templateEntities.length; ei++) {
            if (abortRef.current) throw new Error("Cancelled");

            const entity = templateEntities[ei];
            updateProgress(
              "extracting",
              fi,
              totalFiles,
              ei,
              totalEntities,
              `Extracting "${entity.name}" (${ei + 1}/${totalEntities}) from ${fileLabel}...`
            );

            const extractBody: Record<string, unknown> = {
              conversion_id: fileHash,
              entities: [{ name: entity.name, prompt: entity.prompt }],
              model_type: bestModel.modelType,
              model_id: bestModel.modelId,
              deployment: bestModel.deployment,
              api_version: bestModel.apiVersion,
              processor_used: processorUsed,
              temperature: 0.0,
            };

            const extractRes = await fetch("/api/extract", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(extractBody),
            });

            if (!extractRes.ok) {
              const err = await extractRes.text();
              throw new Error(
                `Extraction failed for entity "${entity.name}": ${err}`
              );
            }

            const extractData = await extractRes.json();
            const entityResult = extractData.extracted_entities?.[0];
            if (entityResult) {
              const meta = entityResult.meta || {};
              extractedEntities.push({
                name: entityResult.name,
                prompt: entity.prompt,
                extracted: entityResult.extracted || "",
                references: entityResult.references,
                duration: meta.duration,
                promptTokens: meta.prompt_tokens,
                completionTokens: meta.completion_tokens,
              });
            }
          }

          // ── SUMMARIZE ──
          updateProgress(
            "summarizing",
            fi,
            totalFiles,
            totalEntities,
            totalEntities,
            `Generating summary for ${fileLabel}...`
          );

          let finalSummary = "";
          const summaryBody: Record<string, unknown> = {
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

          const summaryRes = await fetch("/api/generate_paragraph", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(summaryBody),
          });

          if (summaryRes.ok) {
            const summaryData = await summaryRes.json();
            finalSummary = summaryData.summary || "";
          }

          // ── EXPORT ──
          updateProgress(
            "exporting",
            fi,
            totalFiles,
            totalEntities,
            totalEntities,
            `Generating Word document for ${fileLabel}...`
          );

          const studyTypeId =
            studyType === "epidemiology"
              ? "level-1-epidemiology"
              : "level-1-in-vivo";

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

          const blob = await generateWordDocument(docData, exportOptions);
          fileResults.push({ fileName: file.name, blob });
        }

        setResults(fileResults);
        updateProgress(
          "complete",
          totalFiles,
          totalFiles,
          0,
          0,
          `Done! ${totalFiles === 1 ? "1 document" : `${totalFiles} documents`} ready for download.`
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "An unknown error occurred";
        updateProgress(
          "error",
          progress.fileIndex,
          progress.totalFiles,
          progress.entityIndex,
          progress.totalEntities,
          "Pipeline failed",
          message
        );
      }
    },
    [updateProgress]
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setProgress({
      stage: "idle",
      fileIndex: 0,
      totalFiles: 0,
      entityIndex: 0,
      totalEntities: 0,
      percent: 0,
      message: "",
    });
    setResults([]);
  }, []);

  const downloadResults = useCallback(() => {
    for (const result of results) {
      const baseName = result.fileName.replace(/\.pdf$/i, "");
      downloadFile(
        result.blob,
        `${baseName}_extraction_report.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    }
  }, [results]);

  return { progress, results, run, reset, downloadResults };
}
