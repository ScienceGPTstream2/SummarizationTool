import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { Alert, AlertDescription } from "./ui/alert";
import {
  ArrowLeft,
  Plus,
  X,
  Sparkles,
  Bot,
  Download,
  FileText,
  File,
  AlertTriangle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocumentData } from "../App";
import {
  generateWordDocument,
  generateMarkdownDocument,
  downloadFile,
} from "./ExportUtils";
import {
  loadStudyTypeTemplate,
  getAvailableStudyTypes,
} from "./TemplateLoader";
import { settingsManager } from "./SettingsManager";
import type { ModelConfig } from "./SettingsManager";

interface Entity {
  name: string;
  prompt: string;
  extracted?: string;
  duration?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface EntityExtractionPageProps {
  onBack: () => void;
  documentData: DocumentData;
  setDocumentData: (data: DocumentData) => void;
}

export function EntityExtractionPage({
  onBack,
  documentData,
  setDocumentData,
}: EntityExtractionPageProps) {
  const [selectedStudyType, setSelectedStudyType] = useState(
    documentData.studyType || ""
  );
  const [selectedModel, setSelectedModel] = useState(
    documentData.selectedModel || ""
  );
  const [entities, setEntities] = useState<Entity[]>(
    documentData.entities || []
  );
  const [summaryPrompt, setSummaryPrompt] = useState(
    documentData.summaryPrompt || ""
  );
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showResults, setShowResults] = useState(!!documentData.finalSummary);

  // Get available study types from templates
  const studyTypes = getAvailableStudyTypes();

  // Get available models from settings manager (only Azure OpenAI GPT-5 Mini)
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  useEffect(() => {
    const loadModels = async () => {
      // Refresh server config when component mounts to get latest API key availability
      await settingsManager.refreshServerConfig();
      // Get all available models from settings manager
      const models = settingsManager.getAvailableModels();
      setAvailableModels(models);
    };
    loadModels();
  }, []);

  useEffect(() => {
    if (selectedStudyType && !documentData.entities.length) {
      // Load template entities for the selected study type
      const { entities: templateEntities, summaryPrompt: templateSummaryPrompt } =
        loadStudyTypeTemplate(selectedStudyType);
      setEntities(templateEntities);
      setSummaryPrompt(templateSummaryPrompt);
    }
  }, [selectedStudyType, documentData.entities.length]);

  const handleStudyTypeChange = (value: string) => {
    setSelectedStudyType(value);
    // Load template entities for the new study type
    const { entities: templateEntities, summaryPrompt: templateSummaryPrompt } =
      loadStudyTypeTemplate(value);
    setEntities(templateEntities);
    setSummaryPrompt(templateSummaryPrompt);
    setShowResults(false);
  };

  const addEntity = () => {
    setEntities([...entities, { name: "", prompt: "" }]);
  };

  const removeEntity = (index: number) => {
    setEntities(entities.filter((_, i) => i !== index));
  };

  const updateEntity = (
    index: number,
    field: "name" | "prompt",
    value: string
  ) => {
    const updated = entities.map((entity, i) =>
      i === index ? { ...entity, [field]: value } : entity
    );
    setEntities(updated);
  };

