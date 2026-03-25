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
  ChevronRight,
  SlidersHorizontal,
  Beaker,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  useSimplifiedPipeline,
  PipelineOptions,
  FileStage,
  STAGE_LABEL,
} from "../hooks/useSimplifiedPipeline";
import {
  loadStudyTypeTemplate,
  getAvailableStudyTypes,
  getStudyTypeDisplayName,
} from "./TemplateLoader";
import {
  fetchAllModels,
  pickBestFromList,
  ModelConfig,
} from "../utils/modelSelection";
import { motion, AnimatePresence } from "framer-motion";

type StudyType = "epidemiology" | "toxicology" | "custom" | null;

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

const FILE_STAGE_ORDER: FileStage[] = [
  "uploading",
  "processing",
  "extracting",
  "summarizing",
  "exporting",
  "complete",
];

export function SimplifiedFlowPage({
  onSwitchToAdvanced: _onSwitchToAdvanced,
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
  const [autoSelectedModelName, setAutoSelectedModelName] =
    useState<string>("");
  const [isDetailedMode, setIsDetailedMode] = useState(false);

  const allTemplates = getAvailableStudyTypes();

  // Fetch models eagerly on mount (so we can always show the auto-selected model name).
  // Using [] so this always runs fresh on mount — avoids the stale-list bug where
  // availableModels cached from a previous session lacked gpt-5.2 and fell back to auto.
  // The cancelled flag handles React StrictMode double-invoke correctly.
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    fetchAllModels()
      .then((models) => {
        if (cancelled) return;
        setAvailableModels(models);
        const best = pickBestFromList(models);
        if (best) setAutoSelectedModelName(best.model.name);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When user clicks a card, set the matching default template and default model
  useEffect(() => {
    if (studyType === "epidemiology" || studyType === "toxicology") {
      setSelectedTemplateId(DEFAULT_TEMPLATES[studyType]);
    }

    if (studyType === "epidemiology" && availableModels.length > 0) {
      const gptModel = availableModels.find(
        (m) =>
          m.name?.toLowerCase().includes("gpt-5.2") ||
          m.id?.toLowerCase().includes("gpt-5.2")
      );
      if (gptModel) {
        setSelectedModelId(gptModel.id);
      } else {
        setSelectedModelId(""); // Fallback to auto
      }
    } else if (studyType === "toxicology" && availableModels.length > 0) {
      const geminiModel = availableModels.find(
        (m) =>
          m.name?.toLowerCase().includes("gemini-2.5-pro") ||
          m.id?.toLowerCase().includes("gemini-2.5-pro")
      );
      if (geminiModel) {
        setSelectedModelId(geminiModel.id);
      } else {
        setSelectedModelId(""); // Fallback to auto
      }
    } else if (studyType === null) {
      setSelectedModelId(""); // Reset when starting over
    }
  }, [studyType, availableModels]);

  const handleTemplateChange = useCallback(
    (templateId: string) => {
      setSelectedTemplateId(templateId);
      if (templateId === DEFAULT_TEMPLATES.epidemiology) {
        setStudyType("epidemiology");
      } else if (templateId === DEFAULT_TEMPLATES.toxicology) {
        setStudyType("toxicology");
      } else {
        setStudyType("custom");
        if (!optionsOpen) setOptionsOpen(true);
      }
    },
    [optionsOpen]
  );

  const customTemplateName =
    studyType === "custom" && selectedTemplateId
      ? getStudyTypeDisplayName(selectedTemplateId)
      : "";

  const {
    state,
    results,
    run,
    reset,
    downloadResults,
    downloadExecutiveResults,
  } = useSimplifiedPipeline();
  const [expandedResultIndex, setExpandedResultIndex] = useState<number | null>(
    null
  );

  const isRunning = state.running;
  const isIdle = !isRunning && state.fileProgress.length === 0;
  const isDone = !isRunning && state.fileProgress.length > 0;
  const hasResults = results.length > 0;
  const overallPercent =
    state.totalFiles > 0
      ? Math.round(
          (state.fileProgress.reduce((acc, f) => {
            const idx = FILE_STAGE_ORDER.indexOf(f.stage);
            return acc + (idx >= 0 ? idx / (FILE_STAGE_ORDER.length - 1) : 0);
          }, 0) /
            state.totalFiles) *
            100
        )
      : 0;

  // Auto-expand first result when pipeline completes
  useEffect(() => {
    if (isDone && hasResults) {
      const timer = setTimeout(() => setExpandedResultIndex(0), 400);
      return () => clearTimeout(timer);
    }
  }, [isDone, hasResults]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isRunning) return;
      const droppedFiles = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === "application/pdf"
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
      selectedTemplateId ||
      (studyType !== "custom" ? DEFAULT_TEMPLATES[studyType] : "") ||
      "";
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

    const pipelineStudyType =
      studyType === "custom" ? selectedTemplateId : studyType;
    run(files, pipelineStudyType, resolved.entities, summaryPrompt, opts);
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
    setOptionsOpen(false);
    setExpandedResultIndex(null);
  }, [reset]);

  const canRun =
    studyType !== null &&
    files.length > 0 &&
    !isRunning &&
    (studyType !== "custom" || !!selectedTemplateId);

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center max-w-[90vw] w-full mx-auto px-2">
      <AnimatePresence mode="wait">
        {isIdle ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="w-full space-y-8"
          >
            {/* Header */}
            <div className="text-center space-y-4">
              <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-primary/10 text-primary text-base font-medium">
                <Sparkles className="h-5 w-5" />
                Simplified Mode
              </div>
              <h2 className="text-4xl font-semibold text-foreground">
                Science-GPT Summarization and Extraction Tool
              </h2>
              <p className="text-muted-foreground text-xl max-w-2xl mx-auto">
                Select your study type, upload PDFs, and get a Word document
                with all extracted entities and a summary.
              </p>
            </div>

            {/* Study Type Selection */}
            <div className="space-y-4 max-w-4xl mx-auto">
              <label className="text-base font-medium text-foreground block text-center">
                Study Type
              </label>
              <div className="grid grid-cols-2 gap-5">
                <button
                  onClick={() => setStudyType("epidemiology")}
                  className={`
                    relative p-8 rounded-xl border-2 transition-all duration-200
                    flex flex-col items-center gap-4 text-center
                    ${
                      studyType === "epidemiology"
                        ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                        : "border-border hover:border-primary/40 hover:bg-muted/50"
                    }
                  `}
                >
                  <div
                    className={`p-4 rounded-lg ${studyType === "epidemiology" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    <Microscope className="h-8 w-8" />
                  </div>
                  <div>
                    <div className="font-semibold text-lg text-foreground">
                      Epidemiology
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Population & observational studies
                    </div>
                  </div>
                  {studyType === "epidemiology" && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="h-6 w-6 text-primary" />
                    </div>
                  )}
                </button>

                <button
                  onClick={() => setStudyType("toxicology")}
                  className={`
                    relative p-8 rounded-xl border-2 transition-all duration-200
                    flex flex-col items-center gap-4 text-center
                    ${
                      studyType === "toxicology"
                        ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                        : "border-border hover:border-primary/40 hover:bg-muted/50"
                    }
                  `}
                >
                  <div
                    className={`p-4 rounded-lg ${studyType === "toxicology" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    <FlaskConical className="h-8 w-8" />
                  </div>
                  <div>
                    <div className="font-semibold text-lg text-foreground">
                      Toxicology (In Vivo)
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      In vivo developmental toxicity
                    </div>
                  </div>
                  {studyType === "toxicology" && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="h-6 w-6 text-primary" />
                    </div>
                  )}
                </button>
              </div>

              {/* Custom template indicator */}
              <AnimatePresence>
                {studyType === "custom" && customTemplateName && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, scale: 0.95 }}
                    animate={{ opacity: 1, height: "auto", scale: 1 }}
                    exit={{ opacity: 0, height: 0, scale: 0.95 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl border-2 border-primary bg-primary/5 shadow-md shadow-primary/10">
                      <div className="p-2.5 rounded-lg bg-primary/15 text-primary">
                        <Beaker className="h-6 w-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-base text-foreground truncate">
                          {customTemplateName}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Custom template
                        </div>
                      </div>
                      <CheckCircle2 className="h-6 w-6 text-primary shrink-0" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* File Upload */}
            <div className="space-y-4 max-w-4xl mx-auto">
              <label className="text-base font-medium text-foreground block text-center">
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
                  relative border-2 border-dashed rounded-xl p-10
                  flex flex-col items-center gap-4 cursor-pointer
                  transition-all duration-200
                  ${
                    isDragging
                      ? "border-primary bg-primary/5 scale-[1.01]"
                      : "border-border hover:border-primary/40 hover:bg-muted/30"
                  }
                `}
              >
                <Upload
                  className={`h-10 w-10 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
                />
                <div className="text-center">
                  <p className="text-base font-medium text-foreground">
                    Drop PDF files here or click to browse
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
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
                <div className="space-y-2.5">
                  {files.map((file, idx) => (
                    <div
                      key={`${file.name}-${idx}`}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/50 border border-border"
                    >
                      <FileText className="h-5 w-5 text-primary shrink-0" />
                      <span className="text-base text-foreground truncate flex-1">
                        {file.name}
                      </span>
                      <span className="text-sm text-muted-foreground shrink-0">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(idx);
                        }}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Options toggle */}
            <div className="space-y-4 max-w-4xl mx-auto">
              <button
                onClick={() => setOptionsOpen((o) => !o)}
                className="flex items-center gap-2.5 mx-auto text-base text-muted-foreground hover:text-foreground transition-colors"
              >
                <SlidersHorizontal className="h-4.5 w-4.5" />
                Options
                <ChevronDown
                  className={`h-4.5 w-4.5 transition-transform duration-200 ${optionsOpen ? "rotate-180" : ""}`}
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
                    <div className="space-y-4 p-5 rounded-lg border border-border bg-muted/30">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                        {/* Parser */}
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
                            Document Parser
                          </label>
                          <Select
                            value={selectedParser}
                            onValueChange={setSelectedParser}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PARSER_OPTIONS.map((p) => (
                                <SelectItem key={p.value} value={p.value}>
                                  {p.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Model */}
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
                            LLM Model
                          </label>
                          <Select
                            value={selectedModelId || "__auto__"}
                            onValueChange={(v) =>
                              setSelectedModelId(v === "__auto__" ? "" : v)
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__auto__">
                                {autoSelectedModelName
                                  ? `Auto — ${autoSelectedModelName}`
                                  : "Auto (best available)"}
                              </SelectItem>
                              {!modelsLoading &&
                                availableModels.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>
                                    {m.name}
                                    {m.provider ? ` (${m.provider})` : ""}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Template */}
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
                            Extraction Template
                          </label>
                          <Select
                            value={selectedTemplateId}
                            onValueChange={handleTemplateChange}
                          >
                            <SelectTrigger
                              className={`w-full ${
                                studyType === "custom"
                                  ? "border-primary ring-1 ring-primary/30 bg-primary/5"
                                  : ""
                              }`}
                            >
                              <SelectValue placeholder="Select a study type first" />
                            </SelectTrigger>
                            <SelectContent>
                              {allTemplates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Run Button */}
            <div className="flex justify-center pt-3">
              <Button
                size="lg"
                onClick={handleRun}
                disabled={!canRun}
                className="px-10 py-3 text-lg h-auto"
              >
                <Sparkles className="h-5 w-5 mr-2.5" />
                Extract & Summarize
              </Button>
            </div>
          </motion.div>
        ) : isDone && hasResults ? (
          /* ═══ RESULTS VIEW ═══ */
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.35 }}
            className="w-full space-y-8"
          >
            {/* Results header */}
            <motion.div
              className="text-center space-y-3"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 mb-2">
                <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-3xl font-semibold text-foreground">
                {results.length === 1
                  ? "Your Report is Ready"
                  : `${results.length} Reports Ready`}
              </h2>
              <p className="text-lg text-muted-foreground">
                Click on a study below to view the summary
              </p>
            </motion.div>

            {/* Result cards */}
            <div className="space-y-4">
              {results.map((result, idx) => {
                const isExpanded = expandedResultIndex === idx;
                const summaryPreview = result.summary
                  ? result.summary.length > 160
                    ? result.summary.slice(0, 160) + "..."
                    : result.summary
                  : "";
                return (
                  <motion.div
                    key={`${result.fileName}-${idx}`}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.15 + idx * 0.08 }}
                    className={`rounded-xl border-2 overflow-hidden transition-colors duration-200 ${
                      isExpanded
                        ? "border-primary/50 bg-card shadow-lg shadow-primary/5"
                        : "border-border bg-card hover:border-primary/30 hover:shadow-md"
                    }`}
                  >
                    {/* Card header */}
                    <button
                      onClick={() =>
                        setExpandedResultIndex(isExpanded ? null : idx)
                      }
                      className="w-full text-left px-6 py-5 transition-colors"
                    >
                      <div className="flex items-start gap-4">
                        <div
                          className={`p-2.5 rounded-lg shrink-0 ${
                            isExpanded
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <FileText className="h-6 w-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="text-lg font-semibold text-foreground truncate">
                              {result.fileName.replace(/\.pdf$/i, "")}
                            </span>
                          </div>
                          {/* Summary preview — only when collapsed */}
                          {!isExpanded && summaryPreview && (
                            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 mt-1">
                              {summaryPreview}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 pt-1">
                          <motion.div
                            animate={{ rotate: isExpanded ? 90 : 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          </motion.div>
                        </div>
                      </div>
                    </button>

                    {/* Expanded content */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: "easeOut" }}
                          className="overflow-hidden"
                        >
                          <div className="px-6 pb-6 space-y-5 border-t border-border pt-5">
                            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
                              <div className="flex flex-col min-h-0">
                                <div className="p-4 bg-muted rounded-lg flex-1 overflow-y-auto">
                                  <h4 className="font-bold mb-3 text-sm text-muted-foreground uppercase tracking-wide">
                                    Summary
                                  </h4>
                                  <p className="whitespace-pre-wrap leading-relaxed text-base text-foreground">
                                    {result.summary || "No summary available."}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-col min-h-0">
                                <div className="border rounded-lg flex-1 overflow-y-auto flex flex-col">
                                  <h4 className="font-bold p-4 pb-2 text-sm text-muted-foreground uppercase tracking-wide sticky top-0 bg-background z-10 flex-shrink-0">
                                    Extracted Entities
                                  </h4>
                                  <div className="p-4 pt-0 flex-1 overflow-y-auto">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="w-[180px] text-sm font-bold">
                                            Entity
                                          </TableHead>
                                          <TableHead className="text-sm font-bold">
                                            Extracted Value
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {result.entities?.map(
                                          (entity: any, idx: number) => (
                                            <TableRow key={idx}>
                                              <TableCell className="font-medium align-top text-sm py-3">
                                                {entity.name}
                                              </TableCell>
                                              <TableCell className="align-top whitespace-pre-wrap text-sm py-3">
                                                {entity.answer ||
                                                  entity.extracted ||
                                                  "-"}
                                              </TableCell>
                                            </TableRow>
                                          )
                                        )}
                                        {(!result.entities ||
                                          result.entities.length === 0) && (
                                          <TableRow>
                                            <TableCell
                                              colSpan={2}
                                              className="text-center text-muted-foreground"
                                            >
                                              No entities extracted
                                            </TableCell>
                                          </TableRow>
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>

            {/* Actions */}
            <motion.div
              className="flex flex-col items-center gap-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.3,
                delay: 0.15 + results.length * 0.08,
              }}
            >
              {/* Download row: format toggle + single download button */}
              <div className="flex items-center gap-3">
                {/* Segmented format toggle */}
                <div className="flex rounded-full border border-border bg-muted p-0.5 text-sm">
                  <button
                    onClick={() => setIsDetailedMode(false)}
                    className={`px-4 py-1.5 rounded-full transition-all font-medium ${
                      !isDetailedMode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Summary
                  </button>
                  <button
                    onClick={() => setIsDetailedMode(true)}
                    className={`px-4 py-1.5 rounded-full transition-all font-medium ${
                      isDetailedMode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Detailed
                  </button>
                </div>

                <Button
                  onClick={() =>
                    isDetailedMode
                      ? downloadResults(true)
                      : downloadExecutiveResults()
                  }
                  className="rounded-md bg-black text-white hover:bg-neutral-800 px-5 py-[0.4375rem] text-sm font-medium h-auto"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {results.length === 1
                    ? "Download Report"
                    : `Download ${results.length} Reports`}
                </Button>
              </div>

              {/* Secondary actions */}
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  onClick={handleStartOver}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  Start Over
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : (
          /* ═══ PROCESSING VIEW — per-file progress cards ═══ */
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="w-full space-y-8"
          >
            {/* Header */}
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-2">
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
              </div>
              <h2 className="text-3xl font-semibold text-foreground">
                Processing{" "}
                {state.totalFiles === 1
                  ? "Study"
                  : `${state.totalFiles} Studies`}
              </h2>
              <p className="text-lg text-muted-foreground">
                {state.completedCount} of {state.totalFiles} complete
                {state.totalFiles > 1 && " — files are processed in parallel"}
              </p>
            </div>

            {/* Overall progress bar */}
            <div className="space-y-2.5">
              <div className="h-3.5 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${overallPercent}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>
                  {state.completedCount} / {state.totalFiles} files
                </span>
                <span>{overallPercent}%</span>
              </div>
            </div>

            {/* Per-file status cards */}
            <div className="space-y-3">
              {state.fileProgress.map((fp, idx) => {
                const isActive =
                  fp.stage !== "queued" &&
                  fp.stage !== "complete" &&
                  fp.stage !== "error";
                const isFileComplete = fp.stage === "complete";
                const isFileError = fp.stage === "error";

                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.05 }}
                    className={`flex items-center gap-4 px-5 py-4 rounded-xl border transition-colors ${
                      isFileComplete
                        ? "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20"
                        : isFileError
                          ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"
                          : isActive
                            ? "border-primary/30 bg-primary/5"
                            : "border-border bg-card"
                    }`}
                  >
                    {/* Status icon */}
                    <div className="shrink-0">
                      {isFileComplete ? (
                        <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                      ) : isFileError ? (
                        <AlertCircle className="h-6 w-6 text-red-500" />
                      ) : isActive ? (
                        <Loader2 className="h-6 w-6 text-primary animate-spin" />
                      ) : (
                        <div className="h-6 w-6 rounded-full border-2 border-border" />
                      )}
                    </div>

                    {/* File info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-medium text-foreground truncate">
                        {fp.fileName.replace(/\.pdf$/i, "")}
                      </div>
                      <div
                        className={`text-sm ${
                          isFileError
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {isFileError && fp.error
                          ? fp.error
                          : STAGE_LABEL[fp.stage]}
                      </div>
                    </div>

                    {/* Entity progress for extracting stage */}
                    {fp.stage === "extracting" && fp.totalEntities > 0 && (
                      <span className="text-sm text-muted-foreground shrink-0">
                        {fp.entityIndex}/{fp.totalEntities} entities
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Error summary + actions (only when done with errors, not running) */}
            {!isRunning && state.error && (
              <>
                <div className="p-5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                  <p className="text-base text-red-700 dark:text-red-300">
                    {state.error}
                  </p>
                </div>
                <div className="flex justify-center gap-4 pt-3">
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={handleStartOver}
                    className="px-10 py-3 text-lg h-auto"
                  >
                    <RotateCcw className="h-5 w-5 mr-2.5" />
                    Start Over
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
