import React, { useState, useEffect, useRef } from "react";
import { getValidToken } from "../utils/authUtils";
import { Button } from "./ui/button";
import { AuroraText } from "./ui/aurora-text";
import { SparklesCore } from "./ui/shadcn-io/sparkles";
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
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Upload,
  X,
  Loader2,
  Play,
  Download,
  ArrowLeft,
  Eye,
  FileText,
} from "lucide-react";
import { settingsManager } from "./SettingsManager";
import type { ModelConfig } from "./SettingsManager";
import {
  loadStudyTypeTemplate,
  getAvailableStudyTypes,
  getStudyTypeDisplayName,
} from "./TemplateLoader";
import { downloadExecutiveSummary } from "../utils/executiveSummaryExport";
import { DocumentData } from "../App";

interface ExecutiveModePageProps {
  onBack: () => void;
}

interface FileStatus {
  id: string;
  file: File;
  uploadId?: string;
  status:
    | "queued"
    | "uploading"
    | "ingesting"
    | "extracting"
    | "summarizing"
    | "completed"
    | "error";
  error?: string;
  conversionId?: string;
  extractedData?: Partial<DocumentData>;
  progress?: number; // 0-100
  ingestionTime?: number;
  extractionTime?: number;
}

const INGESTION_METHODS = [
  {
    id: "auto",
    name: "Auto-Select",
    description: "Automatically choose the best processor",
  },
  {
    id: "azure_doc_intelligence",
    name: "Azure Document Intelligence",
    description: "Best for forms and tables",
  },
  {
    id: "docling",
    name: "Docling",
    description: "Best for academic papers",
  },
];

