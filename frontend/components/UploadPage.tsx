import React, { useEffect, useRef, useState } from "react";

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
  onInFlightChange?: (step: "upload" | null) => void;
  onInvalidateDownstream?: () => void;
}

export function UploadPage({
  onComplete,
  documentData,
  onInFlightChange,
  onInvalidateDownstream,
}: UploadPageProps) {
  const [dragActive, setDragActive] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
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
  // Initialize processedFiles from documentData so returning to this page
  // shows previously processed files as already completed.
  const [processedFiles, setProcessedFiles] = useState<Record<string, any>>(
    () => {
      const initial: Record<string, any> = {};
      if (documentData.uploadedFiles) {
        for (const f of documentData.uploadedFiles) {
          if (f.processingResult) {
            initial[f.file.name] = f.processingResult;
          }
        }
      }
      return initial;
    }
  );
  const processedFilesRef = useRef<Record<string, any>>({});
  useEffect(() => {
    processedFilesRef.current = processedFiles;
  }, [processedFiles]);
  const [processingErrors, setProcessingErrors] = useState<
    Record<string, string>
  >({});
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  // Report in-flight status to parent for navigation guards
  useEffect(() => {
    const busy = processingFiles.size > 0 || uploadingFiles.size > 0;
    onInFlightChange?.(busy ? "upload" : null);
    return () => onInFlightChange?.(null);
  }, [processingFiles.size, uploadingFiles.size]);

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
      setIsDirty(true);
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
    setIsDirty(true);
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
    await processFiles(false);
  };

  const handleReprocessAll = async () => {
    await processFiles(true);
  };

  const processFiles = async (force: boolean) => {
    if (selectedFiles.length === 0) return;

    // If this is a restored session without original upload metadata,
    // we won't have file_ids to call the processing API with.
    const hasAnyFileIds = selectedFiles.some(
      (f) => !!uploadResults[f.name]?.file_id
    );
    if (!hasAnyFileIds) {
      toast.info(
        "Original files for this restored session are not available to reprocess."
      );
      return;
    }

    const filesToProcess = selectedFiles.filter(
      (f) =>
        uploadResults[f.name]?.file_id && (force || !processedFiles[f.name])
    );

    if (filesToProcess.length === 0) {
      if (!force) {
        toast.info("All files have already been processed");
      }
      return;
    }

    // Reprocessing because parser or inputs changed: invalidate downstream steps
    if (force) {
      onInvalidateDownstream?.();
    }

    setProcessingFiles(new Set(filesToProcess.map((f) => f.name)));
    setProcessingErrors((prev) => {
      const newErrors = { ...prev };
      filesToProcess.forEach((f) => delete newErrors[f.name]);
      return newErrors;
    });

    // Assign a batch number for this upload action (1–99, wraps after 99)
    batchNumberRef.current =
      batchNumberRef.current >= 99 ? 1 : batchNumberRef.current + 1;
    const currentBatch = batchNumberRef.current;
    const batchStart = Date.now();

    let batchDocumentCount = 0;

    // Process all files concurrently — the backend's ProcessPoolExecutor
    // dynamically throttles based on available GPU VRAM.
    await Promise.all(
      filesToProcess.map(async (file) => {
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
              body: JSON.stringify({
                processor: parser,
                batch_number: currentBatch,
              }),
            }
          );

          if (!response.ok) {
            throw new Error(`Processing failed: ${response.status}`);
          }

          const result = await response.json();

          // Store processing result with camelCase mapping
          // Use file_hash as the primary identifier for document API calls (not UUID conversion_id)
          const canonicalView = result.document_view;
          setProcessedFiles((prev) => ({
            ...prev,
            [file.name]: {
              ...result,
              ...(canonicalView?.processingResult || {}),
              // Use file_hash as conversionId for document API calls
              conversionId:
                canonicalView?.processingResult?.conversionId ||
                result.file_hash ||
                result.conversion_id,
              fileHash:
                canonicalView?.processingResult?.fileHash || result.file_hash,
              markdownPath: result.markdown_path,
              processorUsed:
                canonicalView?.processingResult?.processorUsed ||
                result.processor_used,
              figures:
                (Array.isArray(canonicalView?.processingResult?.figures) &&
                canonicalView.processingResult.figures.length > 0
                  ? canonicalView.processingResult.figures
                  : undefined) ||
                result.figures ||
                [],
              figuresCount:
                canonicalView?.processingResult?.figuresCount ||
                result.figures_found,
              tablesCount:
                canonicalView?.processingResult?.tablesCount ||
                result.tables_found,
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

    // A file is considered "ready" if it has an upload result OR is already
    // present in processedFiles (restored session — no fresh upload happened).
    const allReady = selectedFiles.every(
      (f) => uploadResults[f.name] || processedFiles[f.name]
    );
    if (!allReady) {
      console.error("Not all files uploaded");
      alert("Please wait for all files to finish uploading.");
      return;
    }

    // Prepare data for next step.
    // Merge new per-file data on top of any existing uploadedFiles entry so
    // that fields set by later steps (entities, studyType, etc.) are preserved
    // and not wiped out when the user clicks "View Processed Documents" on a
    // restored session.
    const existingFileMap: Record<string, any> = {};
    for (const ef of documentData.uploadedFiles || []) {
      existingFileMap[ef.file.name] = ef;
    }

    const uploadedFilesData = selectedFiles.map((f) => {
      const existing = existingFileMap[f.name] || {};
      const uploadResult = uploadResults[f.name];
      const processingResult =
        processedFilesRef.current[f.name] || existing.processingResult;
      const canonicalFileId =
        processingResult?.fileHash ||
        processingResult?.conversionId ||
        uploadResult?.file_hash ||
        uploadResult?.file_id ||
        existing.fileId;
      return {
        // Spread existing fields first so downstream data (entities, studyType,
        // summaries, etc.) is preserved.
        ...existing,
        file: f,
        // Normalize all downstream viewers/API calls to canonical file_hash.
        ...(canonicalFileId ? { fileId: canonicalFileId } : {}),
        ...(uploadResult ? { uploadResult } : {}),
        status: "completed" as const,
        selectedParser: fileParsers[f.name] || defaultParser,
        // processingResult from local state takes precedence over existing.
        processingResult: processingResult,
      };
    });

    // For backward compat, expose first file at the top level.
    const firstFile = selectedFiles[0];
    const firstResult = uploadResults[firstFile.name];
    const firstExisting = existingFileMap[firstFile.name] || {};
    const firstProcessed =
      processedFilesRef.current[firstFile.name] ||
      firstExisting.processingResult;
    const firstCanonicalFileId =
      firstProcessed?.fileHash ||
      firstProcessed?.conversionId ||
      firstResult?.file_hash ||
      firstResult?.file_id ||
      firstExisting.fileId;

    console.log(
      "Proceeding to processing page with processed files:",
      uploadedFilesData.length
    );

    onComplete({
      file: firstFile,
      fileId: firstCanonicalFileId,
      uploadResult: firstResult || firstExisting.uploadResult,
      uploadedFiles: uploadedFilesData,
      documentsChanged: isDirty,
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
                        {processedFiles[file.name] && (
                          <span className="ml-2 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-medium flex items-center">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Processed
                          </span>
                        )}
                        {uploadResults[file.name] &&
                          !processedFiles[file.name] && (
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
                        {processingFiles.has(file.name) && (
                          <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium flex items-center">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Processing...
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
            (() => {
              const allProcessed =
                selectedFiles.length > 0 &&
                selectedFiles.every((f) => processedFiles[f.name]);
              const someProcessed =
                Object.keys(processedFiles).length > 0 && !allProcessed;
              const hasAnyFileIds = selectedFiles.some(
                (f) => !!uploadResults[f.name]?.file_id
              );

              // When we don't have file_ids (restored session without upload metadata),
              // disable processing/reprocessing controls to avoid confusing no-ops.
              const canProcess = hasAnyFileIds;

              return allProcessed ? (
                <div className="space-y-2 mb-6">
                  <Button
                    onClick={handleProceed}
                    className="w-full bg-green-600 hover:bg-green-700"
                    size="lg"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    View Processed Documents
                  </Button>
                  <Button
                    onClick={handleReprocessAll}
                    variant="outline"
                    className="w-full"
                    size="sm"
                    disabled={processingFiles.size > 0 || !canProcess}
                    title={
                      canProcess
                        ? undefined
                        : "Cannot re-process: original upload metadata is not available for this restored session."
                    }
                  >
                    <Play className="h-4 w-4 mr-2" />
                    {processingFiles.size > 0
                      ? "Re-processing..."
                      : "Re-process All Files"}
                  </Button>
                  {!canProcess && (
                    <p className="text-xs text-muted-foreground">
                      This session was restored without original upload metadata
                      or the uploaded files are not available anymore, so the
                      documents cannot be reprocessed from here. Please upload
                      the files again.
                    </p>
                  )}
                </div>
              ) : (
                <div className="mb-6 space-y-1">
                  <Button
                    onClick={handleProcessAll}
                    disabled={processingFiles.size > 0 || !canProcess}
                    className="w-full"
                    size="lg"
                    title={
                      canProcess
                        ? undefined
                        : "Cannot process: original upload metadata is not available for this restored session."
                    }
                  >
                    <Play className="h-4 w-4 mr-2" />
                    {processingFiles.size > 0
                      ? "Processing..."
                      : someProcessed
                        ? `Process Remaining Files (${selectedFiles.filter((f) => !processedFiles[f.name]).length})`
                        : `Process All Files (${selectedFiles.length})`}
                  </Button>
                  {!canProcess && (
                    <p className="text-xs text-muted-foreground">
                      This session was restored without original upload
                      metadata, so new processing runs cannot be triggered.
                    </p>
                  )}
                </div>
              );
            })()}

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
