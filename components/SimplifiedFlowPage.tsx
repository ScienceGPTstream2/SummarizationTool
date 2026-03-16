import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  FileText,
  FlaskConical,
  Microscope,
  Download,
  RotateCcw,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  useSimplifiedPipeline,
  PipelineStage,
  PipelineOptions,
} from "../hooks/useSimplifiedPipeline";
import {
  loadStudyTypeTemplate,
  getAvailableStudyTypes,
} from "./TemplateLoader";
import { fetchAllModels, ModelConfig } from "../utils/modelSelection";
import { motion, AnimatePresence } from "framer-motion";

type StudyType = "epidemiology" | "toxicology" | null;

const PARSER_OPTIONS = [
  { value: "docling", label: "Docling (recommended)" },
  { value: "azure_doc_intelligence", label: "Azure Document Intelligence" },
  { value: "auto", label: "Auto" },
] as const;

const DEFAULT_TEMPLATES: Record<string, string> = {
  epidemiology: "level-1-epidemiology",
  toxicology: "level-1-in-vivo",
};

interface SimplifiedFlowPageProps {
  onSwitchToAdvanced: () => void;
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: "",
  uploading: "Uploading",
  processing: "Processing Document",
  extracting: "Extracting Entities",
  summarizing: "Generating Summary",
  exporting: "Creating Report",
  complete: "Complete",
  error: "Error",
};

const STAGE_ORDER: PipelineStage[] = [
  "uploading",
  "processing",
  "extracting",
  "summarizing",
  "exporting",
];

