import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Key,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Moon,
  Sun,
} from "lucide-react";
import { settingsManager, apiKeyConfigs, ModelConfig } from "./SettingsManager";
import { useTheme } from "../contexts/ThemeContext";

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack: _onBack }: SettingsPageProps) {
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [serverConfig, setServerConfig] = useState({
    is_azure_openai_configured: false,
    is_gemini_configured: false,
    is_azure_document_intelligence_configured: false,
  });
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const loadData = async () => {
      // Refresh server config to get latest status
      await settingsManager.refreshServerConfig();
      const config = settingsManager.getServerConfig();
      setServerConfig(config);

      // Load available models from backend
      const models = await settingsManager.getAvailableModelsAsync();
      setAvailableModels(models);
    };
    loadData();
  }, []);

  const getKeyStatus = (keyName: string): "configured" | "missing" => {
    // Check server config based on key name
    if (keyName.includes("azure_openai")) {
      return serverConfig.is_azure_openai_configured ? "configured" : "missing";
    }
    if (keyName.includes("azure_document_intelligence")) {
      return serverConfig.is_azure_document_intelligence_configured
        ? "configured"
        : "missing";
    }
    if (keyName.includes("gemini")) {
      return serverConfig.is_gemini_configured ? "configured" : "missing";
    }
    return "missing";
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "configured":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "missing":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const groupedKeys = Object.values(apiKeyConfigs).reduce(
    (acc, config) => {
      if (!acc[config.category]) {
        acc[config.category] = [];
      }
      acc[config.category].push(config);
      return acc;
    },
    {} as Record<string, (typeof apiKeyConfigs)[string][]>
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl">Settings</h2>
        <p className="text-muted-foreground">
          View configuration status and available models. All settings are
          configured in backend secrets.toml
        </p>
      </div>

      <Tabs defaultValue="keys" className="space-y-6">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger
              value="keys"
              className="border border-gray-300 dark:border-gray-600 bg-background text-foreground hover:bg-gray-50 hover:border-gray-400 dark:bg-input/30 dark:hover:bg-input/50 dark:hover:border-gray-500 transition-colors rounded-md"
            >
              Configuration Status
            </TabsTrigger>
            <TabsTrigger
              value="models"
              className="border border-gray-300 dark:border-gray-600 bg-background text-foreground hover:bg-gray-50 hover:border-gray-400 dark:bg-input/30 dark:hover:bg-input/50 dark:hover:border-gray-500 transition-colors rounded-md"
            >
              Available Models
            </TabsTrigger>
          </TabsList>

          <Button
            variant="outline"
            size="sm"
            onClick={toggleTheme}
            className="flex items-center gap-2"
          >
            {theme === "dark" ? (
              <>
                <Sun className="h-4 w-4" />
                Light Mode
              </>
            ) : (
              <>
                <Moon className="h-4 w-4" />
                Dark Mode
              </>
            )}
          </Button>
        </div>

        <TabsContent value="keys" className="space-y-6">
          <div className="grid gap-6">
            {Object.entries(groupedKeys).map(([category, configs]) => (
              <Card key={category} className="border-gray-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    {category}
                  </CardTitle>
                  <CardDescription>
                    Configuration status for {category} services (read from
                    backend secrets.toml)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {configs.map((config) => {
                    const status = getKeyStatus(config.key);

                    return (
                      <div key={config.key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label
                            htmlFor={config.key}
                            className="flex items-center gap-2"
                          >
                            {config.displayName}
                            {getStatusIcon(status)}
                          </Label>
                        </div>

                        <Input
                          id={config.key}
                          type="text"
                          value={config.placeholder}
                          readOnly
                          disabled
                          className={`font-mono bg-muted ${
                            status === "configured"
                              ? "border-green-300"
                              : "border-red-300"
                          }`}
                        />

                        <p className="text-sm text-muted-foreground">
                          {config.description}
                        </p>

                        {status === "missing" && (
                          <p className="text-sm text-amber-600">
                            This service is not configured in backend
                            secrets.toml
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}

            <Card className="border-gray-200">
              <CardContent className="pt-6">
                <div className="bg-muted p-4 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
                    <div className="space-y-2">
                      <p className="font-medium">Configuration Notice</p>
                      <p className="text-sm text-muted-foreground">
                        All API keys and service configurations are managed in
                        the backend secrets.toml file. This page displays the
                        current configuration status. To modify settings, update
                        the secrets.toml file on the server.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="models" className="space-y-6">
          <div className="grid gap-6">
            <Card className="border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-5 w-5" />
                  Available Models ({availableModels.length})
                </CardTitle>
                <CardDescription>
                  Models available from backend configuration (secrets.toml)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {availableModels.length > 0 ? (
                  <div className="grid gap-3">
                    {availableModels.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{model.name}</span>
                            <Badge variant="secondary">{model.provider}</Badge>
                            {model.deployment && (
                              <Badge variant="outline" className="text-xs">
                                {model.deployment}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {model.description}
                          </p>
                          {model.deployment && (
                            <p className="text-xs text-muted-foreground">
                              ID: {model.id}
                              {model.api_version &&
                                ` • API Version: ${model.api_version}`}
                            </p>
                          )}
                        </div>
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    No models available. Please configure services in backend
                    secrets.toml
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
