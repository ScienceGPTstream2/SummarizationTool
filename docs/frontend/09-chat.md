# Chat Page

> *The Chat page is a freeform document Q&A interface — think of it as asking questions directly to an uploaded PDF. Unlike the main extraction workflow, there are no structured entities or rubrics. The reviewer types a question, attaches up to five documents as context, and gets a markdown-rendered answer. It's useful for quick lookups, sanity checks, and exploratory reading before setting up a formal extraction.*

**File:** `components/ChatPage.tsx` (~949 lines)

---

## 1. UI sections

| Section | Purpose |
|---|---|
| Message history | Alternating user (right) and assistant (left) message bubbles |
| Message actions | Copy, thumbs up/down rating, regenerate last response |
| Document upload area | Drag-and-drop zone; accepts up to 5 PDFs |
| Document chips | Shows attached documents with processing status and a remove button |
| Model selector | Auto (backend picks best available) or manual model selection |
| Input box | Multi-line text input; Submit on Enter or button click |
| Markdown renderer | Assistant responses rendered with full GFM markdown (tables, code blocks, lists) |

---

## 2. How documents are used as context

Uploaded documents are converted to markdown and concatenated into the `document_markdown` field of the chat request. The backend passes this as context to the LLM before the user's question.

```
Reviewer uploads PDF
  │
  ▼
POST /api/upload  →  file_hash
  │
  ▼
POST /api/documents/process/file/{hash}  →  markdown
  │
  ▼
document_markdown stored in documentContexts[hash]

Reviewer sends message
  │
  ▼
POST /api/chat/query
  Body: {
    query: "What was the NOAEL for maternal effects?",
    document_markdown: "[doc1 markdown]\n\n[doc2 markdown]",
    model_config: { ... },
  }
  Returns: { answer: string, model_used: string, tokens, cost }
```

Up to 5 documents can be attached simultaneously. The combined markdown is sent in a single request. If the combined length exceeds the model's context window, the backend truncates from the oldest document first and indicates truncation in the response metadata.

---

## 3. Message ratings

Each assistant message has thumbs up / thumbs down buttons. Ratings are stored in local component state (`messageRatings`) and are not persisted to the backend or database. They serve as in-session quality tracking for the reviewer's own reference.

---

## 4. State

| State field | Type | Purpose |
|---|---|---|
| `messages` | `Message[]` | Full conversation history (user + assistant turns) |
| `attachedDocuments` | `AttachedDoc[]` | Uploaded documents with hash, filename, markdown, status |
| `selectedModel` | `string` | Model identifier or `"auto"` |
| `isLoading` | `boolean` | Request in progress (disables input) |
| `messageRatings` | `Map<number, "up" \| "down">` | Per-message rating keyed by message index |

---

## 5. API calls

| Method | Path | When | Purpose |
|---|---|---|---|
| `POST` | `/api/upload` | On document drop | Upload PDF bytes, get hash |
| `POST` | `/api/documents/process/file/{hash}` | After upload | Convert PDF to markdown |
| `POST` | `/api/chat/query` | On message send | Get LLM answer with document context |

---

## 6. Differences from the main workflow

| | Chat page | Main workflow |
|---|---|---|
| Structure | Freeform conversation | Structured entity extraction |
| Session saving | Not saved to database | Saved as AppSession |
| References | No bounding box highlights | PDF page + location highlights |
| Multi-model | Single model per message | Multiple models in parallel |
| Export | Copy to clipboard only | Word / Excel / Markdown |

---

## 7. Error handling

- **Processing failure:** The document chip shows a red error indicator. The reviewer can remove and re-add the file.
- **Chat API failure:** An error bubble appears in the message history with the error text. The input is re-enabled so the reviewer can try again.
- **Context too long:** If the combined document markdown exceeds the model limit, the backend returns a specific error. The page shows a warning suggesting the reviewer remove one or more documents.
