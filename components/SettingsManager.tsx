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
}

// Available models configuration (built-in)
export const allModels: ModelConfig[] = [
  // OpenAI Models
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    description: "Latest multimodal model with enhanced capabilities",
    requiredApiKey: "openai_api_key",
    category: "openai",
  },
  {
    id: "gpt-4-turbo",
    name: "GPT-4 Turbo",
    provider: "OpenAI",
    description: "High-performance text model with large context",
    requiredApiKey: "openai_api_key",
    category: "openai",
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "OpenAI",
    description: "Enhanced version with improved reasoning",
    requiredApiKey: "openai_api_key",
    category: "openai",
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    provider: "OpenAI",
    description: "Next-generation language model (preview)",
    requiredApiKey: "openai_api_key",
    category: "openai",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    description: "Lightweight version for faster processing",
    requiredApiKey: "openai_api_key",
    category: "openai",
  },

  // Google Models
  {
    id: "gemini-pro",
    name: "Gemini Pro",
    provider: "Google",
    description: "Advanced multimodal AI model",
    requiredApiKey: "google_api_key",
    category: "google",
  },
  {
    id: "gemini-ultra",
    name: "Gemini Ultra",
    provider: "Google",
    description: "Most capable Gemini model",
    requiredApiKey: "google_api_key",
    category: "google",
  },
  {
    id: "gemini-flash",
    name: "Gemini Flash",
    provider: "Google",
    description: "Fast and efficient processing",
    requiredApiKey: "google_api_key",
    category: "google",
  },

  // Anthropic Models
  {
    id: "claude-3-opus",
    name: "Claude 3 Opus",
    provider: "Anthropic",
    description: "Most powerful Claude model for complex tasks",
    requiredApiKey: "anthropic_api_key",
    category: "anthropic",
  },
  {
    id: "claude-3-sonnet",
    name: "Claude 3 Sonnet",
    provider: "Anthropic",
    description: "Balanced performance and speed",
    requiredApiKey: "anthropic_api_key",
    category: "anthropic",
  },
  {
    id: "claude-3-haiku",
    name: "Claude 3 Haiku",
    provider: "Anthropic",
    description: "Fastest Claude model",
    requiredApiKey: "anthropic_api_key",
    category: "anthropic",
  },

  // Meta/Llama Models (via Together AI)
  {
    id: "llama-3.1-405b",
    name: "Llama 3.1 405B",
    provider: "Meta (Together AI)",
    description: "Largest open-source language model",
    requiredApiKey: "together_api_key",
    category: "meta",
  },
  {
    id: "llama-3.1-70b",
    name: "Llama 3.1 70B",
    provider: "Meta (Together AI)",
    description: "High-performance open model",
    requiredApiKey: "together_api_key",
    category: "meta",
  },
  {
    id: "llama-3.1-8b",
    name: "Llama 3.1 8B",
    provider: "Meta (Together AI)",
    description: "Efficient open-source model",
    requiredApiKey: "together_api_key",
    category: "meta",
  },

  // Azure Models
  {
    id: "azure-gpt-5-mini",
    name: "GPT-5 Mini (Azure)",
    provider: "Azure",
    description: "Azure deployment of gpt-5-mini",
    requiredApiKey: "azure_openai_api_key",
    category: "azure",
    deployment: "gpt-5-mini",
    api_version: "2024-12-01-preview",
  },
];

