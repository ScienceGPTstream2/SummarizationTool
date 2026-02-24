import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType,
  VerticalAlign,
  AlignmentType,
  BorderStyle,
  TextRun,
  ShadingType,
  FileChild,
} from "docx";
import { MarkdownDocx } from "markdown-docx";
import { DocumentData } from "../App";

// Professional color palette (matching wordExport.ts)
const COLORS = {
  primary: "1F4E79",
  sectionBg: "D6E4F0",
  sectionText: "1F4E79",
  subsectionText: "2E75B6",
  headerBg: "E9EFF7",
  headerText: "1F4E79",
  labelBg: "F2F7FB",
  labelText: "44546A",
  borderColor: "B4C6E7",
  bodyText: "333333",
};

const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.borderColor },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.borderColor },
  left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.borderColor },
  right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.borderColor },
  insideHorizontal: {
    style: BorderStyle.SINGLE,
    size: 1,
    color: COLORS.borderColor,
  },
  insideVertical: {
    style: BorderStyle.SINGLE,
    size: 1,
    color: COLORS.borderColor,
  },
};

// Get parser name from ID
const getParserName = (parserId: string): string => {
  const parserNames: Record<string, string> = {
    docling: "Docling",
    "azure-document-intelligence": "Azure Document Intelligence",
    mineru: "MinerU",
    marker: "Marker",
    pymupdf4llm: "PyMuPDF4LLM",
    "gpt4-vision": "GPT 4.1 Vision Model",
  };
  return parserNames[parserId] || parserId;
};

// Get model name from ID
const getModelName = (modelId: string): string => {
  if (!modelId) return "Unknown";
  if (modelId.includes("@")) {
    const baseName = modelId.split("@")[0];
    return baseName
      .split("-")
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  const modelNames: Record<string, string> = {
    "gpt-4o": "GPT-4o",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-4.1": "GPT-4.1",
    "gpt-5": "GPT-5",
    "gpt-4o-mini": "GPT-4o Mini",
    "claude-3-opus": "Claude 3 Opus",
    "claude-3-sonnet": "Claude 3 Sonnet",
    "claude-3-haiku": "Claude 3 Haiku",
    "llama-3.1-405b": "Llama 3.1 405B",
    "llama-3.1-70b": "Llama 3.1 70B",
    "llama-3.1-8b": "Llama 3.1 8B",
  };
  return modelNames[modelId] || modelId;
};

// Get study type name from ID
const getStudyTypeName = (studyTypeId: string): string => {
  const studyTypeNames: Record<string, string> = {
    "clinical-trial": "Clinical Trial",
    observational: "Observational Study",
    "meta-analysis": "Meta-Analysis",
    "case-study": "Case Study",
    review: "Literature Review",
    "level-1-in-vivo": "Level 1 - In vivo",
    "level-2-in-vivo": "Level 2 - In vivo",
  };
  return studyTypeNames[studyTypeId] || studyTypeId;
};

const createSectionHeading = (
  text: string,
  options?: { pageBreakBefore?: boolean }
): Paragraph =>
  new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        size: 28,
        color: COLORS.sectionText,
        font: "Calibri",
      }),
    ],
    spacing: { before: options?.pageBreakBefore ? 0 : 360, after: 200 },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 6,
        color: COLORS.sectionBg,
        space: 4,
      },
    },
    pageBreakBefore: options?.pageBreakBefore || false,
  });

const createSubsectionHeading = (text: string): Paragraph =>
  new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        size: 24,
        color: COLORS.subsectionText,
        font: "Calibri",
      }),
    ],
    spacing: { before: 200, after: 100 },
  });

const createConfigLabelCell = (text: string): TableCell =>
  new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: true,
            color: COLORS.labelText,
            font: "Calibri",
          }),
        ],
      }),
    ],
    shading: { fill: COLORS.labelBg, type: ShadingType.CLEAR },
    width: { size: 30, type: WidthType.PERCENTAGE },
  });

const createConfigValueCell = (text: string): TableCell =>
  new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text, color: COLORS.bodyText, font: "Calibri" }),
        ],
      }),
    ],
    width: { size: 70, type: WidthType.PERCENTAGE },
  });

