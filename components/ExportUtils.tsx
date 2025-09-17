import { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, WidthType, AlignmentType, HeadingLevel } from 'docx';
import { DocumentData } from '../App';

// Get parser name from ID
const getParserName = (parserId: string): string => {
  const parserNames = {
    'docling': 'Docling',
    'azure-document-intelligence': 'Azure Document Intelligence',
    'mineru': 'MinerU',
    'marker': 'Marker',
    'pymupdf4llm': 'PyMuPDF4LLM',
    'gpt4-vision': 'GPT 4.1 Vision Model',
    'gemini-vision': 'Gemini Vision Model',
  };
  return parserNames[parserId as keyof typeof parserNames] || parserId;
};

// Get model name from ID
const getModelName = (modelId: string): string => {
  const modelNames = {
    'gpt-4o': 'GPT-4o',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'gpt-4.1': 'GPT-4.1',
    'gpt-5': 'GPT-5',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gemini-pro': 'Gemini Pro',
    'gemini-ultra': 'Gemini Ultra',
    'gemini-flash': 'Gemini Flash',
    'claude-3-opus': 'Claude 3 Opus',
    'claude-3-sonnet': 'Claude 3 Sonnet',
    'claude-3-haiku': 'Claude 3 Haiku',
    'llama-3.1-405b': 'Llama 3.1 405B',
    'llama-3.1-70b': 'Llama 3.1 70B',
    'llama-3.1-8b': 'Llama 3.1 8B',
  };
  return modelNames[modelId as keyof typeof modelNames] || modelId;
};

// Get study type name from ID
const getStudyTypeName = (studyTypeId: string): string => {
  const studyTypeNames = {
    'clinical-trial': 'Clinical Trial',
    'observational': 'Observational Study',
    'meta-analysis': 'Meta-Analysis',
    'case-study': 'Case Study',
    'review': 'Literature Review',
    'level-1-in-vivo': 'Level 1 - In vivo',
  };
  return studyTypeNames[studyTypeId as keyof typeof studyTypeNames] || studyTypeId;
};

export const generateWordDocument = async (documentData: DocumentData): Promise<Blob> => {
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Title
        new Paragraph({
          text: 'AI Document Summarization Report',
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
        }),

        new Paragraph({
          text: `Generated on: ${currentDate}`,
          alignment: AlignmentType.CENTER,
        }),

        new Paragraph({ text: '' }), // Space

        // Pipeline Metadata Section
        new Paragraph({
          text: 'Pipeline Configuration',
          heading: HeadingLevel.HEADING_2,
        }),

        new Paragraph({
          children: [
            new TextRun({ text: 'Document: ', bold: true }),
            new TextRun({ text: documentData.file?.name || 'Unknown document' }),
          ],
        }),

        new Paragraph({
          children: [
            new TextRun({ text: 'Parser Used: ', bold: true }),
            new TextRun({ text: getParserName(documentData.parser) }),
          ],
        }),

        new Paragraph({
          children: [
            new TextRun({ text: 'Study Type: ', bold: true }),
            new TextRun({ text: getStudyTypeName(documentData.studyType) }),
          ],
        }),

        new Paragraph({
          children: [
            new TextRun({ text: 'AI Model: ', bold: true }),
            new TextRun({ text: getModelName(documentData.selectedModel) }),
          ],
        }),

        new Paragraph({ text: '' }), // Space

        // Entity Extraction Configuration
        new Paragraph({
          text: 'Entity Extraction Configuration',
          heading: HeadingLevel.HEADING_2,
        }),

        // Entities table
        new Table({
          width: {
            size: 100,
            type: WidthType.PERCENTAGE,
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: 'Entity', alignment: AlignmentType.CENTER })],
                  width: { size: 25, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                  children: [new Paragraph({ text: 'Extraction Prompt', alignment: AlignmentType.CENTER })],
                  width: { size: 50, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                  children: [new Paragraph({ text: 'Extracted Result', alignment: AlignmentType.CENTER })],
                  width: { size: 25, type: WidthType.PERCENTAGE },
                }),
              ],
            }),
            ...documentData.entities.map(entity => new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: entity.name })],
                }),
                new TableCell({
                  children: [new Paragraph({ text: entity.prompt.substring(0, 200) + (entity.prompt.length > 200 ? '...' : '') })],
                }),
                new TableCell({
                  children: [
                    new Paragraph({ text: entity.extracted || 'No result' }),
                    ...(entity.duration
                      ? [
                          new Paragraph({
                            children: [
                              new TextRun({
                                text: `Time: ${entity.duration.toFixed(2)}s, Tokens: ${entity.promptTokens} (in) / ${
                                  entity.completionTokens
                                } (out)`,
                                size: 18, // half points, so 9pt
                                color: '808080',
                              }),
                            ],
                          }),
                        ]
                      : []),
                  ],
                }),
              ],
            })),
          ],
        }),

        new Paragraph({ text: '' }), // Space

        // Final Summary
        new Paragraph({
          text: 'Final Summary',
          heading: HeadingLevel.HEADING_2,
        }),

        new Paragraph({
          text: documentData.finalSummary,
        }),

        new Paragraph({ text: '' }), // Space

        // Full Prompts Section
        new Paragraph({
          text: 'Complete Entity Prompts',
          heading: HeadingLevel.HEADING_2,
        }),

        ...documentData.entities.flatMap((entity, index) => [
          new Paragraph({
            text: `${index + 1}. ${entity.name}`,
            heading: HeadingLevel.HEADING_3,
          }),
          new Paragraph({
            text: entity.prompt,
          }),
          new Paragraph({ text: '' }), // Space between entities
        ]),
      ],
    }],
  });

  const buffer = await Packer.toBlob(doc);
  return buffer;
};

export const generateMarkdownDocument = (documentData: DocumentData): string => {
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const markdown = `# AI Document Summarization Report

*Generated on: ${currentDate}*

## Pipeline Configuration

- **Document**: ${documentData.file?.name || 'Unknown document'}
- **Parser Used**: ${getParserName(documentData.parser)}
- **Study Type**: ${getStudyTypeName(documentData.studyType)}
- **AI Model**: ${getModelName(documentData.selectedModel)}

## Entity Extraction Results

| Entity | Extracted Information |
|--------|----------------------|
${documentData.entities.filter(e => e.extracted).map(entity => {
  const meta = entity.duration ? `<br><small>Time: ${entity.duration.toFixed(2)}s, Tokens: ${entity.promptTokens} (in) / ${entity.completionTokens} (out)</small>` : '';
  return `| **${entity.name}** | ${entity.extracted}${meta} |`;
}).join('\n')}

## Final Summary

${documentData.finalSummary}

## Complete Entity Extraction Configuration

The following entities were configured for extraction:

${documentData.entities.map((entity, index) => `
### ${index + 1}. ${entity.name}

**Prompt:**
\`\`\`
${entity.prompt}
\`\`\`

**Result:**
${entity.extracted || 'No specific information found in the document.'}
${entity.duration ? `\n<small>Time: ${entity.duration.toFixed(2)}s, Tokens: ${entity.promptTokens} (in) / ${entity.completionTokens} (out)</small>` : ''}

`).join('\n')}

---

*This report was generated using the AI Document Summarization Tool*
`;

  return markdown;
};

export const downloadFile = (content: Blob | string, filename: string, mimeType: string) => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
