"use client";

import { useEffect, useRef, useMemo, useState } from "react";
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
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SmartInput } from "@/components/shared/smart-input";
import { CausalLine } from "@/components/charts/causal-annotation";
import { generateBurndownPrompts } from "@/lib/ai-prompts/burndown";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { BURNDOWN_ACTIONS } from "@/lib/history/event-actions";
import { withTimeTravel } from "@/lib/stores/with-time-travel";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { cusum } from "@/lib/analytics/changepoint";
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

// Defaults use a STATIC sprint start date so server-rendered HTML matches
// client-rendered HTML at hydration. Reading `new Date()` here would differ
// between server and client when they land in different timezones (React
// hydration warning), and the server's module-level store would freeze the
// date at boot. Instead, a first run (nothing saved yet) swaps this for
// today's local date once the page mounts — see `needsFirstRunStartDate`.
// Reset also starts the sprint today.
const DEFAULT_SPRINT_START = "2026-01-01";

function makeDefaultConfig(): BurndownConfig {
  return {
    totalPoints: 40,
    sprintDays: 10,
    sprintStartDate: DEFAULT_SPRINT_START,
  };
}

// True until the persisted burndown is restored from storage (see `merge`
// below) or the first-run start date has been applied, so a saved sprint's
// start date is never overwritten.
let needsFirstRunStartDate = true;

