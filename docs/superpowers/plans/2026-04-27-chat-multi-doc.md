# Chat Multi-Document Attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-document attachment in ChatPage with a per-file Map that supports up to 5 docs in parallel, with individual loading/error states, a remove button per doc, and an inline context-window error banner.

**Architecture:** All changes are self-contained in `frontend/components/ChatPage.tsx`. State moves from three scalar variables (`attachedDoc`, `docLoading`, `docError`) to a single `Map<tempId, DocEntry>`. Each file gets a `tempId` at upload time and progresses through `loading → ready | error` independently. The backend interface is unchanged — all ready docs are concatenated into one `document_markdown` string before the API call.

**Tech Stack:** React (useState, useCallback, useRef), TypeScript, existing fetch/toast utilities already imported in `ChatPage.tsx`.

---

## File Structure

| File | Change |
|---|---|
| `frontend/components/ChatPage.tsx` | All changes — types, state, processFile, drag-and-drop, badges UI, sendQuery |

---

### Task 1: Add `DocEntry` type, constant, and replace state variables

**Files:**
- Modify: `frontend/components/ChatPage.tsx`

- [ ] **Step 1: Replace the `AttachedDocument` interface and three state vars**

In `ChatPage.tsx`, find and replace the `AttachedDocument` interface (lines ~44–49) and the three state declarations (lines ~306–308) with the following.

Remove this interface:
```ts
interface AttachedDocument {
  file: File;
  fileHash: string;
  markdown: string;
  processorUsed: string;
}
```

Replace with:
```ts
const MAX_DOCS = 5;

type DocEntry =
  | { status: "loading"; file: File; tempId: string }
  | { status: "ready";   file: File; tempId: string; fileHash: string; markdown: string; processorUsed: string }
  | { status: "error";   file: File; tempId: string; error: string };
```

Remove these three state lines inside `ChatPage`:
```ts
const [attachedDoc, setAttachedDoc] = useState<AttachedDocument | null>(null);
const [docLoading, setDocLoading] = useState(false);
const [docError, setDocError] = useState<string | null>(null);
```

Replace with:
```ts
const [docs, setDocs] = useState<Map<string, DocEntry>>(new Map());
const [contextError, setContextError] = useState(false);
```

- [ ] **Step 2: Add `removeDoc` helper directly after the new state declarations**

```ts
const removeDoc = useCallback((tempId: string) => {
  setDocs(prev => {
    const next = new Map(prev);
    next.delete(tempId);
    return next;
  });
}, []);
```

- [ ] **Step 3: Add derived values directly after `removeDoc`**

```ts
const activeDocCount = Array.from(docs.values()).filter(d => d.status !== "error").length;
const atDocLimit = activeDocCount >= MAX_DOCS;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/azureuser/projects/SummarizationTool/frontend
npx tsc --noEmit 2>&1 | head -40
```

