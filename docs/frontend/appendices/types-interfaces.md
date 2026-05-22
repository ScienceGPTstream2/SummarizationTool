# Key TypeScript Interfaces

The most important types in the frontend codebase. All are defined in `App.tsx` or `types/session.ts` unless noted.

---

## `DocumentData`

The central state object passed to every page. Accumulates everything a reviewer has done in a session.

```typescript
interface DocumentData {
  // Upload
  file: File | null;                      // Primary file object (single-file path)
  fileId?: string;                        // SHA-256 hash of the primary file
  uploadResult?: UploadResponse;          // Raw /api/upload response
  parser: string;                         // "azure" | "docling" | "auto"
  uploadedFiles?: UploadedFile[];         // All files (multi-file path)

  // Processing
  extractedText: string;                  // Markdown from primary file
  annotatedOutput: string;                // Markdown with figure summaries injected

  // Study config
  studyType: string;                      // "toxicology" | "epidemiology" | "custom"
  summaryPrompt?: string;                 // Paragraph generation system prompt
  selectedModel: string;                  // Primary model ID
  selectedModels?: string[];             // All selected models
  temperature?: number;

  // Entities (set at study config, populated at extraction)
  entities: Entity[];

  // Session
  sessionId?: string;

  // Config objects
  filesConfig?: FilesConfig;
  evaluationConfig?: EvaluationConfig;
}
```

---

## `Entity`

A single extraction field. Defined at study config; populated at extraction and evaluation.

```typescript
interface Entity {
  name: string;                           // Display name, e.g. "Test material"
  prompt: string;                         // Extraction prompt sent to the LLM

  // Populated after extraction
  extracted?: string;                     // Reviewer-accepted value (may be edited)
  answer?: string;                        // Raw LLM answer (never overwritten)
  references?: Reference[];              // Source passages from the document
  duration?: number;                     // Extraction duration in ms
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;

  // Multi-model results
  extractionsByModel?: Record<string, ModelExtractionResult>;

  // Evaluation
  evaluationResults?: EvaluationResult[];

  // System prompt (optional per-entity override)
  systemPrompt?: string;
}
```

---

## `UploadedFile`

One entry in `documentData.uploadedFiles`. Extends the single-file fields for multi-document sessions.

```typescript
interface UploadedFile {
  filename: string;
  fileId: string;                         // SHA-256 hash
  uploadResult?: UploadResponse;
  processingResult?: ProcessingResult;
  parser: string;
  extractedText?: string;
  annotatedOutput?: string;
  studyType?: string;
  entities?: Entity[];
  summaryPrompt?: string;
  selectedModels?: string[];
}
```

---

## `Reference`

A source passage returned by the extraction API — where in the document the LLM found the answer.

```typescript
interface Reference {
  text: string;                           // The passage text
  page?: number;                          // 1-indexed page number
  boundingBox?: BoundingBox;             // Pixel coordinates on the page
}

interface BoundingBox {
  x: number;                              // Left edge (page-relative, 0–1)
  y: number;                              // Top edge (page-relative, 0–1)
  width: number;
  height: number;
  pageWidth?: number;                     // Page width in points (for scaling)
  pageHeight?: number;
}
```

---

## `ModelExtractionResult`

One model's extraction result for one entity.

```typescript
interface ModelExtractionResult {
  answer: string;
  references?: Reference[];
  duration?: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  modelId: string;
  strategy?: string;                      // Provider-specific strategy metadata
  error?: string;                         // Set if this model's extraction failed
}
```

---

## `EvaluationResult`

One metric score for one entity.

```typescript
interface EvaluationResult {
  metric: "correctness" | "completeness" | "relevance" | "safety" | string;
  score: number;                          // 0.0–1.0
  passed: boolean;                        // score >= threshold (default 0.5)
  reason?: string;                        // Judge's reasoning text
  judgeModel?: string;
  extractionModel?: string;               // Which extraction result was evaluated
  human_score?: number;                   // Reviewer override (0.0–1.0)
  error?: string;
}
```

---

## `Template`

A saved, versioned set of entity definitions and prompts.

```typescript
interface Template {
  id: string;
  name: string;
  description: string | null;
  study_type: string | null;
  scope: "user" | "group" | "global";
  owner_user_id: string | null;
  owner_group_id: string | null;
  system_prompt: string | null;
  summary_prompt: string | null;
  entities: TemplateEntity[];
  variables: TemplateVariable[];
  tags: string[];
  is_immutable: boolean;
  version: number;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface TemplateEntity {
  name: string;
  prompt: string;
  system_prompt?: string;
}
```

---

## `Group` and `Member`

```typescript
interface Group {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  member_count?: number;
  user_role?: "owner" | "admin" | "member";
}

interface Member {
  user_id: string;
  email: string;
  name?: string;
  image?: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
}
```

---

## `ModelConfig`

How the frontend represents a configured LLM provider. Stored in `SettingsManager` (localStorage).

```typescript
interface ModelConfig {
  provider: string;           // "azure" | "gemini" | "anthropic" | "llama" | "vllm"
  modelId: string;            // Display identifier, e.g. "azure-gpt4o"
  apiKey?: string;
  endpoint?: string;          // Azure deployment endpoint or Vertex project
  deploymentName?: string;    // Azure OpenAI deployment name
  apiVersion?: string;        // Azure API version string
  region?: string;            // Vertex AI region
}
```

---

## `EvaluationConfig`

Persisted evaluation settings, stored in `documentData.evaluationConfig`.

```typescript
interface EvaluationConfig {
  metrics: string[];                      // ["correctness", "completeness", ...]
  judgeModel: ModelConfig;
  customSteps?: string[];                 // For custom metric
  scoreThreshold: number;                 // Default 0.5
}
```
