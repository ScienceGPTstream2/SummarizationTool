# Study Config Page (Workflow Step 3)

> *Before running extraction, a reviewer needs to tell the tool what to look for. The Study Config page is where reviewers pick a study type (toxicology, epidemiology, or custom), load or define a set of entities to extract, and choose which AI models to use. Think of it as building the extraction checklist. The output of this step is the list of entity definitions that the Extraction page will work through.*

**File:** `components/BatchStudySelectionPage.tsx` (~1242 lines)

---

## 1. UI sections

| Section | Purpose |
|---|---|
| File selector | Choose which uploaded file is being configured (multi-file mode) |
| Study type picker | Select toxicology, epidemiology, or custom |
| Template picker | Load entity definitions from a saved template |
| Entity list | Shows all entities with their extraction prompts |
| Entity editor | Add, remove, or edit the name and prompt of each entity |
| Summary prompt | Optional: customise the paragraph summary system prompt |
| Paragraph system prompt | Optional: customise the paragraph generation model instructions |
| Model selector | Choose which AI models to use for extraction |
| Global vs. per-file toggle | Apply the same entity config to all files, or configure each file separately |

---

## 2. Study types and built-in templates

Three built-in study types are available, loaded from `components/TemplateLoader.tsx`:

| Study type | Description | Typical entities |
|---|---|---|
| `toxicology` | In vivo developmental toxicity studies | Test material, species, dose levels, route, maternal effects, fetal effects |
| `epidemiology` | Human health observational studies | Participant count, pesticide of interest, exposure measurement, health outcomes, measures of association, strengths, limitations, risk of bias |
| `custom` | Reviewer-defined | Any fields the reviewer specifies |

When the reviewer selects a study type, `loadStudyTypeTemplate()` populates the entity list with the default prompts for that study type. The reviewer can edit, add, or remove entities freely after loading.

---

## 3. Loading from a saved template

The `TemplatePicker` component (see [appendices/component-index.md](appendices/component-index.md)) shows all templates accessible to the reviewer (personal, group-shared, and global). Selecting a template replaces the current entity list with the template's entities and system prompt.

The reviewer can then modify the loaded entities before running extraction — selecting a template is always a starting point, not a locked-in configuration.

---

## 4. Multi-file configuration

When multiple files are uploaded, the reviewer has two modes:

- **Global config:** All files use the same study type, entity list, and model selection. Changes apply to all files at once.
- **Per-file config:** Each file can have a different study type and entity list. The file selector at the top switches between file-specific configurations.

The active mode is tracked in `useGlobalConfig` (boolean state). Switching from per-file to global merges all per-file configs into a single shared config, with a confirmation dialog.

---

## 5. Model selection

The model selector shows all configured AI providers from `SettingsManager`. The reviewer can select multiple models — extraction will run once per model for each entity, enabling side-by-side comparison on the Extraction page.

Provider groups shown:
- Azure OpenAI (GPT-4o, GPT-4.1, etc.)
- Google Vertex AI (Gemini 2.5 Pro, Gemini 2.0 Flash, etc.)
- Anthropic (Claude Sonnet 4.5, Claude Opus 4.1, etc.)
- Cohere, Llama, local models — shown only if configured

---

## 6. State

| State field | Type | Purpose |
|---|---|---|
| `fileConfigs` | `Map<string, FileConfig>` | Per-file entity + study type config |
| `useGlobalConfig` | `boolean` | Whether all files share one config |
| `globalEntities` | `Entity[]` | Entity list when in global config mode |
| `studyType` | `string` | Selected study type |
| `summaryPrompt` | `string` | Optional summary system prompt |
| `selectedModels` | `string[]` | All models selected for extraction |

---

## 7. API calls

This page makes no direct API calls. Entity templates are loaded from `TemplateLoader` (built-in JSON) or from the `useTemplates` hook (saved templates). Model metadata is read from `SettingsManager` (localStorage).

---

## 8. `onComplete()` payload

```typescript
onComplete({
  studyType: "toxicology",
  entities: [
    { name: "Test material", prompt: "What is the test material or compound used in this study?" },
    { name: "Species", prompt: "What animal species and strain were used?" },
    // ...
  ],
  summaryPrompt: "Summarise the key findings...",
  selectedModels: ["azure-gpt4o", "gemini-2.5-pro"],
  uploadedFiles: updatedUploadedFiles,  // with per-file entity configs merged in
})
```

App.tsx navigates to `extraction`.

---

## 9. Validation

Before allowing "Next", the page validates:
- At least one entity is defined.
- All entity names are non-empty.
- At least one model is selected.

Validation errors are shown inline next to the relevant field. The "Next" button is disabled until all errors are resolved.
