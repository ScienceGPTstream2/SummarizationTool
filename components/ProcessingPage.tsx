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
import { Alert, AlertDescription } from "./ui/alert";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { DocumentData } from "../App";
import { settingsManager } from "./SettingsManager";
import { FigureGallery } from "./FigureGallery";
import { TablesGallery } from "./TablesGallery";
import { PDFBoundingBoxViewer } from "./PDFBoundingBoxViewer";
import { RawOutputViewer } from "./RawOutputViewer";

interface ProcessingPageProps {
  onComplete: (data: Partial<DocumentData>) => void;
  onBack: () => void;
  documentData: DocumentData;
}

const allParsers = [
  {
    id: "auto",
    name: "Auto-Select",
    description: "Automatically choose the best processor for your document",
    requiresApiKey: false,
  },
  {
    id: "docling",
    name: "Docling",
    description:
      "AI-powered document parsing with advanced layout understanding",
    requiresApiKey: false,
  },
  {
    id: "azure_doc_intelligence",
    name: "Azure Document Intelligence",
    description:
      "Microsoft Azure cognitive service for form and document analysis",
    requiresApiKey: true,
  },
];

interface FigureMetadata {
  id: string;
  page: number | null;
  caption: string | null;
  image_path?: string;
  bounding_regions?: Array<{
    page_number: number;
    polygon: number[];
  }>;
}

