import { getValidToken } from "./authUtils";

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  model_type?: string;
  description?: string;
  deployment?: string;
  api_version?: string;
  supports_temperature?: boolean;
  default_temperature?: number;
}

export interface ModelSelectionResult {
  model: ModelConfig;
  modelType: string;
  modelId: string;
  deployment?: string;
  apiVersion?: string;
}

const MODEL_PRIORITY: Array<{
  match: (m: ModelConfig) => boolean;
  modelType: string;
}> = [
  {
    match: (m) =>
      m.provider === "Google Gemini" &&
      (m.name?.includes("flash") || m.id?.includes("flash")),
    modelType: "gemini",
  },
  {
    match: (m) =>
      m.provider === "Google Gemini" &&
      (m.name?.includes("pro") || m.id?.includes("pro")),
    modelType: "gemini",
  },
  {
    match: (m) => m.provider === "Google Gemini",
    modelType: "gemini",
  },
  {
    match: (m) =>
      m.provider === "Azure" &&
      (m.name === "gpt-4o" || m.id?.includes("gpt-4o")),
    modelType: "azure",
  },
  {
    match: (m) =>
      m.provider === "Azure" &&
      (m.name?.includes("gpt-5") || m.id?.includes("gpt-5")),
    modelType: "azure",
  },
  {
    match: (m) =>
      m.provider === "Azure" &&
      (m.name?.includes("gpt-4") || m.id?.includes("gpt-4")),
    modelType: "azure",
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
  const token = await getValidToken();
  if (!token) throw new Error("Not authenticated");

  const response = await fetch("/api/models", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Failed to fetch available models");

  const models: ModelConfig[] = await response.json();
  if (!models.length) throw new Error("No models available");

  for (const rule of MODEL_PRIORITY) {
    const match = models.find(rule.match);
    if (match) {
      const isGemini =
        match.provider === "Google Gemini" || rule.modelType === "gemini";
      return {
        model: match,
        modelType: isGemini ? "gemini" : rule.modelType,
        modelId: match.id,
        deployment: match.deployment,
        apiVersion: match.api_version,
      };
    }
  }

  const fallback = models[0];
  return {
    model: fallback,
    modelType: "azure",
    modelId: fallback.id,
    deployment: fallback.deployment,
    apiVersion: fallback.api_version,
  };
}

export async function fetchAllModels(): Promise<ModelConfig[]> {
  const token = await getValidToken();
  if (!token) throw new Error("Not authenticated");

  const response = await fetch("/api/models", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Failed to fetch available models");

  return response.json();
}

export function modelConfigToSelection(
  model: ModelConfig
): ModelSelectionResult {
  const isGemini = model.provider === "Google Gemini";
  const isAnthropic = model.provider === "Anthropic";
  const isLlama =
    model.provider === "Meta Llama" ||
    (model as any).model_type === "azure-llama";
  const modelType = isGemini
    ? "gemini"
    : isAnthropic
      ? "anthropic"
      : isLlama
        ? "azure-llama"
        : "azure";
  return {
    model,
    modelType,
    modelId: model.id,
    deployment: model.deployment,
    apiVersion: model.api_version,
  };
}
