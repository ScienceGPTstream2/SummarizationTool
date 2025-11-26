import { useState } from "react";
import LoginPage from "./components/LoginPage";
import { UploadPage } from "./components/UploadPage";
import { ProcessingPage } from "./components/ProcessingPage";
import { EntityExtractionPage } from "./components/EntityExtractionPage";
import { BatchStudySelectionPage } from "./components/BatchStudySelectionPage";
import { EvaluationPage } from "./components/EvaluationPage";
import { SettingsPage } from "./components/SettingsPage";
import { Button } from "./components/ui/button";
import { Settings, ArrowLeft } from "lucide-react";
import { ThemeProvider } from "./contexts/ThemeContext";
import { settingsManager } from "./components/SettingsManager";
import { getValidToken } from "./utils/authUtils";
import { Toaster } from "./components/ui/sonner";

export type Step =
  | "login"
  | "upload"
  | "processing"
  | "study_selection"
  | "extraction"
  | "evaluation"
  | "settings";

export interface DocumentData {
  file: File | null;
  fileId?: string;
  uploadResult?: any;
  parser: string;
  extractedText: string;
  annotatedOutput: string;
  studyType: string;
  summaryPrompt?: string;
  selectedModel: string;
  entities: Array<{
    name: string;
    prompt: string;
    extracted?: string;
    duration?: number;
    promptTokens?: number;
    completionTokens?: number;
    groundTruth?: string;
    evaluationResults?: Array<{
      provider: string;
      model: string;
      metrics: Array<{
        metric_name: string;
        score: number;
        threshold: number;
        success: boolean;
        reason: string;
      }>;
      aggregate_score: number;
      all_passed: boolean;
      evaluation_time: number;
    }>;
  }>;
  finalSummary: string;
  conversionId?: string;
  markdownPath?: string;
  processorUsed?: string;
  figures?: Array<{
    id: string;
    page: number | null;
    caption: string | null;
    image_path?: string;
    bounding_regions?: Array<{
      page_number: number;
      polygon: number[];
    }>;
  }>;
  figuresCount?: number;
  tablesCount?: number;
  showResults?: boolean;
  // Evaluation configuration
  evaluationConfig?: {
    selectedMetrics?: string[];
    selectedProviders?: string[];
    customEvaluationSteps?: Record<string, string[]>;
  };
  uploadedFiles?: Array<{
    file: File;
    fileId: string;
    uploadResult: any;
    status?: "pending" | "processing" | "completed" | "error";
    processingResult?: {
      conversionId?: string;
      markdownPath?: string;
      processorUsed?: string;
      figures?: any[];
      figuresCount?: number;
      tablesCount?: number;
      extractedText?: string;
    };
    // Extraction configuration and results
    studyType?: string;
    selectedModel?: string;
    entities?: Array<{
      name: string;
      prompt: string;
      extracted?: string;
      answer?: string;
      references?: any[];
      duration?: number;
      promptTokens?: number;
      completionTokens?: number;
      groundTruth?: string;
      evaluationResults?: any[];
    }>;
    summaryPrompt?: string;
    finalSummary?: string;

    selectedParser?: string;
    error?: string;
  }>;
}