  const handleRunSummarization = async () => {
    setIsExtracting(true);
    setShowResults(false);

    try {
      // Ensure we have a conversion id (markdown stored) or fallback to existing extractedText
      const conversionId = documentData.conversionId;
      if (!conversionId) {
        throw new Error(
          "No conversion ID available. Please run document processing first so the markdown is available."
        );
      }

      const updatedEntities = [...entities];

      const modelObj = availableModels.find((m) => m.id === selectedModel);
      const modelTypeToUse = modelObj?.category === "google" ? "gemini" : "azure"; // Determine model_type
      const modelIdToUse = modelObj?.id; // For Gemini models
      const deploymentToUse = modelObj?.deployment; // For Azure models
      const apiVersionToUse = modelObj?.api_version; // For Azure models

      // Get user-provided API keys from settings if available
      const azureApiKey = settingsManager.getApiKey("azure_openai_api_key");
      const azureEndpoint = settingsManager.getApiKey("azure_openai_endpoint");
      const geminiApiKey = settingsManager.getApiKey("gemini_api_key");
      const geminiProjectId = settingsManager.getApiKey("gemini_project_id");
      const geminiLocation = settingsManager.getApiKey("gemini_location");


      const token = localStorage.getItem("token");
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversion_id: conversionId,
          model_type: modelTypeToUse,
          model_id: modelIdToUse,
          deployment: deploymentToUse,
          api_version: apiVersionToUse,
          entities: updatedEntities,
          max_tokens: 4096,
          temperature: 0.0,
          processor_used: documentData.processorUsed, // Include processor used for efficient markdown retrieval
          // Include user-provided API keys if available
          ...(azureApiKey && azureApiKey !== "YOUR_AZURE_OPENAI_API_KEY_HERE"
            ? { azure_api_key: azureApiKey }
            : {}),
          ...(azureEndpoint &&
          azureEndpoint !== "YOUR_AZURE_OPENAI_ENDPOINT_HERE"
            ? { azure_endpoint: azureEndpoint }
            : {}),
          // Include Gemini specific keys if available and model is Gemini
          ...(modelTypeToUse === "gemini" && geminiApiKey && geminiApiKey !== "YOUR_GOOGLE_GEMINI_API_KEY_HERE"
            ? { gemini_api_key: geminiApiKey }
            : {}),
          ...(modelTypeToUse === "gemini" && geminiProjectId && geminiProjectId !== "YOUR_GOOGLE_CLOUD_PROJECT_ID_HERE"
            ? { gemini_project_id: geminiProjectId }
            : {}),
          ...(modelTypeToUse === "gemini" && geminiLocation && geminiLocation !== "YOUR_GOOGLE_CLOUD_LOCATION_HERE"
            ? { gemini_location: geminiLocation }
            : {}),
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        const detail =
          errBody.detail || errBody.error || "Extraction request failed";
        throw new Error(detail);
      }

      const data = await resp.json();
      const extractedEntities = data.extracted_entities || [];

      // Merge the extracted text back into the entities list
      const newUpdatedEntities = updatedEntities.map((entity) => {
        const extracted = extractedEntities.find(
          (e: any) => e.name === entity.name
        );
        if (extracted) {
          const meta = extracted.meta || {};
          return {
            ...entity,
            extracted: extracted.extracted,
            duration: meta.duration,
            promptTokens: meta.prompt_tokens,
            completionTokens: meta.completion_tokens,
          };
        }
        return {
          ...entity,
          extracted: entity.extracted || `Error: Not found in response`,
        };
      });

      // Generate the paragraph summary
      const summaryResp = await fetch("/api/generate_paragraph", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entities: newUpdatedEntities,
          summary_prompt: summaryPrompt,
          model_type: modelTypeToUse,
          model_id: modelIdToUse,
          deployment: deploymentToUse,
          api_version: apiVersionToUse,
          azure_endpoint: azureEndpoint,
          azure_api_key: azureApiKey,
          // Include Gemini specific keys if available and model is Gemini
          ...(modelTypeToUse === "gemini" && geminiApiKey && geminiApiKey !== "YOUR_GOOGLE_GEMINI_API_KEY_HERE"
            ? { gemini_api_key: geminiApiKey }
            : {}),
          ...(modelTypeToUse === "gemini" && geminiProjectId && geminiProjectId !== "YOUR_GOOGLE_CLOUD_PROJECT_ID_HERE"
            ? { gemini_project_id: geminiProjectId }
            : {}),
          ...(modelTypeToUse === "gemini" && geminiLocation && geminiLocation !== "YOUR_GOOGLE_CLOUD_LOCATION_HERE"
            ? { gemini_location: geminiLocation }
            : {}),
        }),
      });

      if (!summaryResp.ok) {
        const errBody = await summaryResp.json().catch(() => ({}));
        const detail =
          errBody.detail || errBody.error || "Summary generation failed";
        throw new Error(detail);
      }

      const summaryData = await summaryResp.json();
      const finalSummary = summaryData.summary;

      // Persist results to parent state
      setDocumentData({
        ...documentData,
        studyType: selectedStudyType,
        selectedModel: selectedModel,
        entities: newUpdatedEntities,
        summaryPrompt: summaryPrompt,
        finalSummary,
      });

      setEntities(newUpdatedEntities);
      setShowResults(true);
    } catch (err: any) {
      console.error("Extraction error:", err);
      setIsExtracting(false);
      setShowResults(true);
      setEntities(entities.map((e) => ({ ...e })));
      setDocumentData({
        ...documentData,
        studyType: selectedStudyType,
        selectedModel: selectedModel,
        entities,
      });
      // Error state handler not defined in this component; log and return.
      return;
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExportWord = async () => {
    setIsExporting(true);
    try {
      const wordBlob = await generateWordDocument(documentData);
      const fileName = `summary-report-${new Date().toISOString().split("T")[0]}.docx`;
      downloadFile(
        wordBlob,
        fileName,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    } catch (error) {
      console.error("Error generating Word document:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMarkdown = () => {
    setIsExporting(true);
    try {
      const markdownContent = generateMarkdownDocument(documentData);
      const fileName = `summary-report-${new Date().toISOString().split("T")[0]}.md`;
      downloadFile(markdownContent, fileName, "text/markdown");
    } catch (error) {
      console.error("Error generating Markdown document:", error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h2 className="text-xl">Entity Extraction & Prompt Catalogue</h2>
          <p className="text-muted-foreground">
            Configure entity extraction prompts and select AI model
          </p>
        </div>
      </div>

      <div className="grid gap-6">
        {availableModels.length === 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No AI models are configured. Please go to Settings to configure
              your API keys first.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle>Study Type Selection</CardTitle>
              <CardDescription>
                Choose your study type to load appropriate extraction prompts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedStudyType}
                onValueChange={handleStudyTypeChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select study type" />
                </SelectTrigger>
                <SelectContent>
                  {studyTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Model Selection
              </CardTitle>
              <CardDescription>
                Choose the AI model for entity extraction
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedModel}
                onValueChange={setSelectedModel}
                disabled={availableModels.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      availableModels.length === 0
                        ? "No models available - configure API keys"
                        : "Select AI model"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{model.name}</span>
                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {model.provider}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {model.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {availableModels.length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Configure your API keys in Settings to enable AI models.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {selectedStudyType && (
          <Card className="border-gray-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Entity Extraction Configuration</CardTitle>
                  <CardDescription>
                    Customize the entities and prompts for extraction (loaded
                    from template)
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={addEntity}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Entity
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {entities.map((entity, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Entity {index + 1}</Label>
                    {entities.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEntity(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <Label htmlFor={`entity-name-${index}`}>
                        Entity Name
                      </Label>
                      <Input
                        id={`entity-name-${index}`}
                        value={entity.name}
                        onChange={(e) =>
                          updateEntity(index, "name", e.target.value)
                        }
                        placeholder="e.g., Authors, Funding Sources, Dose Level"
                      />
                    </div>

                    <div>
                      <Label htmlFor={`entity-prompt-${index}`}>
                        Extraction Prompt
                      </Label>
                      <Textarea
                        id={`entity-prompt-${index}`}
                        value={entity.prompt}
                        onChange={(e) =>
                          updateEntity(index, "prompt", e.target.value)
                        }
                        placeholder="Describe what information to extract with few-shot examples..."
                        rows={6}
                        className="resize-y min-h-[150px]"
                      />
                    </div>

                    {entity.extracted && (
                      <div>
                        <Label>Extracted Information</Label>
                        <div className="bg-muted p-3 rounded-md">
                          <p className="text-sm">{entity.extracted}</p>
                        </div>
                        {entity.duration && (
                          <div className="grid grid-cols-2 gap-4 mt-4">
                            <div>
                              <Label>Tokens</Label>
                              <div className="bg-muted p-3 rounded-md">
                                <p className="text-sm">
                                  {entity.promptTokens} (in) /{" "}
                                  {entity.completionTokens} (out)
                                </p>
                              </div>
                            </div>
                            <div>
                              <Label>Time</Label>
                              <div className="bg-muted p-3 rounded-md">
                                <p className="text-sm">
                                  {entity.duration.toFixed(2)}s
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle>Paragraph Generator Prompt</CardTitle>
                  <CardDescription>
                    This prompt will be used to generate the final paragraph
                    from the extracted entities.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={summaryPrompt}
                    onChange={(e) => setSummaryPrompt(e.target.value)}
                    placeholder="Enter the prompt for paragraph generation..."
                    rows={8}
                    className="resize-y min-h-[150px]"
                  />
                </CardContent>
              </Card>
              <Button
                variant="outline"
                onClick={handleRunSummarization}
                disabled={
                  isExtracting ||
                  entities.length === 0 ||
                  entities.some((e) => !e.name || !e.prompt) ||
                  !selectedModel ||
                  availableModels.length === 0
                }
                className="w-full"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {isExtracting
                  ? "Running Summarization..."
                  : "Run Summarization"}
              </Button>
            </CardContent>
          </Card>
        )}

        {showResults && (
          <>
            <div className="grid lg:grid-cols-2 gap-6">
              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle>Extracted Entities</CardTitle>
                  <CardDescription>
                    Results from{" "}
                    {availableModels.find((m) => m.id === selectedModel)
                      ?.name || "Selected Model"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96">
                    <div className="space-y-4">
                      {entities
                        .filter((e) => e.extracted)
                        .map((entity, index) => (
                          <div
                            key={index}
                            className="border-b border-border pb-3 last:border-b-0"
                          >
                            <h4 className="font-medium mb-2">{entity.name}</h4>
                            <div className="prose prose-sm max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {entity.extracted}
                              </ReactMarkdown>
                            </div>
                          </div>
                        ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle>Generated Paragraph</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96">
                    <div className="prose prose-sm">
                      <p className="whitespace-pre-wrap text-sm">
                        {documentData.finalSummary}
                      </p>
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            <Card className="border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Export Summary Report
                </CardTitle>
                <CardDescription>
                  Download your complete analysis with full pipeline metadata
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4">
                  <Button
                    onClick={handleExportWord}
                    disabled={isExporting}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    <File className="h-4 w-4" />
                    {isExporting ? "Exporting..." : "Export as Word (.docx)"}
                  </Button>
                  <Button
                    onClick={handleExportMarkdown}
                    disabled={isExporting}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    <FileText className="h-4 w-4" />
                    {isExporting ? "Exporting..." : "Export as Markdown (.md)"}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  Both formats include complete pipeline configuration, entity
                  prompts, extraction results, and metadata.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
