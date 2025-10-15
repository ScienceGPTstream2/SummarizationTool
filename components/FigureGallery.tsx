import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
import { Image as ImageIcon, ZoomIn, FileImage, Loader2 } from "lucide-react";

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
  onError: () => void;
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
      .catch(() => {
        if (mounted) {
          setLoading(false);
          onError();
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
      onError={onError}
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
}

interface FigureGalleryProps {
  conversionId: string;
  figures: FigureMetadata[];
}

export function FigureGallery({ conversionId, figures }: FigureGalleryProps) {
  const [selectedFigure, setSelectedFigure] = useState<FigureMetadata | null>(
    null
  );
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  // Use a ref to store blob URLs so we don't cause re-renders
  const imageBlobUrlsRef = useRef<Map<string, string>>(new Map());
  // Use state to force re-render when images are loaded
  const [, forceUpdate] = useState({});

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
          `Failed to fetch image: ${response.status} ${errorText}`
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

  const handleImageError = (figureId: string) => {
    setImageErrors((prev) => new Set(prev).add(figureId));
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
          <ScrollArea className="h-[500px]">
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
                        onError={() => handleImageError(figure.id)}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <ImageIcon className="h-8 w-8" />
                        <span className="text-xs">No preview</span>
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
                      {figure.page && (
                        <Badge variant="outline" className="text-xs">
                          Page {figure.page}
                        </Badge>
                      )}
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
          </ScrollArea>
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