function createDefaultEntries(sprintDays: number, totalPoints: number): DayEntry[] {
  // Use deterministic ids for the initial entries so the server-rendered
  // HTML matches the client-rendered HTML on first paint. New entries added
  // by the user get proper UUIDs via `addEntry`. Without this, React 18
  // hydration warns on every fresh load.
  return Array.from({ length: sprintDays + 1 }, (_, i) => ({
    id: `default:day-${i}`,
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
    withTimeTravel<BurndownStore>({ toolId: "burndown" }, (set) => {
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

        removeEntry: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

        toggleScopeChange: (id) =>
          set((s) => ({
            entries: s.entries.map((e) =>
              e.id === id ? { ...e, scopeChange: !e.scopeChange } : e
            ),
          })),

        reset: () => {
          // Use today's local date when resetting — `makeDefaultConfig`
          // returns a STATIC date (for hydration safety on first paint), but
          // a user clicking Reset expects "today" not "January 1st 2026".
          const cfg = { ...makeDefaultConfig(), sprintStartDate: todayLocalISO() };
          set({
            config: cfg,
            entries: createDefaultEntries(cfg.sprintDays, cfg.totalPoints),
          });
        },
      };
    }),
    {
      name: "agile-toolkit:burndown",
      // Wrap localStorage so Safari Private Browsing / corporate-managed
      // Chromes don't crash page-load via persist.rehydrate().
      storage: safeJSONStorage("burndown"),
      // Same shallow merge as the default; it also records whether a saved
      // burndown existed, which decides the first-run start date.
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object") return current;
        needsFirstRunStartDate = false;
        return { ...current, ...(persisted as Partial<BurndownStore>) };
      },
      partialize: (state) => {
        const { _ttPast, _ttFuture, ...rest } = state as BurndownStore & {
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
/*  Undo                                                                       */
/* -------------------------------------------------------------------------- */

// The toast's Undo writes with `setState`, which goes around withTimeTravel's
// wrapped `set`, so restoring is not a new time-travel step. The delete is
// one, and the two can't fight: Ctrl+Z after a toast Undo lands on the
// pre-delete snapshot, which already has the day (nothing visibly changes),
// and a toast Undo after Ctrl+Z finds the day already back and does nothing.
// Either order leaves exactly one copy.
function restoreEntry(entry: DayEntry, index: number) {
  const { entries } = useBurndownStore.getState();
  if (entries.some((e) => e.id === entry.id)) return;
  // "Add Day" may have reused the day number with a blank row: take its
  // place. A row with anything logged on it wins.
  const sameDay = entries.find((e) => e.day === entry.day);
  if (sameDay && (sameDay.remaining !== null || sameDay.description || sameDay.scopeChange)) {
    return;
  }
  const next = entries.filter((e) => e !== sameDay);
  next.splice(Math.min(index, next.length), 0, entry);
  useBurndownStore.setState({ entries: next });
}

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
          <span className="text-2xl sm:text-3xl font-data font-bold text-text">{value}</span>
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
    const index = entries.findIndex((e) => e.id === id);
    const entry = entries[index];
    if (!entry) return;
    undoable({
      label: `Removed day ${entry.day}`,
      apply: () => {
        removeEntryRaw(id);
        log(BURNDOWN_ACTIONS.DAY_REMOVED, { day: entry.day });
      },
      revert: () => restoreEntry(entry, index),
    });
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
    const { config: prevConfig, entries: prevEntries } = useBurndownStore.getState();
    undoable({
      label: "Reset the burndown",
      apply: () => {
        resetRaw();
        log(BURNDOWN_ACTIONS.BURNDOWN_RESET, {});
      },
      // Same `setState` route as restoreEntry, and the same refs the
      // time-travel snapshot holds, so Ctrl+Z and Undo agree.
      revert: () => useBurndownStore.setState({ config: prevConfig, entries: prevEntries }),
    });
  };
  // Reset asks first once anything has been logged past the day-0 scope.
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const loggedDays = entries.filter(
    (e) => (e.day > 0 && e.remaining !== null) || e.description || e.scopeChange
  ).length;

  // First run: start the sprint today instead of on the static default.
  // `setState` goes around withTimeTravel's wrapped `set`, so this isn't an
  // undo step, and it persists the date for the next visit.
  useEffect(() => {
    if (!needsFirstRunStartDate) return;
    needsFirstRunStartDate = false;
    const current = useBurndownStore.getState().config;
    if (current.sprintStartDate !== DEFAULT_SPRINT_START) return;
    useBurndownStore.setState({ config: { ...current, sprintStartDate: todayLocalISO() } });
  }, []);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartHeight = useChartHeight({ min: 260, max: 420 });

  // Draft buffers for the config number fields. Committing on every keystroke
  // is destructive here: updateConfig resizes `entries` when sprintDays
  // changes, so a transient intermediate value (typing "21" passes through 2,
  // clearing the field passes through Number("") === 0 → clamped to 1)
  // permanently drops the logged days past the transient length. Keep
  // keystrokes local and commit once on blur.
  const [totalPointsDraft, setTotalPointsDraft] = useState<string | null>(null);
  const [sprintDaysDraft, setSprintDaysDraft] = useState<string | null>(null);

  /* -- Smart-default for Total Story Points (sprint scope) ----------------- */
  // Uses the velocity:nextSprintPlan predictor (registered globally at
  // boot) — Bayesian Holt over completed sprints in the workspace store.
  // Falls back to confidence "none" if the workspace has no completed
  // sprints, so the chip silently disappears and the input behaves as
  // a normal number field.
  const totalPointsPrediction = usePredictedDefault<number>(
    "velocity",
    "nextSprintPlan",
    config.totalPoints
  );

  /* -- Chart data ---------------------------------------------------------- */

  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.day - b.day), [entries]);

  // Numeric series of remaining points at the days the user has filled in.
  // Used as the input to forecastBayesianHolt + cusum below. Holes are
  // dropped — Holt expects an evenly-spaced series, and we'd rather
  // forecast from real samples than synthesise zeros.
  const remainingSeries = useMemo(
    () =>
      sortedEntries
        .filter((e) => e.remaining !== null && Number.isFinite(e.remaining))
        .map((e) => e.remaining as number),
    [sortedEntries]
  );

  // Contiguous run of filled days starting at the first filled day. Holt
  // assumes evenly-spaced samples and extrapolates from the LAST element of
  // its input, so both the fitted series and the day the forecast is plotted
  // from must stop at the same place: the first hole. Feeding the full filled
  // series while plotting from the contiguous-prefix day (the previous
  // behavior) drew a forecast that contradicted real datapoints sitting to
  // its right when days were filled out of order (e.g. 0, 1, 5).
  const contiguous = useMemo(() => {
    const filled = sortedEntries.filter(
      (e) => e.remaining !== null && Number.isFinite(e.remaining)
    );
    if (filled.length === 0) return { series: [] as number[], lastDay: 0 };
    const series = [filled[0].remaining as number];
    let lastDay = filled[0].day;
    for (let i = 1; i < filled.length; i++) {
      if (filled[i].day !== lastDay + 1) break;
      series.push(filled[i].remaining as number);
      lastDay = filled[i].day;
    }
    return { series, lastDay };
  }, [sortedEntries]);

  // Bayesian forecast for the days remaining in the sprint after the last
  // contiguously-logged day. Returns [] when the series is too short (n<2
  // means we can't fit a slope) — that disables the band cleanly.
  const forecast = useMemo(() => {
    if (contiguous.series.length < 2) return [];
    const horizon = Math.max(1, config.sprintDays - contiguous.lastDay);
    return forecastBayesianHolt(contiguous.series, horizon);
  }, [contiguous, config.sprintDays]);

  // Map forecast horizon-index → sprint-day so we can merge into chartData
  // without scanning twice.
  const forecastByDay = useMemo(() => {
    const m = new Map<number, (typeof forecast)[number]>();
    forecast.forEach((fp, i) => {
      m.set(contiguous.lastDay + i + 1, fp);
    });
    return m;
  }, [forecast, contiguous.lastDay]);

  // CUSUM regime-shift detection on the remaining-points series. cusum() is
  // a no-op when n<4 so this stays safe with sparse mid-sprint logs.
  const changepoints = useMemo(() => {
    if (remainingSeries.length < 4) return [];
    return cusum(remainingSeries);
  }, [remainingSeries]);

  // Map changepoint-index (within the dense filled series) → sprint-day so
  // CausalLine can render at the right x-axis position. Filtered to the
  // chart's actual x-domain (0..sprintDays) so off-chart annotations don't
  // distort the axis via `ifOverflow="extendDomain"`.
  const changepointDays = useMemo(() => {
    if (changepoints.length === 0) return [] as Array<{ day: number; direction: "up" | "down" }>;
    const filledDays = sortedEntries
      .filter((e) => e.remaining !== null && Number.isFinite(e.remaining))
      .map((e) => e.day);
    return changepoints
      .map((cp) => ({ day: filledDays[cp.index], direction: cp.direction }))
      .filter(
        (x): x is { day: number; direction: "up" | "down" } =>
          Number.isFinite(x.day) && x.day >= 0 && x.day <= config.sprintDays
      );
  }, [changepoints, sortedEntries, config.sprintDays]);

  const chartData = useMemo(() => {
    const map = new Map<number, DayEntry>();
    sortedEntries.forEach((e) => map.set(e.day, e));

    return Array.from({ length: config.sprintDays + 1 }, (_, day) => {
      const entry = map.get(day);
      const fc = forecastByDay.get(day);
      return {
        day,
        ideal: parseFloat(getIdealValue(day, config.totalPoints, config.sprintDays).toFixed(1)),
        actual: entry?.remaining ?? null,
        forecast: fc ? parseFloat(fc.yHat.toFixed(1)) : undefined,
        // Clamp the lower band at 0 — negative remaining-points is meaningless
        // for the y-axis and would expand the chart domain unnecessarily.
        band80Lower: fc ? parseFloat(Math.max(0, fc.lower80).toFixed(1)) : undefined,
        band80Upper: fc ? parseFloat(Math.max(0, fc.upper80).toFixed(1)) : undefined,
        scopeChange: entry?.scopeChange ?? false,
        description: entry?.description ?? "",
      };
    });
  }, [sortedEntries, config, forecastByDay]);

  const todayDay = useMemo(
    () => computeTodayDay(config.sprintStartDate, config.sprintDays),
    [config.sprintStartDate, config.sprintDays]
  );

  /* -- Summary stats ------------------------------------------------------- */

  const stats = useMemo(() => {
    // Last filled actual entry
    const filledEntries = sortedEntries.filter((e) => e.remaining !== null);
    // Day 0 comes pre-filled with the sprint scope, so a single point is only
    // the starting line. Until a second day is logged there's no trend to
    // report — the KPIs show "no data" rather than "On track" / 0%.
    if (filledEntries.length < 2) {
      return {
        hasData: false,
        variance: 0,
        trend: "neutral" as const,
        completionRate: 0,
        lastDay: 0,
      };
    }
    const last = filledEntries[filledEntries.length - 1];
    const idealAtLastDay = getIdealValue(last.day, config.totalPoints, config.sprintDays);
    const variance = parseFloat((idealAtLastDay - (last.remaining ?? 0)).toFixed(1));
    const trend = variance > 0.5 ? "ahead" : variance < -0.5 ? "behind" : "neutral";
    const completed = config.totalPoints - (last.remaining ?? config.totalPoints);
    // BUG-T1-burndown-1: zero-guard before division. The Input has min={1}
    // but a corrupted persisted state or hand-edited JSON can land 0 here,
    // which would render "Infinity%" in the KPI tile. Clamped to 0..100:
    // remaining can legitimately exceed totalPoints after a mid-sprint scope
    // add, which would otherwise show a negative completion rate.
    const completionRate =
      config.totalPoints > 0
        ? Math.max(0, Math.min(100, Math.round((completed / config.totalPoints) * 100)))
        : 0;
    return { hasData: true, variance, trend, completionRate, lastDay: last.day };
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

  const promptConfig = useMemo(
    () => ({
      toolName: "Burndown Chart",
      prompts: generateBurndownPrompts({ config, entries }),
    }),
    [config, entries]
  );

  /* -- Trend icon ---------------------------------------------------------- */

  const TrendIcon =
    stats.trend === "ahead" ? TrendingDown : stats.trend === "behind" ? TrendingUp : Minus;
  const trendColor =
    stats.trend === "ahead" ? "#00ff88" : stats.trend === "behind" ? "#ef4444" : "#94a3b8";
  const trendLabel = !stats.hasData
    ? "No data yet"
    : stats.trend === "ahead"
      ? "Ahead of ideal"
      : stats.trend === "behind"
        ? "Behind ideal"
        : "On track";

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
          <StatCard label="Total Points" value={config.totalPoints} unit="pts" icon={BarChart3} />
          <StatCard
            label="Variance from Ideal"
            value={
              !stats.hasData ? "—" : stats.variance > 0 ? `+${stats.variance}` : stats.variance
            }
            unit={stats.hasData ? "pts" : undefined}
            icon={TrendIcon}
            color={trendColor}
          />
          <StatCard
            label="Completion Rate"
            value={stats.hasData ? stats.completionRate : "—"}
            unit={stats.hasData ? "%" : undefined}
            icon={TrendingDown}
            color="#00f0ff"
          />
          <StatCard label="Trend" value={trendLabel} icon={TrendIcon} color={trendColor} />
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
              <Label htmlFor="burndown-total-points" className="text-sub text-xs">
                Total Story Points
              </Label>
              {/* SmartInput-wrapped so the user can Tab-accept the
                  velocity-forecast suggestion. The field still commits on
                  every change (we don't gate the manual flow). */}
              <SmartInput<number>
                predicted={totalPointsPrediction}
                onAccept={(v) => {
                  setTotalPointsDraft(null);
                  updateConfig({ totalPoints: Math.max(1, Math.round(v)) });
                }}
                render={({ ghost, accept, chip }) => (
                  <>
                    <Input
                      id="burndown-total-points"
                      type="number"
                      min={1}
                      value={totalPointsDraft ?? config.totalPoints}
                      placeholder={ghost}
                      onKeyDown={(e) => {
                        // Tab-to-accept only while the field is cleared (the
                        // ghost suggestion is visible) — avoids stomping on
                        // a value the user typed.
                        if (e.key === "Tab" && totalPointsDraft === "") {
                          e.preventDefault();
                          accept();
                        }
                      }}
                      // Keystrokes stay in the draft buffer; commit once on
                      // blur so the audit log doesn't fire CONFIG_UPDATED for
                      // every keystroke ("1", "12", "123").
                      onChange={(e) => setTotalPointsDraft(e.target.value)}
                      onBlur={() => {
                        if (totalPointsDraft === null) return;
                        const n = Number(totalPointsDraft);
                        setTotalPointsDraft(null);
                        if (totalPointsDraft.trim() === "" || !Number.isFinite(n)) return;
                        updateConfig({ totalPoints: Math.max(1, Math.round(n)) });
                      }}
                      className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
                      aria-label="Total story points for the sprint"
                    />
                    {chip}
                  </>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="burndown-sprint-days" className="text-sub text-xs">
                Sprint Length (days)
              </Label>
              <Input
                id="burndown-sprint-days"
                type="number"
                min={1}
                max={60}
                value={sprintDaysDraft ?? config.sprintDays}
                // Draft-buffered: committing mid-type resizes `entries` and
                // drops days past the transient value (see draft state above).
                onChange={(e) => setSprintDaysDraft(e.target.value)}
                onBlur={() => {
                  if (sprintDaysDraft === null) return;
                  const n = Number(sprintDaysDraft);
                  setSprintDaysDraft(null);
                  if (sprintDaysDraft.trim() === "" || !Number.isFinite(n)) return;
                  updateConfig({ sprintDays: Math.max(1, Math.min(60, Math.round(n))) });
                }}
                className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="burndown-start-date" className="text-sub text-xs">
                Sprint Start Date
              </Label>
              <Input
                id="burndown-start-date"
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
              <ExportButton filename="burndown-chart" csvData={csvData} targetRef={chartRef} />
            </>
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

            {/* Bayesian 80% forecast band — drawn first so the actual/ideal
                lines render on top. The lower-mask Area uses var(--bg) at
                fillOpacity 1 to clip the upper Area down to a true band
                rather than a solid wedge from 0. */}
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

            {/* Forecast centre-line (dashed) — only renders when the band
                Area has data, so behaves cleanly with sparse mid-sprint logs. */}
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

            {/* CUSUM regime-shift markers on the days where the remaining
                burn-rate flipped. Skipped silently if no shifts found. */}
            {changepointDays.map((cp, i) => (
              <CausalLine
                key={`cusum-${cp.day}-${cp.direction}-${i}`}
                annotation={{
                  x: cp.day,
                  label: `Burn-rate shift ${cp.direction}`,
                  detail: `CUSUM detected a ${cp.direction === "up" ? "spike (work piling back up)" : "drop (faster burn)"} in remaining points around day ${cp.day}.`,
                  confidence: "moderate",
                }}
              />
            ))}
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
                onClick={() => (loggedDays > 0 ? setConfirmResetOpen(true) : reset())}
              >
                Reset
              </Button>
              <Button size="sm" variant="toolkit" onClick={addEntry} className="gap-1.5">
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
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Day</span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Remaining Points
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Note</span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider flex items-center gap-1">
              <Flag className="w-3 h-3" /> Scope Change
            </span>
            <span className="w-9" />
          </div>

          <div className="space-y-2">
            {sortedEntries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[80px_1fr_1.2fr_120px_auto] gap-2 sm:gap-3 sm:items-center rounded-md border border-border sm:border-0 p-2 sm:p-0"
              >
                {/* Day label + trash form a header row on mobile */}
                <div className="flex items-center sm:contents">
                  <span className="font-data text-sm font-semibold text-accent">
                    Day {entry.day}
                  </span>
                </div>

                <Button
                  variant="danger-ghost"
                  size="icon"
                  onClick={() => removeEntry(entry.id)}
                  disabled={sortedEntries.length <= 1}
                  className="min-touch-coarse h-9 w-9 disabled:opacity-30 justify-self-end sm:order-last"
                  aria-label={`Remove day ${entry.day}`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </Button>

                <Input
                  type="number"
                  min={0}
                  placeholder="— pts"
                  aria-label={`Remaining points on day ${entry.day}`}
                  value={entry.remaining ?? ""}
                  onChange={(e) =>
                    updateEntry(entry.id, {
                      remaining: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="col-span-2 sm:col-span-1 bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
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
                  className="col-span-2 sm:col-span-1 bg-surface-deep border-border text-text text-xs focus:border-accent/50 focus:ring-accent/20"
                  aria-label={`Note for day ${entry.day}`}
                />

                <button
                  onClick={() => toggleScopeChange(entry.id)}
                  className={`col-span-2 sm:col-span-1 h-9 px-3 rounded-md text-xs font-medium border transition-colors ${
                    entry.scopeChange
                      ? "bg-accent-amber/15 border-accent-amber/40 text-accent-amber"
                      : "bg-card border-border text-sub hover:border-accent-amber/30 hover:text-accent-amber"
                  }`}
                >
                  {entry.scopeChange ? "Scope Changed" : "Mark Change"}
                  <span className="sr-only"> on day {entry.day}</span>
                </button>
              </div>
            ))}
          </div>

          {/* Hint */}
          <p className="mt-4 text-xs text-sub">
            Tip: Leave &quot;Remaining Points&quot; blank for days not yet reached. Day 0 is the
            sprint start.
          </p>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title="Reset the burndown?"
        description={`The ${loggedDays} logged day${loggedDays === 1 ? " is" : "s are"} cleared, and the sprint goes back to ${makeDefaultConfig().totalPoints} points over ${makeDefaultConfig().sprintDays} days, starting today.`}
        confirmLabel="Reset burndown"
        onConfirm={reset}
      />
    </ToolPageWrapper>
  );
}