// API Key configurations
export const apiKeyConfigs: Record<string, ApiKeyConfig> = {
  openai_api_key: {
    key: "openai_api_key",
    displayName: "OpenAI API Key",
    description: "API key for OpenAI GPT models",
    placeholder: "sk-...",
    category: "OpenAI",
  },
  google_api_key: {
    key: "google_api_key",
    displayName: "Google AI API Key",
    description: "API key for Google Gemini models",
    placeholder: "AI...",
    category: "Google",
  },
  anthropic_api_key: {
    key: "anthropic_api_key",
    displayName: "Anthropic API Key",
    description: "API key for Claude models",
    placeholder: "sk-ant-...",
    category: "Anthropic",
  },
  together_api_key: {
    key: "together_api_key",
    displayName: "Together AI API Key",
    description:
      "API key for Llama and other open-source models via Together AI",
    placeholder: "",
    category: "Together AI",
  },
  replicate_api_key: {
    key: "replicate_api_key",
    displayName: "Replicate API Key",
    description: "API key for models via Replicate",
    placeholder: "r8_...",
    category: "Replicate",
  },
  azure_openai_api_key: {
    key: "azure_openai_api_key",
    displayName: "Azure OpenAI API Key",
    description: "API key for Azure OpenAI Service",
    placeholder: "",
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
    description: "API key for Azure Document Intelligence service",
    placeholder: "",
    category: "Azure",
  },
  azure_document_intelligence_endpoint: {
    key: "azure_document_intelligence_endpoint",
    displayName: "Azure Document Intelligence Endpoint",
    description: "Azure Document Intelligence service endpoint URL",
    placeholder: "https://your-resource.cognitiveservices.azure.com/",
    category: "Azure",
  },
  openrouter_api_key: {
    key: "openrouter_api_key",
    displayName: "OpenRouter API Key",
    description: "API key for OpenRouter (unified API for multiple models)",
    placeholder: "sk-or-...",
    category: "OpenRouter",
  },
  groq_api_key: {
    key: "groq_api_key",
    displayName: "Groq API Key",
    description: "API key for Groq (fast inference)",
    placeholder: "gsk_...",
    category: "Groq",
  },
};

// Settings management class
export class SettingsManager {
  private apiKeys: Record<string, string> = {};
  private customModels: CustomModelConfig[] = [];
  private serverConfig: { is_azure_openai_configured: boolean } = {
    is_azure_openai_configured: false,
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
        })
      ),
    ];

    return combined.filter((model) => {
      // For Azure provider require both api key and endpoint
      if (model.provider && model.provider.toLowerCase().includes("azure")) {
        if (this.serverConfig.is_azure_openai_configured) {
          return true;
        }
        const apiKey = this.getApiKey("azure_openai_api_key");
        const endpoint = this.getApiKey("azure_openai_endpoint");
        return (
          !!apiKey &&
          !!endpoint &&
          apiKey !== "YOUR_AZURE_OPENAI_API_KEY_HERE" &&
          endpoint !== "YOUR_AZURE_OPENAI_ENDPOINT_HERE"
        );
      }

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

    if (
      (model as any).provider &&
      (model as any).provider.toLowerCase().includes("azure")
    ) {
      if (this.serverConfig.is_azure_openai_configured) {
        return true;
      }
      const apiKey = this.getApiKey("azure_openai_api_key");
      const endpoint = this.getApiKey("azure_openai_endpoint");
      return (
        !!apiKey &&
        !!endpoint &&
        apiKey !== "YOUR_AZURE_OPENAI_API_KEY_HERE" &&
        endpoint !== "YOUR_AZURE_OPENAI_ENDPOINT_HERE"
      );
    }

    const apiKey = this.getApiKey((model as any).requiredApiKey);
    return (
      !!apiKey &&
      apiKey !==
        "YOUR_" + ((model as any).requiredApiKey || "").toUpperCase() + "_HERE"
    );
  }

  isAzureDocumentIntelligenceAvailable(): boolean {
    const apiKey = this.getApiKey("azure_document_intelligence_api_key");
    const endpoint = this.getApiKey("azure_document_intelligence_endpoint");
    return (
      !!apiKey &&
      !!endpoint &&
      apiKey !== "YOUR_AZURE_DOCUMENT_INTELLIGENCE_API_KEY_HERE" &&
      endpoint !== "YOUR_AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT_HERE"
    );
  }
}

// Global settings manager instance
export const settingsManager = new SettingsManager();
