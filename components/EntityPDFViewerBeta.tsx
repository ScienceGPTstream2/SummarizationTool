import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Checkbox } from "./ui/checkbox";
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - Vite handles ?url imports
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const pdfBlobCache = new Map<string, Blob>();
const analysisCache = new Map<string, any>();

interface Reference {
  text: string;
  best_match?: {
    type: string;
    similarity: number;
    page_number?: number;
    bounding_regions?: Array<{
      page_number: number;
      polygon: number[];
    }>;
    polygon?: number[];
  };
}

interface EntityPDFViewerBetaProps {
  fileId: string;
  conversionId: string | null;
  references: Reference[];
  onPageChange?: (page: number) => void;
  focusedReferenceIndex?: number | null;
}

export function EntityPDFViewerBeta({
  fileId,
  conversionId,
  references,
  onPageChange,
  focusedReferenceIndex,
}: EntityPDFViewerBetaProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fitToWidthScale, setFitToWidthScale] = useState(1.0);
  const [zoomRatio, setZoomRatio] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const navigateToPageRef = useRef<((page: number) => void) | null>(null);
  const [pendingFocusRefIdx, setPendingFocusRefIdx] = useState<number | null>(
    null
  );
  const [currentViewportHeight, setCurrentViewportHeight] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const scrollStartRef = useRef({ left: 0, top: 0 });
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);

  const canPan = zoomRatio > 1.02;

  const clampZoomRatio = (value: number) => Math.min(3, Math.max(0.5, value));

  const handleZoomChange = (delta: number) => {
    setZoomRatio((prev) => Number(clampZoomRatio(prev + delta).toFixed(2)));
  };

  const handleResetZoom = () => setZoomRatio(1);

  // Extract unique page numbers from references
  const referencePages = new Set<number>();
  references.forEach((ref) => {
    if (ref.best_match) {
      const pageNum =
        ref.best_match.page_number ||
        ref.best_match.bounding_regions?.[0]?.page_number;
      if (pageNum) {
        referencePages.add(pageNum);
      }
    }
  });
  const pagesArray = Array.from(referencePages).sort((a, b) => a - b);

  // Set initial page to first reference page if references exist, otherwise stay on page 1
  useEffect(() => {
    if (pagesArray.length > 0 && currentPage === 1 && pdfDocument) {
      const firstPage = pagesArray[0];
      setCurrentPage(firstPage);
      if (onPageChange) {
        onPageChange(firstPage);
      }
    }
  }, [pagesArray.length, pdfDocument]);

  // Expose method to navigate to a specific page
  const navigateToPage = useCallback(
    (page: number) => {
      if (page >= 1 && page <= totalPages) {
        setCurrentPage(page);
        if (onPageChange) {
          onPageChange(page);
        }
      }
    },
    [totalPages, onPageChange]
  );

  navigateToPageRef.current = navigateToPage;

  // Expose navigateToPage via ref for parent component access
  useEffect(() => {
    if (canvasRef.current) {
      (canvasRef.current as any).navigateToPage = navigateToPage;
    }
  }, [navigateToPage]);

  const scrollReferenceIntoView = useCallback(
    (refIdx: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return false;

      const boundingBoxes = (canvas as any).boundingBoxes || [];
      const target = boundingBoxes.find(
        (bbox: any) => bbox.refIdx === refIdx && bbox.pageNumber === currentPage
      );

      if (!target) return false;

      const canvasOffsetTop = canvas.offsetTop;
      const targetCenterY = target.y + target.height / 2 + canvasOffsetTop;
      const scrollTop = Math.max(targetCenterY - container.clientHeight / 2, 0);

      container.scrollTo({
        top: scrollTop,
        behavior: "smooth",
      });

      return true;
    },
    [currentPage]
  );

  useEffect(() => {
    if (
      focusedReferenceIndex === null ||
      focusedReferenceIndex === undefined ||
      !references[focusedReferenceIndex]
    ) {
      return;
    }

    const ref = references[focusedReferenceIndex];
    const targetPage =
      ref.best_match?.page_number ||
      ref.best_match?.bounding_regions?.[0]?.page_number;

    setPendingFocusRefIdx(focusedReferenceIndex);

    if (targetPage && targetPage !== currentPage) {
      navigateToPage(targetPage);
    } else {
      // Already on the right page, try to center immediately
      requestAnimationFrame(() => {
        const success = scrollReferenceIntoView(focusedReferenceIndex);
        if (success) {
          setPendingFocusRefIdx(null);
        }
      });
    }
  }, [
    focusedReferenceIndex,
    references,
    navigateToPage,
    scrollReferenceIntoView,
  ]);

  useEffect(() => {
    if (pendingFocusRefIdx === null) return;

    const success = scrollReferenceIntoView(pendingFocusRefIdx);
    if (success) {
      setPendingFocusRefIdx(null);
    }
  }, [pendingFocusRefIdx, currentPage, scale, scrollReferenceIntoView]);

  // Configure PDF.js worker
  useEffect(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  }, []);

  // Fetch PDF file
  useEffect(() => {
    if (!fileId) {
      console.log("[EntityPDFViewerBeta] No fileId provided");
      setError("No file ID provided");
      setLoading(false);
      return;
    }

    let isCancelled = false;
    let objectUrl: string | null = null;

    const applyBlob = (blob: Blob) => {
      if (isCancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setPdfUrl(objectUrl);
      setLoading(false);
    };

    const fetchPDF = async () => {
      try {
        setLoading(true);
        setError(null);
        const cachedBlob = pdfBlobCache.get(fileId);
        if (cachedBlob) {
          applyBlob(cachedBlob);
          return;
        }

        console.log("[EntityPDFViewerBeta] Fetching PDF with fileId:", fileId);
        const token = localStorage.getItem("token");
        const response = await fetch(`/api/files/${fileId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch PDF file: ${response.status} ${response.statusText}`
          );
        }

        const blob = await response.blob();
        pdfBlobCache.set(fileId, blob);
        console.log(
          "[EntityPDFViewerBeta] PDF blob received, size:",
          blob.size
        );
        applyBlob(blob);
      } catch (err: any) {
        if (isCancelled) return;
        console.error("[EntityPDFViewerBeta] Error fetching PDF:", err);
        setError(err.message || "Failed to load PDF");
        setLoading(false);
      }
    };

    fetchPDF();

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileId]);

  // Fetch analysis result for coordinate system
  useEffect(() => {
    const fetchAnalysis = async () => {
      if (!conversionId) return;

      if (analysisCache.has(conversionId)) {
        setAnalysisResult(analysisCache.get(conversionId));
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

        if (response.ok) {
          const data = await response.json();
          analysisCache.set(conversionId, data.analysis_result);
          setAnalysisResult(data.analysis_result);
        }
      } catch (err) {
        console.error("Error fetching analysis:", err);
      }
    };

    fetchAnalysis();
  }, [conversionId]);

  useEffect(() => {
    setScale(fitToWidthScale * zoomRatio);
  }, [fitToWidthScale, zoomRatio]);

  // Load and render PDF
  useEffect(() => {
    if (!pdfUrl) {
      console.log("[EntityPDFViewerBeta] No pdfUrl, waiting...");
      return;
    }

    const loadPDF = async () => {
      try {
        setLoading(true);
        console.log("[EntityPDFViewerBeta] Loading PDF document...");
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        console.log("[EntityPDFViewerBeta] PDF loaded, pages:", pdf.numPages);
        setPdfDocument(pdf);
        setTotalPages(pdf.numPages);

        // Calculate fit-to-width scale for first page
        if (containerRef.current) {
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 1.0 });
          const containerWidth = containerRef.current.clientWidth - 64; // Account for padding
          const calculatedScale = containerWidth / viewport.width;
          setFitToWidthScale(calculatedScale);
          setZoomRatio(1); // fit-to-width baseline
          console.log(
            "[EntityPDFViewerBeta] Fit-to-width scale:",
            calculatedScale
          );
        }

        setLoading(false);
      } catch (err) {
        console.error("[EntityPDFViewerBeta] Error loading PDF:", err);
        setError("Failed to load PDF document");
        setLoading(false);
      }
    };

    loadPDF();
  }, [pdfUrl]);

  // Update fit-to-width scale when page changes or container resizes
  useEffect(() => {
    const updateFitToWidth = async () => {
      if (!pdfDocument || !containerRef.current) return;

      try {
        const page = await pdfDocument.getPage(currentPage);
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth = containerRef.current.clientWidth - 64; // Account for padding
        const calculatedScale = containerWidth / viewport.width;
        setFitToWidthScale(calculatedScale);
      } catch (err) {
        console.error("Error calculating fit-to-width:", err);
      }
    };

    updateFitToWidth();

    // Also update on window resize
    const handleResize = () => {
      updateFitToWidth();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [pdfDocument, currentPage]);

  // Render current page with bounding boxes
  useEffect(() => {
    let renderTask: any = null;

    const renderPage = async () => {
      if (!pdfDocument || !canvasRef.current) return;

      try {
        const page = await pdfDocument.getPage(currentPage);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");

        if (!context) return;

        if (renderTask) {
          renderTask.cancel();
        }

        // Use device pixel ratio for crisp rendering on high-DPI displays
        const devicePixelRatio = window.devicePixelRatio || 1;

        // Scale the viewport by device pixel ratio for high-DPI rendering
        const scaledViewport = page.getViewport({
          scale: scale * devicePixelRatio,
        });

        // Set CSS display size (logical pixels)
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setCurrentViewportHeight(viewport.height);

        // Set actual canvas size in memory (physical pixels)
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        // Enable high-quality image smoothing for better rendering
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        // Reset transform and scale context to match scaled viewport
        context.setTransform(1, 0, 0, 1, 0, 0);

        const renderContext = {
          canvasContext: context,
          viewport: scaledViewport,
        };

        renderTask = page.render(renderContext);
        await renderTask.promise;

        // Draw bounding boxes AFTER PDF is fully rendered (only if enabled)
        // Small delay ensures canvas is ready
        if (showBoundingBoxes) {
          requestAnimationFrame(() => {
            drawReferenceBoundingBoxes(
              context,
              currentPage,
              viewport.height,
              devicePixelRatio
            );
          });
        }
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.error("Error rendering page:", err);
        }
      }
    };

    renderPage();

    return () => {
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [
    pdfDocument,
    currentPage,
    scale,
    references,
    analysisResult,
    showBoundingBoxes,
  ]);

  const drawReferenceBoundingBoxes = (
    context: CanvasRenderingContext2D,
    pageNum: number,
    viewportHeight: number,
    devicePixelRatio: number = 1
  ) => {
    // Get processor type to determine coordinate system
    const processor = analysisResult?.processor || "azure_doc_intelligence";
    const needsYFlip = processor === "docling";

    // Get actual page height in points from analysis result (for docling Y flip)
    // Fallback to viewport height / scale if page info not available
    const pageInfo = analysisResult?.pages?.find(
      (p: any) => p.page_number === pageNum
    );
    const pageHeightInPoints = pageInfo?.height || viewportHeight / scale;

    // Helper function to convert polygon to canvas coordinates
    // Note: Entity extraction uses raw_analysis (inches for Azure DI), while
    // normalized analysis uses points. We need to detect and convert accordingly.
    // Coordinate system differences:
    // - Azure DI: Top-left origin (matches canvas) - NO flip needed
    // - Docling: Bottom-left origin (PDF standard) - flip Y coordinates
    const polygonToRect = (polygon: number[]) => {
      if (!polygon || polygon.length < 8) return null;

      // Detect if coordinates are in inches (from raw_analysis) vs points (normalized)
      // Entity extraction uses raw_analysis (inches), while normalized analysis uses points
      // Check page dimensions: if page width < 20, it's likely inches; if > 200, it's points
      const pageWidth = pageInfo?.width || analysisResult?.pages?.[0]?.width;
      const isNormalized =
        pageInfo?.unit === "pt" ||
        analysisResult?.pages?.[0]?.unit === "pt" ||
        (pageWidth && pageWidth > 200); // Normalized pages are ~600pt wide

      // Also check coordinate values as fallback
      const maxCoord = Math.max(...polygon);
      const coordsLookLikeInches = maxCoord < 20;

      // Convert inches to points if needed (entity extraction uses raw_analysis)
      const needsInchConversion =
        processor === "azure_doc_intelligence" &&
        (!isNormalized || coordsLookLikeInches);
      const INCHES_TO_POINTS = 72;
      const conversionFactor = needsInchConversion ? INCHES_TO_POINTS : 1;

      // Scale coordinates by both scale and devicePixelRatio to match scaled viewport
      const xCoords = polygon
        .filter((_, i) => i % 2 === 0)
        .map((x) => x * conversionFactor * scale * devicePixelRatio);
      const yCoords = polygon
        .filter((_, i) => i % 2 === 1)
        .map((y) => {
          const yInPoints = y * conversionFactor;
          if (needsYFlip) {
            // For Docling: Y is from bottom-left (PDF standard)
            // Flip: pageHeightInPoints - yInPoints, then scale
            return (pageHeightInPoints - yInPoints) * scale * devicePixelRatio;
          } else {
            // For Azure: Y is from top-left, same as PDF.js canvas
            return yInPoints * scale * devicePixelRatio;
          }
        });

      const x = Math.min(...xCoords);
      const y = Math.min(...yCoords);
      const width = Math.max(...xCoords) - x;
      const height = Math.max(...yCoords) - y;

      return { x, y, width, height };
    };

    // No need for transform since coordinates are already scaled by devicePixelRatio
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);

    const labelStackMap = new Map<string, number>();
    const canvasElement = canvasRef.current;
    // Use actual canvas dimensions since coordinates are in scaled space
    const canvasWidth = canvasElement ? canvasElement.width : undefined;
    const canvasHeight = canvasElement ? canvasElement.height : undefined;

    references.forEach((ref, refIdx) => {
      if (!ref.best_match) return;

      const pageNumber =
        ref.best_match.page_number ||
        ref.best_match.bounding_regions?.[0]?.page_number;

      if (pageNumber !== pageNum) return;

      // Get polygon from bounding_regions or direct polygon
      const polygon =
        ref.best_match.bounding_regions?.[0]?.polygon || ref.best_match.polygon;

      if (!polygon) return;

      const rect = polygonToRect(polygon);
      if (!rect) return;

      const isActive = focusedReferenceIndex === refIdx;

      // Use a distinct color for entity references
      const refColor = `hsl(${(refIdx * 60) % 360}, 70%, 50%)`;
      context.strokeStyle = refColor;
      context.lineWidth = isActive ? 3 : 2;
      context.setLineDash(isActive ? [6, 4] : []);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.setLineDash([]);

      // Draw reference number label with background for readability
      context.font = isActive ? "bold 13px sans-serif" : "bold 12px sans-serif";
      const labelText = `Ref #${refIdx + 1}`;
      const textMetrics = context.measureText(labelText);
      const labelWidth = textMetrics.width + 10;
      const labelHeight = 18;
      const labelKey = `${Math.round(rect.x / 5)}-${Math.round(
        rect.y / 5
      )}-${Math.round(rect.width / 5)}-${Math.round(rect.height / 5)}`;
      const existingStack = labelStackMap.get(labelKey) || 0;
      labelStackMap.set(labelKey, existingStack + 1);

      const margin = 6;
      let labelX = rect.x;
      let labelY = rect.y;
      let placement: "left" | "right" | "top" | "bottom" = "top";

      const canPlaceLeft = rect.x - labelWidth - margin >= 0;
      const canPlaceRight =
        canvasWidth && rect.x + rect.width + labelWidth + margin <= canvasWidth;
      const topY = rect.y - labelHeight - margin;
      const bottomY = rect.y + rect.height + margin;

      if (canPlaceLeft) {
        placement = "left";
        labelX = rect.x - labelWidth - margin;
        labelY = rect.y + existingStack * (labelHeight + 4);
      } else if (canPlaceRight) {
        placement = "right";
        labelX = rect.x + rect.width + margin;
        labelY = rect.y + existingStack * (labelHeight + 4);
      } else if (topY >= 0) {
        placement = "top";
        labelX = rect.x + existingStack * (labelWidth + 6);
        labelY = topY;
        if (canvasWidth && labelX + labelWidth > canvasWidth) {
          labelX = Math.max(0, canvasWidth - labelWidth - margin);
        }
      } else {
        placement = "bottom";
        labelX = rect.x + existingStack * (labelWidth + 6);
        labelY = bottomY;
        if (canvasHeight && labelY + labelHeight > canvasHeight) {
          labelY = Math.max(0, canvasHeight - labelHeight - margin);
        }
        if (canvasWidth && labelX + labelWidth > canvasWidth) {
          labelX = Math.max(0, canvasWidth - labelWidth - margin);
        }
      }

      context.fillStyle = "rgba(255,255,255,0.7)";
      context.strokeStyle = refColor;
      context.lineWidth = 1;
      context.fillRect(labelX, labelY, labelWidth, labelHeight);
      context.strokeRect(labelX, labelY, labelWidth, labelHeight);

      // Connector
      context.beginPath();
      let connectorStartX = labelX + labelWidth / 2;
      let connectorStartY = labelY + labelHeight / 2;
      let connectorEndX = rect.x;
      let connectorEndY = rect.y + rect.height / 2;
      if (placement === "left") {
        connectorStartX = labelX + labelWidth;
        connectorEndX = rect.x;
      } else if (placement === "right") {
        connectorStartX = labelX;
        connectorEndX = rect.x + rect.width;
      } else if (placement === "top") {
        connectorStartY = labelY + labelHeight;
        connectorEndY = rect.y;
      } else {
        connectorStartY = labelY;
        connectorEndY = rect.y + rect.height;
      }
      context.moveTo(connectorStartX, connectorStartY);
      context.lineTo(connectorEndX, connectorEndY);
      context.stroke();

      context.fillStyle = refColor;
      context.fillText(labelText, labelX + 5, labelY + labelHeight - 5);

      // Store rect info for click detection
      (rect as any).refIdx = refIdx;
      (rect as any).pageNumber = pageNumber;
    });
    context.restore();

    // Store click handler info on canvas
    if (canvasRef.current) {
      (canvasRef.current as any).boundingBoxes = references
        .map((ref, refIdx) => {
          const pageNum =
            ref.best_match?.page_number ||
            ref.best_match?.bounding_regions?.[0]?.page_number;
          const polygon =
            ref.best_match?.bounding_regions?.[0]?.polygon ||
            ref.best_match?.polygon;
          if (!polygon) return null;
          const rect = polygonToRect(polygon);
          if (!rect) return null;
          return { ...rect, refIdx, pageNumber: pageNum };
        })
        .filter(Boolean);
    }

    if (pendingFocusRefIdx !== null) {
      const success = scrollReferenceIntoView(pendingFocusRefIdx);
      if (success) {
        setPendingFocusRefIdx(null);
      }
    }
  };

  // Handle clicks on bounding boxes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const boundingBoxes = (canvas as any).boundingBoxes || [];
      for (const bbox of boundingBoxes) {
        if (
          x >= bbox.x &&
          x <= bbox.x + bbox.width &&
          y >= bbox.y &&
          y <= bbox.y + bbox.height &&
          bbox.pageNumber === currentPage
        ) {
          // Clicked on a bounding box - navigate to that page if not already there
          if (bbox.pageNumber && bbox.pageNumber !== currentPage) {
            navigateToPage(bbox.pageNumber);
          }
          break;
        }
      }
    };

    canvas.addEventListener("click", handleClick);
    return () => {
      canvas.removeEventListener("click", handleClick);
    };
  }, [currentPage, references, navigateToPage]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
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

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - panStartRef.current.x;
      const deltaY = e.clientY - panStartRef.current.y;
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

  const canvasContainerHeight =
    currentViewportHeight > 0 ? currentViewportHeight + 80 : 480;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 border rounded-lg bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (!pdfDocument && !loading && !error) {
    return (
      <div className="h-[500px] flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700">
            Preparing PDF viewer...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Page Navigation */}
      <div className="flex items-center justify-between bg-white p-3 rounded-lg border">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium px-3">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCurrentPage(Math.min(totalPages, currentPage + 1))
            }
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {pagesArray.length > 0 && (
            <div className="ml-4 text-xs text-gray-500">
              Reference pages: {pagesArray.join(", ")}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 border rounded-md bg-white whitespace-nowrap">
            <Checkbox
              id="show-bboxes"
              checked={showBoundingBoxes}
              onCheckedChange={(checked) =>
                setShowBoundingBoxes(checked === true)
              }
            />
            <label
              htmlFor="show-bboxes"
              className="text-sm font-medium cursor-pointer select-none"
            >
              Show Bounding Boxes
            </label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleZoomChange(-0.2)}
            disabled={zoomRatio <= 0.5}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm min-w-[60px] text-center">
            {Math.round(zoomRatio * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleZoomChange(0.2)}
            disabled={zoomRatio >= 3}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetZoom}
            title="Reset to fit width (100%)"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Canvas */}
      <div
        className="border-2 rounded-lg bg-gray-50 overflow-auto"
        ref={containerRef}
        style={{ height: canvasContainerHeight }}
      >
        <div className={`p-4 ${canPan ? "" : "flex justify-center"}`}>
          <div
            className={`inline-block min-w-max ${
              canPan
                ? isPanning
                  ? "cursor-grabbing"
                  : "cursor-grab"
                : "cursor-default"
            }`}
            onMouseDown={handleMouseDown}
          >
            <canvas
              ref={canvasRef}
              className="shadow-lg bg-white border border-gray-300 rounded"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
