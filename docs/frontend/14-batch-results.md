# Batch Results

> *After running extraction and evaluation across multiple files or multiple models, the Batch Results page brings everything together in one searchable table. It's the consolidated view for comparing results, spotting outliers, and exporting the full dataset. Reviewers can filter by model or metric, sort any column, and drill into any single result for the full detail.*

**File:** `components/BatchResultsPage.tsx` (~1356 lines)

---

## 1. UI sections

| Section | Purpose |
|---|---|
| Results table | One row per entity × file combination; columns for each metric × model |
| Search bar | Fuzzy full-text search across entity names, answers, and file names (Fuse.js) |
| Column visibility toggle | Show/hide individual metric or model columns |
| Sort controls | Click any column header to sort ascending/descending |
| Filter dropdown | Filter rows by model, metric pass/fail status, or study type |
| Row detail modal | Click a row to see the full extraction answer, all metric scores, and judge reasoning |
| Excel export | Download structured workbook with all results |
| Word export | Download formatted report |
| Human score column | Shows reviewer overrides alongside LLM scores |

---

## 2. Table structure

Each row represents one entity extracted from one file by one model:

| Column | Source |
|---|---|
| File | `uploadedFile.filename` |
| Entity | `entity.name` |
| Model | `extractionsByModel` key |
| Extracted value | `entity.extractionsByModel[model].answer` |
| Correctness | `evaluationResults[].correctness` |
| Completeness | `evaluationResults[].completeness` |
| Relevance | `evaluationResults[].relevance` |
| Safety | `evaluationResults[].safety` |
| Human score | `evaluationResults[].human_score` (if set) |
| Cost | `extractionsByModel[model].cost_usd` |
| Duration | `extractionsByModel[model].duration_ms` |

Columns for metrics that were not run are hidden by default.

---

## 3. Fuzzy search

Search is powered by [Fuse.js](https://fusejs.io/). The index is built from entity names, extracted answers, and filenames. Results are ranked by relevance score — an exact match scores higher than a partial match.

The search index is rebuilt whenever `documentData.uploadedFiles` changes (i.e. when a new extraction is run).

---

## 4. Row detail modal

Clicking any row opens a modal with:

- The full extracted answer (not truncated)
- All metric scores with the judge's reasoning text
- The source references (which pages the answer was drawn from)
- Token usage and cost for that extraction
- Human score override field (editable inline)

Human score overrides entered in the modal are propagated back to `documentData` via `onInvalidateDownstream` (false) + a targeted update, so they persist through session saves without clearing downstream results.

---

## 5. Excel export

The exported workbook mirrors the table exactly:

- **Sheet 1 — Results:** All rows visible in the current filtered/sorted view
- **Sheet 2 — Full results:** All rows unfiltered
- **Sheet 3 — Config:** Study type, models used, metrics run, judge model

Column headers in the workbook match the table headers. Numeric scores are formatted as decimals (0.00–1.00); pass/fail is a separate boolean column.

---

## 6. State

| State field | Type | Purpose |
|---|---|---|
| `results` | `ResultRow[]` | Flattened rows derived from `documentData` |
| `fuseIndex` | `Fuse<ResultRow>` | Search index over results |
| `searchQuery` | `string` | Active search string |
| `sortBy` | `string` | Active sort column key |
| `sortOrder` | `"asc" \| "desc"` | Sort direction |
| `columnVisibility` | `Map<string, boolean>` | Which columns are shown |
| `activeFilter` | `FilterConfig` | Active model/metric/status filters |
| `selectedRow` | `ResultRow \| null` | Row open in detail modal |

---

## 7. API calls

This page makes no API calls on mount — all data is read from `documentData` passed down from `App.tsx`. The Excel and Word exports are generated entirely client-side using `exceljs` and `docx` respectively.

The exception is human score overrides: when a reviewer saves a human score in the detail modal, the page calls:

```
PATCH /api/sessions/{sessionId}
  Body: { entities: updatedEntities }
```

to persist the override to the session.
