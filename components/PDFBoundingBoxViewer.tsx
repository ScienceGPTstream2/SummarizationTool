import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Alert, AlertDescription } from "./ui/alert";
import {
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Layers,
  AlertCircle,
} from "lucide-react";

interface PDFBoundingBoxViewerProps {
  fileId: string;
  conversionId: string | null;
  fileName?: string;
}

interface BoundingRegion {
  page_number: number;
  polygon: number[];
}

interface AnalysisResult {
  pages?: Array<{
    page_number: number;
    width: number;
    height: number;
    unit: string;
    angle: number;
    words?: Array<{
      content: string;
      polygon: number[];
      confidence: number;
    }>;
    lines?: Array<{
      content: string;
      polygon: number[];
    }>;
    selection_marks?: Array<{
      state: string;
      polygon: number[];
    }>;
  }>;
  paragraphs?: Array<{
    content: string;
    role?: string;
    bounding_regions: BoundingRegion[];
  }>;
  tables?: Array<{
    row_count: number;
    column_count: number;
    bounding_regions: BoundingRegion[];
    cells?: Array<{
      row_index: number;
      column_index: number;
      content: string;
      bounding_regions: BoundingRegion[];
    }>;
  }>;
  figures?: Array<{
    id: string;
    bounding_regions: BoundingRegion[];
    caption?: {
      content: string;
    };
  }>;
}

type ElementType =
  | "words"
  | "lines"
  | "paragraphs"
  | "tables"
  | "figures"
  | "selection_marks";

const COLOR_MAP: Record<ElementType | string, string> = {
  words: "rgba(51, 153, 255, 0.3)", // Light blue
  lines: "rgba(0, 128, 204, 0.3)", // Blue
  paragraphs: "rgba(128, 0, 128, 0.3)", // Purple
  tables: "rgba(255, 128, 0, 0.4)", // Orange
  table_cells: "rgba(255, 179, 77, 0.2)", // Light orange
  figures: "rgba(0, 204, 0, 0.4)", // Green
  selection_marks: "rgba(255, 0, 0, 0.4)", // Red
  title: "rgba(204, 0, 0, 0.4)", // Dark red
  section_heading: "rgba(153, 0, 102, 0.4)", // Dark purple
};

const COLOR_BORDER_MAP: Record<ElementType | string, string> = {
  words: "rgb(51, 153, 255)",
  lines: "rgb(0, 128, 204)",
  paragraphs: "rgb(128, 0, 128)",
  tables: "rgb(255, 128, 0)",
  table_cells: "rgb(255, 179, 77)",
  figures: "rgb(0, 204, 0)",
  selection_marks: "rgb(255, 0, 0)",
  title: "rgb(204, 0, 0)",
  section_heading: "rgb(153, 0, 102)",
};

