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
const analysisLoadingPromiseCache = new Map<string, Promise<any>>();
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

const queueLoad = <T,>(loadFn: () => Promise<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    const wrappedLoad = async () => {
      try {
        resolve(await loadFn());
      } catch (error) {
        reject(error);
      } finally {
        activeLoads--;
        processLoadQueue();
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

const DEFAULT_PDF_LOAD_TIMEOUT_MS = 45000;
const DEFAULT_ANALYSIS_LOAD_TIMEOUT_MS = 15000;
const FIT_TO_WIDTH_EPSILON = 0.001;

const waitForTimedPromise = async <T,>(
  loadingTaskPromise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  );

  return Promise.race([loadingTaskPromise, timeoutPromise]) as Promise<T>;
};

const waitForPdfPromise = async (
  loadingTaskPromise: Promise<any>,
  timeoutMs: number
) => {
  return waitForTimedPromise(
    loadingTaskPromise,
    timeoutMs,
    "PDF loading timed out"
  );
};

export async function loadPdfDocument(
  fileId: string,
  options: {
    onProgress?: (progressData: { loaded: number; total: number }) => void;
    timeoutMs?: number;
  } = {}
) {
  const { onProgress, timeoutMs = DEFAULT_PDF_LOAD_TIMEOUT_MS } = options;

  const cachedDoc = pdfDocumentCache.get(fileId);
  if (cachedDoc) {
    return cachedDoc;
  }

  const existingPromise = pdfLoadingPromiseCache.get(fileId);
  if (existingPromise) {
    return waitForPdfPromise(existingPromise, timeoutMs);
  }

  return queueLoad(async () => {
    const recheck = pdfDocumentCache.get(fileId);
    if (recheck) {
      return recheck;
    }

    const queuedPromise = pdfLoadingPromiseCache.get(fileId);
    if (queuedPromise) {
      return waitForPdfPromise(queuedPromise, timeoutMs);
    }

    const token = await getValidToken();
    const loadingTask = pdfjsLib.getDocument({
      url: `/api/files/${fileId}`,
      httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
      disableAutoFetch: false,
      disableStream: false,
      rangeChunkSize: 65536,
    });

    if (onProgress) {
      loadingTask.onProgress = onProgress;
    }

    const loadingTaskPromise = loadingTask.promise;
    pdfLoadingPromiseCache.set(fileId, loadingTaskPromise);

    try {
      const pdf = await waitForPdfPromise(loadingTaskPromise, timeoutMs);
      pdfDocumentCache.set(fileId, pdf);
      return pdf;
    } catch (error) {
      pdfDocumentCache.delete(fileId);
      throw error;
    } finally {
      pdfLoadingPromiseCache.delete(fileId);
    }
  });
}

export async function loadDocumentAnalysis(
  conversionId: string,
  options: {
    timeoutMs?: number;
  } = {}
) {
  const { timeoutMs = DEFAULT_ANALYSIS_LOAD_TIMEOUT_MS } = options;

  const cachedAnalysis = analysisCache.get(conversionId);
  if (cachedAnalysis) {
    return cachedAnalysis;
  }

  const existingPromise = analysisLoadingPromiseCache.get(conversionId);
  if (existingPromise) {
    return waitForTimedPromise(
      existingPromise,
      timeoutMs,
      "Analysis loading timed out"
    );
  }

  const loadingPromise = (async () => {
    const token = await getValidToken();
    const response = await fetch(`/api/documents/${conversionId}/analysis`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (!response.ok) {
      const error: Error & { status?: number } = new Error(
        `Analysis request failed: ${response.status}`
      );
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    analysisCache.set(conversionId, data.analysis_result);
    return data.analysis_result;
  })();

  analysisLoadingPromiseCache.set(conversionId, loadingPromise);

  try {
    return await waitForTimedPromise(
      loadingPromise,
      timeoutMs,
      "Analysis loading timed out"
    );
  } catch (error) {
    analysisCache.delete(conversionId);
    throw error;
  } finally {
    analysisLoadingPromiseCache.delete(conversionId);
  }
}

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
    figure_id?: string;
    has_figure_reference?: boolean;
  };
  paragraph_matches?: Array<{
    page_number?: number | string;
    bounding_regions?: Array<{
      page_number?: number | string;
      pageNumber?: number | string;
      polygon?: number[];
    }>;
  }>;
  line_matches?: Array<{
    page_number?: number | string;
    polygon?: number[];
  }>;
}

interface EntityPDFViewerBetaProps {
  fileId: string;
  conversionId: string | null;
  processorUsed?: string;
  references: Reference[];
  onPageChange?: (page: number) => void;
  focusedReferenceIndex?: number | null;
  focusedReferenceTrigger?: number;
  figures?: Array<{
    id: string;
    page: number | null;
    caption: string | null;
    bounding_regions?: Array<{
      page_number: number;
      polygon: number[];
    }>;
  }>;
}

function EntityPDFViewerBetaComponent({
  fileId,
  conversionId,
  processorUsed,
  references,
  onPageChange,
  focusedReferenceIndex,
  focusedReferenceTrigger = 0,
  figures,
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
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const navigateToPageRef = useRef<((page: number) => void) | null>(null);
  const initialReferenceNavigationKeyRef = useRef<string | null>(null);
  const handledFocusedReferenceKeyRef = useRef<string | null>(null);
  const [pendingFocusRefIdx, setPendingFocusRefIdx] = useState<number | null>(
    null
  );
  const [renderedPageMetrics, setRenderedPageMetrics] = useState<{
    pageNumber: number;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
    renderScale: number;
  } | null>(null);

  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const scrollStartRef = useRef({ left: 0, top: 0 });
  const fitWidthRafRef = useRef<number | null>(null);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);

  const canPan = zoomRatio > 1.02;

  const normalizePageNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const normalizePolygon = (polygon?: number[] | null): number[] | null => {
    if (!Array.isArray(polygon) || polygon.length < 8) return null;
    const normalized = polygon
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    return normalized.length >= 8 ? normalized : null;
  };

  const normalizeTextForMatch = (value?: string | null): string =>
    (value || "").toLowerCase().replace(/\s+/g, " ").trim();

  const getTextMatchScore = (referenceText: string, candidateText: string) => {
    if (!referenceText || !candidateText) return 0;
    if (referenceText === candidateText) return 1;
    if (candidateText.includes(referenceText)) {
      return Math.min(0.98, referenceText.length / candidateText.length + 0.25);
    }
    if (referenceText.includes(candidateText)) {
      return Math.min(0.9, candidateText.length / referenceText.length);
    }

    const referenceTokens = new Set(
      referenceText.split(/[^a-z0-9]+/).filter((token) => token.length > 2)
    );
    const candidateTokens = new Set(
      candidateText.split(/[^a-z0-9]+/).filter((token) => token.length > 2)
    );

    if (referenceTokens.size === 0 || candidateTokens.size === 0) return 0;

    let overlap = 0;
    referenceTokens.forEach((token) => {
      if (candidateTokens.has(token)) overlap++;
    });

    return overlap / Math.max(referenceTokens.size, candidateTokens.size);
  };

  const getFallbackReferenceMatch = (
    ref: Reference
  ): { pageNumber: number | null; polygon: number[] | null } | null => {
    if (!analysisResult) return null;

    const referenceText = normalizeTextForMatch(ref.text);
    if (!referenceText) return null;

    let bestMatch: {
      pageNumber: number | null;
      polygon: number[] | null;
    } | null = null;
    let bestScore = 0;

    analysisResult?.paragraphs?.forEach((paragraph: any) => {
      const polygon = normalizePolygon(
        paragraph?.bounding_regions?.[0]?.polygon || null
      );
      if (!polygon) return;

      const score = getTextMatchScore(
        referenceText,
        normalizeTextForMatch(paragraph?.content)
      );
      if (score <= bestScore) return;

      bestScore = score;
      bestMatch = {
        pageNumber: normalizePageNumber(
          paragraph?.bounding_regions?.[0]?.page_number
        ),
        polygon,
      };
    });

    analysisResult?.pages?.forEach((page: any) => {
      page?.lines?.forEach((line: any) => {
        const polygon = normalizePolygon(line?.polygon || null);
        if (!polygon) return;

        const score = getTextMatchScore(
          referenceText,
          normalizeTextForMatch(line?.content)
        );
        if (score <= bestScore) return;

        bestScore = score;
        bestMatch = {
          pageNumber: normalizePageNumber(
            line?.page_number || page?.page_number
          ),
          polygon,
        };
      });
    });

    return bestScore >= 0.35 ? bestMatch : null;
  };

  const getReferencePageNumber = (ref: Reference): number | null => {
    const bestMatchPage = normalizePageNumber(
      ref.best_match?.page_number ||
        ref.best_match?.bounding_regions?.[0]?.page_number
    );
    if (bestMatchPage) return bestMatchPage;

    const paragraphRegion = ref.paragraph_matches?.[0]?.bounding_regions?.[0];
    const paragraphPage = normalizePageNumber(
      paragraphRegion?.page_number || paragraphRegion?.pageNumber
    );
    if (paragraphPage) return paragraphPage;

    const linePage = normalizePageNumber(ref.line_matches?.[0]?.page_number);
    if (linePage) return linePage;

    return getFallbackReferenceMatch(ref)?.pageNumber ?? null;
  };

  const getReferencePolygon = (ref: Reference): number[] | null => {
    const bestMatchPolygon = normalizePolygon(
      ref.best_match?.bounding_regions?.[0]?.polygon || ref.best_match?.polygon
    );
    if (bestMatchPolygon) return bestMatchPolygon;

    const paragraphPolygon = normalizePolygon(
      ref.paragraph_matches?.[0]?.bounding_regions?.[0]?.polygon
    );
    if (paragraphPolygon) return paragraphPolygon;

    const linePolygon = normalizePolygon(ref.line_matches?.[0]?.polygon);
    if (linePolygon) return linePolygon;

    return getFallbackReferenceMatch(ref)?.polygon ?? null;
  };

  const clampZoomRatio = (value: number) => Math.min(3, Math.max(0.5, value));

  const handleZoomChange = (delta: number) => {
    setZoomRatio((prev) => Number(clampZoomRatio(prev + delta).toFixed(2)));
  };

  const handleResetZoom = () => setZoomRatio(1);

  // Extract unique page numbers from references
  const referencePages = new Set<number>();
  references.forEach((ref) => {
    const pageNum = getReferencePageNumber(ref);
    if (pageNum) {
      referencePages.add(pageNum);
    }
  });
  const pagesArray = Array.from(referencePages).sort((a, b) => a - b);
  const firstReferencePage = pagesArray.length > 0 ? pagesArray[0] : null;
  // Include a fingerprint of reference page numbers so the key changes when
  // different references happen to have the same count/first-page but point to
  // different pages (e.g. switching between two files with 3 refs each).
  const refPagesFingerprint = pagesArray.join(",");
  const initialReferenceNavigationKey = `${fileId}:${conversionId ?? ""}:${
    firstReferencePage ?? "none"
  }:${references.length}:${refPagesFingerprint}`;

  // Only auto-jump to the first reference page once per viewer dataset.
  useEffect(() => {
    if (
      !pdfDocument ||
      firstReferencePage === null ||
      initialReferenceNavigationKeyRef.current === initialReferenceNavigationKey
    ) {
      return;
    }

    initialReferenceNavigationKeyRef.current = initialReferenceNavigationKey;

    // Guard against navigating to a page that doesn't exist in this PDF.
    // totalPages may still be 0 while the document is initializing — in that
    // case allow the navigation (the page-render effect will clamp it).
    const targetPage =
      totalPages > 0
        ? Math.min(firstReferencePage, totalPages)
        : firstReferencePage;
    setCurrentPage(targetPage);
    if (onPageChange) {
      onPageChange(targetPage);
    }
  }, [
    pdfDocument,
    firstReferencePage,
    initialReferenceNavigationKey,
    onPageChange,
    totalPages,
  ]);

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
    (refIdx: number, pageNumber?: number) => {
      const canvas = overlayCanvasRef.current || canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return false;

      const boundingBoxes = (canvas as any).boundingBoxes || [];
      const target = boundingBoxes.find(
        (bbox: any) =>
          bbox.refIdx === refIdx &&
          (pageNumber === undefined || bbox.pageNumber === pageNumber)
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
    []
  );

  useEffect(() => {
    if (
      focusedReferenceIndex === null ||
      focusedReferenceIndex === undefined ||
      !references[focusedReferenceIndex]
    ) {
      handledFocusedReferenceKeyRef.current = null;
      return;
    }

    const ref = references[focusedReferenceIndex];
    const targetPage = getReferencePageNumber(ref);
    const focusKey = `${focusedReferenceTrigger}:${focusedReferenceIndex}:${
      targetPage ?? "none"
    }`;

    if (handledFocusedReferenceKeyRef.current === focusKey) {
      return;
    }

    handledFocusedReferenceKeyRef.current = focusKey;

    setPendingFocusRefIdx(focusedReferenceIndex);

    if (targetPage && targetPage !== currentPage) {
      navigateToPage(targetPage);
    } else {
      // Already on the right page, try to center immediately
      requestAnimationFrame(() => {
        const success = scrollReferenceIntoView(
          focusedReferenceIndex,
          targetPage || currentPage
        );
        if (success) {
          setPendingFocusRefIdx(null);
        }
      });
    }
  }, [
    focusedReferenceIndex,
    focusedReferenceTrigger,
    references,
    navigateToPage,
    scrollReferenceIntoView,
    currentPage,
  ]);

  useEffect(() => {
    if (pendingFocusRefIdx === null) return;

    const success = scrollReferenceIntoView(pendingFocusRefIdx, currentPage);
    if (success) {
      setPendingFocusRefIdx(null);
    }
  }, [pendingFocusRefIdx, currentPage, scale, scrollReferenceIntoView]);

  // Configure PDF.js worker
  useEffect(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  }, []);

  // Fetch analysis result for coordinate system
  useEffect(() => {
    let isCancelled = false;
    const retryTimeouts: ReturnType<typeof setTimeout>[] = [];

    if (!conversionId) {
      setAnalysisResult(null);
      return;
    }

    const cachedAnalysis = analysisCache.get(conversionId);
    if (cachedAnalysis) {
      setAnalysisResult(cachedAnalysis);
    } else {
      setAnalysisResult(null);
    }

    const fetchAnalysis = async (retryCount = 0) => {
      try {
        const data = await loadDocumentAnalysis(conversionId, {
          timeoutMs: DEFAULT_ANALYSIS_LOAD_TIMEOUT_MS,
        });
        if (isCancelled) return;
        setAnalysisResult(data);
      } catch (err: any) {
        if (err?.status === 404 && retryCount < 4) {
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
        console.error("Error fetching analysis:", err);
      }
    };

    fetchAnalysis();

    return () => {
      isCancelled = true;
      retryTimeouts.forEach((timeout) => clearTimeout(timeout));
    };
  }, [conversionId]);

  useEffect(() => {
    setScale(fitToWidthScale * zoomRatio);
  }, [fitToWidthScale, zoomRatio]);

  useEffect(() => {
    return () => {
      if (fitWidthRafRef.current !== null) {
        cancelAnimationFrame(fitWidthRafRef.current);
      }
    };
  }, []);

  // Force a clean canvas/viewer reset whenever the displayed document changes.
  useEffect(() => {
    initialReferenceNavigationKeyRef.current = null;
    handledFocusedReferenceKeyRef.current = null;
    setPendingFocusRefIdx(null);
    setCurrentPage(1);
    setTotalPages(0);
    setRenderedPageMetrics(null);
    setFitToWidthScale(1);
    setZoomRatio(1);
    setScale(1);

    [canvasRef.current, overlayCanvasRef.current].forEach((canvas) => {
      if (!canvas) return;
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = "0px";
      canvas.style.height = "0px";
      (canvas as any).boundingBoxes = [];
    });

    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  }, [fileId, conversionId]);

  // Load the PDF document immediately
  useEffect(() => {
    if (!fileId) {
      if (!fileId) {
        console.log("[EntityPDFViewerBeta] No fileId, waiting...");
      }
      return;
    }

    let isCancelled = false;

    const loadPDF = async () => {
      try {
        setError(null);
        setLoading(true);
        setLoadingProgress(0);
        setPdfDocument(null);
        setTotalPages(0);
        setRenderedPageMetrics(null);

        const loadWithRetry = async (attempt = 0): Promise<any> => {
          try {
            return await loadPdfDocument(fileId, {
              timeoutMs: DEFAULT_PDF_LOAD_TIMEOUT_MS,
              onProgress: (progressData) => {
                if (isCancelled || progressData.total <= 0) return;
                const percent = Math.round(
                  (progressData.loaded / progressData.total) * 100
                );
                setLoadingProgress(percent);
              },
            });
          } catch (error) {
            if (attempt < 1 && !isCancelled) {
              pdfDocumentCache.delete(fileId);
              pdfLoadingPromiseCache.delete(fileId);
              return loadWithRetry(attempt + 1);
            }
            throw error;
          }
        };

        console.log("[EntityPDFViewerBeta] Loading PDF document...");
        const pdf = await loadWithRetry();

        if (isCancelled) return;

        console.log("[EntityPDFViewerBeta] PDF loaded, pages:", pdf.numPages);

        setPdfDocument(pdf);
        setTotalPages(pdf.numPages);

        // Calculate fit-to-width scale for first page
        if (containerRef.current) {
          try {
            const page = await pdf.getPage(1);
            if (isCancelled) return;

            const viewport = page.getViewport({ scale: 1.0 });
            const containerWidth =
              containerRef.current.getBoundingClientRect().width - 48;
            const calculatedScale = containerWidth / viewport.width;
            setFitToWidthScale((prev) =>
              Math.abs(prev - calculatedScale) > FIT_TO_WIDTH_EPSILON
                ? calculatedScale
                : prev
            );
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

        setLoadingProgress(100);
        setLoading(false);
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
  }, [fileId]);

  // Update fit-to-width scale when page changes or container resizes
  useEffect(() => {
    const updateFitToWidth = async () => {
      if (!pdfDocument || !containerRef.current) return;

      try {
        const page = await pdfDocument.getPage(currentPage);
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth =
          containerRef.current.getBoundingClientRect().width - 48;
        const calculatedScale = containerWidth / viewport.width;
        setFitToWidthScale((prev) =>
          Math.abs(prev - calculatedScale) > FIT_TO_WIDTH_EPSILON
            ? calculatedScale
            : prev
        );
      } catch (err) {
        console.error("Error calculating fit-to-width:", err);
      }
    };

    updateFitToWidth();

    // Use ResizeObserver for more robust container resizing detection
    const resizeObserver = new ResizeObserver(() => {
      if (fitWidthRafRef.current !== null) {
        cancelAnimationFrame(fitWidthRafRef.current);
      }
      fitWidthRafRef.current = requestAnimationFrame(() => {
        fitWidthRafRef.current = null;
        updateFitToWidth();
      });
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      if (fitWidthRafRef.current !== null) {
        cancelAnimationFrame(fitWidthRafRef.current);
        fitWidthRafRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, [pdfDocument, currentPage]);

  // Render the current PDF page on the base canvas
  useEffect(() => {
    let renderTask: any = null;
    let isCancelled = false;
    setRenderedPageMetrics(null);
    if (overlayCanvasRef.current) {
      const overlayContext = overlayCanvasRef.current.getContext("2d");
      overlayContext?.clearRect(
        0,
        0,
        overlayCanvasRef.current.width,
        overlayCanvasRef.current.height
      );
      (overlayCanvasRef.current as any).boundingBoxes = [];
    }

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
        if (isCancelled) return;

        setRenderedPageMetrics({
          pageNumber: currentPage,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          devicePixelRatio,
          renderScale: scale,
        });
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException" && !isCancelled) {
          console.error("Error rendering page:", err);
          // If the page doesn't exist (e.g. stale currentPage from a previous
          // file's references), fall back to page 1 so the viewer isn't stuck
          // with a permanently null renderedPageMetrics.
          if (currentPage > 1 && totalPages > 0 && currentPage > totalPages) {
            setCurrentPage(1);
          }
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
  }, [pdfDocument, currentPage, scale, totalPages]);

  // Draw the interactive bounding-box overlay above the rendered PDF
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const pdfCanvas = canvasRef.current;
    if (!overlayCanvas || !pdfCanvas || !renderedPageMetrics) return;

    overlayCanvas.style.width = `${renderedPageMetrics.viewportWidth}px`;
    overlayCanvas.style.height = `${renderedPageMetrics.viewportHeight}px`;
    overlayCanvas.width =
      renderedPageMetrics.viewportWidth * renderedPageMetrics.devicePixelRatio;
    overlayCanvas.height =
      renderedPageMetrics.viewportHeight * renderedPageMetrics.devicePixelRatio;

    const overlayContext = overlayCanvas.getContext("2d");
    if (!overlayContext) return;

    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (showBoundingBoxes) {
      drawReferenceBoundingBoxes(
        overlayContext,
        currentPage,
        renderedPageMetrics.viewportHeight,
        renderedPageMetrics.devicePixelRatio,
        renderedPageMetrics.renderScale
      );
    } else {
      (overlayCanvas as any).boundingBoxes = [];
    }

    if (pendingFocusRefIdx !== null) {
      const success = scrollReferenceIntoView(pendingFocusRefIdx);
      if (success) {
        setPendingFocusRefIdx(null);
      }
    }
  }, [
    currentPage,
    renderedPageMetrics,
    references,
    figures,
    analysisResult,
    showBoundingBoxes,
    focusedReferenceIndex,
    pendingFocusRefIdx,
    scrollReferenceIntoView,
  ]);

  const drawReferenceBoundingBoxes = (
    context: CanvasRenderingContext2D,
    pageNum: number,
    viewportHeight: number,
    devicePixelRatio: number = 1,
    renderScale: number = scale
  ) => {
    // Get processor type to determine coordinate system
    const processor =
      analysisResult?.processor || processorUsed || "azure_doc_intelligence";
    const needsYFlip = processor === "docling";

    // Get actual page height in points from analysis result (for docling Y flip)
    // Fallback to viewport height / scale if page info not available
    const pageInfo = analysisResult?.pages?.find(
      (p: any) => normalizePageNumber(p.page_number) === pageNum
    );
    const pageHeightInPoints = pageInfo?.height || viewportHeight / renderScale;

    // Helper function to convert polygon to canvas coordinates
    // Note: Entity extraction uses raw_analysis (inches for Azure DI), while
    // normalized analysis uses points. We need to detect and convert accordingly.
    // Coordinate system differences:
    // - Azure DI: Top-left origin (matches canvas) - NO flip needed
    // - Docling: Bottom-left origin (PDF standard) - flip Y coordinates
    const polygonToRect = (polygon: number[]) => {
      const normalizedPolygon = normalizePolygon(polygon);
      if (!normalizedPolygon) return null;

      // Detect whether coordinates are inches or points. When analysis metadata
      // is temporarily unavailable during a document swap, avoid assuming
      // "inches" by default or the boxes can be pushed far off-canvas.
      const pageWidth = pageInfo?.width || analysisResult?.pages?.[0]?.width;
      const pageUnit = pageInfo?.unit || analysisResult?.pages?.[0]?.unit;
      const maxCoord = Math.max(...normalizedPolygon);
      const coordsLookLikeInches = maxCoord < 20;
      const coordsLookLikePoints = maxCoord > 72;
      const coordsAreNormalized =
        pageUnit === "pt" ||
        Boolean(pageWidth && pageWidth > 200) ||
        coordsLookLikePoints;

      // Convert inches to points if needed (entity extraction uses raw_analysis)
      const needsInchConversion =
        processor === "azure_doc_intelligence" &&
        (pageUnit === "in" || (!coordsAreNormalized && coordsLookLikeInches));
      const INCHES_TO_POINTS = 72;
      const conversionFactor = needsInchConversion ? INCHES_TO_POINTS : 1;

      // Scale coordinates by both renderScale and devicePixelRatio to match scaled viewport
      const xCoords = normalizedPolygon
        .filter((_, i) => i % 2 === 0)
        .map((x) => x * conversionFactor * renderScale * devicePixelRatio);
      const yCoords = normalizedPolygon
        .filter((_, i) => i % 2 === 1)
        .map((y) => {
          const yInPoints = y * conversionFactor;
          if (needsYFlip) {
            // For Docling: Y is from bottom-left (PDF standard)
            // Flip: pageHeightInPoints - yInPoints, then scale
            return (
              (pageHeightInPoints - yInPoints) * renderScale * devicePixelRatio
            );
          } else {
            // For Azure: Y is from top-left, same as PDF.js canvas
            return yInPoints * renderScale * devicePixelRatio;
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
    const canvasElement = overlayCanvasRef.current;
    // Use actual canvas dimensions since coordinates are in scaled space
    const canvasWidth = canvasElement ? canvasElement.width : undefined;
    const canvasHeight = canvasElement ? canvasElement.height : undefined;

    references.forEach((ref, refIdx) => {
      const pageNumber = getReferencePageNumber(ref);

      if (pageNumber !== pageNum) return;

      const polygon = getReferencePolygon(ref);

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

    // Draw figure bounding boxes with different styling - only for referenced figures
    if (figures) {
      // Find which figures are referenced in the current references
      const referencedFigureIds = new Set<string>();
      references.forEach((ref) => {
        // Check if this reference has figure information
        if (ref.best_match?.type === "figure" && ref.best_match?.figure_id) {
          referencedFigureIds.add(ref.best_match.figure_id);
        }
        // Also check for references that contain figure references (enhanced matching)
        if (ref.best_match?.has_figure_reference && ref.best_match?.figure_id) {
          referencedFigureIds.add(ref.best_match.figure_id);
        }
      });

      figures.forEach((figure) => {
        if (normalizePageNumber(figure.page) !== pageNum) return;

        // Only show figures that are referenced
        const figureId = figure.id;
        if (!referencedFigureIds.has(figureId)) {
          // Try different ID formats (e.g., "1" vs "1.1")
          const isReferenced = Array.from(referencedFigureIds).some((refId) => {
            return (
              refId === figureId ||
              refId === figureId.split(".")[0] || // "1.1" -> "1"
              figureId.startsWith(refId + ".")
            ); // "1" -> "1.x"
          });
          if (!isReferenced) return;
        }

        const polygon = normalizePolygon(figure.bounding_regions?.[0]?.polygon);
        if (!polygon) return;

        const rect = polygonToRect(polygon);
        if (!rect) return;

        // Use a distinct style for figures (purple theme)
        const figureColor = "#9333ea"; // Purple color
        context.strokeStyle = figureColor;
        context.lineWidth = 2;
        context.setLineDash([8, 4]); // Dashed line for figures
        context.strokeRect(rect.x, rect.y, rect.width, rect.height);
        context.setLineDash([]); // Reset dash

        // Draw figure label
        context.font = "bold 12px sans-serif";
        const labelText = `Fig ${figure.id}`;
        const textMetrics = context.measureText(labelText);
        const labelWidth = textMetrics.width + 10;
        const labelHeight = 18;

        // Position figure labels on the right side when possible
        const margin = 6;
        let labelX = rect.x + rect.width + margin;
        let labelY = rect.y;

        // Check if label fits on the right, otherwise place on left or top
        const canPlaceRight = canvasWidth && labelX + labelWidth <= canvasWidth;
        if (!canPlaceRight) {
          if (rect.x - labelWidth - margin >= 0) {
            // Place on left
            labelX = rect.x - labelWidth - margin;
          } else {
            // Place on top
            labelX = rect.x;
            labelY = rect.y - labelHeight - margin;
          }
        }

        // Ensure label stays within canvas bounds
        if (canvasWidth && labelX + labelWidth > canvasWidth) {
          labelX = Math.max(0, canvasWidth - labelWidth - margin);
        }
        if (canvasHeight && labelY + labelHeight > canvasHeight) {
          labelY = Math.max(0, canvasHeight - labelHeight - margin);
        }
        if (labelY < 0) {
          labelY = rect.y + rect.height + margin;
        }

        context.fillStyle = "rgba(147, 51, 234, 0.1)"; // Light purple background
        context.strokeStyle = figureColor;
        context.lineWidth = 1;
        context.fillRect(labelX, labelY, labelWidth, labelHeight);
        context.strokeRect(labelX, labelY, labelWidth, labelHeight);

        context.fillStyle = figureColor;
        context.fillText(labelText, labelX + 5, labelY + labelHeight - 5);
      });
    }

    context.restore();

    // Store click handler info on canvas
    if (overlayCanvasRef.current) {
      (overlayCanvasRef.current as any).boundingBoxes = references
        .map((ref, refIdx) => {
          const pageNum = getReferencePageNumber(ref);
          const polygon = getReferencePolygon(ref);
          if (!polygon) return null;
          const rect = polygonToRect(polygon);
          if (!rect) return null;
          return { ...rect, refIdx, pageNumber: pageNum };
        })
        .filter(Boolean);
    }
  };

  // Handle clicks on bounding boxes
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
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
  }, [currentPage, references, navigateToPage, renderedPageMetrics]);

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

  return (
    <div className="flex flex-col h-full border rounded-md overflow-hidden bg-white">
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
          <div className="relative inline-block">
            <canvas
              ref={canvasRef}
              className="block shadow-lg bg-white border border-gray-300 rounded"
            />
            <canvas ref={overlayCanvasRef} className="absolute inset-0 z-10" />
          </div>
        </div>
      </div>
    </div>
  );
}

export const EntityPDFViewerBeta = memo(EntityPDFViewerBetaComponent);
