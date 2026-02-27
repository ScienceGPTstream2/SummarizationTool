import React, { useRef, useState } from "react";
import { pLimit } from "../utils/concurrency";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  File as FileIcon,
  Loader2,
  Upload,
  X,
  CheckCircle,
  XCircle,
  Play,
} from "lucide-react";
import { DocumentData } from "../App";
import { toast } from "sonner";
import { authenticatedFetch } from "../utils/authUtils";
import { getSessionId } from "../utils/session";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface UploadPageProps {
  onComplete: (data: Partial<DocumentData>) => void;
  documentData: DocumentData;
}

export function UploadPage({ onComplete, documentData }: UploadPageProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>(
    documentData.uploadedFiles?.map((f) => f.file) ||
      (documentData.file ? [documentData.file] : [])
  );
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());
  const [uploadResults, setUploadResults] = useState<Record<string, any>>(
    documentData.uploadedFiles?.reduce(
      (acc, curr) => ({ ...acc, [curr.file.name]: curr.uploadResult }),
      {}
    ) ||
      (documentData.file && documentData.uploadResult
        ? { [documentData.file.name]: documentData.uploadResult }
        : {})
  );
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchNumberRef = useRef(0);

  // Parser selection state
  const [defaultParser, setDefaultParser] = useState<string>(
    "azure_doc_intelligence"
  );
  const [fileParsers, setFileParsers] = useState<Record<string, string>>({});
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(
    new Set()
  );
  const [processedFiles, setProcessedFiles] = useState<Record<string, any>>({});
  const [processingErrors, setProcessingErrors] = useState<
    Record<string, string>
  >({});
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const MAX_FILES = 10;

  const allParsers = [
    {
      id: "azure_doc_intelligence",
      name: "Azure Document Intelligence",
      requiresApiKey: true,
    },
    {
      id: "docling",
      name: "Docling",
      requiresApiKey: false,
    },
  ];

  const getAvailableParsers = () => {
    return allParsers.filter(() => {
      return true;
    });
  };

  const availableParsers = getAvailableParsers();

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const validateAndAddFiles = async (files: File[]) => {
    const currentCount = selectedFiles.length;
    const newFiles: File[] = [];
    let errorMsg = "";

    if (currentCount + files.length > MAX_FILES) {
      errorMsg = `You can only upload a maximum of ${MAX_FILES} files.`;
      // Take only as many as we can fit
      const remainingSlots = MAX_FILES - currentCount;
      if (remainingSlots > 0) {
        files = files.slice(0, remainingSlots);
      } else {
        files = [];
      }
    }

    for (const file of files) {
      // Check for duplicates
      if (selectedFiles.some((f) => f.name === file.name)) {
        console.log("Duplicate file ignored:", file.name);
        toast.info(`File "${file.name}" has already been added.`);
        continue;
      }

      // More flexible PDF detection - check file type OR file extension
      const isPDF =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");

      if (isPDF) {
        console.log("File accepted:", file.name);
        newFiles.push(file);
      } else {
        console.log("File rejected - not a PDF:", file.name, file.type);
      }
    }

    if (newFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...newFiles]);
      // Automatically start upload for new files
      for (const file of newFiles) {
        try {
          await handleFileUpload(file);
        } catch (error) {
          console.error("Upload failed for file:", file.name, error);
        }
      }
    }

    if (errorMsg) {
      // We can set a general error or just log it. For now, let's use the first file's error slot if available or a general alert
      // Since we don't have a general error state, we'll just log it or maybe show it in the UI if we add a general error area.
      // For simplicity, let's just log it.
      console.warn(errorMsg);
      toast.warning(errorMsg); // Toast for limit reached
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      console.log("Dropped files:", files.length);
      validateAndAddFiles(files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log("File select triggered, files:", e.target.files?.length);

    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      validateAndAddFiles(files);
    } else {
      console.log("No file selected or file selection cancelled");
    }
    // Reset input value to allow selecting the same file again if removed
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeFile = async (fileName: string) => {
    // Get file ID if available
    const result = uploadResults[fileName];
    const fileId = result?.file_id;

    // Remove from UI state immediately
    setSelectedFiles((prev) => prev.filter((f) => f.name !== fileName));
    setUploadResults((prev) => {
      const newResults = { ...prev };
      delete newResults[fileName];
      return newResults;
    });
    setUploadErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[fileName];
      return newErrors;
    });

    // If file was uploaded, delete from backend
    if (fileId) {
      try {
        await authenticatedFetch(`/api/files/${fileId}`, {
          method: "DELETE",
        });
        console.log("File deleted from backend:", fileName);
      } catch (error) {
        console.error("Failed to delete file from backend:", error);
        // We don't show an error to the user here as the file is already gone from UI
      }
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploadingFiles((prev) => new Set(prev).add(file.name));
    // Clear previous errors
    setUploadErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[file.name];
      return newErrors;
    });

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await authenticatedFetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Upload error:", errorData);
        throw new Error(
          errorData.detail || `Upload failed with status ${response.status}`
        );
      }

      const result = await response.json();

      setUploadResults((prev) => ({ ...prev, [file.name]: result }));

      // If this is the first file, update the main document state
      // Note: We'll actually update the main document state with the *first* file
      // when the user clicks "Proceed"

      return result;
    } catch (error) {
      console.error("Upload error:", error);
      const errorMsg = error instanceof Error ? error.message : "Upload failed";
      setUploadErrors((prev) => ({
        ...prev,
        [file.name]: errorMsg,
      }));
      throw error;
    } finally {
      setUploadingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(file.name);
        return newSet;
      });
    }
  };

  const handleProcessAll = async () => {
    if (selectedFiles.length === 0) return;

    // Mark all as processing initially and clear errors
    // Only process files that have been uploaded but NOT yet processed
    const filesToProcess = selectedFiles.filter(
      (f) => uploadResults[f.name]?.file_id && !processedFiles[f.name]
    );

    // If all files are already processed, show message and return
    if (filesToProcess.length === 0) {
      toast.info("All files have already been processed");
      return;
    }

    setProcessingFiles(new Set(filesToProcess.map((f) => f.name)));
    setProcessingErrors((prev) => {
      const newErrors = { ...prev };
      filesToProcess.forEach((f) => delete newErrors[f.name]);
      return newErrors;
    });

    // Limit concurrency to 5 to prevent browser freeze
    const limit = pLimit(5);

    // Assign a batch number for this upload action (1–99, wraps after 99)
    batchNumberRef.current = batchNumberRef.current >= 99 ? 1 : batchNumberRef.current + 1;
    const currentBatch = batchNumberRef.current;
    const batchStart = Date.now();

    let batchDocumentCount = 0;

    // Process all files with concurrency limit
    await Promise.all(
      filesToProcess.map((file) =>
        limit(async () => {
          const fileId = uploadResults[file.name]?.file_id;
          if (!fileId) return;

          // Get parser for this file (individual override or default)
          const parser = fileParsers[file.name] || defaultParser;

          try {
            const response = await authenticatedFetch(
              `/api/documents/process/file/${fileId}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ processor: parser, batch_number: currentBatch }),
              }
            );

            if (!response.ok) {
              throw new Error(`Processing failed: ${response.status}`);
            }

            const result = await response.json();

            // Store processing result with camelCase mapping
            // Use file_hash as the primary identifier for document API calls (not UUID conversion_id)
            setProcessedFiles((prev) => ({
              ...prev,
              [file.name]: {
                ...result,
                // Use file_hash as conversionId for document API calls
                conversionId: result.file_hash || result.conversion_id,
                fileHash: result.file_hash,
                markdownPath: result.markdown_path,
                processorUsed: result.processor_used,
                figuresCount: result.figures_found,
                tablesCount: result.tables_found,
                parseCost: result.parse_cost,
                parseDuration: result.parse_duration_seconds,
                parser,
              },
            }));

            batchDocumentCount += 1;
            toast.success(`${file.name} processed successfully`);
          } catch (error) {
            console.error(`Error processing ${file.name}:`, error);
            const errorMsg =
              error instanceof Error ? error.message : "Processing failed";
            setProcessingErrors((prev) => ({
              ...prev,
              [file.name]: errorMsg,
            }));
            toast.error(`Failed to process ${file.name}`);
          } finally {
            setProcessingFiles((prev) => {
              const newSet = new Set(prev);
              newSet.delete(file.name);
              return newSet;
            });
          }
        })
      )
    );

    // Ship batch wall-clock latency to backend
    if (batchDocumentCount > 0) {
      const batchLatency = (Date.now() - batchStart) / 1000;
      try {
        await authenticatedFetch("/api/server/batch-metrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: getSessionId(),
            batch_number: currentBatch,
            batch_latency: batchLatency,
            document_count: batchDocumentCount,
          }),
        });
      } catch (err) {
        console.warn("[batch-metrics] Failed to record batch latency:", err);
      }
    }
  };

  const handleProceed = () => {
    if (selectedFiles.length === 0) {
      console.error("No files selected");
      return;
    }

    // Check if all files are uploaded
    const allUploaded = selectedFiles.every((f) => uploadResults[f.name]);
    if (!allUploaded) {
      console.error("Not all files uploaded");
      alert("Please wait for all files to finish uploading.");
      return;
    }

    // Prepare data for next step
    // For backward compatibility, we use the first file as the "main" file
    const firstFile = selectedFiles[0];
    const firstResult = uploadResults[firstFile.name];

    const uploadedFilesData = selectedFiles.map((f) => ({
      file: f,
      fileId: uploadResults[f.name].file_id,
      uploadResult: uploadResults[f.name],
      status: "completed" as const,
      selectedParser: fileParsers[f.name] || defaultParser,
      processingResult: processedFiles[f.name],
    }));

    console.log(
      "Proceeding to processing page with processed files:",
      uploadedFilesData.length
    );

    // Pass the upload result and file to the next step
    onComplete({
      file: firstFile,
      fileId: firstResult.file_id,
      uploadResult: firstResult,
      uploadedFiles: uploadedFilesData,
    });
  };

  return (
    <div className="p-6 h-full">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-semibold mb-2">Upload Your Documents</h2>
        <p className="text-muted-foreground">
          Upload PDF documents and configure processing settings.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6 max-w-7xl mx-auto">
        {/* Left Column: Upload Area */}
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium mb-1">Document Upload</h3>
            <p className="text-sm text-muted-foreground">
              Select up to {MAX_FILES} PDF files from your computer or drag and
              drop them here.
            </p>
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-300 ease-in-out cursor-pointer hover:shadow-md hover:scale-[1.01] ${
              dragActive
                ? "border-primary bg-primary/5 scale-[1.02]"
                : "border-gray-300 hover:border-primary"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 rounded-full bg-gray-50">
                <Upload className="h-8 w-8 text-gray-400" />
              </div>
              <div>
                <p className="text-lg font-medium mb-1">
                  Drop your PDF files here
                </p>
                <p className="text-sm text-muted-foreground mb-4">or</p>
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".pdf"
                  multiple
                  onChange={handleFileSelect}
                  ref={fileInputRef}
                />
                <Button variant="outline" className="pointer-events-none">
                  Browse Files
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Supports PDF files up to 20MB. Max {MAX_FILES} files.
              </p>
            </div>
          </div>

          {/* File List - Scrollable Container */}
          {selectedFiles.length > 0 && (
            <div className="mt-6 space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {selectedFiles.map((file) => (
                <div
                  key={file.name}
                  onClick={() => setActiveFileId(file.name)}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                    activeFileId === file.name
                      ? "bg-blue-50 border-blue-200 ring-1 ring-blue-200"
                      : "bg-gray-50 border-gray-100 hover:border-gray-200"
                  }`}
                >
                  <div className="flex items-center flex-1 min-w-0">
                    <FileIcon
                      className={`h-8 w-8 mr-3 ${activeFileId === file.name ? "text-blue-500" : "text-gray-400"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {file.name}
                      </p>
                      <div className="flex items-center text-xs text-gray-500 mt-0.5">
                        <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                        {uploadResults[file.name] && (
                          <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium flex items-center">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Uploaded
                          </span>
                        )}
                        {uploadingFiles.has(file.name) && (
                          <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium flex items-center">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Uploading...
                          </span>
                        )}
                        {fileParsers[file.name] && (
                          <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
                            {availableParsers.find(
                              (p) => p.id === fileParsers[file.name]
                            )?.name || "Custom"}
                          </span>
                        )}
                      </div>
                      {uploadErrors[file.name] && (
                        <p className="text-xs text-red-600 font-medium flex items-center mt-0.5">
                          <XCircle className="h-3 w-3 mr-1" />
                          {uploadErrors[file.name]}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-500 hover:text-red-500 ml-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file.name);
                      if (activeFileId === file.name) setActiveFileId(null);
                    }}
                    disabled={uploadingFiles.has(file.name)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Right Column: Processing Configuration - Always Visible */}
        <Card className="p-6">
          <h3 className="text-lg font-medium mb-4">
            {activeFileId ? "File Configuration" : "Global Configuration"}
          </h3>

          {/* Configuration Content */}
          <div className="mb-6">
            {activeFileId ? (
              <>
                <label className="text-sm font-medium block mb-2 truncate">
                  Parser for:{" "}
                  <span className="text-blue-600">{activeFileId}</span>
                </label>
                <Select
                  value={fileParsers[activeFileId] || "default"}
                  onValueChange={(value) => {
                    if (value === "default") {
                      const newParsers = { ...fileParsers };
                      delete newParsers[activeFileId];
                      setFileParsers(newParsers);
                    } else {
                      setFileParsers((prev) => ({
                        ...prev,
                        [activeFileId]: value,
                      }));
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      Use Default (
                      {
                        availableParsers.find((p) => p.id === defaultParser)
                          ?.name
                      }
                      )
                    </SelectItem>
                    {availableParsers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  Override the default parser for this specific file.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-4"
                  onClick={() => setActiveFileId(null)}
                >
                  Back to Global Settings
                </Button>
              </>
            ) : (
              <>
                <label className="text-sm font-medium block mb-2">
                  Default Parser
                </label>
                <Select value={defaultParser} onValueChange={setDefaultParser}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableParsers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  This parser will be used for all files unless overridden.
                </p>
              </>
            )}
          </div>

          {/* Process All Button */}
          {/* Process All / Proceed Button */}
          {selectedFiles.length > 0 &&
          Object.keys(processedFiles).length === selectedFiles.length ? (
            <Button
              onClick={handleProceed}
              className="w-full mb-6 bg-green-600 hover:bg-green-700"
              size="lg"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              View Processed Documents
            </Button>
          ) : (
            <Button
              onClick={handleProcessAll}
              disabled={processingFiles.size > 0}
              className="w-full mb-6"
              size="lg"
            >
              <Play className="h-4 w-4 mr-2" />
              {processingFiles.size > 0
                ? "Processing..."
                : `Process All Files (${selectedFiles.length})`}
            </Button>
          )}

          {/* Processing Status */}
          {(processingFiles.size > 0 ||
            Object.keys(processedFiles).length > 0) && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Processing Status:</p>
              {selectedFiles.map((file) => {
                const isProcessing = processingFiles.has(file.name);
                const isProcessed = processedFiles[file.name];

                return (
                  <div
                    key={file.name}
                    className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded"
                  >
                    <span className="truncate flex-1 mr-2">{file.name}</span>
                    {isProcessing && (
                      <span className="flex items-center text-blue-600">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Processing...
                      </span>
                    )}
                    {isProcessed && !isProcessing && (
                      <span className="flex items-center text-green-600">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Completed
                      </span>
                    )}
                    {!isProcessing &&
                      !isProcessed &&
                      processingErrors[file.name] && (
                        <span
                          className="flex items-center text-red-600"
                          title={processingErrors[file.name]}
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Failed
                        </span>
                      )}
                    {!isProcessing &&
                      !isProcessed &&
                      !processingErrors[file.name] && (
                        <span className="text-gray-400">Pending</span>
                      )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Proceed Button - Full Width Below */}
    </div>
  );
}
