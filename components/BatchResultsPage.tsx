import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Fuse from "fuse.js";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
// Select component available if needed for future filtering enhancements
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
// Card components available if needed

import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Columns3,
  FileSpreadsheet,
  ArrowLeft,
  Download,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { downloadEvaluationReport } from "../utils/wordExport";
import { authenticatedFetch } from "../utils/authUtils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";

// Result row type matching Excel export structure
export interface ResultRow {
  id: string;
  fileId: string; // Document/file ID for per-document tracking
  studyName: string;
  llmSource: string;
  sourceModelRaw: string; // Raw model ID for API calls
  ingestion: string;
  systemPrompt: string;
  promptTemplate: string;
  entity: string;
  entityNameRaw?: string; // Raw entity_name for API calls (e.g. "__paragraph_summary__")
  actualOutput: string;
  groundTruth: string;
  judge: string;
  judgeRaw: string; // Raw judge model ID for API calls
  correctness: number | null;
  completeness: number | null;
  relevance: number | null;
  safety: number | null;
  humanEval: number | null; // Changed to number 0-100
  cost: string; // legacy single cost (kept for compatibility)
  docParseCost?: string;
  extractionCost?: string;
  evalCost?: string;
  extractionLatency?: number | null;  // seconds — from extractionData.duration
  evalLatency?: number | null;        // seconds — from result.evaluation_time
  parseLatency?: number | null;       // seconds — document parse duration
}

const formatModelName = (modelId: string) => {
  if (!modelId) return "";
  let name = modelId.split("/").pop() || modelId;
  name = name
    .replace(/^azure-openai-/, "")
    .replace(/^anthropic_/, "")
    .split("@")[0];
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

// Helper to get display-friendly model name
const getDisplayModelName = (model: string): string => {
  if (model.includes("@")) {
    const baseName = model.split("@")[0];
    return baseName
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  return model;
};

// Helper to safely get metric score as number
const getMetricScore = (result: any, metricName: string): number | null => {
  if (!result || !result.metrics) return null;
  const metric = result.metrics.find((m: any) =>
    m.metric_name.toLowerCase().includes(metricName.toLowerCase())
  );
  return metric ? Math.round(metric.score * 100) : null;
};

const formatCost = (value: number | undefined | null): string => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "";
  }
  return Number(value).toFixed(6);
};

