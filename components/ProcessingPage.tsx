import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Alert, AlertDescription } from './ui/alert';
import { ArrowLeft, FileText, Code, AlertTriangle } from 'lucide-react';
import { DocumentData } from '../App';
import { MarkdownViewer } from './MarkdownViewer';
import { settingsManager } from './SettingsManager';

interface ProcessingPageProps {
  onComplete: (data: Partial<DocumentData>) => void;
  onBack: () => void;
  documentData: DocumentData;
}

const allParsers = [
  { id: 'docling', name: 'Docling', description: 'AI-powered document parsing with advanced layout understanding', requiresApiKey: false },
  { id: 'azure-document-intelligence', name: 'Azure Document Intelligence', description: 'Microsoft Azure cognitive service for form and document analysis', requiresApiKey: true },
  { id: 'mineru', name: 'MinerU', description: 'High-quality PDF extraction optimized for academic papers', requiresApiKey: false },
  { id: 'marker', name: 'Marker', description: 'Fast and accurate PDF to markdown conversion', requiresApiKey: false },
  { id: 'pymupdf4llm', name: 'PyMuPDF4LLM', description: 'PyMuPDF-based extraction optimized for LLM processing', requiresApiKey: false },
  { id: 'gpt4-vision', name: 'GPT 4.1 Vision Model', description: 'OpenAI GPT-4 with vision capabilities for document understanding', requiresApiKey: false },
  { id: 'gemini-vision', name: 'Gemini Vision Model', description: 'Google Gemini multimodal AI for visual document analysis', requiresApiKey: false },
];

export function ProcessingPage({ onComplete, onBack, documentData }: ProcessingPageProps) {
  const [selectedParser, setSelectedParser] = useState(documentData.parser || '');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showResults, setShowResults] = useState(!!documentData.extractedText);
  const [conversionId, setConversionId] = useState<string | null>(null);
  const [markdownPath, setMarkdownPath] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [extractedTextLocal, setExtractedTextLocal] = useState<string>(documentData.extractedText || '');

  // Filter parsers based on API key availability
  const getAvailableParsers = () => {
    return allParsers.filter(parser => {
      if (parser.id === 'azure-document-intelligence') {
        return settingsManager.isAzureDocumentIntelligenceAvailable();
      }
      return true; // All other parsers are always available
    });
  };

  const availableParsers = getAvailableParsers();
  const isAzureDocumentIntelligenceConfigured = settingsManager.isAzureDocumentIntelligenceAvailable();

  const handleProcessPDF = async () => {
    setIsProcessing(true);
    setProcessError(null);

    try {
      if (selectedParser === 'docling') {
        // Ensure we have an uploaded file id
        if (!documentData.fileId) {
          throw new Error('No uploaded file ID found. Please upload a PDF first.');
        }

        // Trigger backend conversion for an uploaded file
        const token = localStorage.getItem('token');
        const resp = await fetch(`http://localhost:8000/api/convert/file/${documentData.fileId}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.detail || 'Conversion request failed');
        }

        const data = await resp.json();
        setConversionId(data.conversion_id || null);
        setMarkdownPath(data.markdown_path || null);

        // Fetch the markdown content
        const mdResp = await fetch(`/api/conversions/${data.conversion_id}/markdown`, {
  headers: { 'Authorization': `Bearer ${token}` },
});
        if (!mdResp.ok) {
          const err = await mdResp.json().catch(() => ({}));
          throw new Error(err.detail || 'Failed to fetch markdown content');
        }

        const mdData = await mdResp.json();
        const content = mdData.markdown_content || '';
        setExtractedTextLocal(content);

        // Persist extracted text in parent state (do not proceed to next step automatically)
        // Parent will be updated when the user clicks "Proceed to Entity Extraction"
        
        setShowResults(true);
      } else {
        // Fallback behaviour for other parsers (retain existing mock)
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        setShowResults(true);
      }
    } catch (err: any) {
      setProcessError(err?.message || String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProceed = () => {
    onComplete({
      parser: selectedParser,
      extractedText: extractedTextLocal,
      annotatedOutput: '', // annotatedOutput can be populated by future parser logic
      conversionId: conversionId ?? undefined,
      markdownPath: markdownPath ?? undefined
    });
  };

  const handleReprocess = () => {
    setShowResults(false);
    handleProcessPDF();
  };

  const handleDownloadMarkdown = async () => {
    if (!conversionId) return;
    try {
      const resp = await fetch(`/api/conversions/${conversionId}/markdown`, {
  headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
});
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to fetch markdown for download');
      }
      const data = await resp.json();
      const content = data.markdown_content || '';
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conversionId}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setProcessError(err?.message || String(err));
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h2 className="text-xl">Document Processing</h2>
          <p className="text-muted-foreground">
            Select a parser and process your document
          </p>
        </div>
      </div>

      <div className="grid gap-6">
        {!isAzureDocumentIntelligenceConfigured && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Azure Document Intelligence parser is not available. Configure your Azure Document Intelligence API key in Settings to enable this parser option.
            </AlertDescription>
          </Alert>
        )}
        
        <Card className="border-gray-200">
          <CardHeader>
            <CardTitle>Parser Selection</CardTitle>
            <CardDescription>
              Choose the appropriate parser for your document type
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center">
              <div className="max-w-md w-full relative">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Select value={selectedParser} onValueChange={setSelectedParser}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a parser" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableParsers.map((parser) => (
                          <SelectItem key={parser.id} value={parser.id}>
                            <div>
                              <div className="font-medium">{parser.name}</div>
                              <div className="text-sm text-muted-foreground">{parser.description}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Loading indicator (visible while processing). Click to toggle logs popout */}
                  <div>
                    {isProcessing && (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center bg-muted"
                        title="Processing"
                        aria-hidden="true"
                      >
                        <span className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={handleProcessPDF}
                disabled={!selectedParser || isProcessing}
                className={`${(!selectedParser || isProcessing) ? 'opacity-50 cursor-not-allowed' : ''}`}
                aria-disabled={!selectedParser || isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Process PDF'}
              </Button>

        {showResults && (
                <Button variant="outline" onClick={handleReprocess}>
                  Reprocess
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {showResults && (
          <>
            <div className="grid lg:grid-cols-2 gap-6">
              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Extracted Markdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-96">
                      <MarkdownViewer content={extractedTextLocal} />
                    </ScrollArea>
                </CardContent>
              </Card>

              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Code className="h-5 w-5" />
                    Annotated Output
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96">
                    <pre className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {extractedTextLocal}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              {conversionId && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-muted-foreground">Conversion ID</div>
                      <div className="font-mono text-sm break-all">{conversionId}</div>
                      {markdownPath && (
                        <>
                          <div className="text-sm text-muted-foreground mt-2">Saved Markdown Path</div>
                          <div className="font-mono text-sm break-all">{markdownPath}</div>
                        </>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Button variant="outline" size="sm" onClick={handleDownloadMarkdown}>
                        Download Markdown
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {processError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600">{processError}</p>
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="outline" onClick={handleProceed}>
                  Proceed to Entity Extraction
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
