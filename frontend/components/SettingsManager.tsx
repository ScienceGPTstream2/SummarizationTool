export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  description: string;
  requiredApiKey: string;
  category:
    | "openai"
    | "google"
    | "anthropic"
    | "meta"
    | "other"
    | "azure"
    | "macbook";
  // Optional runtime fields for deployments (used for custom Azure models)
  deployment?: string;
  api_version?: string;
  project_id?: string; // Added for Gemini
  location?: string; // Added for Gemini
  // Temperature capability metadata
  supports_temperature?: boolean;
  default_temperature?: number;
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

// All models come from the backend /api/models endpoint (secrets.toml).
// This array is intentionally empty — no hardcoded models in the frontend.
export const allModels: ModelConfig[] = [];

// API Key configurations - Informational template only
// All actual configuration is read from backend secrets.toml
export const apiKeyConfigs: Record<string, ApiKeyConfig> = {
  azure_openai_api_key: {
    key: "azure_openai_api_key",
    displayName: "Azure OpenAI API Key",
    description:
      "API key for Azure OpenAI Service. Note: Configuration is read from backend secrets.toml - this field is for reference only.",
    placeholder: "Configured in backend secrets.toml",
    category: "Azure",
  },
  azure_openai_endpoint: {
    key: "azure_openai_endpoint",
    displayName: "Azure OpenAI Endpoint",
    description:
      "Azure OpenAI service endpoint URL. Note: Configuration is read from backend secrets.toml - this field is for reference only.",
    placeholder: "Configured in backend secrets.toml",
    category: "Azure",
  },
  azure_document_intelligence_api_key: {
    key: "azure_document_intelligence_api_key",
    displayName: "Azure Document Intelligence API Key",
    description:
      "API key for Azure Document Intelligence service (document processing). Note: Configuration is read from backend secrets.toml - this field is for reference only.",
    placeholder: "Configured in backend secrets.toml",
    category: "Azure",
  },
  azure_document_intelligence_endpoint: {
    key: "azure_document_intelligence_endpoint",
    displayName: "Azure Document Intelligence Endpoint",
    description:
      "Azure Document Intelligence service endpoint URL. Note: Configuration is read from backend secrets.toml - this field is for reference only.",
    placeholder: "Configured in backend secrets.toml",
    category: "Azure",
  },
  gemini_api_key: {
    key: "gemini_api_key",
    displayName: "Gemini Service Account",
    description:
      "Google Cloud service account for Gemini models. Note: Configuration is read from backend secrets.toml (GOOGLE_APPLICATION_CREDENTIALS) - this field is for reference only.",
    placeholder: "Configured in backend secrets.toml",
    category: "Google",
  },
  gemini_project_id: {
    key: "gemini_project_id",
    displayName: "Gemini Project ID",
    description:
      "Google Cloud Project ID for Gemini models. Note: Configuration is read from backend secrets.toml - this field is for reference only.",
    placeholder: "Configured in backend secrets.toml",
    category: "Google",
  },
  gemini_location: {
    key: "gemini_location",
    displayName: "Gemini Location",
    description:
      "Google Cloud Location for Gemini models (e.g., us-central1). Note: Configuration is read from backend secrets.toml - this field is for reference only.",
    placeholder: "Configured in backend secrets.toml",
    category: "Google",
  },
};

// Settings management class - UI template only
// All actual configuration is read from backend secrets.toml
export class SettingsManager {
  private serverConfig: {
    is_azure_openai_configured: boolean;
    is_gemini_configured: boolean;
    is_azure_document_intelligence_configured: boolean;
    is_macbook_configured?: boolean;
  } = {
    is_azure_openai_configured: false,
    is_gemini_configured: false,
    is_azure_document_intelligence_configured: false,
    is_macbook_configured: false,
  };

  constructor() {
    // Don't load server config in constructor - will be called after login
  }

  // Public method to load server config after login
  async refreshServerConfig() {
    await this.loadServerConfig();
  }

  // Fetch models from backend API
  async fetchBackendModels(): Promise<ModelConfig[]> {
    try {
      // Import getValidToken to get the proper Supabase access token
      const { getValidToken } = await import("../utils/authUtils");
      const token = await getValidToken();
      if (!token) {
        return [];
      }

      const response = await fetch("/api/models", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const backendModels: Array<{
          id: string;
          name: string;
          provider: string;
          description?: string;
          deployment?: string;
          api_version?: string;
          project_id?: string;
          location?: string;
          supports_temperature?: boolean;
          default_temperature?: number;
          vision_capable?: boolean;
        }> = await response.json();
        // Convert backend model format to ModelConfig format
        return backendModels.map((model) => ({
          id: model.id,
          name: model.name,
          provider: model.provider,
          description: model.description || "",
          requiredApiKey: "", // No API key required - uses backend secrets
          category: model.provider?.toLowerCase().includes("azure")
            ? "azure"
            : model.provider?.toLowerCase().includes("google")
              ? "google"
              : model.provider?.toLowerCase().includes("anthropic")
                ? "anthropic"
                : model.provider?.toLowerCase().includes("meta") ||
                    model.provider?.toLowerCase().includes("llama")
                  ? "meta"
                  : model.provider?.toLowerCase().includes("macbook")
                    ? "macbook"
                    : "other",
          deployment: model.deployment,
          api_version: model.api_version,
          project_id: model.project_id,
          location: model.location,
          supports_temperature: model.supports_temperature ?? true,
          default_temperature: model.default_temperature ?? 0.5,
          ...(model.vision_capable !== undefined
            ? { vision_capable: model.vision_capable }
            : {}),
        }));
      }
    } catch (error) {
      console.error("Failed to fetch backend models:", error);
    }
    return [];
  }

  private async loadServerConfig() {
    try {
      // Import getValidToken to get the proper Supabase access token
      const { getValidToken } = await import("../utils/authUtils");
      const token = await getValidToken();
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

  // Get server configuration status
  getServerConfig() {
    return { ...this.serverConfig };
  }

  // Check if a model is available based on server configuration
  // Note: This is a synchronous helper, but actual model list should come from getAvailableModelsAsync()
  isModelAvailable(modelId: string, models: ModelConfig[]): boolean {
    const model = models.find((m) => m.id === modelId);
    if (!model) return false;

    // All models rely solely on server configuration (secrets.toml)
    if (model.provider && model.provider.toLowerCase().includes("azure")) {
      return this.serverConfig.is_azure_openai_configured;
    }

    if (model.provider && model.provider.toLowerCase().includes("gemini")) {
      return this.serverConfig.is_gemini_configured;
    }

    // For Anthropic provider, always available (uses server-side service account)
    if (model.provider && model.provider.toLowerCase().includes("anthropic")) {
      return true;
    }

    // For other providers, default to true (backend will handle validation)
    return true;
  }

  isAzureDocumentIntelligenceAvailable(): boolean {
    // Only check server configuration (secrets.toml)
    return this.serverConfig.is_azure_document_intelligence_configured;
  }

  // Get available models from backend (async)
  // This is the source of truth - all models come from backend secrets.toml
  async getAvailableModelsAsync(): Promise<ModelConfig[]> {
    // Fetch models from backend (these are the source of truth)
    // The /api/models endpoint already only returns models that are configured,
    // so no additional filtering by serverConfig is needed here.
    const backendModels = await this.fetchBackendModels();

    // Fallback to local models if backend returns empty (e.g. dev mode or auth error)
    if (backendModels.length === 0) {
      console.warn("Backend models empty, falling back to local defaults");
      return allModels;
    }

    return backendModels;
  }
}

// Global settings manager instance
export const settingsManager = new SettingsManager();
