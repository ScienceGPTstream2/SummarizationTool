import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import LoginPage from "./components/LoginPage";
import { AuthCallback } from "./components/AuthCallback";
import { UploadPage } from "./components/UploadPage";
import { ProcessingPage } from "./components/ProcessingPage";
import { EntityExtractionPage } from "./components/EntityExtractionPage";
import { BatchStudySelectionPage } from "./components/BatchStudySelectionPage";
import { EvaluationPage } from "./components/EvaluationPage";
import { ExecutiveModePage } from "./components/ExecutiveModePage";
import { SessionHistoryPage } from "./components/SessionHistoryPage";
import { TemplateWorkspacePage } from "./components/TemplateWorkspace/TemplateWorkspacePage";
import { GroupManagementPage } from "./components/GroupManagement/GroupManagementPage";
import { SimplifiedFlowPage } from "./components/SimplifiedFlowPage";

// import { RainbowButton } from "./components/ui/rainbow-button"; // hidden for demo
import { Button } from "./components/ui/button";
import {
  // Briefcase, // hidden for demo
  LogOut,
  Clock,
  FileText,
  Users,
  Check,
  AlertTriangle,
  Loader2,
  Zap,
  Settings2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./components/ui/alert-dialog";
import { ThemeProvider } from "./contexts/ThemeContext";
import { settingsManager } from "./components/SettingsManager";
import {
  signOut,
  getCurrentUser,
  getValidToken,
  getSession,
  authenticatedFetch,
  installVisibilityRefreshListener,
  Session,
} from "./utils/authUtils";
import { Toaster, toast } from "./components/ui/sonner";
import { SessionMetrics } from "./components/SessionMetrics";

export type Step =
  | "login"
  | "auth_callback"
  | "simplified"
  | "upload"
  | "processing"
  | "study_selection"
  | "extraction"
  | "evaluation"
  | "executive"
  | "history"
  | "templates"
  | "groups";

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
    selectedSourceModels?: string[];
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
    finalSummary?: string;
    paragraphSummaryModel?: string;
    paragraphSummaryCost?: number;
    paragraphEvaluation?: {
      groundTruth: string;
      humanScore: number | null;
    };
    summariesByModel?: Record<string, string>;
    paragraphSystemPrompt?: string;
    modelTemperatures?: Record<string, number>;
  }>;
  sessionId?: string;
  temperature?: number;
  modelTemperatures?: Record<string, number>;
  // Shared session tracking — when set, the workspace was loaded from a
  // shared session and no own session has been created yet. The first write
  // operation (extraction, evaluation) will create a clone named
  // "Copy of [sharedSourceName]".
  sharedSourceName?: string;
}

// User info from Supabase session
interface UserInfo {
  id: string;
  email: string | undefined;
  name: string | undefined;
  avatar: string | undefined;
}

const WORKFLOW_STEPS: Step[] = [
  "upload",
  "processing",
  "study_selection",
  "extraction",
  "evaluation",
];

const WORKFLOW_STEP_LABELS: Record<string, string> = {
  upload: "Upload",
  processing: "Processing",
  study_selection: "Study Selection",
  extraction: "Entity Extraction",
  evaluation: "Evaluation",
};

