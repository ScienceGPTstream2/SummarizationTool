# Chat Page — Multi-Document Attachment

**Date:** 2026-04-27  
**Branch:** feat/chat-page  
**Scope:** Frontend only (`ChatPage.tsx`). No backend changes required.

---

## Goal

Allow users to attach up to 5 documents to a chat session. Each document is processed independently and in parallel. Users can add or remove individual documents at any time. If the combined context exceeds the model's context window, a clear inline warning is shown.

---

## State

Replace the single `attachedDoc: AttachedDocument | null` and `docLoading / docError` fields with a single `Map`:

```ts
type DocEntry =
  | { status: "loading"; file: File; tempId: string }
  | { status: "ready";   file: File; tempId: string; fileHash: string; markdown: string; processorUsed: string }
  | { status: "error";   file: File; tempId: string; error: string };

const [docs, setDocs] = useState<Map<string, DocEntry>>(new Map());
```

`tempId` is a `crypto.randomUUID()` assigned at upload time, used as the stable React key and removal handle.

**Max cap:** Attach button and drag-and-drop are disabled/ignored when `docs.size >= 5` (counting loading + ready entries, not errored ones — errored slots are reusable).

---

## File Processing

`processFile(file: File)` is called per file. Multiple files (drag-drop of multiple, or rapid successive clicks) each get their own `tempId` and are fired concurrently — no queuing. The function:

1. Adds a `loading` entry to the map.
2. Uploads → gets `file_hash`. Cached files return instantly.
3. Processes via Azure Doc Intelligence (`/api/documents/process/file/{hash}`). Cache hit returns immediately; cache miss calls Azure and syncs to blob.
4. Fetches markdown from `/api/documents/{hash}/content`.
5. On success: updates entry to `ready`.
6. On failure: updates entry to `error` with the message.

Drop of multiple files at once: iterate `e.dataTransfer.files`, call `processFile` for each, respect the 5-doc cap (silently skip files beyond the cap, show a toast: *"Maximum 5 documents — some files were skipped"*).

---

## Prompt Construction

When sending a query, concatenate all `ready` docs into one `document_markdown` string:

```
The following documents have been uploaded:

<document name="form-A.pdf">
...markdown...
</document>

<document name="report-B.pdf">
...markdown...
</document>
```

Single-doc case uses the same format (one `<document>` block) for consistency. No-doc case sends `document_markdown: null` as before.

The backend `ChatQueryRequest.document_markdown: Optional[str]` field is unchanged.

---

## UI — Document Badges

Badges appear above the input box, wrapping if needed. One chip per entry:

| State | Appearance |
|---|---|
| `loading` | Spinner + filename (truncated) + no X |
| `ready` | FileText icon + filename + "· in context" + X button |
| `error` | AlertCircle icon + short error message + X button |

The attach (paperclip) button is disabled when `readyAndLoadingCount >= 5`.

---

## Context Window Error

Detect in the `sendQuery` catch block: if the error message contains `context_length_exceeded`, `maximum context length`, or `token` + `limit` (case-insensitive), show an inline warning banner above the input box instead of (or in addition to) the generic error message in the chat:

> **Context window exceeded** — your documents are too large. Remove a document and try again.

This banner has an X to dismiss and persists until dismissed or a new message is sent successfully.

---

## Error Handling

- Per-file errors (upload/process/content failures) show as an `error` badge. Clicking X removes the badge and frees up a slot.
- Context window error shows the inline banner; the failed message is **not** added to the chat thread.
- All other send errors continue to appear as assistant error messages in the thread (existing behaviour).

---

## Files Changed

- `frontend/components/ChatPage.tsx` — all changes are self-contained here.

---

## Out of Scope

- Backend changes
- Persisting attached docs across page reloads
- Showing per-file progress (% uploaded)
- Deduplication of the same file attached twice (allowed — same hash, served from cache instantly)
