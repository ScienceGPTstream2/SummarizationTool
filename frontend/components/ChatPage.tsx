import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Paperclip,
  X,
  FileText,
  Loader2,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Copy,
  RefreshCw,
  Check,
  Upload,
  Bot,
} from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  fetchAllModels,
  pickBestFromList,
  ModelConfig,
} from "../utils/modelSelection";
import { getValidToken } from "../utils/authUtils";
import { toast } from "./ui/sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const MAX_DOCS = 5;

type DocEntry =
  | { status: "loading"; file: File; tempId: string }
  | {
      status: "ready";
      file: File;
      tempId: string;
      fileHash: string;
      markdown: string;
      processorUsed: string;
    }
  | { status: "error"; file: File; tempId: string; error: string };

interface ChatPageProps {
  onSwitchToWorkflow?: () => void;
  userEmail?: string;
  onSignOut?: () => void;
}

// ─── Small sub-components ─────────────────────────────────────────────────────

function AvatarAI() {
  return (
    <div className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center shrink-0">
      <Bot className="h-3.5 w-3.5 text-background" />
    </div>
  );
}

// ─── Message row ──────────────────────────────────────────────────────────────

interface MessageRowProps {
  message: Message;
  rating: "up" | "down" | null;
  onRate: (id: string, rating: "up" | "down") => void;
  onCopy: (content: string) => void;
  onRegenerate: (id: string) => void;
  isRegenerating: boolean;
}