function getStepIndex(step: Step): number {
  return WORKFLOW_STEPS.indexOf(step);
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
    isAuthCallback ? "auth_callback" : "simplified"
  );
  // Ref that always holds the current step — used in the onAuthStateChange closure
  // (which has [] deps and captures the initial value) to avoid stale closure bugs.
  const currentStepRef = useRef<Step>(currentStep);
  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);

  // Tracks the last workflow step before jumping to a tool overlay (templates/groups/history/executive).
  // Used so Back buttons on those pages return to the right place.
  const [previousWorkflowStep, setPreviousWorkflowStep] =
    useState<Step>("simplified");

  // Track which workflow step currently has an in-flight operation
  const [inFlightStep, setInFlightStep] = useState<Step | null>(null);
  // Confirmation dialog for rerunning intermediate stages
  const [rerunConfirm, setRerunConfirm] = useState<{
    open: boolean;
    targetStep: Step;
    message: string;
  }>({ open: false, targetStep: "upload", message: "" });
  // Confirmation dialog for navigating away while a request is in flight
  const [navAwayConfirm, setNavAwayConfirm] = useState<{
    open: boolean;
    targetStep: Step;
    message: string;
  }>({ open: false, targetStep: "upload", message: "" });

  // Tracks steps whose downstream results have been invalidated by user changes
  // (e.g. deleting an entity on extraction invalidates evaluation)
  const [staleDownstream, setStaleDownstream] = useState<Set<Step>>(new Set());

  // Called by child pages when they make changes that invalidate later stages
  const invalidateDownstream = useCallback((fromStep: Step) => {
    const fromIdx = getStepIndex(fromStep);
    if (fromIdx < 0) return;
    setStaleDownstream((prev) => {
      const next = new Set(prev);
      for (let i = fromIdx + 1; i < WORKFLOW_STEPS.length; i++) {
        next.add(WORKFLOW_STEPS[i]);
      }
      return next;
    });
  }, []);

  // Clear stale flag only for the step that just completed
  const clearStaleFrom = useCallback((completedStep: Step) => {
    setStaleDownstream((prev) => {
      const next = new Set(prev);
      next.delete(completedStep);
      return next;
    });
  }, []);

  // Wrapper so navigating to a tool page always records where we came from
  const navigateTo = (step: Step) => {
    const toolOnlySteps: Step[] = [
      "templates",
      "groups",
      "history",
      "executive",
    ];
    if (toolOnlySteps.includes(step)) {
      if (!toolOnlySteps.includes(currentStep)) {
        setPreviousWorkflowStep(currentStep);
      }
    }
    setCurrentStep(step);
  };

  const isSimplifiedMode = currentStep === "simplified";
  const isAdvancedWorkflow = WORKFLOW_STEPS.includes(currentStep);

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

  // Derive which workflow steps have been completed from documentData
  const completedSteps = useMemo(() => {
    const completed = new Set<Step>();
    const files = documentData.uploadedFiles || [];

    // Upload is complete if we have files
    if (files.length > 0) {
      completed.add("upload");
    }

    // Processing is complete if all files have processingResult
    if (files.length > 0 && files.every((f) => f.processingResult)) {
      completed.add("processing");
    }

    // Study selection is complete if files have studyType and at least one model is selected
    if (
      files.length > 0 &&
      files.every((f) => f.studyType) &&
      (documentData.selectedModels?.length ||
        files.some((f) => f.selectedModels?.length))
    ) {
      completed.add("study_selection");
    }

    // Extraction is complete if any file has extracted entities
    if (
      files.length > 0 &&
      files.some(
        (f) =>
          f.entities?.some(
            (e: any) =>
              e.extracted ||
              (e.extractionsByModel &&
                Object.keys(e.extractionsByModel).length > 0)
          ) ||
          f.finalSummary ||
          (f.summariesByModel && Object.keys(f.summariesByModel).length > 0)
      )
    ) {
      completed.add("extraction");
    }

    // Evaluation is complete if any entity has evaluationResults
    if (
      files.length > 0 &&
      files.some((f) =>
        f.entities?.some(
          (e: any) =>
            e.evaluationResults?.length > 0 ||
            (e.extractionsByModel &&
              Object.values(e.extractionsByModel).some(
                (ext: any) => ext.evaluationResults?.length > 0
              ))
        )
      )
    ) {
      completed.add("evaluation");
    }

    return completed;
  }, [documentData]);

  // The highest step index that has been completed (for determining reachable steps)
  const highestReachableStepIndex = useMemo(() => {
    let highest = -1;
    for (let i = 0; i < WORKFLOW_STEPS.length; i++) {
      if (completedSteps.has(WORKFLOW_STEPS[i])) {
        // Can reach the next step after a completed one
        highest = Math.max(highest, i + 1);
      }
    }
    // Also consider the current step as reachable
    const currentIdx = getStepIndex(currentStep);
    if (currentIdx >= 0) {
      highest = Math.max(highest, currentIdx);
    }
    return Math.min(highest, WORKFLOW_STEPS.length - 1);
  }, [completedSteps, currentStep]);

  // Ref to prevent duplicate session creation
  const sessionCreationInProgressRef = useRef(false);
  const restoringSessionRef = useRef(false);

  // Initialize Better Auth session check
  useEffect(() => {
    // Check if we have a valid session on mount
    getSession()
      .then((session: Session | null) => {
        setSession(session);
        setLoading(false);

        // If we have a session and we're on callback, redirect to main app
        if (session && isAuthCallback) {
          window.history.replaceState({}, document.title, "/");
          setCurrentStep("simplified");
        }
      })
      .catch(() => {
        setSession(null);
        setLoading(false);
      });
  }, []);

  // ─── Fix: Proactive token refresh on tab visibility change ──────────
  // Chrome throttles timers in backgrounded tabs, so Supabase's
  // autoRefreshToken may not fire. This listener ensures we refresh
  // the token immediately when the user switches back to the tab.
  useEffect(() => {
    installVisibilityRefreshListener();
  }, []);

  // ─── Fix: Persist session state to localStorage as a safety net ─────
  // If a page reload somehow happens (browser crash, accidental refresh,
  // or a clearTokenAndReload that we missed), we can auto-restore the
  // user to their last step + session instead of dumping them at upload.
  const PERSISTED_STATE_KEY = "app_persisted_state";

  // Save currentStep + sessionId whenever they change
  useEffect(() => {
    const nonPersistableSteps: Step[] = ["login", "auth_callback"];
    if (!nonPersistableSteps.includes(currentStep)) {
      try {
        localStorage.setItem(
          PERSISTED_STATE_KEY,
          JSON.stringify({
            currentStep,
            sessionId: documentData.sessionId || null,
            timestamp: Date.now(),
          })
        );
      } catch {
        // localStorage full or unavailable — not critical
      }
    }
  }, [currentStep, documentData.sessionId]);

  // On mount, if we have a valid auth session AND persisted state, auto-restore
  useEffect(() => {
    if (!session || isAuthCallback) return;

    try {
      const raw = localStorage.getItem(PERSISTED_STATE_KEY);
      if (!raw) return;

      const persisted = JSON.parse(raw);
      const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
      if (Date.now() - persisted.timestamp > MAX_AGE_MS) {
        localStorage.removeItem(PERSISTED_STATE_KEY);
        return;
      }

      const restoredStep = persisted.currentStep as Step;
      const restoredSessionId = persisted.sessionId as string | null;

      // Only auto-restore if we're currently at upload (default) and
      // the persisted step is a workflow step with a session
      const workflowSteps: Step[] = [
        "study_selection",
        "extraction",
        "evaluation",
      ];
      if (
        (currentStep === "simplified" || currentStep === "upload") &&
        restoredSessionId &&
        workflowSteps.includes(restoredStep)
      ) {
        console.log(
          `[App] Auto-restoring from persisted state: step=${restoredStep}, session=${restoredSessionId}`
        );
        // Use the existing handleRestoreSession which fetches full data from the API
        handleRestoreSession(restoredSessionId);
      }
    } catch {
      // Corrupted localStorage — ignore
    }
  }, [session]); // Only run when session becomes available

  useEffect(() => {
    if (session) {
      getCurrentUser().then(setUserInfo);
      // Refresh server config after successful login
      settingsManager.refreshServerConfig();
    } else {
      setUserInfo(null);
    }
  }, [session]);

  // Auto-save current step to session
  // Exclude pages that shouldn't be restored to
  const nonRestorableSteps = ["login", "history", "auth_callback"];
  useEffect(() => {
    if (
      documentData.sessionId &&
      userInfo &&
      !nonRestorableSteps.includes(currentStep)
    ) {
      const syncStep = async () => {
        try {
          const token = await getValidToken();
          if (!token) return;

          await fetch(`/api/sessions/${documentData.sessionId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              user_id: userInfo.id,
              last_step: currentStep,
            }),
          });
          console.log("✅ Current step persisted:", currentStep);
        } catch (error) {
          console.error("Failed to persist current step:", error);
        }
      };
      syncStep();
    }
  }, [currentStep, documentData.sessionId, userInfo]);

  const handleAuthSuccess = useCallback(() => {
    // Clean up URL
    window.history.replaceState({}, document.title, "/");
    setCurrentStep("simplified");
  }, []);

  const handleAuthError = useCallback((error: string) => {
    console.error("Auth error:", error);
    // Clean up URL and redirect to login
    window.history.replaceState({}, document.title, "/");
    setCurrentStep("login");
  }, []);

  const handleStepComplete = async (
    step: Step,
    data: Partial<DocumentData>
  ) => {
    let updatedData = { ...data };

    if (
      step === "upload" &&
      data.uploadedFiles &&
      data.uploadedFiles.length > 0 &&
      !documentData.sessionId && // Only create if no session exists yet
      !sessionCreationInProgressRef.current // Prevent duplicate creation
    ) {
      // Create a session immediately after upload
      sessionCreationInProgressRef.current = true;
      try {
        const token = await import("./utils/authUtils").then((m) =>
          m.getValidToken()
        );
        if (token && userInfo) {
          // Generate a friendly session name with date/time
          const now = new Date();
          const dateStr = now.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
          const fileCount = data.uploadedFiles.length;
          const sessionName =
            fileCount === 1
              ? `Extraction - ${dateStr}`
              : `Batch (${fileCount} files) - ${dateStr}`;

          const response = await fetch("/api/sessions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              user_id: userInfo.id,
              name: sessionName,
              configuration: {
                // Initialize with defaults, will be updated in later steps
                study_type: "",
                selected_models: [],
                entities: [],
                temperature: 0.0,
                model_temperatures: {},
              },
              documents: data.uploadedFiles.map((f) => ({
                file_hash: f.fileId,
                filename: f.file.name,
                processor_used: f.processingResult?.processorUsed ?? null,
                parse_cost:
                  f.processingResult?.parseCost ||
                  f.processingResult?.parse_cost ||
                  null,
                page_count:
                  f.processingResult?.pageCount ??
                  f.processingResult?.page_count ??
                  null,
                parse_duration_seconds:
                  f.processingResult?.parseDuration ??
                  f.processingResult?.parse_duration_seconds ??
                  null,
              })),
            }),
          });

          if (response.ok) {
            const sessionData = await response.json();
            const newSessionId = sessionData.session_id;
            console.log("✅ Early session created:", newSessionId);

            updatedData.sessionId = newSessionId;

            // Fetch session back to get recomputed parse_cost values from DB
            // (same _db_to_session recompute path used by history restore)
            try {
              const sessionDetailRes = await fetch(
                `/api/sessions/${newSessionId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (sessionDetailRes.ok) {
                const sessionDetail = await sessionDetailRes.json();
                const docs = sessionDetail.documents || [];
                if (updatedData.uploadedFiles && docs.length > 0) {
                  for (const uf of updatedData.uploadedFiles) {
                    const matchDoc = docs.find(
                      (d: any) => d.file_hash === uf.fileId
                    );
                    if (matchDoc?.parse_cost) {
                      if (!uf.processingResult) uf.processingResult = {} as any;
                      uf.processingResult.parseCost = matchDoc.parse_cost;
                      uf.processingResult.parse_cost = matchDoc.parse_cost;
                    }
                    if (matchDoc?.parse_duration_seconds) {
                      if (!uf.processingResult) uf.processingResult = {} as any;
                      uf.processingResult.parseDuration =
                        matchDoc.parse_duration_seconds;
                      uf.processingResult.parse_duration_seconds =
                        matchDoc.parse_duration_seconds;
                    }
                  }
                }
              }
            } catch (e) {
              console.warn(
                "Could not fetch session for parse_cost backfill:",
                e
              );
            }

            // CRITICAL: Update state immediately so the persistence useEffect has the ID
            setDocumentData((prev) => ({ ...prev, sessionId: newSessionId }));

            toast.success("Session created");
          }
        }
      } catch (error) {
        console.error("Failed to create early session:", error);
        // Continue anyway, we can retry later or fallback to lazy creation
      } finally {
        sessionCreationInProgressRef.current = false;
      }
    } else if (step === "study_selection" && documentData.sessionId) {
      // Update session with study type and models
      try {
        const token = await import("./utils/authUtils").then((m) =>
          m.getValidToken()
        );
        if (token && userInfo) {
          // We need to merge existing config with new updates
          // For now, just sending what we know
          await fetch(`/api/sessions/${documentData.sessionId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              user_id: userInfo.id,
              status: "in_progress",
              configuration: {
                study_type:
                  data.studyType ||
                  documentData.studyType ||
                  data.uploadedFiles?.[0]?.studyType ||
                  "",
                selected_models:
                  data.selectedModels || documentData.selectedModels || [],
                // Preserve existing entities if any, or initialize empty
                entities: documentData.entities.map((e) => ({
                  name: e.name,
                  prompt: e.prompt,
                })),
                temperature: 0.0,
                model_temperatures: {},
              },
            }),
          });
          console.log("✅ Session updated with study selection");
        }
      } catch (error) {
        console.error("Failed to update session:", error);
      }
    }

    setDocumentData((prev) => ({ ...prev, ...updatedData }));

    // This step just produced fresh results — clear stale flag for it
    clearStaleFrom(step);

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
    // Clear persisted state so we don't auto-restore after explicit logout
    try {
      localStorage.removeItem(PERSISTED_STATE_KEY);
    } catch {}
    await signOut();
    setSession(null);
    setDocumentData({
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
    setCurrentStep("login");
  };

  const handleSessionDeleted = useCallback(
    async (_userId: string, sessionId: string) => {
      // If the deleted session is the currently active one, clear the workspace
      if (documentData.sessionId === sessionId) {
        console.log("Current session deleted, clearing workspace");
        setDocumentData({
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
        // Optional: Force switch to upload if not already there or in history
        if (currentStep !== "history") {
          setCurrentStep("upload");
        }
      }
    },
    [documentData.sessionId, currentStep]
  );

  // Navigate to a workflow step via the progress stepper
  const handleStepNavigate = useCallback(
    (targetStep: Step) => {
      const targetIdx = getStepIndex(targetStep);
      if (targetIdx < 0 || targetIdx > highestReachableStepIndex) return;
      if (targetStep === currentStep) return;

      // Warn if there's an in-flight operation on the current step
      if (inFlightStep) {
        setNavAwayConfirm({
          open: true,
          targetStep,
          message:
            "An operation is currently in progress. Navigating away may cause it to fail or produce incomplete results. Are you sure you want to leave?",
        });
        return;
      }

      setCurrentStep(targetStep);
    },
    [currentStep, highestReachableStepIndex, inFlightStep]
  );

  const handleBack = () => {
    // Warn if there's an in-flight operation
    if (inFlightStep && WORKFLOW_STEPS.includes(currentStep)) {
      const currentIdx = getStepIndex(currentStep);
      const prevStep = currentIdx > 0 ? WORKFLOW_STEPS[currentIdx - 1] : null;
      if (prevStep) {
        setNavAwayConfirm({
          open: true,
          targetStep: prevStep,
          message:
            "An operation is currently in progress. Navigating away may cause it to fail or produce incomplete results. Are you sure you want to go back?",
        });
        return;
      }
    }

    if (currentStep === "processing") {
      setCurrentStep("upload");
    } else if (currentStep === "study_selection") {
      setCurrentStep("processing");
    } else if (currentStep === "extraction") {
      setCurrentStep("study_selection");
    } else if (currentStep === "evaluation") {
      setCurrentStep("extraction");
    } else if (
      currentStep === "executive" ||
      currentStep === "templates" ||
      currentStep === "groups" ||
      currentStep === "history"
    ) {
      if (currentStep === "executive" || currentStep === "history") {
        setDocumentData({
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
        sessionCreationInProgressRef.current = false;
        import("./utils/session").then(({ resetSessionId }) => {
          resetSessionId();
        });
        setCurrentStep(
          previousWorkflowStep === "simplified" ? "simplified" : "upload"
        );
      } else {
        setCurrentStep(previousWorkflowStep);
      }
    }
  };

  // Navigate forward to the next step (used by child pages)
  const handleForward = useCallback(() => {
    const currentIdx = getStepIndex(currentStep);
    if (currentIdx >= 0 && currentIdx < WORKFLOW_STEPS.length - 1) {
      const nextStep = WORKFLOW_STEPS[currentIdx + 1];
      if (getStepIndex(nextStep) <= highestReachableStepIndex) {
        // Warn if in-flight
        if (inFlightStep) {
          setNavAwayConfirm({
            open: true,
            targetStep: nextStep,
            message:
              "An operation is currently in progress. Navigating away may cause it to fail or produce incomplete results. Are you sure you want to continue?",
          });
          return;
        }
        setCurrentStep(nextStep);
      }
    }
  }, [currentStep, highestReachableStepIndex, inFlightStep]);

  // Check if moving forward is possible (for child pages to show forward button)
  // Blocked if the next step has been invalidated by upstream changes
  const canNavigateForward = useMemo(() => {
    const currentIdx = getStepIndex(currentStep);
    if (currentIdx < 0 || currentIdx >= WORKFLOW_STEPS.length - 1) return false;
    const nextStep = WORKFLOW_STEPS[currentIdx + 1];
    if (staleDownstream.has(nextStep)) return false;
    return currentIdx + 1 <= highestReachableStepIndex;
  }, [currentStep, highestReachableStepIndex, staleDownstream]);

  // Helper: build DocumentData from a session API response (owned OR shared).
  // Does NOT set sessionId or sharedSourceName — callers apply those overrides.
  const buildRestoredDocumentData = async (
    sessionData: any
  ): Promise<Partial<DocumentData>> => {
    const config = sessionData.configuration || {};
    const evalConfig =
      sessionData.evaluation_config || config.evaluation_config || {};

    // Merge files_config from both sources:
    // - sessionData.files_config: Contains ground_truths (saved from EvaluationPage)
    // - config.files_config: Contains entities, study_type (saved from BatchStudySelectionPage)
    const topLevelFilesConfig = sessionData.files_config || {};
    const configFilesConfig = config.files_config || {};
    const filesConfig: Record<string, any> = {};

    // Merge all keys from both sources
    const allFileIds = new Set([
      ...Object.keys(topLevelFilesConfig),
      ...Object.keys(configFilesConfig),
    ]);
    allFileIds.forEach((fileId) => {
      filesConfig[fileId] = {
        ...(configFilesConfig[fileId] || {}),
        ...(topLevelFilesConfig[fileId] || {}),
      };
    });
    // RECOVERY: Reconstruct entities from extraction results when config is incomplete or mismatched
    let configEntities = config.entities || [];

    // Always check if extraction results have entities not in config
    if (sessionData.extraction_results?.length > 0) {
      const configEntityNames = new Set(configEntities.map((e: any) => e.name));
      const extractionEntityNames = new Set<string>(
        sessionData.extraction_results
          .map((r: any) => r.entity_name as string)
          .filter((name: string) => name !== "__paragraph_summary__")
      );

      // Check if there are entity names in results that aren't in config
      const missingFromConfig = [...extractionEntityNames].filter(
        (name) => !configEntityNames.has(name)
      );

      if (missingFromConfig.length > 0 || configEntities.length === 0) {
        console.warn(
          "Entity mismatch detected. Reconstructing from extraction results...",
          {
            configNames: [...configEntityNames],
            extractionNames: [...extractionEntityNames],
            missing: missingFromConfig,
          }
        );

        // Try to load template prompts if study type is available
        const studyType = sessionData.configuration.study_type;
        let templateEntities: any[] = [];
        if (studyType) {
          try {
            const { loadStudyTypeTemplate } = await import(
              "./components/TemplateLoader"
            );
            templateEntities = loadStudyTypeTemplate(studyType).entities;
          } catch (e) {
            console.warn("Failed to load template for recovery:", e);
          }
        }

        // Merge: keep existing config entities in order + add missing ones from extraction results
        // Use template entities for ordering if available, otherwise use configEntities order
        const orderedBaseEntities =
          templateEntities.length > 0 ? templateEntities : configEntities;

        // Start with ordered base entities
        const mergedEntities = orderedBaseEntities.map((te: any) => {
          // Use existing config entity if available
          const existingEntity = configEntities.find(
            (e: any) => e.name === te.name
          );
          return existingEntity || te;
        });

        // Add any entities from extraction results that aren't in the base
        const baseEntityNames = new Set(
          orderedBaseEntities.map((e: any) => e.name)
        );
        extractionEntityNames.forEach((name: string) => {
          if (!baseEntityNames.has(name)) {
            mergedEntities.push({
              name,
              prompt: "Restored from extraction result",
              system_prompt: "",
            });
          }
        });

        configEntities = mergedEntities;
      }
    }

    // Map session back to DocumentData
    const restoredData: Partial<DocumentData> = {
      studyType: sessionData.configuration.study_type || "",
      selectedModel: sessionData.configuration.selected_models[0] || "",
      selectedModels: sessionData.configuration.selected_models,
      summaryPrompt: sessionData.configuration.summary_prompt || "",
      temperature: sessionData.configuration.temperature ?? undefined,
      modelTemperatures: sessionData.configuration.model_temperatures || {},

      // Restore uploaded files with proper processing status
      uploadedFiles: sessionData.documents.map((doc: any) => {
        const fileConfig = filesConfig[doc.file_hash] || {};
        console.log(
          `[restore] Mapping document: ${doc.filename} (id=${doc.id}, hash=${doc.file_hash})`
        );

        return {
          file: new File([""], doc.filename, { type: "application/pdf" }),
          fileId: doc.file_hash,
          // Restore study type and summary prompt from file config
          studyType: fileConfig.study_type || config.study_type || "",
          summaryPrompt:
            fileConfig.summary_prompt || config.summary_prompt || "",
          // Reconstruct processing result enough for UI to look up file
          processingResult: {
            conversionId: doc.file_hash,
            fileHash: doc.file_hash,
            markdownPath: null,
            processorUsed:
              doc.processor_used ||
              fileConfig.processor_used ||
              "azure_doc_intelligence",
            parse_cost: doc.parse_cost ?? fileConfig.parse_cost ?? undefined,
            parseDuration: doc.parse_duration_seconds ?? undefined,
            // Include figure/table counts so ProcessingPage can lazy-fetch
            figuresCount: doc.figure_count ?? undefined,
            tablesCount: doc.table_count ?? undefined,
          },
          processorUsed:
            doc.processor_used || fileConfig.processor_used || undefined,
          paragraph_system_prompt:
            fileConfig.paragraph_system_prompt ||
            config.paragraph_system_prompt ||
            "",

          // Restore finalSummary from special hidden entity - MUST filter by document_id
          finalSummary:
            sessionData.extraction_results?.find(
              (r: any) =>
                r.entity_name === "__paragraph_summary__" &&
                r.document_id === doc.id
            )?.extracted_text || "",

          // Restore chosen paragraph summary model (prioritize the one with a saved score)
          paragraphSummaryModel: (() => {
            const scoredEval = sessionData.evaluation_results?.find(
              (ev: any) =>
                ev.entity_name === "__paragraph_summary__" &&
                ev.document_id === doc.id &&
                ev.human_score != null
            );
            if (scoredEval) return scoredEval.model_id;

            return (
              sessionData.extraction_results?.find(
                (r: any) =>
                  r.entity_name === "__paragraph_summary__" &&
                  r.document_id === doc.id
              )?.model_id || ""
            );
          })(),

          // Restore paragraph generation LLM cost
          paragraphSummaryCost:
            sessionData.extraction_results?.find(
              (r: any) =>
                r.entity_name === "__paragraph_summary__" &&
                r.document_id === doc.id
            )?.cost ?? undefined,

          // Restore paragraph evaluation record (ground truth + per-model human scores)
          paragraphEvaluation: (() => {
            const paragEvals =
              sessionData.evaluation_results?.filter(
                (ev: any) =>
                  ev.entity_name === "__paragraph_summary__" &&
                  ev.document_id === doc.id
              ) ?? [];

            if (paragEvals.length === 0) return undefined;

            const groundTruth = paragEvals[0].ground_truth || "";
            const humanScoreByModel: Record<string, number | null> = {};
            for (const ev of paragEvals) {
              if (ev.model_id) {
                humanScoreByModel[ev.model_id] =
                  ev.human_score != null
                    ? Math.round(ev.human_score * 100)
                    : null;
              }
            }
            return { groundTruth, humanScoreByModel };
          })(),

          // Restore per-model paragraph summaries
          summariesByModel: (() => {
            const summaries: Record<string, string> = {};
            sessionData.extraction_results
              ?.filter(
                (r: any) =>
                  r.entity_name === "__paragraph_summary__" &&
                  r.document_id === doc.id &&
                  r.extracted_text
              )
              .forEach((r: any) => {
                summaries[r.model_id] = r.extracted_text;
              });
            return summaries;
          })(),

          // Restore per-file, per-model temperatures from files_config
          modelTemperatures: fileConfig.model_temperatures || {},

          selectedModels: config.selected_models || [],
          status: "completed" as const,
          entities: (() => {
            // Get entity names that have extraction results for THIS document
            const docExtractionNames = new Set<string>(
              sessionData.extraction_results
                ?.filter(
                  (r: any) =>
                    r.document_id === doc.id &&
                    r.entity_name !== "__paragraph_summary__"
                )
                .map((r: any) => r.entity_name as string) || []
            );

            // Use config entities as the source of truth for ORDER
            // This preserves the original template/user-defined order
            const baseEntities = fileConfig.entities || configEntities || [];
            const configEntityNames = new Set(
              baseEntities.map((e: any) => e.name)
            );

            // Start with config entities in their original order
            const orderedEntities = [...baseEntities];

            // Append any entities from extraction results that aren't in config
            // (for backward compatibility with older sessions)
            docExtractionNames.forEach((entityName: string) => {
              if (!configEntityNames.has(entityName)) {
                orderedEntities.push({
                  name: entityName,
                  prompt: "Restored from extraction result",
                  system_prompt: "",
                });
              }
            });

            return orderedEntities;
          })().map((e: any) => {
            // Find extraction result for this entity
            const result = sessionData.extraction_results?.find(
              (r: any) => r.entity_name === e.name && r.document_id === doc.id
            );

            // Find evaluation results for this entity - MUST filter by document_id to avoid cross-file contamination
            const entityEvaluations =
              sessionData.evaluation_results?.filter(
                (ev: any) =>
                  ev.entity_name === e.name &&
                  (ev.document_id === doc.id || !ev.document_id) // Match by document or legacy (no doc_id)
              ) || [];

            // Extract ground truth from files_config first, then fallback to evaluation results
            const groundTruth =
              fileConfig.ground_truths?.[e.name] ||
              entityEvaluations.find((ev: any) => ev.ground_truth)
                ?.ground_truth ||
              "";

            // Group evaluation scores by model for reconstructing evaluationResults
            const evaluationsByJudge = entityEvaluations.reduce(
              (acc: any, ev: any) => {
                // The API returns nested scores array
                if (ev.scores && Array.isArray(ev.scores)) {
                  ev.scores.forEach((scoreItem: any) => {
                    const key =
                      scoreItem.judge_model || result?.model_id || "unknown"; // Use score's judge model or fallback
                    // Use ONLY per-score human_score to avoid cross-judge contamination
                    // Don't fall back to ev.human_score as it may contain another judge's score
                    const itemHumanScore = scoreItem.human_score;

                    if (!acc[key]) {
                      acc[key] = {
                        provider: scoreItem.judge_model?.includes("gemini")
                          ? "vertex_ai"
                          : "azure_openai",
                        model: scoreItem.judge_model || "unknown",
                        metrics: [],
                        aggregate_score: 0,
                        all_passed: true,
                        evaluation_time: scoreItem.evaluation_time || 0,
                        evaluation_cost: scoreItem.evaluation_cost || 0,
                        human_score: itemHumanScore,
                      };
                    } else {
                      // Accumulate cost and time from each metric
                      acc[key].evaluation_time +=
                        scoreItem.evaluation_time || 0;
                      acc[key].evaluation_cost +=
                        scoreItem.evaluation_cost || 0;
                      if (itemHumanScore != null) {
                        // Update with per-judge human_score if available
                        acc[key].human_score = itemHumanScore;
                      }
                    }

                    acc[key].metrics.push({
                      metric_name: scoreItem.metric,
                      score: scoreItem.score,
                      threshold: 0.7,
                      success: (scoreItem.score || 0) >= 0.7,
                      reason: scoreItem.reasoning || "",
                    });
                  });
                } else {
                  // Legacy flat structure fallback
                  const key = ev.judge_model || "unknown";
                  if (!acc[key]) {
                    acc[key] = {
                      provider: ev.judge_model?.includes("gemini")
                        ? "vertex_ai"
                        : "azure_openai",
                      model: ev.judge_model,
                      metrics: [],
                      aggregate_score: 0,
                      all_passed: true,
                      evaluation_time: ev.evaluation_time || 0,
                      evaluation_cost: ev.evaluation_cost || 0,
                      human_score: ev.human_score,
                    };
                  } else {
                    // Accumulate cost and time
                    acc[key].evaluation_time += ev.evaluation_time || 0;
                    acc[key].evaluation_cost += ev.evaluation_cost || 0;
                    if (ev.human_score != null) {
                      // Update human_score from subsequent evaluations if set
                      acc[key].human_score = ev.human_score;
                    }
                  }
                  if (ev.metric && ev.score !== null) {
                    acc[key].metrics.push({
                      metric_name: ev.metric,
                      score: ev.score,
                      threshold: 0.7,
                      success: ev.score >= 0.7,
                      reason: ev.reasoning || "",
                    });
                  }
                }
                return acc;
              },
              {}
            );

            // Calculate aggregate scores
            const evaluationResults = Object.values(evaluationsByJudge).map(
              (evalResult: any) => {
                const avgScore =
                  evalResult.metrics.length > 0
                    ? evalResult.metrics.reduce(
                        (sum: number, m: any) => sum + m.score,
                        0
                      ) / evalResult.metrics.length
                    : 0;
                return {
                  ...evalResult,
                  aggregate_score: avgScore,
                  all_passed: evalResult.metrics.every((m: any) => m.success),
                };
              }
            );

            return {
              name: e.name,
              prompt: e.prompt,
              systemPrompt: e.system_prompt,
              extracted: result?.extracted_text || "",
              references: result?.references || [],
              // Top-level token/duration for display (from first/default extraction result)
              duration: result?.duration_ms
                ? result.duration_ms / 1000
                : undefined,
              promptTokens: result?.prompt_tokens,
              completionTokens: result?.completion_tokens,
              groundTruth: groundTruth,
              evaluationResults: evaluationResults,
              extractionsByModel: sessionData.extraction_results
                ?.filter(
                  (r: any) =>
                    r.entity_name === e.name && r.document_id === doc.id
                )
                .reduce((acc: any, r: any) => {
                  // Find evaluations for THIS SPECIFIC source model (r.model_id)
                  const modelEvaluations = entityEvaluations.filter(
                    (ev: any) => ev.model_id === r.model_id
                  );

                  // Build evaluationResults for this specific source model
                  const modelEvalsByJudge = modelEvaluations.reduce(
                    (judgeAcc: any, ev: any) => {
                      if (ev.scores && Array.isArray(ev.scores)) {
                        ev.scores.forEach((scoreItem: any) => {
                          const key = scoreItem.judge_model || "unknown";
                          // Use ONLY per-score human_score to avoid cross-judge contamination
                          const itemHumanScore = scoreItem.human_score;
                          if (!judgeAcc[key]) {
                            judgeAcc[key] = {
                              provider: scoreItem.judge_model?.includes(
                                "gemini"
                              )
                                ? "vertex_ai"
                                : scoreItem.judge_model?.includes("claude")
                                  ? "anthropic"
                                  : "azure_openai",
                              model: scoreItem.judge_model || "unknown",
                              metrics: [],
                              aggregate_score: 0,
                              all_passed: true,
                              evaluation_time: scoreItem.evaluation_time || 0,
                              evaluation_cost: scoreItem.evaluation_cost || 0,
                              human_score: itemHumanScore,
                            };
                          } else {
                            // Accumulate cost and time
                            judgeAcc[key].evaluation_time +=
                              scoreItem.evaluation_time || 0;
                            judgeAcc[key].evaluation_cost +=
                              scoreItem.evaluation_cost || 0;
                            if (itemHumanScore != null) {
                              // Update with per-judge human_score if available
                              judgeAcc[key].human_score = itemHumanScore;
                            }
                          }
                          judgeAcc[key].metrics.push({
                            metric_name: scoreItem.metric,
                            score: scoreItem.score,
                            threshold: 0.7,
                            success: (scoreItem.score || 0) >= 0.7,
                            reason: scoreItem.reasoning || "",
                          });
                        });
                      }
                      return judgeAcc;
                    },
                    {}
                  );

                  // Calculate aggregate scores for this source model's evaluations
                  const modelEvalResults = Object.values(modelEvalsByJudge).map(
                    (evalResult: any) => {
                      const avgScore =
                        evalResult.metrics.length > 0
                          ? evalResult.metrics.reduce(
                              (sum: number, m: any) => sum + (m.score || 0),
                              0
                            ) / evalResult.metrics.length
                          : 0;
                      return {
                        ...evalResult,
                        aggregate_score: avgScore,
                        all_passed: evalResult.metrics.every(
                          (m: any) => m.success
                        ),
                      };
                    }
                  );

                  // NOTE: Do NOT set extraction-level humanScore here.
                  // Each judge's evaluation has its own human_score in evaluationResults.
                  // Setting a top-level humanScore would cause it to "leak" to other judges
                  // in BatchResultsPage when they don't have their own human_score.

                  acc[r.model_id] = {
                    extracted: r.extracted_text,
                    references: r.references || [],
                    // Token usage and cost tracking
                    promptTokens: r.prompt_tokens,
                    completionTokens: r.completion_tokens,
                    duration: r.duration_ms ? r.duration_ms / 1000 : undefined,
                    cost: r.cost,
                    // Evaluations specific to this source model
                    evaluationResults: modelEvalResults,
                  };
                  return acc;
                }, {}),
            };
          }),
        };
      }),

      // Legacy compatibility for single file reference
      fileId: sessionData.documents[0]?.file_hash || "",
      conversionId: sessionData.documents[0]?.file_hash || "",
      file: new File(
        [""],
        sessionData.documents[0]?.filename || "Restored Document",
        { type: "application/pdf" }
      ),
      evaluationConfig: {
        selectedMetrics: evalConfig.selected_metrics || [
          "correctness",
          "completeness",
          "relevance",
          "safety",
        ],
        selectedProviders: evalConfig.selected_providers || [],
        selectedSourceModels: evalConfig.selected_source_models || [],
        customEvaluationSteps:
          evalConfig.custom_evaluation_steps &&
          Object.keys(evalConfig.custom_evaluation_steps).length > 0
            ? evalConfig.custom_evaluation_steps
            : undefined, // Let EvaluationPage merge with its own defaults
      },
      entities: configEntities.map((e: any) => {
        const result = sessionData.extraction_results?.find(
          (r: any) =>
            r.entity_name === e.name &&
            r.document_id === sessionData.documents[0]?.id
        );

        // Find evaluation results for this entity - MUST filter by document_id to avoid cross-file contamination
        const docId = sessionData.documents[0]?.id;
        const entityEvaluations =
          sessionData.evaluation_results?.filter(
            (ev: any) =>
              ev.entity_name === e.name &&
              (ev.document_id === docId || !ev.document_id) // Match by document or legacy (no doc_id)
          ) || [];
        // Get ground truth from files_config first, fallback to evaluation results
        const groundTruth =
          filesConfig[sessionData.documents[0]?.file_hash]?.ground_truths?.[
            e.name
          ] ||
          entityEvaluations.find((ev: any) => ev.ground_truth)?.ground_truth ||
          "";

        // Group and reconstruct evaluation results
        const evaluationsByJudge = entityEvaluations.reduce(
          (acc: any, ev: any) => {
            // The API returns nested scores array
            if (ev.scores && Array.isArray(ev.scores)) {
              ev.scores.forEach((scoreItem: any) => {
                const key =
                  scoreItem.judge_model || result?.model_id || "unknown"; // Use score's judge model or fallback
                // Use ONLY per-score human_score to avoid cross-judge contamination
                const itemHumanScore = scoreItem.human_score;

                if (!acc[key]) {
                  acc[key] = {
                    provider: scoreItem.judge_model?.includes("gemini")
                      ? "vertex_ai"
                      : "azure_openai",
                    model: scoreItem.judge_model || "unknown",
                    metrics: [],
                    aggregate_score: 0,
                    all_passed: true,
                    evaluation_time: 0,
                    human_score: itemHumanScore,
                  };
                } else if (itemHumanScore != null) {
                  // Update with per-judge human_score if available
                  acc[key].human_score = itemHumanScore;
                }

                acc[key].metrics.push({
                  metric_name: scoreItem.metric,
                  score: scoreItem.score,
                  threshold: 0.7,
                  success: (scoreItem.score || 0) >= 0.7,
                  reason: scoreItem.reasoning || "",
                });
              });
            } else {
              // Legacy flat structure fallback
              const key = ev.judge_model || "unknown";
              if (!acc[key]) {
                acc[key] = {
                  provider: ev.judge_model?.includes("gemini")
                    ? "vertex_ai"
                    : "azure_openai",
                  model: ev.judge_model,
                  metrics: [],
                  aggregate_score: 0,
                  all_passed: true,
                  evaluation_time: 0,
                  human_score: ev.human_score,
                };
              } else if (ev.human_score != null) {
                // Update human_score from subsequent evaluations if set
                acc[key].human_score = ev.human_score;
              }
              if (ev.metric && ev.score !== null) {
                acc[key].metrics.push({
                  metric_name: ev.metric,
                  score: ev.score,
                  threshold: 0.7,
                  success: ev.score >= 0.7,
                  reason: ev.reasoning || "",
                });
              }
            }
            return acc;
          },
          {}
        );

        const evaluationResults = Object.values(evaluationsByJudge).map(
          (evalResult: any) => {
            const avgScore =
              evalResult.metrics.length > 0
                ? evalResult.metrics.reduce(
                    (sum: number, m: any) => sum + m.score,
                    0
                  ) / evalResult.metrics.length
                : 0;
            return {
              ...evalResult,
              aggregate_score: avgScore,
              all_passed: evalResult.metrics.every((m: any) => m.success),
            };
          }
        );

        return {
          name: e.name,
          prompt: e.prompt,
          extracted: result?.extracted_text || "",
          references: result?.references || [],
          // Top-level token/duration for display (from first/default extraction result)
          duration: result?.duration_ms ? result.duration_ms / 1000 : undefined,
          promptTokens: result?.prompt_tokens,
          completionTokens: result?.completion_tokens,
          groundTruth: groundTruth,
          evaluationResults: evaluationResults,
          extractionsByModel: sessionData.extraction_results
            ?.filter(
              (r: any) =>
                r.entity_name === e.name &&
                r.document_id === sessionData.documents[0]?.id
            )
            .reduce((acc: any, r: any) => {
              const modelEvaluations = entityEvaluations.filter(
                (ev: any) => ev.model_id === r.model_id
              );

              // Build evaluationResults for this specific source model
              const modelEvalsByJudge = modelEvaluations.reduce(
                (judgeAcc: any, ev: any) => {
                  if (ev.scores && Array.isArray(ev.scores)) {
                    ev.scores.forEach((scoreItem: any) => {
                      const key = scoreItem.judge_model || "unknown";
                      // Use ONLY per-score human_score to avoid cross-judge contamination
                      const itemHumanScore = scoreItem.human_score;
                      if (!judgeAcc[key]) {
                        judgeAcc[key] = {
                          provider: scoreItem.judge_model?.includes("gemini")
                            ? "vertex_ai"
                            : scoreItem.judge_model?.includes("claude")
                              ? "anthropic"
                              : "azure_openai",
                          model: scoreItem.judge_model || "unknown",
                          metrics: [],
                          aggregate_score: 0,
                          all_passed: true,
                          evaluation_time: 0,
                          human_score: itemHumanScore,
                        };
                      } else if (itemHumanScore != null) {
                        judgeAcc[key].human_score = itemHumanScore;
                      }
                      judgeAcc[key].metrics.push({
                        metric_name: scoreItem.metric,
                        score: scoreItem.score,
                        threshold: 0.7,
                        success: (scoreItem.score || 0) >= 0.7,
                        reason: scoreItem.reasoning || "",
                      });
                    });
                  }
                  return judgeAcc;
                },
                {}
              );

              // Calculate aggregate scores for this source model's evaluations
              const modelEvalResults = Object.values(modelEvalsByJudge).map(
                (evalResult: any) => {
                  const avgScore =
                    evalResult.metrics.length > 0
                      ? evalResult.metrics.reduce(
                          (sum: number, m: any) => sum + (m.score || 0),
                          0
                        ) / evalResult.metrics.length
                      : 0;
                  return {
                    ...evalResult,
                    aggregate_score: avgScore,
                    all_passed: evalResult.metrics.every((m: any) => m.success),
                  };
                }
              );

              // Get human score from evaluations for this model
              const humanScore = modelEvaluations.find(
                (ev: any) => ev.human_score != null
              )?.human_score;

              acc[r.model_id] = {
                extracted: r.extracted_text,
                references: r.references || [],
                // Token usage and cost tracking
                promptTokens: r.prompt_tokens,
                completionTokens: r.completion_tokens,
                duration: r.duration_ms ? r.duration_ms / 1000 : undefined,
                cost: r.cost,
                // Evaluations specific to this source model
                evaluationResults: modelEvalResults,
                // Use ?? instead of || to preserve human_score of 0
                humanScore: humanScore ?? undefined,
              };
              return acc;
            }, {}),
        };
      }),
    };

    return restoredData;
  };

  const handleRestoreSession = async (sessionId: string) => {
    if (restoringSessionRef.current) return;
    restoringSessionRef.current = true;
    try {
      setLoading(true);
      const [response, restoreViewResponse] = await Promise.all([
        authenticatedFetch(`/api/sessions/${sessionId}`),
        authenticatedFetch(`/api/sessions/${sessionId}/restore-view`),
      ]);
      if (!response.ok) throw new Error("Failed to fetch session");
      if (!restoreViewResponse.ok) throw new Error("Failed to fetch restore view");
      const sessionData = await response.json();
      const restoreView = await restoreViewResponse.json();
      console.log("🚀 Restoring session:", sessionData.session_id);

      const restoredData = await buildRestoredDocumentData(sessionData);
      const restoredFilesById = new Map(
        (restoredData.uploadedFiles || []).map((f: any) => [f.fileId, f])
      );
      restoredData.uploadedFiles = (restoreView.uploadedFiles || []).map((f: any) => {
        const existing = restoredFilesById.get(f.fileId) || {};
        return {
          ...existing,
          ...f,
          file: new File([""], f.fileName || existing.file?.name || "Restored Document", {
            type: "application/pdf",
          }),
          processingResult: {
            ...(existing.processingResult || {}),
            ...(f.processingResult || {}),
          },
        };
      });
      restoredData.fileId = restoreView.fileId || restoredData.fileId;
      restoredData.conversionId =
        restoreView.conversionId || restoredData.conversionId;
      restoredData.processorUsed =
        restoreView.processorUsed || restoredData.processorUsed;
      restoredData.sessionId = sessionData.session_id;
      restoredData.sharedSourceName = undefined;

      console.log(
        `[restore] Restored ${restoredData.uploadedFiles?.length ?? 0} files, last_step=${sessionData.last_step}`
      );
      setDocumentData((prev) => ({ ...prev, ...restoredData }));
      sessionCreationInProgressRef.current = false;

      // Load session metrics from database to populate the in-memory cache
      try {
        const token = await import("./utils/authUtils").then((m) =>
          m.getValidToken()
        );
        const metricsResponse = await fetch(
          "/api/server/session-metrics/load",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Session-Id": sessionData.session_id,
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ session_id: sessionData.session_id }),
          }
        );
        if (metricsResponse.ok) {
          const metricsData = await metricsResponse.json();
          if (metricsData.metrics) {
            console.log(
              "Session metrics restored:",
              metricsData.metrics.total_calls,
              "calls, cost: $" + metricsData.metrics.total_cost
            );
          }
        }
      } catch (metricsError) {
        console.warn("Failed to load session metrics:", metricsError);
        // Don't fail the session restore if metrics fail
      }

      toast.success("Session restored successfully");

      // Determine the step to restore to
      // Skip "upload" step since restored sessions don't have actual File objects
      const toolOnlySteps = [
        "login",
        "history",
        "upload",
        "templates",
        "groups",
        "executive",
      ];
      const validLastStep =
        sessionData.last_step && !toolOnlySteps.includes(sessionData.last_step);

      if (validLastStep) {
        console.log("Restoring to last step:", sessionData.last_step);
        setCurrentStep(sessionData.last_step as Step);
      } else if (
        restoredData.uploadedFiles &&
        restoredData.uploadedFiles.length > 0
      ) {
        setCurrentStep("study_selection");
      } else {
        toast.error("Session has no documents");
        setCurrentStep("upload");
      }
    } catch (error) {
      console.error("Error restoring session:", error, JSON.stringify(error));
      toast.error(
        `Failed to restore session: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setLoading(false);
      restoringSessionRef.current = false;
    }
  };

  // Restore a shared session: fetch via the shared endpoint, load full data
  // (entities, extractions, evaluations) into the workspace WITHOUT creating a
  // new session. The first write op in EntityExtractionPage will lazily create
  // a clone named "Copy of <original name>".
  const handleRestoreSharedSession = async (sessionId: string) => {
    if (restoringSessionRef.current) return;
    restoringSessionRef.current = true;
    try {
      setLoading(true);
      const [response, restoreViewResponse] = await Promise.all([
        authenticatedFetch(`/api/sessions/shared/${sessionId}`),
        authenticatedFetch(`/api/sessions/shared/${sessionId}/restore-view`),
      ]);
      if (!response.ok) throw new Error("Failed to fetch shared session");
      if (!restoreViewResponse.ok) throw new Error("Failed to fetch shared restore view");
      const sessionData = await response.json();
      const restoreView = await restoreViewResponse.json();

      // Build full restored data via the shared helper, then override
      // sessionId to undefined (lazy clone) and set sharedSourceName.
      const restoredData = await buildRestoredDocumentData(sessionData);
      const restoredFilesById = new Map(
        (restoredData.uploadedFiles || []).map((f: any) => [f.fileId, f])
      );
      restoredData.uploadedFiles = (restoreView.uploadedFiles || []).map((f: any) => {
        const existing = restoredFilesById.get(f.fileId) || {};
        return {
          ...existing,
          ...f,
          file: new File([""], f.fileName || existing.file?.name || "Restored Document", {
            type: "application/pdf",
          }),
          processingResult: {
            ...(existing.processingResult || {}),
            ...(f.processingResult || {}),
          },
        };
      });
      restoredData.fileId = restoreView.fileId || restoredData.fileId;
      restoredData.conversionId =
        restoreView.conversionId || restoredData.conversionId;
      restoredData.processorUsed =
        restoreView.processorUsed || restoredData.processorUsed;
      restoredData.sessionId = undefined;
      restoredData.sharedSourceName = sessionData.name || "Shared Session";

      setDocumentData((prev) => ({ ...prev, ...restoredData }));
      sessionCreationInProgressRef.current = false;

      toast.success(
        `Loaded shared session "${sessionData.name}". A copy will be created when you make changes.`
      );

      // Navigate to wherever the original session left off
      const toolOnlySteps = [
        "login",
        "history",
        "upload",
        "templates",
        "groups",
        "executive",
      ];
      const validLastStep =
        sessionData.last_step && !toolOnlySteps.includes(sessionData.last_step);

      if (validLastStep) {
        console.log(
          "Restoring shared session to last step:",
          sessionData.last_step
        );
        setCurrentStep(sessionData.last_step as Step);
      } else if (
        restoredData.uploadedFiles &&
        restoredData.uploadedFiles.length > 0
      ) {
        setCurrentStep("extraction");
      } else {
        setCurrentStep("upload");
      }
    } catch (error) {
      console.error("Error restoring shared session:", error);
      toast.error("Failed to load shared session");
    } finally {
      setLoading(false);
      restoringSessionRef.current = false;
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
      case "history":
        return (
          <SessionHistoryPage
            userId={userInfo?.id || ""}
            onRestoreSession={handleRestoreSession}
            onRestoreSharedSession={handleRestoreSharedSession}
            onSessionDeleted={(sessionId) =>
              handleSessionDeleted(userInfo?.id || "", sessionId)
            }
            onBack={handleBack}
          />
        );
      case "templates":
        return <TemplateWorkspacePage onBack={handleBack} />;
      case "groups":
        return <GroupManagementPage onBack={handleBack} />;
      case "executive":
        return <ExecutiveModePage onBack={handleBack} />;
      case "simplified":
        return (
          <SimplifiedFlowPage
            onSwitchToAdvanced={() => setCurrentStep("upload")}
          />
        );
      case "upload":
        return (
          <UploadPage
            onComplete={(data) => handleStepComplete("upload", data)}
            documentData={documentData}
            onInFlightChange={setInFlightStep}
            onInvalidateDownstream={() => invalidateDownstream("upload")}
          />
        );
      case "processing":
        return (
          <ProcessingPage
            onComplete={(data) => handleStepComplete("processing", data)}
            onBack={handleBack}
            onNavigateForward={canNavigateForward ? handleForward : undefined}
            documentData={documentData}
            hasDownstreamResults={completedSteps.has("study_selection")}
            onInvalidateDownstream={() => invalidateDownstream("processing")}
          />
        );
      case "study_selection":
        return (
          <BatchStudySelectionPage
            onBack={handleBack}
            onComplete={(data) => handleStepComplete("study_selection", data)}
            onNavigateForward={canNavigateForward ? handleForward : undefined}
            documentData={documentData}
            hasExtractionResults={completedSteps.has("extraction")}
            onInvalidateDownstream={() =>
              invalidateDownstream("study_selection")
            }
          />
        );
      case "extraction":
        return (
          <EntityExtractionPage
            onBack={handleBack}
            onComplete={(data) => handleStepComplete("extraction", data)}
            onNavigateForward={canNavigateForward ? handleForward : undefined}
            documentData={documentData}
            setDocumentData={setDocumentData}
            onInFlightChange={setInFlightStep}
            onInvalidateDownstream={() => invalidateDownstream("extraction")}
          />
        );
      case "evaluation":
        return (
          <EvaluationPage
            onBack={handleBack}
            documentData={documentData}
            setDocumentData={setDocumentData}
            onInFlightChange={setInFlightStep}
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
                Science-GPT Summarization Tool
              </h1>
              <div className="flex items-center gap-2">
                {isSimplifiedMode ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentStep("upload")}
                  >
                    <Settings2 className="h-4 w-4 mr-2" />
                    Advanced Mode
                  </Button>
                ) : (
                  <>
                    {!isSimplifiedMode && currentStep !== "executive" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentStep("simplified")}
                      >
                        <Zap className="h-4 w-4 mr-2" />
                        Simplified
                      </Button>
                    )}

                    {/* Executive Mode button hidden for demo — logic preserved in ExecutiveModePage.tsx
                    {currentStep !== "executive" && (
                      <RainbowButton
                        size="sm"
                        onClick={() => navigateTo("executive")}
                        className="!rounded-md"
                      >
                        <Briefcase className="h-4 w-4 mr-2" />
                        Executive Mode
                      </RainbowButton>
                    )}
                    */}

                    {currentStep !== "templates" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigateTo("templates")}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Templates
                      </Button>
                    )}

                    {currentStep !== "groups" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigateTo("groups")}
                      >
                        <Users className="h-4 w-4 mr-2" />
                        Groups
                      </Button>
                    )}

                    {currentStep !== "history" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigateTo("history")}
                      >
                        <Clock className="h-4 w-4 mr-2" />
                        History
                      </Button>
                    )}

                    <SessionMetrics />
                  </>
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
            {isAdvancedWorkflow && (
              <div className="flex items-center mt-4">
                {WORKFLOW_STEPS.map((step, idx) => {
                  const isCurrent = currentStep === step;
                  const isCompleted = completedSteps.has(step);
                  const isStale = staleDownstream.has(step);
                  const isReachable =
                    idx <= highestReachableStepIndex && !isStale;
                  const isClickable = isReachable && !isCurrent;
                  const hasInFlight = inFlightStep === step;

                  return (
                    <div
                      key={step}
                      className="flex items-center flex-1 last:flex-none"
                    >
                      <button
                        onClick={() => isClickable && handleStepNavigate(step)}
                        disabled={!isClickable}
                        className={`
                          flex items-center gap-2 group relative
                          transition-colors duration-150
                          ${isClickable ? "cursor-pointer" : "cursor-default"}
                          ${isCurrent ? "text-foreground" : isCompleted ? "text-foreground" : isReachable ? "text-muted-foreground" : "text-muted-foreground/50"}
                        `}
                        title={
                          isStale && isCompleted
                            ? `${WORKFLOW_STEP_LABELS[step]} — results may be outdated`
                            : isClickable
                              ? `Go to ${WORKFLOW_STEP_LABELS[step]}`
                              : isCurrent
                                ? "Current step"
                                : !isReachable
                                  ? "Complete previous steps first"
                                  : ""
                        }
                      >
                        <div
                          className={`
                            w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold
                            transition-all duration-200 shrink-0
                            ${
                              isCurrent
                                ? hasInFlight
                                  ? "bg-amber-100 text-amber-700 ring-2 ring-amber-400"
                                  : "bg-primary text-primary-foreground ring-2 ring-primary/30"
                                : isStale && isCompleted
                                  ? "bg-amber-500/60 text-white"
                                  : isCompleted
                                    ? "bg-green-600 text-white"
                                    : isReachable
                                      ? "bg-muted-foreground/20 text-muted-foreground"
                                      : "bg-muted text-muted-foreground/50"
                            }
                            ${isClickable ? "group-hover:ring-2 group-hover:ring-primary/40 group-hover:scale-110" : ""}
                          `}
                        >
                          {hasInFlight && isCurrent ? (
                            <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                          ) : isStale && isCompleted && !isCurrent ? (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          ) : isCompleted && !isCurrent ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            idx + 1
                          )}
                        </div>
                        <span
                          className={`text-sm font-medium whitespace-nowrap hidden sm:inline
                            ${isClickable ? "group-hover:text-primary" : ""}
                          `}
                        >
                          {WORKFLOW_STEP_LABELS[step]}
                        </span>
                      </button>
                      {idx < WORKFLOW_STEPS.length - 1 && (
                        <div className="flex-1 mx-2 sm:mx-3">
                          <div
                            className={`h-0.5 rounded-full transition-colors duration-300 ${
                              completedSteps.has(step) &&
                              !staleDownstream.has(WORKFLOW_STEPS[idx + 1])
                                ? "bg-green-600/60"
                                : staleDownstream.has(WORKFLOW_STEPS[idx + 1])
                                  ? "bg-amber-400/60"
                                  : "bg-border"
                            }`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </header>
        <main className="container mx-auto px-4 py-8 bg-background">
          {renderStep()}
        </main>

        {/* Confirmation dialog: navigate away from in-flight operation */}
        <AlertDialog
          open={navAwayConfirm.open}
          onOpenChange={(open) =>
            !open && setNavAwayConfirm((p) => ({ ...p, open: false }))
          }
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Operation In Progress
              </AlertDialogTitle>
              <AlertDialogDescription>
                {navAwayConfirm.message}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay Here</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setCurrentStep(navAwayConfirm.targetStep);
                  setNavAwayConfirm((p) => ({ ...p, open: false }));
                }}
                className="bg-amber-600 hover:bg-amber-700"
              >
                Leave Anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Confirmation dialog: rerunning intermediate stage */}
        <AlertDialog
          open={rerunConfirm.open}
          onOpenChange={(open) =>
            !open && setRerunConfirm((p) => ({ ...p, open: false }))
          }
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Overwrite Downstream Results?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {rerunConfirm.message}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setRerunConfirm((p) => ({ ...p, open: false }));
                }}
                className="bg-orange-600 hover:bg-orange-700"
              >
                Yes, Re-run
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Toaster />
      </div>
    </ThemeProvider>
  );
}
