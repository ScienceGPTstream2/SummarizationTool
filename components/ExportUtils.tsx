import { asBlob } from "html-docx-js-typescript";
import { DocumentData } from "../App";

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

/**
 * Escape text for safe HTML embedding (only for plain text, NOT for content that's already HTML).
 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

/**
 * Build the full HTML document for the Word export.
 * The extracted content is inserted as-is (it may contain HTML tables).
 */
const buildHtmlDocument = (documentData: DocumentData): string => {
  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Build entity rows
  const entityRows = documentData.entities
    .map((entity) => {
      const extracted = entity.extracted || "No result";
      const meta = entity.duration
        ? `<p style="color: #808080; font-size: 9pt; margin-top: 4px;">Time: ${entity.duration.toFixed(2)}s, Tokens: ${entity.promptTokens} (in) / ${entity.completionTokens} (out)</p>`
        : "";

      return `
      <tr>
        <td style="padding: 6px 8px; border: 1px solid #ccc; vertical-align: top; font-weight: 500;">
          ${escapeHtml(entity.name)}
        </td>
        <td style="padding: 6px 8px; border: 1px solid #ccc; vertical-align: top; font-size: 9pt;">
          ${escapeHtml(entity.prompt.substring(0, 200) + (entity.prompt.length > 200 ? "..." : ""))}
        </td>
        <td style="padding: 6px 8px; border: 1px solid #ccc; vertical-align: top;">
          ${extracted}
          ${meta}
        </td>
      </tr>`;
    })
    .join("\n");

  // Build complete entity prompts section
  const entityPrompts = documentData.entities
    .map(
      (entity, index) => `
      <h3>${index + 1}. ${escapeHtml(entity.name)}</h3>
      <pre style="background: #f5f5f5; padding: 8px; border: 1px solid #ddd; white-space: pre-wrap; word-wrap: break-word; font-size: 9pt;">${escapeHtml(entity.prompt)}</pre>
    `
    )
    .join("\n");

  // Final summary - insert as-is since it may contain HTML
  const finalSummary = documentData.finalSummary || "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: Calibri, Arial, sans-serif;
      font-size: 11pt;
      color: #333;
      line-height: 1.4;
    }
    h1 {
      text-align: center;
      color: #1F4E79;
      font-size: 18pt;
      margin-bottom: 4px;
    }
    h2 {
      color: #1F4E79;
      font-size: 14pt;
      border-bottom: 2px solid #D6E4F0;
      padding-bottom: 4px;
      margin-top: 20px;
    }
    h3 {
      color: #2E75B6;
      font-size: 12pt;
      margin-top: 14px;
    }
    .subtitle {
      text-align: center;
      color: #888;
      font-size: 10pt;
      margin-bottom: 20px;
    }
    .config-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    .config-table td {
      padding: 6px 10px;
      border: 1px solid #B4C6E7;
    }
    .config-label {
      background: #F2F7FB;
      color: #44546A;
      font-weight: bold;
      width: 30%;
    }
    .entity-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    .entity-table th {
      background: #E9EFF7;
      color: #1F4E79;
      padding: 8px;
      border: 1px solid #B4C6E7;
      text-align: center;
      font-size: 10pt;
    }
    .entity-table td {
      border: 1px solid #ccc;
      padding: 6px 8px;
      vertical-align: top;
      font-size: 10pt;
    }
    /* Style for any HTML tables inside extracted content */
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 8px 0;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 4px 6px;
      font-size: 9pt;
    }
    th {
      background: #f0f0f0;
      font-weight: 500;
    }
    caption {
      font-weight: 500;
      margin-bottom: 4px;
      text-align: left;
    }
  </style>
</head>
<body>
  <h1>AI Document Summarization Report</h1>
  <p class="subtitle">Generated on: ${escapeHtml(currentDate)}</p>

  <h2>Pipeline Configuration</h2>
  <table class="config-table">
    <tr>
      <td class="config-label">Document</td>
      <td>${escapeHtml(documentData.file?.name || "Unknown document")}</td>
    </tr>
    <tr>
      <td class="config-label">Parser Used</td>
      <td>${escapeHtml(getParserName(documentData.parser))}</td>
    </tr>
    <tr>
      <td class="config-label">Study Type</td>
      <td>${escapeHtml(getStudyTypeName(documentData.studyType))}</td>
    </tr>
    <tr>
      <td class="config-label">AI Model</td>
      <td>${escapeHtml(getModelName(documentData.selectedModel))}</td>
    </tr>
  </table>

  <h2>Entity Extraction Configuration</h2>
  <table class="entity-table">
    <tr>
      <th style="width: 25%;">Entity</th>
      <th style="width: 50%;">Extraction Prompt</th>
      <th style="width: 25%;">Extracted Result</th>
    </tr>
    ${entityRows}
  </table>

  <h2>Final Summary</h2>
  <div>${finalSummary}</div>

  <h2>Complete Entity Prompts</h2>
  ${entityPrompts}
</body>
</html>`;
};

export const generateWordDocument = async (
  documentData: DocumentData
): Promise<Blob> => {
  const htmlContent = buildHtmlDocument(documentData);
  const blob = (await asBlob(htmlContent)) as Blob;
  return blob;
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
