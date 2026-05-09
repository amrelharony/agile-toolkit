"use client";

import { useRef, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
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
import { generateBurnupPrompts } from "@/lib/ai-prompts/burnup";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { BURNUP_ACTIONS } from "@/lib/history/event-actions";
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

// Computed lazily so the start-date reflects the user's actual session, not
// the moment the JS bundle was first loaded.
function makeDefaultConfig(): BurnupConfig {
  return {
    sprintDays: 10,
    sprintStartDate: todayLocalISO(),
  };
}

function createDefaultEntries(sprintDays: number): DayEntry[] {
  return Array.from({ length: sprintDays + 1 }, (_, i) => ({
    id: crypto.randomUUID(),
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

      removeEntry: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      reset: () => {
        const cfg = makeDefaultConfig();
        set({
          config: cfg,
          entries: createDefaultEntries(cfg.sprintDays),
        });
      },
    };
    },
    { name: "agile-toolkit:burnup" }
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

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.day - b.day),
    [entries]
  );

  /* -- Carry-forward scope (scope persists until changed) ------------------ */

  const chartData = useMemo(() => {
    const map = new Map<number, DayEntry>();
    sortedEntries.forEach((e) => map.set(e.day, e));

    let lastScope: number | null = null;
    return Array.from({ length: config.sprintDays + 1 }, (_, day) => {
      const entry = map.get(day);
      if (entry?.scope !== null && entry?.scope !== undefined) {
        lastScope = entry.scope;
      }
      return {
        day,
        scope: lastScope,
        completed: entry?.completed ?? null,
        description: entry?.description ?? "",
      };
    });
  }, [sortedEntries, config.sprintDays]);

  const todayDay = useMemo(
    () => computeTodayDay(config.sprintStartDate, config.sprintDays),
    [config.sprintStartDate, config.sprintDays]
  );

  /* -- Summary stats ------------------------------------------------------- */

  const stats = useMemo(() => {
    const filledEntries = sortedEntries.filter(
      (e) => e.scope !== null || e.completed !== null
    );
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

    const initialScope =
      chartData.find((d) => d.scope !== null)?.scope ?? 0;
    const maxScope = Math.max(...chartData.map((d) => d.scope ?? 0));
    const scopeCreep = Math.max(0, maxScope - initialScope);

    const lastFilledEntry = [...sortedEntries]
      .reverse()
      .find((e) => e.completed !== null);
    const latestCompleted = lastFilledEntry?.completed ?? 0;
    const currentScope = chartData[chartData.length - 1]?.scope ?? maxScope;
    const completionPct =
      currentScope > 0 ? Math.round((latestCompleted / currentScope) * 100) : 0;

    // Projected completion: linear extrapolation from last two filled entries
    let projectedDay: number | null = null;
    const completedEntries = sortedEntries
      .filter((e) => e.completed !== null)
      .sort((a, b) => a.day - b.day);
    if (completedEntries.length >= 2) {
      const n = completedEntries.length;
      const last = completedEntries[n - 1];
      const prev = completedEntries[n - 2];
      const rate =
        (last.completed! - prev.completed!) / Math.max(1, last.day - prev.day);
      if (rate > 0) {
        const daysLeft = (currentScope - latestCompleted) / rate;
        projectedDay = Math.round(last.day + daysLeft);
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
  }, [sortedEntries, chartData]);

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Day", "Scope (pts)", "Completed (pts)", "Note"],
      rows: chartData.map((d) => [
        d.day,
        d.scope ?? "",
        d.completed ?? "",
        d.description ?? "",
      ]),
    }),
    [chartData]
  );

  const promptConfig = useMemo(() => ({
    toolName: "Burnup Chart",
    prompts: generateBurnupPrompts({ config, entries }),
  }), [config, entries]);

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
          title="Burnup Chart"
          icon={BarChart2}
          height={400}
          chartContainerRef={chartRef}
          headerExtras={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="burnup-chart"
                csvData={csvData}
                targetRef={chartRef}
              />
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
          </ComposedChart>
        </ChartCard>

        {/* ---- Data Entry Table ---- */}
        <SectionCard
          title="Daily Data"
          icon={TrendingUp}
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
          {/* Column headers.
              Note column uses a single-line Input rather than a Textarea
              because each day-row is a compact grid; a multi-line field
              would break the visual rhythm of the dense tracker. */}
          <div className="hidden sm:grid grid-cols-[80px_1fr_1fr_1.2fr_auto] gap-3 px-1 pb-2 border-b border-border mb-2">
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Day
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Scope (Total pts)
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Completed (pts)
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Note
            </span>
            <span className="w-9" />
          </div>

          <div className="space-y-2">
            {sortedEntries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[80px_1fr_1fr_1.2fr_auto] gap-3 items-center"
              >
                <span className="font-data text-sm font-semibold text-accent">
                  Day {entry.day}
                </span>

                <Input
                  type="number"
                  min={0}
                  placeholder="— pts"
                  value={entry.scope ?? ""}
                  onChange={(e) =>
                    updateEntry(entry.id, {
                      scope: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="bg-surface-deep border-border text-text font-data focus:border-[#ff00aa]/50 focus:ring-[#ff00aa]/20"
                />

                <Input
                  type="number"
                  min={0}
                  placeholder="— pts"
                  value={entry.completed ?? ""}
                  onChange={(e) =>
                    updateEntry(entry.id, {
                      completed: e.target.value === "" ? null : Number(e.target.value),
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

          <p className="mt-4 text-xs text-sub">
            Tip: Only enter scope on days when it changes. The chart carries the last known scope
            value forward. Day 0 is the sprint start.
          </p>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
