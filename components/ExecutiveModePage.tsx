import React, { useState, useEffect, useRef } from "react";
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
import { Alert, AlertDescription } from "./ui/alert";
import {
  Upload,
  File,
  X,
  Loader2,
  Play,
  CheckCircle,
  AlertTriangle,
  Download,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { settingsManager } from "./SettingsManager";
import type { ModelConfig } from "./SettingsManager";
import {
  loadStudyTypeTemplate,
  getAvailableStudyTypes,
} from "./TemplateLoader";
import { generateWordDocument } from "./ExportUtils";
import { DocumentData } from "../App";

interface ExecutiveModePageProps {
  onBack: () => void;
}

interface FileStatus {
  id: string;
  file: File;
  uploadId?: string;
  status: "queued" | "uploading" | "ingesting" | "extracting" | "summarizing" | "completed" | "error";
  error?: string;
  conversionId?: string;
  extractedData?: Partial<DocumentData>;
  progress?: number; // 0-100
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
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    
    const newFileStatuses: FileStatus[] = pdfFiles.map((f) => ({
      id: Math.random().toString(36).substring(7),
      file: f,
      status: "queued",
      progress: 0
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
    const filesToProcess = files.filter(f => f.status === "queued" || f.status === "error");

    // Process all files in parallel
    await Promise.all(filesToProcess.map(fileStatus => processFile(fileStatus)));
    
    setIsRunning(false);
  };

  const updateFileStatus = (id: string, updates: Partial<FileStatus>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
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
        progress: 30 
      });
      const ingestionData = await ingestDocument(uploadData.file_id);

      // 3. Extraction
      updateFileStatus(fileStatus.id, { 
        status: "extracting",
        conversionId: ingestionData.conversion_id,
        progress: 60
      });
      
      const extractionData = await extractEntities(ingestionData.conversion_id);

      // 4. Summarization
      updateFileStatus(fileStatus.id, { status: "summarizing", progress: 80 });
      const summaryData = await generateSummary(extractionData, ingestionData.conversion_id);

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
          studyType: studyType
        }
      });

    } catch (error: any) {
      console.error(`Error processing file ${fileStatus.file.name}:`, error);
      updateFileStatus(fileStatus.id, { 
        status: "error", 
        error: error.message || "Processing failed" 
      });
    }
  };

  // API Helpers
  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const token = localStorage.getItem("token");

    const response = await fetch(`/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) throw new Error("Upload failed");
    return await response.json();
  };

  const ingestDocument = async (fileId: string) => {
    const token = localStorage.getItem("token");
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
    const token = localStorage.getItem("token");
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
        processor_used: ingestionMethod === "auto" ? undefined : ingestionMethod, // Let backend determine if auto
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Extraction failed");
    }
    
    const data = await response.json();
    
    // Merge prompts back into the extracted entities as they are required for export
    const entitiesWithPrompts = data.extracted_entities.map((extractedEntity: any) => {
      const originalEntity = entities.find(e => e.name === extractedEntity.name);
      return {
        ...extractedEntity,
        prompt: originalEntity?.prompt || ""
      };
    });

    return { 
      entities: entitiesWithPrompts,
      studyType,
      selectedModel 
    };
  };

  const generateSummary = async (extractionData: any, conversionId: string) => {
    const token = localStorage.getItem("token");
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
        summaryPrompt: loadStudyTypeTemplate(studyType).summaryPrompt // Re-fetch prompt
      };

      const blob = await generateWordDocument(docData);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileStatus.file.name.replace(".pdf", "")}_summary.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
      alert("Failed to generate download");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Executive Mode</h2>
          <p className="text-muted-foreground">
            Batch process multiple documents with high efficiency.
          </p>
        </div>
      </div>

      {/* Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Set up your processing pipeline parameters.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Label>Ingestion Method</Label>
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
            <Label>Entity Extraction Model</Label>
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
            <Label>Study Template</Label>
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
      </Card>

      {/* Upload & Action Area */}
      <div className="grid gap-6 md:grid-cols-4">
        <div className="md:col-span-3">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer h-full flex flex-col items-center justify-center ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-gray-300 hover:border-gray-400"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Drop multiple PDF files here</p>
            <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
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
        
        <div className="flex flex-col justify-center space-y-4">
          <Button 
            size="lg" 
            className="w-full h-24 text-lg shadow-lg"
            onClick={runPipeline}
            disabled={isRunning || files.length === 0 || !studyType || !selectedModel}
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="mr-2 h-6 w-6" />
                Run Batch
              </>
            )}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            {files.length} file{files.length !== 1 ? "s" : ""} queued
          </div>
        </div>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Processing Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={`p-2 rounded-full ${
                      file.status === "completed" ? "bg-green-100 text-green-600" :
                      file.status === "error" ? "bg-red-100 text-red-600" :
                      "bg-blue-100 text-blue-600"
                    }`}>
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{file.file.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                          file.status === "completed" ? "bg-green-100 text-green-700" :
                          file.status === "error" ? "bg-red-100 text-red-700" :
                          file.status === "queued" ? "bg-gray-100 text-gray-700" :
                          "bg-blue-100 text-blue-700"
                        }`}>
                          {file.status}
                        </span>
                      </div>
                      {file.error && (
                        <p className="text-xs text-red-500 mt-1">{file.error}</p>
                      )}
                      {file.status !== "completed" && file.status !== "queued" && file.status !== "error" && (
                        <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 transition-all duration-500"
                            style={{ width: `${file.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    {file.status === "completed" && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleDownload(file)}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Word
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(file.id)}
                      disabled={isRunning && file.status !== "completed" && file.status !== "error" && file.status !== "queued"}
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
