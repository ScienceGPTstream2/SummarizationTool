# Upload Page (Workflow Step 1)

> *The first thing a reviewer does is bring their documents into the tool. The Upload page handles file selection, uploads each file to the backend, immediately triggers document processing, and lets the reviewer choose which parser to use. By the time the reviewer clicks "Next", every file has been uploaded and converted into structured text that the AI models can read.*

**File:** `components/UploadPage.tsx` (~914 lines)

---

## 1. UI sections

| Section | Purpose |
|---|---|
| Drag-and-drop zone | Drop files or click to open file picker |
| File list | Shows each file with upload + processing status indicators |
| Parser selector (global) | Choose Azure Document Intelligence, Docling, or Auto for all files |
| Per-file parser override | Override the global parser for individual files |
| Status indicators | Pending / uploading / processing / processed / error per file |
| Error panel | Per-file error messages with retry option |

---

## 2. Upload and processing flow

Upload and processing happen automatically — the reviewer does not need to click a separate "Process" button.

```
Reviewer drops files
  │
  ▼
For each file (concurrent):
  POST /api/upload  (multipart)
  │  Returns: { file_hash, blob_path, is_duplicate, filename, size }
  │
  ▼
  Store file_hash in uploadResults[filename]
  │
  ▼
  POST /api/documents/process/file/{file_hash}
  │  Body: { processor: "azure" | "docling" | "auto" }
  │  Returns: document view (markdown, figures, tables, metadata)
  │
  ▼
  Store result in processedFiles[filename]
  │
  ▼
  Mark file as "processed" in status display
```

If the backend returns a cached result (file already processed with this parser), processing completes in milliseconds. The `is_duplicate` flag from the upload response is shown in the UI so the reviewer knows the file was recognised.

---

## 3. State

| State field | Type | Purpose |
|---|---|---|
| `selectedFiles` | `File[]` | Files the reviewer has selected but not yet uploaded |
| `uploadResults` | `Map<string, UploadResponse>` | Keyed by filename; stores file hash and blob path |
| `processedFiles` | `Map<string, ProcessingResult>` | Keyed by filename; stores markdown and artifact metadata |
| `uploadErrors` | `Map<string, string>` | Per-file upload error messages |
| `processingErrors` | `Map<string, string>` | Per-file processing error messages |
| `processingFiles` | `Set<string>` | Filenames currently being processed (for spinner display) |
| `fileParsers` | `Map<string, string>` | Per-file parser override |
| `globalParser` | `string` | Default parser applied to all files |

---

## 4. API calls

| Method | Path | When | Purpose |
|---|---|---|---|
| `POST` | `/api/upload` | On file drop/select | Upload file bytes, get file hash |
| `POST` | `/api/documents/process/file/{file_hash}` | Immediately after upload | Convert file to markdown/figures/tables |

---

## 5. `onComplete()` payload

When the reviewer clicks "Next", the page calls:

```typescript
onComplete({
  uploadedFiles: [
    {
      fileId: "sha256hash",
      filename: "study_001.pdf",
      uploadResult: { ... },
      processingResult: { markdown, figureCount, tableCount, ... },
      parser: "azure",
    },
    // ...
  ],
  parser: globalParser,
})
```

App.tsx merges this into `documentData` and navigates to `processing`.

---

## 6. Downstream invalidation

If the reviewer adds or removes files after some have already been processed, the page calls `onInvalidateDownstream("processing")`. This clears all downstream results (processing output, entity configs, extraction results, evaluation results) from `documentData` and shows the stale warning banner.

---

## 7. Error handling

- **Upload failure:** Shows per-file error with a Retry button. The file is marked with a red error indicator. Other files continue processing normally.
- **Processing failure:** Shows the backend error message. The reviewer can change the parser and click Retry — the backend may succeed with a different processor.
- **Unsupported file type:** Rejected client-side before upload. Accepted types: PDF, DOCX, XLSX, PPTX.