export function ProcessingPage({
  onComplete,
  onBack,
  documentData,
}: ProcessingPageProps) {
  const [selectedParser, setSelectedParser] = useState(
    documentData.parser || ""
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [showResults, setShowResults] = useState(
    documentData.showResults ?? !!documentData.extractedText
  );
  const [conversionId, setConversionId] = useState<string | null>(
    documentData.conversionId || null
  );
  const [markdownPath, setMarkdownPath] = useState<string | null>(
    documentData.markdownPath || null
  );
  const [processorUsed, setProcessorUsed] = useState<string | null>(
    documentData.processorUsed || null
  );
  const [processError, setProcessError] = useState<string | null>(null);
  const [extractedTextLocal, setExtractedTextLocal] = useState<string>(
    documentData.extractedText || ""
  );
  const [figures, setFigures] = useState<FigureMetadata[]>(
    documentData.figures || []
  );
  const [figuresCount, setFiguresCount] = useState<number>(
    documentData.figuresCount || 0
  );
  const [tablesCount, setTablesCount] = useState<number>(
    documentData.tablesCount || 0
  );
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  }

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isProcessing) {
      setElapsedTime(0);
      timer = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isProcessing]);

  // Filter parsers based on API key availability
  const getAvailableParsers = () => {
    return allParsers.filter((parser) => {
      if (parser.id === "azure_doc_intelligence") {
        return settingsManager.isAzureDocumentIntelligenceAvailable();
      }
      return true; // All other parsers are always available
    });
  };

  const availableParsers = getAvailableParsers();
  const isAzureDocumentIntelligenceConfigured =
    settingsManager.isAzureDocumentIntelligenceAvailable();

  const handleProcessPDF = async () => {
    setIsProcessing(true);
    setProcessError(null);

    try {
      // Ensure we have an uploaded file id
      if (!documentData.fileId) {
        throw new Error(
          "No uploaded file ID found. Please upload a PDF first."
        );
      }

      // Ensure a processor is selected
      if (!selectedParser) {
        throw new Error("Please select a document processor.");
      }

      // Trigger backend conversion for an uploaded file
      const token = localStorage.getItem("token");
      const resp = await fetch(
        `/api/documents/process/file/${documentData.fileId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ processor: selectedParser }),
        }
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || "Conversion request failed");
      }

      const data = await resp.json();
      setConversionId(data.conversion_id || null);
      setMarkdownPath(data.markdown_path || null);
      setProcessorUsed(data.processor_used || null);

      // Check if figures were extracted
      if (data.figures_found !== undefined) {
        setFiguresCount(data.figures_found);
        setFigures(data.figures || []);
      }

      // Check if tables were extracted
      if (data.tables_found !== undefined) {
        setTablesCount(data.tables_found);
      }

      // Fetch the markdown content with processor info for efficiency
      const processorParam = data.processor_used
        ? `?processor_used=${encodeURIComponent(data.processor_used)}`
        : "";
      const mdResp = await fetch(
        `/api/documents/${data.conversion_id}/content${processorParam}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!mdResp.ok) {
        const err = await mdResp.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to fetch markdown content");
      }

      const markdownData = await mdResp.json();
      const markdownContent = markdownData.markdown_content || "";
      setExtractedTextLocal(markdownContent);

      // If figures weren't in the initial response, try fetching them separately
      if (
        data.figures_found === undefined &&
        data.processor_used === "azure_doc_intelligence"
      ) {
        try {
          const figuresResp = await fetch(
            `/api/documents/${data.conversion_id}/figures`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (figuresResp.ok) {
            const figuresData = await figuresResp.json();
            setFiguresCount(figuresData.figures_count || 0);
            setFigures(figuresData.figures || []);
          }
        } catch (err) {
          console.warn("Could not fetch figures:", err);
        }
      }

      // Persist extracted text in parent state (do not proceed to next step automatically)
      // Parent will be updated when the user clicks "Proceed to Entity Extraction"

      setShowResults(true);
    } catch (err: any) {
      setProcessError(err?.message || String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProceed = () => {
    onComplete({
      parser: selectedParser,
      extractedText: extractedTextLocal,
      annotatedOutput: "", // annotatedOutput can be populated by future parser logic
      conversionId: conversionId ?? undefined,
      markdownPath: markdownPath ?? undefined,
      processorUsed: processorUsed ?? undefined,
      figures: figures,
      figuresCount: figuresCount,
      tablesCount: tablesCount,
      showResults: showResults,
    });
  };

  const handleReprocess = () => {
    setShowResults(false);
    handleProcessPDF();
  };

  const handleDownloadMarkdown = async () => {
    if (!conversionId) return;
    try {
      const resp = await fetch(`/api/documents/${conversionId}/content`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to fetch markdown for download");
      }
      const data = await resp.json();
      const content = data.markdown_content || "";
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${conversionId}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setProcessError(err?.message || String(err));
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
          <h2 className="text-xl">Document Processing</h2>
          <p className="text-muted-foreground">
            Select a parser and process your document
          </p>
        </div>
      </div>

      <div className="grid gap-6">
        {!isAzureDocumentIntelligenceConfigured && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Azure Document Intelligence parser is not available. Configure
              your Azure Document Intelligence API key in Settings to enable
              this parser option.
            </AlertDescription>
          </Alert>
        )}

        <Card className="border-gray-200">
          <CardHeader>
            <CardTitle>Parser Selection</CardTitle>
            <CardDescription>
              Choose the appropriate parser for your document type
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center">
              <div className="max-w-md w-full relative">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Select
                      value={selectedParser}
                      onValueChange={setSelectedParser}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a parser" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableParsers.map((parser) => (
                          <SelectItem key={parser.id} value={parser.id}>
                            <div>
                              <div className="font-medium">{parser.name}</div>
                              <div className="text-sm text-muted-foreground">
                                {parser.description}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Loading indicator (visible while processing). Click to toggle logs popout */}
                  <div>
                    {isProcessing && (
                      <div className="flex items-center space-x-2">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center bg-muted"
                          title="Processing"
                          aria-hidden="true"
                        >
                          <span className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                        <span className="text-sm font-mono">
                          {formatTime(elapsedTime)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={showResults ? handleReprocess : handleProcessPDF}
                disabled={!selectedParser || isProcessing}
                className={`${!selectedParser || isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                aria-disabled={!selectedParser || isProcessing}
              >
                {isProcessing
                  ? "Processing..."
                  : showResults
                    ? "Reprocess Document"
                    : "Process Document"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {showResults && (
          <>
            {/* Display Figures if available */}
            {figures.length > 0 && conversionId && (
              <FigureGallery conversionId={conversionId} figures={figures} />
            )}

            {/* Display Tables if available */}
            {tablesCount > 0 && conversionId && (
              <TablesGallery
                conversionId={conversionId}
                tablesCount={tablesCount}
              />
            )}

            {/* Two Column Layout: PDF Viewer and Raw Output */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Left Column: PDF Viewer with Bounding Boxes */}
              <div>
                {documentData.fileId && (
                  <PDFBoundingBoxViewer
                    fileId={documentData.fileId}
                    conversionId={conversionId}
                    fileName={documentData.file?.name}
                  />
                )}
              </div>

              {/* Right Column: Raw Output */}
              <div>
                <RawOutputViewer
                  conversionId={conversionId}
                  processorUsed={processorUsed}
                />
              </div>
            </div>

            <div className="space-y-3">
              {conversionId && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm text-muted-foreground">
                        Conversion ID
                      </div>
                      <div className="font-mono text-sm break-all">
                        {conversionId}
                      </div>
                      {markdownPath && (
                        <>
                          <div className="text-sm text-muted-foreground mt-2">
                            Saved Markdown Path
                          </div>
                          <div className="font-mono text-sm break-all">
                            {markdownPath}
                          </div>
                        </>
                      )}
                      {figuresCount > 0 && (
                        <>
                          <div className="text-sm text-muted-foreground mt-2">
                            Figures Extracted
                          </div>
                          <div className="text-sm">
                            <span className="font-medium text-green-600">
                              {figuresCount}
                            </span>{" "}
                            figure{figuresCount !== 1 ? "s" : ""} detected and
                            extracted
                          </div>
                        </>
                      )}
                      {tablesCount > 0 && (
                        <>
                          <div className="text-sm text-muted-foreground mt-2">
                            Tables Extracted
                          </div>
                          <div className="text-sm">
                            <span className="font-medium text-blue-600">
                              {tablesCount}
                            </span>{" "}
                            table{tablesCount !== 1 ? "s" : ""} detected and
                            extracted
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadMarkdown}
                      >
                        Download Markdown
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {processError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600">{processError}</p>
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="outline" onClick={handleProceed}>
                  Proceed to Entity Extraction
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
