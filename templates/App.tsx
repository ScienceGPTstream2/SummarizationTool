import React, { useState } from "react";
import { UploadPage } from "./components/UploadPage";
import { ProcessingPage } from "./components/ProcessingPage";
import { EntityExtractionPage } from "./components/EntityExtractionPage";
import { SettingsPage } from "./components/SettingsPage";
import { Button } from "./components/ui/button";
import { Settings } from "lucide-react";

export type Step = "upload" | "processing" | "extraction" | "settings";

export interface DocumentData {
  file: File | null;
  parser: string;
  extractedText: string;
  annotatedOutput: string;
  studyType: string;
  selectedModel: string;
  entities: Array<{ name: string; prompt: string; extracted?: string }>;
  finalSummary: string;
}

export default function App() {
  const [currentStep, setCurrentStep] = useState<Step>("upload");
  const [documentData, setDocumentData] = useState<DocumentData>({
    file: null,
    parser: "",
    extractedText: "",
    annotatedOutput: "",
    studyType: "",
    selectedModel: "",
    entities: [],
    finalSummary: "",
  });

  const handleStepComplete = (step: Step, data: Partial<DocumentData>) => {
    setDocumentData((prev) => ({ ...prev, ...data }));

    if (step === "upload") {
      setCurrentStep("processing");
    } else if (step === "processing") {
      setCurrentStep("extraction");
    }
  };

  const handleBack = () => {
    if (currentStep === "processing") {
      setCurrentStep("upload");
    } else if (currentStep === "extraction") {
      setCurrentStep("processing");
    } else if (currentStep === "settings") {
      setCurrentStep("upload");
    }
  };

  const handleSettingsClick = () => {
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
      case "extraction":
        return (
          <EntityExtractionPage
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-medium">
              AI Document Summarization Tool
            </h1>
            <Button variant="outline" size="sm" onClick={handleSettingsClick}>
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          </div>

          {currentStep !== "settings" && (
            <div className="flex items-center gap-4 mt-2">
              <div
                className={`flex items-center gap-2 ${currentStep === "upload" ? "text-primary" : currentStep === "processing" || currentStep === "extraction" ? "text-muted-foreground" : "text-muted-foreground"}`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${currentStep === "upload" ? "bg-primary" : "bg-muted"}`}
                />
                <span className="text-sm">Upload</span>
              </div>
              <div
                className={`flex items-center gap-2 ${currentStep === "processing" ? "text-primary" : currentStep === "extraction" ? "text-muted-foreground" : "text-muted-foreground"}`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${currentStep === "processing" ? "bg-primary" : "bg-muted"}`}
                />
                <span className="text-sm">Processing</span>
              </div>
              <div
                className={`flex items-center gap-2 ${currentStep === "extraction" ? "text-primary" : "text-muted-foreground"}`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${currentStep === "extraction" ? "bg-primary" : "bg-muted"}`}
                />
                <span className="text-sm">Entity Extraction</span>
              </div>
            </div>
          )}
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">{renderStep()}</main>
    </div>
  );
}