const createHeaderCell = (text: string, widthPercent?: number): TableCell =>
  new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            size: 18,
            bold: true,
            color: COLORS.headerText,
            font: "Calibri",
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    ],
    shading: { fill: COLORS.headerBg, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER,
    ...(widthPercent
      ? { width: { size: widthPercent, type: WidthType.PERCENTAGE } }
      : {}),
  });

// ────────── markdown → docx conversion ──────────

/** Decode common HTML entities in text. */
const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

/** Parse a single HTML table string into markdown. */
const convertOneHtmlTable = (tableHtml: string): string => {
  const rows: string[][] = [];
  let caption = "";

  const captionMatch = tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
  if (captionMatch) {
    caption = decodeHtmlEntities(
      captionMatch[1].replace(/<[^>]+>/g, "").trim()
    );
  }

  const rowMatches = tableHtml.match(
    /<tr[^>]*>[\s\S]*?(?:<\/tr>|(?=<tr[^>]*>)|$)/gi
  );
  if (!rowMatches) return tableHtml;

  let hasHeader = false;

  rowMatches.forEach((rowHtml) => {
    const cells: string[] = [];
    const cellRegex =
      /<(th|td)\b([^>]*)>([\s\S]*?)(?:<\/\1>|(?=<(?:th|td|tr)\b)|$)/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const tag = cellMatch[1].toLowerCase();
      const attrs = cellMatch[2] || "";
      const colspanMatch = attrs.match(/colspan\s*=\s*"?(\d+)"?/i);
      const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) : 1;
      const cellText = decodeHtmlEntities(
        cellMatch[3].replace(/<[^>]+>/g, "").trim()
      );

      if (tag === "th") hasHeader = true;

      cells.push(cellText);
      for (let i = 1; i < colspan; i++) {
        cells.push("");
      }
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  });

  if (rows.length === 0) return tableHtml;

  const maxCols = Math.max(...rows.map((r) => r.length));
  rows.forEach((row) => {
    while (row.length < maxCols) row.push("");
  });

  let md = "";
  if (caption) md += `**${caption}**\n\n`;

  if (hasHeader && rows.length > 0) {
    md += "| " + rows[0].join(" | ") + " |\n";
    md += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
    rows.slice(1).forEach((row) => {
      md += "| " + row.join(" | ") + " |\n";
    });
  } else {
    md += "| " + rows[0].map((_, i) => `Col ${i + 1}`).join(" | ") + " |\n";
    md += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
    rows.forEach((row) => {
      md += "| " + row.join(" | ") + " |\n";
    });
  }

  return md;
};

/** Convert HTML tables to markdown tables so markdown-docx can render them. */
const htmlTablesToMarkdown = (text: string): string => {
  if (!text.includes("<table")) return text;

  let result = text.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (match) =>
    convertOneHtmlTable(match)
  );

  if (result.includes("<table")) {
    result = result.replace(/<table[^>]*>[\s\S]*$/gi, (match) =>
      convertOneHtmlTable(match)
    );
  }

  return result;
};

/**
 * Convert markdown text into an array of docx FileChild elements using markdown-docx.
 * Supports: tables (markdown & HTML), bold, italic, lists, code blocks, headings, links, etc.
 * Falls back to a plain text paragraph if input is empty.
 */
const markdownToDocxElements = async (text: string): Promise<FileChild[]> => {
  if (!text) return [new Paragraph({ text: "" })];

  try {
    const normalizedText = htmlTablesToMarkdown(text);
    const converter = new MarkdownDocx(normalizedText, {
      ignoreImage: true,
      gfm: true,
    });
    const elements = await converter.toSection();
    return elements.length > 0 ? elements : [new Paragraph({ text: "" })];
  } catch {
    return [
      new Paragraph({
        children: [new TextRun({ text, size: 16, font: "Calibri" })],
      }),
    ];
  }
};

// ────────── Export interface ──────────

export interface EntityExportOptions {
  /** The currently selected model ID so export shows model-specific results */
  selectedModel?: string;
  /** The summary / paragraph prompt used for final summary generation */
  summaryPrompt?: string;
  /** The paragraph system prompt */
  paragraphSystemPrompt?: string;
}

