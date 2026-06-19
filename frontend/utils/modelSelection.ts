import { ModelConfig, settingsManager } from "../components/SettingsManager";

export type { ModelConfig };

export interface ModelSelectionResult {
  model: ModelConfig;
  modelType: string;
  modelId: string;
  deployment?: string;
  apiVersion?: string;
}

// Ranked by capability: most powerful first.
// The first model that matches an available model wins.
const MODEL_PRIORITY: Array<{
  match: (m: ModelConfig) => boolean;
  modelType: string;
}> = [
  // Tier 1 — frontier reasoning (cost-efficient first)
  {
    match: (m) => m.id?.includes("gemini-3-pro"),
    modelType: "gemini",
  },
  {
    match: (m) => m.id?.includes("claude-opus-4"),
    modelType: "anthropic",
  },
  {
    match: (m) => m.provider === "Azure" && m.name?.includes("gpt-5.2"),
    modelType: "azure",
  },
  {
    match: (m) => m.provider === "Azure" && m.name === "o3",
    modelType: "azure",
  },
  // Tier 2 — strong reasoning
  {
    match: (m) => m.id?.includes("gemini-2.5-pro"),
    modelType: "gemini",
  },
  {
    match: (m) => m.id?.includes("claude-sonnet-4"),
    modelType: "anthropic",
  },
  {
    match: (m) => m.provider === "Azure" && m.name === "o3-mini",
    modelType: "azure",
  },
  {
    match: (m) =>
      m.provider === "Azure" && (m.name === "gpt-5" || m.name === "gpt-5-mini"),
    modelType: "azure",
  },
  // Tier 3 — fast & capable
  {
    match: (m) => m.id?.includes("gemini-2.5-flash") && !m.id?.includes("lite"),
    modelType: "gemini",
  },
  {
    match: (m) =>
      m.provider === "Azure" && (m.name === "gpt-4o" || m.name === "o4-mini"),
    modelType: "azure",
  },
  // Tier 4 — lightweight / fast
  {
    match: (m) => m.id?.includes("gemini-2.5-flash-lite"),
    modelType: "gemini",
  },
  {
    match: (m) => m.provider === "Azure" && m.name === "gpt-5-nano",
    modelType: "azure",
  },
  // Tier 5 — Llama
  {
    match: (m) => m.id?.includes("llama-3.1-405b"),
    modelType: "llama",
  },
  {
    match: (m) => m.id?.includes("llama-4-maverick"),
    modelType: "llama",
  },
  // Tier 6 — Cohere
  {
    match: (m) => m.provider === "Cohere",
    modelType: "cohere",
  },
  // Catch-all
  {
    match: (m) => m.provider === "Google Gemini",
    modelType: "gemini",
  },
  {
    match: (m) => m.provider === "Azure",
    modelType: "azure",
  },
  {
    match: (m) => m.provider === "Anthropic",
    modelType: "anthropic",
  },
  {
    match: () => true,
    modelType: "azure",
  },
];

export async function selectBestModel(): Promise<ModelSelectionResult> {
  const models = await fetchAllModels();
  if (!models.length) throw new Error("No models available");

  const result = pickBestFromList(models);
  if (result) return result;

  return modelConfigToSelection(models[0]);
}

/**
 * Pick the best vision-capable model from the available model list.
 * Falls back to any Gemini model if no model has vision_capable: true.
 */
export async function selectBestVisionModel(): Promise<ModelSelectionResult | null> {
  const models = await fetchAllModels();
  if (!models.length) return null;

  const visionModels = models.filter((m) => (m as any).vision_capable === true);
  if (visionModels.length)
    return (
      pickBestFromList(visionModels) ?? modelConfigToSelection(visionModels[0])
    );

  // Fallback: any Gemini model supports vision even if flag not set
  const geminiModels = models.filter((m) => m.provider === "Google Gemini");
  if (geminiModels.length) return modelConfigToSelection(geminiModels[0]);

  return null;
}

/**
 * Given a pre-fetched list of models, pick the best one using MODEL_PRIORITY.
 * Returns null only if the list is empty.
 */
export function pickBestFromList(
  models: ModelConfig[]
): ModelSelectionResult | null {
  if (!models.length) return null;
  for (const rule of MODEL_PRIORITY) {
    const match = models.find(rule.match);
    if (match) return modelConfigToSelection(match);
  }
  return modelConfigToSelection(models[0]);
}

export async function fetchAllModels(): Promise<ModelConfig[]> {
  await settingsManager.refreshServerConfig();
  return settingsManager.getAvailableModelsAsync();
}

export function modelConfigToSelection(
  model: ModelConfig
): ModelSelectionResult {
  const isGemini = model.provider === "Google Gemini";
  const isAnthropic = model.provider === "Anthropic";
  const isLlama =
    model.provider === "Meta Llama" ||
    (model as any).model_type === "azure-llama";
  const isCohere = model.provider === "Cohere";
  const modelType = isGemini
    ? "gemini"
    : isAnthropic
      ? "anthropic"
      : isLlama
        ? "azure-llama"
        : isCohere
          ? "cohere"
          : "azure";
  return {
    model,
    modelType,
    modelId: model.id,
    deployment: model.deployment,
    apiVersion: model.api_version,
  };
}