// Transform documentData to flat rows
export const transformToRows = (documentData: any): ResultRow[] => {
  const rows: ResultRow[] = [];
  let idCounter = 0;

  // Normalize file list
  let filesToProcess: any[] = [];
  if (documentData.uploadedFiles && documentData.uploadedFiles.length > 0) {
    filesToProcess = documentData.uploadedFiles;
  } else {
    filesToProcess = [
      {
        file: documentData.file,
        fileId: documentData.fileId,
        entities: documentData.entities,
        selectedModel: documentData.selectedModel,
        processorUsed: documentData.processorUsed,
      },
    ];
  }

  for (const fileItem of filesToProcess) {
    const fileName = fileItem.file?.name || "Unknown File";
    const fileId = fileItem.fileId || "";
    // Check multiple places for processorUsed
    const ingestionTool =
      fileItem.processorUsed ||
      fileItem.processingResult?.processorUsed ||
      documentData.processorUsed ||
      "";
    const entities = fileItem.entities || [];
    const docParseCostRaw =
      fileItem.processingResult?.parseCost ??        // camelCase (live upload path)
      fileItem.processingResult?.parse_cost ??       // snake_case fallback (session restore path)
      fileItem.parse_cost ??
      documentData.parse_cost;

    const docParseLatencyRaw: number | null =
      fileItem.processingResult?.parseDuration ??
      fileItem.processingResult?.parse_duration_seconds ??
      null;

    for (const entity of entities) {
      const entityName = entity.name;
      const promptTemplate = entity.prompt || "";
      const systemPrompt = entity.systemPrompt || "";
      const groundTruth = entity.groundTruth || "";

      // Identify Source Models
      let sourceModels = Object.keys(entity.extractionsByModel || {});

      if (sourceModels.length === 0 && entity.extracted) {
        const singleModel =
          fileItem.selectedModel ||
          documentData.selectedModel ||
          "Default Model";
        sourceModels = [singleModel];
      }

      for (const sourceModel of sourceModels) {
        let extractionData = entity.extractionsByModel?.[sourceModel];

        // Fallback
        if (
          !extractionData &&
          sourceModel === (fileItem.selectedModel || documentData.selectedModel)
        ) {
          extractionData = {
            extracted: entity.extracted,
            evaluationResults: entity.evaluationResults,
          };
        }

        if (!extractionData) continue;

        const extractionCost =
          extractionData.cost ??
          extractionData.meta?.cost ??
          extractionData.call_cost;
        const actualOutput = extractionData.extracted || "";
        const evalResults = extractionData.evaluationResults || [];

        // Human score can be at extraction level or inside each evaluation result
        const extractionHumanScore =
          extractionData.humanScore ?? extractionData.human_score ?? null;

        if (evalResults.length === 0) {
          // For rows without evaluation, show extraction cost if available
          // Uses outer extractionCost (lines above) which has full ?? fallback chain
          rows.push({
            id: `row-${idCounter++}`,
            fileId: fileId,
            studyName: fileName,
            llmSource: getDisplayModelName(sourceModel),
            sourceModelRaw: sourceModel,
            ingestion: ingestionTool,
            systemPrompt: systemPrompt,
            promptTemplate: promptTemplate,
            entity: entityName,
            actualOutput: actualOutput,
            groundTruth: groundTruth,
            judge: "",
            judgeRaw: "",
            correctness: null,
            completeness: null,
            relevance: null,
            safety: null,
            humanEval:
              extractionHumanScore !== null
                ? typeof extractionHumanScore === "number"
                  ? Math.round(extractionHumanScore * 100)
                  : extractionHumanScore
                : null,
            cost: formatCost(extractionCost),
            docParseCost: formatCost(docParseCostRaw),
            extractionCost: formatCost(extractionCost),
            evalCost: "",
            extractionLatency: extractionData.duration ?? extractionData.meta?.duration ?? null,
            evalLatency: null,
            parseLatency: docParseLatencyRaw,
          });
        } else {
          for (const result of evalResults) {
            const humanScore = result.human_score ?? result.humanScore ?? null;
            const docParseCost = docParseCostRaw;
            rows.push({
              id: `row-${idCounter++}`,
              fileId: fileId,
              studyName: fileName,
              llmSource: getDisplayModelName(sourceModel),
              sourceModelRaw: sourceModel,
              ingestion: ingestionTool,
              systemPrompt: systemPrompt,
              promptTemplate: promptTemplate,
              entity: entityName,
              actualOutput: actualOutput,
              groundTruth: groundTruth,
              judge: getDisplayModelName(result.model || "Unknown Judge"),
              judgeRaw: result.model || "",
              correctness: getMetricScore(result, "correctness"),
              completeness: getMetricScore(result, "completeness"),
              relevance: getMetricScore(result, "relevance"),
              safety: getMetricScore(result, "safety"),
              humanEval:
                humanScore !== null
                  ? typeof humanScore === "number"
                    ? Math.round(humanScore * 100)
                    : humanScore
                  : null,
              cost: formatCost(result.evaluation_cost),
              docParseCost: formatCost(docParseCost),
              extractionCost: formatCost(extractionCost),
              evalCost: formatCost(result.evaluation_cost),
              extractionLatency: extractionData.duration ?? extractionData.meta?.duration ?? null,
              evalLatency: result.evaluation_time ?? null,
              parseLatency: docParseLatencyRaw,
            });
          }
        }
      }
    }

    // Paragraph Evaluation row — human-only, no LLM judge scores
    const paragraphEval = (fileItem as any).paragraphEvaluation;
    if (fileItem.finalSummary && paragraphEval?.groundTruth) {
      rows.push({
        id: `row-${idCounter++}`,
        fileId: fileId,
        studyName: fileName,
        llmSource: getDisplayModelName(
          (fileItem as any).paragraphSummaryModel || ""
        ),
        sourceModelRaw: (fileItem as any).paragraphSummaryModel || "",
        ingestion: ingestionTool,
        systemPrompt: "",
        promptTemplate: "",
        entity: "Paragraph Evaluation",
        entityNameRaw: "__paragraph_summary__",
        actualOutput: fileItem.finalSummary || "",
        groundTruth: paragraphEval.groundTruth,
        judge: "Human",
        judgeRaw: "human",
        correctness: null,
        completeness: null,
        relevance: null,
        safety: null,
        humanEval: paragraphEval.humanScore ?? null,
        cost: "",
        docParseCost: "",
        extractionCost: formatCost((fileItem as any).paragraphSummaryCost),
        evalCost: "",
        extractionLatency: null,
        evalLatency: null,
        parseLatency: docParseLatencyRaw,
      });
    }
  }

  return rows;
};

