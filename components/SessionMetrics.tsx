import { useCallback, useMemo, useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { authenticatedFetch } from "../utils/authUtils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

interface BatchMetric {
  batch_number: number;
  batch_latency: number;
  document_count: number;
}

interface SessionMetricsData {
  total_cost: number;
  total_latency: number;
  total_calls: number;
  calls?: Array<{
    provider: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    duration: number;
    cost: number;
    timestamp: string;
    document_name?: string | null;
    page_count?: number;
    figure_count?: number;
    table_count?: number;
    batch_number?: number | null;
  }>;
  batches?: Record<string, BatchMetric>;
}

interface BenchmarkClearResult {
  ok: boolean;
  output: string;
  errors: string;
  exit_code: number;
}

export function SessionMetrics() {
  const [metrics, setMetrics] = useState<SessionMetricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Dangerous clear state
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const [clearProcessor, setClearProcessor] = useState<string>("all");
  const [clearRunning, setClearRunning] = useState(false);
  const [clearResult, setClearResult] = useState<BenchmarkClearResult | null>(
    null
  );

  const summaries = useMemo(() => {
    const calls = metrics?.calls ?? [];
    const providerStats = new Map<
      string,
      { calls: number; totalCost: number; totalLatency: number }
    >();
    const modelStats = new Map<
      string,
      {
        provider: string;
        calls: number;
        totalCost: number;
        totalLatency: number;
      }
    >();

    calls.forEach((call) => {
      const providerKey = call.provider || "Unknown";
      const modelKey = call.model || "Unknown";

      const providerEntry = providerStats.get(providerKey) || {
        calls: 0,
        totalCost: 0,
        totalLatency: 0,
      };
      providerEntry.calls += 1;
      providerEntry.totalCost += call.cost || 0;
      providerEntry.totalLatency += call.duration || 0;
      providerStats.set(providerKey, providerEntry);

      const modelEntry = modelStats.get(modelKey) || {
        provider: providerKey,
        calls: 0,
        totalCost: 0,
        totalLatency: 0,
      };
      modelEntry.calls += 1;
      modelEntry.totalCost += call.cost || 0;
      modelEntry.totalLatency += call.duration || 0;
      modelStats.set(modelKey, modelEntry);
    });

    const providerRows = Array.from(providerStats.entries()).map(
      ([provider, stats]) => ({
        provider,
        calls: stats.calls,
        totalCost: stats.totalCost,
        avgLatency: stats.calls ? stats.totalLatency / stats.calls : 0,
      })
    );

    const modelRows = Array.from(modelStats.entries()).map(
      ([model, stats]) => ({
        model,
        provider: stats.provider,
        calls: stats.calls,
        totalCost: stats.totalCost,
        avgLatency: stats.calls ? stats.totalLatency / stats.calls : 0,
      })
    );

    providerRows.sort((a, b) => b.totalCost - a.totalCost);
    modelRows.sort((a, b) => b.totalCost - a.totalCost);

    const DOC_MODELS = new Set(["azure_doc_intelligence", "docling"]);
    const docModelStats = new Map<
      string,
      {
        provider: string;
        docs: Array<{
          name: string;
          duration: number;
          cost: number;
          page_count: number;
          figure_count: number;
          table_count: number;
          batch_number: number | null;
        }>;
        totalCost: number;
        totalLatency: number;
      }
    >();
    calls
      .filter((call) => DOC_MODELS.has(call.model))
      .forEach((call) => {
        const key = call.model;
        const entry = docModelStats.get(key) || {
          provider: call.provider || "azure",
          docs: [],
          totalCost: 0,
          totalLatency: 0,
        };
        entry.docs.push({
          name: call.document_name || "Unknown document",
          duration: call.duration || 0,
          cost: call.cost || 0,
          page_count: call.page_count ?? 0,
          figure_count: call.figure_count ?? 0,
          table_count: call.table_count ?? 0,
          batch_number: call.batch_number ?? null,
        });
        entry.totalCost += call.cost || 0;
        entry.totalLatency += call.duration || 0;
        docModelStats.set(key, entry);
      });
    const docRows = Array.from(docModelStats.entries()).map(
      ([model, stats]) => ({
        model,
        provider: stats.provider,
        docs: stats.docs,
        totalCost: stats.totalCost,
        avgLatency: stats.docs.length
          ? stats.totalLatency / stats.docs.length
          : 0,
      })
    );

    // Batch rows: merge backend batches with per-call sum for comparison
    const batchMap = metrics?.batches ?? {};
    const batchSumLatency = new Map<number, number>();
    calls
      .filter((call) => DOC_MODELS.has(call.model) && call.batch_number != null)
      .forEach((call) => {
        const bn = call.batch_number!;
        batchSumLatency.set(
          bn,
          (batchSumLatency.get(bn) ?? 0) + (call.duration || 0)
        );
      });
    const batchRows = Object.values(batchMap)
      .map((b) => ({
        batch_number: b.batch_number,
        batch_latency: b.batch_latency,
        document_count: b.document_count,
        sum_latency: batchSumLatency.get(b.batch_number) ?? 0,
      }))
      .sort((a, b) => a.batch_number - b.batch_number);

    return { providerRows, modelRows, docRows, batchRows };
  }, [metrics]);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch("/api/server/session-metrics");
      const data = await response.json();
      setMetrics(data.metrics || null);
    } catch (error) {
      console.warn("Failed to fetch session metrics:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClear = async () => {
    setClearing(true);
    try {
      await authenticatedFetch("/api/server/session-metrics", {
        method: "DELETE",
      });
      setMetrics({
        total_cost: 0,
        total_latency: 0,
        total_calls: 0,
        calls: [],
      });
    } catch (error) {
      console.warn("Failed to clear session metrics:", error);
    } finally {
      setClearing(false);
    }
  };

  const handleBenchmarkClear = async (mode: "dry_run" | "execute") => {
    setClearRunning(true);
    setClearResult(null);
    try {
      const processor = clearProcessor === "all" ? null : clearProcessor;
      const response = await authenticatedFetch("/api/server/benchmark/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, processor }),
      });
      const data: BenchmarkClearResult = await response.json();
      setClearResult(data);
    } catch (error) {
      setClearResult({
        ok: false,
        output: "",
        errors: String(error),
        exit_code: 1,
      });
    } finally {
      setClearRunning(false);
    }
  };

  const displayMetrics = metrics || {
    total_cost: 0,
    total_latency: 0,
    total_calls: 0,
    calls: [],
  };

  return (
    <>
      {/* Benchmark clear confirmation modal */}
      <Dialog
        open={showClearModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowClearModal(false);
            setClearConfirmed(false);
            setClearResult(null);
            setClearProcessor("all");
          }
        }}
      >
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-destructive">
              ⚠ Clear Benchmark Cache
            </DialogTitle>
            <DialogDescription>
              This deletes all sessions, documents, and extraction results from
              the database and removes processed caches from the filesystem. It
              impacts <strong>all users</strong>. Original uploaded PDFs are
              preserved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium">Processor filter</label>
              <select
                value={clearProcessor}
                onChange={(e) => {
                  setClearProcessor(e.target.value);
                  setClearConfirmed(false);
                }}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              >
                <option value="all">All processors (docling + Azure DI)</option>
                <option value="docling">Docling only</option>
                <option value="azure_doc_intelligence">
                  Azure Doc Intelligence only
                </option>
              </select>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBenchmarkClear("dry_run")}
                disabled={clearRunning}
              >
                {clearRunning ? "Running..." : "Dry Run"}
              </Button>
              {!clearConfirmed ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setClearConfirmed(true)}
                  disabled={clearRunning}
                >
                  Clear All
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  className="animate-pulse"
                  onClick={() => {
                    setClearConfirmed(false);
                    handleBenchmarkClear("execute");
                  }}
                  disabled={clearRunning}
                >
                  {clearRunning ? "Clearing..." : "⚠ Click again to confirm"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowClearModal(false);
                  setClearConfirmed(false);
                }}
                disabled={clearRunning}
              >
                Cancel
              </Button>
            </div>

            {clearResult && (
              <div className="space-y-2">
                <div
                  className={`text-sm font-medium ${clearResult.ok ? "text-green-600" : "text-destructive"}`}
                >
                  {clearResult.ok
                    ? "✓ Success"
                    : `✗ Failed (exit code ${clearResult.exit_code})`}
                </div>
                {clearResult.output && (
                  <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-[50vh] whitespace-pre-wrap">
                    {clearResult.output}
                  </pre>
                )}
                {clearResult.errors && (
                  <pre className="text-xs bg-destructive/10 text-destructive rounded p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                    {clearResult.errors}
                  </pre>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Main metrics modal */}
      <Dialog
        onOpenChange={(open) => {
          if (open) fetchMetrics();
        }}
      >
        <DialogTrigger asChild>
          <Card className="px-4 py-2 bg-muted/30 border border-border cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="secondary">Session Metrics</Badge>
              {displayMetrics.total_cost > 0 && (
                <span className="text-muted-foreground">
                  Cost: <strong>${displayMetrics.total_cost.toFixed(4)}</strong>
                </span>
              )}
              {displayMetrics.total_latency > 0 && (
                <span className="text-muted-foreground">
                  Latency:{" "}
                  <strong>{displayMetrics.total_latency.toFixed(2)}s</strong>
                </span>
              )}
              {displayMetrics.total_calls > 0 && (
                <span className="text-muted-foreground">
                  Calls: <strong>{displayMetrics.total_calls}</strong>
                </span>
              )}
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Click to view & refresh
              </span>
            </div>
          </Card>
        </DialogTrigger>
        <DialogContent className="w-[99vw] max-w-[96rem] min-w-[1080px] max-h-[90vh] overflow-hidden">
          <DialogHeader className="shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3 pr-12">
              <DialogTitle>Session Metrics Breakdown</DialogTitle>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={fetchMetrics}
                  disabled={loading}
                >
                  {loading ? "Refreshing..." : "⟳ Refresh Metrics"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  disabled={clearing}
                >
                  {clearing ? "Clearing..." : "Clear metrics"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowClearModal(true)}
                >
                  Dangerous: Clear Cache
                </Button>
              </div>
            </div>
            <DialogDescription>
              Per-provider and per-model usage for this browser session.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 overflow-y-auto pr-2 max-h-[70vh]">
            <Card className="border border-border">
              <CardContent className="pt-4">
                <h3 className="text-sm font-semibold mb-3">By Provider</h3>
                {summaries.providerRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No calls recorded yet.
                  </p>
                ) : (
                  <div className="w-full overflow-x-auto">
                    <Table className="table-auto min-w-[520px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-1/3">Provider</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                          <TableHead className="text-right">
                            Avg Latency
                          </TableHead>
                          <TableHead className="text-right">
                            Total Cost
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaries.providerRows.map((row) => (
                          <TableRow key={row.provider}>
                            <TableCell className="font-medium break-words">
                              {row.provider}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.calls}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.avgLatency.toFixed(2)}s
                            </TableCell>
                            <TableCell className="text-right">
                              ${row.totalCost.toFixed(4)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-border">
              <CardContent className="pt-4">
                <h3 className="text-sm font-semibold mb-3">By Model</h3>
                {summaries.modelRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No calls recorded yet.
                  </p>
                ) : (
                  <div className="w-full overflow-x-auto">
                    <Table className="table-auto min-w-[620px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Model</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                          <TableHead className="text-right">
                            Avg Latency
                          </TableHead>
                          <TableHead className="text-right">
                            Total Cost
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaries.modelRows.map((row) => (
                          <TableRow key={`${row.provider}-${row.model}`}>
                            <TableCell className="font-medium whitespace-nowrap">
                              {row.model}
                            </TableCell>
                            <TableCell>{row.provider}</TableCell>
                            <TableCell className="text-right">
                              {row.calls}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.avgLatency.toFixed(2)}s
                            </TableCell>
                            <TableCell className="text-right">
                              ${row.totalCost.toFixed(4)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {summaries.batchRows.length > 0 && (
              <Card className="border border-border">
                <CardContent className="pt-4">
                  <h3 className="text-sm font-semibold mb-3">By Batch</h3>
                  <div className="w-full overflow-x-auto">
                    <Table className="table-auto min-w-[560px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Batch #</TableHead>
                          <TableHead className="text-right">
                            Documents
                          </TableHead>
                          <TableHead className="text-right">
                            Batch Latency
                          </TableHead>
                          <TableHead className="text-right">
                            Sum of Doc Latencies
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaries.batchRows.map((b) => (
                          <TableRow key={b.batch_number}>
                            <TableCell className="font-medium">
                              #{b.batch_number}
                            </TableCell>
                            <TableCell className="text-right">
                              {b.document_count}
                            </TableCell>
                            <TableCell className="text-right">
                              {b.batch_latency.toFixed(2)}s
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {b.sum_latency.toFixed(2)}s
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {summaries.docRows.length > 0 && (
              <Card className="border border-border">
                <CardContent className="pt-4">
                  <h3 className="text-sm font-semibold mb-3">
                    Document Processing
                  </h3>
                  <div className="w-full overflow-x-auto">
                    <Table className="table-auto min-w-[820px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Processor</TableHead>
                          <TableHead>Document</TableHead>
                          <TableHead className="text-right">Batch</TableHead>
                          <TableHead className="text-right">Latency</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Pages</TableHead>
                          <TableHead className="text-right">Figures</TableHead>
                          <TableHead className="text-right">Tables</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaries.docRows.flatMap((row) => [
                          ...row.docs.map((doc, i) => (
                            <TableRow key={`${row.model}-doc-${i}`}>
                              <TableCell className="font-medium whitespace-nowrap">
                                {i === 0 ? row.model : ""}
                              </TableCell>
                              <TableCell className="break-words">
                                {doc.name}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {doc.batch_number != null
                                  ? `#${doc.batch_number}`
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                {doc.duration.toFixed(2)}s
                              </TableCell>
                              <TableCell className="text-right">
                                ${doc.cost.toFixed(4)}
                              </TableCell>
                              <TableCell className="text-right">
                                {doc.page_count > 0 ? doc.page_count : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                {doc.figure_count > 0 ? doc.figure_count : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                {doc.table_count > 0 ? doc.table_count : "—"}
                              </TableCell>
                            </TableRow>
                          )),
                          ...(row.docs.length > 1
                            ? [
                                <TableRow
                                  key={`${row.model}-total`}
                                  className="border-t bg-muted/20"
                                >
                                  <TableCell />
                                  <TableCell className="text-muted-foreground text-xs">
                                    Total ({row.docs.length} docs)
                                  </TableCell>
                                  <TableCell />
                                  <TableCell className="text-right text-xs">
                                    {row.avgLatency.toFixed(2)}s avg
                                  </TableCell>
                                  <TableCell className="text-right text-xs">
                                    ${row.totalCost.toFixed(4)}
                                  </TableCell>
                                  <TableCell />
                                  <TableCell />
                                  <TableCell />
                                </TableRow>,
                              ]
                            : []),
                        ])}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
