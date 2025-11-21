import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Alert, AlertDescription } from "./ui/alert";
import { Code, AlertCircle, Download } from "lucide-react";
import { Button } from "./ui/button";

interface RawOutputViewerProps {
  conversionId: string | null;
  processorUsed: string | null;
}

export function RawOutputViewer({
  conversionId,
  processorUsed,
}: RawOutputViewerProps) {
  const [markdownContent, setMarkdownContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMarkdownContent = async () => {
      if (!conversionId) {
        setLoading(false);
        return;
      }

      try {
        const token = localStorage.getItem("token");
        const response = await fetch(`/api/documents/${conversionId}/content`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          console.warn("Markdown content not available");
          setLoading(false);
          return;
        }

        const data = await response.json();
        // Display the markdown content
        setMarkdownContent(data.markdown_content || "");
        setLoading(false);
      } catch (err: any) {
        console.error("Error fetching markdown output:", err);
        setError(err.message || "Failed to load markdown output");
        setLoading(false);
      }
    };

    fetchMarkdownContent();
  }, [conversionId]);

  const handleDownload = () => {
    if (!markdownContent) return;
    const blob = new Blob([markdownContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${conversionId || "document"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader className="bg-gradient-to-r from-gray-50 to-white border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Code className="h-5 w-5 text-purple-600" />
            <span className="font-bold">Markdown Output</span>
            {processorUsed && (
              <span className="text-xs font-normal text-purple-700 bg-purple-50 px-2 py-1 rounded-full border border-purple-200">
                {processorUsed}
              </span>
            )}
          </CardTitle>
          {markdownContent && (
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Download MD
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {!markdownContent && !loading && (
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-800">
              💡 Markdown output will be available after processing the
              document.
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
        ) : markdownContent ? (
          <ScrollArea className="h-[1130px] border-2 rounded-lg bg-white">
            <pre className="p-6 text-sm font-mono text-gray-800 whitespace-pre-wrap break-words">
              {markdownContent}
            </pre>
          </ScrollArea>
        ) : null}
      </CardContent>
    </Card>
  );
}
