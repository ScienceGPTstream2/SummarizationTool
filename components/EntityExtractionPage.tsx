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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
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
  ArrowRight,
  CheckCircle,
  PlayCircle,
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
  onComplete?: (data: Partial<DocumentData>) => void;
  documentData: DocumentData;
  setDocumentData: (data: DocumentData) => void;
}

export function EntityExtractionPage({
  onBack,
  onComplete,
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
  const [extractingEntities, setExtractingEntities] = useState<Set<string>>(
    new Set()
  );
  const [completedEntities, setCompletedEntities] = useState<Set<string>>(
    new Set()
  );
  const [showRerunDialog, setShowRerunDialog] = useState(false);
  const [currentEntityIndex, setCurrentEntityIndex] = useState(0);
  const [isGeneratingParagraph, setIsGeneratingParagraph] = useState(false);

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
      const {
        entities: templateEntities,
        summaryPrompt: templateSummaryPrompt,
      } = loadStudyTypeTemplate(selectedStudyType);
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
    // Reset extraction progress state for new study type
    setExtractingEntities(new Set());
    setCompletedEntities(new Set());
    setCurrentEntityIndex(0);
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

  const handleRunSummarizationClick = () => {
    // Check if results already exist
    if (showResults && entities.some((e) => e.extracted)) {
      setShowRerunDialog(true);
    } else {
      handleRunSummarization();
    }
  };

  const handleRunSummarization = async () => {
    setShowRerunDialog(false); // Close dialog if it was open
    setIsExtracting(true);
    setShowResults(true); // Show results section immediately
    setExtractingEntities(new Set());
    setCompletedEntities(new Set());
    setCurrentEntityIndex(0);

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
      const modelTypeToUse =
        modelObj?.category === "google" ? "gemini" : "azure"; // Determine model_type
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

      // Process entities one by one (sequentially) for real-time feedback
      for (let i = 0; i < updatedEntities.length; i++) {
        const entity = updatedEntities[i];

        // Update progress
        setCurrentEntityIndex(i + 1);

        // Mark entity as extracting
        setExtractingEntities((prev) => new Set(prev).add(entity.name));

        console.log(`\n🔄 Extracting: ${entity.name}...`);

        try {
          // Extract single entity
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
              entities: [entity], // Extract only this entity
              max_tokens: 4096,
              temperature: 0.0,
              processor_used: documentData.processorUsed,
              // Include user-provided API keys if available
              ...(azureApiKey &&
              azureApiKey !== "YOUR_AZURE_OPENAI_API_KEY_HERE"
                ? { azure_api_key: azureApiKey }
                : {}),
              ...(azureEndpoint &&
              azureEndpoint !== "YOUR_AZURE_OPENAI_ENDPOINT_HERE"
                ? { azure_endpoint: azureEndpoint }
                : {}),
              // Include Gemini specific keys if available and model is Gemini
              ...(modelTypeToUse === "gemini" &&
              geminiApiKey &&
              geminiApiKey !== "YOUR_GOOGLE_GEMINI_API_KEY_HERE"
                ? { gemini_api_key: geminiApiKey }
                : {}),
              ...(modelTypeToUse === "gemini" &&
              geminiProjectId &&
              geminiProjectId !== "YOUR_GOOGLE_CLOUD_PROJECT_ID_HERE"
                ? { gemini_project_id: geminiProjectId }
                : {}),
              ...(modelTypeToUse === "gemini" &&
              geminiLocation &&
              geminiLocation !== "YOUR_GOOGLE_CLOUD_LOCATION_HERE"
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

          // Update this specific entity
          if (extractedEntities.length > 0) {
            const extracted = extractedEntities[0];
            const meta = extracted.meta || {};
            updatedEntities[i] = {
              ...entity,
              extracted: extracted.extracted,
              duration: meta.duration,
              promptTokens: meta.prompt_tokens,
              completionTokens: meta.completion_tokens,
            };

            console.log(
              `✅ ${entity.name}: ${extracted.extracted.substring(0, 50)}...`
            );
          } else {
            updatedEntities[i] = {
              ...entity,
              extracted: "Error: Not found in response",
            };
          }

          // Update UI immediately with this entity's result
          setEntities([...updatedEntities]);

          // Mark entity as completed
          setExtractingEntities((prev) => {
            const newSet = new Set(prev);
            newSet.delete(entity.name);
            return newSet;
          });
          setCompletedEntities((prev) => new Set(prev).add(entity.name));

          // Auto-scroll to the completed entity card
          setTimeout(() => {
            const entityCard = document.getElementById(`entity-card-${i}`);
            if (entityCard) {
              entityCard.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }
          }, 100);
        } catch (err: any) {
          console.error(`Error extracting ${entity.name}:`, err);
          updatedEntities[i] = {
            ...entity,
            extracted: `Error: ${err.message}`,
          };

          // Update UI with error
          setEntities([...updatedEntities]);

          // Mark as completed (with error)
          setExtractingEntities((prev) => {
            const newSet = new Set(prev);
            newSet.delete(entity.name);
            return newSet;
          });
          setCompletedEntities((prev) => new Set(prev).add(entity.name));
        }
      }

      console.log(
        "\n✅ All entities extracted! Generating paragraph summary...\n"
      );

      // Set state to show we're generating the paragraph and allow UI to update
      setIsGeneratingParagraph(true);

      // Small delay to ensure UI updates before the API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Generate the paragraph summary after all entities are extracted
      const summaryResp = await fetch("/api/generate_paragraph", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entities: updatedEntities,
          summary_prompt: summaryPrompt,
          model_type: modelTypeToUse,
          model_id: modelIdToUse,
          deployment: deploymentToUse,
          api_version: apiVersionToUse,
          azure_endpoint: azureEndpoint,
          azure_api_key: azureApiKey,
          // Include Gemini specific keys if available and model is Gemini
          ...(modelTypeToUse === "gemini" &&
          geminiApiKey &&
          geminiApiKey !== "YOUR_GOOGLE_GEMINI_API_KEY_HERE"
            ? { gemini_api_key: geminiApiKey }
            : {}),
          ...(modelTypeToUse === "gemini" &&
          geminiProjectId &&
          geminiProjectId !== "YOUR_GOOGLE_CLOUD_PROJECT_ID_HERE"
            ? { gemini_project_id: geminiProjectId }
            : {}),
          ...(modelTypeToUse === "gemini" &&
          geminiLocation &&
          geminiLocation !== "YOUR_GOOGLE_CLOUD_LOCATION_HERE"
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

      console.log("✅ Summary generated successfully!\n");

      // Persist results to parent state
      setDocumentData({
        ...documentData,
        studyType: selectedStudyType,
        selectedModel: selectedModel,
        entities: updatedEntities,
        summaryPrompt: summaryPrompt,
        finalSummary,
      });

      setEntities(updatedEntities);
    } catch (err: any) {
      console.error("Extraction error:", err);
      alert(`Extraction failed: ${err.message}`);
    } finally {
      setIsExtracting(false);
      setIsGeneratingParagraph(false);
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
      {/* Rerun Confirmation Dialog */}
      <AlertDialog open={showRerunDialog} onOpenChange={setShowRerunDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Re-run Summarization?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                You have already run the summarization and have results. Running
                it again will overwrite your current extraction results.
              </p>
              <div className="bg-orange-50 border border-orange-200 rounded-md p-3">
                <p className="text-sm font-semibold text-orange-900 mb-1">
                  This will:
                </p>
                <ul className="text-sm text-orange-800 space-y-1 list-disc list-inside">
                  <li>Re-extract all {entities.length} entities</li>
                  <li>Regenerate the paragraph summary</li>
                  <li>Replace existing results with new ones</li>
                </ul>
              </div>
              <p className="text-sm font-medium">
                Are you sure you want to continue?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRunSummarization}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Yes, Re-run Summarization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              {entities.map((entity, index) => {
                const isExtracting = extractingEntities.has(entity.name);
                const isCompleted = completedEntities.has(entity.name);

                return (
                  <div
                    key={index}
                    id={`entity-card-${index}`}
                    className={`border-2 rounded-lg p-4 space-y-4 transition-all duration-300 ${
                      isExtracting
                        ? "border-blue-400 shadow-lg bg-blue-50/30"
                        : isCompleted
                          ? "border-green-400 bg-green-50/20"
                          : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Label>Entity {index + 1}</Label>
                        {isExtracting && (
                          <span className="flex items-center gap-1 text-sm font-normal text-blue-600">
                            <Sparkles className="h-4 w-4 animate-spin" />
                            Extracting...
                          </span>
                        )}
                        {isCompleted && !isExtracting && (
                          <span className="flex items-center gap-1 text-sm font-normal text-green-600">
                            <CheckCircle />
                            Completed
                          </span>
                        )}
                      </div>
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
                          <div className="bg-muted p-3 rounded-md prose prose-sm max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {entity.extracted}
                            </ReactMarkdown>
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
                );
              })}

              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle>Paragraph Generator Prompt</CardTitle>
                  <CardDescription>
                    Customize how the extracted entities should be combined into
                    a paragraph. The entities will be automatically included.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={summaryPrompt
                      .replace(/\n*\{\{entities\}\}$/i, "")
                      .trim()}
                    onChange={(e) => {
                      // Ensure {{entities}} placeholder is always appended
                      const userInput = e.target.value.trim();
                      setSummaryPrompt(
                        userInput ? `${userInput}\n\n{{entities}}` : userInput
                      );
                    }}
                    placeholder="Enter the prompt for paragraph generation..."
                    rows={6}
                    className="resize-y min-h-[120px]"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    💡 Tip: The extracted entities will be automatically
                    included below your instructions.
                  </p>
                </CardContent>
              </Card>
              <Button
                variant="outline"
                onClick={handleRunSummarizationClick}
                disabled={
                  isExtracting ||
                  entities.length === 0 ||
                  entities.some((e) => !e.name || !e.prompt) ||
                  !selectedModel ||
                  availableModels.length === 0
                }
                className={`w-full transition-all duration-300 ${
                  isExtracting ? "bg-blue-50 border-blue-300 shadow-lg" : ""
                }`}
                size="lg"
              >
                {isExtracting ? (
                  isGeneratingParagraph ? (
                    <>
                      <div className="relative mr-2">
                        <Sparkles className="h-5 w-5 animate-spin text-blue-600" />
                        <div className="absolute inset-0 animate-ping opacity-40">
                          <Sparkles className="h-5 w-5 text-blue-600" />
                        </div>
                      </div>
                      <span className="font-medium">
                        Generating Paragraph Summary...
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="relative mr-2">
                        <Sparkles className="h-5 w-5 animate-spin text-blue-600" />
                        <div className="absolute inset-0 animate-ping opacity-40">
                          <Sparkles className="h-5 w-5 text-blue-600" />
                        </div>
                      </div>
                      <span className="font-medium">
                        Extracting Entity {currentEntityIndex} of{" "}
                        {entities.length}...
                      </span>
                    </>
                  )
                ) : (
                  <>
                    <PlayCircle className="h-5 w-5 mr-2" />
                    <span className="font-medium">
                      Run Entity Extraction & Generate Paragraph
                    </span>
                  </>
                )}
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
                  <CardTitle>Generated Paragraph Summary</CardTitle>
                  <CardDescription>
                    Synthesized paragraph from extracted entities
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96">
                    {documentData.finalSummary ? (
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {documentData.finalSummary}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <p>
                          Paragraph summary will appear here after generation...
                        </p>
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
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
                      {isExporting
                        ? "Exporting..."
                        : "Export as Markdown (.md)"}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-3">
                    Both formats include complete pipeline configuration, entity
                    prompts, extraction results, and metadata.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-green-200 bg-green-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    Evaluate Extractions
                  </CardTitle>
                  <CardDescription>
                    Assess extraction quality using AI-powered evaluation
                    metrics
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={() => onComplete?.(documentData)}
                    variant="default"
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    Continue to Evaluation
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                  <p className="text-sm text-muted-foreground mt-3">
                    Evaluate your extractions with multiple LLM judges
                    (GPT-5-Mini, Gemini) for quality assessment.
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
