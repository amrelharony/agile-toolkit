"use client";

import { useRef, useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { SmartInput } from "@/components/shared/smart-input";
import { type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { generateCycleTimePrompts } from "@/lib/ai-prompts/cycle-time";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CYCLE_TIME_ACTIONS } from "@/lib/history/event-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Clock, BarChart3, Target } from "lucide-react";
import { calcCycleTime, percentile, stdDev, round, BUCKETS, PERCENTILE_KEYS } from "./helpers";
import { useCycleTimeStore } from "./use-cycle-time-store";
import { StatCard } from "./components/stat-card";
import { HistogramTab } from "./components/histogram-tab";
import { ScatterTab } from "./components/scatter-tab";
import { WorkItemsTable } from "./components/work-items-table";

export function CycleTimeClient() {
  const {
    items,
    addItem: addItemRaw,
    removeItem: removeItemRaw,
    updateItem,
    reset: resetRaw,
  } = useCycleTimeStore();
  const { log } = useHistoryLogger("cycle-time");

  const addItem: typeof addItemRaw = (...args) => {
    addItemRaw(...args);
    log(CYCLE_TIME_ACTIONS.ITEM_ADDED, {});
  };
  const removeItem: typeof removeItemRaw = (id) => {
    removeItemRaw(id);
    log(CYCLE_TIME_ACTIONS.ITEM_REMOVED, { itemId: id });
  };
  const reset = () => {
    resetRaw();
    log(CYCLE_TIME_ACTIONS.CYCLE_TIME_RESET, {});
  };
  const exportRef = useRef<HTMLDivElement>(null);
  const [targetPct, setTargetPct] = useState(85);

  /* -- Computed cycle times ------------------------------------------------ */
  const itemsWithCT = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        cycleTime: calcCycleTime(item.startDate, item.endDate),
      })),
    [items]
  );

  const validCycleTimes = useMemo(
    () =>
      itemsWithCT
        .filter((i): i is typeof i & { cycleTime: number } => i.cycleTime !== null)
        .map((i) => i.cycleTime),
    [itemsWithCT]
  );

  const sortedCT = useMemo(() => [...validCycleTimes].sort((a, b) => a - b), [validCycleTimes]);

  /* -- Stats --------------------------------------------------------------- */
  const stats = useMemo(() => {
    if (sortedCT.length === 0) {
      return { avg: 0, median: 0, p85: 0, stddev: 0 };
    }
    const avg = round(validCycleTimes.reduce((a, b) => a + b, 0) / validCycleTimes.length);
    const median = percentile(sortedCT, 50);
    const p85 = percentile(sortedCT, 85);
    const sd = round(stdDev(validCycleTimes));
    return { avg, median, p85, stddev: sd };
  }, [sortedCT, validCycleTimes]);

  /* -- Percentile map ------------------------------------------------------ */
  const percentileMap = useMemo(
    () =>
      Object.fromEntries(PERCENTILE_KEYS.map((p) => [p, percentile(sortedCT, p)])) as Record<
        (typeof PERCENTILE_KEYS)[number],
        number
      >,
    [sortedCT]
  );

  /* -- SLE calculation ----------------------------------------------------- */
  const sleValue = useMemo(
    () => (sortedCT.length > 0 ? percentile(sortedCT, targetPct) : 0),
    [sortedCT, targetPct]
  );

  /* -- Phase-15 analytics -------------------------------------------------- */
  // Bootstrap CIs for P50 / P85. The primitive shrinks to a point CI when
  // n<3, which keeps the UI honest. Use 1000 iterations (deterministic seed
  // inside the primitive) so the bracket is stable across renders.
  const p50CI = useMemo(
    () => (validCycleTimes.length >= 3 ? bootstrapQuantile(validCycleTimes, 0.5) : null),
    [validCycleTimes]
  );
  const p85CI = useMemo(
    () => (validCycleTimes.length >= 3 ? bootstrapQuantile(validCycleTimes, 0.85) : null),
    [validCycleTimes]
  );

  // Per-item CUSUM markers (rendered on the scatter plot). Operates on the
  // scatter's natural ordering — the existing component sorts by insertion
  // order, so a regime shift here means the team's per-item cycle time
  // changed character mid-stream.
  const scatterCusumAnnotations = useMemo<CausalAnnotationData[]>(() => {
    if (validCycleTimes.length < 4) return [];
    return cusum(validCycleTimes).map((cp) => ({
      x: cp.index + 1,
      label: cp.direction === "up" ? "Cycle-time regime up" : "Cycle-time regime down",
      detail: `CUSUM detected a sustained ${cp.direction === "up" ? "increase" : "decrease"} starting at item #${cp.index + 1}.`,
      confidence: cp.cumulativeStat >= 6 ? "strong" : "moderate",
    }));
  }, [validCycleTimes]);

  // Per-week mean cycle time for the trend chip. Bucket by ISO week of the
  // item's endDate so a single week with N items contributes one mean.
  const weeklyCycleMean = useMemo(() => {
    const buckets = new Map<string, number[]>();
    for (const i of itemsWithCT) {
      if (i.cycleTime === null || !i.endDate) continue;
      // R11-fix: parse YYYY-MM-DD strings as UTC (Date constructor's
      // default for date-only ISO) AND use UTC accessors throughout.
      // The previous code mixed `d.getFullYear/getMonth/getDate` (LOCAL)
      // with `Date.UTC(...)` (UTC), so a user in negative-UTC zones
      // logging an endDate near Dec 31 produced a week bucket that
      // straddled the year boundary (off-by-52-weeks).
      // Parsing with the explicit "T00:00:00Z" suffix forces UTC even
      // if a future schema change drops the date-only format.
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(i.endDate) ? `${i.endDate}T00:00:00Z` : i.endDate;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      // ISO week key (matches kanban's pattern). Now fully UTC.
      const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      const key = `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
      const arr = buckets.get(key) ?? [];
      arr.push(i.cycleTime);
      buckets.set(key, arr);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, vals]) => vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [itemsWithCT]);

  const weeklyTrend = useMemo(
    () => (weeklyCycleMean.length >= 5 ? mannKendall(weeklyCycleMean) : null),
    [weeklyCycleMean]
  );

  // Smart-default predictor for the SLE target days. Note the existing
  // predictor reads from workspace.stories rather than this tool's local
  // store, so chip confidence will typically be "none" until the workspace
  // tracks story timestamps — wiring is forward-compatible.
  const sleDaysPrediction = usePredictedDefault<number>(
    "cycle-time",
    "sleTargetDays",
    Math.max(1, Math.round(stats.p85 || 5))
  );
  const [sleDaysBuffer, setSleDaysBuffer] = useState<string | null>(null);
  // The tool already exposes targetPct; we add a parallel "target days" SLE
  // input that mirrors the percentile/value pair from the predictor.
  const [sleTargetDays, setSleTargetDays] = useState<number | null>(null);

  /* -- Histogram data ------------------------------------------------------ */
  const histogramData = useMemo(
    () =>
      BUCKETS.map((b) => ({
        bucket: b.label,
        count: validCycleTimes.filter((ct) => ct >= b.min && ct <= b.max).length,
      })),
    [validCycleTimes]
  );

  /* -- Scatter data -------------------------------------------------------- */
  const scatterData = useMemo(
    () =>
      itemsWithCT
        .filter((i): i is typeof i & { cycleTime: number } => i.cycleTime !== null)
        .map((item, idx) => ({
          idx: idx + 1,
          cycleTime: item.cycleTime,
          name: item.name,
        })),
    [itemsWithCT]
  );

  /* -- Export data --------------------------------------------------------- */
  const csvData = useMemo(
    () => ({
      headers: ["Item Name", "Description", "Start Date", "End Date", "Cycle Time (days)"],
      rows: itemsWithCT.map((i) => [
        i.name || "(unnamed)",
        i.description ?? "",
        i.startDate,
        i.endDate,
        i.cycleTime ?? "N/A",
      ]),
    }),
    [itemsWithCT]
  );

  const jsonData = useMemo(
    () => ({
      items: itemsWithCT.map((i) => ({
        name: i.name || "(unnamed)",
        description: i.description ?? "",
        startDate: i.startDate,
        endDate: i.endDate,
        cycleTime: i.cycleTime,
      })),
      stats,
      percentiles: percentileMap,
    }),
    [itemsWithCT, stats, percentileMap]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Cycle Time Tracker",
      prompts: generateCycleTimePrompts({
        items: itemsWithCT
          .filter((i): i is typeof i & { cycleTime: number } => i.cycleTime !== null)
          .map((i) => ({
            name: i.name,
            startDate: i.startDate,
            endDate: i.endDate,
            cycleTimeDays: i.cycleTime,
            description: i.description,
          })),
        stats: {
          mean: stats.avg,
          median: stats.median,
          p85: stats.p85,
          p95: percentileMap[95],
          stdDev: stats.stddev,
        },
      }),
    }),
    [itemsWithCT, stats, percentileMap]
  );

  /* -- Render -------------------------------------------------------------- */
  return (
    <ToolPageWrapper
      toolId="cycle-time"
      title="Cycle Time Analyzer"
      description="Analyze how long work items take to complete. Use histogram, scatter plot, and percentile data to set realistic Service Level Expectations."
      category="Metrics & Dashboards"
    >
      <div ref={exportRef} className="space-y-6">
        {/* ---- Stats ---- */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Average"
            value={stats.avg}
            unit="days"
            accent
            trailing={
              weeklyTrend?.significant ? (
                <span
                  className={`text-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    // For cycle time, "down" trend is good (faster), "up" is bad.
                    weeklyTrend.trend === "down"
                      ? "border-accent-green/40 text-accent-green bg-accent-green/10"
                      : "border-warning/40 text-warning bg-warning/10"
                  }`}
                  title={`Mann-Kendall p=${weeklyTrend.pValue.toFixed(3)}`}
                >
                  <span aria-hidden="true">
                    {weeklyTrend.trend === "up" ? "↗ trend" : "↘ trend"}
                  </span>
                  <span className="sr-only">{`Weekly cycle-time trend ${weeklyTrend.trend} (Mann-Kendall p=${weeklyTrend.pValue.toFixed(3)})`}</span>
                </span>
              ) : undefined
            }
          />
          <StatCard
            label="Median (50th %ile)"
            value={stats.median}
            unit="days"
            footer={
              p50CI && p50CI.iterations > 0
                ? `95% CI [${p50CI.lower.toFixed(1)}, ${p50CI.upper.toFixed(1)}]`
                : undefined
            }
          />
          <StatCard
            label="85th Percentile"
            value={stats.p85}
            unit="days"
            accent
            footer={
              p85CI && p85CI.iterations > 0
                ? `95% CI [${p85CI.lower.toFixed(1)}, ${p85CI.upper.toFixed(1)}]`
                : undefined
            }
          />
          <StatCard label="Std Deviation" value={stats.stddev} unit="days" />
        </div>

        {/* ---- Charts Tabs ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <Clock className="w-5 h-5 text-accent" />
                Analysis
              </CardTitle>
              <div className="flex items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="cycle-time"
                  csvData={csvData}
                  jsonData={jsonData}
                  targetRef={exportRef}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {validCycleTimes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-sub gap-3">
                <BarChart3 className="w-12 h-12 opacity-20" />
                <p className="text-sm">Add items with start and end dates to see analysis</p>
              </div>
            ) : (
              <Tabs defaultValue="histogram">
                <TabsList className="bg-surface-deep border border-border mb-6">
                  <TabsTrigger
                    value="histogram"
                    className="gap-2 data-[state=active]:bg-accent/10 data-[state=active]:text-accent"
                  >
                    <BarChart3 className="w-4 h-4" />
                    Histogram
                  </TabsTrigger>
                  <TabsTrigger
                    value="scatter"
                    className="gap-2 data-[state=active]:bg-accent/10 data-[state=active]:text-accent"
                  >
                    <Target className="w-4 h-4" />
                    Scatter Plot
                  </TabsTrigger>
                  <TabsTrigger
                    value="sle"
                    className="gap-2 data-[state=active]:bg-accent/10 data-[state=active]:text-accent"
                  >
                    <Clock className="w-4 h-4" />
                    SLE
                  </TabsTrigger>
                </TabsList>

                {/* Tab 1: Histogram */}
                <TabsContent value="histogram">
                  <HistogramTab
                    histogramData={histogramData}
                    stats={stats}
                    percentileMap={percentileMap}
                  />
                </TabsContent>

                {/* Tab 2: Scatter Plot */}
                <TabsContent value="scatter">
                  <ScatterTab
                    scatterData={scatterData}
                    stats={stats}
                    percentileMap={percentileMap}
                    cusumAnnotations={scatterCusumAnnotations}
                  />
                </TabsContent>

                {/* Tab 3: SLE */}
                <TabsContent value="sle">
                  <div className="space-y-6">
                    {/* SLE Statement */}
                    <div className="rounded-xl bg-accent/5 border border-accent/20 p-5 text-center">
                      <p className="text-sub text-sm mb-1">Service Level Expectation</p>
                      <p className="text-2xl font-display font-bold text-text">
                        <span className="text-accent">{targetPct}%</span> of items complete within{" "}
                        <span className="text-accent-green">{sleValue} days</span>
                      </p>
                    </div>

                    {/* Target % Input */}
                    <div className="flex items-end gap-3 max-w-xs">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="ct-target-pct" className="text-sub text-xs">
                          Target Percentile (%)
                        </Label>
                        <Input
                          id="ct-target-pct"
                          type="number"
                          min={1}
                          max={99}
                          value={targetPct}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n)) {
                              setTargetPct(Math.min(99, Math.max(1, n)));
                            }
                          }}
                          className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
                        />
                      </div>
                      <p className="text-xs text-sub pb-2.5">= {sleValue} days</p>
                    </div>

                    {/* Target Days Input — SmartInput-backed. The predictor
                        suggests P85 of historical cycle times (or workspace
                        story signal when present). Tab on an empty field
                        accepts the suggestion. The input commits to a
                        local target, separate from the percentile. */}
                    <div className="flex items-end gap-3 max-w-xs">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="ct-sle-days" className="text-sub text-xs">
                          SLE Target (days)
                        </Label>
                        <SmartInput<number>
                          predicted={sleDaysPrediction}
                          onAccept={(v) => {
                            setSleTargetDays(v);
                            setSleDaysBuffer(null);
                          }}
                          render={({ ghost, chip, accept }) => (
                            <>
                              <Input
                                id="ct-sle-days"
                                type="number"
                                min={1}
                                value={
                                  sleDaysBuffer !== null
                                    ? sleDaysBuffer
                                    : sleTargetDays !== null
                                      ? String(sleTargetDays)
                                      : ""
                                }
                                placeholder={ghost ?? "e.g. 5"}
                                onKeyDown={(e) => {
                                  const empty =
                                    (sleDaysBuffer ?? "") === "" && sleTargetDays === null;
                                  if (e.key === "Tab" && empty) {
                                    e.preventDefault();
                                    accept();
                                  }
                                }}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setSleDaysBuffer(raw);
                                  if (raw === "") {
                                    setSleTargetDays(null);
                                    return;
                                  }
                                  const n = Number(raw);
                                  if (Number.isFinite(n) && n > 0) setSleTargetDays(n);
                                }}
                                onBlur={() => setSleDaysBuffer(null)}
                                className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
                              />
                              {chip}
                            </>
                          )}
                        />
                      </div>
                    </div>

                    {/* Percentile Table */}
                    <div>
                      <p className="text-sm font-medium text-sub mb-3">All Percentile Thresholds</p>
                      <div className="overflow-hidden rounded-lg border border-border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-surface-deep">
                              <th className="text-left py-2.5 px-4 text-xs text-sub font-medium uppercase tracking-wider">
                                Percentile
                              </th>
                              <th className="text-right py-2.5 px-4 text-xs text-sub font-medium uppercase tracking-wider">
                                Cycle Time
                              </th>
                              <th className="text-left py-2.5 px-4 text-xs text-sub font-medium uppercase tracking-wider">
                                Interpretation
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {PERCENTILE_KEYS.map((p, i) => {
                              const val = percentileMap[p];
                              const isTarget = p === targetPct;
                              return (
                                <tr
                                  key={p}
                                  className={`border-b border-border ${isTarget ? "bg-accent/5" : i % 2 === 0 ? "bg-transparent" : "bg-card-hover"}`}
                                >
                                  <td className="py-2.5 px-4 text-text font-data">
                                    {p}th
                                    {isTarget && (
                                      <Badge className="ml-2 text-xs bg-accent/10 text-accent border-accent/20">
                                        target
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-4 text-right">
                                    <span
                                      className={`font-data font-bold ${
                                        p <= 50
                                          ? "text-accent"
                                          : p <= 85
                                            ? "text-warning"
                                            : "text-danger"
                                      }`}
                                    >
                                      {val} days
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-sub text-xs">
                                    {p === 50 && "Half of items finish within this time"}
                                    {p === 75 && "Most items finish within this time"}
                                    {p === 85 && "Recommended SLE target"}
                                    {p === 90 && "High-confidence commitment"}
                                    {p === 95 && "Very high confidence, near worst-case"}
                                    {p === 99 && "Near-maximum observed time"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>

        {/* ---- Data Input Table ---- */}
        <WorkItemsTable
          items={itemsWithCT}
          totalCount={items.length}
          validCount={validCycleTimes.length}
          onUpdate={updateItem}
          onRemove={removeItem}
          onAdd={addItem}
          onReset={reset}
        />
      </div>
    </ToolPageWrapper>
  );
}