// Column definitions (updated to three cost columns)
const ALL_COLUMNS = [
  { key: "studyName", label: "Study Name", type: "text" },
  { key: "llmSource", label: "LLM (Source)", type: "category" },
  { key: "ingestion", label: "Ingestion", type: "category" },
  {
    key: "systemPrompt",
    label: "System Prompt",
    type: "text",
    defaultHidden: true,
  },
  {
    key: "promptTemplate",
    label: "Prompt Template",
    type: "text",
    defaultHidden: true,
  },
  { key: "entity", label: "Entity", type: "category" },
  { key: "actualOutput", label: "Actual Output", type: "text" },
  { key: "groundTruth", label: "Ground Truth", type: "text" },
  { key: "judge", label: "Judge", type: "category" },
  { key: "correctness", label: "Correctness", type: "score" },
  { key: "completeness", label: "Completeness", type: "score" },
  { key: "relevance", label: "Relevance", type: "score" },
  { key: "safety", label: "Safety", type: "score" },
  { key: "humanEval", label: "Human Eval", type: "label" },
  { key: "docParseCost", label: "Doc Parse Cost", type: "text" },
  { key: "extractionCost", label: "Extraction Cost", type: "text" },
  { key: "evalCost", label: "Eval Cost", type: "text" },
  { key: "parseLatency", label: "Parse Latency (s)", type: "text" },
  { key: "extractionLatency", label: "Extraction Latency (s)", type: "text" },
  { key: "evalLatency", label: "Eval Latency (s)", type: "text" },
] as const;

type SortDirection = "asc" | "desc" | null;

interface BatchResultsPageProps {
  documentData: any;
  onBack?: () => void;
  onSaveHumanScore?: (params: {
    fileId: string;
    entityName: string;
    sourceModel: string;
    judgeModel: string;
    humanScore: number | null;
    groundTruth: string;
  }) => Promise<void>;
}