export function PDFBoundingBoxViewer({
  fileId,
  conversionId,
  fileName,
}: PDFBoundingBoxViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(
    null
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fitToWidth, setFitToWidth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [visibleElements, setVisibleElements] = useState<Set<ElementType>>(
    new Set(["paragraphs", "tables", "figures"])
  );

  // Load PDF.js dynamically
  useEffect(() => {
    const loadPDFJS = async () => {
      try {
        // @ts-ignore
        if (!window.pdfjsLib) {
          const script = document.createElement("script");
          script.src =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.async = true;
          document.body.appendChild(script);

          await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
          });

          // @ts-ignore
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
      } catch (err) {
        console.error("Failed to load PDF.js:", err);
        setError("Failed to load PDF viewer library");
      }
    };

    loadPDFJS();
  }, []);

  // Fetch PDF file
  useEffect(() => {
    const fetchPDF = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await fetch(`/api/files/${fileId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error("Failed to fetch PDF file");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch (err: any) {
        console.error("Error fetching PDF:", err);
        setError(err.message || "Failed to load PDF");
      }
    };

    if (fileId) {
      fetchPDF();
    }

    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [fileId]);

  // Fetch analysis result with bounding boxes
  useEffect(() => {
    const fetchAnalysis = async () => {
      if (!conversionId) {
        setLoading(false);
        return;
      }

      try {
        const token = localStorage.getItem("token");
        const response = await fetch(
          `/api/documents/${conversionId}/analysis`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (!response.ok) {
          console.warn(
            "Analysis result not available (may not be processed with Azure Document Intelligence)"
          );
          setLoading(false);
          return;
        }

        const data = await response.json();
        setAnalysisResult(data.analysis_result);
        setLoading(false);
      } catch (err: any) {
        console.error("Error fetching analysis:", err);
        setLoading(false);
      }
    };

    fetchAnalysis();
  }, [conversionId]);

  // Load and render PDF
  useEffect(() => {
    const loadPDF = async () => {
      // @ts-ignore
      if (!pdfUrl || !window.pdfjsLib) return;

      try {
        // @ts-ignore
        const loadingTask = window.pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        setPdfDocument(pdf);
        setTotalPages(pdf.numPages);
      } catch (err) {
        console.error("Error loading PDF:", err);
        setError("Failed to load PDF document");
      }
    };

    loadPDF();
  }, [pdfUrl]);

  // Calculate fit-to-width scale
  useEffect(() => {
    const calculateFitToWidth = async () => {
      if (!pdfDocument || !containerRef.current || !fitToWidth) return;

      try {
        const page = await pdfDocument.getPage(currentPage);
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth = containerRef.current.clientWidth - 64; // Subtract padding
        const calculatedScale = containerWidth / viewport.width;
        setScale(calculatedScale);
      } catch (err) {
        console.error("Error calculating fit to width:", err);
      }
    };

    calculateFitToWidth();
  }, [pdfDocument, currentPage, fitToWidth]);

  // Render current page with high quality
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDocument || !canvasRef.current) return;

      try {
        const page = await pdfDocument.getPage(currentPage);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");

        if (!context) return;

        // Use device pixel ratio for sharp rendering on high-DPI displays
        const devicePixelRatio = window.devicePixelRatio || 1;

        // Set display size (css pixels)
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        // Set actual size in memory (scaled for high-DPI)
        canvas.width = viewport.width * devicePixelRatio;
        canvas.height = viewport.height * devicePixelRatio;

        // Scale the context to match device pixel ratio
        context.scale(devicePixelRatio, devicePixelRatio);

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        await page.render(renderContext).promise;

        // Draw bounding boxes if enabled
        if (showBoundingBoxes && analysisResult) {
          drawBoundingBoxes(context, currentPage);
        }
      } catch (err) {
        console.error("Error rendering page:", err);
      }
    };

    renderPage();
  }, [
    pdfDocument,
    currentPage,
    scale,
    showBoundingBoxes,
    analysisResult,
    visibleElements,
  ]);

  const drawBoundingBoxes = (
    context: CanvasRenderingContext2D,
    pageNum: number
  ) => {
    if (!analysisResult) return;

    const dpi = 72; // PDF standard DPI

    // Helper function to convert polygon to canvas coordinates
    const polygonToRect = (polygon: number[]) => {
      if (!polygon || polygon.length < 8) return null;

      // Polygon is in inches for PDF, convert to points (multiply by 72)
      const xCoords = polygon
        .filter((_, i) => i % 2 === 0)
        .map((x) => x * dpi * scale);
      const yCoords = polygon
        .filter((_, i) => i % 2 === 1)
        .map((y) => y * dpi * scale);

      const x = Math.min(...xCoords);
      const y = Math.min(...yCoords);
      const width = Math.max(...xCoords) - x;
      const height = Math.max(...yCoords) - y;

      return { x, y, width, height };
    };

    // Draw paragraphs
    if (visibleElements.has("paragraphs") && analysisResult.paragraphs) {
      analysisResult.paragraphs.forEach((para) => {
        para.bounding_regions.forEach((region) => {
          if (region.page_number === pageNum) {
            const rect = polygonToRect(region.polygon);
            if (rect) {
              const colorKey = para.role || "paragraphs";
              context.strokeStyle =
                COLOR_BORDER_MAP[colorKey] || COLOR_BORDER_MAP.paragraphs;
              context.fillStyle = COLOR_MAP[colorKey] || COLOR_MAP.paragraphs;
              context.lineWidth = 2;
              context.fillRect(rect.x, rect.y, rect.width, rect.height);
              context.strokeRect(rect.x, rect.y, rect.width, rect.height);

              // Draw label for special roles
              if (para.role) {
                context.fillStyle =
                  COLOR_BORDER_MAP[colorKey] || COLOR_BORDER_MAP.paragraphs;
                context.font = "12px sans-serif";
                context.fillText(para.role, rect.x + 2, rect.y - 4);
              }
            }
          }
        });
      });
    }

    // Draw tables
    if (visibleElements.has("tables") && analysisResult.tables) {
      analysisResult.tables.forEach((table, idx) => {
        table.bounding_regions.forEach((region) => {
          if (region.page_number === pageNum) {
            const rect = polygonToRect(region.polygon);
            if (rect) {
              context.strokeStyle = COLOR_BORDER_MAP.tables;
              context.fillStyle = COLOR_MAP.tables;
              context.lineWidth = 3;
              context.fillRect(rect.x, rect.y, rect.width, rect.height);
              context.strokeRect(rect.x, rect.y, rect.width, rect.height);

              // Draw label
              context.fillStyle = COLOR_BORDER_MAP.tables;
              context.font = "bold 14px sans-serif";
              context.fillText(`Table ${idx + 1}`, rect.x + 4, rect.y + 18);
            }
          }
        });
      });
    }

    // Draw figures
    if (visibleElements.has("figures") && analysisResult.figures) {
      analysisResult.figures.forEach((figure) => {
        figure.bounding_regions.forEach((region) => {
          if (region.page_number === pageNum) {
            const rect = polygonToRect(region.polygon);
            if (rect) {
              context.strokeStyle = COLOR_BORDER_MAP.figures;
              context.fillStyle = COLOR_MAP.figures;
              context.lineWidth = 3;
              context.fillRect(rect.x, rect.y, rect.width, rect.height);
              context.strokeRect(rect.x, rect.y, rect.width, rect.height);

              // Draw label
              context.fillStyle = COLOR_BORDER_MAP.figures;
              context.font = "bold 14px sans-serif";
              context.fillText(`Fig ${figure.id}`, rect.x + 4, rect.y + 18);
            }
          }
        });
      });
    }

    // Draw words
    if (visibleElements.has("words") && analysisResult.pages) {
      const pageData = analysisResult.pages.find(
        (p) => p.page_number === pageNum
      );
      if (pageData?.words) {
        pageData.words.forEach((word) => {
          const rect = polygonToRect(word.polygon);
          if (rect) {
            context.strokeStyle = COLOR_BORDER_MAP.words;
            context.fillStyle = COLOR_MAP.words;
            context.lineWidth = 1;
            context.fillRect(rect.x, rect.y, rect.width, rect.height);
            context.strokeRect(rect.x, rect.y, rect.width, rect.height);
          }
        });
      }
    }

    // Draw lines
    if (visibleElements.has("lines") && analysisResult.pages) {
      const pageData = analysisResult.pages.find(
        (p) => p.page_number === pageNum
      );
      if (pageData?.lines) {
        pageData.lines.forEach((line) => {
          const rect = polygonToRect(line.polygon);
          if (rect) {
            context.strokeStyle = COLOR_BORDER_MAP.lines;
            context.fillStyle = COLOR_MAP.lines;
            context.lineWidth = 1.5;
            context.fillRect(rect.x, rect.y, rect.width, rect.height);
            context.strokeRect(rect.x, rect.y, rect.width, rect.height);
          }
        });
      }
    }

    // Draw selection marks
    if (visibleElements.has("selection_marks") && analysisResult.pages) {
      const pageData = analysisResult.pages.find(
        (p) => p.page_number === pageNum
      );
      if (pageData?.selection_marks) {
        pageData.selection_marks.forEach((mark) => {
          const rect = polygonToRect(mark.polygon);
          if (rect) {
            context.strokeStyle = COLOR_BORDER_MAP.selection_marks;
            context.fillStyle = COLOR_MAP.selection_marks;
            context.lineWidth = 2;
            context.fillRect(rect.x, rect.y, rect.width, rect.height);
            context.strokeRect(rect.x, rect.y, rect.width, rect.height);

            // Draw checkmark or X
            context.fillStyle = COLOR_BORDER_MAP.selection_marks;
            context.font = "bold 16px sans-serif";
            const symbol = mark.state === "selected" ? "☑" : "☐";
            context.fillText(symbol, rect.x + 2, rect.y + rect.height - 2);
          }
        });
      }
    }
  };

  const toggleElement = (element: ElementType) => {
    const newSet = new Set(visibleElements);
    if (newSet.has(element)) {
      newSet.delete(element);
    } else {
      newSet.add(element);
    }
    setVisibleElements(newSet);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return; // Don't interfere with text input
      }

      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentPage((prev) => Math.max(1, prev - 1));
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        setCurrentPage((prev) => Math.min(totalPages, prev + 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentPage(1);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentPage(totalPages);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [totalPages]);

  if (error) {
    return (
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Error Loading PDF
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader className="bg-gradient-to-r from-gray-50 to-white border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-blue-600" />
            <span className="font-bold">Document Analysis Viewer</span>
            {analysisResult && (
              <span className="flex items-center gap-1 text-xs font-normal text-green-700 bg-green-50 px-2 py-1 rounded-full border border-green-200">
                <Layers className="h-3 w-3" />
                Analysis Available
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-gray-200">
            <Checkbox
              id="showBboxes"
              checked={showBoundingBoxes}
              onCheckedChange={(checked) =>
                setShowBoundingBoxes(checked as boolean)
              }
              disabled={!analysisResult}
            />
            <Label
              htmlFor="showBboxes"
              className="text-sm font-medium cursor-pointer"
            >
              Show Bounding Boxes
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        {!analysisResult && !loading && (
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-800">
              💡 Bounding box visualization is only available for documents
              processed with Azure Document Intelligence.
            </AlertDescription>
          </Alert>
        )}

        {/* Element Type Filters */}
        {analysisResult && showBoundingBoxes && (
          <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg p-4 border border-gray-200">
            <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Display Elements:
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {(
                [
                  "paragraphs",
                  "tables",
                  "figures",
                  "lines",
                  "words",
                  "selection_marks",
                ] as ElementType[]
              ).map((type) => (
                <div
                  key={type}
                  className="flex items-center gap-2 bg-white px-3 py-2 rounded-md border border-gray-200 hover:border-gray-300 transition-colors"
                >
                  <Checkbox
                    id={`show-${type}`}
                    checked={visibleElements.has(type)}
                    onCheckedChange={() => toggleElement(type)}
                  />
                  <Label
                    htmlFor={`show-${type}`}
                    className="text-xs font-medium capitalize cursor-pointer flex items-center gap-1.5"
                  >
                    <span
                      className="inline-block w-3 h-3 rounded border-2"
                      style={{
                        backgroundColor: COLOR_MAP[type],
                        borderColor: COLOR_BORDER_MAP[type],
                      }}
                    />
                    {type.replace("_", " ")}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PDF Viewer Controls */}
        <div className="flex items-center justify-between gap-4 bg-white p-4 rounded-lg border-2 border-gray-200 shadow-sm">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="font-medium hover:bg-blue-50 transition-colors"
              title="Previous Page (← or PgUp)"
            >
              Previous
            </Button>
            <div className="flex items-center gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2 rounded-md border border-blue-200">
              <span className="text-sm font-bold text-gray-700">
                Page {currentPage} of {totalPages}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage(Math.min(totalPages, currentPage + 1))
              }
              disabled={currentPage === totalPages}
              className="font-medium hover:bg-blue-50 transition-colors"
              title="Next Page (→ or PgDn)"
            >
              Next
            </Button>
          </div>

          <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-md border border-gray-200">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFitToWidth(false);
                setScale(Math.max(0.5, scale - 0.2));
              }}
              disabled={scale <= 0.5}
              title="Zoom Out (-)"
              className="hover:bg-white transition-colors"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm min-w-[65px] text-center font-bold px-3 py-1.5 bg-white rounded-md border border-gray-300 shadow-sm">
              {Math.round(scale * 100)}%
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFitToWidth(false);
                setScale(Math.min(3, scale + 0.2));
              }}
              disabled={scale >= 3}
              title="Zoom In (+)"
              className="hover:bg-white transition-colors"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <div className="w-px h-6 bg-gray-300 mx-1"></div>
            <Button
              variant={fitToWidth ? "default" : "outline"}
              size="sm"
              onClick={() => setFitToWidth(!fitToWidth)}
              title="Fit to Width"
              className="font-medium transition-colors"
            >
              Fit Width
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFitToWidth(false);
                setScale(1.0);
              }}
              title="Reset to 100%"
              className="hover:bg-white transition-colors"
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* PDF Canvas */}
        <div className="relative">
          <ScrollArea
            className="h-[850px] border-2 rounded-lg bg-gradient-to-b from-gray-50 to-gray-100"
            ref={containerRef}
          >
            <div className="flex justify-center items-start p-8 min-h-full">
              {loading ? (
                <div className="flex items-center justify-center h-96">
                  <div className="text-center">
                    <div className="w-10 h-10 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-700">
                      Loading PDF...
                    </p>
                  </div>
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  className="shadow-2xl bg-white border-2 border-gray-300 rounded-md transition-all duration-200"
                  style={{
                    maxWidth: "100%",
                    height: "auto",
                  }}
                />
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex items-center justify-between gap-4">
          {fileName && (
            <div className="text-xs text-gray-500 font-medium px-4 py-2 bg-gray-50 rounded-md border border-gray-200 flex items-center gap-2">
              <FileText className="h-3 w-3" />
              {fileName}
            </div>
          )}
          <div className="text-xs text-gray-400 font-medium px-4 py-2 bg-gray-50 rounded-md border border-gray-200 flex items-center gap-3">
            <span>⌨️ Keyboard:</span>
            <span className="font-mono bg-white px-2 py-0.5 rounded border border-gray-300">
              ←→
            </span>
            <span>Navigate</span>
            <span className="font-mono bg-white px-2 py-0.5 rounded border border-gray-300">
              Home/End
            </span>
            <span>First/Last</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
