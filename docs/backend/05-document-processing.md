# Document Processing Technical Design

This document describes upload, storage, parsing, artifact access, bounding-box normalization, figure/table handling, and document-view construction.

## 1. Scope

In scope:

- file upload and SHA-256 deduplication;
- Azure Blob Storage paths and local cache paths;
- processor selection between Azure Document Intelligence and Docling;
- processor output artifacts;
- document viewer/restore state;
- raw analysis normalization;
- figure/table serving and figure-summary generation.

Out of scope:

- frontend rendering of the document viewer;
- cloud provisioning for blob storage;
- internals of the remote Docling service outside this repository.

## Visual workflow

![Document upload and processing workflow](images/document-processing-workflow.png)

The workflow is content-addressed. `POST /api/upload` validates the PDF, computes a SHA-256 hash, and writes only one global original artifact per hash. Processing then uses that hash as the stable document id. A strict cache hit requires `processed/{processor}/document.md`; metadata-only or partial artifact trees are readable for inspection but do not satisfy the processing cache gate. On a cache miss, the service hydrates the original file into `/tmp/summarization/{hash}`, writes parser outputs locally, syncs the full processor tree to Azure Blob Storage, updates DB metadata when a session document exists, and returns a canonical `document_view` object for restore/viewer workflows.

## 2. Main classes and files

| Class/function | File | Responsibility |
| --- | --- | --- |
| `DocumentService` | `backend/services/document/document_service.py` | High-level parser façade and artifact readers. |
| `OrganizedFileService` | `backend/services/document/organized_file_service.py` | Hash-based upload, blob paths, processed artifact access, document-view builder. |
| `OrganizedDocumentProcessor` | `backend/services/document/organized_processor.py` | Coordinates processing into organized `/tmp` and blob paths. |
| `BlobStorageClient` | `backend/services/storage/blob_storage.py` | Async Azure Blob Storage wrapper. |
| `AzureDocIntelligenceService` | `backend/services/document/processors/azure_doc_intelligence/azure_doc_intelligence_service.py` | Azure parser implementation. |
| `DoclingService` | `backend/services/document/processors/docling/docling_service.py` | Local Docling parser implementation with process pool and VRAM guard. |
| `DoclingRemoteClient` | `backend/services/document/processors/docling/docling_remote_client.py` | Remote Docling service client. |
| `VRAMGuard` | `backend/services/document/processors/docling/vram_guard.py` | GPU memory-aware concurrency guard for local Docling. |
| `normalize_bbox_format()` | `backend/services/document/bbox_normalizer.py` | Normalizes Azure/Docling raw analysis to a common shape. |
| bbox matchers | `backend/services/document/processors/*/bounding_box_matcher.py` | Match extraction references to document bounding boxes. |

## 3. Upload and storage model

### 3.1 Upload entry point

`POST /api/upload` calls `OrganizedFileService.save_uploaded_file()`.

### 3.2 Hashing and deduplication

`OrganizedFileService.compute_file_hash(content)` computes a SHA-256 hex digest. That hash is the stable identifier used across upload, processing, retrieval, and cache lookup.

Upload blob layout:

```text
global/{sha256}/original.{ext}
global/{sha256}/metadata.json
```

Upload metadata includes:

- `file_hash`
- `original_filename`
- `file_size`
- `mime_type`
- `created_at`
- `extension`

If the original blob already exists, upload returns `is_new=False` and `deduplicated=True` instead of rewriting the file.

### 3.3 Optional DB registration

When a user id is available, `save_uploaded_file()` attempts to register a `Document` row through the DB service. DB registration failures are warning-logged and do not fail blob upload.

## 4. Processed artifact model

### 4.1 Local scratch path

Processors write to local scratch space first:

```text
/tmp/summarization/{sha256}/processed/{processor}/
```

This path is returned by `OrganizedFileService.get_processing_output_path(file_hash, processor)`.

### 4.2 Blob processed path

After processing completes, the local tree is synced to blob:

```text
global/{sha256}/processed/{processor}/document.md
global/{sha256}/processed/{processor}/metadata.json
global/{sha256}/processed/{processor}/raw_analysis.json
global/{sha256}/processed/{processor}/figures/{filename}
global/{sha256}/processed/{processor}/tables/{filename}
```

`OrganizedFileService.sync_processing_output_to_blob()` uploads the directory recursively and preserves relative paths.