export default function BatchResultsPage({
  documentData,
  onBack,
  onSaveHumanScore,
}: BatchResultsPageProps) {
  // Transform data to rows
  const [rows, setRows] = useState<ResultRow[]>(() =>
    transformToRows(documentData)
  );

  // Re-sync rows when documentData changes (e.g., after session restore)
  const lastSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const sessionId = documentData?.sessionId;
    if (sessionId && sessionId !== lastSessionIdRef.current) {
      setRows(transformToRows(documentData));
      lastSessionIdRef.current = sessionId;
    }
  }, [documentData?.sessionId, documentData?.uploadedFiles]);

  // Ref for debounce timers per row
  const saveTimersRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Visible columns
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    const visible = new Set<string>();
    ALL_COLUMNS.forEach((col) => {
      if (!("defaultHidden" in col) || !col.defaultHidden) visible.add(col.key);
    });
    return visible;
  });

  // Sorting
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Text search
  const [searchQuery, setSearchQuery] = useState("");

  // Category filters

  // Selected row for comparison dialog
  const [selectedRowForCompare, setSelectedRowForCompare] =
    useState<ResultRow | null>(null);

  // Setup Fuse.js for fuzzy search
  const fuse = useMemo(
    () =>
      new Fuse(rows, {
        keys: [
          "studyName",
          "actualOutput",
          "groundTruth",
          "entity",
          "promptTemplate",
        ],
        threshold: 0.3,
        includeScore: true,
      }),
    [rows]
  );

  // Apply all filters
  const filteredRows = useMemo(() => {
    let result = rows;

    // Apply text search
    if (searchQuery.trim()) {
      const fuseResults = fuse.search(searchQuery);
      result = fuseResults.map((r) => r.item);
    }

    // Apply category filters

    // Apply sorting
    if (sortColumn && sortDirection) {
      result = [...result].sort((a, b) => {
        const aVal = a[sortColumn as keyof ResultRow];
        const bVal = b[sortColumn as keyof ResultRow];

        if (aVal === null || aVal === undefined)
          return sortDirection === "asc" ? 1 : -1;
        if (bVal === null || bVal === undefined)
          return sortDirection === "asc" ? -1 : 1;

        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
        }

        const strA = String(aVal).toLowerCase();
        const strB = String(bVal).toLowerCase();
        return sortDirection === "asc"
          ? strA.localeCompare(strB)
          : strB.localeCompare(strA);
      });
    }

    return result;
  }, [rows, searchQuery, sortColumn, sortDirection, fuse]);

  // Toggle sort
  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      if (sortDirection === "asc") setSortDirection("desc");
      else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection("asc");
    }
  };

  // Update human eval score (0-100) with debounced save
  const updateHumanEval = useCallback(
    (rowId: string, value: number | null) => {
      // Find the row first (before state update, to capture current values)
      const currentRow = rows.find((r) => r.id === rowId);

      // Update local state immediately
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, humanEval: value } : r))
      );

      // Clear any existing debounce timer for this row
      if (saveTimersRef.current[rowId]) {
        clearTimeout(saveTimersRef.current[rowId]);
      }

      // Debounce the save call
      // Only save if we have a judge model - human scores are stored per (entity, source_model, judge_model)
      if (currentRow && onSaveHumanScore && currentRow.judgeRaw) {
        // Capture row data now to avoid stale closure
        // Use entityNameRaw (raw DB entity name) when available, fall back to display entity name
        const saveData = {
          fileId: currentRow.fileId,
          entityName: currentRow.entityNameRaw || currentRow.entity,
          sourceModel: currentRow.sourceModelRaw,
          judgeModel: currentRow.judgeRaw,
          humanScore: value,
          groundTruth: currentRow.groundTruth,
        };

        saveTimersRef.current[rowId] = setTimeout(() => {
          onSaveHumanScore(saveData).catch((err) => {
            console.error("Failed to save human score:", err);
          });
        }, 500); // 500ms debounce
      }
    },
    [rows, onSaveHumanScore]
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach((timer) =>
        clearTimeout(timer)
      );
    };
  }, []);

  // Export filtered results to Excel
  const exportToExcel = async () => {
    const [sessionMetrics, docMetrics] = await Promise.all([
      (async () => {
        try {
          const response = await authenticatedFetch(
            "/api/server/session-metrics"
          );
          const data = await response.json();
          return data.metrics || null;
        } catch (error) {
          console.warn("Failed to fetch session metrics for export:", error);
          return null;
        }
      })(),
      (async () => {
        try {
          const response = await authenticatedFetch(
            "/api/server/document-metrics"
          );
          const data = await response.json();
          return (data.documents as any[]) || [];
        } catch (error) {
          console.warn("Failed to fetch document metrics for export:", error);
          return [];
        }
      })(),
    ]);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Filtered Results");

    // TEMP DEBUG LOGS: remove after verification
    console.log("[EXPORT DEBUG] visibleColumns:", Array.from(visibleColumns));
    console.log(
      "[EXPORT DEBUG] sample row costs:",
      filteredRows[0]?.docParseCost,
      filteredRows[0]?.extractionCost,
      filteredRows[0]?.evalCost,
      filteredRows[0]?.cost
    );

    let metricsSheet: ExcelJS.Worksheet | null = null;
    if (sessionMetrics) {
      const ms = workbook.addWorksheet("Session Metrics");
      metricsSheet = ms;
      ms.columns = [
        { header: "Metric", key: "metric", width: 30 },
        { header: "Value", key: "value", width: 30 },
      ];
      ms.addRows([
        { metric: "Total Cost", value: sessionMetrics.total_cost?.toFixed(6) },
        {
          metric: "Total Latency (s)",
          value: sessionMetrics.total_latency?.toFixed(3),
        },
        { metric: "Total Calls", value: sessionMetrics.total_calls },
      ]);

      ms.addRow([]);
      ms.addRow(["By Provider"]);
      ms.addRow([
        "Provider",
        "Calls",
        "Avg Latency (s)",
        "Total Cost",
      ]);

      const providerStats = new Map<
        string,
        { calls: number; totalCost: number; totalLatency: number }
      >();
      (sessionMetrics.calls || []).forEach((call: any) => {
        const key = call.provider || "Unknown";
        const entry = providerStats.get(key) || {
          calls: 0,
          totalCost: 0,
          totalLatency: 0,
        };
        entry.calls += 1;
        entry.totalCost += call.cost || 0;
        entry.totalLatency += call.duration || 0;
        providerStats.set(key, entry);
      });

      providerStats.forEach((stats, provider) => {
        ms.addRow([
          provider,
          stats.calls,
          (stats.totalLatency / Math.max(stats.calls, 1)).toFixed(2),
          stats.totalCost.toFixed(6),
        ]);
      });

      ms.addRow([]);
      ms.addRow(["By Model"]);
      ms.addRow([
        "Model",
        "Provider",
        "Calls",
        "Avg Latency (s)",
        "Total Cost",
      ]);

      const modelStats = new Map<
        string,
        {
          provider: string;
          calls: number;
          totalCost: number;
          totalLatency: number;
        }
      >();
      (sessionMetrics.calls || []).forEach((call: any) => {
        const key = call.model || "Unknown";
        const entry = modelStats.get(key) || {
          provider: call.provider || "Unknown",
          calls: 0,
          totalCost: 0,
          totalLatency: 0,
        };
        entry.calls += 1;
        entry.totalCost += call.cost || 0;
        entry.totalLatency += call.duration || 0;
        modelStats.set(key, entry);
      });

      modelStats.forEach((stats, model) => {
        ms.addRow([
          model,
          stats.provider,
          stats.calls,
          (stats.totalLatency / Math.max(stats.calls, 1)).toFixed(2),
          stats.totalCost.toFixed(6),
        ]);
      });
    }

    // Document Processing section — sourced from DB so it persists after session restore
    if (docMetrics.length > 0) {
      const dmSheet = metricsSheet ?? workbook.addWorksheet("Session Metrics");
      dmSheet.addRow([]);
      dmSheet.addRow(["Document Processing"]);
      dmSheet.addRow([
        "Document",
        "Provider",
        "Model",
        "Latency (s)",
        "Cost ($)",
        "Pages",
        "Figures",
        "Tables",
      ]);
      docMetrics.forEach((d: any) => {
        dmSheet.addRow([
          d.document_name || "—",
          d.provider || "—",
          d.model || "—",
          d.duration != null ? Number(d.duration).toFixed(2) : "—",
          d.cost != null ? Number(d.cost).toFixed(6) : "—",
          d.page_count ?? "—",
          d.figure_count ?? "—",
          d.table_count ?? "—",
        ]);
      });
    }

    // Define columns (only visible ones)
    const visibleColumnDefs = ALL_COLUMNS.filter((col) =>
      visibleColumns.has(col.key)
    );
    worksheet.columns = visibleColumnDefs.map((col) => ({
      header: col.label,
      key: col.key,
      width: col.type === "text" ? 40 : 20,
    }));

    // Style header
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD9D9D9" },
      };
      cell.font = { name: "Arial", size: 11, bold: true };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    // Add data rows
    filteredRows.forEach((row) => {
      const rowData: Record<string, any> = {};
      visibleColumnDefs.forEach((col) => {
        const val = row[col.key as keyof ResultRow];
        if (col.type === "score" && val !== null) {
          rowData[col.key] = `${val}%`;
        } else {
          rowData[col.key] = val ?? "";
        }
      });
      const addedRow = worksheet.addRow(rowData);
      addedRow.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10 };
        cell.alignment = { vertical: "top", wrapText: false };
      });
    });

    // Generate and download
    const buffer = await workbook.xlsx.writeBuffer();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    saveAs(new Blob([buffer]), `Filtered_Results_${timestamp}.xlsx`);
  };

  // Render score cell with color coding
  const renderScoreCell = (value: number | null) => {
    if (value === null) return <span className="text-gray-400">—</span>;
    let colorClass = "text-gray-600";
    if (value >= 80) colorClass = "text-green-600 font-medium";
    else if (value >= 60) colorClass = "text-amber-600 font-medium";
    else colorClass = "text-red-600 font-medium";
    return <span className={colorClass}>{value}%</span>;
  };

  // Expandable text cell component for long content (simplified, click row to compare)
  const ExpandableTextCell = ({
    text,
    title,
    maxWidth = "150px",
  }: {
    text: string;
    title: string;
    maxWidth?: string;
  }) => {
    if (!text) return <span className="text-gray-400">—</span>;
    return (
      <div className="flex items-center gap-1" style={{ maxWidth }}>
        <span className="truncate block" style={{ maxWidth }} title={title}>
          {text}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-4">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Evaluation
            </Button>
          )}
          <div>
            <h2 className="text-xl font-semibold">Batch Results Viewer</h2>
            <p className="text-sm text-muted-foreground">
              Showing {filteredRows.length} of {rows.length} results
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Simple inline search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search results..."
              className="pl-8 w-64 h-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1 h-7 w-7 p-0"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="h-4 w-4 mr-1" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ALL_COLUMNS.filter((col) => col.key !== "systemPrompt").map(
                (col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={visibleColumns.has(col.key)}
                    onCheckedChange={(checked) => {
                      const newSet = new Set(visibleColumns);
                      if (checked) newSet.add(col.key);
                      else newSet.delete(col.key);
                      setVisibleColumns(newSet);
                    }}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Export Options</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                onClick={exportToExcel}
              >
                <div className="flex items-center gap-2 font-medium">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  <span>Export to Excel</span>
                </div>
                <span className="text-xs text-muted-foreground ml-6">
                  Contains full raw data and current filters
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                onClick={() => downloadEvaluationReport(documentData)}
              >
                <div className="flex items-center gap-2 font-medium">
                  <FileText className="h-4 w-4 text-blue-600" />
                  <span>Export Report (Word)</span>
                </div>
                <span className="text-xs text-muted-foreground ml-6">
                  Formatted Word doc with summary stats
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Data Table - full width without sidebar */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-white z-10">
            <TableRow>
              {ALL_COLUMNS.filter((col) => visibleColumns.has(col.key)).map(
                (col) => (
                  <TableHead
                    key={col.key}
                    className="cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap"
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {sortColumn === col.key &&
                        (sortDirection === "asc" ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        ))}
                    </div>
                  </TableHead>
                )
              )}
              <TableHead className="w-0 p-0"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visibleColumns.size}
                  className="text-center py-12 text-muted-foreground"
                >
                  No results match your filters
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => (
                <TableRow
                  key={row.id}
                  className="hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => setSelectedRowForCompare(row)}
                >
                  {visibleColumns.has("studyName") && (
                    <TableCell
                      className="max-w-[140px] truncate text-xs"
                      title={row.studyName}
                    >
                      {row.studyName}
                    </TableCell>
                  )}
                  {visibleColumns.has("llmSource") && (
                    <TableCell className="max-w-[100px]">
                      <Badge
                        variant="outline"
                        className="text-xs truncate max-w-[90px]"
                        title={formatModelName(row.llmSource)}
                      >
                        {formatModelName(row.llmSource)}
                      </Badge>
                    </TableCell>
                  )}
                  {visibleColumns.has("ingestion") && (
                    <TableCell
                      className="text-xs text-gray-600 max-w-[80px] truncate"
                      title={row.ingestion}
                    >
                      {row.ingestion}
                    </TableCell>
                  )}
                  {visibleColumns.has("systemPrompt") && (
                    <TableCell
                      className="max-w-[200px] truncate text-xs text-gray-500"
                      title={row.systemPrompt}
                    >
                      {row.systemPrompt}
                    </TableCell>
                  )}
                  {visibleColumns.has("promptTemplate") && (
                    <TableCell
                      className="max-w-[200px] truncate text-xs text-gray-500"
                      title={row.promptTemplate}
                    >
                      {row.promptTemplate}
                    </TableCell>
                  )}
                  {visibleColumns.has("entity") && (
                    <TableCell className="max-w-[100px]">
                      <Badge
                        variant="secondary"
                        className="text-xs truncate max-w-[90px]"
                        title={row.entity}
                      >
                        {row.entity}
                      </Badge>
                    </TableCell>
                  )}
                  {visibleColumns.has("actualOutput") && (
                    <TableCell className="max-w-[120px]">
                      <ExpandableTextCell
                        text={row.actualOutput}
                        title={`Actual Output - ${row.entity}`}
                        maxWidth="100px"
                      />
                    </TableCell>
                  )}
                  {visibleColumns.has("groundTruth") && (
                    <TableCell className="max-w-[60px]">
                      <ExpandableTextCell
                        text={row.groundTruth}
                        title={`Ground Truth - ${row.entity}`}
                        maxWidth="50px"
                      />
                    </TableCell>
                  )}
                  {visibleColumns.has("judge") && (
                    <TableCell className="max-w-[160px]">
                      {row.judge ? (
                        <Badge
                          variant="outline"
                          className="text-xs text-purple-600 border-purple-300 truncate max-w-[150px] block"
                          title={row.judge}
                        >
                          {row.judge}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has("correctness") && (
                    <TableCell className="text-xs px-1">
                      {renderScoreCell(row.correctness)}
                    </TableCell>
                  )}
                  {visibleColumns.has("completeness") && (
                    <TableCell className="text-xs px-1">
                      {renderScoreCell(row.completeness)}
                    </TableCell>
                  )}
                  {visibleColumns.has("relevance") && (
                    <TableCell className="text-xs px-1">
                      {renderScoreCell(row.relevance)}
                    </TableCell>
                  )}
                  {visibleColumns.has("safety") && (
                    <TableCell className="text-xs px-1">
                      {renderScoreCell(row.safety)}
                    </TableCell>
                  )}
                  {visibleColumns.has("humanEval") && (
                    <TableCell
                      onClick={(e) => e.stopPropagation()}
                      className="px-1"
                    >
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={row.humanEval ?? ""}
                        onChange={(e) => {
                          const val =
                            e.target.value === ""
                              ? null
                              : Math.min(
                                  100,
                                  Math.max(0, parseInt(e.target.value) || 0)
                                );
                          updateHumanEval(row.id, val);
                        }}
                        placeholder={row.judgeRaw ? "Score" : "N/A"}
                        disabled={!row.judgeRaw}
                        title={
                          !row.judgeRaw
                            ? "Run evaluation first to enable human scoring"
                            : "Enter human evaluation score (0-100)"
                        }
                        className={`h-7 text-xs w-16 text-center ${!row.judgeRaw ? "opacity-50 cursor-not-allowed" : "border-blue-300 focus:border-blue-500"}`}
                      />
                    </TableCell>
                  )}
                  {visibleColumns.has("docParseCost") && (
                    <TableCell className="text-xs text-gray-600 px-1 font-mono">
                      {row.docParseCost || "—"}
                    </TableCell>
                  )}
                  {visibleColumns.has("extractionCost") && (
                    <TableCell className="text-xs text-gray-600 px-1 font-mono">
                      {row.extractionCost || "—"}
                    </TableCell>
                  )}
                  {visibleColumns.has("evalCost") && (
                    <TableCell className="text-xs text-gray-600 px-1 font-mono">
                      {row.evalCost || "—"}
                    </TableCell>
                  )}
                  {visibleColumns.has("parseLatency") && (
                    <TableCell className="text-xs text-gray-600 px-1 font-mono">
                      {row.parseLatency != null ? row.parseLatency.toFixed(2) : "—"}
                    </TableCell>
                  )}
                  {visibleColumns.has("extractionLatency") && (
                    <TableCell className="text-xs text-gray-600 px-1 font-mono">
                      {row.extractionLatency != null ? row.extractionLatency.toFixed(2) : "—"}
                    </TableCell>
                  )}
                  {visibleColumns.has("evalLatency") && (
                    <TableCell className="text-xs text-gray-600 px-1 font-mono">
                      {row.evalLatency != null ? row.evalLatency.toFixed(2) : "—"}
                    </TableCell>
                  )}
                  {/* Compare button removed, row is clickable */}
                  <TableCell className="w-0 p-0" />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Comparison Dialog */}
      <Dialog
        open={!!selectedRowForCompare}
        onOpenChange={(open) => !open && setSelectedRowForCompare(null)}
      >
        <DialogContent className="max-w-[90vw] w-[90vw] sm:max-w-[90vw] h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-6 pb-2 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-2xl">
              Compare & Score
              <Badge variant="outline" className="text-base font-normal">
                {selectedRowForCompare?.studyName}
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-base mt-2">
              Review the output and provide a score.
            </DialogDescription>
          </DialogHeader>

          {selectedRowForCompare && (
            <div className="flex-1 overflow-hidden flex flex-col p-6 pt-4 gap-6">
              {/* Metadata & LLM Scores */}
              <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                  <Badge variant="secondary" className="text-sm px-3 py-1">
                    {selectedRowForCompare.llmSource}
                  </Badge>
                  <span className="text-muted-foreground">vs</span>
                  <span className="font-medium">Ground Truth</span>
                </div>

                <div className="flex gap-6 text-sm items-center bg-gray-50 px-4 py-2 rounded-full border">
                  <span className="font-medium text-gray-500">
                    Auto-Eval Scores:
                  </span>
                  {selectedRowForCompare.correctness !== null && (
                    <span className="font-medium">
                      Correctness:{" "}
                      <span
                        className={
                          selectedRowForCompare.correctness >= 80
                            ? "text-green-600"
                            : "text-amber-600"
                        }
                      >
                        {selectedRowForCompare.correctness}%
                      </span>
                    </span>
                  )}
                  {selectedRowForCompare.completeness !== null && (
                    <span className="font-medium">
                      Completeness:{" "}
                      <span
                        className={
                          selectedRowForCompare.completeness >= 80
                            ? "text-green-600"
                            : "text-amber-600"
                        }
                      >
                        {selectedRowForCompare.completeness}%
                      </span>
                    </span>
                  )}
                  {selectedRowForCompare.relevance !== null && (
                    <span className="font-medium">
                      Relevance:{" "}
                      <span
                        className={
                          selectedRowForCompare.relevance >= 80
                            ? "text-green-600"
                            : "text-amber-600"
                        }
                      >
                        {selectedRowForCompare.relevance}%
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {/* User Prompt Accordion */}
              <Accordion type="single" collapsible className="w-full shrink-0">
                <AccordionItem
                  value="user-prompt"
                  className="border rounded-md px-4 py-0"
                >
                  <AccordionTrigger className="py-2 hover:no-underline hover:bg-gray-50/50 rounded-t-md text-sm text-gray-600 font-medium">
                    View User Prompt
                  </AccordionTrigger>
                  <AccordionContent>
                    <ScrollArea className="h-[120px] w-full rounded-md border p-4 bg-gray-50 text-sm text-muted-foreground whitespace-pre-wrap font-mono mt-2">
                      {selectedRowForCompare.promptTemplate ||
                        selectedRowForCompare.systemPrompt ||
                        "No prompt available"}
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Side by side comparison */}
              <div className="grid grid-cols-2 gap-6 flex-1 min-h-0 grid-rows-1">
                <div className="flex flex-col h-full border rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gray-50 p-3 border-b font-medium text-gray-700 flex justify-between items-center">
                    <span>Actual Output (LLM)</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto bg-white">
                    <div className="p-4 whitespace-pre-wrap text-base leading-relaxed text-gray-800">
                      {selectedRowForCompare.actualOutput || (
                        <span className="text-gray-400 italic">No output</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col h-full border rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gray-50 p-3 border-b font-medium text-gray-700">
                    <span>Ground Truth</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto bg-white">
                    <div className="p-4 whitespace-pre-wrap text-base leading-relaxed text-gray-800">
                      {selectedRowForCompare.groundTruth || (
                        <span className="text-gray-400 italic">
                          No ground truth
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Human Eval Score Footer */}
              <div className="flex items-center justify-between p-4 bg-gray-50 border rounded-xl shrink-0 mt-2">
                <div className="flex items-center gap-4">
                  <Label className="font-semibold text-lg">Your Score:</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={selectedRowForCompare.humanEval ?? ""}
                      onChange={(e) => {
                        const val =
                          e.target.value === ""
                            ? null
                            : Math.min(
                                100,
                                Math.max(0, parseInt(e.target.value) || 0)
                              );
                        updateHumanEval(selectedRowForCompare.id, val);
                        setSelectedRowForCompare({
                          ...selectedRowForCompare,
                          humanEval: val,
                        });
                      }}
                      className="w-24 text-center text-xl font-bold h-12 pr-8 border-2 border-primary/20 focus-visible:border-primary"
                      placeholder="-"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                      %
                    </span>
                  </div>
                  <div className="flex flex-col text-xs text-muted-foreground ml-2">
                    <span>0 = Poor</span>
                    <span>100 = Perfect</span>
                  </div>
                </div>
                <Button
                  size="lg"
                  className="px-8"
                  onClick={() => setSelectedRowForCompare(null)}
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
