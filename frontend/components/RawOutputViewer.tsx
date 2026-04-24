import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Alert, AlertDescription } from "./ui/alert";
import { Code, AlertCircle, Download, Sparkles, FileText } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { getValidToken } from "../utils/authUtils";

interface RawOutputViewerProps {
  conversionId: string | null;
  processorUsed: string | null;
  onContentUpdate?: () => void; // Callback when content is updated (e.g., figure summaries)
}

type MarkdownView = "base" | "enhanced";

interface MarkdownData {
  markdown_content: string;
  has_enhancements?: boolean;
  base_content?: string;
}

export function RawOutputViewer({
  conversionId,
  processorUsed,
  onContentUpdate,
}: RawOutputViewerProps) {
  const [markdownData, setMarkdownData] = useState<MarkdownData | null>(null);
  const [currentView, setCurrentView] = useState<MarkdownView>("base");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkdownContent = useCallback(
    async (forceRefresh = false) => {
      if (!conversionId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const token = await getValidToken();
        const qs = processorUsed
          ? `?processor_used=${encodeURIComponent(processorUsed)}`
          : "";

        // Always fetch enhanced content, which includes both base and enhanced versions
        const response = await fetch(
          `/api/documents/${conversionId}/enhanced-content${qs}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (!response.ok) {
          console.warn(
            "Enhanced markdown content not available, trying base content"
          );
          // Fallback to base content
          const baseResponse = await fetch(
            `/api/documents/${conversionId}/content${qs}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (!baseResponse.ok) {
            setLoading(false);
            return;
          }

          const baseData = await baseResponse.json();
          setMarkdownData({
            markdown_content: baseData.markdown_content || "",
            has_enhancements: false,
            base_content: baseData.markdown_content || "",
          });
          setLoading(false);
          return;
        }

        const data = await response.json();
        setMarkdownData({
          markdown_content: data.markdown_content || "",
          has_enhancements: data.has_enhancements || false,
          base_content: data.base_content || data.markdown_content || "",
        });

        // Notify parent component that content was updated
        if (onContentUpdate && forceRefresh) {
          onContentUpdate();
        }

        setLoading(false);
      } catch (err: any) {
        console.error("Error fetching markdown output:", err);
        setError(err.message || "Failed to load markdown output");
        setLoading(false);
      }
    },
    [conversionId, processorUsed, onContentUpdate]
  );

  useEffect(() => {
    fetchMarkdownContent();
  }, [fetchMarkdownContent]);

  // Refresh content when requested (e.g., after figure summary generation)
  const refreshContent = useCallback(() => {
    fetchMarkdownContent(true);
  }, [fetchMarkdownContent]);

  // Expose refresh method for parent components
  useEffect(() => {
    if (window) {
      (window as any).refreshMarkdownContent = refreshContent;
    }
    return () => {
      if (window) {
        delete (window as any).refreshMarkdownContent;
      }
    };
  }, [refreshContent]);

  const getCurrentMarkdown = () => {
    if (!markdownData) return "";

    if (currentView === "enhanced") {
      return markdownData.markdown_content;
    } else {
      return markdownData.base_content || markdownData.markdown_content;
    }
  };

  const handleDownload = () => {
    const content = getCurrentMarkdown();
    if (!content) return;

    const viewSuffix = currentView === "enhanced" ? "_enhanced" : "_base";
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${conversionId || "document"}${viewSuffix}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleView = (view: MarkdownView) => {
    setCurrentView(view);
  };

  if (error) {
    return (
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Error Loading Raw Output
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

  const currentMarkdown = getCurrentMarkdown();
  const hasEnhancements = markdownData?.has_enhancements || false;

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader className="bg-gradient-to-r from-gray-50 to-white border-b">
        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between w-full gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              {currentView === "enhanced" ? (
                <Sparkles className="h-5 w-5 text-purple-600" />
              ) : (
                <Code className="h-5 w-5 text-purple-600" />
              )}
              <span className="font-bold">
                {currentView === "enhanced"
                  ? "Enhanced Markdown"
                  : "Base Markdown"}
              </span>
              {processorUsed && (
                <span className="text-xs font-normal text-purple-700 bg-purple-50 px-2 py-1 rounded-full border border-purple-200 whitespace-nowrap">
                  {processorUsed}
                </span>
              )}
              {currentView === "enhanced" && hasEnhancements && (
                <Badge
                  variant="secondary"
                  className="text-xs bg-green-100 text-green-800 whitespace-nowrap"
                >
                  Figure Summaries Included
                </Badge>
              )}
            </CardTitle>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto xl:justify-end">
            {/* View Toggle */}
            <div className="flex rounded-md border border-gray-200 overflow-hidden w-full sm:w-auto">
              <Button
                variant={currentView === "base" ? "default" : "ghost"}
                size="sm"
                onClick={() => toggleView("base")}
                className="rounded-none border-0 h-8 px-3 text-xs flex-1 sm:flex-none"
              >
                <FileText className="h-3 w-3 mr-1" />
                Base
              </Button>
              <Button
                variant={currentView === "enhanced" ? "default" : "ghost"}
                size="sm"
                onClick={() => toggleView("enhanced")}
                disabled={!hasEnhancements}
                className="rounded-none border-0 h-8 px-3 text-xs flex-1 sm:flex-none"
                title={
                  !hasEnhancements
                    ? "No figure summaries available"
                    : "View with figure summaries"
                }
              >
                <Sparkles className="h-3 w-3 mr-1" />
                Enhanced
              </Button>
            </div>

            {/* Download Button */}
            {currentMarkdown && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="w-full sm:w-auto"
              >
                <Download className="h-4 w-4 mr-2" />
                Download MD
              </Button>
            )}

            {/* Refresh Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshContent}
              title="Refresh content (useful after generating figure summaries)"
              className="w-full sm:w-auto"
            >
              🔄
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        {!currentMarkdown && !loading && (
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-800">
              💡 Markdown output will be available after processing the
              document.
            </AlertDescription>
          </Alert>
        )}

        {!hasEnhancements &&
          currentView === "base" &&
          !loading &&
          currentMarkdown && (
            <Alert className="bg-amber-50 border-amber-200 mb-4">
              <AlertDescription className="text-amber-800">
                📊 Generate figure summaries in the Figure Gallery above to see
                enhanced content with inline summaries.
              </AlertDescription>
            </Alert>
          )}

        {loading ? (
          <div className="flex items-center justify-center h-[1130px]">
            <div className="text-center">
              <div className="w-10 h-10 border-4 border-gray-300 border-t-purple-600 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700">
                Loading markdown output...
              </p>
            </div>
          </div>
        ) : currentMarkdown ? (
          <ScrollArea className="h-[1100px] border-2 rounded-lg bg-white">
            <pre className="p-6 text-sm font-mono text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
              {currentMarkdown}
            </pre>
          </ScrollArea>
        ) : null}
      </CardContent>
    </Card>
  );
}
