# Shared Component Index

All reusable components in `frontend/components/` that are used across multiple pages. shadcn/ui base components (`components/ui/`) are not listed here — they are standard Radix UI wrappers and are documented at [ui.shadcn.com](https://ui.shadcn.com).

---

## PDF and document viewers

### `PDFBoundingBoxViewer`

Renders a PDF in-browser using `pdfjs-dist` and draws coloured rectangular overlays at coordinates returned by the parser (figures, tables).

**Props:**
- `fileHash: string` — identifies the file in blob storage
- `boundingBoxes: BoundingBox[]` — coordinates to highlight
- `activeBoxId?: string` — scrolls to and pulses this box on change

**Used in:** [Processing](../04-processing.md), [Extraction](../06-extraction.md)

---

### `EntityPDFViewerBeta`

Advanced PDF viewer with entity-reference highlighting. Renders all referenced pages for the currently selected entity and draws coloured boxes at the bounding-box coordinates returned in the extraction response.

**Props:**
- `fileHash: string`
- `references: Reference[]` — page + bounding box per source passage
- `activeReference?: number` — index of the reference to scroll to

**Used in:** [Extraction](../06-extraction.md)

---

### `FigureGallery`

Paginated image carousel for figures extracted from a document. Shows the figure image, caption, and page number. Falls back to a placeholder if the image is unavailable in blob storage.

**Props:**
- `fileHash: string`
- `figures: FigureMetadata[]`
- `processor: string`

**Used in:** [Processing](../04-processing.md)

---

### `TablesGallery`

Paginated viewer for HTML tables extracted from a document. Renders each table's HTML in an isolated container to prevent style bleed.

**Props:**
- `fileHash: string`
- `tables: TableMetadata[]`
- `processor: string`

**Used in:** [Processing](../04-processing.md)

---

## Content rendering

### `MarkdownViewer`

Renders markdown strings with GitHub Flavoured Markdown (GFM) extensions — tables, strikethrough, task lists, code blocks with syntax highlighting.

**Props:**
- `content: string`
- `className?: string`

**Used in:** [Chat](../09-chat.md), [Extraction](../06-extraction.md), [Evaluation](../07-evaluation.md), [Batch Results](../14-batch-results.md)

---

### `RawOutputViewer`

Syntax-highlighted JSON viewer for raw parser output. Uses `react-json-view` or similar for collapsible tree rendering.

**Props:**
- `data: object`

**Used in:** [Processing](../04-processing.md)

---

## Auth

### `LoginPage`

GitHub OAuth login screen. See [02-auth.md](../02-auth.md).

### `AuthCallback`

OAuth redirect handler. See [02-auth.md](../02-auth.md).

---

## Templates and model config

### `TemplatePicker`

Dropdown that lists all templates accessible to the reviewer. On selection, resolves the template to its entity list and calls an `onSelect` callback.

**Props:**
- `onSelect: (template: Template) => void`
- `studyTypeFilter?: string`

**Used in:** [Study Config](../05-study-config.md), [Extraction](../06-extraction.md), [Executive Mode](../13-executive-mode.md)

---

### `TemplateLoader`

Utility component (no UI) that provides built-in study type templates from local JSON files.

**Exports:**
- `loadStudyTypeTemplate(studyType: string): Entity[]`
- `getAvailableStudyTypes(): string[]`
- `getStudyTypeDisplayName(studyType: string): string`

**Used in:** [Study Config](../05-study-config.md), [Simplified Flow](../08-simplified-flow.md)

---

### `SettingsManager`

Singleton class (not a React component) that manages global settings in `localStorage`. Stores API keys and model configurations per provider.

**Key methods:**
- `getModelConfigs(): ModelConfig[]` — returns all configured models
- `getModelConfig(modelId: string): ModelConfig | null`
- `saveModelConfig(config: ModelConfig): void`
- `clearModelConfig(modelId: string): void`

**Used by:** All pages that call API endpoints requiring model credentials.

---

### `SettingsPage`

Modal or overlay for editing `SettingsManager` values. Presents a form for each provider's API key, deployment name, and API version.

---

## Metrics and export

### `SessionMetrics`

Displays token usage, cost, and duration for the current session. Reads from backend session metrics endpoint and updates in real time.

**Props:**
- `sessionId: string`

**Used in:** [Extraction](../06-extraction.md), [Evaluation](../07-evaluation.md)

---

### `ExportUtils`

Non-rendered utility module for generating and downloading files client-side.

**Exports:**
- `generateWordDocument(entities, summary, options): Promise<Blob>` — builds a `.docx` file from extraction results
- `generateMarkdownDocument(entities, summary): string` — formats results as Markdown
- `downloadFile(blob, filename): void` — triggers browser download

**Used in:** [Extraction](../06-extraction.md), [Simplified Flow](../08-simplified-flow.md), [Executive Mode](../13-executive-mode.md), [Batch Results](../14-batch-results.md)

---

## Error handling

### `ErrorBoundary`

React error boundary wrapper. Catches render errors in child components and shows a fallback UI with a "Reload" button instead of a blank screen.

**Props:**
- `children: ReactNode`
- `fallback?: ReactNode`

Wraps the entire app in `main.tsx` and is also used around the PDF viewers (which can throw on malformed PDFs).
