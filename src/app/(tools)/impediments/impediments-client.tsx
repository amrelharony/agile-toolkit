"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateImpedimentPrompts } from "@/lib/ai-prompts/impediments";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Filter, X, TrendingUp } from "lucide-react";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { mannKendall } from "@/lib/analytics/trend-test";
import { cusum } from "@/lib/analytics/changepoint";
import { ChartCard } from "@/components/shared/chart-card";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import type { Category, Impediment, Severity, Status } from "./types";
import { useImpedimentStore } from "./use-impediment-store";
import {
  avgResolutionDays,
  buildWeeklyImpedimentSeries,
  daysSince,
  resolutionDaysSeries,
} from "./helpers";
import { LogForm } from "./components/log-form";
import { ImpedimentCard } from "./components/impediment-card";

// Recharts loads with the chart, not the page. ChartCard's fixed-height box
// holds the space while it loads.
const WeeklyRaisedChart = dynamic(() => import("./charts").then((m) => m.WeeklyRaisedChart), {
  ssr: false,
});

export function ImpedimentsClient() {
  const { impediments, reset } = useImpedimentStore();

  // R10-deferred: dual-store bridge. Impediments tool was an island —
  // raising one never fired `impediment.raised` (signal-bridge watches
  // workspace.impediments, and nothing was writing there). After this
  // bridge, signal-bus consumers (insights-engine, anti-pattern
  // detector, dashboards) all wake up on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sevMap: Record<Severity, "low" | "medium" | "high" | "critical"> = {
      Low: "low",
      Medium: "medium",
      High: "high",
      Critical: "critical",
    };
    // BUG-T4-impediments-2: hoist ownedIds onto window so it survives
    // React 18 StrictMode's double-mount (and HMR remounts), instead
    // of being recreated as an empty Set on every effect run. Without
    // this, the second StrictMode mount re-claims ownership of every
    // current id, then a subsequent local delete cascades through
    // workspace.removeImpediment — which removes any canvas object
    // pinned to that impediment id via the workspace store's cascade.
    type WindowWithBridge = Window & { __impedimentBridgeOwnedIds?: Set<string> };
    const w = window as WindowWithBridge;
    if (!w.__impedimentBridgeOwnedIds) {
      w.__impedimentBridgeOwnedIds = new Set<string>();
    }
    const ownedIds = w.__impedimentBridgeOwnedIds;
    const sync = (snapshot: Impediment[]) => {
      const workspace = useWorkspaceStore.getState();
      const wsItems = workspace.impediments ?? [];
      const wsById = new Map(wsItems.map((i) => [i.id, i]));
      const localById = new Map(snapshot.map((i) => [i.id, i]));
      for (const local of snapshot) {
        const existing = wsById.get(local.id);
        const next = {
          id: local.id,
          title: local.title,
          severity: sevMap[local.severity],
          raisedAt: local.raisedDate,
          resolvedAt: local.resolvedDate,
          owner: local.assignedTo || undefined,
          source: "manual" as const,
        };
        ownedIds.add(local.id);
        if (
          existing &&
          existing.title === next.title &&
          existing.severity === next.severity &&
          existing.raisedAt === next.raisedAt &&
          existing.resolvedAt === next.resolvedAt &&
          existing.owner === next.owner
        )
          continue;
        workspace.upsertImpediment(next);
      }
      // Remove workspace rows we previously owned but the user deleted.
      // Closure-scoped Set ensures we never trample rows that came from
      // other tools / imports.
      for (const ws of wsItems) {
        if (!localById.has(ws.id) && ownedIds.has(ws.id)) {
          ownedIds.delete(ws.id);
          workspace.removeImpediment(ws.id);
        }
      }
    };
    sync(impediments);
    const unsub = useImpedimentStore.subscribe((state) => sync(state.impediments));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filters
  const [filterStatus, setFilterStatus] = useState<Status | "All">("All");
  const [filterCategory, setFilterCategory] = useState<Category | "All">("All");
  const [filterSeverity, setFilterSeverity] = useState<Severity | "All">("All");

  // Dashboard stats
  const stats = useMemo(() => {
    const open = impediments.filter((i) => i.status === "Open").length;
    const escalated = impediments.filter((i) => i.status === "Escalated").length;
    const avgDays = avgResolutionDays(impediments);

    const byCategory = (["Technical", "Organizational", "External", "Process"] as Category[]).map(
      (cat) => ({
        label: cat,
        count: impediments.filter((i) => i.category === cat && i.status !== "Resolved").length,
      })
    );

    return { open, escalated, avgDays, byCategory };
  }, [impediments]);

  // ── Phase-15 analytics ────────────────────────────────────────────
  const resolutionDays = useMemo(() => resolutionDaysSeries(impediments), [impediments]);

  // Bootstrap CI on the median resolution time. Empty/short series fall back
  // to a degenerate CI (lower=upper=point) which we render as a non-CI value.
  const medianResolutionCI = useMemo(() => {
    if (resolutionDays.length < 3) return null;
    return bootstrapQuantile(resolutionDays, 0.5);
  }, [resolutionDays]);

  const { raisedPerWeek, openAtWeek } = useMemo(
    () => buildWeeklyImpedimentSeries(impediments),
    [impediments]
  );

  // Mann-Kendall trend test on weekly raised count.
  const raisedTrend = useMemo(() => {
    if (raisedPerWeek.length < 5) return null;
    return mannKendall(raisedPerWeek);
  }, [raisedPerWeek]);

  // CUSUM on the weekly open-impediment count for regime shifts.
  const openChangepoints = useMemo(() => {
    if (openAtWeek.length < 4) return [];
    return cusum(openAtWeek);
  }, [openAtWeek]);

  // Weekly chart data for the trend chart (last 26 weeks). Labels are
  // simple "W{n}" so the x-axis is monotonically ordered and CUSUM
  // markers anchor to the right week.
  const weeklyChartData = useMemo(
    () =>
      raisedPerWeek.map((count, i) => ({
        week: `W${i + 1}`,
        raised: count,
      })),
    [raisedPerWeek]
  );

  // CUSUM markers on raised-per-week, anchored to the chart's week labels
  // and filtered to only those whose x falls within the chart x-domain.
  const raisedChangepoints = useMemo<CausalAnnotationData[]>(() => {
    if (raisedPerWeek.length < 4) return [];
    const xValuesInChart = new Set(weeklyChartData.map((d) => d.week));
    return cusum(raisedPerWeek)
      .map((cp) => ({
        x: weeklyChartData[cp.index]?.week ?? `W${cp.index + 1}`,
        label: `Raised ${cp.direction === "up" ? "↑ regime" : "↓ regime"}`,
        detail: `CUSUM detected a sustained ${cp.direction === "up" ? "increase" : "drop"} in weekly impediments raised at week ${cp.index + 1}.`,
        confidence: cp.cumulativeStat >= 6 ? ("strong" as const) : ("moderate" as const),
      }))
      .filter((a) => xValuesInChart.has(a.x as string));
  }, [raisedPerWeek, weeklyChartData]);

  // Filtered list
  const filtered = useMemo(
    () =>
      impediments.filter((i) => {
        if (filterStatus !== "All" && i.status !== filterStatus) return false;
        if (filterCategory !== "All" && i.category !== filterCategory) return false;
        if (filterSeverity !== "All" && i.severity !== filterSeverity) return false;
        return true;
      }),
    [impediments, filterStatus, filterCategory, filterSeverity]
  );

  // Sort: Critical first, then by age desc
  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
        const statusOrder = { Open: 0, Escalated: 1, Resolved: 2 };
        if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status];
        if (a.severity !== b.severity) return severityOrder[a.severity] - severityOrder[b.severity];
        return daysSince(b.raisedDate) - daysSince(a.raisedDate);
      }),
    [filtered]
  );

  // Export data
  const csvData = useMemo(
    () => ({
      headers: [
        "Title",
        "Description",
        "Category",
        "Severity",
        "Status",
        "Raised By",
        "Assigned To",
        "Raised Date",
        "Resolved Date",
        "Age (days)",
        "Expected Resolution (days)",
      ],
      rows: impediments.map((i) => [
        i.title,
        i.description ?? "",
        i.category,
        i.severity,
        i.status,
        i.raisedBy,
        i.assignedTo,
        i.raisedDate,
        i.resolvedDate || "",
        daysSince(i.raisedDate),
        i.expectedResolutionDays ?? "",
      ]),
    }),
    [impediments]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Impediment Tracker",
      prompts: generateImpedimentPrompts({ impediments }),
    }),
    [impediments]
  );

  const hasActiveFilters =
    filterStatus !== "All" || filterCategory !== "All" || filterSeverity !== "All";

  return (
    <ToolPageWrapper
      toolId="impediments"
      title="Impediment Tracker"
      description="Log, escalate, and resolve team impediments. Monitor age, severity, and resolution metrics."
      category="Team Health & Maturity"
    >
      <div className="space-y-6">
        {/* Dashboard Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <p className="text-xs text-sub mb-1">Total Open</p>
              <p className="text-fluid-h2 font-data font-bold text-accent">{stats.open}</p>
            </CardContent>
          </Card>
          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <p className="text-xs text-sub mb-1">Escalated</p>
              <p className="text-fluid-h2 font-data font-bold text-accent-amber">
                {stats.escalated}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <p className="text-xs text-sub mb-1">
                {medianResolutionCI ? "Median Resolution" : "Avg Resolution"}
              </p>
              {medianResolutionCI ? (
                <>
                  <p className="text-fluid-h2 font-data font-bold text-accent-green">
                    {Math.round(medianResolutionCI.point)}
                    <span className="text-sm font-normal text-sub ml-1">days</span>
                  </p>
                  <p className="text-xs text-sub mt-1 font-data">
                    95% CI [{Math.round(medianResolutionCI.lower)},{" "}
                    {Math.round(medianResolutionCI.upper)}]
                  </p>
                </>
              ) : (
                <p className="text-fluid-h2 font-data font-bold text-accent-green">
                  {stats.avgDays}
                  <span className="text-sm font-normal text-sub ml-1">days</span>
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <p className="text-xs text-sub mb-2">Open by Category</p>
              <div className="space-y-1">
                {stats.byCategory
                  .filter((c) => c.count > 0)
                  .map((c) => (
                    <div key={c.label} className="flex items-center justify-between text-xs">
                      <span className="text-sub truncate">{c.label}</span>
                      <span className="text-text font-data font-semibold ml-2">{c.count}</span>
                    </div>
                  ))}
                {stats.byCategory.every((c) => c.count === 0) && (
                  <p className="text-xs text-sub">None open</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Phase-15 trend + changepoint signals */}
        {(raisedTrend || openChangepoints.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {raisedTrend &&
              (raisedTrend.significant ? (
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md border ${
                    raisedTrend.trend === "up"
                      ? "border-danger/40 text-danger bg-danger/10"
                      : "border-accent-green/40 text-accent-green bg-accent-green/10"
                  }`}
                >
                  <TrendingUp
                    className={`w-3 h-3 ${raisedTrend.trend === "down" ? "rotate-180" : ""}`}
                  />
                  Impediment creation trending {raisedTrend.trend} significantly
                  <span className="opacity-60">· p={raisedTrend.pValue.toFixed(3)}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-border text-sub bg-surface-deep">
                  <TrendingUp className="w-3 h-3" />
                  Impediment creation trend: no significant change
                </span>
              ))}
            {openChangepoints.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-accent-amber/40 text-accent-amber bg-accent-amber/10">
                <AlertTriangle className="w-3 h-3" />
                {openChangepoints.length} regime shift{openChangepoints.length !== 1 ? "s" : ""}{" "}
                detected (CUSUM)
              </span>
            )}
          </div>
        )}

        {/* Weekly raised-per-week trend with CUSUM regime-shift markers. */}
        {weeklyChartData.length >= 4 && (
          <ChartCard title="Weekly raised" icon={TrendingUp} height={200}>
            <WeeklyRaisedChart data={weeklyChartData} changepoints={raisedChangepoints} />
          </ChartCard>
        )}

        {/* Actions + filters row */}
        <div className="flex flex-wrap items-center gap-3">
          <LogForm />

          <div className="flex-1" />

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-sub" aria-hidden="true" />

            <Select
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v as Status | "All")}
            >
              <SelectTrigger
                aria-label="Filter by status"
                className="h-8 text-xs bg-surface border-border text-text w-28"
              >
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                <SelectItem value="All">All Status</SelectItem>
                <SelectItem value="Open">Open</SelectItem>
                <SelectItem value="Escalated">Escalated</SelectItem>
                <SelectItem value="Resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filterCategory}
              onValueChange={(v) => setFilterCategory(v as Category | "All")}
            >
              <SelectTrigger
                aria-label="Filter by category"
                className="h-8 text-xs bg-surface border-border text-text w-36"
              >
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                <SelectItem value="All">All Categories</SelectItem>
                {(["Technical", "Organizational", "External", "Process"] as Category[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filterSeverity}
              onValueChange={(v) => setFilterSeverity(v as Severity | "All")}
            >
              <SelectTrigger
                aria-label="Filter by severity"
                className="h-8 text-xs bg-surface border-border text-text w-32"
              >
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                <SelectItem value="All">All Severity</SelectItem>
                {(["Low", "Medium", "High", "Critical"] as Severity[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterStatus("All");
                  setFilterCategory("All");
                  setFilterSeverity("All");
                }}
                className="h-8 text-xs text-sub hover:text-text hover:bg-cardH gap-1"
              >
                <X className="w-3 h-3" />
                Clear
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <AiPromptGenerator config={promptConfig} />
            {impediments.length > 0 && (
              <ExportButton filename="impediments" csvData={csvData} jsonData={impediments} />
            )}
            {impediments.length > 0 && (
              <Button variant="danger-ghost" size="sm" onClick={reset}>
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Impediment list */}
        <div className="space-y-3">
          {sorted.length === 0 ? (
            <Card className="bg-surface border-border">
              <CardContent className="py-12 text-center">
                <AlertTriangle className="w-8 h-8 text-sub mx-auto mb-3 opacity-40" />
                <p className="text-sub text-sm">
                  {impediments.length === 0
                    ? 'No impediments logged. Click "Log Impediment" to add one.'
                    : "No impediments match the current filters."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-sub px-1">
                <span>
                  Showing {sorted.length} of {impediments.length} impediment
                  {impediments.length !== 1 ? "s" : ""}
                </span>
                <span>Sorted by severity and age</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {sorted.map((imp) => (
                  <ImpedimentCard key={imp.id} impediment={imp} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
