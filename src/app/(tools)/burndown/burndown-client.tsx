"use client";

import { useRef, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateBurndownPrompts } from "@/lib/ai-prompts/burndown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chartTheme } from "@/components/charts/chart-theme";
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

const defaultConfig: BurndownConfig = {
  totalPoints: 40,
  sprintDays: 10,
  sprintStartDate: new Date().toISOString().slice(0, 10),
};

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
    (set) => ({
      config: { ...defaultConfig },
      entries: createDefaultEntries(defaultConfig.sprintDays, defaultConfig.totalPoints),

      updateConfig: (updates) =>
        set((s) => {
          const newConfig = { ...s.config, ...updates };
          // Re-scaffold entries if sprint length changed
          if (updates.sprintDays !== undefined && updates.sprintDays !== s.config.sprintDays) {
            return {
              config: newConfig,
              entries: createDefaultEntries(updates.sprintDays, newConfig.totalPoints),
            };
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

      reset: () =>
        set({
          config: { ...defaultConfig },
          entries: createDefaultEntries(defaultConfig.sprintDays, defaultConfig.totalPoints),
        }),
    }),
    { name: "agile-toolkit:burndown" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getIdealValue(day: number, totalPoints: number, sprintDays: number): number {
  return Math.max(0, totalPoints - (totalPoints / sprintDays) * day);
}

function computeTodayDay(sprintStartDate: string, sprintDays: number): number | null {
  try {
    const start = new Date(sprintStartDate);
    const today = new Date();
    // Strip time
    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0 || diffDays > sprintDays) return null;
    return diffDays;
  } catch {
    return null;
  }
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
    updateConfig,
    updateEntry,
    addEntry,
    removeEntry,
    toggleScopeChange,
    reset,
  } = useBurndownStore();

  const chartRef = useRef<HTMLDivElement>(null);

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
      headers: ["Day", "Ideal (pts)", "Actual (pts)", "Scope Change"],
      rows: chartData.map((d) => [
        d.day,
        d.ideal,
        d.actual ?? "",
        d.scopeChange ? "Yes" : "No",
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
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
              <Settings2 className="w-5 h-5 text-accent" />
              Sprint Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* ---- Chart ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <BarChart3 className="w-5 h-5 text-accent" />
                Burndown Chart
              </CardTitle>
              <div className="flex items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="burndown-chart"
                  csvData={csvData}
                  targetRef={chartRef}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div ref={chartRef} className="w-full pt-2">
              <ResponsiveContainer width="100%" height={400}>
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
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* ---- Data Entry Table ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <TrendingDown className="w-5 h-5 text-accent" />
                Daily Progress
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="text-sub hover:text-red-400 hover:bg-red-400/10"
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={addEntry}
                  className="gap-1.5 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40"
                >
                  <Plus className="w-4 h-4" />
                  Add Day
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Header row */}
            <div className="hidden sm:grid grid-cols-[80px_1fr_120px_auto] gap-3 px-1 pb-2 border-b border-border mb-2">
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Day
              </span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Remaining Points
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
                  className="grid grid-cols-[80px_1fr_120px_auto] gap-3 items-center"
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
                    variant="ghost"
                    size="icon"
                    onClick={() => removeEntry(entry.id)}
                    disabled={sortedEntries.length <= 1}
                    className="h-9 w-9 text-sub hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30"
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
          </CardContent>
        </Card>
      </div>
    </ToolPageWrapper>
  );
}
