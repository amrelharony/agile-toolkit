"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FlaskConical, Plus, Activity, TrendingUp, TrendingDown, Minus, X } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartCard } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { SmartInput } from "@/components/shared/smart-input";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { nextSprintName } from "@/components/sprints/sprint-picker";
import { chartTheme } from "@/components/charts/chart-theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateVelocityPrompts } from "@/lib/ai-prompts/velocity";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VELOCITY_ACTIONS } from "@/lib/history/event-actions";
import { undoable } from "@/lib/utils/undoable";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { mannKendall } from "@/lib/analytics/trend-test";
import { exampleSprints } from "@/lib/sprints/example";
import { useSprintMigrationStatus } from "@/lib/sprints/migration-status";
import { endDateFor, todayIso } from "@/lib/sprints/series";
import { createSprint, removeSprintWithSeries, updateSprint } from "@/lib/sprints/store";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { toMarkdown } from "./markdown";
import { changepointMarkers as buildChangepointMarkers } from "./changepoints";
import { velocityChartText } from "./chart-text";
import { SprintRow } from "./sprint-row";
import {
  commitmentAccuracy,
  completedPointsPatch,
  finishedRows,
  nextSprintDates,
  statusLabel,
  toVelocityRows,
} from "./view";

// Recharts loads with the chart, not the page; ChartCard's fixed-height box
// reserves the space while it does.
const VelocityChart = dynamic(() => import("./charts").then((m) => m.VelocityChart), {
  ssr: false,
});

