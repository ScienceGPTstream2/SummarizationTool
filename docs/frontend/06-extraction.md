# Extraction Page (Workflow Step 4)

> *This is where the AI models do the work. The Extraction page sends each entity prompt to the selected LLMs, shows the answers as they come back, and lets reviewers see exactly where in the document each answer came from — highlighted in the original PDF. Reviewers can run multiple models side by side, edit individual answers, and see token counts and cost for every extraction. This is the largest and most complex component in the frontend.*

**File:** `components/EntityExtractionPage.tsx` (~4300 lines)

---

## 1. UI sections

| Section | Purpose |
|---|---|
| File/document selector | Switch between uploaded files in multi-file sessions |
| Entity list | All configured entities with extraction status (pending, running, complete, error) |
| Model tabs | One tab per selected model showing that model's results |
| Entity detail panel | Expanded view of one entity: extracted answer, source references, cost metrics |
| PDF viewer with highlighting | Shows the pages referenced by the extracted answer, with bounding boxes drawn |
| Full text viewer | Shows the raw markdown with the relevant passage highlighted |
| In-place editor | Edit the extracted value directly in the results panel |
| Paragraph summary section | Auto-generated paragraph summary from all extracted entities |
| Export buttons | Download results as Word document or Markdown file |
| Re-run controls | Re-run a single entity, all entities for a model, or all entities across all models |

---

## 2. Extraction flow

```
Reviewer clicks "Run Extraction"
  │
  ▼
For each entity × each selected model (concurrent):
  │
  POST /api/extract
  │  Body: {
  │    document_conversion_id: file_hash,
  │    entities: [{ name, prompt }],
  │    model_config: { model_type, model_id, ... },
  │    session_id: sessionId,
  │  }
  │  Returns: {
  │    entity_name: string,
  │    answer: string,
  │    references: [{ text, page, bounding_box }],
  │    duration_ms: number,
  │    prompt_tokens: number,
  │    completion_tokens: number,
  │    cost_usd: number,
  │  }
  │
  ▼
Update entities[i].extractionsByModel[modelId] with result
  │
  ▼
Mark entity as complete; show answer + reference count
```

Each entity-model combination is a separate API call. With 20 entities and 3 models, 60 concurrent requests are made. The backend handles concurrency with a semaphore.

---

## 3. PDF reference highlighting

When an extraction result includes `references` (source passages from the document), the `EntityPDFViewerBeta` component renders the original PDF and draws coloured bounding boxes at the referenced locations.

How it works:
1. The backend's extraction response includes `references[].bounding_box` — page-relative coordinates of the source passage.
2. `EntityPDFViewerBeta` uses `pdfjs-dist` to render the PDF pages as canvases.
3. Bounding boxes are drawn as coloured overlays scaled to the rendered page dimensions.
4. Clicking a reference in the entity detail panel scrolls the PDF to that page and pulses the highlight.

If references are not available (the model did not return them, or the document was processed without a parser that supports bounding boxes), the PDF viewer shows the full document without highlights, and the text viewer highlights the passage by string search.

---

## 4. Multi-model comparison

When multiple models are selected in the Study Config step, the extraction page shows a tab for each model. Within each tab, all entities are shown with that model's answers.

A **comparison view** can be toggled to show all models' answers for a single entity side by side. This lets reviewers quickly assess where models agree or disagree.

The `extractionsByModel` field on each entity stores results keyed by model ID:

```typescript
entity.extractionsByModel = {
  "azure-gpt4o": { answer: "...", references: [...], duration_ms: 2100, ... },
  "gemini-2.5-pro": { answer: "...", references: [...], duration_ms: 1800, ... },
}
```

---

## 5. In-place editing

Reviewers can edit any extracted answer by clicking the edit icon in the entity detail panel. Edits are stored in `entity.extracted` (the reviewer-accepted value). The original model answer is preserved in `entity.extractionsByModel[modelId].answer` — edits never overwrite the raw model output.

The edited value is what gets included in Word document exports and session saves.

---

## 6. Paragraph summary generation

After all entities are extracted, a "Generate Summary" button appears at the bottom of the entity list. Clicking it sends all extracted entity values to:

```
POST /api/generate_paragraph
  Body: {
    entities: [{ name, extracted_value }],
    model_config: { ... },
    session_id: sessionId,
    summary_prompt: "...",
  }
  Returns: { paragraph: string, duration_ms, tokens, cost_usd }
```

The generated paragraph is shown in the summary section and included in Word exports.

---

## 7. Session auto-save

Every time an extraction result arrives, the page patches the session on the backend:

```
POST /api/sessions/{sessionId}/extractions
  Body: ExtractionResult
```

This means the reviewer's work is persisted to the database continuously — they can close the browser and restore from Session History without losing results.

---

## 8. State

| State field | Type | Purpose |
|---|---|---|
| `entities` | `Entity[]` | Full entity list with extraction results |
| `activeEntity` | `string \| null` | Currently selected entity for detail view |
| `activeModel` | `string` | Currently selected model tab |
| `extractionInFlight` | `Set<string>` | Entity-model pairs currently running |
| `pdfDoc` | `PDFDocumentProxy \| null` | Loaded PDF for reference viewer |
| `editingEntity` | `string \| null` | Entity currently being edited in-place |
| `paragraphSummary` | `string` | Generated paragraph text |
| `paragraphInFlight` | `boolean` | Paragraph generation in progress |

---

## 9. API calls

| Method | Path | When | Purpose |
|---|---|---|---|
| `POST` | `/api/extract` | On "Run Extraction" | Extract one entity with one model |
| `POST` | `/api/generate_paragraph` | On "Generate Summary" | Generate paragraph from extracted values |
| `POST` | `/api/sessions/{id}/extractions` | After each extraction | Persist result to session |

---

## 10. `onComplete()` payload

```typescript
onComplete({
  entities: updatedEntities,    // with extractionsByModel populated
  uploadedFiles: updatedFiles,  // with per-file entities merged in
  sessionId: sessionId,
})
```

App.tsx navigates to `evaluation`.

---

## 11. Error handling

- **Entity extraction failure:** The failed entity is marked with an error badge. Other entities continue. A "Retry" button on the entity re-sends that specific entity-model pair.
- **Partial completion:** The reviewer can proceed to evaluation with only some entities extracted. Unevaluated entities are skipped automatically on the evaluation page.
- **Token limit exceeded:** The backend returns a specific error code. The entity is marked with a "Context too long" error. The reviewer can shorten the entity prompt and retry.
- **In-flight navigation guard:** If extractions are running when the reviewer tries to navigate away, App.tsx shows a confirmation dialog.