export default function App() {
  // Check token validity on mount - automatically clears expired tokens
  const [token, setToken] = useState<string | null>(getValidToken());
  const [currentStep, setCurrentStep] = useState<Step>("upload");
  const [previousStep, setPreviousStep] = useState<Step>("upload");
  const [documentData, setDocumentData] = useState<DocumentData>({
    file: null,
    parser: "",
    extractedText: "",
    annotatedOutput: "",
    studyType: "",
    selectedModel: "",
    entities: [],
    finalSummary: "",
    uploadedFiles: [],
  });

  const handleLogin = async (jwt: string) => {
    setToken(jwt);
    localStorage.setItem("token", jwt);
    // Refresh server config after successful login
    await settingsManager.refreshServerConfig();
  };

  const handleStepComplete = (step: Step, data: Partial<DocumentData>) => {
    setDocumentData((prev) => ({ ...prev, ...data }));
    if (step === "upload") {
      setCurrentStep("processing");
    } else if (step === "processing") {
      setCurrentStep("study_selection");
    } else if (step === "study_selection") {
      setCurrentStep("extraction");
    } else if (step === "extraction") {
      setCurrentStep("evaluation");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setToken(null);
  };

  const handleBack = () => {
    if (currentStep === "processing") {
      setCurrentStep("upload");
    } else if (currentStep === "study_selection") {
      setCurrentStep("processing");
    } else if (currentStep === "extraction") {
      setCurrentStep("study_selection");
    } else if (currentStep === "evaluation") {
      setCurrentStep("extraction");
    } else if (currentStep === "settings") {
      setCurrentStep(previousStep);
    }
  };

  const handleSettingsClick = () => {
    if (currentStep !== "settings") {
      setPreviousStep(currentStep);
    }
    setCurrentStep("settings");
  };

  const renderStep = () => {
    switch (currentStep) {
      case "upload":
        return (
          <UploadPage
            onComplete={(data) => handleStepComplete("upload", data)}
            documentData={documentData}
          />
        );
      case "processing":
        return (
          <ProcessingPage
            onComplete={(data) => handleStepComplete("processing", data)}
            onBack={handleBack}
            documentData={documentData}
          />
        );
      case "study_selection":
        return (
          <BatchStudySelectionPage
            onBack={handleBack}
            onComplete={(data) => handleStepComplete("study_selection", data)}
            documentData={documentData}
          />
        );
      case "extraction":
        return (
          <EntityExtractionPage
            onBack={handleBack}
            onComplete={(data) => handleStepComplete("extraction", data)}
            documentData={documentData}
            setDocumentData={setDocumentData}
          />
        );
      case "evaluation":
        return (
          <EvaluationPage
            onBack={handleBack}
            documentData={documentData}
            setDocumentData={setDocumentData}
          />
        );
      case "settings":
        return <SettingsPage onBack={handleBack} />;
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
        <header className="border-b border-border sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
          <div className="container mx-auto px-4 py-6">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-medium text-foreground">
                AI Document Summarization Tool
              </h1>
              {currentStep === "settings" ? (
                <Button variant="outline" size="sm" onClick={handleBack}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              ) : (
                <div className="flex items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSettingsClick}
                    className="mr-2"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLogout}>
                    Logout
                  </Button>
                </div>
              )}
            </div>
            {currentStep !== "settings" && (
              <div className="flex items-center gap-4 mt-2">
                <div
                  className={`flex items-center gap-2 ${currentStep === "upload" ? "text-foreground" : "text-muted-foreground"}`}
                >
                  <div
                    className={`w-3 h-3 rounded-full ${currentStep === "upload" ? "bg-red-500" : "bg-muted"}`}
                  />
                  <span className="text-sm">Upload</span>
                </div>
                <div
                  className={`flex items-center gap-2 ${currentStep === "processing" ? "text-foreground" : "text-muted-foreground"}`}
                >
                  <div
                    className={`w-3 h-3 rounded-full ${currentStep === "processing" ? "bg-red-500" : "bg-muted"}`}
                  />
                  <span className="text-sm">Processing</span>
                </div>
                <div
                  className={`flex items-center gap-2 ${currentStep === "study_selection" ? "text-foreground" : "text-muted-foreground"}`}
                >
                  <div
                    className={`w-3 h-3 rounded-full ${currentStep === "study_selection" ? "bg-red-500" : "bg-muted"}`}
                  />
                  <span className="text-sm">Study Selection</span>
                </div>
                <div
                  className={`flex items-center gap-2 ${currentStep === "extraction" ? "text-foreground" : "text-muted-foreground"}`}
                >
                  <div
                    className={`w-3 h-3 rounded-full ${currentStep === "extraction" ? "bg-red-500" : "bg-muted"}`}
                  />
                  <span className="text-sm">Entity Extraction</span>
                </div>
                <div
                  className={`flex items-center gap-2 ${currentStep === "evaluation" ? "text-foreground" : "text-muted-foreground"}`}
                >
                  <div
                    className={`w-3 h-3 rounded-full ${currentStep === "evaluation" ? "bg-red-500" : "bg-muted"}`}
                  />
                  <span className="text-sm">Evaluation</span>
                </div>
              </div>
            )}
          </div>
        </header>
        <main className="container mx-auto px-4 py-8 bg-background">
          {renderStep()}
        </main>
        <Toaster />
      </div>
    </ThemeProvider>
  );
}
