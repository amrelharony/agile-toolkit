"use client";

import { useRef, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ComposedChart,
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
import { generateBurndownPrompts } from "@/lib/ai-prompts/burndown";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { BURNDOWN_ACTIONS } from "@/lib/history/event-actions";
import { withTimeTravel } from "@/lib/stores/with-time-travel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chartTheme } from "@/components/charts/chart-theme";
import { useChartHeight } from "@/hooks/use-chart-height";
import {
  BarChart3,
  Plus,
  Trash2,
  Settings2,
  TrendingDown,
  TrendingUp,
  Minus,
  Flag,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                       */
/* -------------------------------------------------------------------------- */

interface DayEntry {
  id: string;
  day: number;
  remaining: number | null;
  scopeChange: boolean;
  /** Optional per-day note (e.g. "Friday demo prep", "Holiday"). */
  description?: string;
}

interface BurndownConfig {
  totalPoints: number;
  sprintDays: number;
  sprintStartDate: string;
}

interface BurndownStore {
  config: BurndownConfig;
  entries: DayEntry[];
  updateConfig: (updates: Partial<BurndownConfig>) => void;
  updateEntry: (id: string, updates: Partial<Omit<DayEntry, "id">>) => void;
  addEntry: () => void;
  removeEntry: (id: string) => void;
  toggleScopeChange: (id: string) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Default data                                                               */
/* -------------------------------------------------------------------------- */

// Defaults are computed lazily so the start-date and entry IDs are bound to
// the user's actual session — not the moment the JS bundle was loaded (which,
// with persisted state, can be days or weeks in the past).
function makeDefaultConfig(): BurndownConfig {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return {
    totalPoints: 40,
    sprintDays: 10,
    sprintStartDate: `${y}-${m}-${day}`,
  };
}

function createDefaultEntries(sprintDays: number, totalPoints: number): DayEntry[] {
  return Array.from({ length: sprintDays + 1 }, (_, i) => ({
    id: crypto.randomUUID(),
    day: i,
    remaining: i === 0 ? totalPoints : null,
    scopeChange: false,
  }));
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                      */
/* -------------------------------------------------------------------------- */

const useBurndownStore = create<BurndownStore>()(
  persist(
    withTimeTravel<BurndownStore>(
      { toolId: "burndown" },
      (set) => {
      const initialConfig = makeDefaultConfig();
      return {
      config: initialConfig,
      entries: createDefaultEntries(initialConfig.sprintDays, initialConfig.totalPoints),

      updateConfig: (updates) =>
        set((s) => {
          const newConfig = { ...s.config, ...updates };
          // Resize entries when sprint length changes — preserve user-entered
          // values for days that still exist, drop days past the new end, and
          // append blank entries for new days. Prior implementation wiped all
          // filled-in remaining-points whenever the user nudged the length.
          if (updates.sprintDays !== undefined && updates.sprintDays !== s.config.sprintDays) {
            const target = Math.max(1, updates.sprintDays);
            const byDay = new Map(s.entries.map((e) => [e.day, e]));
            const next = Array.from({ length: target + 1 }, (_, i) => {
              const existing = byDay.get(i);
              if (existing) return existing;
              return {
                id: crypto.randomUUID(),
                day: i,
                remaining: i === 0 ? newConfig.totalPoints : null,
                scopeChange: false,
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
              {
                id: crypto.randomUUID(),
                day: maxDay + 1,
                remaining: null,
                scopeChange: false,
              },
            ],
          };
        }),

      removeEntry: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      toggleScopeChange: (id) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id ? { ...e, scopeChange: !e.scopeChange } : e
          ),
        })),

      reset: () => {
        const cfg = makeDefaultConfig();
        set({
          config: cfg,
          entries: createDefaultEntries(cfg.sprintDays, cfg.totalPoints),
        });
      },
    };
    }
    ),
    {
      name: "agile-toolkit:burndown",
      partialize: (state) => {
        const {
          _ttPast,
          _ttFuture,
          ...rest
        } = state as BurndownStore & { _ttPast?: unknown; _ttFuture?: unknown };
        void _ttPast;
        void _ttFuture;
        return rest;
      },
    }
  )
);

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getIdealValue(day: number, totalPoints: number, sprintDays: number): number {
  // Hydration guard — when sprintDays is 0/negative (mid-edit, transient store
  // state, or corrupted persistence), the original `totalPoints / sprintDays`
  // produces Infinity/NaN that cascades through the chart's domain calc and
  // crashes Recharts. Return totalPoints (the y-intercept) as a safe fallback
  // so the chart still renders a flat line at full scope.
  if (!Number.isFinite(sprintDays) || sprintDays <= 0) return totalPoints;
  return Math.max(0, totalPoints - (totalPoints / sprintDays) * day);
}

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
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={chartTheme.tooltipStyle} className="px-3 py-2 min-w-[140px]">
      <p className="font-semibold mb-1.5" style={{ color: "#e2e8f0" }}>
        Day {label}
      </p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: p.color }}>{p.name}</span>
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

