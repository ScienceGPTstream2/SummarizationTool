import { useState, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";
import {
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Layers,
  AlertCircle,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - Vite handles ?url imports
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getValidToken } from "../utils/authUtils";

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
  processor?: string; // "docling" or "azure_doc_intelligence"
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

type ElementType = "paragraphs" | "tables" | "figures";

const COLOR_MAP: Record<ElementType | string, string> = {
  paragraphs: "rgba(128, 0, 128, 0.3)", // Purple
  tables: "rgba(255, 128, 0, 0.4)", // Orange
  table_cells: "rgba(255, 179, 77, 0.2)", // Light orange
  figures: "rgba(0, 204, 0, 0.4)", // Green
  title: "rgba(204, 0, 0, 0.4)", // Dark red
  section_heading: "rgba(153, 0, 102, 0.4)", // Dark purple
};

const COLOR_BORDER_MAP: Record<ElementType | string, string> = {
  paragraphs: "rgb(128, 0, 128)",
  tables: "rgb(255, 128, 0)",
  table_cells: "rgb(255, 179, 77)",
  figures: "rgb(0, 204, 0)",
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
  const [fitToWidthScale, setFitToWidthScale] = useState(1.0);
  const [zoomRatio, setZoomRatio] = useState(1.0);
  const [isFitWidth, setIsFitWidth] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const scrollStartRef = useRef({ left: 0, top: 0 });
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [visibleElements, setVisibleElements] = useState<Set<ElementType>>(
    new Set(["paragraphs", "tables", "figures"])
  );

  const clampZoomRatio = (value: number) => Math.min(3, Math.max(0.5, value));
  const canPan = zoomRatio > 1.02;

  const handleZoomChange = (delta: number) => {
    setIsFitWidth(false);
    setZoomRatio((prev) => Number(clampZoomRatio(prev + delta).toFixed(2)));
  };

  const handleResetZoom = () => {
    setIsFitWidth(false);
    setZoomRatio(1);
  };

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canPan || !containerRef.current) return;
    setIsPanning(true);
    containerRef.current.classList.add("cursor-grabbing");
    panStartRef.current = { x: e.clientX, y: e.clientY };
    scrollStartRef.current = {
      left: containerRef.current.scrollLeft,
      top: containerRef.current.scrollTop,
    };
    e.preventDefault();
  };

  useEffect(() => {
    if (!isPanning) return;
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - panStartRef.current.x;
      const deltaY = event.clientY - panStartRef.current.y;
      container.scrollLeft = scrollStartRef.current.left - deltaX;
      container.scrollTop = scrollStartRef.current.top - deltaY;
    };

    const handleMouseUp = () => {
      setIsPanning(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPanning]);

  useEffect(() => {
    if (!isPanning && containerRef.current) {
      containerRef.current.classList.remove("cursor-grabbing");
    }
  }, [isPanning]);

  // Configure PDF.js worker
  useEffect(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  }, []);

  // Fetch PDF file
  useEffect(() => {
    const fetchPDF = async () => {
      try {
        const token = await getValidToken();
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
    let isCancelled = false;
    const retryTimeouts: NodeJS.Timeout[] = [];

    const fetchAnalysis = async (retryCount = 0) => {
      if (!conversionId) {
        setLoading(false);
        return;
      }

      // Set loading state on first attempt
      if (retryCount === 0) {
        setLoading(true);
      }

      try {
        const token = await getValidToken();
        const response = await fetch(
          `/api/documents/${conversionId}/analysis`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (isCancelled) return;

        if (!response.ok) {
          // If 404 and we haven't retried too many times, retry after a delay
          // This handles the case where the file is still being saved
          if (response.status === 404 && retryCount < 5) {
            console.log(
              `Analysis not ready yet, retrying in ${(retryCount + 1) * 1000}ms... (attempt ${retryCount + 1}/5)`
            );
            const timeout = setTimeout(
              () => {
                if (!isCancelled) {
                  fetchAnalysis(retryCount + 1);
                }
              },
              (retryCount + 1) * 1000
            ); // Exponential backoff: 1s, 2s, 3s, 4s, 5s
            retryTimeouts.push(timeout);
            return;
          }
          setLoading(false);
          return;
        }

        const data = await response.json();
        if (isCancelled) return;

        setAnalysisResult(data.analysis_result);
        setLoading(false);
      } catch (err: any) {
        if (isCancelled) return;

        // Retry on network errors too
        if (retryCount < 5) {
          console.log(
            `Error fetching analysis, retrying in ${(retryCount + 1) * 1000}ms... (attempt ${retryCount + 1}/5)`,
            err
          );
          const timeout = setTimeout(
            () => {
              if (!isCancelled) {
                fetchAnalysis(retryCount + 1);
              }
            },
            (retryCount + 1) * 1000
          );
          retryTimeouts.push(timeout);
          return;
        }
        console.error("Error fetching analysis after retries:", err);
        setLoading(false);
      }
    };

    fetchAnalysis();

    // Cleanup function to cancel pending retries
    return () => {
      isCancelled = true;
      retryTimeouts.forEach((timeout) => clearTimeout(timeout));
    };
  }, [conversionId]);

  // Load and render PDF
  useEffect(() => {
    const loadPDF = async () => {
      if (!pdfUrl) return;

      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
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

  // Calculate fit-to-width scale and keep baseline updated
  useEffect(() => {
    const calculateFitToWidth = async () => {
      if (!pdfDocument || !containerRef.current) return;

      try {
        const page = await pdfDocument.getPage(currentPage);
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth = containerRef.current.clientWidth - 48; // padding (32px) + buffer
        const calculatedScale = containerWidth / viewport.width;
        setFitToWidthScale(calculatedScale);
        if (isFitWidth) {
          setZoomRatio(1);
        }
      } catch (err) {
        console.error("Error calculating fit to width:", err);
      }
    };

    calculateFitToWidth();

    calculateFitToWidth();

    // Use ResizeObserver for more robust container resizing detection
    const resizeObserver = new ResizeObserver(() => {
      calculateFitToWidth();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [pdfDocument, currentPage, isFitWidth]);

  // Apply zoom ratio to actual scale
  useEffect(() => {
    setScale(fitToWidthScale * zoomRatio);
  }, [fitToWidthScale, zoomRatio]);

  // Render current page with high quality
  useEffect(() => {
    let renderTask: any = null;
    let isCancelled = false;

    const renderPage = async () => {
      if (!pdfDocument || !canvasRef.current) return;

      try {
        const page = await pdfDocument.getPage(currentPage);

        // Check if cancelled after async operation
        if (isCancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");

        if (!context) return;

        // Cancel any ongoing render
        if (renderTask) {
          renderTask.cancel();
        }

        // Use device pixel ratio for sharp rendering on high-DPI displays
        const devicePixelRatio = window.devicePixelRatio || 1;
        const transform =
          devicePixelRatio !== 1
            ? [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0]
            : null;

        // Set display size (css pixels)
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        // Set actual size in memory (scaled for high-DPI)
        // This normally clears the canvas, but we'll be explicit just in case
        canvas.width = viewport.width * devicePixelRatio;
        canvas.height = viewport.height * devicePixelRatio;

        // Explicitly clear canvas
        context.clearRect(0, 0, canvas.width, canvas.height);

        context.setTransform(1, 0, 0, 1, 0, 0);

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          transform: transform || undefined,
        };

        renderTask = page.render(renderContext);
        await renderTask.promise;

        // Draw bounding boxes if enabled and data is ready
        if (showBoundingBoxes && analysisResult && !isCancelled) {
          drawBoundingBoxes(context, currentPage);
        }
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException" && !isCancelled) {
          console.error("Error rendering page:", err);
        }
      }
    };

    renderPage();

    // Cleanup: cancel render on unmount or when dependencies change
    return () => {
      isCancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
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

    // Get processor type to determine coordinate system
    const processor = analysisResult.processor || "unknown";

    // Don't draw if processor is unknown (data not fully loaded yet)
    if (processor === "unknown") return;

    const needsYFlip = processor === "docling"; // Docling uses PDF coordinates (bottom-left origin)

    // Helper function to convert polygon to canvas coordinates
    const polygonToRect = (polygon: number[], pageHeight: number) => {
      if (!polygon || polygon.length < 8) return null;

      // Backend normalizer already converts everything to points
      // Coordinate system differences:
      // - Azure DI: Top-left origin (matches canvas) - NO flip needed
      // - Docling: Bottom-left origin (PDF standard) - flip Y coordinates

      const xCoords = polygon
        .filter((_, i) => i % 2 === 0)
        .map((x) => x * scale);
      const yCoords = polygon
        .filter((_, i) => i % 2 === 1)
        .map((y) => (needsYFlip ? pageHeight - y : y) * scale);

      const x = Math.min(...xCoords);
      const y = Math.min(...yCoords);
      const width = Math.max(...xCoords) - x;
      const height = Math.max(...yCoords) - y;

      return { x, y, width, height };
    };

    const pixelRatio = window.devicePixelRatio || 1;
    context.save();
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    // Get page dimensions
    const pageInfo = analysisResult.pages?.find(
      (p) => p.page_number === pageNum
    );
    const pageHeight = pageInfo?.height || 792; // Default US Letter height in points

    // Draw paragraphs
    if (visibleElements.has("paragraphs") && analysisResult.paragraphs) {
      analysisResult.paragraphs.forEach((para) => {
        para.bounding_regions?.forEach((region) => {
          if (region.page_number === pageNum) {
            const rect = polygonToRect(region.polygon, pageHeight);
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
        table.bounding_regions?.forEach((region) => {
          if (region.page_number === pageNum) {
            const rect = polygonToRect(region.polygon, pageHeight);
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
        figure.bounding_regions?.forEach((region) => {
          if (region.page_number === pageNum) {
            const rect = polygonToRect(region.polygon, pageHeight);
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

    context.restore();
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
            <div className="grid grid-cols-3 gap-3">
              {(["paragraphs", "tables", "figures"] as ElementType[]).map(
                (type) => (
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
                )
              )}
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
              onClick={() => handleZoomChange(-0.2)}
              disabled={zoomRatio <= 0.5}
              title="Zoom Out (-)"
              className="hover:bg-white transition-colors"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm min-w-[65px] text-center font-bold px-3 py-1.5 bg-white rounded-md border border-gray-300 shadow-sm">
              {Math.round(zoomRatio * 100)}%
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleZoomChange(0.2)}
              disabled={zoomRatio >= 3}
              title="Zoom In (+)"
              className="hover:bg-white transition-colors"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <div className="w-px h-6 bg-gray-300 mx-1"></div>
            <Button
              variant={isFitWidth ? "default" : "outline"}
              size="sm"
              onClick={() =>
                setIsFitWidth((prev) => {
                  const next = !prev;
                  if (next) {
                    setZoomRatio(1);
                  }
                  return next;
                })
              }
              title="Fit to Width"
              className="font-medium transition-colors"
            >
              Fit Width
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetZoom}
              title="Reset to 100%"
              className="hover:bg-white transition-colors"
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* PDF Canvas */}
        <div className="relative">
          <div
            className="h-[850px] border-2 rounded-lg bg-gradient-to-b from-gray-50 to-gray-100 overflow-auto"
            ref={containerRef}
          >
            <div
              className={`p-8 min-h-full ${canPan ? "" : "flex justify-center items-start"
                }`}
            >
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
                <div
                  className={`inline-block min-w-max ${canPan
                      ? isPanning
                        ? "cursor-grabbing"
                        : "cursor-grab"
                      : "cursor-default"
                    }`}
                  onMouseDown={handleMouseDown}
                >
                  <canvas
                    ref={canvasRef}
                    className="shadow-2xl bg-white border-2 border-gray-300 rounded-md transition-all duration-200"
                  />
                </div>
              )}
            </div>
          </div>
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
