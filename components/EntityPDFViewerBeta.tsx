import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import { getValidToken } from "../utils/authUtils";
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

const analysisCache = new Map<string, any>();
// Cache for resolved PDF documents (not promises) - shared across all instances
// Export so EntityExtractionPage can pre-populate it
export const pdfDocumentCache = new Map<string, any>();
// Cache for loading promises to prevent duplicate fetches
const pdfLoadingPromiseCache = new Map<string, Promise<any>>();
// Loading queue to stagger multiple simultaneous loads
let activeLoads = 0;
const MAX_CONCURRENT_LOADS = 2;
const loadQueue: Array<() => void> = [];

// Helper to manage loading queue
const processLoadQueue = () => {
  while (activeLoads < MAX_CONCURRENT_LOADS && loadQueue.length > 0) {
    const nextLoad = loadQueue.shift();
    if (nextLoad) {
      activeLoads++;
      nextLoad();
    }
  }
};

const queueLoad = (loadFn: () => Promise<void>): Promise<void> => {
  return new Promise((resolve) => {
    const wrappedLoad = async () => {
      try {
        await loadFn();
      } finally {
        activeLoads--;
        processLoadQueue();
        resolve();
      }
    };

    if (activeLoads < MAX_CONCURRENT_LOADS) {
      activeLoads++;
      wrappedLoad();
    } else {
      loadQueue.push(wrappedLoad);
    }
  });
};

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

