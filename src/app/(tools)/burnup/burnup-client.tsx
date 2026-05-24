"use client";

import { useRef, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import {
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { ChartCard } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { CausalLine } from "@/components/charts/causal-annotation";
import { generateBurnupPrompts } from "@/lib/ai-prompts/burnup";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { BURNUP_ACTIONS } from "@/lib/history/event-actions";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chartTheme } from "@/components/charts/chart-theme";
import {
  BarChart2,
  Plus,
  Trash2,
  Settings2,
  TrendingUp,
  AlertTriangle,
  Target,
  CalendarDays,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface DayEntry {
  id: string;
  day: number;
  scope: number | null;
  completed: number | null;
  /** Optional per-day note (e.g. "Demo prep", "Outage"). */
  description?: string;
}

interface BurnupConfig {
  sprintDays: number;
  sprintStartDate: string;
}

interface BurnupStore {
  config: BurnupConfig;
  entries: DayEntry[];
  updateConfig: (updates: Partial<BurnupConfig>) => void;
  updateEntry: (id: string, updates: Partial<Omit<DayEntry, "id">>) => void;
  addEntry: () => void;
  removeEntry: (id: string) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Default data                                                               */
/* -------------------------------------------------------------------------- */

// Static default start date — must match between SSR and CSR. Using
// `todayLocalISO()` here produced a fresh string per render call, so
// the server-rendered HTML and client-rendered HTML disagreed on
// `sprintStartDate` whenever no persisted state existed → React
// emitted a hydration mismatch warning on every cold visit. Sibling
// burndown tool uses a static date for the same reason. Users still
// see today's date populated as soon as they edit the field; this
// constant only affects the very first render before hydration.
function makeDefaultConfig(): BurnupConfig {
  return {
    sprintDays: 10,
    sprintStartDate: "2026-01-01",
  };
}

function createDefaultEntries(sprintDays: number): DayEntry[] {
  // Deterministic IDs so SSR HTML matches client HTML at hydration. User
  // edits replace these via the resize/add handlers, which mint real UUIDs.
  return Array.from({ length: sprintDays + 1 }, (_, i) => ({
    id: `default:day-${i}`,
    day: i,
    scope: i === 0 ? 40 : null,
    completed: i === 0 ? 0 : null,
  }));
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                      */
/* -------------------------------------------------------------------------- */

const useBurnupStore = create<BurnupStore>()(
  persist(
    (set) => {
      // Compute defaults once so config and entries share the same sprintDays
      // — the previous version called makeDefaultConfig() twice, allowing the
      // two values to drift if the helper ever became non-deterministic.
      const initialConfig = makeDefaultConfig();
      return {
        config: initialConfig,
        entries: createDefaultEntries(initialConfig.sprintDays),

        updateConfig: (updates) =>
          set((s) => {
            const newConfig = { ...s.config, ...updates };
            // Resize entries when sprint length changes — preserve user-entered
            // values for days that still exist, drop days past the new end, and
            // append blank entries for new days. The previous implementation
            // wiped ALL user data whenever the user nudged the sprint length.
            if (updates.sprintDays !== undefined && updates.sprintDays !== s.config.sprintDays) {
              const target = Math.max(1, updates.sprintDays);
              const byDay = new Map(s.entries.map((e) => [e.day, e]));
              const next = Array.from({ length: target + 1 }, (_, i) => {
                const existing = byDay.get(i);
                if (existing) return existing;
                return {
                  id: crypto.randomUUID(),
                  day: i,
                  scope: i === 0 ? 40 : null,
                  completed: i === 0 ? 0 : null,
                };
              });
              return { config: newConfig, entries: next };
            }
            return { config: newConfig };
          }),

        updateEntry: (id, updates) =>
          set((s) => ({
            entries: s.entries.map((e) => (e.id === id ? { ...e, ...updates } : e)),
          })),

        addEntry: () =>
          set((s) => {
            const maxDay = s.entries.reduce((m, e) => Math.max(m, e.day), 0);
            return {
              entries: [
                ...s.entries,
                { id: crypto.randomUUID(), day: maxDay + 1, scope: null, completed: null },
              ],
            };
          }),

        removeEntry: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

        reset: () => {
          const cfg = makeDefaultConfig();
          set({
            config: cfg,
            entries: createDefaultEntries(cfg.sprintDays),
          });
        },
      };
    },
    { name: "agile-toolkit:burnup", storage: safeJSONStorage("burnup") }
  )
);

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function computeTodayDay(sprintStartDate: string, sprintDays: number): number | null {
  // Parse "YYYY-MM-DD" as a LOCAL calendar date and compare against today's
  // local calendar date. The previous implementation parsed the ISO string
  // (UTC midnight) and then called setHours (local), which mis-aligned the
  // "Today" marker by a day for users east of UTC.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sprintStartDate.trim());
  if (!m) return null;
  const startY = Number(m[1]);
  const startM = Number(m[2]) - 1;
  const startD = Number(m[3]);
  const start = new Date(startY, startM, startD).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(today)) return null;
  const diffDays = Math.round((today - start) / (1000 * 60 * 60 * 24));
  if (diffDays < 0 || diffDays > sprintDays) return null;
  return diffDays;
}

/* -------------------------------------------------------------------------- */
/*  Custom Tooltip                                                             */
/* -------------------------------------------------------------------------- */

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; fill?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={chartTheme.tooltipStyle} className="px-3 py-2 min-w-[150px]">
      <p className="font-semibold mb-1.5" style={{ color: "#e2e8f0" }}>
        Day {label}
      </p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: p.color || p.fill }}>{p.name}</span>
          <span style={{ color: "#e2e8f0" }} className="font-data font-semibold">
            {p.value != null ? `${p.value} pts` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stat Card                                                                  */
/* -------------------------------------------------------------------------- */

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  color = "#00f0ff",
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg" style={{ background: `${color}18` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
          <span className="text-sm text-sub">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-data font-bold text-text">{value}</span>
          {unit && <span className="text-sm text-sub">{unit}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Client Component                                                      */
/* -------------------------------------------------------------------------- */

export function BurnupClient() {
  const {
    config,
    entries,
    updateConfig: updateConfigRaw,
    updateEntry,
    addEntry: addEntryRaw,
    removeEntry: removeEntryRaw,
    reset: resetRaw,
  } = useBurnupStore();
  const { log } = useHistoryLogger("burnup");

  const updateConfig: typeof updateConfigRaw = (updates) => {
    updateConfigRaw(updates);
    log(BURNUP_ACTIONS.CONFIG_UPDATED, updates as Record<string, unknown>);
  };
  const addEntry: typeof addEntryRaw = () => {
    addEntryRaw();
    const fresh = useBurnupStore.getState().entries;
    const created = fresh[fresh.length - 1];
    log(BURNUP_ACTIONS.DAY_LOGGED, { entryId: created?.id, day: created?.day });
  };
  const removeEntry: typeof removeEntryRaw = (id) => {
    const entry = entries.find((e) => e.id === id);
    removeEntryRaw(id);
    log(BURNUP_ACTIONS.DAY_REMOVED, { day: entry?.day });
  };
  const reset = () => {
    resetRaw();
    log(BURNUP_ACTIONS.BURNUP_RESET, {});
  };

  const chartRef = useRef<HTMLDivElement>(null);

  /* -- Sorted entries ------------------------------------------------------ */

  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.day - b.day), [entries]);

  /* -- Carry-forward scope (scope persists until changed) ------------------ */

  // Numeric series of completed points at filled days. Drops holes — Holt
  // expects an evenly-spaced sequence and we'd rather forecast from real
  // samples than synthesise zeros.
  const completedSeries = useMemo(
    () =>
      sortedEntries
        .filter((e) => e.completed !== null && Number.isFinite(e.completed))
        .map((e) => e.completed as number),
    [sortedEntries]
  );

  // Bayesian forecast for the days remaining in the sprint after the last
  // logged completed point. Returns [] when n<2 — band area then renders
  // BUG-T1-burnup-1: use the contiguous-prefix last-filled-day so Holt's
  // smoothing isn't fit against a discontinuous series. Burndown already
  // does this; the prior `Math.max(...filledDays)` accepted skipped
  // days (e.g. 0,1,5) and produced a misleading projection band.
  const contiguousLastFilledDay = useMemo(() => {
    // Walk from day 0 upward, stop at the first hole.
    const filledSet = new Set(
      sortedEntries
        .filter((e) => e.completed !== null && Number.isFinite(e.completed))
        .map((e) => e.day)
    );
    let last = -1;
    for (let d = 0; d <= config.sprintDays; d++) {
      if (filledSet.has(d)) last = d;
      else if (last >= 0) break; // first gap after some fill
    }
    return last >= 0 ? last : 0;
  }, [sortedEntries, config.sprintDays]);

  const forecast = useMemo(() => {
    if (completedSeries.length < 2) return [];
    const horizon = Math.max(1, config.sprintDays - contiguousLastFilledDay);
    return forecastBayesianHolt(completedSeries, horizon);
  }, [completedSeries, contiguousLastFilledDay, config.sprintDays]);

  // Forecast lookup keyed by sprint-day.
  const forecastByDay = useMemo(() => {
    if (forecast.length === 0) return new Map<number, (typeof forecast)[number]>();
    const m = new Map<number, (typeof forecast)[number]>();
    forecast.forEach((fp, i) => {
      m.set(contiguousLastFilledDay + i + 1, fp);
    });
    return m;
  }, [forecast, contiguousLastFilledDay]);

  // CUSUM on completed-points series. Useful for spotting "team unblocked"
  // (sustained acceleration) or "delivery stalled" (sustained flatten).
  const changepoints = useMemo(() => {
    if (completedSeries.length < 4) return [];
    return cusum(completedSeries);
  }, [completedSeries]);

  const changepointDays = useMemo(() => {
    if (changepoints.length === 0) return [] as Array<{ day: number; direction: "up" | "down" }>;
    const filledDays = sortedEntries
      .filter((e) => e.completed !== null && Number.isFinite(e.completed))
      .map((e) => e.day);
    return changepoints
      .map((cp) => ({ day: filledDays[cp.index], direction: cp.direction }))
      .filter((x): x is { day: number; direction: "up" | "down" } => Number.isFinite(x.day));
  }, [changepoints, sortedEntries]);

  // Mann-Kendall trend test on completed-points series. Needs n>=5 to be
  // informative; renders as a chip near the chart title only when the trend
  // is statistically significant at α=0.05 (matching kanban/velocity).
  const trendTest = useMemo(() => {
    if (completedSeries.length < 5) return null;
    return mannKendall(completedSeries);
  }, [completedSeries]);

  const chartData = useMemo(() => {
    const map = new Map<number, DayEntry>();
    sortedEntries.forEach((e) => map.set(e.day, e));

    // Two-pass build so the forecast band's upper-cap reads the explicit
    // carry-forward scope from the row we're about to emit — not a value
    // captured by closure that could go stale if the iteration order ever
    // changed (e.g. parallel/lazy callback variants of Array.from).
    type Row = {
      day: number;
      scope: number | null;
      completed: number | null;
      forecast: number | undefined;
      band80Lower: number | undefined;
      band80Upper: number | undefined;
      description: string;
    };

    const rows: Row[] = [];
    let lastScope: number | null = null;
    for (let day = 0; day <= config.sprintDays; day++) {
      const entry = map.get(day);
      if (entry?.scope !== null && entry?.scope !== undefined) {
        lastScope = entry.scope;
      }
      const fc = forecastByDay.get(day);
      // Read the carry-forward scope for THIS row before applying the upper
      // cap — this is the same value we're about to write into `scope`, not
      // a stale upstream variable.
      const rowScope = lastScope;
      rows.push({
        day,
        scope: rowScope,
        completed: entry?.completed ?? null,
        forecast: fc ? parseFloat(fc.yHat.toFixed(1)) : undefined,
        // Clamp lower band at 0 — completed points can't be negative; clamp
        // upper band at the carried-forward scope when known so the band
        // doesn't visually exceed total scope (which would mislead).
        band80Lower: fc ? parseFloat(Math.max(0, fc.lower80).toFixed(1)) : undefined,
        band80Upper: fc
          ? parseFloat(
              (rowScope !== null
                ? Math.min(rowScope, Math.max(0, fc.upper80))
                : Math.max(0, fc.upper80)
              ).toFixed(1)
            )
          : undefined,
        description: entry?.description ?? "",
      });
    }
    return rows;
  }, [sortedEntries, config.sprintDays, forecastByDay]);

  const todayDay = useMemo(
    () => computeTodayDay(config.sprintStartDate, config.sprintDays),
    [config.sprintStartDate, config.sprintDays]
  );

  /* -- Summary stats ------------------------------------------------------- */

  const stats = useMemo(() => {
    const filledEntries = sortedEntries.filter((e) => e.scope !== null || e.completed !== null);
    if (filledEntries.length === 0) {
      return {
        initialScope: 0,
        maxScope: 0,
        scopeCreep: 0,
        latestCompleted: 0,
        completionPct: 0,
        projectedDay: null as number | null,
      };
    }

    const initialScope = chartData.find((d) => d.scope !== null)?.scope ?? 0;
    const scopeVals = chartData.map((d) => d.scope ?? 0);
    const maxScope = scopeVals.length > 0 ? Math.max(...scopeVals) : 0;
    const scopeCreep = Math.max(0, maxScope - initialScope);

    const lastFilledEntry = [...sortedEntries].reverse().find((e) => e.completed !== null);
    const latestCompleted = lastFilledEntry?.completed ?? 0;
    const currentScope = chartData[chartData.length - 1]?.scope ?? maxScope;
    const completionPct = Math.max(
      0,
      Math.min(100, currentScope > 0 ? Math.round((latestCompleted / currentScope) * 100) : 0)
    );

    // Projected completion: linear extrapolation from last two filled entries
    let projectedDay: number | null = null;
    // R5: dedupe entries by `day` before computing projection. Two entries
    // on the SAME day (possible if the user clicks "Add Day" twice for
    // the same idx) produced `Math.max(1, 0) === 1` in the denominator,
    // yielding a huge spurious rate spike → wildly wrong projection.
    const dedupedByDay = new Map<number, (typeof sortedEntries)[number]>();
    for (const e of sortedEntries) {
      if (e.completed === null) continue;
      // Last-write-wins on duplicate days.
      dedupedByDay.set(e.day, e);
    }
    const completedEntries = Array.from(dedupedByDay.values()).sort((a, b) => a.day - b.day);
    if (completedEntries.length >= 2) {
      const n = completedEntries.length;
      const last = completedEntries[n - 1];
      const prev = completedEntries[n - 2];
      const rate = (last.completed! - prev.completed!) / Math.max(1, last.day - prev.day);
      if (rate > 0 && Number.isFinite(rate)) {
        const daysLeft = (currentScope - latestCompleted) / rate;
        if (Number.isFinite(daysLeft) && daysLeft >= 0) {
          // Cap projected day at sprintDays + 365 — beyond that the band is
          // meaningless and a huge number would clobber the UI.
          projectedDay = Math.min(config.sprintDays + 365, Math.round(last.day + daysLeft));
        }
      }
    }

    return {
      initialScope,
      maxScope,
      scopeCreep,
      latestCompleted,
      completionPct,
      projectedDay,
    };
  }, [sortedEntries, chartData, config.sprintDays]);

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Day", "Scope (pts)", "Completed (pts)", "Note"],
      rows: chartData.map((d) => [d.day, d.scope ?? "", d.completed ?? "", d.description ?? ""]),
    }),
    [chartData]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Burnup Chart",
      prompts: generateBurnupPrompts({ config, entries }),
    }),
    [config, entries]
  );

  /* -- Render -------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      toolId="burnup"
      title="Burnup Generator"
      description="Visualise completed work climbing toward total scope. Scope creep is immediately visible when the scope line rises."
      category="Metrics & Dashboards"
    >
      <div className="space-y-6">
        {/* ---- Summary Stats ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Completion"
            value={stats.completionPct}
            unit="%"
            icon={Target}
            color="#00f0ff"
          />
          <StatCard
            label="Scope Creep"
            value={stats.scopeCreep > 0 ? `+${stats.scopeCreep}` : stats.scopeCreep}
            unit="pts"
            icon={AlertTriangle}
            color={stats.scopeCreep > 0 ? "#ffaa00" : "#00ff88"}
          />
          <StatCard
            label="Points Completed"
            value={stats.latestCompleted}
            unit={`/ ${stats.maxScope} pts`}
            icon={TrendingUp}
            color="#00ff88"
          />
          <StatCard
            label="Projected Done"
            value={
              stats.projectedDay !== null
                ? stats.projectedDay <= config.sprintDays
                  ? `Day ${stats.projectedDay}`
                  : "After sprint"
                : "—"
            }
            icon={CalendarDays}
            color={
              stats.projectedDay !== null && stats.projectedDay <= config.sprintDays
                ? "#00ff88"
                : "#ef4444"
            }
          />
        </div>

        {/* ---- Configuration ---- */}
        <SectionCard
          title="Sprint Configuration"
          icon={Settings2}
          titleSize="lg"
          headerClassName="pb-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sub text-xs">Sprint Length (days)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={config.sprintDays}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n))
                    updateConfig({ sprintDays: Math.max(1, Math.min(60, n)) });
                }}
                className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sub text-xs">Sprint Start Date</Label>
              <Input
                type="date"
                value={config.sprintStartDate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v)) {
                    updateConfig({ sprintStartDate: v });
                  }
                }}
                className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
              />
            </div>
          </div>
        </SectionCard>

        {/* ---- Chart ---- */}
        <ChartCard
          title="Burnup Chart"
          icon={BarChart2}
          height={400}
          chartContainerRef={chartRef}
          headerExtras={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton filename="burnup-chart" csvData={csvData} targetRef={chartRef} />
            </>
          }
          footer={
            stats.scopeCreep > 0 ? (
              <div className="flex items-center gap-2 text-xs text-[#ffaa00] bg-[#ffaa00]/8 border border-[#ffaa00]/20 rounded-md px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Scope creep detected: scope increased by {stats.scopeCreep} pts (
                {stats.initialScope} → {stats.maxScope}).
              </div>
            ) : null
          }
        >
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={(v: number) => `D${v}`}
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={{ stroke: chartTheme.gridColor }}
              tickLine={false}
              label={{
                value: "Sprint Day",
                position: "insideBottomRight",
                offset: -10,
                fill: chartTheme.axisColor,
                fontSize: 11,
              }}
            />
            <YAxis
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              label={{
                value: "Points",
                angle: -90,
                position: "insideLeft",
                fill: chartTheme.axisColor,
                fontSize: 11,
                offset: 10,
              }}
              domain={[0, "auto"]}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={chartTheme.legendStyle} iconType="line" />

            {/* Today marker */}
            {todayDay !== null && (
              <ReferenceLine
                x={todayDay}
                stroke="#ff00aa"
                strokeWidth={2}
                strokeDasharray="5 3"
                label={{
                  value: "Today",
                  position: "top",
                  fill: "#ff00aa",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            )}

            {/* Bayesian 80% forecast band — drawn before the actual
                      completed area so the lines render on top. The
                      lower-mask Area uses var(--bg) at fillOpacity 1 to clip
                      the upper Area down to a true band rather than a solid
                      wedge from 0. */}
            <Area
              dataKey="band80Upper"
              name="80% forecast"
              stroke="none"
              fill="#00f0ff"
              fillOpacity={0.18}
              connectNulls
              isAnimationActive={false}
            />
            <Area
              dataKey="band80Lower"
              stroke="none"
              fill="var(--bg, #06080f)"
              fillOpacity={1}
              legendType="none"
              connectNulls
              isAnimationActive={false}
            />

            {/* Completed area */}
            <Area
              type="monotone"
              dataKey="completed"
              name="Completed"
              fill="rgba(0,240,255,0.15)"
              stroke="#00f0ff"
              strokeWidth={2.5}
              dot={{ fill: "#00f0ff", r: 4, strokeWidth: 0 }}
              activeDot={{ r: 6, fill: "#00f0ff", strokeWidth: 0 }}
              connectNulls={false}
            />

            {/* Scope line */}
            <Line
              type="stepAfter"
              dataKey="scope"
              name="Scope"
              stroke="#ff00aa"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 5, fill: "#ff00aa", strokeWidth: 0 }}
              connectNulls
            />

            {/* Forecast centre-line (dashed) — paired with the band
                      Area; only renders when the forecast has data. */}
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke="#00f0ff"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              connectNulls
            />

            {/* CUSUM regime-shift markers on completed-points series. */}
            {changepointDays.map((cp, i) => (
              <CausalLine
                key={`cusum-${cp.day}-${cp.direction}-${i}`}
                annotation={{
                  x: cp.day,
                  label: `Delivery shift ${cp.direction}`,
                  detail: `CUSUM detected a ${cp.direction === "up" ? "sustained acceleration" : "sustained slow-down"} in completed points around day ${cp.day}.`,
                  confidence: "moderate",
                }}
              />
            ))}
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
              <span>{trendTest.trend === "up" ? "↗" : "↘"} trend significant</span>
              <span className="opacity-60">p={trendTest.pValue.toFixed(2)}</span>
            </span>
          </div>
        )}

        {/* ---- Data Entry Table ---- */}
        <SectionCard
          title="Daily Data"
          icon={TrendingUp}
          titleSize="lg"
          headerClassName="pb-4"
          actions={
            <>
              <Button variant="danger-ghost" size="sm" onClick={reset}>
                Reset
              </Button>
              <Button size="sm" variant="toolkit" onClick={addEntry} className="gap-1.5">
                <Plus className="w-4 h-4" />
                Add Day
              </Button>
            </>
          }
        >
          {/* Column headers.
              Note column uses a single-line Input rather than a Textarea
              because each day-row is a compact grid; a multi-line field
              would break the visual rhythm of the dense tracker. */}
          <div className="hidden sm:grid grid-cols-[80px_1fr_1fr_1.2fr_auto] gap-3 px-1 pb-2 border-b border-border mb-2">
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Day</span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Scope (Total pts)
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Completed (pts)
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Note</span>
            <span className="w-9" />
          </div>

          <div className="space-y-2">
            {sortedEntries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[80px_1fr_1fr_1.2fr_auto] gap-3 items-center"
              >
                <span className="font-data text-sm font-semibold text-accent">Day {entry.day}</span>

                <Input
                  type="number"
                  min={0}
                  placeholder="— pts"
                  value={entry.scope ?? ""}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      updateEntry(entry.id, { scope: null });
                      return;
                    }
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) updateEntry(entry.id, { scope: Math.max(0, n) });
                  }}
                  className="bg-surface-deep border-border text-text font-data focus:border-[#ff00aa]/50 focus:ring-[#ff00aa]/20"
                />

                <Input
                  type="number"
                  min={0}
                  placeholder="— pts"
                  value={entry.completed ?? ""}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      updateEntry(entry.id, { completed: null });
                      return;
                    }
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) updateEntry(entry.id, { completed: Math.max(0, n) });
                  }}
                  className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
                />

                {/* Compact single-line note input — dense tracker row. */}
                <Input
                  type="text"
                  placeholder="Optional note..."
                  value={entry.description ?? ""}
                  onChange={(e) =>
                    updateEntry(entry.id, {
                      description: e.target.value.trim() ? e.target.value : undefined,
                    })
                  }
                  className="bg-surface-deep border-border text-text text-xs focus:border-accent/50 focus:ring-accent/20"
                  aria-label={`Note for day ${entry.day}`}
                />

                <Button
                  variant="danger-ghost"
                  size="icon"
                  onClick={() => removeEntry(entry.id)}
                  disabled={sortedEntries.length <= 1}
                  aria-label={`Remove day ${entry.day}`}
                  className="h-9 w-9 disabled:opacity-30"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-sub">
            Tip: Only enter scope on days when it changes. The chart carries the last known scope
            value forward. Day 0 is the sprint start.
          </p>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