### 4.3 Read/cache behavior

`OrganizedFileService.get_processing_file_bytes(file_hash, processor, relative_path)` reads from local `/tmp` first. If missing, it downloads from blob, writes the bytes into the matching local cache path, and returns them.

This supports cross-replica blob persistence with per-container local cache warming.

## 5. Processor selection

`DocumentService.convert_document_to_markdown()` accepts a `ProcessorType`:

- `auto`
- `azure_doc_intelligence`
- `docling`

Current auto-selection algorithm:

```text
if Azure Document Intelligence is available:
    choose azure_doc_intelligence
else:
    choose docling
```

If Azure is explicitly requested but unavailable, the service falls back to Docling and annotates the result with:

- `processor_used = "docling"`
- `processor_fallback = True`
- `fallback_reason = "Azure Document Intelligence not available"`

## 6. Azure Document Intelligence processing

Class: `AzureDocIntelligenceService`

### 6.1 Availability

Azure is available only when:

- the Azure Document Intelligence SDK imports successfully;
- `AZURE_DOC_INTELLIGENCE_ENDPOINT` is configured;
- `AZURE_DOC_INTELLIGENCE_KEY` is configured.

### 6.2 Conversion algorithm

For each conversion:

1. Create a conversion id and output directory.
2. Call Azure `begin_analyze_document()` with markdown output and optional figures.
3. Wait for `poller.result()`.
4. Save the complete result dictionary as `raw_analysis.json`.
5. Save markdown content as `document.md`.
6. Extract HTML table blocks from markdown into `tables/table-{n}.html`.
7. Download figure images when result id and figure ids are available.
8. Save summary `metadata.json`.

### 6.3 Azure output files

```text
document.md
raw_analysis.json
metadata.json
conversion.log
figures/{figure_id}.png
tables/table-{idx}.html
```

Metadata includes:

- conversion id;
- source/source type;
- processor/model id;
- status;
- conversion/log/raw/markdown paths;
- start/end time;
- conversion time and parse duration;
- content length;
- page count;
- table count;
- key-value pair count;
- figure count and figure metadata.

Figure metadata includes id, page, caption, spans, bounding regions, and optional image path.

## 7. Docling processing

There are two Docling-related implementation paths:

- `DoclingRemoteClient` for the remote Docling service used by `DocumentService` and `OrganizedDocumentProcessor`.
- `DoclingService` for local processing with multiprocessing and VRAM-aware concurrency.

### 7.1 Local Docling worker algorithm

`_docling_worker_process()` performs the conversion in a subprocess:

1. Initialize or reuse a process-local `DocumentConverter`.
2. Convert the source PDF.
3. Extract picture items and save PNGs into `figures/`.
4. Export markdown to `document.md`.
5. Export table HTML to `tables/table-{idx}.html`.
6. Build a Docling-style `raw_analysis.json` containing pages, paragraphs, tables, figures, and document structure.
7. Optionally write a debug `docling_document.json`.
8. Return success metadata including parse duration, markdown, page count, image info, and peak VRAM.

### 7.2 Docling output files

```text
document.md
raw_analysis.json
metadata.json
conversion.log
figures/picture-{n}.png
tables/table-{idx}.html
docling_document.json   # debug output when available
```

### 7.3 VRAM guard

`VRAMGuard` protects local Docling conversion concurrency.

Key behavior:

- Computes max workers from total GPU VRAM, safety margin, and observed per-worker memory.
- Uses cold-start limits before enough jobs have completed.
- Provides async `acquire_slot()` context manager.
- Tracks active and queued workers.
- Updates per-worker estimate from recent peak VRAM observations.
- Persists state in `.vram_guard_state.json` when possible.
- On OOM, increases estimated per-worker memory and shrinks allowed concurrency.

## 8. Organized processing flow

`OrganizedDocumentProcessor.process_document()` provides a hash-oriented processing path:

```text
input file path
  -> read bytes and compute hash
  -> OrganizedFileService.save_uploaded_file()
  -> if already processed and not force_reprocess:
         return cached document.md + metadata
     else:
         output_path = /tmp/summarization/{hash}/processed/{processor}
         original_path = get_original_file_path(hash)
         process with Azure or Docling
         sync output_path to blob
         return result
```

