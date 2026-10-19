"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import dynamic from "next/dynamic";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ChartCard } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { SmartInput } from "@/components/shared/smart-input";
import { chartTheme } from "@/components/charts/chart-theme";
import { generateVelocityPrompts } from "@/lib/ai-prompts/velocity";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VELOCITY_ACTIONS } from "@/lib/history/event-actions";
import { withTimeTravel } from "@/lib/stores/with-time-travel";
import { undoable } from "@/lib/utils/undoable";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { mannKendall } from "@/lib/analytics/trend-test";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import {
  ExampleNotice,
  LoadExampleButton,
  exampleId,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Plus, Trash2, Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { buildExampleSprints } from "./example";
import { toMarkdown } from "./markdown";
import { changepointMarkers as buildChangepointMarkers } from "./changepoints";

// Recharts loads with the chart, not the page; ChartCard's fixed-height box
// reserves the space while it does.
const VelocityChart = dynamic(() => import("./charts").then((m) => m.VelocityChart), {
  ssr: false,
});

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

// The default rows are the example sprints (./example). Their ids are
// deterministic so server-rendered HTML matches client-rendered HTML at
// hydration time. Calling `crypto.randomUUID()` at module load produced
// distinct values on server vs client and triggered React's
// hydration-mismatch warning on every fresh visit.
//
// User-added sprints still get proper UUIDs (see `createSprint`); the
// example ids only live until the user clears, deletes or resets them.
const buildDefaultSprints: () => Sprint[] = buildExampleSprints;

// Rows saved before the example ids existed carry `default:sprint-N`.
const LEGACY_SEED_PREFIX = "default:";

// A row still carrying the exact demo-seed values (and no description) is
// presentation-only: it must never be bridged into the workspace store as
// real velocity history. Editing any field makes it "real". Matching by
// value (not just the id prefix) means an edited seed row IS bridged —
// updateSprint keeps the original id.
function isUntouchedSeedSprint(s: Sprint): boolean {
  const id = s.id.startsWith(LEGACY_SEED_PREFIX)
    ? exampleId(s.id.slice(LEGACY_SEED_PREFIX.length))
    : s.id;
  return buildDefaultSprints().some(
    (d) =>
      d.id === id &&
      d.name === s.name &&
      d.committed === s.committed &&
      d.completed === s.completed &&
      !s.description
  );
}

function createSprint(existing: Sprint[]): Sprint {
  // Pick the first unused integer suffix so deleting "Sprint 2" then adding
  // a new one doesn't produce "Sprint 4" — the user expects gaps to fill.
  const used = new Set(
    existing.map((s) => parseInt(String(s.name).replace(/\D/g, ""), 10)).filter(Number.isFinite)
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
    withTimeTravel<VelocityStore>({ toolId: "velocity" }, (set) => ({
      sprints: buildDefaultSprints(),

      addSprint: () => set((s) => ({ sprints: [...s.sprints, createSprint(s.sprints)] })),

      removeSprint: (id) => set((s) => ({ sprints: s.sprints.filter((sp) => sp.id !== id) })),

      updateSprint: (id, updates) =>
        set((s) => ({
          sprints: s.sprints.map((sp) => (sp.id === id ? { ...sp, ...updates } : sp)),
        })),

      // Re-build defaults on each reset so we mint fresh ids — never reuse
      // the originals, otherwise sprint identity would alias old data.
      reset: () => set({ sprints: buildDefaultSprints() }),
    })),
    {
      name: "agile-toolkit:velocity",
      storage: safeJSONStorage("velocity"),
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
/*  Undo                                                                      */
/* -------------------------------------------------------------------------- */

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// The toast's Undo writes with `setState`, which goes around withTimeTravel's
// wrapped `set`, so restoring is not a new time-travel step. The delete is
// one, and the two can't fight: Ctrl+Z after a toast Undo lands on the
// pre-delete snapshot, which already has the sprint (nothing visibly
// changes), and a toast Undo after Ctrl+Z finds the sprint already back and
// does nothing. Either order leaves exactly one copy. The workspace bridge
// subscribes to the store, so a restored sprint is re-bridged too.
function restoreSprint(sprint: Sprint, index: number) {
  const { sprints } = useVelocityStore.getState();
  if (sprints.some((s) => s.id === sprint.id)) return;
  const next = [...sprints];
  next.splice(Math.min(index, next.length), 0, sprint);
  useVelocityStore.setState({ sprints: next });
}

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
  // BUG-T9-velocity-1: fit against (originalIndex, value) pairs, NOT
  // against a collapsed `valid` array. The prior code computed slope
  // over xs=[0..valid.length-1] and then projected back across the
  // ORIGINAL indices — off-by-one for every gap. With values=[10,
  // NaN, 12, 14], slope was fit on (0,10)/(1,12)/(2,14) but projected
  // at i=0,1,2,3, so the trend at position 3 was a 4th-step
  // extrapolation when only 3 data points existed.
  const pairs: Array<[number, number]> = [];
  values.forEach((v, i) => {
    if (Number.isFinite(v)) pairs.push([i, v]);
  });
  const n = pairs.length;
  if (n < 2) {
    const fallback = n === 1 ? pairs[0][1] : 0;
    return values.map(() => fallback);
  }
  const xMean = pairs.reduce((a, [x]) => a + x, 0) / n;
  const yMean = pairs.reduce((a, [, y]) => a + y, 0) / n;
  const ssXX = pairs.reduce((s, [x]) => s + (x - xMean) ** 2, 0);
  const ssXY = pairs.reduce((s, [x, y]) => s + (x - xMean) * (y - yMean), 0);
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = yMean - slope * xMean;
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
  "aria-label": ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  /** Optional hook fired alongside the commit, useful for history logging. */
  onCommitBlur?: (n: number) => void;
  /** Row cells have no visible label on wide screens: name field and row. */
  "aria-label"?: string;
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
      aria-label={ariaLabel}
    />
  );
}

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

  // R10-deferred: dual-store bridge. Velocity's local persisted store is
  // its source of truth, but cross-tool consumers (capacity-planner,
  // anti-pattern detectors, signal-bridge, dashboards) read from
  // `useWorkspaceStore.sprints`. Without this bridge:
  //   - signal-bridge never fires `sprint.completed` / `velocity.changed`
  //   - capacity-planner's velocity history is permanently empty
  //   - anti-pattern detector ignores velocity drops
  //
  // Strategy: on every velocity-store change, diff against the
  // workspace and upsert/remove to converge. We skip empty rows
  // (committed 0 AND completed 0) and rows still carrying the exact
  // demo-seed values — the seed (34/28, 30/32, 36/35) is
  // presentation-only and must not become fake completed-sprint
  // history for predictions, dashboards, and AI context.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // R11-fix: track ids the bridge has ever upserted. The previous
    // heuristic `ws.id.startsWith("spr_")` was dead code — velocity ids
    // come from `crypto.randomUUID()` (buildDefaultSprints + createSprint)
    // which never produce a "spr_" prefix, so the removal branch never
    // fired and workspace.sprints accumulated zombies forever.
    // BUG-T9-velocity-2: hoist ownedIds onto window so it survives
    // React 18 StrictMode's double-mount. Without this, the second
    // mount starts with an empty ownedIds and never re-claims the
    // ones the first mount upserted, leaving deletions un-propagated
    // to workspace.sprints (zombies in dev that don't reproduce in prod).
    type WindowWithBridge = Window & { __velocityBridgeOwnedIds?: Set<string> };
    const w = window as WindowWithBridge;
    if (!w.__velocityBridgeOwnedIds) {
      w.__velocityBridgeOwnedIds = new Set<string>();
    }
    const ownedIds = w.__velocityBridgeOwnedIds;
    const sync = (snapshot: typeof sprints) => {
      const workspace = useWorkspaceStore.getState();
      const wsSprints = workspace.sprints ?? [];
      const wsById = new Map(wsSprints.map((s) => [s.id, s]));
      const localById = new Map(snapshot.map((s) => [s.id, s]));
      // Upsert active velocity rows into workspace.
      // R11-fix: emit synthetic monotonic startDate so workspace-store's
      // `selectCompletedSprints` sort (uses `new Date(startDate).getTime()`)
      // doesn't NaN-poison when velocity has no real calendar dates.
      // Anchor at 2020-01-01 + index days; stable across renders.
      const SYNTH_EPOCH_MS = Date.UTC(2020, 0, 1);
      snapshot.forEach((local, index) => {
        if ((local.committed === 0 && local.completed === 0) || isUntouchedSeedSprint(local)) {
          // Even un-upserted local sprints are claimed as "ours" so a
          // later removal doesn't see them as foreign rows. If an earlier
          // session already bridged this row (seed edited, then reset — the
          // id is reused), drop the stale workspace copy: these ids belong
          // to the velocity bridge, nothing else writes them.
          ownedIds.add(local.id);
          if (wsById.has(local.id)) {
            ownedIds.delete(local.id);
            workspace.removeSprint(local.id);
          }
          return;
        }
        const existing = wsById.get(local.id);
        const status: "active" | "completed" | "planned" =
          local.completed > 0 ? "completed" : "planned";
        const syntheticStart = new Date(SYNTH_EPOCH_MS + index * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const next = {
          id: local.id,
          name: local.name,
          startDate: existing?.startDate || syntheticStart,
          endDate: existing?.endDate ?? "",
          goal: existing?.goal ?? local.description,
          pointsPlanned: local.committed,
          pointsCompleted: local.completed,
          status,
        } as const;
        ownedIds.add(local.id);
        // Skip the upsert when nothing meaningful has changed — avoids
        // an infinite subscribe → diff → setState → subscribe loop.
        if (
          existing &&
          existing.name === next.name &&
          existing.startDate === next.startDate &&
          existing.pointsPlanned === next.pointsPlanned &&
          existing.pointsCompleted === next.pointsCompleted &&
          existing.status === next.status
        )
          return;
        workspace.upsertSprint(next);
      });
      // Remove workspace sprints WE previously pushed but the user has
      // since deleted from the velocity tool. Only touch ids we've
      // owned at some point (closure-scoped Set above), never trample
      // sprints written by other tools / imports.
      for (const ws of wsSprints) {
        if (!localById.has(ws.id) && ownedIds.has(ws.id)) {
          ownedIds.delete(ws.id);
          workspace.removeSprint(ws.id);
        }
      }
    };
    // Initial sync.
    sync(sprints);
    // Subscribe for future writes.
    const unsub = useVelocityStore.subscribe((state) => sync(state.sprints));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addSprint = () => {
    addSprintRaw();
    const next = useVelocityStore.getState().sprints;
    // Guard the post-add read: if the store rejected the addRaw call
    // (middleware veto, time-travel undo race), next.length-1 indexes
    // into an unchanged array and `created` is whatever was previously
    // last — or undefined on first ever call. Either way the
    // crash-on-undefined was real.
    const created = next[next.length - 1];
    if (!created) return;
    log(VELOCITY_ACTIONS.SPRINT_ADDED, {
      sprintId: created.id,
      name: created.name,
    });
  };

  const removeSprint = (id: string) => {
    const index = sprints.findIndex((s) => s.id === id);
    const sprint = sprints[index];
    if (!sprint) return;
    undoable({
      label: sprint.name.trim() ? `Removed “${shortName(sprint.name)}”` : "Removed a sprint",
      apply: () => {
        removeSprintRaw(id);
        log(VELOCITY_ACTIONS.SPRINT_REMOVED, {
          sprintId: id,
          name: sprint.name,
        });
      },
      revert: () => restoreSprint(sprint, index),
    });
  };

  const reset = () => {
    const prevSprints = useVelocityStore.getState().sprints;
    undoable({
      label: "Reset velocity data",
      apply: () => {
        resetRaw();
        log(VELOCITY_ACTIONS.VELOCITY_RESET, {});
      },
      // Same `setState` route as restoreSprint, and the same ref the
      // time-travel snapshot holds, so Ctrl+Z and Undo agree.
      revert: () => useVelocityStore.setState({ sprints: prevSprints }),
    });
  };
  // Reset replaces every row with the example sprints, so it asks first,
  // unless there are none or the rows are still exactly those examples.
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const isExampleData =
    sprints.length === 0 ||
    (sprints.length === buildDefaultSprints().length && sprints.every(isUntouchedSeedSprint));

  // Loading is Reset's write, offered only when there are no sprints to
  // replace. Neither is logged: the example isn't the user's own work.
  const loadExample = () => resetRaw();
  const clearExample = () => {
    const prevSprints = useVelocityStore.getState().sprints;
    undoable({
      label: "Cleared the example",
      // Same `setState` route as restoreSprint; the bridge drops the rows
      // from the workspace too.
      apply: () =>
        useVelocityStore.setState({
          sprints: useVelocityStore.getState().sprints.filter((s) => !isExampleId(s.id)),
        }),
      revert: () => useVelocityStore.setState({ sprints: prevSprints }),
    });
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

  // Only sprints that actually finished feed the analytics. A "Plan next
  // sprint" row is committed-only (completed: 0) — including it dragged the
  // average/std-dev/forecast/trend toward zero the moment a sprint was
  // planned. Matches the workspace bridge's status mapping above
  // (completed > 0 ? "completed" : "planned").
  const finishedSprints = useMemo(() => sprints.filter((s) => s.completed > 0), [sprints]);

  const completedSeries = useMemo(() => finishedSprints.map((s) => s.completed), [finishedSprints]);

  // Bayesian forecast for the NEXT sprint. Wrapped in useMemo so we don't
  // re-allocate on unrelated re-renders. Returns [] when the series is empty,
  // which makes the Area renders as nothing — safe fallback.
  const forecast = useMemo(() => {
    if (completedSeries.length < 2) return [];
    return forecastBayesianHolt(completedSeries, 1);
  }, [completedSeries]);

  // CUSUM regime-shift markers on completed velocity, anchored to the
  // affected sprint's name. CUSUM runs on the finished series, so its indexes
  // are looked up in finishedSprints, not the full list (planned rows would
  // shift every marker). Empty below 4 finished sprints.
  const changepointMarkers = useMemo(
    () => buildChangepointMarkers(finishedSprints),
    [finishedSprints]
  );

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

    // rolling/trendLine are indexed over the FINISHED series — map each
    // sprint row back through its finished-index (planned/empty rows get no
    // rolling-average or trend point).
    const finishedIndexById = new Map(finishedSprints.map((s, i) => [s.id, i]));
    const data: Row[] = sprints.map((sp) => {
      const fi = finishedIndexById.get(sp.id);
      return {
        name: sp.name,
        committed: sp.committed,
        completed: sp.completed,
        rollingAvg: fi !== undefined && rolling[fi] !== null ? round(rolling[fi]!, 1) : undefined,
        trend: fi !== undefined ? round(trendLine[fi], 1) : undefined,
      };
    });

    // Append a synthetic "next" row carrying the Bayesian forecast band so
    // Recharts has a single dataset to draw from. Lower-bound is clamped at 0
    // — negative velocity is meaningless for the chart axis.
    if (forecast.length > 0 && data.length > 0) {
      const fc = forecast[0];
      // Bridge the band onto the last FINISHED point so the area starts where
      // history ends rather than floating in mid-air — a trailing planned row
      // (completed 0) is not part of the forecast series.
      let anchorIdx = -1;
      for (let i = sprints.length - 1; i >= 0; i--) {
        if (sprints[i].completed > 0) {
          anchorIdx = i;
          break;
        }
      }
      if (anchorIdx >= 0) {
        const last = data[anchorIdx];
        data[anchorIdx] = {
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
    }

    const n = completedValues.length;
    const avgVelocity = n > 0 ? completedValues.reduce((a, b) => a + b, 0) / n : 0;
    // R11-fix: skip empty rows in predictability. Previously a fresh
    // sprint row with `committed: 0, completed: 0` satisfied `0 >= 0`
    // and counted toward predictability. Planned rows (committed > 0,
    // completed 0) are likewise excluded — they haven't run yet, so they
    // can't have "missed" their commitment.
    const completedSprints = sprints.filter((s) => s.completed > 0);
    const predictable = completedSprints.filter((s) => s.completed >= s.committed).length;
    const predictability =
      completedSprints.length > 0 ? (predictable / completedSprints.length) * 100 : 0;
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
  }, [sprints, finishedSprints, completedSeries, forecast]);

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Sprint", "Description", "Committed", "Completed"],
      rows: sprints.map((s) => [s.name, s.description ?? "", s.committed, s.completed]),
    }),
    [sprints]
  );

  const markdown = useMemo(() => toMarkdown(sprints), [sprints]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Velocity Tracker",
      prompts: generateVelocityPrompts({ sprints, stats }),
    }),
    [sprints, stats]
  );

  /* -- Trend icon ---------------------------------------------------------- */

  const TrendIcon =
    stats.trendDir === "up" ? TrendingUp : stats.trendDir === "down" ? TrendingDown : Minus;

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
      {hasExampleItems(sprints) && <ExampleNotice onClear={clearExample} />}
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
                markdown={markdown}
                targetRef={exportRef}
              />
            </>
          }
        >
          <VelocityChart data={chartData} markers={changepointMarkers} />
        </ChartCard>

        {/* ---- Mann-Kendall trend chip ----
            Only renders when the test has enough samples (n>=5) AND the trend
            is statistically significant at α=0.05. Tone-coded so a
            significant-up shows as accent ("good"), significant-down as
            destructive ("alert worth investigating"). */}
        {trendTest?.significant && (
          <div className="flex items-center justify-end -mt-2">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border ${
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
                if (!created) return;
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
                onClick={() => (isExampleData ? reset() : setConfirmResetOpen(true))}
              >
                Reset
              </Button>
              <Button size="sm" variant="toolkit" onClick={addSprint} className="gap-1.5">
                <Plus className="w-4 h-4" />
                Add Sprint
              </Button>
            </>
          }
        >
          {/* Header row */}
          <div className="hidden sm:grid grid-cols-[1fr_0.6fr_0.6fr_auto] gap-3 px-1 pb-2 border-b border-border">
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Sprint Name
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Committed</span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Completed</span>
            <span className="w-9" />
          </div>

          {sprints.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-6 text-center text-sm text-sub">
              <p>
                No sprints yet. Add each finished sprint with its committed and completed points.
              </p>
              <LoadExampleButton onLoad={loadExample} />
            </div>
          )}

          {sprints.map((sp) => (
            <div
              key={sp.id}
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_0.6fr_0.6fr_auto] gap-2 sm:gap-3 sm:items-center rounded-md border border-border sm:border-0 p-2 sm:p-0"
            >
              {/* Single-line Input chosen over Textarea here — sprint rows are
                  in a tight 4-column data grid, so a multi-line description
                  would break the row height alignment. Empty trims to undefined. */}
              <div className="space-y-1">
                <BlurInput
                  value={sp.name}
                  onCommit={(v) => {
                    updateSprint(sp.id, { name: v });
                    logSprintCommit(sp.id, "name", v);
                  }}
                  className="input-toolkit focus:ring-accent/20"
                  aria-label="Sprint name"
                />
                <BlurInput
                  value={sp.description ?? ""}
                  onCommit={(v) => updateSprint(sp.id, { description: v.trim() ? v : undefined })}
                  placeholder="Description (optional)..."
                  className="input-toolkit text-xs h-7"
                  aria-label={`Description for ${sp.name}`}
                />
              </div>
              <Button
                variant="danger-ghost"
                size="icon"
                disabled={sprints.length <= 1}
                onClick={() => removeSprint(sp.id)}
                className="min-touch-coarse h-9 w-9 disabled:opacity-30 justify-self-end sm:order-last"
                aria-label={`Remove ${sp.name || "sprint"}`}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
              <div className="col-span-2 sm:col-span-1 space-y-1">
                <span className="sm:hidden text-xs text-sub font-medium uppercase tracking-wider">
                  Committed
                </span>
                <NumCell
                  value={sp.committed}
                  onCommit={(n) => updateSprint(sp.id, { committed: n })}
                  onCommitBlur={(n) => logSprintCommit(sp.id, "committed", n)}
                  min={0}
                  aria-label={`Committed points for ${sp.name || "sprint"}`}
                  className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
                />
              </div>
              <div className="col-span-2 sm:col-span-1 space-y-1">
                <span className="sm:hidden text-xs text-sub font-medium uppercase tracking-wider">
                  Completed
                </span>
                <NumCell
                  value={sp.completed}
                  onCommit={(n) => updateSprint(sp.id, { completed: n })}
                  onCommitBlur={(n) => logSprintCommit(sp.id, "completed", n)}
                  min={0}
                  aria-label={`Completed points for ${sp.name || "sprint"}`}
                  className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
                />
              </div>
            </div>
          ))}

          {/* Predictability note */}
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="text-sm text-sub">
              Sprints meeting commitment:{" "}
              <span className="text-accent font-data font-semibold">
                {/* Use the SAME predicate as the predictability KPI —
                    `completed > 0`, i.e. sprints that actually ran. The old
                    `committed > 0 || completed > 0` denominator also counted
                    PLANNED sprints, which by definition cannot have met a
                    commitment yet, so committing a next sprint rendered
                    "1 / 2" directly beside "100% predictable". */}
                {sprints.filter((s) => s.completed > 0 && s.completed >= s.committed).length}
              </span>{" "}
              / {sprints.filter((s) => s.completed > 0).length}
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-data font-bold text-accent">
                {round(stats.predictability, 0)}%
              </span>
              <span className="text-sm text-sub">predictable</span>
            </div>
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title="Reset velocity data?"
        description={`All ${sprints.length} sprint${sprints.length === 1 ? "" : "s"} are replaced with the ${buildDefaultSprints().length} example sprints.`}
        confirmLabel="Reset sprints"
        onConfirm={reset}
      />
    </ToolPageWrapper>
  );
}