/* -------------------------------------------------------------------------- */
/*  Math helpers                                                              */
/* -------------------------------------------------------------------------- */

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function rollingAverage(values: number[], window = 3): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function linearRegression(values: number[]): number[] {
  // Fit against (originalIndex, value) pairs so a gap (NaN) doesn't shift
  // the projection by one for every point after it.
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

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Velocity over the shared sprints: each row IS a workspace sprint (the same
 * one Burndown, Burnup, Sprint Comparison and Sprint Metrics show), and an
 * edit writes to it straight away. The example is an in-memory preview and
 * is never saved.
 */
export function VelocityClient() {
  const { log } = useHistoryLogger("velocity");
  const migration = useSprintMigrationStatus();
  const { sprints: ownSprints, selected, select } = useSelectedSprint();

  // The example: read-only, in memory, gone on "Close example".
  const [preview, setPreview] = useState(false);
  const example = useMemo(() => (preview ? exampleSprints() : null), [preview]);
  const sprints = example ? example.sprints : ownSprints;
  const selectedId = example ? example.current.id : selected?.id;

  const [creating, setCreating] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  /* -- Writes ---------------------------------------------------------------- */

  const findSprint = (id: string) => useWorkspaceStore.getState().sprints.find((s) => s.id === id);

  const logUpdate = (id: string, field: string, value: unknown, extra?: Record<string, unknown>) =>
    log(VELOCITY_ACTIONS.SPRINT_UPDATED, { sprintId: id, field, value, ...extra });

  const rename = (id: string, name: string) => {
    if (updateSprint(id, { name })) logUpdate(id, "name", name);
  };

  const setGoal = (id: string, goal: string) => {
    if (updateSprint(id, { goal: goal || undefined })) logUpdate(id, "goal", goal);
  };

  const setCommitted = (id: string, n: number) => {
    if (updateSprint(id, { pointsPlanned: n })) logUpdate(id, "committed", n);
  };

  const setCompleted = (id: string, n: number | null) => {
    const current = findSprint(id);
    if (!current) return;
    const patch = completedPointsPatch(current, n);
    updateSprint(id, patch);
    logUpdate(id, "completed", n, patch.status ? { status: patch.status } : undefined);
  };

  const markDone = (id: string) => {
    if (updateSprint(id, { status: "completed" })) logUpdate(id, "status", "completed");
  };

  const removeSprint = (sprint: Sprint) => {
    let restore: (() => void) | null = null;
    const name = shortName(sprint.name);
    undoable({
      label: name
        ? `Removed “${name}” from every sprint tool`
        : "Removed a sprint from every sprint tool",
      apply: () => {
        restore = removeSprintWithSeries(sprint.id);
        log(VELOCITY_ACTIONS.SPRINT_REMOVED, { sprintId: sprint.id, name: sprint.name });
      },
      revert: () => restore?.(),
    });
  };

  const onCreated = (sprint: Sprint) => {
    setPreview(false);
    select(sprint.id);
    log(VELOCITY_ACTIONS.SPRINT_ADDED, {
      sprintId: sprint.id,
      name: sprint.name,
      committed: sprint.pointsPlanned,
    });
  };

  /* -- Smart-default for next sprint plan ---------------------------------- */
  // Reads the workspace's completed sprints (registered in
  // src/lib/predictions/bootstrap.ts). With none, confidence is "none" and
  // the SmartInput renders no chip and no ghost.
  const nextSprintPrediction = usePredictedDefault<number>("velocity", "nextSprintPlan", 0);
  const [plannedNext, setPlannedNext] = useState<string>("");
  const nextDates = useMemo(() => nextSprintDates(ownSprints), [ownSprints]);

  // "Plan next sprint": a planned sprint with the committed points and no
  // completed points, starting after the latest sprint (or today).
  const planNextSprint = () => {
    const n = Number(plannedNext);
    if (plannedNext.trim() === "" || !Number.isFinite(n) || n < 0) return;
    const today = todayIso();
    const start = nextDates.start > today ? nextDates.start : today;
    const committed = Math.round(n);
    const created = createSprint({
      name: nextSprintName(useWorkspaceStore.getState().sprints),
      startDate: start,
      endDate: endDateFor(start, nextDates.lengthDays),
      pointsPlanned: committed,
      status: "planned",
    });
    select(created.id);
    log(VELOCITY_ACTIONS.SPRINT_ADDED, {
      sprintId: created.id,
      name: created.name,
      committed,
      source: "predicted-default",
    });
    setPlannedNext("");
  };

  /* -- Derived rows and chart data ----------------------------------------- */

  const rows = useMemo(() => toVelocityRows(sprints), [sprints]);
  const sprintById = useMemo(() => new Map(sprints.map((s) => [s.id, s])), [sprints]);
  // Cancelled sprints stay in the table (to be fixed or removed) but not the chart.
  const chartRows = useMemo(() => rows.filter((r) => r.status !== "cancelled"), [rows]);

  // Only finished sprints (done, with completed points) feed the analytics:
  // a planned or running sprint would drag the average toward zero.
  const finished = useMemo(() => finishedRows(rows), [rows]);
  const completedSeries = useMemo(() => finished.map((r) => r.completed), [finished]);

  // Bayesian forecast for the NEXT sprint; [] below two finished sprints.
  const forecast = useMemo(() => {
    if (completedSeries.length < 2) return [];
    return forecastBayesianHolt(completedSeries, 1);
  }, [completedSeries]);

  // CUSUM regime-shift markers, looked up in the finished list CUSUM ran on.
  const changepointMarkers = useMemo(() => buildChangepointMarkers(finished), [finished]);

  // Mann-Kendall trend test: needs n>=5 to be informative.
  const trendTest = useMemo(() => {
    if (completedSeries.length < 5) return null;
    return mannKendall(completedSeries);
  }, [completedSeries]);

  const accuracy = useMemo(() => commitmentAccuracy(rows), [rows]);

  const { chartData, stats } = useMemo(() => {
    const rolling = rollingAverage(completedSeries, 3);
    const trendLine = linearRegression(completedSeries);

    type Row = {
      name: string;
      committed: number;
      completed: number | null;
      rollingAvg?: number;
      trend?: number;
      forecast?: number;
      band80Lower?: number;
      band80Upper?: number;
      forecastOnly?: boolean;
    };

    // rolling/trendLine are indexed over the FINISHED series; planned and
    // running sprints get no rolling-average or trend point.
    const finishedIndexById = new Map(finished.map((r, i) => [r.id, i]));
    const data: Row[] = chartRows.map((r) => {
      const fi = finishedIndexById.get(r.id);
      return {
        name: r.name,
        committed: r.committed,
        completed: fi !== undefined ? r.completed : null,
        rollingAvg: fi !== undefined && rolling[fi] !== null ? round(rolling[fi]!, 1) : undefined,
        trend: fi !== undefined ? round(trendLine[fi], 1) : undefined,
      };
    });

    // A synthetic "Next" row carries the forecast band, bridged from the last
    // finished sprint so the area starts where history ends.
    if (forecast.length > 0 && data.length > 0) {
      const fc = forecast[0];
      let anchorIdx = -1;
      for (let i = chartRows.length - 1; i >= 0; i--) {
        if (finishedIndexById.has(chartRows[i].id)) {
          anchorIdx = i;
          break;
        }
      }
      if (anchorIdx >= 0) {
        const last = data[anchorIdx];
        data[anchorIdx] = {
          ...last,
          forecast: last.completed ?? undefined,
          // Lower bound 0 rather than collapsing onto last.completed: with
          // connectNulls Recharts can draw a stray fill triangle otherwise.
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
          forecastOnly: true,
        });
      }
    }

    const n = completedSeries.length;
    const avgVelocity = n > 0 ? completedSeries.reduce((a, b) => a + b, 0) / n : 0;
    const sd = stdDev(completedSeries);

    // Trend direction from the last two trend values, with a deadband of 5%
    // of the average (0.5 pts is noise for a 60-pt team, signal for a 6-pt one).
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
      stats: { avgVelocity, predictability: accuracy.pct, sd, trendDir },
    };
  }, [chartRows, finished, completedSeries, forecast, accuracy]);

  // The chart in words: a summary sentence and the plotted series as a table.
  const chartText = useMemo(() => velocityChartText(chartData), [chartData]);

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Sprint", "Status", "Goal", "Committed", "Completed"],
      rows: rows.map((r) => [
        r.name,
        statusLabel(r.status),
        r.description ?? "",
        r.committed,
        r.completed ?? "",
      ]),
    }),
    [rows]
  );

  const markdown = useMemo(() => toMarkdown(rows), [rows]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Velocity Tracker",
      prompts: generateVelocityPrompts({
        sprints: finished.map((r) => ({
          name: r.name,
          committed: r.committed,
          completed: r.completed,
        })),
        stats,
      }),
    }),
    [finished, stats]
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

  const newSprintDialog = (
    <NewSprintDialog
      open={creating}
      onOpenChange={setCreating}
      onCreated={onCreated}
      defaultName={nextSprintName(ownSprints)}
      defaultStart={nextDates.start}
      defaultLengthDays={nextDates.lengthDays}
    />
  );

  if (migration === "pending" && !example) {
    return (
      <ToolPageWrapper
        toolId="velocity"
        title="Velocity Tracker"
        description="Track your team's sprint velocity with rolling averages and trend analysis."
        category="Metrics & Dashboards"
      >
        <p role="status" className="py-12 text-center text-sm text-sub">
          Loading sprints…
        </p>
      </ToolPageWrapper>
    );
  }

  const empty = rows.length === 0;

  return (
    <ToolPageWrapper
      toolId="velocity"
      title="Velocity Tracker"
      description="Track your team's sprint velocity with rolling averages and trend analysis."
      category="Metrics & Dashboards"
    >
      {example && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
        >
          <FlaskConical className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">Example sprints.</span> A preview only: nothing here is
            saved.
          </p>
          <Button type="button" size="sm" variant="toolkit" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Start your own
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(false)}>
            <X aria-hidden="true" />
            Close example
          </Button>
        </div>
      )}

      {empty ? (
        <SectionCard title="Sprint data" titleSize="lg" headerClassName="pb-4">
          <div className="flex flex-col items-center gap-3 py-6 text-center text-sm text-sub">
            <p>
              No sprints yet. Add each sprint with the points the team committed to and the points
              it finished. Burndown, Burnup and Sprint Comparison use the same sprints.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" variant="toolkit" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" />
                Create your first sprint
              </Button>
              <LoadExampleButton label="See an example" onLoad={() => setPreview(true)} />
            </div>
          </div>
        </SectionCard>
      ) : (
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
            summary={chartText.summary}
            table={chartText.table}
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
              Only when the test has enough samples (n>=5) AND the trend is
              significant at α=0.05: up reads as good, down as worth a look. */}
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
              The predictor reads completed sprints from the workspace; with
              none, the chip disappears and this is a plain number field. */}
          {!example && (
            <SectionCard
              title="Plan next sprint"
              titleSize="lg"
              headerClassName="pb-4"
              actions={
                <Button
                  size="sm"
                  variant="toolkit"
                  disabled={plannedNext.trim() === ""}
                  onClick={planNextSprint}
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
                  Tab to accept the suggested commitment, then Commit to add a planned sprint.
                </p>
              </div>
            </SectionCard>
          )}

          {/* ---- Data Table ---- */}
          <SectionCard
            title="Sprint Data"
            titleSize="lg"
            headerClassName="pb-4"
            contentClassName="space-y-3"
            actions={
              !example && (
                <Button
                  size="sm"
                  variant="toolkit"
                  onClick={() => setCreating(true)}
                  className="gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Add sprint
                </Button>
              )
            }
          >
            <p className="text-xs text-sub px-1">
              These are your shared sprints: changes show in Burndown, Burnup, Sprint Comparison and
              Sprint Metrics too.
            </p>
            {/* Header row */}
            <div className="hidden sm:grid grid-cols-[1fr_0.6fr_0.6fr_auto] gap-3 px-1 pb-2 border-b border-border">
              <span className="text-xs text-sub font-medium uppercase tracking-wider">Sprint</span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Committed
              </span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Completed
              </span>
              <span className="w-9" />
            </div>

            {rows.map((row) => {
              const sprint = sprintById.get(row.id);
              if (!sprint) return null;
              return (
                <SprintRow
                  key={row.id}
                  row={row}
                  sprint={sprint}
                  selected={row.id === selectedId}
                  readOnly={Boolean(example)}
                  onRename={(v) => rename(row.id, v)}
                  onGoal={(v) => setGoal(row.id, v)}
                  onCommitted={(n) => setCommitted(row.id, n)}
                  onCompleted={(n) => setCompleted(row.id, n)}
                  onMarkDone={() => markDone(row.id)}
                  onRemove={() => removeSprint(sprint)}
                />
              );
            })}

            {/* Commitment accuracy */}
            <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2 px-1">
              <span className="text-sm text-sub">
                Sprints meeting commitment:{" "}
                <span className="text-accent font-data font-semibold">{accuracy.met}</span> /{" "}
                {accuracy.considered}
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
      )}

      {newSprintDialog}
    </ToolPageWrapper>
  );
}