Cache hit requires `OrganizedFileService.is_file_processed()`, which strictly checks for `document.md`.

## 9. Artifact resolution

`OrganizedFileService.resolve_processed_processor(file_hash, preferred_processor)` chooses the processor subtree to read.

Candidate order:

1. preferred processor if given;
2. `azure_doc_intelligence`;
3. `docling`.

A processor counts as resolved if any of the following exists:

- `metadata.json`
- `document.md`
- `raw_analysis.json`
- any blob under the processed subtree prefix

This is intentionally more permissive than `is_file_processed()` so partially available artifact trees can still be inspected.

## 10. Document view contract

`OrganizedFileService.build_document_view()` assembles canonical frontend state.

Top-level fields include:

- `fileName`
- `fileId`
- `status`
- `selectedParser`
- `processorUsed`

Nested `processingResult` fields include both camelCase and snake_case names for compatibility:

- `conversionId`
- `fileHash`
- `processorUsed`
- `markdownPath`
- `parseCost` / `parse_cost`
- `parseDuration` / `parse_duration_seconds`
- `pageCount` / `page_count`
- `figures`
- `figuresCount`
- `tablesCount`
- `artifactAvailability`

Artifact availability flags:

- `original`
- `markdown`
- `analysis`
- `figures`
- `tables`

If figure/table counts are missing from metadata, the service enumerates blob prefixes under `figures/` and `tables/`.

## 11. Raw analysis normalization

`normalize_bbox_format(analysis_result)` detects processor type and returns a normalized shape.

### 11.1 Processor detection

Azure indicators:

- `apiVersion`
- `modelId`
- camelCase `boundingRegions`
- page `unit`

Docling indicators:

- `api_version`
- `document_structure`
- snake_case `bounding_regions`

### 11.2 Normalized output shape

Common top-level fields:

- `processor`
- `api_version`
- `model_id`
- `pages`
- `paragraphs`
- `tables`
- `figures`

Azure page coordinates in inches are converted to points. Docling output is already closer to the normalized snake_case shape and is mostly copied with field normalization.

## 12. Bounding-box and reference matching

Azure matcher:

- normalizes text;
- searches paragraphs first;
- falls back to page lines;
- extracts figure references with regexes such as Figure/Fig/FIG;
- maps figure references to figure metadata and bounding regions;
- returns best matches plus paragraph/line match candidates.

Docling matcher:

- searches paragraphs;
- falls back to page-level match;
- can extract polygon coordinates from 8-value arrays;
- returns simpler match structures than Azure.

These matchers are used by extraction routes to attach visual grounding to entity answers.

## 13. Figure and table handling

### 13.1 Figure image serving

`GET /api/documents/{document_id}/figures/{figure_filename}` reads figure bytes from processed artifacts and returns an image response.

The router validates filenames before reading artifacts to avoid arbitrary path access.

### 13.2 Figure summary generation

`POST /api/documents/{document_id}/figures/{figure_id}/generate-summary`:

1. resolves figure metadata and image path;
2. writes image bytes to a temporary file if required by provider client;
3. calls `LLMService.extract_content_from_image()`;
4. stores generated content back in metadata;
5. returns the updated figure summary.

### 13.3 Enhanced markdown

`GET /api/documents/{document_id}/enhanced-content` inserts available figure summaries into markdown near their figure references.

### 13.4 Table serving

`GET /api/documents/{document_id}/tables/{table_filename}` returns saved table HTML from the processed artifact tree.

## 14. Failure modes

| Failure | Current behavior |
| --- | --- |
| Missing blob connection string | `OrganizedFileService` construction fails. |
| Duplicate upload | Returns existing hash and dedupe flags. |
| Missing processed document | Content endpoints return not-found style errors. |
| Azure unavailable | Auto mode uses Docling; explicit Azure falls back with flags. |
| Figure image missing | Figure endpoint returns not found; summary generation fails for that figure. |
| Malformed raw analysis | Some readers assume valid JSON; callers may receive errors. |
| Docling OOM | Worker returns structured error, VRAM guard reports OOM and shrinks concurrency estimate. |

## 15. Related docs

- [02-api-surface.md](02-api-surface.md)
- [03-data-models.md](03-data-models.md)
- [07-extraction-flow.md](07-extraction-flow.md)
- [appendices/data-flow-diagrams.md](appendices/data-flow-diagrams.md)