export function SimplifiedFlowPage({
  onSwitchToAdvanced,
}: SimplifiedFlowPageProps) {
  const [studyType, setStudyType] = useState<StudyType>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const [selectedParser, setSelectedParser] = useState("docling");
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const allTemplates = getAvailableStudyTypes();

  useEffect(() => {
    if (!optionsOpen || availableModels.length > 0) return;
    let cancelled = false;
    setModelsLoading(true);
    fetchAllModels()
      .then((models) => {
        if (!cancelled) setAvailableModels(models);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [optionsOpen, availableModels.length]);

  useEffect(() => {
    if (studyType && !selectedTemplateId) {
      setSelectedTemplateId(DEFAULT_TEMPLATES[studyType] || "");
    }
  }, [studyType, selectedTemplateId]);

  const { progress, results, run, reset, downloadResults } =
    useSimplifiedPipeline();

  const isRunning =
    progress.stage !== "idle" &&
    progress.stage !== "complete" &&
    progress.stage !== "error";

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isRunning) return;
      const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
        f.type === "application/pdf"
      );
      if (droppedFiles.length > 0) {
        setFiles((prev) => [...prev, ...droppedFiles].slice(0, 10));
      }
    },
    [isRunning]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isRunning) return;
      const selected = Array.from(e.target.files || []);
      if (selected.length > 0) {
        setFiles((prev) => [...prev, ...selected].slice(0, 10));
      }
      e.target.value = "";
    },
    [isRunning]
  );

  const removeFile = useCallback(
    (index: number) => {
      if (isRunning) return;
      setFiles((prev) => prev.filter((_, i) => i !== index));
    },
    [isRunning]
  );

  const handleRun = useCallback(() => {
    if (!studyType || files.length === 0 || isRunning) return;

    const templateId =
      selectedTemplateId || DEFAULT_TEMPLATES[studyType] || "";
    const resolved = loadStudyTypeTemplate(templateId);

    const summaryPrompt =
      resolved.summaryPrompt ||
      "Take the following extracted entities and combine them into a single cohesive paragraph. Maintain all factual details exactly as provided. Do not modify, add, or omit any of the extracted information.";

    const opts: PipelineOptions = {};
    if (selectedParser !== "auto") opts.processor = selectedParser;
    if (selectedModelId) {
      const model = availableModels.find((m) => m.id === selectedModelId);
      if (model) opts.modelOverride = model;
    }

    run(files, studyType, resolved.entities, summaryPrompt, opts);
  }, [
    studyType,
    files,
    isRunning,
    run,
    selectedTemplateId,
    selectedParser,
    selectedModelId,
    availableModels,
  ]);

  const handleStartOver = useCallback(() => {
    reset();
    setStudyType(null);
    setFiles([]);
    setSelectedTemplateId("");
  }, [reset]);

  const canRun = studyType !== null && files.length > 0 && !isRunning;

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center max-w-3xl mx-auto px-4">
      <AnimatePresence mode="wait">
        {progress.stage === "idle" ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="w-full space-y-8"
          >
            {/* Header */}
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                <Sparkles className="h-4 w-4" />
                Simplified Mode
              </div>
              <h2 className="text-3xl font-semibold text-foreground">
                Extract & Summarize Studies
              </h2>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                Select your study type, upload PDFs, and get a Word document
                with all extracted entities and a summary.
              </p>
            </div>

            {/* Study Type Selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground block text-center">
                Study Type
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setStudyType("epidemiology")}
                  className={`
                    relative p-6 rounded-xl border-2 transition-all duration-200
                    flex flex-col items-center gap-3 text-center
                    ${
                      studyType === "epidemiology"
                        ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                        : "border-border hover:border-primary/40 hover:bg-muted/50"
                    }
                  `}
                >
                  <div
                    className={`p-3 rounded-lg ${studyType === "epidemiology" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    <Microscope className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">
                      Epidemiology
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Population & observational studies
                    </div>
                  </div>
                  {studyType === "epidemiology" && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    </div>
                  )}
                </button>

                <button
                  onClick={() => setStudyType("toxicology")}
                  className={`
                    relative p-6 rounded-xl border-2 transition-all duration-200
                    flex flex-col items-center gap-3 text-center
                    ${
                      studyType === "toxicology"
                        ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                        : "border-border hover:border-primary/40 hover:bg-muted/50"
                    }
                  `}
                >
                  <div
                    className={`p-3 rounded-lg ${studyType === "toxicology" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    <FlaskConical className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">
                      Toxicology (In Vivo)
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      In vivo developmental toxicity
                    </div>
                  </div>
                  {studyType === "toxicology" && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    </div>
                  )}
                </button>
              </div>
            </div>

            {/* File Upload */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground block text-center">
                Upload Studies (PDF)
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative border-2 border-dashed rounded-xl p-8
                  flex flex-col items-center gap-3 cursor-pointer
                  transition-all duration-200
                  ${
                    isDragging
                      ? "border-primary bg-primary/5 scale-[1.01]"
                      : "border-border hover:border-primary/40 hover:bg-muted/30"
                  }
                `}
              >
                <Upload
                  className={`h-8 w-8 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
                />
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">
                    Drop PDF files here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Up to 10 files, PDF only
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {/* File list */}
              {files.length > 0 && (
                <div className="space-y-2">
                  {files.map((file, idx) => (
                    <div
                      key={`${file.name}-${idx}`}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted/50 border border-border"
                    >
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-sm text-foreground truncate flex-1">
                        {file.name}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(idx);
                        }}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Options toggle */}
            <div className="space-y-3">
              <button
                onClick={() => setOptionsOpen((o) => !o)}
                className="flex items-center gap-2 mx-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Options
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${optionsOpen ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {optionsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-lg border border-border bg-muted/30">
                      {/* Parser */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Document Parser
                        </label>
                        <select
                          value={selectedParser}
                          onChange={(e) => setSelectedParser(e.target.value)}
                          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {PARSER_OPTIONS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Model */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          LLM Model
                        </label>
                        <select
                          value={selectedModelId}
                          onChange={(e) => setSelectedModelId(e.target.value)}
                          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">Auto (best available)</option>
                          {modelsLoading ? (
                            <option disabled>Loading models...</option>
                          ) : (
                            availableModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                                {m.provider ? ` (${m.provider})` : ""}
                                {m.description ? ` — ${m.description}` : ""}
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      {/* Template */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Extraction Template
                        </label>
                        <select
                          value={
                            selectedTemplateId ||
                            (studyType ? DEFAULT_TEMPLATES[studyType] : "")
                          }
                          onChange={(e) =>
                            setSelectedTemplateId(e.target.value)
                          }
                          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {!studyType && (
                            <option value="" disabled>
                              Select a study type first
                            </option>
                          )}
                          {allTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Run Button */}
            <div className="flex justify-center pt-2">
              <Button
                size="lg"
                onClick={handleRun}
                disabled={!canRun}
                className="px-8 text-base"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Extract & Summarize
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="w-full space-y-8"
          >
            {/* Progress Header */}
            <div className="text-center space-y-2">
              {progress.stage === "complete" ? (
                <>
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-2">
                    <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                  <h2 className="text-2xl font-semibold text-foreground">
                    Reports Ready
                  </h2>
                </>
              ) : progress.stage === "error" ? (
                <>
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-2">
                    <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                  </div>
                  <h2 className="text-2xl font-semibold text-foreground">
                    Something Went Wrong
                  </h2>
                </>
              ) : (
                <>
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  </div>
                  <h2 className="text-2xl font-semibold text-foreground">
                    Processing...
                  </h2>
                </>
              )}
              <p className="text-muted-foreground">{progress.message}</p>
            </div>

            {/* Stage Steps */}
            <div className="space-y-1">
              {STAGE_ORDER.map((stage) => {
                const currentIdx = STAGE_ORDER.indexOf(progress.stage);
                const stageIdx = STAGE_ORDER.indexOf(stage);
                const isActive = progress.stage === stage;
                const isComplete =
                  progress.stage === "complete" || currentIdx > stageIdx;
                const isPending = currentIdx < stageIdx;

                return (
                  <div
                    key={stage}
                    className={`
                      flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors
                      ${isActive ? "bg-primary/5" : ""}
                    `}
                  >
                    <div className="shrink-0">
                      {isComplete ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                      ) : isActive ? (
                        <Loader2 className="h-5 w-5 text-primary animate-spin" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-border" />
                      )}
                    </div>
                    <span
                      className={`text-sm font-medium ${
                        isActive
                          ? "text-foreground"
                          : isComplete
                            ? "text-muted-foreground"
                            : isPending
                              ? "text-muted-foreground/50"
                              : "text-muted-foreground"
                      }`}
                    >
                      {STAGE_LABELS[stage]}
                    </span>
                    {isActive &&
                      progress.stage === "extracting" &&
                      progress.totalEntities > 0 && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          {progress.entityIndex}/{progress.totalEntities}{" "}
                          entities
                        </span>
                      )}
                  </div>
                );
              })}
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${
                    progress.stage === "error"
                      ? "bg-red-500"
                      : progress.stage === "complete"
                        ? "bg-green-500"
                        : "bg-primary"
                  }`}
                  initial={{ width: 0 }}
                  animate={{ width: `${progress.percent}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {progress.totalFiles > 1
                    ? `File ${Math.min(progress.fileIndex + 1, progress.totalFiles)} of ${progress.totalFiles}`
                    : ""}
                </span>
                <span>{progress.percent}%</span>
              </div>
            </div>

            {/* Error details */}
            {progress.stage === "error" && progress.error && (
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-700 dark:text-red-300">
                  {progress.error}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-center gap-3 pt-2">
              {progress.stage === "complete" && results.length > 0 && (
                <Button size="lg" onClick={downloadResults} className="px-8">
                  <Download className="h-4 w-4 mr-2" />
                  Download{" "}
                  {results.length === 1
                    ? "Report"
                    : `${results.length} Reports`}
                </Button>
              )}
              {(progress.stage === "complete" ||
                progress.stage === "error") && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={handleStartOver}
                  className="px-8"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Start Over
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer link */}
      <div className="mt-12 text-center">
        <button
          onClick={onSwitchToAdvanced}
          className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
        >
          Switch to Advanced Mode
        </button>
      </div>
    </div>
  );
}
