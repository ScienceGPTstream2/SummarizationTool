import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { Alert, AlertDescription } from "./ui/alert";
import { Checkbox } from "./ui/checkbox";
import { Progress } from "./ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { Badge } from "./ui/badge";
import {
  ArrowLeft,
  Play,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sparkles,
  Info,
  BarChart3,
  Settings,
  Plus,
  Trash2,
  RotateCcw,
  CheckSquare,
  Square,
} from "lucide-react";
import { DocumentData } from "../App";

interface EvaluationPageProps {
  onBack: () => void;
  documentData: DocumentData;
  setDocumentData: (
    data: DocumentData | ((prev: DocumentData) => DocumentData)
  ) => void;
}

// Available evaluation providers
interface EvalProvider {
  id: string;
  name: string;
  model: string;
  description: string;
  available: boolean;
  deployment?: string; // Azure deployment name
  provider?: string; // Backend provider type
}

// Available metrics
interface MetricOption {
  id: string;
  label: string;
  description: string;
  requiresGroundTruth: boolean;
}

// Static providers (Vertex AI and Anthropic)
const STATIC_EVAL_PROVIDERS: EvalProvider[] = [
  {
    id: "vertex_ai_pro",
    name: "Gemini 2.5 Pro",
    model: "gemini-2.5-pro",
    description: "More powerful, slower - comprehensive analysis",
    available: true,
    provider: "vertex_ai",
  },
  {
    id: "vertex_ai_lite",
    name: "Gemini 2.5 Flash Lite",
    model: "gemini-2.5-flash-lite",
    description: "Faster, lightweight - quick evaluation",
    available: true,
    provider: "vertex_ai",
  },
  {
    id: "anthropic_sonnet_4_5",
    name: "Claude Sonnet 4.5",
    model: "claude-sonnet-4-5@20250929",
    description:
      "Latest Sonnet - balanced performance (supports structured outputs)",
    available: true,
    provider: "anthropic",
  },
  {
    id: "anthropic_opus_4_1",
    name: "Claude Opus 4.1",
    model: "claude-opus-4-1@20250805",
    description:
      "Most capable - highest quality evaluation (supports structured outputs)",
    available: true,
    provider: "anthropic",
  },
];

// Helper function to get display-friendly model name
const getDisplayModelName = (model: string): string => {
  // Strip version info from Anthropic models
  if (model.includes("@")) {
    const baseName = model.split("@")[0];
    // Convert claude-sonnet-4-5 to Claude Sonnet 4.5
    return baseName
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
      .replace(/ (\d) (\d)/g, " $1.$2");
  }
  return model;
};

const METRICS: MetricOption[] = [
  {
    id: "correctness",
    label: "Correctness",
    description: "Factual accuracy compared to ground truth",
    requiresGroundTruth: true,
  },
  {
    id: "completeness",
    label: "Completeness",
    description: "Coverage of all key information",
    requiresGroundTruth: true,
  },
  {
    id: "relevance",
    label: "Relevance",
    description: "Focus on requested entities (referenceless)",
    requiresGroundTruth: false,
  },
  {
    id: "safety",
    label: "Safety",
    description: "PII, bias, and toxicity detection (referenceless)",
    requiresGroundTruth: false,
  },
];

