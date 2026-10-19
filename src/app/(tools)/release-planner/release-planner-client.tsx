"use client";

import { useCallback, useId, useMemo, useRef } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  selectActiveSprint,
  selectCompletedSprints,
  useWorkspaceStore,
} from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateReleasePlannerPrompts } from "@/lib/ai-prompts/release-planner";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RELEASE_PLANNER_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { TrendingUp, Calendar, BarChart3, Settings2, RefreshCw } from "lucide-react";
import { addDays, format } from "date-fns";
import { simulateThroughputCompletion } from "@/lib/analytics/monte-carlo";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { hasRecentChangepoint } from "@/lib/analytics/changepoint";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { SmartInput } from "@/components/shared/smart-input";
import {
  DEFAULT_VELOCITY_INPUT,
  effectiveStartDate,
  parseVelocities,
  resolveVelocitySource,
  sprintVelocities,
  type VelocitySource,
} from "./velocity-source";
import { simulationHistogramText } from "./chart-text";

// Recharts loads with the chart, not the page; the placeholder holds the
// chart's 350px height while it does.
const SimulationHistogramChart = dynamic(
  () => import("./charts").then((m) => m.SimulationHistogramChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[350px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
    ),
  }
);

/* -------------------------------------------------------------------------- */
/*  Types                                                                       */
/* -------------------------------------------------------------------------- */

interface ReleasePlannerConfig {
  backlogSize: number;
  velocityInput: string;
  scopeBuffer: number;
  sprintLengthDays: number;
  /**
   * First day to plan from (YYYY-MM-DD). Empty = not set: the day after the
   * active sprint ends, else today.
   */
  startDate: string;
  scopeAdjustment: number; // -50 to +50
  /**
   * Optional user-pinned target — number of sprints they're aiming for.
   * Empty string = unset; the SmartInput prediction surfaces a Tab-to-accept
   * default sourced from the Bayesian forecast over completed sprints.
   */
  sprintsToReleaseTarget: string;
  /**
   * Where velocities come from: the typed list ("manual") or the completed
   * shared sprints ("sprints"). Unset until the user picks one (configs saved
   * before it existed don't have it): see `resolveVelocitySource`.
   */
  velocitySource?: VelocitySource;
}

