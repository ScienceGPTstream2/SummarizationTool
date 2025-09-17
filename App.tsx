import React, { useState } from 'react';
import LoginPage from './components/LoginPage';
import { UploadPage } from './components/UploadPage';
import { ProcessingPage } from './components/ProcessingPage';
import { EntityExtractionPage } from './components/EntityExtractionPage';
import { SettingsPage } from './components/SettingsPage';
import { Button } from './components/ui/button';
import { Settings, ArrowLeft } from 'lucide-react';
import { ThemeProvider } from './contexts/ThemeContext';

export type Step = 'login' | 'upload' | 'processing' | 'extraction' | 'settings';

export interface DocumentData {
  file: File | null;
  fileId?: string;
  uploadResult?: any;
  parser: string;
  extractedText: string;
  annotatedOutput: string;
  studyType: string;
  selectedModel: string;
  entities: Array<{
    name: string;
    prompt: string;
    extracted?: string;
    duration?: number;
    promptTokens?: number;
    completionTokens?: number;
  }>;
  finalSummary: string;
  conversionId?: string;
  markdownPath?: string;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [previousStep, setPreviousStep] = useState<Step>('upload');
  const [documentData, setDocumentData] = useState<DocumentData>({
    file: null,
    parser: '',
    extractedText: '',
    annotatedOutput: '',
    studyType: '',
    selectedModel: '',
    entities: [],
    finalSummary: ''
  });

  const handleLogin = (jwt: string) => {
    setToken(jwt);
    localStorage.setItem('token', jwt);
  };

  const handleStepComplete = (step: Step, data: Partial<DocumentData>) => {
    setDocumentData(prev => ({ ...prev, ...data }));
    if (step === 'upload') {
      setCurrentStep('processing');
    } else if (step === 'processing') {
      setCurrentStep('extraction');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
  };

  const handleBack = () => {
    if (currentStep === 'processing') {
      setCurrentStep('upload');
    } else if (currentStep === 'extraction') {
      setCurrentStep('processing');
    } else if (currentStep === 'settings') {
      setCurrentStep(previousStep);
    }
  };

  const handleSettingsClick = () => {
    if (currentStep !== 'settings') {
      setPreviousStep(currentStep);
    }
    setCurrentStep('settings');
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'upload':
        return (
          <UploadPage
            onComplete={(data) => handleStepComplete('upload', data)}
            documentData={documentData}
          />
        );
      case 'processing':
        return (
          <ProcessingPage
            onComplete={(data) => handleStepComplete('processing', data)}
            onBack={handleBack}
            documentData={documentData}
          />
        );
      case 'extraction':
        return (
          <EntityExtractionPage
            onBack={handleBack}
            documentData={documentData}
            setDocumentData={setDocumentData}
          />
        );
      case 'settings':
        return (
          <SettingsPage
            onBack={handleBack}
          />
        );
      default:
        return null;
    }
  };

  if (!token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-medium text-foreground">AI Document Summarization Tool</h1>
              {currentStep === 'settings' ? (
                <Button variant="outline" size="sm" onClick={handleBack}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              ) : (
                <div className="flex items-center">
                  <Button variant="outline" size="sm" onClick={handleSettingsClick} className="mr-2">
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLogout}>
                    Logout
                  </Button>
                </div>
              )}
            </div>
            {currentStep !== 'settings' && (
              <div className="flex items-center gap-4 mt-2">
                <div className={`flex items-center gap-2 ${currentStep === 'upload' ? 'text-foreground' : 'text-muted-foreground'}`}>
                  <div className={`w-3 h-3 rounded-full ${currentStep === 'upload' ? 'bg-red-500' : 'bg-muted'}`} />
                  <span className="text-sm">Upload</span>
                </div>
                <div className={`flex items-center gap-2 ${currentStep === 'processing' ? 'text-foreground' : 'text-muted-foreground'}`}>
                  <div className={`w-3 h-3 rounded-full ${currentStep === 'processing' ? 'bg-red-500' : 'bg-muted'}`} />
                  <span className="text-sm">Processing</span>
                </div>
                <div className={`flex items-center gap-2 ${currentStep === 'extraction' ? 'text-foreground' : 'text-muted-foreground'}`}>
                  <div className={`w-3 h-3 rounded-full ${currentStep === 'extraction' ? 'bg-red-500' : 'bg-muted'}`} />
                  <span className="text-sm">Entity Extraction</span>
                </div>
              </div>
            )}
          </div>
        </header>
        <main className="container mx-auto px-4 py-8 bg-background">
          {renderStep()}
        </main>
      </div>
    </ThemeProvider>
  );
}
