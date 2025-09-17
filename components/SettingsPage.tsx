import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { 
  Settings,
  Key, 
  Eye, 
  EyeOff, 
  CheckCircle, 
  XCircle,
  X,
  AlertTriangle,
  Moon,
  Sun
} from 'lucide-react';
import { settingsManager, apiKeyConfigs, allModels, CustomModelConfig } from './SettingsManager';
import { useTheme } from '../contexts/ThemeContext';

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [customModels, setCustomModels] = useState<CustomModelConfig[]>([]);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelDeployment, setNewModelDeployment] = useState('');
  const [newModelApiVersion, setNewModelApiVersion] = useState('');
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    // Load current API keys and custom models
    setApiKeys(settingsManager.getAllApiKeys());
    setCustomModels(settingsManager.getCustomModels());
  }, []);

  const handleApiKeyChange = (keyName: string, value: string) => {
    const newApiKeys = { ...apiKeys, [keyName]: value };
    setApiKeys(newApiKeys);
    settingsManager.setApiKey(keyName, value);
  };

  const toggleShowKey = (keyName: string) => {
    setShowKeys(prev => ({ ...prev, [keyName]: !prev[keyName] }));
  };

  const getKeyStatus = (keyName: string): 'configured' | 'placeholder' | 'missing' => {
    const value = apiKeys[keyName] || '';
    if (!value) return 'missing';
    if (value.startsWith('YOUR_') && value.endsWith('_HERE')) return 'placeholder';
    return 'configured';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'configured':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'placeholder':
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'missing':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const handleAddCustomModel = () => {
    if (!newModelId.trim() || !newModelName.trim() || !newModelDeployment.trim()) return;
    const model: CustomModelConfig = {
      id: newModelId.trim(),
      name: newModelName.trim(),
      provider: 'Azure',
      description: `Custom Azure deployment ${newModelDeployment}`,
      requiredApiKey: 'azure_openai_api_key',
      category: 'azure',
      deployment: newModelDeployment.trim(),
      api_version: newModelApiVersion.trim() || undefined
    };
    settingsManager.addCustomModel(model);
    setCustomModels(settingsManager.getCustomModels());
    setNewModelId('');
    setNewModelName('');
    setNewModelDeployment('');
    setNewModelApiVersion('');
  };

  const handleRemoveCustomModel = (id: string) => {
    settingsManager.removeCustomModel(id);
    setCustomModels(settingsManager.getCustomModels());
  };

  const groupedKeys = Object.values(apiKeyConfigs).reduce((acc, config) => {
    if (!acc[config.category]) {
      acc[config.category] = [];
    }
    acc[config.category].push(config);
    return acc;
  }, {} as Record<string, typeof apiKeyConfigs[string][]>);

  const availableModels = settingsManager.getAvailableModels();
  const unavailableModels = allModels.filter(model => !settingsManager.isModelAvailable(model.id));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl">Settings</h2>
        <p className="text-muted-foreground">
          Configure API keys, models, and application preferences
        </p>
      </div>

      <Tabs defaultValue="keys" className="space-y-6">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger 
              value="keys" 
              className="border border-gray-300 dark:border-gray-600 bg-background text-foreground hover:bg-gray-50 hover:border-gray-400 dark:bg-input/30 dark:hover:bg-input/50 dark:hover:border-gray-500 transition-colors rounded-md"
            >
              API Keys
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
            {theme === 'dark' ? (
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
                    Configure API keys for {category} services
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {configs.map((config) => {
                    const status = getKeyStatus(config.key);
                    const isVisible = showKeys[config.key];
                    const value = apiKeys[config.key] || '';
                    
                    return (
                      <div key={config.key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor={config.key} className="flex items-center gap-2">
                            {config.displayName}
                            {getStatusIcon(status)}
                          </Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleShowKey(config.key)}
                            className="h-8 w-8 p-0"
                          >
                            {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                        
                        <Input
                          id={config.key}
                          type={isVisible ? 'text' : 'password'}
                          value={value}
                          onChange={(e) => handleApiKeyChange(config.key, e.target.value)}
                          placeholder={config.placeholder}
                          className={`font-mono ${
                            status === 'configured' ? 'border-green-300' : 
                            status === 'placeholder' ? 'border-amber-300' : 
                            'border-red-300'
                          }`}
                        />
                        
                        <p className="text-sm text-muted-foreground">
                          {config.description}
                        </p>
                        
                        {status === 'placeholder' && (
                          <p className="text-sm text-amber-600">
                            Please replace the placeholder with your actual API key
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
                      <p className="font-medium">Security Notice</p>
                      <p className="text-sm text-muted-foreground">
                        Your API keys are stored locally in your browser and are never transmitted to external servers. 
                        Keep your API keys secure and never share them with others.
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
                  These models are ready to use with your configured API keys
                </CardDescription>
              </CardHeader>
              <CardContent>
                {availableModels.length > 0 ? (
                  <div className="grid gap-3">
                    {availableModels.map((model) => (
                      <div key={model.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{model.name}</span>
                            <Badge variant="secondary">{model.provider}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{model.description}</p>
                        </div>
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    No models available. Please configure your API keys first.
                  </p>
                )}
              </CardContent>
            </Card>

              <Card className="border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-muted-foreground">
                  <XCircle className="h-5 w-5" />
                  Unavailable Models ({unavailableModels.length})
                </CardTitle>
                <CardDescription>
                  These models require API key configuration
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {unavailableModels.map((model) => (
                    <div key={model.id} className="flex items-center justify-between p-3 border rounded-lg opacity-60">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{model.name}</span>
                          <Badge variant="outline">{model.provider}</Badge>
                          <Badge variant="destructive" className="text-xs">
                            Requires {apiKeyConfigs[model.requiredApiKey]?.displayName}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{model.description}</p>
                      </div>
                      <XCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-muted-foreground">
                  <Settings className="h-5 w-5" />
                  Custom Models ({customModels.length})
                </CardTitle>
                <CardDescription>
                  Add custom Azure model deployments (model id, deployment name, api version)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <Label>Model ID</Label>
                      <Input
                        value={newModelId}
                        onChange={(e) => setNewModelId(e.target.value)}
                        placeholder="e.g., gpt-4.1-mini"
                      />
                    </div>
                    <div>
                      <Label>Display Name</Label>
                      <Input
                        value={newModelName}
                        onChange={(e) => setNewModelName(e.target.value)}
                        placeholder="Friendly name (e.g., GPT-4.1 Mini)"
                      />
                    </div>
                    <div>
                      <Label>Deployment Name</Label>
                      <Input
                        value={newModelDeployment}
                        onChange={(e) => setNewModelDeployment(e.target.value)}
                        placeholder="Azure deployment name"
                      />
                    </div>
                    <div>
                      <Label>API Version</Label>
                      <Input
                        value={newModelApiVersion}
                        onChange={(e) => setNewModelApiVersion(e.target.value)}
                        placeholder="e.g., 2024-12-01-preview"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleAddCustomModel}
                      disabled={!newModelId || !newModelName || !newModelDeployment}
                    >
                      Add Model
                    </Button>
                  </div>

                  {customModels.length > 0 && (
                    <div className="space-y-2">
                      {customModels.map((cm) => (
                        <div key={cm.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{cm.name}</span>
                              <Badge variant="secondary">Azure</Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              id: {cm.id} • deployment: {cm.deployment} • api_version: {cm.api_version}
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => handleRemoveCustomModel(cm.id)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
