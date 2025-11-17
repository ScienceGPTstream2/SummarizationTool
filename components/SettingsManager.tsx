export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  description: string;
  requiredApiKey: string;
  category: "openai" | "google" | "anthropic" | "meta" | "other" | "azure";
  // Optional runtime fields for deployments (used for custom Azure models)
  deployment?: string;
  api_version?: string;
  project_id?: string; // Added for Gemini
  location?: string; // Added for Gemini
}

export interface ApiKeyConfig {
  key: string;
  displayName: string;
  description: string;
  placeholder: string;
  category: string;
}

export interface CustomModelConfig {
  id: string;
  name: string;
  provider: string;
  description?: string;
  requiredApiKey?: string;
  category?: string;
  deployment?: string;
  api_version?: string;
  project_id?: string; // Added for Gemini
  location?: string; // Added for Gemini
}

// Available models configuration (built-in)
// Only supporting Azure OpenAI GPT-5 Mini for entity extraction
export const allModels: ModelConfig[] = [
  // Azure OpenAI Models
  {
    id: "azure-gpt-5-mini",
    name: "GPT-5 Mini",
    provider: "Azure OpenAI",
    description: "Azure OpenAI GPT-5 Mini model for entity extraction",
    requiredApiKey: "azure_openai_api_key",
    category: "azure",
    deployment: "gpt-5-mini",
    api_version: "2024-12-01-preview",
  },
  // Gemini Models (using service account authentication - no user API key required)
  {
    id: "publishers/google/models/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google Gemini",
    description: "Google Gemini 2.5 Pro model for entity extraction",
    requiredApiKey: "", // No API key required - uses service account from secrets.toml
    category: "google",
    project_id: "hcsx-scigpt2-innocentrhino-acm",
    location: "us-central1",
  },
  {
    id: "publishers/google/models/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    provider: "Google Gemini",
    description: "Google Gemini 2.5 Flash Lite model for entity extraction",
    requiredApiKey: "", // No API key required - uses service account from secrets.toml
    category: "google",
    project_id: "hcsx-scigpt2-innocentrhino-acm",
    location: "us-central1",
  },
  {
    id: "publishers/google/models/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google Gemini",
    description: "Google Gemini 2.5 Flash model for entity extraction",
    requiredApiKey: "", // No API key required - uses service account from secrets.toml
    category: "google",
    project_id: "hcsx-scigpt2-innocentrhino-acm",
    location: "us-central1",
  },
  // Anthropic Models (via Vertex AI)
  {
    id: "claude-sonnet-4-5@20250929",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    description: "Anthropic Claude Sonnet 4.5 model via Vertex AI",
    requiredApiKey: "none", // Uses server-side service account
    category: "anthropic",
    project_id: "hcsx-scigpt2-innocentrhino-acm",
    location: "global",
  },
  {
    id: "claude-opus-4-1@20250805",
    name: "Claude Opus 4.1",
    provider: "Anthropic",
    description: "Anthropic Claude Opus 4.1 - Most capable model via Vertex AI",
    requiredApiKey: "none", // Uses server-side service account
    category: "anthropic",
    project_id: "hcsx-scigpt2-innocentrhino-acm",
    location: "global",
  },
  {
    id: "claude-sonnet-4@20250514",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    description: "Anthropic Claude Sonnet 4 model via Vertex AI",
    requiredApiKey: "none", // Uses server-side service account
    category: "anthropic",
    project_id: "hcsx-scigpt2-innocentrhino-acm",
    location: "global",
  },
  {
    id: "claude-haiku-4-5@20251001",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    description: "Anthropic Claude Haiku 4.5 - Fast and efficient via Vertex AI",
    requiredApiKey: "none", // Uses server-side service account
    category: "anthropic",
    project_id: "hcsx-scigpt2-innocentrhino-acm",
    location: "global",
  },
];

