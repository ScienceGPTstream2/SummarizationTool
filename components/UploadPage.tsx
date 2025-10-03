import React, { useRef, useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Upload, File, X, Loader2 } from 'lucide-react';
import { DocumentData } from '../App';

interface UploadPageProps {
  onComplete: (data: Partial<DocumentData>) => void;
  documentData: DocumentData;
}

export function UploadPage({ onComplete, documentData }: UploadPageProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(documentData.file);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<any>(documentData.uploadResult);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      console.log('Dropped file:', file.name, 'type:', file.type);
      
      // More flexible PDF detection - check file type OR file extension
      const isPDF = file.type === 'application/pdf' || 
                    file.name.toLowerCase().endsWith('.pdf');
      
      if (isPDF) {
        console.log('File accepted:', file.name);
        setSelectedFile(file);
        try {
          await handleFileUpload(file);
        } catch (error) {
          console.error('Upload failed for dropped file:', error);
        }
      } else {
        console.log('File rejected - not a PDF:', file.name, file.type);
        setUploadError('Please select a PDF file');
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('File select triggered, files:', e.target.files?.length);
    
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      console.log('Selected file via browse:', file.name, 'type:', file.type, 'size:', file.size);
      
      // More flexible PDF detection - check file type OR file extension
      const isPDF = file.type === 'application/pdf' || 
                    file.name.toLowerCase().endsWith('.pdf');
      
      if (isPDF) {
        console.log('File accepted via browse:', file.name);
        setSelectedFile(file);
        setUploadError(null); // Clear any previous errors
        try {
          await handleFileUpload(file);
        } catch (error) {
          console.error('Upload failed for selected file:', error);
        }
      } else {
        console.log('File rejected - not a PDF:', file.name, file.type);
        setUploadError('Please select a PDF file');
      }
    } else {
      console.log('No file selected or file selection cancelled');
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setUploadResult(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || '';
      const token = localStorage.getItem('token');
      
      console.log('Starting upload for file:', file.name, 'size:', file.size);
      
      const response = await fetch(`${apiBase}/api/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      console.log('Upload response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Upload failed' }));
        console.error('Upload error:', errorData);
        throw new Error(errorData.detail || `Upload failed with status ${response.status}`);
      }

      const result = await response.json();
      console.log('Upload result:', result);
      
      // Validate the response has the required file_id
      if (!result.file_id) {
        console.error('Missing file_id in upload response:', result);
        throw new Error('Upload succeeded but no file ID was returned');
      }
      
      setUploadResult(result);
      console.log('File uploaded successfully, file_id:', result.file_id);
      
      return result;
    } catch (error) {
      console.error('Upload error:', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  const handleProceed = () => {
    if (!selectedFile) {
      console.error('No file selected');
      return;
    }

    if (!uploadResult || !uploadResult.file_id) {
      console.error('File not uploaded yet');
      setUploadError('File upload is still in progress or failed. Please wait or try selecting the file again.');
      return;
    }

    console.log('Proceeding to processing with uploaded file:', uploadResult.file_id);
    
    // Pass the upload result and file to the next step
    onComplete({ 
      file: selectedFile,
      fileId: uploadResult.file_id,
      uploadResult: uploadResult
    });
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-xl mb-2">Upload Your Document</h2>
        <p className="text-muted-foreground">
          Upload a PDF document to begin the summarization process.
        </p>
      </div>

      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle>Document Upload</CardTitle>
          <CardDescription>
            Select a PDF file from your computer or drag and drop it here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedFile ? (
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg mb-2">Drop your PDF file here</p>
              <p className="text-muted-foreground mb-4">or</p>
              <Button
                onClick={(e) => {
                  e.stopPropagation(); // Prevent the parent div's onClick
                  fileInputRef.current?.click();
                }}
                variant="outline"
              >
                Browse Files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <p className="text-sm text-muted-foreground mt-4">
                Supports PDF files up to 10MB
              </p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <File className="h-8 w-8 text-primary" />
                  <div>
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    {isUploading && (
                      <p className="text-sm text-blue-600 flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Uploading...
                      </p>
                    )}
                    {uploadResult && !isUploading && (
                      <p className="text-sm text-green-600">✓ Uploaded successfully</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={removeFile}
                  disabled={isUploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {uploadError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{uploadError}</p>
            </div>
          )}

          {selectedFile && (
            <div className="flex justify-end mt-6">
              <Button 
                variant="outline" 
                onClick={handleProceed}
                disabled={isUploading || !uploadResult}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  'Proceed to Processing'
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