export function BurndownClient() {
  const {
    config,
    entries,
    updateConfig: updateConfigRaw,
    updateEntry: updateEntryRaw,
    addEntry: addEntryRaw,
    removeEntry: removeEntryRaw,
    toggleScopeChange: toggleScopeChangeRaw,
    reset: resetRaw,
  } = useBurndownStore();
  const { log } = useHistoryLogger("burndown");

  const updateConfig: typeof updateConfigRaw = (updates) => {
    updateConfigRaw(updates);
    log(BURNDOWN_ACTIONS.CONFIG_UPDATED, updates as Record<string, unknown>);
  };
  const updateEntry: typeof updateEntryRaw = (id, updates) => {
    updateEntryRaw(id, updates);
  };
  const addEntry: typeof addEntryRaw = () => {
    addEntryRaw();
    const fresh = useBurndownStore.getState().entries;
    const created = fresh[fresh.length - 1];
    log(BURNDOWN_ACTIONS.DAY_LOGGED, { entryId: created?.id, day: created?.day });
  };
  const removeEntry: typeof removeEntryRaw = (id) => {
    const entry = entries.find((e) => e.id === id);
    removeEntryRaw(id);
    log(BURNDOWN_ACTIONS.DAY_REMOVED, { day: entry?.day });
  };
  const toggleScopeChange: typeof toggleScopeChangeRaw = (id) => {
    toggleScopeChangeRaw(id);
    const entry = useBurndownStore.getState().entries.find((e) => e.id === id);
    log(BURNDOWN_ACTIONS.SCOPE_CHANGED, {
      day: entry?.day,
      scopeChange: entry?.scopeChange,
    });
  };
  const reset = () => {
    resetRaw();
    log(BURNDOWN_ACTIONS.BURNDOWN_RESET, {});
  };

  const chartRef = useRef<HTMLDivElement>(null);
  const chartHeight = useChartHeight({ min: 260, max: 420 });

  /* -- Chart data ---------------------------------------------------------- */

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.day - b.day),
    [entries]
  );

  const chartData = useMemo(() => {
    const map = new Map<number, DayEntry>();
    sortedEntries.forEach((e) => map.set(e.day, e));

    return Array.from({ length: config.sprintDays + 1 }, (_, day) => {
      const entry = map.get(day);
      return {
        day,
        ideal: parseFloat(getIdealValue(day, config.totalPoints, config.sprintDays).toFixed(1)),
        actual: entry?.remaining ?? null,
        scopeChange: entry?.scopeChange ?? false,
        description: entry?.description ?? "",
      };
    });
  }, [sortedEntries, config]);

  const todayDay = useMemo(
    () => computeTodayDay(config.sprintStartDate, config.sprintDays),
    [config.sprintStartDate, config.sprintDays]
  );

  /* -- Summary stats ------------------------------------------------------- */

  const stats = useMemo(() => {
    // Last filled actual entry
    const filledEntries = sortedEntries.filter((e) => e.remaining !== null);
    if (filledEntries.length === 0) {
      return { variance: 0, trend: "neutral" as const, completionRate: 0, lastDay: 0 };
    }
    const last = filledEntries[filledEntries.length - 1];
    const idealAtLastDay = getIdealValue(last.day, config.totalPoints, config.sprintDays);
    const variance = parseFloat((idealAtLastDay - (last.remaining ?? 0)).toFixed(1));
    const trend = variance > 0.5 ? "ahead" : variance < -0.5 ? "behind" : "neutral";
    const completed = config.totalPoints - (last.remaining ?? config.totalPoints);
    const completionRate = Math.round((completed / config.totalPoints) * 100);
    return { variance, trend, completionRate, lastDay: last.day };
  }, [sortedEntries, config]);

  const scopeChangeDays = useMemo(
    () => sortedEntries.filter((e) => e.scopeChange).map((e) => e.day),
    [sortedEntries]
  );

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Day", "Ideal (pts)", "Actual (pts)", "Scope Change", "Note"],
      rows: chartData.map((d) => [
        d.day,
        d.ideal,
        d.actual ?? "",
        d.scopeChange ? "Yes" : "No",
        d.description ?? "",
      ]),
    }),
    [chartData]
  );

  const promptConfig = useMemo(() => ({
    toolName: "Burndown Chart",
    prompts: generateBurndownPrompts({ config, entries }),
  }), [config, entries]);

  /* -- Trend icon ---------------------------------------------------------- */

  const TrendIcon =
    stats.trend === "ahead" ? TrendingDown : stats.trend === "behind" ? TrendingUp : Minus;
  const trendColor =
    stats.trend === "ahead"
      ? "#00ff88"
      : stats.trend === "behind"
        ? "#ef4444"
        : "#94a3b8";
  const trendLabel =
    stats.trend === "ahead" ? "Ahead of ideal" : stats.trend === "behind" ? "Behind ideal" : "On track";

  /* -- Render -------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      toolId="burndown"
      title="Burndown Generator"
      description="Track sprint progress with ideal vs. actual remaining points, today marker, and scope change annotations."
      category="Metrics & Dashboards"
    >
      <div className="space-y-6">
        {/* ---- Summary Stats ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Points"
            value={config.totalPoints}
            unit="pts"
            icon={BarChart3}
          />
          <StatCard
            label="Variance from Ideal"
            value={stats.variance > 0 ? `+${stats.variance}` : stats.variance}
            unit="pts"
            icon={TrendIcon}
            color={trendColor}
          />
          <StatCard
            label="Completion Rate"
            value={stats.completionRate}
            unit="%"
            icon={TrendingDown}
            color="#00f0ff"
          />
          <StatCard
            label="Trend"
            value={trendLabel}
            icon={TrendIcon}
            color={trendColor}
          />
        </div>

        {/* ---- Configuration ---- */}
        <SectionCard
          title="Sprint Configuration"
          icon={Settings2}
          titleSize="lg"
          headerClassName="pb-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sub text-xs">Total Story Points</Label>
              <Input
                type="number"
                min={1}
                value={config.totalPoints}
                onChange={(e) => updateConfig({ totalPoints: Math.max(1, Number(e.target.value)) })}
                className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sub text-xs">Sprint Length (days)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={config.sprintDays}
                onChange={(e) =>
                  updateConfig({ sprintDays: Math.max(1, Math.min(60, Number(e.target.value))) })
                }
                className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sub text-xs">Sprint Start Date</Label>
              <Input
                type="date"
                value={config.sprintStartDate}
                onChange={(e) => updateConfig({ sprintStartDate: e.target.value })}
                className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
              />
            </div>
          </div>
        </SectionCard>

        {/* ---- Chart ---- */}
        <ChartCard
          title="Burndown Chart"
          icon={BarChart3}
          height={chartHeight}
          chartContainerRef={chartRef}
          headerExtras={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="burndown-chart"
                csvData={csvData}
                targetRef={chartRef}
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
              stroke={chartTheme.gridColor}
              vertical={false}
            />
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
            <Legend
              wrapperStyle={chartTheme.legendStyle}
              iconType="line"
            />

            {/* Scope change markers */}
            {scopeChangeDays.map((day) => (
              <ReferenceLine
                key={`scope-${day}`}
                x={day}
                stroke="#ffaa00"
                strokeDasharray="3 3"
                strokeWidth={1.5}
                label={{
                  value: "Scope",
                  position: "top",
                  fill: "#ffaa00",
                  fontSize: 10,
                }}
              />
            ))}

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

            {/* Ideal line */}
            <Line
              type="linear"
              dataKey="ideal"
              name="Ideal"
              stroke="#94a3b8"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              activeDot={false}
              connectNulls
            />

            {/* Actual line */}
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke="#00f0ff"
              strokeWidth={2.5}
              dot={{ fill: "#00f0ff", r: 4, strokeWidth: 0 }}
              activeDot={{ r: 6, fill: "#00f0ff", strokeWidth: 0 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ChartCard>

        {/* ---- Data Entry Table ---- */}
        <SectionCard
          title="Daily Progress"
          icon={TrendingDown}
          titleSize="lg"
          headerClassName="pb-4"
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
                onClick={addEntry}
                className="gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add Day
              </Button>
            </>
          }
        >
          {/* Header row.
              Note column uses a single-line Input (not Textarea) because each
              day-row is a compact grid; a multi-line field would break the
              visual rhythm of the dense tracker. */}
          <div className="hidden sm:grid grid-cols-[80px_1fr_1.2fr_120px_auto] gap-3 px-1 pb-2 border-b border-border mb-2">
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Day
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Remaining Points
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Note
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider flex items-center gap-1">
              <Flag className="w-3 h-3" /> Scope Change
            </span>
            <span className="w-9" />
          </div>

          <div className="space-y-2">
            {sortedEntries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[80px_1fr_1.2fr_120px_auto] gap-3 items-center"
              >
                <div className="flex items-center">
                  <span className="font-data text-sm font-semibold text-accent">
                    Day {entry.day}
                  </span>
                </div>

                <Input
                  type="number"
                  min={0}
                  placeholder="— pts"
                  value={entry.remaining ?? ""}
                  onChange={(e) =>
                    updateEntry(entry.id, {
                      remaining: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
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

                <button
                  onClick={() => toggleScopeChange(entry.id)}
                  className={`h-9 px-3 rounded-md text-xs font-medium border transition-colors ${
                    entry.scopeChange
                      ? "bg-[#ffaa00]/15 border-[#ffaa00]/40 text-[#ffaa00]"
                      : "bg-card border-border text-sub hover:border-[#ffaa00]/30 hover:text-[#ffaa00]"
                  }`}
                >
                  {entry.scopeChange ? "Scope Changed" : "Mark Change"}
                </button>

                <Button
                  variant="danger-ghost"
                  size="icon"
                  onClick={() => removeEntry(entry.id)}
                  disabled={sortedEntries.length <= 1}
                  className="h-9 w-9 disabled:opacity-30"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Hint */}
          <p className="mt-4 text-xs text-sub">
            Tip: Leave &quot;Remaining Points&quot; blank for days not yet reached. Day 0 is the sprint start.
          </p>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
