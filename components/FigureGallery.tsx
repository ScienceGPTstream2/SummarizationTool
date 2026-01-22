import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

// import { ScrollArea } from "./ui/scroll-area"; // Removed to fix layout issues
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Image as ImageIcon, ZoomIn, FileImage, Loader2, Brain, Copy, Check } from "lucide-react";

// Component to lazy load images with authentication
function FigureImage({
  imagePath,
  figureId,
  caption,
  getImageUrl,
  onError,
  className = "w-full h-full object-contain",
}: {
  imagePath: string;
  figureId: string;
  caption: string | null;
  getImageUrl: (path: string, id: string) => Promise<string>;
  onError: (message?: string) => void;
  className?: string;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    getImageUrl(imagePath, figureId)
      .then((url) => {
        if (mounted) {
          setImageUrl(url);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (mounted) {
          setLoading(false);
          onError(error.message);
        }
      });

    return () => {
      mounted = false;
    };
  }, [imagePath, figureId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!imageUrl) {
    return null;
  }

  return (
    <img
      src={imageUrl}
      alt={caption || `Figure ${figureId}`}
      className={className}
      onError={() => onError("Failed to load image")}
    />
  );
}

interface FigureMetadata {
  id: string;
  page: number | null;
  caption: string | null;
  image_path?: string;
  bounding_regions?: Array<{
    page_number: number;
    polygon: number[];
  }>;
  scientific_summary?: {
    summary: string;
    generated_at: string;
    model_used: string;
    summary_type: string;
  };
  extracted_content?: {
    content: string;
    model_used: string;
  };
}

interface FigureGalleryProps {
  conversionId: string;
  figures: FigureMetadata[];
}

export function FigureGallery({ conversionId, figures }: FigureGalleryProps) {
  const [selectedFigure, setSelectedFigure] = useState<FigureMetadata | null>(
    null
  );
  const [imageErrors, setImageErrors] = useState<Map<string, string>>(
    new Map()
  );
  // Use a ref to store blob URLs so we don't cause re-renders
  const imageBlobUrlsRef = useRef<Map<string, string>>(new Map());
  // Use state to force re-render when images are loaded
  const [, forceUpdate] = useState({});

  // OCR extraction state
  const [extractingFigure, setExtractingFigure] = useState<string | null>(null);
  const [extractedContent, setExtractedContent] = useState<Map<string, any>>(
    new Map()
  );
  const [copiedToClipboard, setCopiedToClipboard] = useState<string | null>(null);

  // Model selection state
  const [selectedModel, setSelectedModel] = useState<string>("gemini-2.5-flash");

  if (!figures || figures.length === 0) {
    return null;
  }

  // Cleanup blob URLs on unmount ONLY
  useEffect(() => {
    return () => {
      imageBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      imageBlobUrlsRef.current.clear();
    };
  }, []); // Empty dependency array - only run on mount/unmount

  const getImageUrl = async (
    imagePath: string,
    figureId: string
  ): Promise<string> => {
    // Check if we already have a blob URL for this image
    if (imageBlobUrlsRef.current.has(figureId)) {
      console.log(`[FigureGallery] Using cached blob URL for ${figureId}`);
      return imageBlobUrlsRef.current.get(figureId)!;
    }

    // Extract just the filename from the path (e.g., "figures/1.1.png" -> "1.1.png")
    const filename = imagePath.split("/").pop();
    const apiBase = import.meta.env.VITE_API_BASE_URL || "";
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("No authentication token found");
    }
    const url = `${apiBase}/api/documents/${conversionId}/figures/${filename}`;

    console.log(`[FigureGallery] Fetching figure:`, {
      figureId,
      imagePath,
      filename,
      conversionId,
      url,
      hasToken: !!token,
    });

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      console.log(`[FigureGallery] Response:`, {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get("content-type"),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[FigureGallery] Error response:`, errorText);
        throw new Error(
          `Error ${response.status}: ${response.statusText} (${url})`
        );
      }

      const blob = await response.blob();
      console.log(`[FigureGallery] Blob received:`, {
        size: blob.size,
        type: blob.type,
      });

      const blobUrl = URL.createObjectURL(blob);
      console.log(
        `[FigureGallery] ✅ Created blob URL for ${figureId}: ${blobUrl}`
      );

      // Store in ref instead of state to avoid re-render that would revoke the blob
      imageBlobUrlsRef.current.set(figureId, blobUrl);

      // Force a re-render to show the image
      forceUpdate({});

      return blobUrl;
    } catch (error) {
      console.error("[FigureGallery] Error fetching image:", error);
      throw error;
    }
  };

  const handleImageError = (figureId: string, errorMessage?: string) => {
    setImageErrors((prev) => {
      const newMap = new Map(prev);
      newMap.set(figureId, errorMessage || "Failed to load");
      return newMap;
    });
  };

  const generateFigureSummary = async (figureId: string) => {
    if (extractingFigure === figureId) return; // Already generating

    setExtractingFigure(figureId);

    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const apiBase = import.meta.env.VITE_API_BASE_URL || "";
      const url = `${apiBase}/api/documents/${conversionId}/figures/${figureId}/generate-summary`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model_type: "gemini",
          model_id: selectedModel,
          max_tokens: 2048,
          temperature: 0.0,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();

      // Store the generated summary temporarily in extractedContent for display
      setExtractedContent((prev) => {
        const newMap = new Map(prev);
        newMap.set(figureId, {
          content: data.summary_result.summary,
          model_used: data.summary_result.model_used,
          generated_at: data.summary_result.generated_at,
          summary_type: "scientific_summary",
        });
        return newMap;
      });

      // Force a refresh of the figures list to show the new summary badge
      // The parent component will re-fetch figures and include the new summary
      console.log("[FigureGallery] Summary generated successfully, figures will be refreshed");

    } catch (error) {
      console.error("[FigureGallery] Summary generation error:", error);
      setExtractedContent((prev) => {
        const newMap = new Map(prev);
        newMap.set(figureId, {
          error: error instanceof Error ? error.message : "Failed to generate summary",
        });
        return newMap;
      });
    } finally {
      setExtractingFigure(null);
    }
  };

  const copyToClipboard = async (text: string, figureId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToClipboard(figureId);
      setTimeout(() => setCopiedToClipboard(null), 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  return (
    <>
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileImage className="h-5 w-5" />
            Extracted Figures ({figures.length})
          </CardTitle>
          <CardDescription>
            Figures and charts detected and extracted from the document
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[600px] w-full overflow-y-auto pr-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {figures.map((figure) => (
                <div
                  key={figure.id}
                  className="group border rounded-lg p-3 hover:border-primary hover:shadow-md cursor-pointer transition-all"
                  onClick={() => setSelectedFigure(figure)}
                >
                  {/* Figure Preview */}
                  <div className="relative aspect-video bg-muted rounded-md mb-3 flex items-center justify-center overflow-hidden">
                    {figure.image_path && !imageErrors.has(figure.id) ? (
                      <FigureImage
                        imagePath={figure.image_path}
                        figureId={figure.id}
                        caption={figure.caption}
                        getImageUrl={getImageUrl}
                        onError={(msg) => handleImageError(figure.id, msg)}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground p-2 text-center">
                        <ImageIcon className="h-8 w-8" />
                        <span className="text-xs text-red-500 font-medium">
                          {imageErrors.get(figure.id) || "No preview"}
                        </span>
                      </div>
                    )}
                    {figure.image_path && !imageErrors.has(figure.id) && (
                      <div className="absolute top-2 right-2 bg-black/60 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
                        <ZoomIn className="h-4 w-4" />
                      </div>
                    )}
                  </div>

                  {/* Figure Info */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">
                        Figure {figure.id}
                      </span>
                      <div className="flex items-center gap-1">
                        {figure.scientific_summary && (
                          <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">
                            Summary
                          </Badge>
                        )}
                        {figure.extracted_content && (
                          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                            OCR
                          </Badge>
                        )}
                        {figure.page && (
                          <Badge variant="outline" className="text-xs">
                            Page {figure.page}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {figure.caption && (
                      <p className="text-xs line-clamp-2 text-muted-foreground">
                        {figure.caption}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Figure Detail Modal */}
      <Dialog
        open={!!selectedFigure}
        onOpenChange={() => setSelectedFigure(null)}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[75vw] xl:max-w-[70vw] w-full max-h-[95vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Figure {selectedFigure?.id}</span>
              {selectedFigure?.page && (
                <Badge variant="outline">Page {selectedFigure.page}</Badge>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Detailed view of the selected figure
            </DialogDescription>
          </DialogHeader>

          {selectedFigure && (
            <div className="space-y-4">
              {/* Full Size Image */}
              {selectedFigure.image_path &&
              !imageErrors.has(selectedFigure.id) ? (
                <div className="bg-muted rounded-lg p-8 flex items-center justify-center min-h-[500px]">
                  <FigureImage
                    imagePath={selectedFigure.image_path}
                    figureId={selectedFigure.id}
                    caption={selectedFigure.caption}
                    getImageUrl={getImageUrl}
                    onError={() => handleImageError(selectedFigure.id)}
                    className="max-w-full max-h-[78vh] object-contain"
                  />
                </div>
              ) : (
                <div className="bg-muted rounded-lg p-8 flex flex-col items-center justify-center gap-2 text-muted-foreground min-h-[400px]">
                  <ImageIcon className="h-16 w-16" />
                  <p>Image not available</p>
                </div>
              )}

              {/* Caption */}
              {selectedFigure.caption && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Caption</h4>
                  <p className="text-base text-muted-foreground bg-muted p-4 rounded-md leading-relaxed">
                    {selectedFigure.caption}
                  </p>
                </div>
              )}

              {/* Scientific Summary Generation */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    Scientific Summary
                  </h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => generateFigureSummary(selectedFigure.id)}
                    disabled={extractingFigure === selectedFigure.id || !!selectedFigure.scientific_summary}
                    className="text-xs"
                  >
                    {extractingFigure === selectedFigure.id ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        Generating...
                      </>
                    ) : selectedFigure.scientific_summary ? (
                      <>
                        <Check className="h-3 w-3 mr-1" />
                        Summary Ready
                      </>
                    ) : (
                      <>
                        <Brain className="h-3 w-3 mr-1" />
                        Generate Summary
                      </>
                    )}
                  </Button>
                </div>

                {/* Model Selection */}
                <div className="mb-4">
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    AI Model for Analysis
                  </label>
                  <Select value={selectedModel} onValueChange={setSelectedModel}>
                    <SelectTrigger className="w-full max-w-xs">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (Fast)</SelectItem>
                      <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro (Most Capable)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Scientific Summary Display */}
                {selectedFigure.scientific_summary ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Generated: {new Date(selectedFigure.scientific_summary.generated_at).toLocaleString()}
                        • Model: {selectedFigure.scientific_summary.model_used} (Selected: {selectedModel})
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(
                          selectedFigure.scientific_summary?.summary || "",
                          selectedFigure.id
                        )}
                        className="h-6 px-2 text-xs"
                      >
                        {copiedToClipboard === selectedFigure.id ? (
                          <>
                            <Check className="h-3 w-3 mr-1" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                    <Textarea
                      value={selectedFigure.scientific_summary.summary}
                      readOnly
                      className="min-h-[150px] text-sm resize-none"
                      placeholder="Scientific summary will appear here..."
                    />
                    <div className="bg-green-50 border border-green-200 rounded-md p-3">
                      <p className="text-sm text-green-700">
                        ✅ This summary will be included in entity extraction analysis
                      </p>
                    </div>
                  </div>
                ) : extractedContent.has(selectedFigure.id) ? (
                  // Legacy OCR content display
                  <div className="space-y-3">
                    {extractedContent.get(selectedFigure.id)?.error ? (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-red-700">
                          ❌ {extractedContent.get(selectedFigure.id).error}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">
                            Model: {extractedContent.get(selectedFigure.id)?.model_used || "Unknown"}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(
                              extractedContent.get(selectedFigure.id)?.content || "",
                              selectedFigure.id
                            )}
                            className="h-6 px-2 text-xs"
                          >
                            {copiedToClipboard === selectedFigure.id ? (
                              <>
                                <Check className="h-3 w-3 mr-1" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 mr-1" />
                                Copy
                              </>
                            )}
                          </Button>
                        </div>
                        <Textarea
                          value={extractedContent.get(selectedFigure.id)?.content || ""}
                          readOnly
                          className="min-h-[120px] text-sm font-mono resize-none"
                          placeholder="Extracted content will appear here..."
                        />
                      </div>
                    )}
                  </div>
                ) : !extractingFigure && (
                  <div className="text-center py-6 text-muted-foreground">
                    <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">
                      Generate a scientific summary to extract key data and findings from this figure.
                      The summary will be included in entity extraction analysis.
                    </p>
                  </div>
                )}
              </div>

              {/* Metadata - Compact inline display */}
              <div className="flex items-center gap-6 text-sm text-muted-foreground border-t pt-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Figure ID:</span>
                  <code className="bg-muted px-2 py-1 rounded">
                    {selectedFigure.id}
                  </code>
                </div>
                {selectedFigure.page && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Page:</span>
                    <span>{selectedFigure.page}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