/**
 * Generate a Word document for Entity Extraction results.
 * Uses the docx library for proper table rendering of markdown content.
 */
export const generateWordDocument = async (
  documentData: DocumentData,
  options?: EntityExportOptions
): Promise<Blob> => {
  const selectedModel =
    options?.selectedModel || documentData.selectedModel || "";

  // ── Resolve model-specific extracted text for each entity ──
  const resolvedEntities = documentData.entities.map((entity) => {
    // Prefer extractionsByModel for the selected model
    const modelExtraction = selectedModel
      ? entity.extractionsByModel?.[selectedModel]
      : undefined;
    const extracted = modelExtraction?.extracted ?? entity.extracted ?? "";
    const duration = modelExtraction?.duration ?? entity.duration;
    const promptTokens = modelExtraction?.promptTokens ?? entity.promptTokens;
    const completionTokens =
      modelExtraction?.completionTokens ?? entity.completionTokens;
    return { ...entity, extracted, duration, promptTokens, completionTokens };
  });

  // ── Resolve model-specific final summary ──
  const fileData = documentData as any;
  const finalSummary =
    (selectedModel && fileData.summariesByModel?.[selectedModel]) ||
    documentData.finalSummary ||
    "";

  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const sections: (Paragraph | Table)[] = [];

  // ══════ TITLE ══════
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "AI Document Summarization Report",
          bold: true,
          size: 36,
          color: COLORS.primary,
          font: "Calibri",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    })
  );
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated on: ${currentDate}`,
          size: 20,
          color: "888888",
          font: "Calibri",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // ══════ PIPELINE CONFIGURATION ══════
  sections.push(createSectionHeading("Pipeline Configuration"));

  sections.push(
    new Table({
      rows: [
        new TableRow({
          children: [
            createConfigLabelCell("Document"),
            createConfigValueCell(
              documentData.file?.name || "Unknown document"
            ),
          ],
        }),
        new TableRow({
          children: [
            createConfigLabelCell("Parser Used"),
            createConfigValueCell(getParserName(documentData.parser)),
          ],
        }),
        new TableRow({
          children: [
            createConfigLabelCell("Study Type"),
            createConfigValueCell(getStudyTypeName(documentData.studyType)),
          ],
        }),
        new TableRow({
          children: [
            createConfigLabelCell("AI Model"),
            createConfigValueCell(getModelName(selectedModel)),
          ],
        }),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
    })
  );

  // ══════ ENTITY EXTRACTION RESULTS ══════
  sections.push(createSectionHeading("Entity Extraction Configuration"));

  // Build header row
  const entityTableRows: TableRow[] = [
    new TableRow({
      children: [
        createHeaderCell("Entity", 15),
        createHeaderCell("Extraction Prompt", 40),
        createHeaderCell("Extracted Result", 45),
      ],
    }),
  ];

  // Build data rows — convert extracted markdown → docx elements for proper table rendering
  for (const entity of resolvedEntities) {
    const extractedElements = (await markdownToDocxElements(
      entity.extracted || "No result"
    )) as (Paragraph | Table)[];

    // Add metadata line if available
    if (entity.duration) {
      extractedElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Time: ${entity.duration.toFixed(2)}s, Tokens: ${entity.promptTokens ?? 0} (in) / ${entity.completionTokens ?? 0} (out)`,
              size: 14,
              color: "808080",
              font: "Calibri",
              italics: true,
            }),
          ],
          spacing: { before: 60 },
        })
      );
    }

    entityTableRows.push(
      new TableRow({
        children: [
          // Entity name
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: entity.name,
                    bold: true,
                    size: 18,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
            verticalAlign: VerticalAlign.TOP,
            width: { size: 15, type: WidthType.PERCENTAGE },
          }),
          // Full extraction prompt (NOT truncated)
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: entity.prompt || "",
                    size: 16,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
            verticalAlign: VerticalAlign.TOP,
            width: { size: 40, type: WidthType.PERCENTAGE },
          }),
          // Extracted result (rendered from markdown)
          new TableCell({
            children: extractedElements,
            verticalAlign: VerticalAlign.TOP,
            width: { size: 45, type: WidthType.PERCENTAGE },
          }),
        ],
      })
    );
  }

  sections.push(
    new Table({
      rows: entityTableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
    })
  );

  // ══════ SUMMARY PROMPT (if available) ══════
  const summaryPrompt =
    options?.summaryPrompt || (documentData as any).summaryPrompt || "";
  const paragraphSystemPrompt =
    options?.paragraphSystemPrompt ||
    (documentData as any).paragraphSystemPrompt ||
    "";

  if (summaryPrompt || paragraphSystemPrompt) {
    sections.push(
      createSectionHeading("Summary Generation Configuration", {
        pageBreakBefore: true,
      })
    );

    if (paragraphSystemPrompt) {
      sections.push(createSubsectionHeading("System Prompt"));
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: paragraphSystemPrompt,
              size: 18,
              font: "Calibri",
              color: COLORS.bodyText,
            }),
          ],
          spacing: { after: 200 },
        })
      );
    }

    if (summaryPrompt) {
      sections.push(createSubsectionHeading("Summary Prompt"));
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: summaryPrompt,
              size: 18,
              font: "Calibri",
              color: COLORS.bodyText,
            }),
          ],
          spacing: { after: 200 },
        })
      );
    }
  }

  // ══════ FINAL SUMMARY ══════
  if (finalSummary) {
    sections.push(
      createSectionHeading("Final Summary", {
        pageBreakBefore: !summaryPrompt && !paragraphSystemPrompt,
      })
    );

    const summaryElements = (await markdownToDocxElements(finalSummary)) as (
      | Paragraph
      | Table
    )[];
    sections.push(...summaryElements);
  }

  // ══════ COMPLETE ENTITY PROMPTS ══════
  sections.push(
    createSectionHeading("Complete Entity Prompts", { pageBreakBefore: true })
  );

  for (let i = 0; i < resolvedEntities.length; i++) {
    const entity = resolvedEntities[i];
    sections.push(createSubsectionHeading(`${i + 1}. ${entity.name}`));
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: entity.prompt || "",
            size: 16,
            font: "Calibri",
            color: COLORS.bodyText,
          }),
        ],
        spacing: { after: 200 },
      })
    );
  }

  // ══════ ASSEMBLE DOCUMENT ══════
  const doc = new Document({
    sections: [
      {
        children: sections as FileChild[],
      },
    ],
  });

  return await Packer.toBlob(doc);
};