function MessageRow({
  message,
  rating,
  onRate,
  onCopy,
  onRegenerate,
  isRegenerating,
}: MessageRowProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = () => {
    onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUser) {
    return (
      <div className="px-4 py-2">
        <div className="max-w-3xl mx-auto flex justify-end">
          <div className="max-w-[72%] bg-muted text-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // Assistant message — with markdown rendering
  return (
    <div className="group px-4 py-3">
      <div className="max-w-3xl mx-auto flex gap-3">
        <AvatarAI />
        <div className="flex-1 min-w-0">
          {/* Markdown content */}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p className="text-sm leading-relaxed mb-2 last:mb-0">
                  {children}
                </p>
              ),
              h1: ({ children }) => (
                <h1 className="text-base font-semibold mt-4 mb-2 first:mt-0">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-sm font-semibold mt-4 mb-1.5 first:mt-0">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-semibold mt-3 mb-1 first:mt-0">
                  {children}
                </h3>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold">{children}</strong>
              ),
              em: ({ children }) => <em className="italic">{children}</em>,
              ul: ({ children }) => (
                <ul className="list-disc list-outside ml-4 mb-2 space-y-0.5 text-sm">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal list-outside ml-4 mb-2 space-y-0.5 text-sm">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="leading-relaxed">{children}</li>
              ),
              code: ({ inline, children }: any) =>
                inline ? (
                  <code className="bg-muted text-foreground font-mono text-[0.8em] px-1.5 py-0.5 rounded">
                    {children}
                  </code>
                ) : (
                  <pre className="bg-muted rounded-xl p-4 overflow-x-auto my-2">
                    <code className="font-mono text-xs text-foreground">
                      {children}
                    </code>
                  </pre>
                ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-border pl-3 text-muted-foreground my-2 text-sm">
                  {children}
                </blockquote>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto my-2">
                  <table className="text-sm border-collapse w-full">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="bg-muted px-3 py-1.5 text-left font-medium border border-border text-xs">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-3 py-1.5 border border-border text-xs">
                  {children}
                </td>
              ),
              hr: () => <hr className="border-border my-3" />,
            }}
          >
            {message.content}
          </ReactMarkdown>

          {/* Action bar — visible on hover */}
          <div className="flex items-center gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <ActionBtn
              title={copied ? "Copied!" : "Copy"}
              onClick={handleCopy}
              active={copied}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </ActionBtn>
            <ActionBtn
              title="Good response"
              onClick={() => onRate(message.id, "up")}
              active={rating === "up"}
            >
              <ThumbsUp
                className={`h-3.5 w-3.5 ${rating === "up" ? "fill-current" : ""}`}
              />
            </ActionBtn>
            <ActionBtn
              title="Bad response"
              onClick={() => onRate(message.id, "down")}
              active={rating === "down"}
            >
              <ThumbsDown
                className={`h-3.5 w-3.5 ${rating === "down" ? "fill-current" : ""}`}
              />
            </ActionBtn>
            <ActionBtn
              title="Regenerate"
              onClick={() => onRegenerate(message.id)}
              disabled={isRegenerating}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRegenerating ? "animate-spin" : ""}`}
              />
            </ActionBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? "text-foreground bg-muted"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

// ─── Drag overlay ─────────────────────────────────────────────────────────────

function DragOverlay() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-none pointer-events-none">
      <div className="flex flex-col items-center gap-3 text-primary">
        <Upload className="h-10 w-10" />
        <p className="text-base font-medium">Drop document to attach</p>
        <p className="text-sm text-muted-foreground">PDF, DOCX, TXT and more</p>
      </div>
    </div>
  );
}

// ─── Main ChatPage ─────────────────────────────────────────────────────────────

export function ChatPage({ onSwitchToWorkflow, onSignOut }: ChatPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [ratings, setRatings] = useState<Record<string, "up" | "down">>({});

  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState(true);

  const [docs, setDocs] = useState<Map<string, DocEntry>>(new Map());
  const [contextError, setContextError] = useState(false);

  const removeDoc = useCallback((tempId: string) => {
    setDocs((prev) => {
      const next = new Map(prev);
      next.delete(tempId);
      return next;
    });
  }, []);

  const activeDocCount = Array.from(docs.values()).filter(
    (d) => d.status !== "error"
  ).length;
  const atDocLimit = activeDocCount >= MAX_DOCS;

  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Models ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchAllModels()
      .then((models) => {
        setAvailableModels(models);
        const best = pickBestFromList(models);
        if (best) setSelectedModelId(best.model.id);
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, []);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // ── Document processing ─────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    const tempId = crypto.randomUUID();

    setDocs((prev) => {
      const active = Array.from(prev.values()).filter(
        (d) => d.status !== "error"
      ).length;
      if (active >= MAX_DOCS) return prev;
      const next = new Map(prev);
      next.set(tempId, { status: "loading", file, tempId });
      return next;
    });

    try {
      const token = await getValidToken();
      if (!token) throw new Error("Not authenticated");

      // 1. Upload
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!uploadRes.ok)
        throw new Error(`Upload failed: ${await uploadRes.text()}`);
      const { file_hash: fileHash } = await uploadRes.json();

      // 2. Process via Azure Document Intelligence
      const processRes = await fetch(
        `/api/documents/process/file/${fileHash}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ processor: "azure_doc_intelligence" }),
        }
      );
      if (!processRes.ok)
        throw new Error(`Processing failed: ${await processRes.text()}`);
      const { processor_used: processorUsed = "azure_doc_intelligence" } =
        await processRes.json();

      // 3. Retrieve markdown
      const contentRes = await fetch(
        `/api/documents/${fileHash}/content?processor_used=${processorUsed}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!contentRes.ok)
        throw new Error(`Content retrieval failed: ${await contentRes.text()}`);
      const { markdown_content: markdown = "" } = await contentRes.json();

      setDocs((prev) => {
        if (!prev.has(tempId)) return prev; // user removed mid-flight; honour it
        const next = new Map(prev);
        next.set(tempId, {
          status: "ready",
          file,
          tempId,
          fileHash,
          markdown,
          processorUsed,
        });
        return next;
      });
      toast.success(`"${file.name}" attached as context`);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to process document";
      setDocs((prev) => {
        if (!prev.has(tempId)) return prev; // user removed mid-flight; honour it
        const next = new Map(prev);
        next.set(tempId, { status: "error", file, tempId, error: msg });
        return next;
      });
      toast.error(msg);
    }
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const available =
        MAX_DOCS -
        Array.from(docs.values()).filter((d) => d.status !== "error").length;
      if (available <= 0) return;
      const toProcess = files.slice(0, available);
      if (files.length > available)
        toast.warning(
          `Maximum ${MAX_DOCS} documents — ${files.length - available} file(s) skipped`
        );
      toProcess.forEach((f) => processFile(f));
    },
    [docs, processFile]
  );

  // ── Drag and drop ───────────────────────────────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      const available =
        MAX_DOCS -
        Array.from(docs.values()).filter((d) => d.status !== "error").length;
      if (available <= 0) {
        toast.error(`Maximum ${MAX_DOCS} documents already attached`);
        return;
      }
      const toProcess = files.slice(0, available);
      if (files.length > available)
        toast.warning(
          `Maximum ${MAX_DOCS} documents — ${files.length - available} file(s) skipped`
        );
      toProcess.forEach((f) => processFile(f));
    },
    [docs, processFile]
  );

  // ── Model config ─────────────────────────────────────────────────────────────
  const getModelConfig = useCallback(() => {
    const model = availableModels.find((m) => m.id === selectedModelId);
    if (!model) return null;
    const isGemini = model.provider === "Google Gemini";
    const isAnthropic = model.provider === "Anthropic";
    const isLlama =
      model.provider === "Meta Llama" ||
      (model as any).model_type === "azure-llama";
    return {
      modelType: isGemini
        ? "gemini"
        : isAnthropic
          ? "anthropic"
          : isLlama
            ? "llama"
            : "azure",
      modelId: model.id,
      deployment: model.deployment,
      apiVersion: model.api_version,
    };
  }, [availableModels, selectedModelId]);

  // ── Send ─────────────────────────────────────────────────────────────────────
  const isContextWindowError = (msg: string) => {
    const lower = msg.toLowerCase();
    return (
      lower.includes("context_length_exceeded") ||
      lower.includes("maximum context length") ||
      lower.includes("context window") ||
      (lower.includes("token") && lower.includes("limit"))
    );
  };

  const sendQuery = useCallback(
    async (query: string) => {
      const modelConfig = getModelConfig();
      if (!modelConfig) {
        toast.error("Please select a model");
        return;
      }

      setContextError(false);
      setIsLoading(true);

      // Build combined document markdown from all ready docs
      const readyDocs = Array.from(docs.values()).filter(
        (d): d is Extract<DocEntry, { status: "ready" }> => d.status === "ready"
      );
      const documentMarkdown =
        readyDocs.length > 0
          ? readyDocs
              .map(
                (d) =>
                  `<document name="${d.file.name}">\n${d.markdown}\n</document>`
              )
              .join("\n\n")
          : null;

      try {
        const token = await getValidToken();
        if (!token) throw new Error("Not authenticated");

        const res = await fetch("/api/chat/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query,
            document_markdown: documentMarkdown,
            model_type: modelConfig.modelType,
            model_id: modelConfig.modelId,
            deployment: modelConfig.deployment ?? null,
            api_version: modelConfig.apiVersion ?? null,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success)
          throw new Error(data.error || "Request failed");

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.response,
          },
        ]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        if (isContextWindowError(msg)) {
          setContextError(true);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `Error: ${msg}`,
            },
          ]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [docs, getModelConfig]
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: trimmed },
    ]);
    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await sendQuery(trimmed);
  }, [input, isLoading, sendQuery]);

  const handleRegenerate = useCallback(
    async (assistantMsgId: string) => {
      // Find the user message that preceded this assistant message
      const idx = messages.findIndex((m) => m.id === assistantMsgId);
      if (idx < 1) return;
      const preceding = messages[idx - 1];
      if (preceding.role !== "user") return;

      // Remove the assistant message and resend
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
      await sendQuery(preceding.content);
    },
    [messages, sendQuery]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleRate = useCallback((id: string, rating: "up" | "down") => {
    setRatings((prev) => ({
      ...prev,
      [id]: prev[id] === rating ? undefined! : rating,
    }));
  }, []);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content).catch(() => {});
  }, []);

  const canSend = !!input.trim() && !isLoading && !!selectedModelId;

  return (
    <div
      className="relative flex flex-col h-screen bg-background text-foreground"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragOver && <DragOverlay />}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="shrink-0 relative flex items-center h-14 px-4 border-b border-border bg-background z-10">
        {/* Left: model selector */}
        <div className="flex items-center gap-2">
          {modelsLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Select
            value={selectedModelId}
            onValueChange={setSelectedModelId}
            disabled={modelsLoading}
          >
            {/* gap-1.5 pl-3 pr-3 override the default gap-4/pl-4/pr-6 so the chevron sits flush */}
            <SelectTrigger className="h-8 text-xs w-[160px] gap-1.5 pl-3 pr-3 focus-visible:ring-0 focus-visible:border-border">
              <SelectValue
                placeholder={
                  availableModels.length === 0 ? "No models" : "Select model"
                }
              />
            </SelectTrigger>
            <SelectContent align="start" className="max-h-64">
              {availableModels.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  {m.name}
                </SelectItem>
              ))}
              {availableModels.length === 0 && !modelsLoading && (
                <div className="px-2 py-2 text-xs text-muted-foreground text-center">
                  No models configured
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Centre: title (absolutely positioned so it's always truly centred) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-semibold text-sm tracking-tight">
            Science-GPT
          </span>
        </div>

        {/* Right: actions */}
        <div className="ml-auto flex items-center gap-1">
          {onSwitchToWorkflow && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={onSwitchToWorkflow}
            >
              Advanced Mode
            </Button>
          )}
          {onSignOut && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={onSignOut}
            >
              Sign out
            </Button>
          )}
        </div>
      </header>

      {/* ── Message list ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-4 px-6 pb-20 select-none">
            <div className="w-14 h-14 rounded-2xl bg-foreground flex items-center justify-center">
              <Bot className="h-7 w-7 text-background" />
            </div>
            <div className="text-center space-y-1.5">
              <h2 className="text-2xl font-semibold tracking-tight">
                How can I help?
              </h2>
              <p className="text-muted-foreground text-sm max-w-xs leading-relaxed">
                Ask me anything, or drop a document to chat about its contents.
              </p>
            </div>
          </div>
        ) : (
          <div className="py-4">
            {messages.map((msg) => (
              <MessageRow
                key={msg.id}
                message={msg}
                rating={ratings[msg.id] ?? null}
                onRate={handleRate}
                onCopy={handleCopy}
                onRegenerate={handleRegenerate}
                isRegenerating={isLoading}
              />
            ))}

            {/* Thinking indicator */}
            {isLoading && (
              <div className="px-4 py-3">
                <div className="max-w-3xl mx-auto flex gap-3">
                  <AvatarAI />
                  <div className="flex items-center gap-1 pt-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Composer ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pb-4 pt-2 bg-background">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* Document badges */}
          {docs.size > 0 && (
            <div className="flex flex-col gap-1 px-1">
              <div
                className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                onWheel={(e) => {
                  e.preventDefault();
                  e.currentTarget.scrollLeft += e.deltaY;
                }}
              >
                {Array.from(docs.values()).map((entry) => {
                  if (entry.status === "loading") {
                    return (
                      <div
                        key={entry.tempId}
                        className="inline-flex shrink-0 items-center gap-2 px-3 py-1.5 rounded-xl bg-muted text-xs text-muted-foreground"
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                        <span className="truncate max-w-[200px]">
                          {entry.file.name}
                        </span>
                      </div>
                    );
                  }
                  if (entry.status === "error") {
                    return (
                      <div
                        key={entry.tempId}
                        className="inline-flex shrink-0 items-center gap-2 px-3 py-1.5 rounded-xl bg-destructive/10 text-destructive text-xs"
                      >
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate max-w-[200px]">
                          {entry.file.name}
                        </span>
                        <button
                          onClick={() => removeDoc(entry.tempId)}
                          className="ml-0.5 hover:opacity-70"
                          aria-label="Remove"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  }
                  // ready
                  return (
                    <div
                      key={entry.tempId}
                      className="inline-flex shrink-0 items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-xl border border-border bg-muted/50 text-xs"
                    >
                      <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="font-medium truncate max-w-[180px]">
                        {entry.file.name}
                      </span>
                      <span className="text-muted-foreground">
                        · in context
                      </span>
                      <button
                        onClick={() => removeDoc(entry.tempId)}
                        className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Remove document"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground/60 px-0.5">
                Up to 5 docs supported — recommend uploading one at a time per
                chat.
              </p>
            </div>
          )}

          {/* Context window error banner */}
          {contextError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">
                Context window exceeded — your documents are too large. Remove a
                document and try again.
              </span>
              <button
                onClick={() => setContextError(false)}
                className="ml-0.5 hover:opacity-70"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Input box — ChatGPT layout: textarea on top, icons on bottom */}
          <div className="rounded-2xl border border-border bg-background shadow-sm focus-within:border-foreground/20 focus-within:shadow-md transition-all duration-150">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Science-GPT…"
              rows={1}
              className="w-full resize-none border-0 shadow-none focus-visible:ring-0 bg-transparent px-4 pt-3.5 pb-1 min-h-[52px] max-h-52 text-sm placeholder:text-muted-foreground/50 leading-relaxed"
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
              }}
            />

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              {/* Left: attach */}
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.pptx,.ppt"
                  className="hidden"
                  onChange={handleFileInputChange}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={atDocLimit}
                  title="Attach document (or drag & drop)"
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Paperclip className="h-[18px] w-[18px]" />
                </button>
              </div>

              {/* Right: send */}
              <button
                onClick={handleSend}
                disabled={!canSend}
                title="Send (Enter)"
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                  canSend
                    ? "bg-foreground text-background hover:bg-foreground/85"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-center text-[11px] text-muted-foreground/60 leading-relaxed">
            Science-GPT can make mistakes. Check important information
            carefully.
          </p>
        </div>
      </div>
    </div>
  );
}