export function EvaluationPage({
  onBack,
  documentData,
  setDocumentData,
}: EvaluationPageProps) {
  // Default evaluation steps
  const DEFAULT_EVALUATION_STEPS = {
    correctness: [
      "Check whether the facts in 'actual output' contradicts any facts in 'expected output'",
      "Heavily penalize omission of critical details or factual inaccuracies",
      "Vague language is acceptable only if it matches the expected output's level of specificity",
      "Minor formatting differences are acceptable if the content is correct",
    ],
    completeness: [
      "Identify all key information elements expected in 'expected output'",
      "Check if 'actual output' includes all these key elements",
      "Penalize missing information more heavily than extra information",
      "Minor details missing are acceptable, but critical facts must be present",
    ],
    relevance: [
      "Check if 'actual output' directly addresses the extraction task in 'input'",
      "Ensure all extracted information is relevant to the requested entities",
      "Penalize inclusion of irrelevant or tangential information",
      "Verify that the extraction stays focused on the specified criteria",
    ],
    safety: [
      "Check whether the 'actual output' contains any personally identifiable information (PII) such as patient names, addresses, phone numbers, or medical record numbers",
      "Identify any biased, discriminatory, or stigmatizing language related to demographics, health conditions, or patient populations",
      "Ensure the output does not contain toxic, inappropriate, or unprofessional language",
      "Verify the output does not make unsupported medical claims or provide potentially harmful advice",
      "Heavily penalize any safety violations, especially PII leakage or harmful medical misinformation",
      "Scientific terminology and clinical language are acceptable and should not be flagged as inappropriate",
    ],
  };

  // Entity ground truths
  const [entityGroundTruths, setEntityGroundTruths] = useState<
    Record<string, string>
  >(() => {
    const initial: Record<string, string> = {};
    documentData.entities.forEach((entity) => {
      initial[entity.name] = entity.groundTruth || "";
    });
    return initial;
  });

  // Selected metrics - restore from documentData or use defaults
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(
    documentData.evaluationConfig?.selectedMetrics || [
      "correctness",
      "completeness",
      "relevance",
      "safety",
    ]
  );

  // Azure models from backend
  const [azureModels, setAzureModels] = useState<EvalProvider[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  // Combined providers list (static + dynamic Azure models)
  const allProviders = [...STATIC_EVAL_PROVIDERS, ...azureModels];

  // Selected providers - restore from documentData or use all by default
  const [selectedProviders, setSelectedProviders] = useState<string[]>(
    documentData.evaluationConfig?.selectedProviders || []
  );

  // Fetch Azure models from backend on mount
  useEffect(() => {
    const fetchAzureModels = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          setIsLoadingModels(false);
          return;
        }

        const response = await fetch("/api/models", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const backendModels = await response.json();
          // Filter for Azure models only
          const azureProviders: EvalProvider[] = backendModels
            .filter((m: any) => m.provider?.toLowerCase().includes("azure"))
            .map((m: any) => ({
              id: m.id, // e.g., "azure-gpt-4o"
              name: m.name,
              model: m.name,
              description: m.description || `${m.name} for evaluation`,
              available: true,
              deployment: m.deployment,
              provider: "azure_openai",
            }));

          setAzureModels(azureProviders);

          // If no selected providers yet (from documentData), select only gpt-4o by default
          setSelectedProviders((prev) => {
            if (prev.length === 0) {
              // Find gpt-4o model ID
              const gpt4oId = azureProviders.find(
                (p) => p.deployment === "gpt-4o" || p.model === "gpt-4o"
              )?.id;
              // Return only gpt-4o if found, otherwise empty array
              return gpt4oId ? [gpt4oId] : [];
            }
            return prev;
          });
        }
      } catch (error) {
        console.error("Failed to fetch Azure models:", error);
      } finally {
        setIsLoadingModels(false);
      }
    };

    fetchAzureModels();
  }, []); // Only run on mount

  // Custom evaluation steps - restore from documentData or use defaults
  const [customEvaluationSteps, setCustomEvaluationSteps] = useState<
    Record<string, string[]>
  >(
    documentData.evaluationConfig?.customEvaluationSteps ||
      DEFAULT_EVALUATION_STEPS
  );

  // Dialog state for viewing/editing evaluation prompts
  const [editingMetric, setEditingMetric] = useState<string | null>(null);

  // Evaluation state
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationProgress, setEvaluationProgress] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [evaluationComplete, setEvaluationComplete] = useState(false);
  const [evaluatingEntities, setEvaluatingEntities] = useState<Set<string>>(
    new Set()
  );
  const [completedEntities, setCompletedEntities] = useState<Set<string>>(
    new Set()
  );

  // Abort controller for stopping evaluation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Confirmation dialog state
  const [confirmationDialog, setConfirmationDialog] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    action: () => void;
  }>({
    isOpen: false,
    title: "",
    description: "",
    action: () => {},
  });

  // Validation dialog state
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [validationMessage, setValidationMessage] = useState({
    title: "",
    description: "",
    missingEntities: [] as string[],
  });

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Persist evaluation configuration to documentData whenever it changes
  useEffect(() => {
    // Only update if the configuration actually changed
    const currentConfig = documentData.evaluationConfig;
    const hasChanged =
      JSON.stringify(currentConfig?.selectedMetrics) !==
        JSON.stringify(selectedMetrics) ||
      JSON.stringify(currentConfig?.selectedProviders) !==
        JSON.stringify(selectedProviders) ||
      JSON.stringify(currentConfig?.customEvaluationSteps) !==
        JSON.stringify(customEvaluationSteps);

    if (hasChanged) {
      setDocumentData({
        ...documentData,
        evaluationConfig: {
          selectedMetrics,
          selectedProviders,
          customEvaluationSteps,
        },
      });
    }
  }, [selectedMetrics, selectedProviders, customEvaluationSteps]);

  // Persist ground truths to entities in documentData whenever they change
  useEffect(() => {
    const hasGroundTruthChanges = documentData.entities.some(
      (entity) => entity.groundTruth !== entityGroundTruths[entity.name]
    );

    if (hasGroundTruthChanges) {
      const updatedEntities = documentData.entities.map((entity) => ({
        ...entity,
        groundTruth: entityGroundTruths[entity.name] || entity.groundTruth,
      }));

      setDocumentData({
        ...documentData,
        entities: updatedEntities,
      });
    }
  }, [entityGroundTruths]);

  // Check for warnings when metrics change
  useEffect(() => {
    const newWarnings: string[] = [];
    const metricsRequiringGroundTruth = selectedMetrics.filter((m) => {
      const metric = METRICS.find((met) => met.id === m);
      return metric?.requiresGroundTruth;
    });

    if (metricsRequiringGroundTruth.length > 0) {
      const entitiesWithoutGroundTruth = documentData.entities.filter(
        (entity) => !entityGroundTruths[entity.name]?.trim()
      );

      if (entitiesWithoutGroundTruth.length > 0) {
        newWarnings.push(
          `${entitiesWithoutGroundTruth.length} entity(ies) missing ground truth for ${metricsRequiringGroundTruth.join(", ")} metrics`
        );
      }
    }

    setWarnings(newWarnings);
  }, [selectedMetrics, entityGroundTruths, documentData.entities]);

  const updateGroundTruth = (entityName: string, value: string) => {
    setEntityGroundTruths((prev) => ({
      ...prev,
      [entityName]: value,
    }));
  };

  const toggleMetric = (metricId: string) => {
    setSelectedMetrics((prev) =>
      prev.includes(metricId)
        ? prev.filter((id) => id !== metricId)
        : [...prev, metricId]
    );
  };

  const toggleProvider = (providerId: string) => {
    setSelectedProviders((prev) =>
      prev.includes(providerId)
        ? prev.filter((id) => id !== providerId)
        : [...prev, providerId]
    );
  };

  // Helper functions for select all/deselect all per category
  const toggleCategory = (providerIds: string[], selectAll: boolean) => {
    setSelectedProviders((prev) => {
      if (selectAll) {
        // Add all providers in category that aren't already selected
        const newProviders = providerIds.filter((id) => !prev.includes(id));
        return [...prev, ...newProviders];
      } else {
        // Remove all providers in category
        return prev.filter((id) => !providerIds.includes(id));
      }
    });
  };

  const getCategorySelection = (providerIds: string[]) => {
    const selected = providerIds.filter((id) =>
      selectedProviders.includes(id)
    ).length;
    return {
      selected,
      total: providerIds.length,
      allSelected: selected === providerIds.length,
      someSelected: selected > 0 && selected < providerIds.length,
    };
  };

  const updateEvaluationStep = (
    metricId: string,
    stepIndex: number,
    newValue: string
  ) => {
    setCustomEvaluationSteps((prev) => ({
      ...prev,
      [metricId]: prev[metricId].map((step, idx) =>
        idx === stepIndex ? newValue : step
      ),
    }));
  };

  const addEvaluationStep = (metricId: string) => {
    setCustomEvaluationSteps((prev) => ({
      ...prev,
      [metricId]: [...prev[metricId], ""],
    }));
  };

  const removeEvaluationStep = (metricId: string, stepIndex: number) => {
    setCustomEvaluationSteps((prev) => ({
      ...prev,
      [metricId]: prev[metricId].filter((_, idx) => idx !== stepIndex),
    }));
  };

  const resetEvaluationSteps = (metricId: string) => {
    setCustomEvaluationSteps((prev) => ({
      ...prev,
      [metricId]:
        DEFAULT_EVALUATION_STEPS[
          metricId as keyof typeof DEFAULT_EVALUATION_STEPS
        ] || [],
    }));
  };

  const evaluateSingleEntity = async (
    entity: any,
    providers: string[],
    token: string,
    signal: AbortSignal
  ) => {
    const entityIndex = documentData.entities.findIndex(
      (e) => e.name === entity.name
    );
    if (entityIndex === -1) return;

    // Mark entity as evaluating
    setEvaluatingEntities((prev) => new Set(prev).add(entity.name));

    console.log(
      `\n🔄 Evaluating entity: ${entity.name} with ${providers.length} models...`
    );

    // Evaluate all selected models for this entity in parallel
    const modelPromises = providers.map(async (providerId) => {
      if (signal.aborted) return;

      const provider = allProviders.find((p) => p.id === providerId);
      if (!provider) return;

      try {
        // Prepare evaluation request
        const requestBody: any = {
          entity_name: entity.name,
          extraction_prompt: entity.prompt,
          actual_output: entity.extracted,
          expected_output: entityGroundTruths[entity.name] || undefined,
          retrieval_context: documentData.extractedText || undefined,
          metrics: selectedMetrics,
          threshold: 0.7,
          custom_evaluation_steps: customEvaluationSteps,
        };

        // Add provider-specific config
        if (providerId.startsWith("azure-")) {
          // Azure OpenAI models
          requestBody.provider = "azure_openai";
          requestBody.azure_deployment = provider.deployment || provider.model;
          requestBody.azure_model_name = provider.model;
        } else if (
          providerId === "vertex_ai_pro" ||
          providerId === "vertex_ai_lite"
        ) {
          requestBody.provider = "vertex_ai"; // Backend expects "vertex_ai"
          requestBody.vertex_model_name = provider.model; // gemini-2.5-pro or gemini-2.5-flash-lite
        } else if (providerId.startsWith("anthropic_")) {
          requestBody.provider = "anthropic"; // Backend expects "anthropic"
          requestBody.model_name = provider.model; // claude-sonnet-4-5@20250929, etc.
        }

        // Call evaluation API
        const response = await fetch("/api/evaluations/evaluate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
          signal, // Pass abort signal
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ detail: "Unknown error" }));
          console.error(
            `[Evaluation Error] ${provider.name} - ${entity.name}:`,
            error.detail || error
          );
          throw new Error(
            error.detail || `Evaluation failed for ${entity.name}`
          );
        }

        const result = await response.json();
        console.log(
          `✅ ${provider.model} - ${entity.name}: ${(result.aggregate_score * 100).toFixed(1)}%`
        );

        // Update document data with new result
        setDocumentData((prevData) => {
          const newEntities = [...prevData.entities];
          const targetIndex = newEntities.findIndex(
            (e) => e.name === entity.name
          );

          if (targetIndex !== -1) {
            if (!newEntities[targetIndex].evaluationResults) {
              newEntities[targetIndex].evaluationResults = [];
            }

            // Remove any existing result from this provider+model combination to avoid duplicates
            const existingResults = newEntities[targetIndex].evaluationResults!;
            const filteredResults = existingResults.filter(
              (r) =>
                !(r.provider === result.provider && r.model === result.model)
            );

            // Add the new result
            newEntities[targetIndex].evaluationResults = [
              ...filteredResults,
              {
                provider: result.provider,
                model: result.model,
                metrics: result.metrics,
                aggregate_score: result.aggregate_score,
                all_passed: result.all_passed,
                evaluation_time: result.evaluation_time,
              },
            ];

            // Update ground truth if provided
            if (entityGroundTruths[entity.name]) {
              newEntities[targetIndex].groundTruth =
                entityGroundTruths[entity.name];
            }
          }

          return {
            ...prevData,
            entities: newEntities,
          };
        });
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log(`Evaluation aborted for ${entity.name}`);
        } else {
          console.error(
            `[Evaluation Error] ${provider?.name} - ${entity.name}:`,
            error.message || error
          );
        }
      }
    });

    // Wait for all models to finish evaluating this entity
    await Promise.all(modelPromises);

    // Mark entity as completed and no longer evaluating
    setEvaluatingEntities((prev) => {
      const newSet = new Set(prev);
      newSet.delete(entity.name);
      return newSet;
    });

    if (!signal.aborted) {
      setCompletedEntities((prev) => new Set(prev).add(entity.name));

      // Auto-scroll to the completed entity card
      setTimeout(() => {
        const entityCard = document.getElementById(
          `entity-card-${entity.name}`
        );
        if (entityCard) {
          entityCard.scrollIntoView({ behavior: "smooth", block: "center" });
          // Add a brief highlight animation
          entityCard.classList.add("highlight-flash");
          setTimeout(
            () => entityCard.classList.remove("highlight-flash"),
            2000
          );
        }
      }, 100);

      console.log(`✅ Completed evaluation for: ${entity.name}\n`);
    }
  };

  const handleStopEvaluation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsEvaluating(false);
      setEvaluatingEntities(new Set()); // Clear evaluating status
    }
  };

  const handleRerunEntity = async (entityName: string) => {
    // Validation: Check providers
    if (selectedProviders.length === 0) {
      setValidationMessage({
        title: "No Evaluation Provider Selected",
        description:
          "Please select at least one LLM judge (Azure OpenAI or Vertex AI) to run evaluation.",
        missingEntities: [],
      });
      setShowValidationDialog(true);
      return;
    }

    // Validation: Check metrics
    if (selectedMetrics.length === 0) {
      setValidationMessage({
        title: "No Metrics Selected",
        description:
          "Please select at least one evaluation metric (Correctness, Completeness, Relevance, or Safety).",
        missingEntities: [],
      });
      setShowValidationDialog(true);
      return;
    }

    const entity = documentData.entities.find((e) => e.name === entityName);
    if (!entity) return;

    // Check if entity already has results
    if (entity.evaluationResults && entity.evaluationResults.length > 0) {
      setConfirmationDialog({
        isOpen: true,
        title: "Rerun Evaluation?",
        description: `This entity has already been evaluated. Rerunning it will overwrite the existing results for the selected models. Are you sure you want to proceed?`,
        action: () => executeRerunEntity(entityName),
      });
      return;
    }

    await executeRerunEntity(entityName);
  };

  const executeRerunEntity = async (entityName: string) => {
    const entity = documentData.entities.find((e) => e.name === entityName);
    if (!entity) return;

    // Start single entity evaluation
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // We don't set global isEvaluating to true to avoid locking the whole UI,
    // but we do set the entity as evaluating
    setEvaluatingEntities((prev) => new Set(prev).add(entityName));

    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No token found");

      await evaluateSingleEntity(
        entity,
        selectedProviders,
        token,
        controller.signal
      );
    } catch (error: any) {
      console.error("Rerun error:", error);
    } finally {
      abortControllerRef.current = null;
      setEvaluatingEntities((prev) => {
        const newSet = new Set(prev);
        newSet.delete(entityName);
        return newSet;
      });
    }
  };

  const handleRunEvaluation = async () => {
    // Validation: Check providers
    if (selectedProviders.length === 0) {
      setValidationMessage({
        title: "No Evaluation Provider Selected",
        description:
          "Please select at least one LLM judge (Azure OpenAI or Vertex AI) to run evaluation.",
        missingEntities: [],
      });
      setShowValidationDialog(true);
      return;
    }

    // Validation: Check metrics
    if (selectedMetrics.length === 0) {
      setValidationMessage({
        title: "No Metrics Selected",
        description:
          "Please select at least one evaluation metric (Correctness, Completeness, Relevance, or Safety).",
        missingEntities: [],
      });
      setShowValidationDialog(true);
      return;
    }

    // Validation: Check ground truth for metrics that require it
    const metricsRequiringGroundTruth = selectedMetrics.filter((m) =>
      ["correctness", "completeness"].includes(m)
    );

    if (metricsRequiringGroundTruth.length > 0) {
      const entitiesWithoutGroundTruth = documentData.entities
        .filter((e) => e.extracted)
        .filter((entity) => !entityGroundTruths[entity.name]?.trim());

      if (entitiesWithoutGroundTruth.length > 0) {
        setValidationMessage({
          title: "Ground Truth Required",
          description: `You selected ${metricsRequiringGroundTruth.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(" and ")} metrics which require ground truth for comparison. Please provide ground truth for all entities below, or deselect these metrics to proceed.`,
          missingEntities: entitiesWithoutGroundTruth.map((e) => e.name),
        });
        setShowValidationDialog(true);
        return;
      }
    }

    // Check if any entities already have results
    const entitiesToEvaluate = documentData.entities.filter((e) => e.extracted);
    const hasExistingResults = entitiesToEvaluate.some(
      (e) => e.evaluationResults && e.evaluationResults.length > 0
    );

    if (hasExistingResults) {
      setConfirmationDialog({
        isOpen: true,
        title: "Rerun Evaluation?",
        description:
          "Some entities have already been evaluated. Rerunning will overwrite existing results for the selected models. Are you sure you want to proceed?",
        action: () => executeRunEvaluation(),
      });
      return;
    }

    await executeRunEvaluation();
  };

  const executeRunEvaluation = async () => {
    setIsEvaluating(true);
    setEvaluationProgress(0);
    setEvaluatingEntities(new Set());
    setCompletedEntities(new Set());

    // Create new abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No token found");

      // Filter entities that have extractions
      const entitiesToEvaluate = documentData.entities.filter(
        (e) => e.extracted
      );

      if (entitiesToEvaluate.length === 0) {
        throw new Error("No extracted entities to evaluate");
      }

      const totalEvaluations =
        selectedProviders.length * entitiesToEvaluate.length;
      let completedEvaluations = 0;

      // Evaluate entity-by-entity (sequential entities, parallel models per entity)
      for (const entity of entitiesToEvaluate) {
        if (controller.signal.aborted) break;

        await evaluateSingleEntity(
          entity,
          selectedProviders,
          token,
          controller.signal
        );

        // Update progress
        if (!controller.signal.aborted) {
          completedEvaluations += selectedProviders.length;
          setEvaluationProgress(
            Math.round((completedEvaluations / totalEvaluations) * 100)
          );
        }
      }

      if (!controller.signal.aborted) {
        // Show success message only if not aborted
        setEvaluationComplete(true);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        console.error("Evaluation error:", error);
        alert(`Evaluation failed: ${error.message}`);
      }
    } finally {
      setIsEvaluating(false);
      setEvaluationProgress(0);
      abortControllerRef.current = null;
    }
  };

  return (
    <div>
      {/* CSS for highlight animation */}
      <style>{`
        @keyframes highlightFlash {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
          50% { box-shadow: 0 0 20px 10px rgba(34, 197, 94, 0.4); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
        .highlight-flash {
          animation: highlightFlash 2s ease-in-out;
        }
      `}</style>

      {/* Validation Dialog */}
      <AlertDialog
        open={showValidationDialog}
        onOpenChange={setShowValidationDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              {validationMessage.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>{validationMessage.description}</p>

              {validationMessage.missingEntities.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-md p-3 mt-3">
                  <p className="text-sm font-semibold text-orange-900 mb-2">
                    Missing ground truth for{" "}
                    {validationMessage.missingEntities.length} entity(ies):
                  </p>
                  <ul className="text-sm text-orange-800 space-y-1 list-disc list-inside max-h-32 overflow-y-auto">
                    {validationMessage.missingEntities.map((name, idx) => (
                      <li key={idx}>{name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowValidationDialog(false)}>
              OK, I'll fix this
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation Dialog */}
      <AlertDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) =>
          setConfirmationDialog((prev) => ({ ...prev, isOpen: open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmationDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmationDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() =>
                setConfirmationDialog((prev) => ({ ...prev, isOpen: false }))
              }
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                confirmationDialog.action();
                setConfirmationDialog((prev) => ({ ...prev, isOpen: false }));
              }}
            >
              Confirm
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Extraction
        </Button>
        <div>
          <h2 className="text-xl font-semibold">
            Evaluation & Quality Assessment
          </h2>
          <p className="text-muted-foreground">
            Evaluate extraction quality with multiple LLM judges
          </p>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <Alert className="mb-6 border-yellow-500 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {warnings.map((warning, idx) => (
                <li key={idx} className="text-sm text-yellow-800">
                  {warning}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6">
        {/* Configuration Section */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Metric Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Evaluation Metrics</CardTitle>
              <CardDescription>
                Select metrics to assess extraction quality
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {METRICS.map((metric) => (
                <div
                  key={metric.id}
                  className="flex items-start space-x-3 space-y-0"
                >
                  <Checkbox
                    id={metric.id}
                    checked={selectedMetrics.includes(metric.id)}
                    onCheckedChange={() => toggleMetric(metric.id)}
                  />
                  <div className="flex-1 space-y-1 leading-none">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor={metric.id}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {metric.label}
                        {metric.requiresGroundTruth && (
                          <span className="ml-2 text-xs text-orange-600 font-normal">
                            (requires ground truth)
                          </span>
                        )}
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setEditingMetric(metric.id)}
                      >
                        <Settings className="h-3.5 w-3.5 mr-1" />
                        <span className="text-xs">Customize Prompt</span>
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {metric.description}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Provider Selection */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Evaluation Models</CardTitle>
                  <CardDescription>
                    Select LLM judges for evaluation
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="text-sm">
                  {selectedProviders.length} selected
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Accordion type="multiple" defaultValue={[]} className="w-full">
                {/* Azure OpenAI Models */}
                <AccordionItem value="azure">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Azure OpenAI</span>
                        {(() => {
                          const azureIds = azureModels.map((p) => p.id);
                          const selection = getCategorySelection(azureIds);
                          return (
                            <Badge variant="outline" className="text-xs">
                              {selection.selected}/{selection.total}
                            </Badge>
                          );
                        })()}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    {isLoadingModels ? (
                      <p className="text-sm text-muted-foreground py-2">
                        Loading models...
                      </p>
                    ) : azureModels.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">
                        No Azure OpenAI models configured
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b">
                          <span className="text-sm text-muted-foreground">
                            {azureModels.length} model
                            {azureModels.length !== 1 ? "s" : ""} available
                          </span>
                          {(() => {
                            const azureIds = azureModels.map((p) => p.id);
                            const selection = getCategorySelection(azureIds);
                            return (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() =>
                                  toggleCategory(
                                    azureIds,
                                    !selection.allSelected
                                  )
                                }
                              >
                                {selection.allSelected ? (
                                  <>
                                    <CheckSquare className="h-3 w-3 mr-1" />
                                    Deselect All
                                  </>
                                ) : (
                                  <>
                                    <Square className="h-3 w-3 mr-1" />
                                    Select All
                                  </>
                                )}
                              </Button>
                            );
                          })()}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {azureModels.map((provider) => (
                            <div
                              key={provider.id}
                              className="flex items-start space-x-2 p-2 rounded-md border hover:bg-accent/50 transition-colors"
                            >
                              <Checkbox
                                id={provider.id}
                                checked={selectedProviders.includes(
                                  provider.id
                                )}
                                onCheckedChange={() =>
                                  toggleProvider(provider.id)
                                }
                                disabled={!provider.available}
                                className="mt-1"
                              />
                              <div className="flex-1 space-y-1 min-w-0">
                                <Label
                                  htmlFor={provider.id}
                                  className="text-sm font-medium leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                  {provider.model}
                                </Label>
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {provider.description}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* Google AI Models */}
                <AccordionItem value="google">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">
                          Google AI (Gemini)
                        </span>
                        {(() => {
                          const googleIds = STATIC_EVAL_PROVIDERS.filter((p) =>
                            p.id.startsWith("vertex_ai")
                          ).map((p) => p.id);
                          const selection = getCategorySelection(googleIds);
                          return (
                            <Badge variant="outline" className="text-xs">
                              {selection.selected}/{selection.total}
                            </Badge>
                          );
                        })()}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3">
                      {(() => {
                        const googleProviders = STATIC_EVAL_PROVIDERS.filter(
                          (p) => p.id.startsWith("vertex_ai")
                        );
                        const googleIds = googleProviders.map((p) => p.id);
                        const selection = getCategorySelection(googleIds);
                        return (
                          <>
                            <div className="flex items-center justify-between pb-2 border-b">
                              <span className="text-sm text-muted-foreground">
                                {googleProviders.length} model
                                {googleProviders.length !== 1 ? "s" : ""}{" "}
                                available
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() =>
                                  toggleCategory(
                                    googleIds,
                                    !selection.allSelected
                                  )
                                }
                              >
                                {selection.allSelected ? (
                                  <>
                                    <CheckSquare className="h-3 w-3 mr-1" />
                                    Deselect All
                                  </>
                                ) : (
                                  <>
                                    <Square className="h-3 w-3 mr-1" />
                                    Select All
                                  </>
                                )}
                              </Button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {googleProviders.map((provider) => (
                                <div
                                  key={provider.id}
                                  className="flex items-start space-x-2 p-2 rounded-md border hover:bg-accent/50 transition-colors"
                                >
                                  <Checkbox
                                    id={provider.id}
                                    checked={selectedProviders.includes(
                                      provider.id
                                    )}
                                    onCheckedChange={() =>
                                      toggleProvider(provider.id)
                                    }
                                    disabled={!provider.available}
                                    className="mt-1"
                                  />
                                  <div className="flex-1 space-y-1 min-w-0">
                                    <Label
                                      htmlFor={provider.id}
                                      className="text-sm font-medium leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                      {provider.model}
                                    </Label>
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                      {provider.description}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Anthropic Models */}
                <AccordionItem value="anthropic">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">
                          Anthropic (Claude)
                        </span>
                        {(() => {
                          const anthropicIds = STATIC_EVAL_PROVIDERS.filter(
                            (p) => p.id.startsWith("anthropic_")
                          ).map((p) => p.id);
                          const selection = getCategorySelection(anthropicIds);
                          return (
                            <Badge variant="outline" className="text-xs">
                              {selection.selected}/{selection.total}
                            </Badge>
                          );
                        })()}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3">
                      {(() => {
                        const anthropicProviders = STATIC_EVAL_PROVIDERS.filter(
                          (p) => p.id.startsWith("anthropic_")
                        );
                        const anthropicIds = anthropicProviders.map(
                          (p) => p.id
                        );
                        const selection = getCategorySelection(anthropicIds);
                        return (
                          <>
                            <div className="flex items-center justify-between pb-2 border-b">
                              <span className="text-sm text-muted-foreground">
                                {anthropicProviders.length} model
                                {anthropicProviders.length !== 1
                                  ? "s"
                                  : ""}{" "}
                                available
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() =>
                                  toggleCategory(
                                    anthropicIds,
                                    !selection.allSelected
                                  )
                                }
                              >
                                {selection.allSelected ? (
                                  <>
                                    <CheckSquare className="h-3 w-3 mr-1" />
                                    Deselect All
                                  </>
                                ) : (
                                  <>
                                    <Square className="h-3 w-3 mr-1" />
                                    Select All
                                  </>
                                )}
                              </Button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {anthropicProviders.map((provider) => (
                                <div
                                  key={provider.id}
                                  className="flex items-start space-x-2 p-2 rounded-md border hover:bg-accent/50 transition-colors"
                                >
                                  <Checkbox
                                    id={provider.id}
                                    checked={selectedProviders.includes(
                                      provider.id
                                    )}
                                    onCheckedChange={() =>
                                      toggleProvider(provider.id)
                                    }
                                    disabled={!provider.available}
                                    className="mt-1"
                                  />
                                  <div className="flex-1 space-y-1 min-w-0">
                                    <Label
                                      htmlFor={provider.id}
                                      className="text-sm font-medium leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                      {getDisplayModelName(provider.model)}
                                    </Label>
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                      {provider.description}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>

        {/* Customize Evaluation Prompt Dialog */}
        <Dialog
          open={editingMetric !== null}
          onOpenChange={(open) => !open && setEditingMetric(null)}
        >
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Customize {
                  METRICS.find((m) => m.id === editingMetric)?.label
                }{" "}
                Evaluation Prompt
              </DialogTitle>
              <DialogDescription>
                Modify the evaluation steps that LLM judges use to score this
                metric. Changes are saved automatically.
              </DialogDescription>
            </DialogHeader>

            {editingMetric && (
              <div className="space-y-4 mt-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-800">
                    These steps guide the LLM judge on how to evaluate the
                    extraction. Be specific and clear about what to check and
                    how to score.
                  </AlertDescription>
                </Alert>

                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    Evaluation Steps:
                  </Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resetEvaluationSteps(editingMetric)}
                  >
                    <RotateCcw className="h-3 w-3 mr-2" />
                    Reset to Default
                  </Button>
                </div>

                <div className="space-y-3">
                  {customEvaluationSteps[editingMetric]?.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-sm font-medium text-muted-foreground mt-3 min-w-[28px]">
                        {idx + 1}.
                      </span>
                      <Textarea
                        value={step}
                        onChange={(e) =>
                          updateEvaluationStep(
                            editingMetric,
                            idx,
                            e.target.value
                          )
                        }
                        rows={2}
                        className="flex-1 text-sm"
                        placeholder={`Evaluation step ${idx + 1}...`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEvaluationStep(editingMetric, idx)}
                        disabled={
                          customEvaluationSteps[editingMetric].length <= 1
                        }
                        className="mt-2"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addEvaluationStep(editingMetric)}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Evaluation Step
                </Button>

                <div className="pt-4 border-t">
                  <Button
                    onClick={() => setEditingMetric(null)}
                    className="w-full"
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Entities with Ground Truth & Results */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              Entities (
              {documentData.entities.filter((e) => e.extracted).length})
            </h3>
            <p className="text-sm text-muted-foreground">
              <Info className="h-4 w-4 inline mr-1" />
              Provide ground truth for reference-based metrics
            </p>
          </div>

          <ScrollArea className="h-[600px]">
            <div className="space-y-4 pr-4">
              {documentData.entities
                .filter((e) => e.extracted)
                .map((entity, index) => {
                  const isEvaluating = evaluatingEntities.has(entity.name);
                  const isCompleted = completedEntities.has(entity.name);

                  return (
                    <Card
                      key={index}
                      id={`entity-card-${entity.name}`}
                      className={`border-2 transition-all duration-300 ${
                        isEvaluating
                          ? "border-blue-400 shadow-lg"
                          : isCompleted
                            ? "border-green-400"
                            : ""
                      }`}
                    >
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <span className="text-xs font-medium px-2 py-1 bg-purple-100 text-purple-700 rounded">
                            Entity
                          </span>
                          {entity.name}
                          {isEvaluating && (
                            <span className="flex items-center gap-1 text-sm font-normal text-blue-600 ml-auto">
                              <Sparkles className="h-4 w-4 animate-spin" />
                              Evaluating...
                            </span>
                          )}
                          {!isEvaluating && (
                            <div className="ml-auto flex items-center gap-2">
                              {isCompleted && (
                                <span className="flex items-center gap-1 text-sm font-normal text-green-600 mr-2">
                                  <CheckCircle2 className="h-4 w-4" />
                                  Completed
                                </span>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                className="h-8 text-xs"
                                onClick={() => handleRerunEntity(entity.name)}
                                disabled={evaluatingEntities.has(entity.name)}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Run
                              </Button>
                            </div>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Extracted Output */}
                        <div>
                          <Label className="text-sm font-semibold text-blue-600">
                            Extracted Output
                          </Label>
                          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
                            <p className="text-sm whitespace-pre-wrap">
                              {entity.extracted}
                            </p>
                          </div>
                          {entity.duration && (
                            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                              <span>⏱️ {entity.duration.toFixed(2)}s</span>
                              <span>
                                📊 {entity.promptTokens} →{" "}
                                {entity.completionTokens} tokens
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Ground Truth Input */}
                        <div>
                          <Label
                            htmlFor={`ground-truth-${index}`}
                            className="text-sm font-semibold"
                          >
                            Ground Truth / Expected Output
                            {selectedMetrics.some(
                              (m) => m === "correctness" || m === "completeness"
                            ) && (
                              <span className="ml-2 text-xs text-orange-600 font-normal">
                                (required for Correctness/Completeness)
                              </span>
                            )}
                          </Label>
                          <Textarea
                            id={`ground-truth-${index}`}
                            value={entityGroundTruths[entity.name] || ""}
                            onChange={(e) =>
                              updateGroundTruth(entity.name, e.target.value)
                            }
                            placeholder="Enter the expected/correct output for this entity..."
                            rows={3}
                            className="mt-2"
                          />
                        </div>

                        {/* Evaluation Results Button */}
                        {entity.evaluationResults &&
                          entity.evaluationResults.length > 0 && (
                            <div className="border-t pt-4 animate-in fade-in-50 slide-in-from-bottom-4 duration-500">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className="w-full relative"
                                    size="lg"
                                  >
                                    <BarChart3 className="h-4 w-4 mr-2" />
                                    View Evaluation Results (
                                    {entity.evaluationResults.length} model
                                    {entity.evaluationResults.length > 1
                                      ? "s"
                                      : ""}
                                    )
                                    {isCompleted && !isEvaluating && (
                                      <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                                      </span>
                                    )}
                                  </Button>
                                </DialogTrigger>
                                <DialogContent
                                  className="max-h-[85vh] overflow-y-auto"
                                  style={{ width: "60vw", maxWidth: "60vw" }}
                                >
                                  <DialogHeader>
                                    <DialogTitle className="text-xl">
                                      {entity.name} - Quality Evaluation
                                    </DialogTitle>
                                    <DialogDescription>
                                      Compare how different LLM judges scored
                                      each metric
                                    </DialogDescription>
                                  </DialogHeader>

                                  {(() => {
                                    // Get all unique metrics from all results
                                    const allMetrics = Array.from(
                                      new Set(
                                        entity.evaluationResults!.flatMap((r) =>
                                          r.metrics.map((m) =>
                                            m.metric_name.replace(
                                              "Entity Extraction ",
                                              ""
                                            )
                                          )
                                        )
                                      )
                                    );

                                    // Metric definitions
                                    const metricDefinitions: Record<
                                      string,
                                      string
                                    > = {
                                      Correctness:
                                        "Measures whether the LLM output is factually accurate and adheres to the ground truth or expected answer. This means the generated output should not contain inconsistent, incorrect, or fabricated information. The metric typically compares the response against reference answers or established facts for validation.",
                                      Completeness:
                                        "Evaluates if the LLM output contains all information necessary to fully resolve the prompt or test case. An answer is complete when it covers every relevant aspect required by the input, without missing essential steps, explanations, or pieces of information expected for a thorough response.",
                                      Relevance:
                                        "Checks if the output directly addresses the question or input context in an informative and focused manner. The metric assesses whether the generated content is on-topic for the user's request, avoiding verbosity, tangential statements, or filler, and prioritizing concise, targeted responses.",
                                      Safety:
                                        "Measures whether the LLM output avoids harmful, toxic, or inappropriate content. This includes screening for bias, offensive language, dangerous instructions, and other outputs that could be considered unethical, illegal, or damaging. Safety metrics typically incorporate several automated red-teaming and prompt injection assessments to flag vulnerabilities or problematic responses.",
                                    };

                                    return (
                                      <Tabs
                                        defaultValue={allMetrics[0]}
                                        className="w-full"
                                      >
                                        <TabsList
                                          className="grid w-full"
                                          style={{
                                            gridTemplateColumns: `repeat(${allMetrics.length}, 1fr)`,
                                          }}
                                        >
                                          {allMetrics.map((metricName) => (
                                            <TabsTrigger
                                              key={metricName}
                                              value={metricName}
                                            >
                                              {metricName}
                                            </TabsTrigger>
                                          ))}
                                        </TabsList>

                                        {allMetrics.map((metricName) => (
                                          <TabsContent
                                            key={metricName}
                                            value={metricName}
                                            className="space-y-4 mt-4"
                                          >
                                            {/* Contextual Metric Definition */}
                                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                              <h4 className="font-semibold text-sm text-blue-900 mb-2 flex items-center gap-2">
                                                <Info className="h-4 w-4" />
                                                Understanding {metricName}
                                              </h4>
                                              <p className="text-sm text-blue-800 leading-relaxed">
                                                {metricDefinitions[metricName]}
                                              </p>
                                              <p className="text-xs text-blue-700 italic mt-3 pt-3 border-t border-blue-200">
                                                This metric uses LLM-as-a-judge
                                                techniques, providing robust
                                                scoring (0-1 range) and
                                                human-explainable reasoning.
                                              </p>
                                            </div>

                                            {/* Evaluation Reasoning Cards */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                              {entity.evaluationResults!.map(
                                                (result, idx) => {
                                                  const metric =
                                                    result.metrics.find(
                                                      (m) =>
                                                        m.metric_name.replace(
                                                          "Entity Extraction ",
                                                          ""
                                                        ) === metricName
                                                    );
                                                  if (!metric) return null;

                                                  return (
                                                    <Card key={idx}>
                                                      <CardHeader className="pb-3">
                                                        <CardTitle className="text-base flex items-center gap-2">
                                                          {metric.success ? (
                                                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                                                          ) : (
                                                            <XCircle className="h-5 w-5 text-red-600" />
                                                          )}
                                                          {getDisplayModelName(
                                                            result.model
                                                          )}
                                                        </CardTitle>
                                                        <CardDescription className="flex flex-col gap-2">
                                                          <div className="flex items-center gap-2">
                                                            <Badge variant="outline">
                                                              {getDisplayModelName(
                                                                result.model
                                                              )}
                                                            </Badge>
                                                            {result.all_passed ? (
                                                              <Badge className="bg-green-500 hover:bg-green-600">
                                                                Pass
                                                              </Badge>
                                                            ) : (
                                                              <Badge variant="destructive">
                                                                Fail
                                                              </Badge>
                                                            )}
                                                            <span className="text-xs text-muted-foreground ml-auto">
                                                              {result.evaluation_time.toFixed(
                                                                2
                                                              )}
                                                              s
                                                            </span>
                                                          </div>
                                                          <div className="flex items-center justify-between">
                                                            <span>
                                                              Score:{" "}
                                                              <span
                                                                className={
                                                                  metric.success
                                                                    ? "text-green-600 font-semibold"
                                                                    : "text-red-600 font-semibold"
                                                                }
                                                              >
                                                                {(
                                                                  metric.score *
                                                                  100
                                                                ).toFixed(0)}
                                                              </span>
                                                              /100
                                                            </span>
                                                            <span className="text-muted-foreground">
                                                              Threshold:{" "}
                                                              {(
                                                                metric.threshold *
                                                                100
                                                              ).toFixed(0)}
                                                            </span>
                                                          </div>
                                                        </CardDescription>
                                                      </CardHeader>
                                                      <CardContent>
                                                        <p className="text-sm text-muted-foreground leading-relaxed">
                                                          {metric.reason}
                                                        </p>
                                                      </CardContent>
                                                    </Card>
                                                  );
                                                }
                                              )}
                                            </div>
                                          </TabsContent>
                                        ))}
                                      </Tabs>
                                    );
                                  })()}
                                </DialogContent>
                              </Dialog>
                            </div>
                          )}
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          </ScrollArea>
        </div>

        {/* Success Message */}
        {evaluationComplete && (
          <Alert className="bg-green-50 border-green-300">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <AlertDescription className="text-green-800 font-medium">
              ✅ Evaluation completed successfully! All{" "}
              {
                documentData.entities.filter(
                  (e) => e.evaluationResults && e.evaluationResults.length > 0
                ).length
              }{" "}
              entities have been evaluated. Click "View Evaluation Results" on
              any entity below to see the scores.
            </AlertDescription>
          </Alert>
        )}

        {/* Run Evaluation Button */}
        <Card>
          <CardContent className="pt-6">
            <Button
              type="button"
              onClick={handleRunEvaluation}
              disabled={
                isEvaluating ||
                evaluatingEntities.size > 0 ||
                selectedMetrics.length === 0 ||
                selectedProviders.length === 0
              }
              className="w-full"
              size="lg"
            >
              {isEvaluating ? (
                <>
                  <Sparkles className="h-5 w-5 mr-2 animate-spin" />
                  Running Evaluation... {evaluationProgress}%
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 mr-2" />
                  Run Evaluation with {selectedProviders.length} LLM Judge
                  {selectedProviders.length > 1 ? "s" : ""}
                </>
              )}
            </Button>

            {isEvaluating && (
              <div className="mt-4 space-y-2">
                <Progress value={evaluationProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {completedEntities.size} of{" "}
                  {documentData.entities.filter((e) => e.extracted).length}{" "}
                  entities completed
                </p>
              </div>
            )}

            {!isEvaluating && (
              <p className="text-sm text-muted-foreground text-center mt-3">
                Evaluating{" "}
                {documentData.entities.filter((e) => e.extracted).length}{" "}
                entities with {selectedMetrics.length} metrics across{" "}
                {selectedProviders.length} provider(s)
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Floating Stop Button */}
      {isEvaluating && (
        <div className="fixed bottom-8 right-8 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Button
            variant="destructive"
            size="lg"
            type="button"
            onClick={handleStopEvaluation}
            className="shadow-lg hover:shadow-xl transition-all scale-100 hover:scale-105 rounded-full px-6 h-14 font-semibold text-base bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <div className="flex items-center gap-2">
              <div className="relative flex h-3 w-3 mr-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
              </div>
              Stop Evaluation
            </div>
          </Button>
        </div>
      )}
    </div>
  );
}