Expected: errors only about references to the now-removed `attachedDoc` / `docLoading` / `docError` (we'll fix those in subsequent tasks). No new unexpected errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ChatPage.tsx
git commit -m "refactor(chat): replace single-doc state with DocEntry Map"
```

---

### Task 2: Rewrite `processFile` for per-file Map state

**Files:**
- Modify: `frontend/components/ChatPage.tsx`

- [ ] **Step 1: Replace the entire `processFile` useCallback**

Find the `processFile` useCallback (currently lines ~335–392) and replace it entirely:

```ts
const processFile = useCallback(async (file: File) => {
  const tempId = crypto.randomUUID();

  setDocs(prev => {
    const next = new Map(prev);
    next.set(tempId, { status: "loading", file, tempId });
    return next;
  });

  try {
    const token = await getValidToken();
    if (!token) throw new Error("Not authenticated");

    // 1. Upload
    const formData = new FormData();
    formData.append("file", file);
    const uploadRes = await fetch("/api/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!uploadRes.ok)
      throw new Error(`Upload failed: ${await uploadRes.text()}`);
    const { file_hash: fileHash } = await uploadRes.json();

    // 2. Process via Azure Document Intelligence
    const processRes = await fetch(`/api/documents/process/file/${fileHash}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ processor: "azure_doc_intelligence" }),
    });
    if (!processRes.ok)
      throw new Error(`Processing failed: ${await processRes.text()}`);
    const { processor_used: processorUsed = "azure_doc_intelligence" } =
      await processRes.json();

    // 3. Retrieve markdown
    const contentRes = await fetch(
      `/api/documents/${fileHash}/content?processor_used=${processorUsed}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!contentRes.ok)
      throw new Error(`Content retrieval failed: ${await contentRes.text()}`);
    const { markdown_content: markdown = "" } = await contentRes.json();

    setDocs(prev => {
      const next = new Map(prev);
      next.set(tempId, { status: "ready", file, tempId, fileHash, markdown, processorUsed });
      return next;
    });
    toast.success(`"${file.name}" attached as context`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to process document";
    setDocs(prev => {
      const next = new Map(prev);
      next.set(tempId, { status: "error", file, tempId, error: msg });
      return next;
    });
    toast.error(msg);
  }
}, []);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/azureuser/projects/SummarizationTool/frontend
npx tsc --noEmit 2>&1 | head -40
```

Expected: `processFile` errors gone. Remaining errors are about `attachedDoc` references in handlers and JSX (fixed next tasks).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ChatPage.tsx
git commit -m "feat(chat): rewrite processFile for per-file Map state"
```

---

### Task 3: Update file input handler and drag-and-drop for multiple files

**Files:**
- Modify: `frontend/components/ChatPage.tsx`

- [ ] **Step 1: Replace `handleFileInputChange`**

Find and replace:
```ts
const handleFileInputChange = useCallback(
  (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (file) processFile(file);
  },
  [processFile]
);
```

With:
```ts
const handleFileInputChange = useCallback(
  (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    const available = MAX_DOCS - Array.from(docs.values()).filter(d => d.status !== "error").length;
    if (available <= 0) return;
    const toProcess = files.slice(0, available);
    if (files.length > available)
      toast.warning(`Maximum ${MAX_DOCS} documents — ${files.length - available} file(s) skipped`);
    toProcess.forEach(f => processFile(f));
  },
  [docs, processFile]
);
```

- [ ] **Step 2: Replace `handleDrop`**

Find and replace:
```ts
const handleDrop = useCallback(
  (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  },
  [processFile]
);
```

With:
```ts
const handleDrop = useCallback(
  (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const available = MAX_DOCS - Array.from(docs.values()).filter(d => d.status !== "error").length;
    if (available <= 0) {
      toast.error(`Maximum ${MAX_DOCS} documents already attached`);
      return;
    }
    const toProcess = files.slice(0, available);
    if (files.length > available)
      toast.warning(`Maximum ${MAX_DOCS} documents — ${files.length - available} file(s) skipped`);
    toProcess.forEach(f => processFile(f));
  },
  [docs, processFile]
);
```

- [ ] **Step 3: Add `multiple` to the hidden file input in JSX**

Find:
```tsx
<input
  ref={fileInputRef}
  type="file"
  accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.pptx,.ppt"
  className="hidden"
  onChange={handleFileInputChange}
/>
```

Replace with:
```tsx
<input
  ref={fileInputRef}
  type="file"
  multiple
  accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.pptx,.ppt"
  className="hidden"
  onChange={handleFileInputChange}
/>
```

- [ ] **Step 4: Update paperclip button's `disabled` condition**

Find:
```tsx
disabled={docLoading}
```

Replace with:
```tsx
disabled={atDocLimit}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ChatPage.tsx
git commit -m "feat(chat): support multi-file input and drag-and-drop up to 5 docs"
```

---

### Task 4: Rewrite badges UI

**Files:**
- Modify: `frontend/components/ChatPage.tsx`

- [ ] **Step 1: Replace the entire document badge section in JSX**

Find this block (lines ~696–736):
```tsx
{/* Document badge */}
{(attachedDoc || docLoading || docError) && (
  <div className="flex items-center gap-2 px-1">
    {docLoading && (
      ...
    )}
    {docError && !docLoading && (
      ...
    )}
    {attachedDoc && !docLoading && (
      ...
    )}
  </div>
)}
```

Replace it entirely with:
```tsx
{/* Document badges */}
{docs.size > 0 && (
  <div className="flex flex-wrap gap-2 px-1">
    {Array.from(docs.values()).map(entry => {
      if (entry.status === "loading") {
        return (
          <div
            key={entry.tempId}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted text-xs text-muted-foreground"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span className="truncate max-w-[200px]">{entry.file.name}</span>
          </div>
        );
      }
      if (entry.status === "error") {
        return (
          <div
            key={entry.tempId}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-destructive/10 text-destructive text-xs"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[200px]">{entry.file.name}</span>
            <button
              onClick={() => removeDoc(entry.tempId)}
              className="ml-0.5 hover:opacity-70"
              aria-label="Remove"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      }
      // ready
      return (
        <div
          key={entry.tempId}
          className="inline-flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-xl border border-border bg-muted/50 text-xs"
        >
          <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-medium truncate max-w-[180px]">{entry.file.name}</span>
          <span className="text-muted-foreground">· in context</span>
          <button
            onClick={() => removeDoc(entry.tempId)}
            className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Remove document"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    })}
  </div>
)}

{/* Context window error banner */}
{contextError && (
  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-xs">
    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
    <span className="flex-1">
      Context window exceeded — your documents are too large. Remove a document and try again.
    </span>
    <button
      onClick={() => setContextError(false)}
      className="ml-0.5 hover:opacity-70"
      aria-label="Dismiss"
    >
      <X className="h-3 w-3" />
    </button>
  </div>
)}
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
cd /home/azureuser/projects/SummarizationTool/frontend
npx tsc --noEmit 2>&1 | head -40
```

Expected: only remaining errors are in `sendQuery` (references to `attachedDoc`). Fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ChatPage.tsx
git commit -m "feat(chat): per-file badge chips with loading/error/ready states"
```

---

### Task 5: Update `sendQuery`, fix context window detection, and clean up deps

**Files:**
- Modify: `frontend/components/ChatPage.tsx`

- [ ] **Step 1: Add context window error detection helper above `sendQuery`**

Add this function just above the `sendQuery` useCallback:

```ts
const isContextWindowError = (msg: string) => {
  const lower = msg.toLowerCase();
  return (
    lower.includes("context_length_exceeded") ||
    lower.includes("maximum context length") ||
    lower.includes("context window") ||
    (lower.includes("token") && lower.includes("limit"))
  );
};
```

- [ ] **Step 2: Replace `sendQuery` body**

Find the `sendQuery` useCallback and replace its body (keeping the outer `useCallback` wrapper):

```ts
const sendQuery = useCallback(
  async (query: string) => {
    const modelConfig = getModelConfig();
    if (!modelConfig) {
      toast.error("Please select a model");
      return;
    }

    setContextError(false);
    setIsLoading(true);

    // Build combined document markdown from all ready docs
    const readyDocs = Array.from(docs.values()).filter(
      (d): d is Extract<DocEntry, { status: "ready" }> => d.status === "ready"
    );
    const documentMarkdown =
      readyDocs.length > 0
        ? readyDocs
            .map(d => `<document name="${d.file.name}">\n${d.markdown}\n</document>`)
            .join("\n\n")
        : null;

    try {
      const token = await getValidToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/chat/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query,
          document_markdown: documentMarkdown,
          model_type: modelConfig.modelType,
          model_id: modelConfig.modelId,
          deployment: modelConfig.deployment ?? null,
          api_version: modelConfig.apiVersion ?? null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error || "Request failed");

      setMessages(prev => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: data.response },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (isContextWindowError(msg)) {
        setContextError(true);
      } else {
        setMessages(prev => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: `Error: ${msg}` },
        ]);
      }
    } finally {
      setIsLoading(false);
    }
  },
  [docs, getModelConfig]
);
```

- [ ] **Step 3: Verify TypeScript compiles with zero errors**

```bash
cd /home/azureuser/projects/SummarizationTool/frontend
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Start dev server and manual smoke test**

