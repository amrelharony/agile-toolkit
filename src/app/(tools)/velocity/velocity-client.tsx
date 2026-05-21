"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartCard } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { SmartInput } from "@/components/shared/smart-input";
import { CausalLine } from "@/components/charts/causal-annotation";
import { chartTheme } from "@/components/charts/chart-theme";
import { generateVelocityPrompts } from "@/lib/ai-prompts/velocity";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VELOCITY_ACTIONS } from "@/lib/history/event-actions";
import { withTimeTravel } from "@/lib/stores/with-time-travel";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface Sprint {
  id: string;
  name: string;
  description?: string;
  committed: number;
  completed: number;
}

interface VelocityStore {
  sprints: Sprint[];
  addSprint: () => void;
  removeSprint: (id: string) => void;
  updateSprint: (id: string, updates: Partial<Sprint>) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Default data                                                              */
/* -------------------------------------------------------------------------- */

// Deterministic default IDs so server-rendered HTML matches client-rendered
// HTML at hydration time. Calling `crypto.randomUUID()` at module load
// produced distinct values on server vs client and triggered React's
// hydration-mismatch warning on every fresh visit.
//
// User-added sprints still get proper UUIDs (see `createSprint`); these
// `default:` prefixed IDs only live until the user edits or resets, at
// which point they're either replaced piecewise or wholesale.
function buildDefaultSprints(): Sprint[] {
  return [
    { id: "default:sprint-1", name: "Sprint 1", committed: 34, completed: 28 },
    { id: "default:sprint-2", name: "Sprint 2", committed: 30, completed: 32 },
    { id: "default:sprint-3", name: "Sprint 3", committed: 36, completed: 35 },
  ];
}

function createSprint(existing: Sprint[]): Sprint {
  // Pick the first unused integer suffix so deleting "Sprint 2" then adding
  // a new one doesn't produce "Sprint 4" — the user expects gaps to fill.
  const used = new Set(
    existing
      .map((s) => parseInt(String(s.name).replace(/\D/g, ""), 10))
      .filter(Number.isFinite)
  );
  let n = 1;
  while (used.has(n)) n++;
  return {
    id: crypto.randomUUID(),
    name: `Sprint ${n}`,
    committed: 30,
    completed: 28,
  };
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useVelocityStore = create<VelocityStore>()(
  persist(
    withTimeTravel<VelocityStore>(
      { toolId: "velocity" },
      (set) => ({
        sprints: buildDefaultSprints(),

        addSprint: () =>
          set((s) => ({ sprints: [...s.sprints, createSprint(s.sprints)] })),

        removeSprint: (id) =>
          set((s) => ({ sprints: s.sprints.filter((sp) => sp.id !== id) })),

        updateSprint: (id, updates) =>
          set((s) => ({
            sprints: s.sprints.map((sp) =>
              sp.id === id ? { ...sp, ...updates } : sp
            ),
          })),

        // Re-build defaults on each reset so we mint fresh ids — never reuse
        // the originals, otherwise sprint identity would alias old data.
        reset: () => set({ sprints: buildDefaultSprints() }),
      })
    ),
    {
      name: "agile-toolkit:velocity",
      // Don't persist the time-travel stacks — they're in-memory only.
      partialize: (state) => {
        const { _ttPast, _ttFuture, ...rest } = state as VelocityStore & {
          _ttPast?: unknown;
          _ttFuture?: unknown;
        };
        void _ttPast;
        void _ttFuture;
        return rest;
      },
    }
  )
);

/* -------------------------------------------------------------------------- */
/*  Math helpers                                                              */
/* -------------------------------------------------------------------------- */

function rollingAverage(values: number[], window = 3): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function linearRegression(values: number[]): number[] {
  // Defensive filter — a single NaN would propagate through every reduction
  // and yield a NaN slope/intercept that taints the entire trend line.
  const valid = values.filter(Number.isFinite);
  const n = valid.length;
  if (n < 2) {
    const fallback = Number.isFinite(valid[0]) ? valid[0] : 0;
    return values.map(() => fallback);
  }
  const xs = valid.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = valid.reduce((a, b) => a + b, 0) / n;
  const ssXX = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const ssXY = xs.reduce((sum, x, i) => sum + (x - xMean) * (valid[i] - yMean), 0);
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = yMean - slope * xMean;
  // Project the regression back across every original index so the consumer
  // gets one trend value per input — even slots that held a non-finite value.
  return values.map((_, i) => Math.max(0, slope * i + intercept));
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round(v: number, d = 1) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

// StatCard moved to @/components/shared/stat-card — imported above.

/**
 * Numeric input that doesn't snap mid-edit. Holds a string draft so empty /
 * partial values stay editable; commits on blur. Guards against NaN and
 * clamps into [min, max]. Reverts to last good value on bad input.
 */
function NumCell({
  value,
  onCommit,
  min = 0,
  max,
  className,
  onCommitBlur,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  /** Optional hook fired alongside the commit, useful for history logging. */
  onCommitBlur?: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max ?? Infinity, n));
      onCommit(clamped);
      onCommitBlur?.(clamped);
    } else {
      setDraft(String(value));
    }
  };
  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={className}
    />
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1f36",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#e2e8f0",
};

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function VelocityClient() {
  const {
    sprints,
    addSprint: addSprintRaw,
    removeSprint: removeSprintRaw,
    updateSprint,
    reset: resetRaw,
  } = useVelocityStore();
  const { log } = useHistoryLogger("velocity");

  const addSprint = () => {
    addSprintRaw();
    const next = useVelocityStore.getState().sprints;
    const created = next[next.length - 1];
    log(VELOCITY_ACTIONS.SPRINT_ADDED, {
      sprintId: created.id,
      name: created.name,
    });
  };

  const removeSprint = (id: string) => {
    const sprint = sprints.find((s) => s.id === id);
    removeSprintRaw(id);
    log(VELOCITY_ACTIONS.SPRINT_REMOVED, {
      sprintId: id,
      name: sprint?.name,
    });
  };

  const reset = () => {
    resetRaw();
    log(VELOCITY_ACTIONS.VELOCITY_RESET, {});
  };

  const logSprintCommit = (
    id: string,
    field: "name" | "committed" | "completed",
    value: string | number
  ) => {
    log(VELOCITY_ACTIONS.SPRINT_UPDATED, { sprintId: id, field, value });
  };

  const exportRef = useRef<HTMLDivElement>(null);

  /* -- Smart-default for next sprint plan ---------------------------------- */
  // Reads from the workspace store's completed sprints (registered in
  // src/lib/predictions/bootstrap.ts). Falls back to confidence: "none" when
  // no completed sprints exist in the workspace — the SmartInput then renders
  // no chip and no ghost, so the manual flow is undisturbed.
  const nextSprintPrediction = usePredictedDefault<number>("velocity", "nextSprintPlan", 0);
  const [plannedNext, setPlannedNext] = useState<string>("");

  /* -- Derived chart data -------------------------------------------------- */

  const completedSeries = useMemo(() => sprints.map((s) => s.completed), [sprints]);

  // Bayesian forecast for the NEXT sprint. Wrapped in useMemo so we don't
  // re-allocate on unrelated re-renders. Returns [] when the series is empty,
  // which makes the Area renders as nothing — safe fallback.
  const forecast = useMemo(() => {
    if (completedSeries.length < 2) return [];
    return forecastBayesianHolt(completedSeries, 1);
  }, [completedSeries]);

  // CUSUM changepoints on completed velocity. cusum() itself returns []
  // when n<4 — we still memoise so downstream maps don't churn.
  const changepoints = useMemo(() => {
    if (completedSeries.length < 4) return [];
    return cusum(completedSeries);
  }, [completedSeries]);

  // Mann-Kendall trend test — needs n>=5 to be informative.
  const trendTest = useMemo(() => {
    if (completedSeries.length < 5) return null;
    return mannKendall(completedSeries);
  }, [completedSeries]);

  const { chartData, stats } = useMemo(() => {
    const completedValues = completedSeries;
    const rolling = rollingAverage(completedValues, 3);
    const trendLine = linearRegression(completedValues);

    type Row = {
      name: string;
      committed: number;
      completed: number | null;
      rollingAvg?: number;
      trend?: number;
      forecast?: number;
      band80Lower?: number;
      band80Upper?: number;
    };

    const data: Row[] = sprints.map((sp, i) => ({
      name: sp.name,
      committed: sp.committed,
      completed: sp.completed,
      rollingAvg: rolling[i] !== null ? round(rolling[i]!, 1) : undefined,
      trend: round(trendLine[i], 1),
    }));

    // Append a synthetic "next" row carrying the Bayesian forecast band so
    // Recharts has a single dataset to draw from. Lower-bound is clamped at 0
    // — negative velocity is meaningless for the chart axis.
    if (forecast.length > 0 && data.length > 0) {
      const fc = forecast[0];
      // Bridge the band onto the last actual point so the area starts where
      // history ends rather than floating in mid-air.
      const last = data[data.length - 1];
      data[data.length - 1] = {
        ...last,
        forecast: last.completed ?? undefined,
        // Set bridge band lower to 0 instead of collapsing to last.completed —
        // with `connectNulls` Recharts v2.x can render a stray fill triangle
        // from the second-to-last sprint anchor when both bounds collapse.
        band80Lower: 0,
        band80Upper: last.completed ?? undefined,
      };
      data.push({
        name: "Next",
        committed: 0,
        completed: null,
        forecast: round(fc.yHat, 1),
        band80Lower: round(Math.max(0, fc.lower80), 1),
        band80Upper: round(Math.max(0, fc.upper80), 1),
      });
    }

    const n = sprints.length;
    const avgVelocity = n > 0 ? completedValues.reduce((a, b) => a + b, 0) / n : 0;
    const predictable = sprints.filter((s) => s.completed >= s.committed).length;
    const predictability = n > 0 ? (predictable / n) * 100 : 0;
    const sd = stdDev(completedValues);

    // Trend direction: compare last 2 trend values, but the deadband is now
    // 5% of the average velocity rather than a fixed 0.5 pts. A 0.5 pt swing
    // is meaningful for a 6-pt team and trivial for a 60-pt team — relative
    // thresholds make the label honest at both scales.
    let trendDir: "up" | "down" | "stable" = "stable";
    if (trendLine.length >= 2) {
      const diff = trendLine[trendLine.length - 1] - trendLine[trendLine.length - 2];
      const deadband = avgVelocity > 0 ? avgVelocity * 0.05 : 0.5;
      if (Math.abs(diff) < deadband) trendDir = "stable";
      else if (diff > 0) trendDir = "up";
      else trendDir = "down";
    }

    return {
      chartData: data,
      stats: { avgVelocity, predictability, sd, trendDir },
    };
  }, [sprints, completedSeries, forecast]);

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(() => ({
    headers: ["Sprint", "Description", "Committed", "Completed"],
    rows: sprints.map((s) => [s.name, s.description ?? "", s.committed, s.completed]),
  }), [sprints]);

  const promptConfig = useMemo(() => ({
    toolName: "Velocity Tracker",
    prompts: generateVelocityPrompts({ sprints, stats }),
  }), [sprints, stats]);

  /* -- Trend icon ---------------------------------------------------------- */

  const TrendIcon =
    stats.trendDir === "up"
      ? TrendingUp
      : stats.trendDir === "down"
      ? TrendingDown
      : Minus;

  const trendColor =
    stats.trendDir === "up"
      ? chartTheme.colors.cyan
      : stats.trendDir === "down"
      ? chartTheme.colors.magenta
      : chartTheme.axisColor;

  /* -- Render -------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      toolId="velocity"
      title="Velocity Tracker"
      description="Track your team's sprint velocity with rolling averages and trend analysis."
      category="Metrics & Dashboards"
    >
      <div ref={exportRef} className="space-y-6">

        {/* ---- Stats Cards ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Average Velocity"
            value={round(stats.avgVelocity)}
            unit="pts"
            icon={Activity}
            iconColor={chartTheme.colors.cyan}
          />
          <StatCard
            label="Predictability"
            value={round(stats.predictability, 0)}
            unit="%"
            icon={Activity}
            iconColor={chartTheme.colors.green}
          />
          <StatCard
            label="Std Deviation"
            value={round(stats.sd)}
            unit="pts"
            icon={Activity}
            iconColor={chartTheme.colors.amber}
          />
          <StatCard
            label="Trend"
            value={stats.trendDir.charAt(0).toUpperCase() + stats.trendDir.slice(1)}
            icon={TrendIcon}
            iconColor={trendColor}
          />
        </div>

        {/* ---- Chart ---- */}
        <ChartCard
          title="Velocity Chart"
          icon={Activity}
          height={350}
          headerExtras={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="velocity-tracker"
                csvData={csvData}
                targetRef={exportRef}
              />
            </>
          }
        >
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend
              wrapperStyle={{ paddingTop: "16px", color: chartTheme.axisColor, fontSize: 12 }}
            />
            {/* Bayesian 80% band — drawn behind everything so bars stay legible.
                The lower-mask Area uses var(--bg) at fillOpacity 1 to clip the
                upper Area down to a true band rather than a solid wedge. */}
            <Area
              dataKey="band80Upper"
              name="80% forecast"
              stroke="none"
              fill={chartTheme.colors.cyan}
              fillOpacity={0.18}
              connectNulls
              isAnimationActive={false}
            />
            <Area
              dataKey="band80Lower"
              stroke="none"
              fill={chartTheme.background}
              fillOpacity={1}
              legendType="none"
              connectNulls
              isAnimationActive={false}
            />
            <Bar
              dataKey="committed"
              name="Committed"
              fill="rgba(0,240,255,0.3)"
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            />
            <Bar
              dataKey="completed"
              name="Completed"
              fill={chartTheme.colors.cyan}
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            />
            <Line
              dataKey="rollingAvg"
              name="Rolling Avg"
              stroke={chartTheme.colors.magenta}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              dataKey="trend"
              name="Trend"
              stroke={chartTheme.colors.amber}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
            <Line
              dataKey="forecast"
              name="Forecast"
              stroke={chartTheme.colors.cyan}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              connectNulls
            />
            {/* CUSUM regime-shift markers anchored to the affected sprint's
                name so they line up with bar centers. Skipped silently when
                no changepoints were detected. */}
            {changepoints.map((cp) => {
              const sprint = sprints[cp.index];
              if (!sprint) return null;
              return (
                <CausalLine
                  key={`cusum-${cp.index}-${cp.direction}`}
                  annotation={{
                    x: sprint.name,
                    label: `Regime shift ${cp.direction}`,
                    detail: `CUSUM detected a ${cp.direction === "up" ? "sustained increase" : "sustained drop"} in completed velocity at ${sprint.name}.`,
                    confidence: "moderate",
                  }}
                />
              );
            })}
          </ComposedChart>
        </ChartCard>

        {/* ---- Mann-Kendall trend chip ----
            Only renders when the test has enough samples (n>=5) AND the trend
            is statistically significant at α=0.05. Tone-coded so a
            significant-up shows as accent ("good"), significant-down as
            destructive ("alert worth investigating"). */}
        {trendTest?.significant && (
          <div className="flex items-center justify-end -mt-2">
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                trendTest.trend === "up"
                  ? "bg-accent/15 text-accent border-accent/40"
                  : "bg-destructive/15 text-destructive border-destructive/40"
              }`}
              title={`Mann-Kendall p=${trendTest.pValue.toFixed(3)}`}
            >
              <span>
                {trendTest.trend === "up" ? "↗" : "↘"} trend significant
              </span>
              <span className="opacity-60">p={trendTest.pValue.toFixed(2)}</span>
            </span>
          </div>
        )}

        {/* ---- Plan next sprint ----
            SmartInput-backed quick-plan panel. The predictor (registered in
            src/lib/predictions/bootstrap.ts) reads completed sprints from the
            workspace store; if none exist, the chip silently disappears and
            the input behaves as a normal number field. Accepting (Tab on
            empty, or click the chip) populates the field with the forecast. */}
        <SectionCard
          title="Plan next sprint"
          titleSize="lg"
          headerClassName="pb-4"
          actions={
            <Button
              size="sm"
              variant="toolkit"
              disabled={plannedNext.trim() === ""}
              onClick={() => {
                const n = Number(plannedNext);
                if (!Number.isFinite(n) || n < 0) return;
                addSprintRaw();
                const fresh = useVelocityStore.getState().sprints;
                const created = fresh[fresh.length - 1];
                useVelocityStore.getState().updateSprint(created.id, {
                  committed: Math.round(n),
                  completed: 0,
                });
                log(VELOCITY_ACTIONS.SPRINT_ADDED, {
                  sprintId: created.id,
                  name: created.name,
                  committed: Math.round(n),
                  source: "predicted-default",
                });
                setPlannedNext("");
              }}
              className="gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Commit
            </Button>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
            <div className="space-y-1">
              <SmartInput<number>
                predicted={nextSprintPrediction}
                onAccept={(v) => setPlannedNext(String(v))}
                render={({ ghost, accept, chip }) => (
                  <>
                    <Input
                      type="number"
                      min={0}
                      value={plannedNext}
                      placeholder={ghost ?? "Points to commit"}
                      onKeyDown={(e) => {
                        if (e.key === "Tab" && plannedNext === "") {
                          e.preventDefault();
                          accept();
                        }
                      }}
                      onChange={(e) => setPlannedNext(e.target.value)}
                      className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
                      aria-label="Planned commitment for the next sprint"
                    />
                    {chip}
                  </>
                )}
              />
            </div>
            <p className="text-xs text-sub max-w-xs">
              Tip: Tab to accept the suggested commitment, then Commit to add the sprint.
            </p>
          </div>
        </SectionCard>

        {/* ---- Data Table ---- */}
        <SectionCard
          title="Sprint Data"
          titleSize="lg"
          headerClassName="pb-4"
          contentClassName="space-y-3"
          actions={
            <>
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={reset}
              >
                Reset
              </Button>
              <Button
                size="sm"
                variant="toolkit"
                onClick={addSprint}
                className="gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add Sprint
              </Button>
            </>
          }
        >
          {/* Header row */}
          <div className="grid grid-cols-[1fr_0.6fr_0.6fr_auto] gap-3 px-1 pb-2 border-b border-border">
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Sprint Name</span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Committed</span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Completed</span>
            <span className="w-9" />
          </div>

          {sprints.map((sp) => (
            <div
              key={sp.id}
              className="grid grid-cols-[1fr_0.6fr_0.6fr_auto] gap-3 items-center"
            >
              {/* Single-line Input chosen over Textarea here — sprint rows are
                  in a tight 4-column data grid, so a multi-line description
                  would break the row height alignment. Empty trims to undefined. */}
              <div className="space-y-1">
                <Input
                  value={sp.name}
                  onChange={(e) => updateSprint(sp.id, { name: e.target.value })}
                  onBlur={(e) => logSprintCommit(sp.id, "name", e.target.value)}
                  className="input-toolkit focus:ring-accent/20"
                />
                <Input
                  value={sp.description ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateSprint(sp.id, {
                      description: v.trim() ? v : undefined,
                    });
                  }}
                  placeholder="Description (optional)..."
                  className="input-toolkit text-xs h-7"
                  aria-label={`Description for ${sp.name}`}
                />
              </div>
              <NumCell
                value={sp.committed}
                onCommit={(n) => updateSprint(sp.id, { committed: n })}
                onCommitBlur={(n) => logSprintCommit(sp.id, "committed", n)}
                min={0}
                className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
              />
              <NumCell
                value={sp.completed}
                onCommit={(n) => updateSprint(sp.id, { completed: n })}
                onCommitBlur={(n) => logSprintCommit(sp.id, "completed", n)}
                min={0}
                className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
              />
              <Button
                variant="danger-ghost"
                size="icon"
                disabled={sprints.length <= 1}
                onClick={() => removeSprint(sp.id)}
                className="h-9 w-9 disabled:opacity-30"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}

          {/* Predictability note */}
          <div className="mt-4 pt-4 border-t border-border flex items-center justify-between px-1">
            <span className="text-sm text-sub">
              Sprints meeting commitment:{" "}
              <span className="text-accent font-data font-semibold">
                {sprints.filter((s) => s.completed >= s.committed).length}
              </span>{" "}
              / {sprints.length}
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-data font-bold text-accent">
                {round(stats.predictability, 0)}%
              </span>
              <span className="text-sm text-sub">predictable</span>
            </div>
          </div>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
