# Simplified Flow

> *The simplified flow is a one-click version of the full workflow for reviewers who don't need to inspect intermediate steps. The reviewer drops their files in, selects a study type, and clicks Run. The app automatically uploads, processes, extracts all entities, and generates a summary — showing a progress table as it goes. Results can be downloaded as a Word document when complete.*

**Files:** `components/SimplifiedFlowPage.tsx` (~995 lines), `hooks/useSimplifiedPipeline.ts`

---

## 1. UI sections

| Section | Purpose |
|---|---|
| Study type selector | Pick toxicology, epidemiology, or custom |
| File upload area | Drag-and-drop; accepts multiple PDFs |
| Advanced options (collapsed) | Override parser, model selection, temperature |
| Progress table | One row per file: filename, current stage, per-entity extraction progress |
| Results preview | Summary text + key extracted entities per file |
| Download buttons | Download extraction report or executive summary as Word documents |
| Cancel / Restart controls | Stop the pipeline mid-run or start over |

---

## 2. Pipeline stages

Each file moves through these stages independently:

| Stage | What happens |
|---|---|
| `queued` | File is waiting to start |
| `uploading` | `POST /api/upload` in progress |
| `processing` | `POST /api/documents/process/file/{hash}` in progress |
| `extracting` | `POST /api/extract` running for each entity (batched, 5 at a time) |
| `summarizing` | `POST /api/generate_paragraph` in progress |
| `exporting` | Building Word document in memory |
| `complete` | All done; download available |
| `error` | A stage failed; error message shown inline |

---

## 3. `useSimplifiedPipeline` hook

All the pipeline logic lives in `hooks/useSimplifiedPipeline.ts`, not in the page component. This keeps the component focused on display and makes the pipeline independently testable.

**API:**

```typescript
const { state, results, run, reset, downloadResults, downloadSingleResult } =
  useSimplifiedPipeline();

// Start the pipeline
run(files, studyType, entities, summaryPrompt, options);

// Download all results as a single Word document
downloadResults();

// Download results for one file
downloadSingleResult(filename);
```

**Batching:**

Entity extraction runs 5 entities at a time per file. This avoids overwhelming the backend while still parallelising work. The progress bar for the `extracting` stage shows `N / total` as batches complete.

**Error recovery:**

If a stage fails for one file, that file is marked as `error` and the pipeline continues with other files. The reviewer can see the error message in the progress table row and use the Restart button to retry from the beginning.

---

## 4. Difference from the advanced workflow

| | Advanced workflow | Simplified flow |
|---|---|---|
| Steps | 5 separate pages | 1 page |
| Inspection | Reviewer checks each step's output | No intermediate inspection |
| Parser choice | Per-file, with preview | Global option in Advanced settings |
| Entity editing | Edit prompts before extraction | Uses default template prompts |
| Extraction results | Viewable inline with PDF | Download only |
| Evaluation | Full G-Eval scoring page | Not included |
| Target user | Reviewers who want control | Reviewers who want speed |

---

## 5. State

State is managed inside `useSimplifiedPipeline`. The page receives it as `state` and `results`:

```typescript
interface PipelineState {
  status: "idle" | "running" | "complete" | "error";
  fileStatuses: Map<string, FileStageStatus>;
}

interface FileResult {
  filename: string;
  entities: Entity[];
  paragraphSummary: string;
  wordDocBytes?: Uint8Array;
}
```

---

## 6. API calls

| Method | Path | When | Purpose |
|---|---|---|---|
| `POST` | `/api/upload` | Per file | Upload file bytes |
| `POST` | `/api/documents/process/file/{hash}` | Per file | Parse document |
| `POST` | `/api/extract` | Per entity batch | Extract entities |
| `POST` | `/api/generate_paragraph` | Per file | Generate summary |
