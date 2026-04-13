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
  HeadingLevel,
  PageOrientation,
} from "docx";
import { DocumentData } from "../App";

// Helper to find entity value by name
const getEntityValue = (documentData: DocumentData, name: string): string => {
  const entity = documentData.entities.find(
    (e) => e.name.toLowerCase() === name.toLowerCase()
  );
  return entity?.extracted || "[Not Found]";
};

// Helper to create a table row with key-value pair
const createRow = (key: string, value: string): TableRow => {
  return new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ text: key, style: "Strong" })],
        width: { size: 30, type: WidthType.PERCENTAGE },
        verticalAlign: VerticalAlign.CENTER,
      }),
      new TableCell({
        children: [new Paragraph({ text: value })],
        width: { size: 70, type: WidthType.PERCENTAGE },
        verticalAlign: VerticalAlign.CENTER,
      }),
    ],
  });
};

export async function generateExecutiveSummary(
  documentData: DocumentData
): Promise<Blob> {
  const sections: any[] = [];

  // --- Common Citation Table (Level 1) ---
  // Citation: Study Author(s), Author Affiliations, Study Title, Publication Date, Journal

  sections.push(
    new Paragraph({
      text: `Level 1 Structured Summary – ${
        documentData.studyType.includes("epidemiology")
          ? "Epidemiology Study"
          : "In Vivo Developmental Toxicity Study"
      }`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  sections.push(
    new Paragraph({
      text: "Citation:",
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 200 },
    })
  );

  const citationRows = [
    createRow(
      "Study Author(s)",
      getEntityValue(documentData, "Study Author(s)")
    ),
    createRow(
      "Author Affiliations",
      getEntityValue(documentData, "Author Affiliations")
    ),
    createRow("Study Title", getEntityValue(documentData, "Study Title")),
    createRow(
      "Publication Date",
      getEntityValue(documentData, "Publication Date")
    ),
    createRow("Journal", getEntityValue(documentData, "Journal")),
  ];

  const citationTable = new Table({
    rows: citationRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    },
  });
  sections.push(citationTable);
  sections.push(new Paragraph({ text: "", spacing: { after: 400 } })); // Spacer

  // --- Executive Summary ---
  sections.push(
    new Paragraph({
      text: "Executive Summary:",
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 200 },
    })
  );

  sections.push(
    new Paragraph({
      text: documentData.finalSummary || "[No Summary Generated]",
      spacing: { after: 400 },
    })
  );

  // --- Specific Sections based on Study Type ---

  if (
    documentData.studyType === "level-1-in-vivo" ||
    documentData.studyType === "level-2-in-vivo"
  ) {
    // A. Test Substance Identification and Characterization
    sections.push(
      new Paragraph({
        text: "A. Test Substance Identification and Characterization",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 },
      })
    );

    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Test material: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Test Material"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Vehicle: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Vehicle or solvent used"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Negative control: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Negative Control"),
          }),
        ],
        spacing: { after: 200 },
      })
    );

    // B. Study Design and Methods
    sections.push(
      new Paragraph({
        text: "B. Study Design and Methods",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 },
      })
    );

    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Test species: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Test Animal Species"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Route of administration: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Route of Administration"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Dose levels tested: ", bold: true }),
          new TextRun({ text: getEntityValue(documentData, "Dose Levels") }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Frequency of administration: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Frequency of Administration"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Duration of dosing period: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Duration of Dosing Period"),
          }),
        ],
        spacing: { after: 200 },
      })
    );

    // C. Results Presented
    sections.push(
      new Paragraph({
        text: "C. Results Presented",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 },
      })
    );

    sections.push(
      new Paragraph({
        text: getEntityValue(documentData, "Results Presented"),
      })
    );

    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Fetal/Offspring Effects Reported by Study Authors: ",
            bold: true,
          }),
          new TextRun({
            text: getEntityValue(
              documentData,
              "Fetal/Offspring Effects Reported by Study Authors"
            ),
          }),
        ],
        spacing: { before: 200 },
      })
    );

    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Maternal Effects Reported by Study Authors: ",
            bold: true,
          }),
          new TextRun({
            text: getEntityValue(
              documentData,
              "Maternal Effects Reported by Study Authors"
            ),
          }),
        ],
        spacing: { before: 200 },
      })
    );
  } else if (
    documentData.studyType === "epidemiology-level-1" ||
    documentData.studyType.includes("epidemiology")
  ) {
    // A. Study Design & Methods
    sections.push(
      new Paragraph({
        text: "A. Study Design & Methods",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 },
      })
    );

    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Participant Numbers: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Participant Numbers"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Method of Measurement: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Method of Measurement"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Biological Samples: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Biological Samples"),
          }),
        ],
        spacing: { after: 200 },
      })
    );

    // B. Exposure & Outcome
    sections.push(
      new Paragraph({
        text: "B. Exposure & Outcome",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 },
      })
    );

    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Pesticide of Interest: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Pesticide of Interest"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Health Outcome: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Health Outcome"),
          }),
        ],
        spacing: { after: 200 },
      })
    );

    // C. Results & Conclusions
    sections.push(
      new Paragraph({
        text: "C. Results & Conclusions",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 },
      })
    );

    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Odds Ratio (Effect Measure) plus CI: ",
            bold: true,
          }),
          new TextRun({
            text: getEntityValue(
              documentData,
              "Odds Ratio (Effect Measure) plus CI"
            ),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Study Author Conclusion: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Study Author Conclusion"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Study Author Noted Strength: ", bold: true }),
          new TextRun({
            text: getEntityValue(documentData, "Study Author Noted Strength"),
          }),
        ],
      })
    );
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Study Author Noted Limitations: ", bold: true }),
          new TextRun({
            text: getEntityValue(
              documentData,
              "Study Author Noted Limitations"
            ),
          }),
        ],
      })
    );
  } else {
    // Fallback for unknown study types - just list all entities
    sections.push(
      new Paragraph({
        text: "Extracted Entities",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 },
      })
    );

    documentData.entities.forEach((entity) => {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${entity.name}: `, bold: true }),
            new TextRun({ text: entity.extracted || "[No Result]" }),
          ],
          spacing: { after: 100 },
        })
      );
    });
  }

  // Create the document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.PORTRAIT,
            },
          },
        },
        children: sections,
      },
    ],
  });

  // Generate blob
  const blob = await Packer.toBlob(doc);
  return blob;
}

export function downloadExecutiveSummary(documentData: DocumentData) {
  generateExecutiveSummary(documentData).then((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePrefix = documentData.file
      ? documentData.file.name.replace(/\.[^/.]+$/, "")
      : "Executive_Summary";
    link.download = `${filePrefix}_Summary_${timestamp}.docx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
}
