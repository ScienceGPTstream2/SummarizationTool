# Executive Mode

> *Executive Mode is a standalone summary generator that skips the structured entity extraction step entirely. A reviewer uploads a document, selects a template, and gets back a narrative paragraph summary — without going through the full five-step workflow. It's designed for situations where a reviewer needs a quick high-level overview rather than a field-by-field extraction.*

**File:** `components/ExecutiveModePage.tsx` (~881 lines)

---

## 1. UI sections

| Section | Purpose |
|---|---|
| File upload area | Drag-and-drop or file picker |
| Study type selector | Toxicology, epidemiology, or custom |
| Template selector | Load entity prompts from a saved template |
| Summary prompt editor | Editable text area for the paragraph generation instructions |
| Model selector | Choose the LLM to use for summarisation |
| Advanced options (collapsed) | Parser selection, temperature, ingestion settings |
| Progress table | Per-file: upload → processing → extracting → summarising stages |
| Results preview | Generated paragraph summary per file |
| Download button | Export summary as a Word document |

---

## 2. Pipeline

Executive Mode runs the same pipeline as the Simplified Flow but skips the evaluation stage and focuses the output on the paragraph summary rather than individual entity values.

```
Upload file  →  Process (PDF to markdown)  →  Extract entities  →  Generate paragraph
```

Internally, the page uses `useSimplifiedPipeline` with a flag that skips storing per-entity results and focuses output on the `paragraphSummary` field.

---

## 3. Difference from Simplified Flow

| | Executive Mode | Simplified Flow |
|---|---|---|
| Output focus | Paragraph summary | Entity values + summary |
| Results display | Summary text only | Entity table + summary |
| Download | Summary Word document | Full extraction report |
| Entity values visible | No | Yes |
| Intended use | Quick overview | Full extraction record |

---

## 4. State

State is managed by `useSimplifiedPipeline`. The page reads `results[].paragraphSummary` and ignores `results[].entities` for display purposes.

| State field | Type | Purpose |
|---|---|---|
| `studyType` | `string` | Selected study type |
| `summaryPrompt` | `string` | Editable paragraph generation instructions |
| `selectedModel` | `string` | Model for extraction and summarisation |
| `advancedOpen` | `boolean` | Whether the advanced options panel is expanded |

---

## 5. API calls

Same as Simplified Flow — see [08-simplified-flow.md](08-simplified-flow.md). The difference is only in what is displayed, not in which API calls are made.

---

## 6. Error handling

Identical to Simplified Flow. Per-file errors are shown inline in the progress table. The reviewer can retry individual files without restarting the entire run.