export function ExecutiveModePage({ onBack }: ExecutiveModePageProps) {
  // Configuration State
  const [ingestionMethod, setIngestionMethod] = useState("auto");
  const [selectedModel, setSelectedModel] = useState("");
  const [studyType, setStudyType] = useState("");

  // Data State
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);

  // UI State
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const studyTypes = getAvailableStudyTypes();

  // Load models on mount
  useEffect(() => {
    const loadModels = async () => {
      await settingsManager.refreshServerConfig();
      const models = await settingsManager.getAvailableModelsAsync();
      setAvailableModels(models);
      if (models.length > 0 && !selectedModel) {
        setSelectedModel(models[0].id);
      }
    };
    loadModels();
  }, []);

  // File Handling
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
    // Reset input so same files can be selected again if needed
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addFiles = (newFiles: File[]) => {
    const pdfFiles = newFiles.filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );

    const newFileStatuses: FileStatus[] = pdfFiles.map((f) => ({
      id: Math.random().toString(36).substring(7),
      file: f,
      status: "queued",
      progress: 0,
    }));

    setFiles((prev) => [...prev, ...newFileStatuses]);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Pipeline Execution
  const runPipeline = async () => {
    if (!studyType || !selectedModel) {
      alert("Please select a study type and AI model first.");
      return;
    }

    setIsRunning(true);
    const filesToProcess = files.filter(
      (f) => f.status === "queued" || f.status === "error"
    );

    // Process all files in parallel
    await Promise.all(
      filesToProcess.map((fileStatus) => processFile(fileStatus))
    );

    setIsRunning(false);
  };

  const updateFileStatus = (id: string, updates: Partial<FileStatus>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  };

  const processFile = async (fileStatus: FileStatus) => {
    try {
      // 1. Upload
      updateFileStatus(fileStatus.id, { status: "uploading", progress: 10 });
      const uploadData = await uploadFile(fileStatus.file);

      // 2. Ingestion
      updateFileStatus(fileStatus.id, {
        status: "ingesting",
        uploadId: uploadData.file_id,
        progress: 30,
      });
      const ingestionStart = Date.now();
      const ingestionData = await ingestDocument(uploadData.file_id);
      const ingestionTime = (Date.now() - ingestionStart) / 1000;

      // 3. Extraction
      updateFileStatus(fileStatus.id, {
        status: "extracting",
        conversionId: ingestionData.conversion_id,
        progress: 60,
        ingestionTime,
      });

      const extractionStart = Date.now();
      const extractionData = await extractEntities(ingestionData.conversion_id);
      const extractionTime = (Date.now() - extractionStart) / 1000;

      // 4. Summarization
      updateFileStatus(fileStatus.id, {
        status: "summarizing",
        progress: 80,
        extractionTime,
      });
      const summaryData = await generateSummary(extractionData);

      // 5. Complete
      updateFileStatus(fileStatus.id, {
        status: "completed",
        progress: 100,
        extractedData: {
          ...extractionData,
          finalSummary: summaryData,
          file: fileStatus.file,
          fileId: uploadData.file_id,
          conversionId: ingestionData.conversion_id,
          parser: ingestionMethod,
          selectedModel: selectedModel,
          studyType: studyType,
        },
      });
    } catch (error: any) {
      console.error(`Error processing file ${fileStatus.file.name}:`, error);
      updateFileStatus(fileStatus.id, {
        status: "error",
        error: error.message || "Processing failed",
      });
    }
  };

  // API Helpers
  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const token = await getValidToken();

    const response = await fetch(`/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) throw new Error("Upload failed");
    return await response.json();
  };

  const ingestDocument = async (fileId: string) => {
    const token = await getValidToken();
    const response = await fetch(`/api/documents/process/file/${fileId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ processor: ingestionMethod }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Ingestion failed");
    }
    return await response.json();
  };

  const extractEntities = async (conversionId: string) => {
    const token = await getValidToken();
    const { entities } = loadStudyTypeTemplate(studyType);
    const modelObj = availableModels.find((m) => m.id === selectedModel);

    if (!modelObj) throw new Error("Model not found");

    // Map provider to internal type
    let modelTypeToUse = "azure";
    if (modelObj.category === "google") modelTypeToUse = "gemini";
    else if (modelObj.category === "anthropic") modelTypeToUse = "anthropic";

    const response = await fetch("/api/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversion_id: conversionId,
        model_type: modelTypeToUse,
        model_id: modelObj.id,
        deployment: modelObj.deployment,
        api_version: modelObj.api_version,
        entities: entities,
        processor_used:
          ingestionMethod === "auto" ? undefined : ingestionMethod, // Let backend determine if auto
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Extraction failed");
    }

    const data = await response.json();

    // Merge prompts back into the extracted entities as they are required for export
    const entitiesWithPrompts = data.extracted_entities.map(
      (extractedEntity: any) => {
        const originalEntity = entities.find(
          (e) => e.name === extractedEntity.name
        );
        return {
          ...extractedEntity,
          prompt: originalEntity?.prompt || "",
        };
      }
    );

    return {
      entities: entitiesWithPrompts,
      studyType,
      selectedModel,
    };
  };

  const generateSummary = async (extractionData: any) => {
    const token = await getValidToken();
    const { summaryPrompt } = loadStudyTypeTemplate(studyType);
    const modelObj = availableModels.find((m) => m.id === selectedModel);

    if (!modelObj) throw new Error("Model not found");

    let modelTypeToUse = "azure";
    if (modelObj.category === "google") modelTypeToUse = "gemini";
    else if (modelObj.category === "anthropic") modelTypeToUse = "anthropic";

    const response = await fetch("/api/generate_paragraph", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        entities: extractionData.entities,
        summary_prompt: summaryPrompt,
        model_type: modelTypeToUse,
        model_id: modelObj.id,
        deployment: modelObj.deployment,
        api_version: modelObj.api_version,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Summarization failed");
    }

    const data = await response.json();
    return data.summary;
  };

  const handleDownload = async (fileStatus: FileStatus) => {
    if (!fileStatus.extractedData) return;

    try {
      // Ensure we have all required fields for DocumentData
      const docData: DocumentData = {
        file: fileStatus.file,
        fileId: fileStatus.uploadId,
        parser: ingestionMethod,
        extractedText: "", // Might not have full text here but export should handle it or fetch it
        annotatedOutput: "",
        studyType: fileStatus.extractedData.studyType || studyType,
        selectedModel: fileStatus.extractedData.selectedModel || selectedModel,
        entities: fileStatus.extractedData.entities || [],
        finalSummary: fileStatus.extractedData.finalSummary || "",
        conversionId: fileStatus.conversionId,
        summaryPrompt: loadStudyTypeTemplate(studyType).summaryPrompt, // Re-fetch prompt
      };

      downloadExecutiveSummary(docData);
    } catch (error) {
      console.error("Download failed:", error);
      alert("Failed to generate download");
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          className="h-10 px-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            <AuroraText speed={2}>Executive Mode</AuroraText>
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Batch process multiple documents with high efficiency.
          </p>
        </div>
      </div>

      {/* Configuration Card */}
      <Card className="shadow-md border-grey-500 border-2">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Configuration</CardTitle>
          <CardDescription className="text-sm">
            Set up your processing pipeline parameters.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-8">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Ingestion Method</Label>
            <Select value={ingestionMethod} onValueChange={setIngestionMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INGESTION_METHODS.map((method) => (
                  <SelectItem key={method.id} value={method.id}>
                    {method.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Entity Extraction Model
            </Label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger>
                <SelectValue placeholder="Select Model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Study Template</Label>
            <Select value={studyType} onValueChange={setStudyType}>
              <SelectTrigger>
                <SelectValue placeholder="Select Template" />
              </SelectTrigger>
              <SelectContent>
                {studyTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>

        {/* Upload & Action Area */}
        <CardContent className="pt-8">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="md:col-span-2">
              <div
                className={`border-4 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer h-full flex flex-col items-center justify-center shadow-sm ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-gray-300 hover:border-blue-500"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-lg font-medium">
                  Upload Toxicology Reports Here
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            </div>

            <div className="flex flex-col justify-center space-y-6">
              <Button
                className="w-full h-24 text-base shadow-lg relative overflow-hidden"
                onClick={runPipeline}
                disabled={
                  isRunning ||
                  files.length === 0 ||
                  !studyType ||
                  !selectedModel
                }
              >
                <div className="relative z-10 flex items-center justify-center">
                  {isRunning ? (
                    <>
                      <Loader2 className="mr-3 h-8 w-8 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="mr-3 h-8 w-8" />
                      Generate Scientific Summaries
                    </>
                  )}
                </div>
                <SparklesCore
                  background="transparent"
                  minSize={0.6}
                  maxSize={1.4}
                  particleDensity={300}
                  className="absolute inset-0 w-full h-full"
                  particleColor={[
                    "#FF00FF",
                    "#00FFFF",
                    "#FFFF00",
                    "#FF0000",
                    "#00FF00",
                    "#0000FF",
                  ]}
                />
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                {files.length} file{files.length !== 1 ? "s" : ""} queued
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* File List */}
      {files.length > 0 && (
        <Card className="shadow-md">
          <CardHeader className="py-4">
            <CardTitle className="text-lg">Processing Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-4 border rounded-xl bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-6 flex-1 min-w-0">
                    <div
                      className={`p-3 rounded-full ${
                        file.status === "completed"
                          ? "bg-green-100 text-green-600"
                          : file.status === "error"
                            ? "bg-red-100 text-red-600"
                            : "bg-blue-100 text-blue-600"
                      }`}
                    >
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <p className="font-semibold text-base truncate">
                          {file.file.name}
                        </p>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                            file.status === "completed"
                              ? "bg-green-100 text-green-700"
                              : file.status === "error"
                                ? "bg-red-100 text-red-700"
                                : file.status === "queued"
                                  ? "bg-gray-100 text-gray-700"
                                  : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {file.status}
                        </span>
                      </div>
                      {file.error && (
                        <p className="text-sm text-red-500 mt-1">
                          {file.error}
                        </p>
                      )}
                      {file.status !== "completed" &&
                        file.status !== "queued" &&
                        file.status !== "error" && (
                          <div className="w-full h-3 bg-gray-100 rounded-full mt-4 overflow-hidden">
                            <div
                              className="h-full bg-blue-500 transition-all duration-500"
                              style={{ width: `${file.progress}%` }}
                            />
                          </div>
                        )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                        {file.ingestionTime && (
                          <span>
                            Ingestion: {file.ingestionTime.toFixed(1)}s
                          </span>
                        )}
                        {file.extractionTime && (
                          <span>
                            Extraction: {file.extractionTime.toFixed(1)}s
                          </span>
                        )}
                        {file.extractedData?.parser && (
                          <span>
                            Method:{" "}
                            {INGESTION_METHODS.find(
                              (m) => m.id === file.extractedData?.parser
                            )?.name || file.extractedData.parser}
                          </span>
                        )}
                        {file.extractedData?.selectedModel && (
                          <span>
                            Model:{" "}
                            {availableModels.find(
                              (m) => m.id === file.extractedData?.selectedModel
                            )?.name || file.extractedData.selectedModel}
                          </span>
                        )}
                        {file.extractedData?.studyType && (
                          <span>
                            Template:{" "}
                            {getStudyTypeDisplayName(
                              file.extractedData.studyType
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 ml-6">
                    {file.status === "completed" && (
                      <>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-3"
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              View
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="!w-[95vw] !max-w-[1800px] h-[90vh] flex flex-col">
                            <DialogHeader className="flex-shrink-0">
                              <DialogTitle className="text-xl">
                                Summary: {file.file.name}
                              </DialogTitle>
                            </DialogHeader>
                            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
                              <div className="flex flex-col min-h-0">
                                <div className="p-4 bg-muted rounded-lg flex-1 overflow-y-auto">
                                  <h4 className="font-bold mb-3 text-sm text-muted-foreground uppercase tracking-wider">
                                    Generated Paragraph
                                  </h4>
                                  <p className="whitespace-pre-wrap leading-relaxed text-base">
                                    {file.extractedData?.finalSummary ||
                                      "No summary available."}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-col min-h-0">
                                <div className="border rounded-lg flex-1 overflow-y-auto flex flex-col">
                                  <h4 className="font-bold p-4 pb-2 text-sm text-muted-foreground uppercase tracking-wider sticky top-0 bg-background z-10 flex-shrink-0">
                                    Extracted Entities
                                  </h4>
                                  <div className="p-4 pt-0 flex-1 overflow-y-auto">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="w-[180px] text-sm font-bold">
                                            Entity
                                          </TableHead>
                                          <TableHead className="text-sm font-bold">
                                            Extracted Value
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {file.extractedData?.entities?.map(
                                          (entity: any, idx: number) => (
                                            <TableRow key={idx}>
                                              <TableCell className="font-medium align-top text-sm py-3">
                                                {entity.name}
                                              </TableCell>
                                              <TableCell className="align-top whitespace-pre-wrap text-sm py-3">
                                                {entity.answer ||
                                                  entity.extracted ||
                                                  "-"}
                                              </TableCell>
                                            </TableRow>
                                          )
                                        )}
                                        {(!file.extractedData?.entities ||
                                          file.extractedData.entities.length ===
                                            0) && (
                                          <TableRow>
                                            <TableCell
                                              colSpan={2}
                                              className="text-center text-muted-foreground"
                                            >
                                              No entities extracted
                                            </TableCell>
                                          </TableRow>
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-3"
                          onClick={() => handleDownload(file)}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Word
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8"
                      onClick={() => removeFile(file.id)}
                      disabled={
                        isRunning &&
                        file.status !== "completed" &&
                        file.status !== "error" &&
                        file.status !== "queued"
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
