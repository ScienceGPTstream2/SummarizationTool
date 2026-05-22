# Evaluation Page (Workflow Step 5)

> *Once entities are extracted, reviewers can ask the tool to judge how good the extractions are. The Evaluation page uses G-Eval — a technique where a separate LLM acts as a judge, scoring each extraction against criteria like correctness and completeness. Reviewers can also provide their own expected answers as ground truth, add custom evaluation steps, and review a cost/score breakdown across all models. Results can be exported to Excel.*

**File:** `components/EvaluationPage.tsx` (~5000 lines)

---

## 1. UI sections

| Section | Purpose |
|---|---|
| Metric selector | Choose which G-Eval metrics to run (correctness, completeness, relevance, safety, custom) |
| Judge model selector | Choose which LLM acts as the evaluator |
| Entity selector | Which entities to evaluate (all, or a subset) |
| Expected output fields | Optional: enter ground truth answers per entity for correctness/completeness scoring |
| Custom metric editor | Define custom evaluation criteria with step-by-step rubrics |
| Run / Stop buttons | Start or cancel evaluation |
| Results table | Metric scores per entity per extraction model (pass/fail + numeric score) |
| Per-model breakdown | Aggregate scores grouped by extraction model |
| Cost breakdown | Tokens and cost per evaluation call |
| Charts | Score distribution and model comparison (Recharts) |
| Excel export | Download full results as a structured Excel workbook |
| Human score override | Manually override the LLM score for any entity/metric |

---

## 2. G-Eval metrics

| Metric | Requires ground truth | What it measures |
|---|---|---|
| `correctness` | Yes | Does the extracted answer match the expected answer? |
| `completeness` | Yes | Does the extraction capture all relevant information from the expected answer? |
| `relevance` | No | Is the extracted answer relevant to the entity prompt? |
| `safety` | No | Does the extracted answer contain harmful or inappropriate content? |
| `custom` | Configurable | Reviewer-defined rubric with step-by-step evaluation instructions |

If no expected output is provided, `correctness` and `completeness` are automatically skipped. The remaining metrics can still run.

---

## 3. Evaluation flow

```
Reviewer configures metrics + judge model → clicks "Run Evaluation"
  │
  ▼
For each entity with extraction results:
  POST /api/evaluations/jobs
  │  Body: {
  │    tasks: [{ entity_name, extracted_value, expected_output, metric }],
  │    providers: [{ model_type, model_id }],
  │    session_id: sessionId,
  │  }
  │  Returns: { job_id, status: "queued" }
  │
  ▼
  Poll: GET /api/evaluations/jobs/{job_id}
  │  Returns: { status, progress, results }
  │
  ▼
  Results arrive incrementally as job progresses
  │
  ▼
  POST /api/sessions/{sessionId}/evaluations  ← persist each result
```

Evaluation is run as a background job on the backend. The frontend polls `GET /api/evaluations/jobs/{job_id}` every 2 seconds until `status` is `completed`, `cancelled`, or `failed`. Results are shown in the table as they arrive, not all at once.

---

## 4. Stopping evaluation

Clicking "Stop" calls:

```
POST /api/evaluations/jobs/{job_id}/cancel
```

The backend marks the job as cancelled. Already-completed results are preserved and shown. The reviewer can review partial results and re-run only the remaining entities.

---

## 5. Custom metric editor

Reviewers can define their own evaluation metric by providing:
- A metric name
- A series of evaluation steps (e.g. "1. Check if the answer mentions the test material. 2. Check if the dose is specified.")

The custom steps are sent to the backend as `custom_steps` in the evaluation request. The judge LLM follows the steps and returns a score from 0 to 1 for each step, which are averaged into a final metric score.

---

## 6. Human score override

Any LLM-generated score can be overridden manually. The reviewer clicks the score cell in the results table and enters their own assessment. Overrides are stored separately from LLM scores in `entity.evaluationResults[].human_score` and are preserved through session saves. Both scores are visible in the Excel export.

---

## 7. Results table structure

The results table has one row per entity and one column group per extraction model. Each cell shows:
- The numeric score (0.00–1.00)
- A pass/fail badge (threshold configurable, default 0.5)
- The judge model used
- A detail icon that opens the judge's reasoning

The table is sortable by entity name or any metric score.

---

## 8. Excel export

The Excel workbook has:
- **Sheet 1 — Results:** One row per entity, columns for each metric × model combination
- **Sheet 2 — Extracted values:** The raw extraction answers per entity per model
- **Sheet 3 — Cost:** Token usage and cost per evaluation call
- **Sheet 4 — Config:** Which models, metrics, and judge were used

---

## 9. State

| State field | Type | Purpose |
|---|---|---|
| `evaluationConfig` | `EvaluationConfig` | Selected metrics, models, custom steps |
| `selectedEntities` | `string[]` | Entities included in the current evaluation run |
| `expectedOutputs` | `Map<string, string>` | Ground truth per entity (entered by reviewer) |
| `evaluationResults` | `EvaluationResult[]` | All score results so far |
| `activeJobId` | `string \| null` | Currently running background job ID |
| `pollInterval` | `number \| null` | Interval handle for job status polling |
| `aggregateScores` | `Map<string, number>` | Average score per extraction model |

---

## 10. API calls

| Method | Path | When | Purpose |
|---|---|---|---|
| `POST` | `/api/evaluations/jobs` | On "Run Evaluation" | Submit background evaluation job |
| `GET` | `/api/evaluations/jobs/{job_id}` | Every 2s while running | Poll job status and retrieve partial results |
| `POST` | `/api/evaluations/jobs/{job_id}/cancel` | On "Stop" | Cancel running job |
| `POST` | `/api/sessions/{id}/evaluations` | After each result | Persist result to session |

---

## 11. `onComplete()` payload

```typescript
onComplete({
  entities: entitiesWithEvaluationResults,
  uploadedFiles: updatedFiles,
  evaluationConfig: currentConfig,
})
```

After evaluation, the reviewer is at the end of the workflow. The "Next" button navigates to the Batch Results page for a consolidated view.

---

## 12. Error handling

- **Job failure:** The job status shows `failed` with an error message. Already-completed evaluations within the job are preserved.
- **Judge model unavailable:** If the selected judge model is not configured, the error is shown before the job is submitted.
- **Score parse failure:** If the judge LLM returns malformed output, the backend falls back to a per-metric scoring approach. If that also fails, the metric is marked as `error` in the results table.
- **In-flight navigation guard:** If a job is running when the reviewer tries to navigate away, App.tsx shows a confirmation dialog.
