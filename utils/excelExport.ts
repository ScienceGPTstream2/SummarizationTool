import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { DocumentData } from "../App";
import { authenticatedFetch } from "./authUtils";

type EvaluationMetric = {
  metric_name: string;
  score: number;
};

type EvaluationResult = {
  model?: string;
  metrics?: EvaluationMetric[];
  evaluation_cost?: number;
};

type ExtractionData = {
  extracted?: string;
  evaluationResults?: EvaluationResult[];
};

type UploadFileData = {
  file?: { name?: string } | null;
  fileId?: string;
  entities?: Array<Record<string, unknown>>;
  selectedModel?: string;
  processorUsed?: string;
};

type SessionCallMetric = {
  provider?: string;
  model?: string;
  duration?: number;
  cost?: number;
};

type SessionMetrics = {
  total_cost?: number;
  total_latency?: number;
  total_calls?: number;
  calls?: SessionCallMetric[];
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

// Helper to safely get metric score
const getMetricScore = (
  result: EvaluationResult | undefined,
  metricName: string
): string => {
  if (!result || !result.metrics) return "";
  const metric = result.metrics.find((m) =>
    m.metric_name.toLowerCase().includes(metricName.toLowerCase())
  );
  return metric ? `${(metric.score * 100).toFixed(0)}%` : "";
};

const formatCost = (value: number | undefined | null): string => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "";
  }
  return Number(value).toFixed(6);
};