// API Key configurations
export const apiKeyConfigs: Record<string, ApiKeyConfig> = {
  azure_openai_api_key: {
    key: "azure_openai_api_key",
    displayName: "Azure OpenAI API Key",
    description: "API key for Azure OpenAI Service (GPT-5 Mini)",
    placeholder: "Your Azure OpenAI API key",
    category: "Azure",
  },
  azure_openai_endpoint: {
    key: "azure_openai_endpoint",
    displayName: "Azure OpenAI Endpoint",
    description: "Azure OpenAI service endpoint URL",
    placeholder: "https://your-resource.openai.azure.com/",
    category: "Azure",
  },
  azure_document_intelligence_api_key: {
    key: "azure_document_intelligence_api_key",
    displayName: "Azure Document Intelligence API Key",
    description:
      "API key for Azure Document Intelligence service (document processing). Note: Configuration is read from backend secrets.toml - this field is for reference only.",
    placeholder: "Your Azure Document Intelligence API key",
    category: "Azure",
  },
  azure_document_intelligence_endpoint: {
    key: "azure_document_intelligence_endpoint",
    displayName: "Azure Document Intelligence Endpoint",
    description:
      "Azure Document Intelligence service endpoint URL. Note: Configuration is read from backend secrets.toml - this field is for reference only.",
    placeholder: "https://your-resource.cognitiveservices.azure.com/",
    category: "Azure",
  },
  gemini_api_key: {
    key: "gemini_api_key",
    displayName: "Gemini API Key",
    description: "API key for Google Gemini models",
    placeholder: "Your Google Gemini API key",
    category: "Google",
  },
  gemini_project_id: {
    key: "gemini_project_id",
    displayName: "Gemini Project ID",
    description: "Google Cloud Project ID for Gemini models",
    placeholder: "Your Google Cloud Project ID",
    category: "Google",
  },
  gemini_location: {
    key: "gemini_location",
    displayName: "Gemini Location",
    description: "Google Cloud Location for Gemini models (e.g., us-central1)",
    placeholder: "Your Google Cloud Location",
    category: "Google",
  },
};

// Settings management class
export class SettingsManager {
  private apiKeys: Record<string, string> = {};
  private customModels: CustomModelConfig[] = [];
  private serverConfig: {
    is_azure_openai_configured: boolean;
    is_gemini_configured: boolean;
    is_azure_document_intelligence_configured: boolean;
  } = {
    is_azure_openai_configured: false,
    is_gemini_configured: false,
    is_azure_document_intelligence_configured: false,
  };

  private storageKey = "ai-summarizer-settings";

  constructor() {
    this.loadSettings();
    // Don't load server config in constructor - will be called after login
  }

  // Public method to load server config after login
  async refreshServerConfig() {
    await this.loadServerConfig();
  }

  // Fetch models from backend API
  async fetchBackendModels(): Promise<ModelConfig[]> {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        return [];
      }