function EntityPDFViewerBetaComponent({
  fileId,
  conversionId,
  references,
  onPageChange,
  focusedReferenceIndex,
}: EntityPDFViewerBetaProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fitToWidthScale, setFitToWidthScale] = useState(1.0);
  const [zoomRatio, setZoomRatio] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const navigateToPageRef = useRef<((page: number) => void) | null>(null);
  const [pendingFocusRefIdx, setPendingFocusRefIdx] = useState<number | null>(
    null
  );

  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const scrollStartRef = useRef({ left: 0, top: 0 });
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const viewerContainerRef = useRef<HTMLDivElement>(null);

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

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (!viewerContainerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            // Once visible, we can stop observing
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: "100px", // Start loading slightly before visible
        threshold: 0.01,
      }
    );

    observer.observe(viewerContainerRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Fetch analysis result for coordinate system
  useEffect(() => {
    const fetchAnalysis = async () => {
      if (!conversionId) return;

      if (analysisCache.has(conversionId)) {
        setAnalysisResult(analysisCache.get(conversionId));
        return;
      }

      try {
        const token = await getValidToken();
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

  // Load and render PDF (only when visible)
  useEffect(() => {
    if (!fileId || !isVisible) {
      if (!fileId) {
        console.log("[EntityPDFViewerBeta] No fileId, waiting...");
      } else if (!isVisible) {
        console.log("[EntityPDFViewerBeta] Not visible yet, deferring load...");
      }
      return;
    }

    let isCancelled = false;

    const loadPDF = async () => {
      try {
        // Check if we already have the resolved document in cache
        const cachedDoc = pdfDocumentCache.get(fileId);
        if (cachedDoc) {
          console.log("[EntityPDFViewerBeta] Using cached PDF document");
          if (!isCancelled) {
            setPdfDocument(cachedDoc);
            setTotalPages(cachedDoc.numPages);
            setLoading(false);

            // Calculate fit-to-width scale for first page
            if (containerRef.current) {
              try {
                const page = await cachedDoc.getPage(1);
                if (isCancelled) return;

                const viewport = page.getViewport({ scale: 1.0 });
                const containerWidth = containerRef.current.clientWidth - 48;
                const calculatedScale = containerWidth / viewport.width;
                setFitToWidthScale(calculatedScale);
                setZoomRatio(1);
              } catch (e) {
                console.error("Error calculating fit-to-width:", e);
              }
            }
          }
          return;
        }

        // If not in cache, queue the load to prevent thundering herd
        await queueLoad(async () => {
          // Double check cache in case another instance loaded it while we were queued
          const recheck = pdfDocumentCache.get(fileId);
          if (recheck) {
            if (!isCancelled) {
              setPdfDocument(recheck);
              setTotalPages(recheck.numPages);
              setLoading(false);
            }
            return;
          }

          setLoading(true);
          console.log("[EntityPDFViewerBeta] Loading PDF document...");

          // Check if there's already a loading promise
          let loadingTaskPromise = pdfLoadingPromiseCache.get(fileId);

          if (!loadingTaskPromise) {
            const token = await getValidToken();
            const loadingTask = pdfjsLib.getDocument({
              url: `/api/files/${fileId}`,
              httpHeaders: { Authorization: `Bearer ${token}` },
              disableAutoFetch: false,
              disableStream: false,
              rangeChunkSize: 65536, // 64KB chunks for faster initial render
            });

            loadingTask.onProgress = (progressData: {
              loaded: number;
              total: number;
            }) => {
              if (progressData.total > 0) {
                const percent = Math.round(
                  (progressData.loaded / progressData.total) * 100
                );
                setLoadingProgress(percent);
              }
            };

            loadingTaskPromise = loadingTask.promise;
            pdfLoadingPromiseCache.set(fileId, loadingTaskPromise);
          }

          // Add a timeout to prevent infinite loading
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("PDF loading timed out")), 15000)
          );

          // Race between loading and timeout
          const pdf = (await Promise.race([
            loadingTaskPromise,
            timeoutPromise,
          ])) as any;

          if (isCancelled) return;

          console.log("[EntityPDFViewerBeta] PDF loaded, pages:", pdf.numPages);

          // Cache the resolved document
          pdfDocumentCache.set(fileId, pdf);
          // Clean up the promise cache
          pdfLoadingPromiseCache.delete(fileId);

          setPdfDocument(pdf);
          setTotalPages(pdf.numPages);

          // Calculate fit-to-width scale for first page
          if (containerRef.current) {
            try {
              const page = await pdf.getPage(1);
              if (isCancelled) return;

              const viewport = page.getViewport({ scale: 1.0 });
              const containerWidth = containerRef.current.clientWidth - 48; // Account for padding (32px) + buffer
              const calculatedScale = containerWidth / viewport.width;
              setFitToWidthScale(calculatedScale);
              setZoomRatio(1); // fit-to-width baseline
              console.log(
                "[EntityPDFViewerBeta] Fit-to-width scale:",
                calculatedScale
              );
            } catch (e) {
              console.error("Error calculating fit-to-width:", e);
              // Non-fatal error, continue
            }
          }

          setLoading(false);
        });
      } catch (err: any) {
        if (isCancelled) return;
        console.error("[EntityPDFViewerBeta] Error loading PDF:", err);
        setError(`Failed to load PDF document: ${err.message}`);
        setLoading(false);
        // Remove from cache if failed so we can try again
        pdfDocumentCache.delete(fileId);
        pdfLoadingPromiseCache.delete(fileId);
      }
    };

    loadPDF();

    return () => {
      isCancelled = true;
      // Note: We don't cleanup the pdfDocument here as it's shared across instances
    };
  }, [fileId, isVisible]);

  // Update fit-to-width scale when page changes or container resizes
  useEffect(() => {
    const updateFitToWidth = async () => {
      if (!pdfDocument || !containerRef.current) return;

      try {
        const page = await pdfDocument.getPage(currentPage);
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth = containerRef.current.clientWidth - 48; // Account for padding (32px) + buffer
        const calculatedScale = containerWidth / viewport.width;
        setFitToWidthScale(calculatedScale);
      } catch (err) {
        console.error("Error calculating fit-to-width:", err);
      }
    };

    updateFitToWidth();

    updateFitToWidth();

    // Use ResizeObserver for more robust container resizing detection
    const resizeObserver = new ResizeObserver(() => {
      updateFitToWidth();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [pdfDocument, currentPage]);

  // Render current page with bounding boxes
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

        // Set actual canvas size in memory (physical pixels)
        // This normally clears the canvas, but we'll be explicit just in case
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        // Enable high-quality image smoothing for better rendering
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        // Explicitly clear canvas
        context.clearRect(0, 0, canvas.width, canvas.height);

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
        if (showBoundingBoxes && !isCancelled) {
          requestAnimationFrame(() => {
            if (!isCancelled) {
              drawReferenceBoundingBoxes(
                context,
                currentPage,
                viewport.height,
                devicePixelRatio
              );

              // Try to scroll to pending reference now that boxes are drawn
              if (pendingFocusRefIdx !== null) {
                const success = scrollReferenceIntoView(pendingFocusRefIdx);
                if (success) {
                  setPendingFocusRefIdx(null);
                }
              }
            }
          });
        }
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException" && !isCancelled) {
          console.error("Error rendering page:", err);
        }
      }
    };

    renderPage();

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

  // Show placeholder loading until visible
  if (!isVisible) {
    return (
      <div
        ref={viewerContainerRef}
        className="flex flex-col h-full border rounded-md overflow-hidden bg-white"
      >
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-sm text-gray-400">Loading PDF viewer...</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewerContainerRef}
      className="flex flex-col h-full border rounded-md overflow-hidden bg-white"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-gray-50">
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">
            Page {currentPage} of {totalPages || "--"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleZoomChange(-0.1)}
            disabled={loading}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm w-12 text-center">
            {Math.round(zoomRatio * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleZoomChange(0.1)}
            disabled={loading}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetZoom}
            disabled={loading}
            title="Reset Zoom"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <div className="h-4 w-px bg-gray-300 mx-2" />
          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-bbx"
              checked={showBoundingBoxes}
              onCheckedChange={(checked) =>
                setShowBoundingBoxes(checked as boolean)
              }
            />
            <label
              htmlFor="show-bbx"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Show Boxes
            </label>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-auto bg-gray-100"
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-50 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="relative h-12 w-12">
                <div className="absolute inset-0 rounded-full border-4 border-gray-200"></div>
                <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
              </div>
              <div className="text-sm font-medium text-gray-600">
                Loading PDF...{" "}
                {loadingProgress > 0 ? `${loadingProgress}%` : ""}
              </div>
              {loadingProgress > 0 && (
                <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300 ease-out"
                    style={{ width: `${loadingProgress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        {error && (
          <div className="absolute top-4 left-4 right-4 z-20">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

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
  );
}

export const EntityPDFViewerBeta = memo(EntityPDFViewerBetaComponent);
