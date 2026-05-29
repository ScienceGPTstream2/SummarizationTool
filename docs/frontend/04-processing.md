# Processing Page (Workflow Step 2)

> *After files are uploaded, the Processing page lets reviewers inspect what the parser actually extracted — the structured text, any figures, and any tables. It's an inspection and verification step: reviewers can check that the document parsed correctly, view the raw analysis, and re-process with a different parser if the output looks wrong. They can also view figures and tables with their bounding-box locations highlighted on the original PDF.*

**File:** `components/ProcessingPage.tsx` (~534 lines)

---

## 1. UI sections

| Section | Purpose |
|---|---|
| File list (sidebar) | Select which uploaded file to inspect |
| Parser selector | Change parser for the selected file; triggers re-processing |
| Re-process button | Re-run document processing with the current parser selection |
| Tab: Text | Shows the extracted markdown content |
| Tab: Figures | Gallery of extracted figures with captions and metadata |
| Tab: Tables | HTML table viewer for extracted tables |
| Tab: Raw | Syntax-highlighted raw analysis JSON from the parser |
| PDF bounding box viewer | Highlights figure/table locations on the original PDF pages |
| Status indicators | Processing / processed / error per file |

---

## 2. How processing results are loaded

When this page mounts, `documentData.uploadedFiles` already contains the processing results from the Upload step. The Processing page reads these results — it does not re-call the backend unless the reviewer explicitly clicks Re-process.

```
Page mounts
  │
  ▼
Read uploadedFiles from documentData
  │
  ▼
Populate file list + set first file as active
  │
  ▼
Display processing result for active file (text / figures / tables)
```

---

## 3. Re-processing a file

If a reviewer switches to a different parser and clicks Re-process:

```
Reviewer changes parser + clicks Re-process
  │
  ▼
POST /api/documents/process/file/{file_hash}
  Body: { processor: "azure" | "docling" }
  │
  ▼
Backend returns new document view (may be cached if already processed with this parser)
  │
  ▼
Update processedFiles[filename] with new result
  │
  ▼
onInvalidateDownstream("processing") — clears extraction + evaluation results
```

Re-processing with a different parser does not re-upload the file — the original bytes are already in blob storage under the file hash.

---

## 4. The PDF bounding box viewer

The `PDFBoundingBoxViewer` shared component (see [appendices/component-index.md](appendices/component-index.md)) renders the original PDF in-browser using `pdfjs-dist` and draws coloured overlaid boxes at the coordinates returned by the parser.

- Azure Document Intelligence returns bounding polygons in inches; the backend normalizes these to page-relative coordinates before sending to the frontend.
- Docling returns bounding boxes in page-relative coordinates directly.
- Clicking a figure or table in the Figures or Tables tab scrolls the PDF viewer to the relevant page and highlights the bounding box.

---

## 5. State

| State field | Type | Purpose |
|---|---|---|
| `files` | `FileStatus[]` | All uploaded files with their current processing state |
| `activeFile` | `string` | Filename of the currently selected file |
| `selectedTab` | `"text" \| "figures" \| "tables" \| "raw"` | Active content tab |
| `parserOverrides` | `Map<string, string>` | Tracks parser selection per file |
| `reprocessingFiles` | `Set<string>` | Files currently being re-processed |

---

## 6. API calls

| Method | Path | When | Purpose |
|---|---|---|---|
| `POST` | `/api/documents/process/file/{file_hash}` | On Re-process click | Re-run parsing with chosen parser |

---

## 7. `onComplete()` payload

When the reviewer clicks "Next":

```typescript
onComplete({
  uploadedFiles: updatedUploadedFiles,  // with any re-processing results merged in
})
```

App.tsx navigates to `study_selection`.

---

## 8. Error handling

- **Processing failure on re-process:** Shows the backend error message inline. The original result (from Upload step) is preserved — the reviewer can dismiss the error and continue with the original.
- **Missing artifacts:** If a figure image or table HTML is not found in blob storage, the gallery shows a placeholder with the artifact filename. This can happen if the blob sync was interrupted; re-processing recovers it.
- **Parser unavailable:** If Azure Document Intelligence credentials are not configured, the Azure option is disabled with a tooltip explaining why.
