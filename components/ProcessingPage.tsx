import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { DocumentData } from "../App";
import { PDFBoundingBoxViewer } from "./PDFBoundingBoxViewer";
import { FigureGallery } from "./FigureGallery";
import { TablesGallery } from "./TablesGallery";

import { settingsManager } from "./SettingsManager";
import {
  Loader2,
  FileText,
  CheckCircle,
  XCircle,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import { Alert, AlertDescription } from "./ui/alert";
import { RawOutputViewer } from "./RawOutputViewer";

interface ProcessingPageProps {
  onComplete: (data: Partial<DocumentData>) => void;
  onBack: () => void;
  documentData: DocumentData;
}

const allParsers = [
  {
    id: "azure_doc_intelligence",
    name: "Azure Document Intelligence",
    description:
      "Microsoft Azure cognitive service for form and document analysis",
    requiresApiKey: true,
  },
  {
    id: "docling",
    name: "Docling",
    description:
      "Open Source document parsing with advanced layout understanding",
    requiresApiKey: false,
  },
];

interface FileStatus {
  file: File;
  fileId: string;
  uploadResult: any;
  status: "pending" | "processing" | "completed" | "error";
  processingResult?: {
    conversionId?: string;
    markdownPath?: string;
    processorUsed?: string;
    figures?: any[];
    figuresCount?: number;
    tablesCount?: number;
    extractedText?: string;
  };
  selectedParser?: string;
  error?: string;
}

export function ProcessingPage({
  onComplete,
  onBack,
  documentData,
}: ProcessingPageProps) {
  // Initialize files from documentData
  const [files] = useState<FileStatus[]>(() => {
    if (documentData.uploadedFiles && documentData.uploadedFiles.length > 0) {
      return documentData.uploadedFiles.map((f) => ({
        ...f,
        status: f.status || "pending",
        selectedParser: f.selectedParser || "azure_doc_intelligence",
      }));
    } else if (documentData.file && documentData.fileId) {
      // Backward compatibility for single file
      return [
        {
          file: documentData.file,
          fileId: documentData.fileId,
          uploadResult: documentData.uploadResult,
          status: "pending",
          selectedParser: "azure_doc_intelligence",
        },
      ];
    }
    return [];
  });

  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    files.length > 0 ? files[0].fileId : null
  );
  const [globalParser, setGlobalParser] = useState<string>(
    "azure_doc_intelligence"
  );

  useEffect(() => {
    const loadServerConfig = async () => {
      await settingsManager.refreshServerConfig();
    };
    loadServerConfig();
  }, []);

  // Ensure page starts at top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Filter parsers based on API key availability
  const getAvailableParsers = () => {
    return allParsers.filter((parser) => {
      if (parser.id === "azure_doc_intelligence") {
        return settingsManager.isAzureDocumentIntelligenceAvailable();
      }
      return true;
    });
  };

  const availableParsers = getAvailableParsers();

  // Ensure globalParser is valid - set to first available if current is unavailable
  useEffect(() => {
    if (
      availableParsers.length > 0 &&
      !availableParsers.find((p) => p.id === globalParser)
    ) {
      setGlobalParser(availableParsers[0].id);
    }
  }, [availableParsers, globalParser]);

  const handleProceed = () => {
    // Filter completed files
    const completedFiles = files.filter((f) => f.status === "completed");

    if (completedFiles.length === 0) {
      return; // Should be disabled anyway
    }

    // For backward compatibility, update the main documentData with the first completed file
    // But also pass the full list of uploadedFiles with their results
    const firstFile = completedFiles[0];

    onComplete({
      // Legacy fields for first file
      parser: firstFile.processingResult?.processorUsed,
      extractedText: firstFile.processingResult?.extractedText,
      annotatedOutput: "",
      conversionId: firstFile.processingResult?.conversionId,
      markdownPath: firstFile.processingResult?.markdownPath,
      processorUsed: firstFile.processingResult?.processorUsed,
      figures: firstFile.processingResult?.figures,
      figuresCount: firstFile.processingResult?.figuresCount,
      tablesCount: firstFile.processingResult?.tablesCount,
      showResults: true,

      // New field
      uploadedFiles: files,
    });
  };

  const selectedFile = files.find((f) => f.fileId === selectedFileId);
  const completedCount = files.filter((f) => f.status === "completed").length;
  const totalCount = files.length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h2 className="text-xl font-semibold">Processed Documents</h2>
        </div>
        <div className="flex items-center gap-3">
          {completedCount > 0 && (
            <Button onClick={handleProceed}>
              Proceed to Entity Extraction ({completedCount}/{totalCount})
            </Button>
          )}
        </div>
      </div>

      {/* File Selector Dropdown - Only show if multiple files */}
      {files.length > 1 && (
        <div className="mb-4">
          <label className="text-sm font-medium block mb-2">
            Select Document
          </label>
          <Select
            value={selectedFileId || undefined}
            onValueChange={setSelectedFileId}
          >
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Select a document" />
            </SelectTrigger>
            <SelectContent>
              {files.map((file) => (
                <SelectItem key={file.fileId} value={file.fileId}>
                  <div className="flex items-center gap-2">
                    {file.status === "completed" && (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    )}
                    {file.status === "processing" && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {file.status === "error" && (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span>{file.file.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Document Viewer Area */}
      <div className="flex-1 overflow-y-auto">
        {selectedFile ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              {/* File info removed as per user request */}
            </div>

            {selectedFile.status === "error" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Processing failed: {selectedFile.error}
                </AlertDescription>
              </Alert>
            )}

            {selectedFile.status === "completed" &&
              selectedFile.processingResult && (
                <>
                  {/* Display Figures if available */}
                  {Array.isArray(selectedFile.processingResult.figures) &&
                    selectedFile.processingResult.figures.length > 0 &&
                    selectedFile.processingResult.conversionId && (
                      <FigureGallery
                        conversionId={
                          selectedFile.processingResult.conversionId
                        }
                        figures={selectedFile.processingResult.figures}
                      />
                    )}

                  {/* Display Tables if available */}
                  {(selectedFile.processingResult.tablesCount || 0) > 0 &&
                    selectedFile.processingResult.conversionId && (
                      <TablesGallery
                        conversionId={
                          selectedFile.processingResult.conversionId
                        }
                        tablesCount={
                          selectedFile.processingResult.tablesCount || 0
                        }
                      />
                    )}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    <div>
                      <PDFBoundingBoxViewer
                        fileId={selectedFile.fileId}
                        conversionId={
                          selectedFile.processingResult.conversionId || ""
                        }
                        fileName={selectedFile.file.name}
                      />
                    </div>
                    <div>
                      <RawOutputViewer
                        conversionId={
                          selectedFile.processingResult.conversionId || ""
                        }
                        processorUsed={
                          selectedFile.processingResult.processorUsed || ""
                        }
                      />
                    </div>
                  </div>
                </>
              )}

            {selectedFile.status === "pending" && (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border-2 border-dashed rounded-lg">
                <FileText className="h-12 w-12 mb-4 opacity-20" />
                <p>Ready to process</p>
                <p className="text-sm">Select a parser and click Process</p>
              </div>
            )}

            {selectedFile.status === "processing" && (
              <div className="h-80 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50/30">
                <div className="relative mb-4">
                  <Loader2 className="h-12 w-12 animate-spin text-gray-400" />
                </div>
                <p className="text-lg font-medium text-gray-700">
                  Processing document...
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Analyzing content and extracting data
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p>Select a file to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