```bash
cd /home/azureuser/projects/SummarizationTool
# start frontend dev server (adjust command to match project)
cd frontend && npm run dev
```

Manual checks:
1. Open the chat page — no console errors, UI looks identical to before
2. Click paperclip → file picker opens with multi-select enabled
3. Attach one PDF → loading spinner badge appears → transitions to "· in context" badge with X
4. Attach a second PDF → both badges visible simultaneously, both process in parallel
5. Click X on one badge → it disappears, slot freed
6. Attach 5 PDFs → paperclip button becomes disabled
7. Drag-and-drop a file → works, adds as a badge
8. Send a message with 2 docs attached → both doc names visible in badges, response references content from both
9. Drag-and-drop 6 files → 5 attach, toast warns "1 file(s) skipped"
10. Re-attach a previously processed PDF → returns near-instantly (cache hit)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ChatPage.tsx
git commit -m "feat(chat): multi-doc prompt construction and context window error banner"
```

---

## Self-Review

**Spec coverage:**
- ✅ Up to 5 docs — `MAX_DOCS = 5`, `atDocLimit` disables attach button
- ✅ Parallel processing — each `processFile` call is independent, no awaiting
- ✅ Per-file loading/error/ready badges — Task 4
- ✅ Remove individual docs — `removeDoc` + X button on each badge
- ✅ Cache reuse — unchanged flow, backend returns cached markdown instantly
- ✅ Multi-file drag-and-drop — Task 3
- ✅ Multi-file file picker — `multiple` attribute + updated handler
- ✅ Context window error banner — Task 5, dismissable with X
- ✅ Backend unchanged — still `document_markdown: Optional[str]`
- ✅ Prompt wraps each doc in `<document name="...">` tags

**Placeholder scan:** No TBDs, no "add appropriate error handling", no "similar to above".

**Type consistency:**
- `DocEntry` defined in Task 1, used in Tasks 2, 4, 5 — consistent
- `removeDoc(tempId: string)` defined in Task 1, called in Task 4 — consistent
- `docs` state is `Map<string, DocEntry>` throughout — consistent
- `atDocLimit` derived in Task 1, used in Task 3 — consistent