export const generateMarkdownDocument = (
  documentData: DocumentData
): string => {
  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const markdown = `# AI Document Summarization Report

*Generated on: ${currentDate}*

## Pipeline Configuration

- **Document**: ${documentData.file?.name || "Unknown document"}
- **Parser Used**: ${getParserName(documentData.parser)}
- **Study Type**: ${getStudyTypeName(documentData.studyType)}
- **AI Model**: ${getModelName(documentData.selectedModel)}

## Entity Extraction Results

| Entity | Extracted Information |
|--------|----------------------|
${documentData.entities
  .filter((e) => e.extracted)
  .map((entity) => {
    const meta = entity.duration
      ? `<br><small>Time: ${entity.duration.toFixed(2)}s, Tokens: ${entity.promptTokens} (in) / ${entity.completionTokens} (out)</small>`
      : "";
    return `| **${entity.name}** | ${entity.extracted}${meta} |`;
  })
  .join("\n")}

## Final Summary

${documentData.finalSummary}

## Complete Entity Extraction Configuration

The following entities were configured for extraction:

${documentData.entities
  .map(
    (entity, index) => `
### ${index + 1}. ${entity.name}

**Prompt:**
\`\`\`
${entity.prompt}
\`\`\`

**Result:**
${entity.extracted || "No specific information found in the document."}
${entity.duration ? `\n<small>Time: ${entity.duration.toFixed(2)}s, Tokens: ${entity.promptTokens} (in) / ${entity.completionTokens} (out)</small>` : ""}

`
  )
  .join("\n")}

---

*This report was generated using the AI Document Summarization Tool*
`;

  return markdown;
};

export const downloadFile = (
  content: Blob | string,
  filename: string,
  mimeType: string
) => {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