interface ReleasePlannerStore {
  config: ReleasePlannerConfig;
  updateConfig: (updates: Partial<ReleasePlannerConfig>) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Defaults                                                                   */
/* -------------------------------------------------------------------------- */

// The start date is left unset, so it follows the active sprint (or today)
// each time the page opens until the user picks one. Persisted state
// rehydrates over the top of these defaults.
function makeDefaultConfig(): ReleasePlannerConfig {
  return {
    backlogSize: 120,
    velocityInput: DEFAULT_VELOCITY_INPUT,
    scopeBuffer: 10,
    sprintLengthDays: 14,
    startDate: "",
    scopeAdjustment: 0,
    sprintsToReleaseTarget: "",
  };
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                      */
/* -------------------------------------------------------------------------- */

const useReleasePlannerStore = create<ReleasePlannerStore>()(
  persist(
    (set) => ({
      config: makeDefaultConfig(),

      updateConfig: (updates) => set((s) => ({ config: { ...s.config, ...updates } })),

      reset: () => set({ config: makeDefaultConfig() }),
    }),
    { name: "agile-toolkit:release-planner", storage: safeJSONStorage("release-planner") }
  )
);

/* -------------------------------------------------------------------------- */
/*  Monte Carlo simulation                                                     */
/* -------------------------------------------------------------------------- */

const ITERATIONS = 10_000;

interface SimulationResult {
  histogram: { sprints: number; count: number }[];
  p50: number;
  p75: number;
  p85: number;
  p95: number;
  minSprints: number;
  maxSprints: number;
}

function runSimulation(effectiveBacklog: number, velocities: number[]): SimulationResult {
  if (velocities.length === 0 || effectiveBacklog <= 0) {
    return {
      histogram: [],
      p50: 0,
      p75: 0,
      p85: 0,
      p95: 0,
      minSprints: 0,
      maxSprints: 0,
    };
  }

  const result = simulateThroughputCompletion(effectiveBacklog, velocities, ITERATIONS);
  return {
    histogram: result.histogram.map((h) => ({ sprints: h.value, count: h.count })),
    p50: result.percentiles[50],
    p75: result.percentiles[75],
    p85: result.percentiles[85],
    p95: result.percentiles[95],
    minSprints: result.min,
    maxSprints: result.max,
  };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sprintToDate(startDate: string, sprintCount: number, sprintLengthDays: number): string {
  try {
    // Parse the YYYY-MM-DD string as a local calendar date — `new Date(string)`
    // would interpret it as UTC midnight and shift the displayed date by one
    // day in any timezone west of UTC.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
    if (!m) return "—";
    const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const end = addDays(start, sprintCount * sprintLengthDays);
    return format(end, "MMM d, yyyy");
  } catch {
    return "—";
  }
}

/* -------------------------------------------------------------------------- */
/*  Stat card                                                                  */
/* -------------------------------------------------------------------------- */

function StatCard({
  label,
  value,
  sub,
  color = "#00f0ff",
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon: React.ElementType;
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
        <div className="font-data font-bold text-text text-fluid-h3">{value}</div>
        {sub && <div className="text-xs text-sub mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Input styles                                                               */
/* -------------------------------------------------------------------------- */

const inputCls =
  "bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20";

/* -------------------------------------------------------------------------- */
/*  Main Client Component                                                      */
/* -------------------------------------------------------------------------- */

export function ReleasePlannerClient() {
  const { config, updateConfig: updateConfigRaw, reset: resetRaw } = useReleasePlannerStore();
  const { log } = useHistoryLogger("release-planner");

  // BUG-T7-release-planner-1: split into quiet vs logged variants so
  // slider/keystroke drag doesn't spam one history event per
  // intermediate value. Use `updateConfigQuiet` for `onChange` /
  // slider `onValueChange`; reserve the logged `updateConfig` for
  // commit moments (`onBlur`, slider `onValueCommit`, button click).
  const updateConfigQuiet = useCallback<typeof updateConfigRaw>(
    (updates) => {
      updateConfigRaw(updates);
    },
    [updateConfigRaw]
  );
  const updateConfig = useCallback<typeof updateConfigRaw>(
    (updates) => {
      updateConfigRaw(updates);
      log(RELEASE_PLANNER_ACTIONS.RELEASE_UPDATED, {
        fields: Object.keys(updates),
      });
    },
    [updateConfigRaw, log]
  );
  const reset = useCallback(() => {
    resetRaw();
    log(RELEASE_PLANNER_ACTIONS.RELEASE_RESET, {});
  }, [resetRaw, log]);

  const chartRef = useRef<HTMLDivElement>(null);

  /* -- Velocities: typed, or from the completed shared sprints -------------- */
  const workspaceSprints = useWorkspaceStore((s) => s.sprints);
  const { fromSprints, activeSprint } = useMemo(() => {
    // Both selectors read only `sprints`.
    const ws = { sprints: workspaceSprints ?? [] } as Workspace;
    return {
      fromSprints: sprintVelocities(selectCompletedSprints(ws)),
      activeSprint: selectActiveSprint(ws),
    };
  }, [workspaceSprints]);
  const velocitySource = resolveVelocitySource(config, fromSprints);
  const typedVelocities = useMemo(
    () => parseVelocities(config.velocityInput),
    [config.velocityInput]
  );
  const velocities = velocitySource === "sprints" ? fromSprints : typedVelocities;

  const start = useMemo(
    () => effectiveStartDate(config.startDate, activeSprint),
    [config.startDate, activeSprint]
  );
  const startDate = start.date;
  // What the simulation, the AI prompts and the export actually use.
  const effectiveConfig = useMemo(
    () => ({
      ...config,
      startDate,
      velocityInput: velocitySource === "sprints" ? fromSprints.join(", ") : config.velocityInput,
    }),
    [config, startDate, velocitySource, fromSprints]
  );

  const avgVelocity = useMemo(
    () =>
      velocities.length > 0
        ? parseFloat((velocities.reduce((a, b) => a + b, 0) / velocities.length).toFixed(1))
        : 0,
    [velocities]
  );

  const effectiveBacklog = useMemo(() => {
    const withBuffer = config.backlogSize * (1 + config.scopeBuffer / 100);
    const withAdjustment = withBuffer * (1 + config.scopeAdjustment / 100);
    return Math.max(1, Math.round(withAdjustment));
  }, [config.backlogSize, config.scopeBuffer, config.scopeAdjustment]);

  const sim = useMemo(
    () => runSimulation(effectiveBacklog, velocities),
    [effectiveBacklog, velocities]
  );

  /* -- Bootstrap CI on sprint completion times ----------------------------- */
  // Non-parametric companion to the parametric Monte Carlo. We bootstrap
  // the 0.85 quantile of the *historical velocity* (points-per-sprint) and
  // convert to sprints-to-completion = effectiveBacklog / sampledVelocity.
  // Because the bootstrap statistic must be monotone in the sample, we
  // resample the velocity series and compute the upper quantile, then
  // divide. Returns a sprint count comparable to MC P85.
  const bootstrapResult = useMemo(() => {
    if (velocities.length < 3 || effectiveBacklog <= 0) return null;
    // Bootstrap quantile of velocities at q=0.15 (low-velocity tail). A low
    // velocity means MORE sprints needed — so dividing the backlog by the
    // 15th-percentile velocity gives a P85 sprint count (worst-case 85%).
    const ci = bootstrapQuantile(velocities, 0.15);
    if (ci.point <= 0) return null;
    // The CI's lower/upper map to *velocity*; when we divide backlog by
    // velocity to get sprint count, the bounds invert. Re-label so the
    // result reads as it's used: high velocity → fewer sprints (optimistic)
    // and low velocity → more sprints (pessimistic).
    // Guard against ±Infinity from bootstrapQuantile's degenerate cases
    // (e.g. all-zero velocity series). The prior Math.max(ci.upper, 0.01)
    // returned Infinity unchanged, and Math.ceil(backlog / Infinity) is
    // 0 — rendering as a positive "optimistic = 0 sprints" forecast.
    // Reject the whole result if either bound isn't finite.
    if (!Number.isFinite(ci.point) || !Number.isFinite(ci.upper) || !Number.isFinite(ci.lower)) {
      return null;
    }
    return {
      point: Math.ceil(effectiveBacklog / ci.point),
      optimisticSprints: Math.ceil(effectiveBacklog / Math.max(ci.upper, 0.01)),
      pessimisticSprints: Math.ceil(effectiveBacklog / Math.max(ci.lower, 0.01)),
    };
  }, [velocities, effectiveBacklog]);

  /* -- CUSUM regime-shift detection on the velocity series ------------------ */
  const velocityRegimeShift = useMemo(() => hasRecentChangepoint(velocities, 3), [velocities]);

  /* -- User-pinned target line on the histogram ---------------------------- */
  // Only drawn when the user enters a positive number in the SmartInput field.
  const pinnedTarget = useMemo(() => {
    const t = Number(config.sprintsToReleaseTarget);
    return Number.isFinite(t) && t > 0 ? t : null;
  }, [config.sprintsToReleaseTarget]);

  /* -- SmartInput predicted default for the "sprints to release" target ---- */
  const sprintsToReleasePred = usePredictedDefault<number>(
    "release-planner",
    "sprintsToRelease",
    Math.max(1, sim.p50 || 4)
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Release Planner",
      prompts: generateReleasePlannerPrompts({
        config: effectiveConfig,
        results: sim.p50 > 0 ? { p50: sim.p50, p75: sim.p75, p85: sim.p85, p95: sim.p95 } : null,
      }),
    }),
    [effectiveConfig, sim]
  );

  // The histogram in words: a summary sentence and the bars as a table.
  const histogramText = useMemo(
    () =>
      simulationHistogramText({
        histogram: sim.histogram,
        total: ITERATIONS,
        p50: sim.p50,
        p85: sim.p85,
        p95: sim.p95,
        target: pinnedTarget,
      }),
    [sim, pinnedTarget]
  );
  const histogramTitleId = useId();

  const confidenceRows = useMemo(() => {
    if (sim.p50 === 0) return [];
    return [
      { pct: 50, sprints: sim.p50, color: "#00f0ff" },
      { pct: 75, sprints: sim.p75, color: "#00ff88" },
      { pct: 85, sprints: sim.p85, color: "#ffaa00" },
      { pct: 95, sprints: sim.p95, color: "#ef4444" },
    ].map((row) => ({
      ...row,
      date: sprintToDate(startDate, row.sprints, config.sprintLengthDays),
    }));
  }, [sim, startDate, config.sprintLengthDays]);

  const clipboardText = useMemo(() => {
    if (confidenceRows.length === 0) return undefined;
    const lines = [
      `Release Forecast (Monte Carlo — ${ITERATIONS.toLocaleString()} iterations)`,
      `Backlog: ${config.backlogSize} pts | Buffer: ${config.scopeBuffer}% | Scope adj: ${config.scopeAdjustment > 0 ? "+" : ""}${config.scopeAdjustment}%`,
      `Effective backlog: ${effectiveBacklog} pts | Avg velocity: ${avgVelocity} pts/sprint`,
      `Sprint length: ${config.sprintLengthDays} days | Start: ${startDate}`,
      "",
      "Confidence  Sprints  Target Date",
      ...confidenceRows.map((r) => `${r.pct}%         ${String(r.sprints).padStart(7)}  ${r.date}`),
    ];
    return lines.join("\n");
  }, [confidenceRows, config, startDate, effectiveBacklog, avgVelocity]);

  // BUG-T7-release-planner-1: quiet per-tick during the drag, ONE
  // logged event on release.
  const handleScopeAdjustment = useCallback(
    (val: number[]) => updateConfigQuiet({ scopeAdjustment: val[0] }),
    [updateConfigQuiet]
  );
  const handleScopeAdjustmentCommit = useCallback(
    (val: number[]) => updateConfig({ scopeAdjustment: val[0] }),
    [updateConfig]
  );

  return (
    <ToolPageWrapper
      toolId="release-planner"
      title="Release Planner"
      description="Monte Carlo simulation for release forecasting with confidence intervals and sensitivity analysis."
      category="Sprint Planning & Estimation"
    >
      <div className="space-y-6">
        {/* Actions */}
        <div className="flex items-center justify-between">
          <Button variant="danger-ghost" size="sm" onClick={reset} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Reset
          </Button>
          <div className="flex items-center gap-2">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="release-planner"
              clipboardText={clipboardText}
              targetRef={chartRef}
            />
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Effective Backlog"
            value={`${effectiveBacklog} pts`}
            // Name every input to the number: the backlog, the buffer and,
            // when it's moved, the Scope Sensitivity slider.
            sub={`${config.backlogSize} pts + ${config.scopeBuffer}% buffer${
              config.scopeAdjustment !== 0
                ? `, ${config.scopeAdjustment > 0 ? "+" : ""}${config.scopeAdjustment}% scope adjustment`
                : ""
            }`}
            icon={BarChart3}
            color="#00f0ff"
          />
          <StatCard
            label="Avg Velocity"
            value={`${avgVelocity} pts/sprint`}
            sub={`${velocities.length} data point${velocities.length !== 1 ? "s" : ""}`}
            icon={TrendingUp}
            color="#00ff88"
          />
          <StatCard
            label="50% Confidence"
            value={sim.p50 > 0 ? `${sim.p50} sprints` : "—"}
            sub={
              sim.p50 > 0 ? sprintToDate(startDate, sim.p50, config.sprintLengthDays) : undefined
            }
            icon={Calendar}
            color="#00f0ff"
          />
          <StatCard
            label="85% Confidence"
            // Same shape as the 50% card: sprints, then the date. With 3+
            // velocities a second estimate (resampling the velocities) runs
            // too; it's mentioned only when it disagrees.
            value={sim.p85 > 0 ? `${sim.p85} sprints` : "—"}
            sub={
              sim.p85 > 0
                ? `${sprintToDate(startDate, sim.p85, config.sprintLengthDays)}${
                    bootstrapResult && bootstrapResult.point !== sim.p85
                      ? ` · cross-check: ${bootstrapResult.point} sprints`
                      : ""
                  }`
                : undefined
            }
            icon={Calendar}
            color="#ffaa00"
          />
        </div>

        {/* Recent regime shift advisory — surfaces when CUSUM detects a
            structural change in the velocity series within the last 3
            observations. The Monte Carlo + bootstrap above pull from a
            mixed-regime sample so the projection should be treated as
            suspect until the new regime stabilises. */}
        {velocityRegimeShift && velocities.length >= 5 && (
          <CalloutAlert tone="warning">
            <div>
              <div className="font-semibold mb-0.5 text-text">
                Recent regime shift in velocity detected
              </div>
              <div className="text-sub">
                CUSUM flagged a changepoint in the last few sprints. The projection blends old and
                new regimes — re-fit once the new velocity stabilises, or trim the historical sample
                to the post-shift window.
              </div>
            </div>
          </CalloutAlert>
        )}

        {/* Configuration */}
        <SectionCard title="Configuration" icon={Settings2} titleSize="lg" headerClassName="pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="space-y-1.5">
              <Label htmlFor="rp-backlog" className="text-sub text-xs">
                Backlog Size (story points)
              </Label>
              <Input
                id="rp-backlog"
                type="number"
                min={1}
                value={config.backlogSize}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    updateConfigQuiet({ backlogSize: Math.max(1, n) });
                  }
                }}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    updateConfig({ backlogSize: Math.max(1, n) });
                  }
                }}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-buffer" className="text-sub text-xs">
                Scope Buffer %
              </Label>
              <Input
                id="rp-buffer"
                type="number"
                min={0}
                max={100}
                value={config.scopeBuffer}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    updateConfigQuiet({ scopeBuffer: Math.min(100, Math.max(0, n)) });
                  }
                }}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    updateConfig({ scopeBuffer: Math.min(100, Math.max(0, n)) });
                  }
                }}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-sprint-length" className="text-sub text-xs">
                Sprint Length (days)
              </Label>
              <Input
                id="rp-sprint-length"
                type="number"
                min={1}
                max={90}
                value={config.sprintLengthDays}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    updateConfigQuiet({ sprintLengthDays: Math.min(90, Math.max(1, n)) });
                  }
                }}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    updateConfig({ sprintLengthDays: Math.min(90, Math.max(1, n)) });
                  }
                }}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-start" className="text-sub text-xs">
                Start Date
              </Label>
              <Input
                id="rp-start"
                type="date"
                value={startDate}
                onChange={(e) => updateConfig({ startDate: e.target.value })}
                aria-describedby={start.from === "user" ? undefined : "rp-start-hint"}
                className={inputCls}
              />
              {start.from !== "user" && (
                <p id="rp-start-hint" className="text-xs text-sub">
                  {start.from === "sprint" && activeSprint
                    ? `The day after ${activeSprint.name} ends.`
                    : "Today."}
                </p>
              )}
            </div>
          </div>

          {/* SmartInput — target sprints to release. The user can pin a
                target; the Bayesian forecast suggests a value as a Tab-to-
                accept ghost. When set, the histogram below renders a vertical
                target line so the user can eyeball where their goal sits in
                the simulated distribution. */}
          <div className="mt-5 space-y-1.5">
            <Label htmlFor="rp-target-sprints" className="text-sub text-xs">
              Target sprints to release (optional)
            </Label>
            <SmartInput<number>
              predicted={sprintsToReleasePred}
              onAccept={(v) => updateConfig({ sprintsToReleaseTarget: String(v) })}
              render={({ ghost, chip, accept }) => (
                <div>
                  <Input
                    id="rp-target-sprints"
                    type="number"
                    min={1}
                    value={config.sprintsToReleaseTarget ?? ""}
                    placeholder={ghost ?? "e.g. 6"}
                    onKeyDown={(e) => {
                      if (e.key === "Tab" && (config.sprintsToReleaseTarget ?? "") === "") {
                        e.preventDefault();
                        accept();
                      }
                    }}
                    // Quiet on keystroke (state-only), logged on blur.
                    // Otherwise typing "12" emits two RELEASE_UPDATED events
                    // ("1" then "12") even though only the final value matters.
                    onChange={(e) => updateConfigQuiet({ sprintsToReleaseTarget: e.target.value })}
                    onBlur={(e) => updateConfig({ sprintsToReleaseTarget: e.target.value })}
                    className={inputCls + " sm:max-w-xs"}
                  />
                  {chip}
                </div>
              )}
            />
          </div>

          <div className="mt-5 space-y-2">
            <span className="block text-sub text-xs" aria-hidden="true">
              Historical Velocities
            </span>
            <ToggleGroup<VelocitySource>
              label="Historical velocities"
              size="sm"
              value={velocitySource}
              onValueChange={(v) => updateConfig({ velocitySource: v })}
              options={[
                { value: "sprints", label: "From completed sprints" },
                { value: "manual", label: "Type them" },
              ]}
            />
            {velocitySource === "sprints" ? (
              fromSprints.length === 0 ? (
                <p className="text-xs text-sub">
                  No completed sprints with points yet. Log them in{" "}
                  <Link href="/velocity" className="text-accent underline-offset-2 hover:underline">
                    Velocity
                  </Link>
                  , or type the numbers instead.
                </p>
              ) : (
                <div className="space-y-1 text-xs text-sub">
                  <p className="font-data text-sm text-text">{fromSprints.join(", ")}</p>
                  <p>
                    {fromSprints.length} completed sprint{fromSprints.length !== 1 ? "s" : ""} — avg{" "}
                    {avgVelocity} pts/sprint.{" "}
                    <Link
                      href="/velocity"
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Edit in Velocity
                    </Link>
                  </p>
                </div>
              )
            ) : (
              <>
                <Label htmlFor="rp-velocities" className="sr-only">
                  Historical velocities (comma-separated or one per line)
                </Label>
                <textarea
                  id="rp-velocities"
                  value={config.velocityInput}
                  // Quiet on keystroke, logged on blur — typing a long comma list
                  // shouldn't write one RELEASE_UPDATED event per character.
                  onChange={(e) => updateConfigQuiet({ velocityInput: e.target.value })}
                  onBlur={(e) => updateConfig({ velocityInput: e.target.value })}
                  rows={3}
                  placeholder={DEFAULT_VELOCITY_INPUT}
                  aria-describedby="rp-velocities-hint"
                  className="w-full px-3 py-2 rounded-md text-sm bg-surface-deep border border-border text-text font-data focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 resize-none"
                />
                {velocities.length === 0 ? (
                  <p id="rp-velocities-hint" className="text-xs text-danger">
                    Enter at least one positive velocity value.
                  </p>
                ) : (
                  <p id="rp-velocities-hint" className="text-xs text-sub">
                    Comma-separated or one per line. {velocities.length} data point
                    {velocities.length !== 1 ? "s" : ""} — avg {avgVelocity} pts/sprint
                  </p>
                )}
              </>
            )}
          </div>
        </SectionCard>

        {/* Sensitivity slider */}
        <SectionCard title="Scope Sensitivity" icon={TrendingUp}>
          <div className="flex items-center gap-4">
            <span className="text-xs text-sub w-8 text-right">-50%</span>
            <div className="flex-1">
              <Slider
                min={-50}
                max={50}
                step={1}
                value={[config.scopeAdjustment]}
                onValueChange={handleScopeAdjustment}
                onValueCommit={handleScopeAdjustmentCommit}
                aria-label="Scope adjustment"
                thumbProps={{
                  "aria-valuetext": `${config.scopeAdjustment > 0 ? "+" : ""}${config.scopeAdjustment}%`,
                }}
                className=""
              />
            </div>
            <span className="text-xs text-sub w-8">+50%</span>
            <span
              className="text-sm font-data font-bold w-16 text-center"
              style={{
                color:
                  config.scopeAdjustment > 0
                    ? "#ef4444"
                    : config.scopeAdjustment < 0
                      ? "#00ff88"
                      : "#94a3b8",
              }}
            >
              {config.scopeAdjustment > 0 ? "+" : ""}
              {config.scopeAdjustment}%
            </span>
          </div>
          <p className="mt-2 text-xs text-sub">
            Adjust scope by ±50% to model optimistic or pessimistic scenarios. Current effective
            backlog: <span className="text-accent font-data">{effectiveBacklog} pts</span>.
          </p>
        </SectionCard>

        {/* Histogram chart */}
        <SectionCard
          title={<span id={histogramTitleId}>Simulation Histogram</span>}
          icon={BarChart3}
          titleSize="lg"
          titleSuffix={`(${ITERATIONS.toLocaleString()} iterations)`}
          headerClassName="pb-2"
        >
          {sim.histogram.length === 0 ? (
            <div className="flex items-center justify-center h-60 text-sub text-sm">
              Enter velocity data to run simulation.
            </div>
          ) : (
            <ChartFigure
              labelledBy={histogramTitleId}
              summary={histogramText.summary}
              table={histogramText.table}
              plotRef={chartRef}
              plotClassName="w-full pt-2"
            >
              <SimulationHistogramChart
                histogram={sim.histogram}
                total={ITERATIONS}
                p50={sim.p50}
                p85={sim.p85}
                p95={sim.p95}
                bootstrapPoint={bootstrapResult ? bootstrapResult.point : null}
                target={pinnedTarget}
              />
            </ChartFigure>
          )}
        </SectionCard>

        {/* Confidence table */}
        {confidenceRows.length > 0 && (
          <SectionCard title="Delivery Forecast" icon={Calendar}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-6">
                      Confidence
                    </th>
                    <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-4">
                      Sprints
                    </th>
                    <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-4">
                      Calendar Days
                    </th>
                    <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pl-4">
                      Target Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {confidenceRows.map((row) => (
                    <tr key={row.pct} className="border-b border-border hover:bg-card-hover">
                      <td className="py-4 pr-6">
                        <div className="flex items-center gap-3">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full"
                            style={{ background: row.color }}
                          />
                          <span
                            className="text-base font-data font-bold"
                            style={{ color: row.color }}
                          >
                            {row.pct}%
                          </span>
                          <span className="text-xs text-sub">confidence</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className="font-data font-bold text-text text-lg">{row.sprints}</span>
                      </td>
                      <td className="py-4 px-4 text-center font-data text-sub">
                        {row.sprints * config.sprintLengthDays}
                      </td>
                      <td className="py-4 pl-4">
                        <span className="font-semibold text-text">{row.date}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-card-hover border border-border">
              <p className="text-xs text-sub">
                <span className="text-text font-medium">How to read this:</span> At 85% confidence,
                there is an 85% chance delivery completes by{" "}
                <span className="text-accent-amber font-data">
                  {confidenceRows.find((r) => r.pct === 85)?.date ?? "—"}
                </span>
                . The simulation sampled {velocities.length} historical velocities across{" "}
                {ITERATIONS.toLocaleString()} iterations.
              </p>
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