      const response = await fetch("/api/models", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const backendModels = await response.json();
        // Convert backend model format to ModelConfig format
        return backendModels.map((m: any) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          description: m.description || "",
          requiredApiKey: "", // No API key required - uses backend secrets
          category: m.provider?.toLowerCase().includes("azure")
            ? "azure"
            : m.provider?.toLowerCase().includes("google")
              ? "google"
              : "other",
          deployment: m.deployment,
          api_version: m.api_version,
          project_id: m.project_id,
          location: m.location,
        }));
      }
    } catch (error) {
      console.error("Failed to fetch backend models:", error);
    }
    return [];
  }

  private async loadServerConfig() {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        // No token available, skip loading server config
        return;
      }

      const response = await fetch("/api/server-config", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        this.serverConfig = await response.json();
      }
    } catch (error) {
      console.error("Failed to load server config:", error);
    }
  }

  private loadSettings() {
    // Backwards compatible loader:
    // - If localStorage contains a flat map (legacy), treat it as apiKeys.
    // - If it contains { apiKeys, customModels } structure, load both.
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (
          parsed &&
          typeof parsed === "object" &&
          (parsed.apiKeys || parsed.customModels)
        ) {
          this.apiKeys = parsed.apiKeys || {};
          this.customModels = parsed.customModels || [];
        } else if (parsed && typeof parsed === "object") {
          // Legacy: flat map of api keys
          this.apiKeys = parsed;
          this.customModels = [];
        } else {
          this.apiKeys = {};
          this.customModels = [];
        }
      } catch (error) {
        console.error("Failed to parse stored settings:", error);
        this.apiKeys = {};
        this.customModels = [];
      }
    }
  }

  saveSettings() {
    const payload = {
      apiKeys: this.apiKeys,
      customModels: this.customModels,
    };
    localStorage.setItem(this.storageKey, JSON.stringify(payload));
  }

  getApiKey(keyName: string): string {
    return this.apiKeys[keyName] || "";
  }

  setApiKey(keyName: string, value: string) {
    if (value.trim()) {
      this.apiKeys[keyName] = value.trim();
    } else {
      delete this.apiKeys[keyName];
    }
    this.saveSettings();
  }

  getAllApiKeys(): Record<string, string> {
    return { ...this.apiKeys };
  }

  // Custom models management
  addCustomModel(model: CustomModelConfig) {
    // Overwrite if same id exists
    this.customModels = this.customModels.filter((m) => m.id !== model.id);
    this.customModels.push(model);
    this.saveSettings();
  }

  removeCustomModel(modelId: string) {
    this.customModels = this.customModels.filter((m) => m.id !== modelId);
    this.saveSettings();
  }

  getCustomModels(): CustomModelConfig[] {
    return [...this.customModels];
  }

  // Combine built-in + custom models and filter by availability of required keys
  // Note: This method is synchronous, but backend models should be fetched separately
  // Use getAvailableModelsAsync() for the full list including backend models
  getAvailableModels(): ModelConfig[] {
    const combined: ModelConfig[] = [
      ...allModels,
      ...this.customModels.map(
        (m): ModelConfig => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          description: m.description || "",
          requiredApiKey: m.requiredApiKey || "azure_openai_api_key",
          category: (m.category as any) || "azure",
          deployment: m.deployment,
          api_version: m.api_version,
          project_id: m.project_id,
          location: m.location,
        })
      ),
    ];

    // All models now rely solely on server configuration (secrets.toml)
    // No user-entered API keys required
    return combined.filter((model) => {
      // For Azure provider, only check server config
      if (model.provider && model.provider.toLowerCase().includes("azure")) {
        return this.serverConfig.is_azure_openai_configured;
      }

      // For Gemini provider, only check server config (uses service account from secrets.toml)
      if (model.provider && model.provider.toLowerCase().includes("gemini")) {
        return this.serverConfig.is_gemini_configured;
      }

      // For Anthropic provider, always available (uses server-side service account)
      if (model.provider && model.provider.toLowerCase().includes("anthropic")) {
        return true;
      }

      // For other providers, just check the required API key
      const hasApiKey = this.getApiKey(model.requiredApiKey);
      return (
        !!hasApiKey &&
        hasApiKey !== "YOUR_" + model.requiredApiKey.toUpperCase() + "_HERE"
      );
    });
  }

  isModelAvailable(modelId: string): boolean {
    const model = [...allModels, ...this.customModels].find(
      (m) => m.id === modelId
    );
    if (!model) return false;

    // All models now rely solely on server configuration (secrets.toml)
    if (
      (model as any).provider &&
      (model as any).provider.toLowerCase().includes("azure")
    ) {
      return this.serverConfig.is_azure_openai_configured;
    }

    if (
      (model as any).provider &&
      (model as any).provider.toLowerCase().includes("gemini")
    ) {
      // Gemini models use service account authentication, so only check server config
      return this.serverConfig.is_gemini_configured;
    }

    // For Anthropic provider, always available (uses server-side service account)
    if (
      (model as any).provider &&
      (model as any).provider.toLowerCase().includes("anthropic")
    ) {
      return true;
    }

    const apiKey = this.getApiKey((model as any).requiredApiKey);
    return (
      !!apiKey &&
      apiKey !==
        "YOUR_" + ((model as any).requiredApiKey || "").toUpperCase() + "_HERE"
    );
  }

  isAzureDocumentIntelligenceAvailable(): boolean {
    // Only check server configuration (secrets.toml)
    return this.serverConfig.is_azure_document_intelligence_configured;
  }

  // Get available models including backend models (async)
  async getAvailableModelsAsync(): Promise<ModelConfig[]> {
    // Fetch models from backend (these are the source of truth)
    const backendModels = await this.fetchBackendModels();

    // Merge with custom models (user-added custom models take precedence)
    const customModelIds = new Set(this.customModels.map((m) => m.id));
    const backendModelsFiltered = backendModels.filter(
      (m) => !customModelIds.has(m.id)
    );

    // Combine: backend models + custom models
    const combined: ModelConfig[] = [
      ...backendModelsFiltered,
      ...this.customModels.map(
        (m): ModelConfig => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          description: m.description || "",
          requiredApiKey: m.requiredApiKey || "",
          category: (m.category as any) || "azure",
          deployment: m.deployment,
          api_version: m.api_version,
          project_id: m.project_id,
          location: m.location,
        })
      ),
    ];

    // Filter by server configuration availability
    return combined.filter((model) => {
      // For Azure provider, only check server config
      if (model.provider && model.provider.toLowerCase().includes("azure")) {
        return this.serverConfig.is_azure_openai_configured;
      }

      // For Gemini provider, only check server config (uses service account from secrets.toml)
      if (model.provider && model.provider.toLowerCase().includes("gemini")) {
        return this.serverConfig.is_gemini_configured;
      }

      // For other providers, default to true (backend will handle validation)
      return true;
    });
  }
}

// Global settings manager instance
export const settingsManager = new SettingsManager();