export async function downloadExcelReport(documentData: DocumentData) {
  const sessionMetrics: SessionMetrics | null = await (async () => {
    try {
      const response = await authenticatedFetch("/api/server/session-metrics");
      const data: { metrics?: SessionMetrics } = await response.json();
      return data.metrics || null;
    } catch (error) {
      console.warn("Failed to fetch session metrics for export:", error);
      return null;
    }
  })();

  // 1. Prepare Data
  const rows: Record<string, string>[] = [];

  // Normalize file list
  let filesToProcess: UploadFileData[] = [];
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
    const ingestionTool =
      (fileItem as any).selectedParser ||
      (documentData as any).selectedParser ||
      (documentData as any).parser ||
      fileItem.processorUsed ||
      documentData.processorUsed ||
      "";
    const entities = fileItem.entities || [];
    const docParseCost = (fileItem as any).processingResult?.parse_cost ?? "";

    for (const entity of entities) {
      const entityName = (entity as { name?: string }).name || "";
      const promptTemplate = (entity as { prompt?: string }).prompt || "";
      const systemPrompt =
        (entity as { systemPrompt?: string }).systemPrompt ||
        "You are an expert toxicologist...";
      const groundTruth =
        (entity as { groundTruth?: string }).groundTruth || "";

      // Identify Source Models
      const extractionsByModel = (
        entity as { extractionsByModel?: Record<string, ExtractionData> }
      ).extractionsByModel;
      let sourceModels = Object.keys(extractionsByModel || {});

      if (
        sourceModels.length === 0 &&
        Boolean((entity as { extracted?: string }).extracted)
      ) {
        const singleModel =
          fileItem.selectedModel ||
          documentData.selectedModel ||
          "Default Model";
        sourceModels = [singleModel];
      }

      for (const sourceModel of sourceModels) {
        let extractionData = extractionsByModel?.[sourceModel];

        // Fallback
        if (
          !extractionData &&
          sourceModel === (fileItem.selectedModel || documentData.selectedModel)
        ) {
          extractionData = {
            extracted: (entity as { extracted?: string }).extracted,
            evaluationResults: (
              entity as { evaluationResults?: EvaluationResult[] }
            ).evaluationResults,
          };
        }

        if (!extractionData) continue;

        const actualOutput = extractionData.extracted || "";
        const evalResults = extractionData.evaluationResults || [];

        if (evalResults.length === 0) {
          rows.push({
            "Study Name": fileName,
            "LLM (Source)": getDisplayModelName(sourceModel),
            Ingestion: ingestionTool,
            "System Prompt": systemPrompt,
            "Prompt Template": promptTemplate,
            Entity: entityName,
            "Actual Output": actualOutput,
            "Ground Truth": groundTruth,
            Judge: "",
            Correctness: "",
            Completeness: "",
            Relevance: "",
            Safety: "",
            "Human Eval": "",
            "Doc Parse Cost": formatCost(docParseCost as number),
            "Extraction Cost": formatCost(
              (extractionData as any)?.cost as number
            ),
            "Eval Cost": "",
          });
        } else {
          for (const result of evalResults) {
            rows.push({
              "Study Name": fileName,
              "LLM (Source)": getDisplayModelName(sourceModel),
              Ingestion: ingestionTool,
              "System Prompt": systemPrompt,
              "Prompt Template": promptTemplate,
              Entity: entityName,
              "Actual Output": actualOutput,
              "Ground Truth": groundTruth,
              Judge: getDisplayModelName(result.model || "Unknown Judge"),
              Correctness: getMetricScore(result, "correctness"),
              Completeness: getMetricScore(result, "completeness"),
              Relevance: getMetricScore(result, "relevance"),
              Safety: getMetricScore(result, "safety"),
              "Human Eval": "",
              "Doc Parse Cost": formatCost(docParseCost as number),
              "Extraction Cost": formatCost(
                (extractionData as any)?.cost as number
              ),
              "Eval Cost": formatCost(result.evaluation_cost),
            });
          }
        }
      }
    }
  }

  // 2. Create Workbook and Worksheet with ExcelJS
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Evaluation Results");

  if (sessionMetrics) {
    const metricsSheet = workbook.addWorksheet("Session Metrics");
    metricsSheet.columns = [
      { header: "Metric", key: "metric", width: 30 },
      { header: "Value", key: "value", width: 30 },
    ];
    metricsSheet.addRows([
      { metric: "Total Cost", value: sessionMetrics.total_cost?.toFixed(6) },
      {
        metric: "Total Latency (s)",
        value: sessionMetrics.total_latency?.toFixed(3),
      },
      { metric: "Total Calls", value: sessionMetrics.total_calls },
    ]);

    metricsSheet.addRow([]);
    metricsSheet.addRow([{ metric: "By Provider" }]);
    metricsSheet.addRow([
      { metric: "Provider" },
      { metric: "Calls" },
      { metric: "Avg Latency (s)" },
      { metric: "Total Cost" },
    ]);

    const providerStats = new Map<
      string,
      { calls: number; totalCost: number; totalLatency: number }
    >();
    (sessionMetrics.calls || []).forEach((call: SessionCallMetric) => {
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
      metricsSheet.addRow([
        { metric: provider },
        { metric: stats.calls },
        { metric: (stats.totalLatency / Math.max(stats.calls, 1)).toFixed(2) },
        { metric: stats.totalCost.toFixed(6) },
      ]);
    });

    metricsSheet.addRow([]);
    metricsSheet.addRow([{ metric: "By Model" }]);
    metricsSheet.addRow([
      { metric: "Model" },
      { metric: "Provider" },
      { metric: "Calls" },
      { metric: "Avg Latency (s)" },
      { metric: "Total Cost" },
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
    (sessionMetrics.calls || []).forEach((call: SessionCallMetric) => {
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
      metricsSheet.addRow([
        { metric: model },
        { metric: stats.provider },
        { metric: stats.calls },
        { metric: (stats.totalLatency / Math.max(stats.calls, 1)).toFixed(2) },
        { metric: stats.totalCost.toFixed(6) },
      ]);
    });
  }

  // Define Columns
  worksheet.columns = [
    { header: "Study Name", key: "Study Name", width: 25 },
    { header: "LLM (Source)", key: "LLM (Source)", width: 20 },
    { header: "Ingestion", key: "Ingestion", width: 15 },
    { header: "System Prompt", key: "System Prompt", width: 50 },
    { header: "Prompt Template", key: "Prompt Template", width: 80 },
    { header: "Entity", key: "Entity", width: 15 },
    { header: "Actual Output", key: "Actual Output", width: 50 },
    { header: "Ground Truth", key: "Ground Truth", width: 40 },
    { header: "Judge", key: "Judge", width: 15 },
    { header: "Correctness", key: "Correctness", width: 25 },
    { header: "Completeness", key: "Completeness", width: 25 },
    { header: "Relevance", key: "Relevance", width: 25 },
    { header: "Safety", key: "Safety", width: 25 },
    { header: "Human Eval", key: "Human Eval", width: 25 },
    { header: "Doc Parse Cost", key: "Doc Parse Cost", width: 15 },
    { header: "Extraction Cost", key: "Extraction Cost", width: 15 },
    { header: "Eval Cost", key: "Eval Cost", width: 15 },
  ];

  // Style Header Row
  // Freeze top row
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD9D9D9" }, // Light Gray (readable)
    };
    cell.font = {
      name: "Arial",
      size: 11,
      bold: true,
      color: { argb: "FF000000" }, // Black text
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "thin" },
    };
  });

  // Style Data Rows
  rows.forEach((row) => {
    const addedRow = worksheet.addRow(row);
    addedRow.eachCell((cell) => {
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { vertical: "top", wrapText: false }; // Disable wrap text as requested
    });
  });

  // 3. Generate File
  const buffer = await workbook.xlsx.writeBuffer();
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `Evaluation_Report_${timestamp}.xlsx`
  );
}
