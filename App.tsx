import { useState, useEffect, useCallback } from "react";
import LoginPage from "./components/LoginPage";
import { AuthCallback } from "./components/AuthCallback";
import { UploadPage } from "./components/UploadPage";
import { ProcessingPage } from "./components/ProcessingPage";
import { EntityExtractionPage } from "./components/EntityExtractionPage";
import { BatchStudySelectionPage } from "./components/BatchStudySelectionPage";
import { EvaluationPage } from "./components/EvaluationPage";
import { ExecutiveModePage } from "./components/ExecutiveModePage";

import { RainbowButton } from "./components/ui/rainbow-button";
import { Button } from "./components/ui/button";
import { Briefcase, LogOut } from "lucide-react";
import { ThemeProvider } from "./contexts/ThemeContext";
import { settingsManager } from "./components/SettingsManager";
import { supabase, Session } from "./lib/supabase";
import { signOut, getCurrentUser } from "./utils/authUtils";
import { Toaster } from "./components/ui/sonner";

export type Step =
  | "login"
  | "auth_callback"
  | "upload"
  | "processing"
  | "study_selection"
  | "extraction"
  | "evaluation"
  | "evaluation"
  | "executive";

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
  selectedModels?: string[];
  entities: Array<{
    name: string;
    prompt: string;
    extracted?: string;
    answer?: string;
    references?: any[];
    duration?: number;
    promptTokens?: number;
    completionTokens?: number;
    groundTruth?: string;
    extractionsByModel?: Record<
      string,
      {
        extracted: string;
        answer?: string;
        references?: any[];
        duration?: number;
        promptTokens?: number;
        completionTokens?: number;
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
      }
    >;
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
  finalSummary?: string;
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
  evaluationConfig?: {
    selectedMetrics?: string[];
    selectedModels?: string[];
    selectedProviders?: string[];
    customEvaluationSteps?: Record<string, string[]>;
    customPrompts?: Record<string, string[]>;
  };
  uploadedFiles?: Array<{
    file: File;
    fileId: string;
    entities?: any[];
    studyType?: string;
    selectedModel?: string;
    selectedModels?: string[];
    processingResult?: any;
    processorUsed?: string;
    uploadResult?: any;
    status?: "pending" | "processing" | "completed" | "error";
    selectedParser?: string;
    summaryPrompt?: string;
  }>;
}

// User info from Supabase session
interface UserInfo {
  id: string;
  email: string | undefined;
  name: string | undefined;
  avatar: string | undefined;
}

export default function App() {
  // Supabase session state
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  // Check if we're on the auth callback route
  const isAuthCallback =
    window.location.pathname === "/auth/callback" ||
    window.location.hash.includes("access_token");

  const [currentStep, setCurrentStep] = useState<Step>(
    isAuthCallback ? "auth_callback" : "upload"
  );
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

  // Initialize Supabase auth listener
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);

      // If we have a session and we're on callback, redirect to main app
      if (session && isAuthCallback) {
        // Clean up URL
        window.history.replaceState({}, document.title, "/");
        setCurrentStep("upload");
      }
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);

      if (session) {
        // If we just logged in, go to upload
        if (currentStep === "login" || currentStep === "auth_callback") {
          // Clean up URL if needed
          if (
            window.location.pathname === "/auth/callback" ||
            window.location.hash.includes("access_token")
          ) {
            window.history.replaceState({}, document.title, "/");
          }
          setCurrentStep("upload");
        }
      } else {
        // Session ended, show login
        setCurrentStep("login");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch user info when session changes
  useEffect(() => {
    if (session) {
      getCurrentUser().then(setUserInfo);
      // Refresh server config after successful login
      settingsManager.refreshServerConfig();
    } else {
      setUserInfo(null);
    }
  }, [session]);

  const handleAuthSuccess = useCallback(() => {
    // Clean up URL
    window.history.replaceState({}, document.title, "/");
    setCurrentStep("upload");
  }, []);

  const handleAuthError = useCallback((error: string) => {
    console.error("Auth error:", error);
    // Clean up URL and redirect to login
    window.history.replaceState({}, document.title, "/");
    setCurrentStep("login");
  }, []);

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

  const handleLogout = async () => {
    await signOut();
    setSession(null);
    setCurrentStep("login");
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
    } else if (currentStep === "executive") {
      setCurrentStep("upload");
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case "auth_callback":
        return (
          <AuthCallback
            onSuccess={handleAuthSuccess}
            onError={handleAuthError}
          />
        );
      case "executive":
        return <ExecutiveModePage onBack={handleBack} />;
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

      default:
        return null;
    }
  };

  // Show loading state while checking session
  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="mx-auto w-12 h-12 relative">
            <div className="absolute inset-0 rounded-full border-4 border-primary/20"></div>
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
          </div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show auth callback page if processing OAuth
  if (currentStep === "auth_callback") {
    return (
      <AuthCallback onSuccess={handleAuthSuccess} onError={handleAuthError} />
    );
  }

  // Show login if no session
  if (!session) {
    return <LoginPage />;
  }

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
          <div className="container mx-auto px-4 py-6">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-medium text-foreground">
                AI Toxicology Extraction and Summarization
              </h1>
              <div className="flex items-center gap-2">
                {currentStep !== "executive" && (
                  <RainbowButton
                    size="sm"
                    onClick={() => setCurrentStep("executive")}
                    className="!rounded-md"
                  >
                    <Briefcase className="h-4 w-4 mr-2" />
                    Executive Mode
                  </RainbowButton>
                )}

                <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
                  {userInfo?.avatar && (
                    <img
                      src={userInfo.avatar}
                      alt={userInfo.name || "User"}
                      className="w-8 h-8 rounded-full border border-border"
                    />
                  )}
                  {userInfo?.name && (
                    <span className="text-sm text-muted-foreground hidden md:inline">
                      {userInfo.name}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleLogout}
                    title="Logout"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            {currentStep !== "executive" && (
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
