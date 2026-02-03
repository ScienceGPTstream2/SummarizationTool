import { useEffect, useMemo, useState } from "react";
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
  }>;
}

export function SessionMetrics() {
  const [metrics, setMetrics] = useState<SessionMetricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const summaries = useMemo(() => {
    const calls = metrics?.calls ?? [];
    const providerStats = new Map<
      string,
      { calls: number; totalCost: number; totalLatency: number }
    >();
    const modelStats = new Map<
      string,
      { provider: string; calls: number; totalCost: number; totalLatency: number }
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

    const modelRows = Array.from(modelStats.entries()).map(([model, stats]) => ({
      model,
      provider: stats.provider,
      calls: stats.calls,
      totalCost: stats.totalCost,
      avgLatency: stats.calls ? stats.totalLatency / stats.calls : 0,
    }));

    providerRows.sort((a, b) => b.totalCost - a.totalCost);
    modelRows.sort((a, b) => b.totalCost - a.totalCost);

    return { providerRows, modelRows };
  }, [metrics]);

  useEffect(() => {
    let mounted = true;

    const fetchMetrics = async () => {
      setLoading(true);
      try {
        const response = await authenticatedFetch("/api/server/session-metrics");
        const data = await response.json();
        if (!mounted) return;
        setMetrics(data.metrics || null);
      } catch (error) {
        console.warn("Failed to fetch session metrics:", error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchMetrics();
    // Poll less frequently (was 8s) to reduce backend load
    const interval = setInterval(fetchMetrics, 20000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleClear = async () => {
    setClearing(true);
    try {
      await authenticatedFetch("/api/server/session-metrics", { method: "DELETE" });
      setMetrics({ total_cost: 0, total_latency: 0, total_calls: 0, calls: [] });
    } catch (error) {
      console.warn("Failed to clear session metrics:", error);
    } finally {
      setClearing(false);
    }
  };

  if (!metrics && !loading) {
    return null;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Card className="px-4 py-2 bg-muted/30 border border-border cursor-pointer hover:bg-muted/50 transition-colors">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="secondary">Session Metrics</Badge>
            <span className="text-muted-foreground">
              Cost: <strong>${metrics?.total_cost.toFixed(4) ?? "0.0000"}</strong>
            </span>
            <span className="text-muted-foreground">
              Latency: <strong>{metrics?.total_latency.toFixed(2) ?? "0.00"}s</strong>
            </span>
            <span className="text-muted-foreground">
              Calls: <strong>{metrics?.total_calls ?? 0}</strong>
            </span>
            <span className="text-xs text-muted-foreground">
              Click for details
            </span>
          </div>
        </Card>
      </DialogTrigger>
      <DialogContent className="w-[99vw] max-w-7xl min-w-[900px] max-h-[85vh] overflow-hidden">
        <DialogHeader className="shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-12">
            <DialogTitle>Session Metrics Breakdown</DialogTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={clearing}
            >
              {clearing ? "Clearing..." : "Clear metrics"}
            </Button>
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
                        <TableHead className="text-right">Avg Latency</TableHead>
                        <TableHead className="text-right">Total Cost</TableHead>
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
                        <TableHead className="text-right">Avg Latency</TableHead>
                        <TableHead className="text-right">Total Cost</TableHead>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}