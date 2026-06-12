import { useState, useEffect, useRef } from "react";
import parse from "html-react-parser";
import DOMPurify from "dompurify";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
// import { ScrollArea } from "./ui/scroll-area"; // Removed to fix layout issues
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Table as TableIcon, ZoomIn, Loader2, Download } from "lucide-react";
import { getValidToken } from "../utils/authUtils";
import { downloadFile } from "./ExportUtils";

// Component to lazy load and display table HTML
function TablePreview({
  tableNumber,
  conversionId,
  onTableClick,
  className = "",
}: {
  tableNumber: number;
  conversionId: string;
  onTableClick: () => void;
  className?: string;
}) {
  const [tableHtml, setTableHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fire once when the card scrolls within 200px of the viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    let mounted = true;

    const fetchTable = async () => {
      try {
        const token = await getValidToken();
        const url = `/api/documents/${conversionId}/tables/table-${tableNumber}.html`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch table: ${response.status}`);
        }

        const html = await response.text();
        if (mounted) {
          setTableHtml(html);
          setLoading(false);
        }
      } catch (err) {
        console.error(`Error fetching table ${tableNumber}:`, err);
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      }
    };

    fetchTable();

    return () => {
      mounted = false;
    };
  }, [shouldLoad, tableNumber, conversionId]);

  if (loading) {
    return (
      <div ref={containerRef} className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !tableHtml) {
    return (
      <div ref={containerRef} className="flex items-center justify-center h-32 text-muted-foreground">
        <TableIcon className="h-8 w-8" />
      </div>
    );
  }

  // Sanitize HTML and add table styling
  const sanitizedHtml = DOMPurify.sanitize(tableHtml);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden border rounded-md ${className}`}
      onClick={onTableClick}
      style={{
        height: "160px", // Fixed height for consistency
        cursor: "pointer",
      }}
    >
      <style>{`
        .table-preview-wrapper table {
          border-collapse: collapse;
          width: 100%;
          font-size: 10px;
          background-color: white;
          table-layout: auto; /* Allow columns to expand */
        }
        .table-preview-wrapper th,
        .table-preview-wrapper td {
          border: 1px solid #e2e8f0;
          padding: 4px 8px;
          text-align: left;
          /* overflow: hidden; Removed to allow scrolling */
          /* text-overflow: ellipsis; Removed to allow scrolling */
          white-space: nowrap;
        }
        .table-preview-wrapper th {
          background-color: #f8fafc;
          font-weight: 600;
          color: #475569;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .table-preview-wrapper tr:nth-child(even) {
          background-color: #fcfcfc;
        }
        .table-preview-wrapper tr:hover {
          background-color: #f1f5f9;
        }
      `}</style>
      <div className="table-preview-wrapper overflow-auto h-full pb-12">
        {parse(sanitizedHtml)}
      </div>
      {/* Gradient Fade Overlay */}
      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" />
    </div>
  );
}

// Full table display component
function TableDisplay({
  tableNumber,
  conversionId,
}: {
  tableNumber: number;
  conversionId: string;
}) {
  const [tableHtml, setTableHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    const fetchTable = async () => {
      try {
        const token = await getValidToken();
        const url = `/api/documents/${conversionId}/tables/table-${tableNumber}.html`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch table: ${response.status}`);
        }

        const html = await response.text();
        if (mounted) {
          setTableHtml(html);
          setLoading(false);
        }
      } catch (err) {
        console.error(`Error fetching table ${tableNumber}:`, err);
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      }
    };

    fetchTable();

    return () => {
      mounted = false;
    };
  }, [tableNumber, conversionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !tableHtml) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
        <TableIcon className="h-16 w-16" />
        <p>Table not available</p>
      </div>
    );
  }

  // Sanitize HTML and add table styling
  const sanitizedHtml = DOMPurify.sanitize(tableHtml);

  return (
    <div
      className="overflow-auto"
      style={{
        maxHeight: "70vh",
      }}
    >
      <style>{`
        .table-full-display table {
          border-collapse: collapse;
          width: 100%;
          font-size: 14px;
          background-color: white;
        }
        .table-full-display th,
        .table-full-display td {
          border: 1px solid #cbd5e1;
          padding: 8px 12px;
          text-align: left;
          vertical-align: top;
        }
        .table-full-display th {
          background-color: #f1f5f9;
          font-weight: 600;
          color: #1e293b;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .table-full-display tr:nth-child(even) {
          background-color: #f8fafc;
        }
        .table-full-display tr:hover {
          background-color: #e2e8f0;
        }
        .table-full-display caption {
          caption-side: top;
          padding: 8px;
          font-weight: 600;
          text-align: left;
          background-color: #f8fafc;
          border: 1px solid #cbd5e1;
          border-bottom: none;
        }
      `}</style>
      <div className="table-full-display">{parse(sanitizedHtml)}</div>
    </div>
  );
}

interface TablesGalleryProps {
  conversionId: string;
  tablesCount: number;
}

export function TablesGallery({
  conversionId,
  tablesCount,
}: TablesGalleryProps) {
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [isDownloadingSingle, setIsDownloadingSingle] = useState(false);

  if (!tablesCount || tablesCount === 0) {
    return null;
  }

  // Generate array of table numbers [1, 2, 3, ..., tablesCount]
  const tableNumbers = Array.from({ length: tablesCount }, (_, i) => i + 1);

  const fetchTableHtml = async (
    tableNumber: number
  ): Promise<string | null> => {
    const token = await getValidToken();
    const url = `/api/documents/${conversionId}/tables/table-${tableNumber}.html`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return response.text();
  };

  const handleDownloadSingle = async (tableNumber: number) => {
    setIsDownloadingSingle(true);
    try {
      const html = await fetchTableHtml(tableNumber);
      if (html) downloadFile(html, `table-${tableNumber}.html`, "text/html");
    } finally {
      setIsDownloadingSingle(false);
    }
  };

  const handleDownloadAll = async () => {
    setIsDownloadingAll(true);
    try {
      const token = await getValidToken();
      const response = await fetch(
        `/api/documents/${conversionId}/tables/download`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) throw new Error(`ZIP download failed: ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tables-${conversionId.slice(0, 8)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading all tables:", err);
    } finally {
      setIsDownloadingAll(false);
    }
  };

  return (
    <>
      <Card className="border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TableIcon className="h-5 w-5" />
              Extracted Tables ({tablesCount})
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadAll}
              disabled={isDownloadingAll}
            >
              {isDownloadingAll ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Download All Tables
            </Button>
          </div>
          <CardDescription>
            Tables detected and extracted from the document in HTML format
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[500px] overflow-y-auto pr-2">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tableNumbers.map((tableNum) => (
                <div
                  key={tableNum}
                  className="group border rounded-lg p-3 hover:border-primary hover:shadow-md transition-all"
                >
                  {/* Table Preview */}
                  <div className="relative bg-muted rounded-md mb-3 p-2 overflow-hidden">
                    <TablePreview
                      tableNumber={tableNum}
                      conversionId={conversionId}
                      onTableClick={() => setSelectedTable(tableNum)}
                    />
                    <div className="absolute top-2 right-2 bg-black/60 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
                      <ZoomIn className="h-4 w-4" />
                    </div>
                  </div>

                  {/* Table Info */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">
                        Table {tableNum}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        HTML
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Click to view full table
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table Detail Modal */}
      <Dialog
        open={selectedTable !== null}
        onOpenChange={() => setSelectedTable(null)}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[75vw] xl:max-w-[70vw] w-full max-h-[95vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Table {selectedTable}</span>
              <Badge variant="outline">HTML Format</Badge>
            </DialogTitle>
          </DialogHeader>

          {selectedTable && (
            <div className="space-y-4">
              {/* Full Table Display */}
              <div className="bg-muted rounded-lg p-6">
                <TableDisplay
                  tableNumber={selectedTable}
                  conversionId={conversionId}
                />
              </div>

              {/* Metadata */}
              <div className="flex items-center justify-between border-t pt-3">
                <div className="flex items-center gap-6 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Table:</span>
                    <code className="bg-muted px-2 py-1 rounded">
                      table-{selectedTable}.html
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Format:</span>
                    <span>HTML</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownloadSingle(selectedTable)}
                  disabled={isDownloadingSingle}
                >
                  {isDownloadingSingle ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download Table
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
