"use client";

import { useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, BarChart2, CalendarDays, Target, Trash2, TrendingUp } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartCard } from "@/components/shared/chart-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { generateBurnupPrompts } from "@/lib/ai-prompts/burnup";
import { cusum } from "@/lib/analytics/changepoint";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { mannKendall } from "@/lib/analytics/trend-test";
import { BURNUP_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger, type HistoryLogger } from "@/lib/history/use-history-logger";
import { useToolSonification } from "@/lib/sonification/use-sonification";
import { denseSeries } from "@/lib/sprints/metrics";
import { dayDate, dayForDate, todayIso } from "@/lib/sprints/series";
import type { SprintDay } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import {
  clearDay,
  clearLog,
  restoreDay,
  restoreLog,
  writeBurnupDay,
} from "../burndown/series-writes";
import {
  DerivedCaption,
  DraftInput,
  SprintSettings,
  SprintToolShell,
  formatPoints,
  shortDate,
  type SprintSettingsChange,
  type SprintToolContext,
} from "../burndown/sprint-shell";
import { burnupView } from "./view";

// Recharts loads with the chart, not the page. ChartCard reserves the
// chart's height while the chunk loads.
const BurnupChart = dynamic(() => import("./charts").then((m) => m.BurnupChart), {
  ssr: false,
});

type Log = HistoryLogger["log"];
type ForecastPoint = ReturnType<typeof forecastBayesianHolt>[number];

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A typed number, or null for a blank field; undefined when it isn't a number of 0 or more. */
function parsePoints(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

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
            <Icon className="w-5 h-5" style={{ color }} aria-hidden="true" />
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
/*  One sprint                                                                 */
/* -------------------------------------------------------------------------- */

function BurnupSprint({ sprint, series, readOnly, log }: SprintToolContext & { log: Log }) {
  const sonify = useToolSonification("burnup");
  const rowsId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const view = useMemo(() => burnupView(sprint, series), [sprint, series]);
  const { config, entries } = view;
  const loggedDays = entries.filter((e) => e.stored).length;

  /* -- Writes -------------------------------------------------------------- */

  const setScope = (day: number, raw: string, scopeBefore: number) => {
    if (readOnly) return;
    const n = parsePoints(raw);
    if (n === undefined) return;
    if (!writeBurnupDay(sprint.id, day, { scope: n })) return;
    log(BURNUP_ACTIONS.SCOPE_CHANGED, { sprintId: sprint.id, day, scope: n });
    if (n !== null && n > scopeBefore) sonify("scope-increase");
  };

  const setCompleted = (day: number, raw: string) => {
    if (readOnly) return;
    const n = parsePoints(raw);
    if (n === undefined) return;
    const write = writeBurnupDay(sprint.id, day, { completed: n });
    if (write && n !== null && write.before?.completed == null) {
      log(BURNUP_ACTIONS.DAY_LOGGED, { sprintId: sprint.id, day, completed: n });
      sonify("day-logged");
    }
  };

  const setNote = (day: number, note: string) => {
    if (!readOnly) writeBurnupDay(sprint.id, day, { note });
  };

  const clearOneDay = (day: number) => {
    if (readOnly) return;
    let removed: SprintDay | undefined;
    undoable({
      label: `Cleared day ${day}`,
      apply: () => {
        removed = clearDay(sprint.id, day);
        if (removed) log(BURNUP_ACTIONS.DAY_REMOVED, { sprintId: sprint.id, day });
      },
      revert: () => {
        if (removed) restoreDay(sprint.id, removed);
      },
    });
  };

  const clearWholeLog = () => {
    if (readOnly) return;
    let previous: SprintDay[] = [];
    undoable({
      label: `Cleared the log of ${sprint.name}`,
      apply: () => {
        previous = clearLog(sprint.id);
        log(BURNUP_ACTIONS.BURNUP_RESET, { sprintId: sprint.id, days: previous.length });
      },
      revert: () => restoreLog(sprint.id, previous),
    });
  };

  const onSettingsChanged = (change: SprintSettingsChange) =>
    log(BURNUP_ACTIONS.CONFIG_UPDATED, { sprintId: sprint.id, ...change });

  /* -- Forecast, change points and trend ------------------------------------ */

  // Points done for days 0..last logged day, a missed day carrying the
  // previous reading forward, so Holt and CUSUM see evenly spaced samples.
  const dense = useMemo(() => denseSeries(sprint, series).completed, [sprint, series]);
  const lastDenseDay = dense.length - 1;

  const forecastByDay = useMemo(() => {
    const m = new Map<number, ForecastPoint>();
    if (dense.length < 2) return m;
    const horizon = Math.max(1, config.sprintDays - lastDenseDay);
    forecastBayesianHolt(dense, horizon).forEach((fp, i) => m.set(lastDenseDay + i + 1, fp));
    return m;
  }, [dense, lastDenseDay, config.sprintDays]);

  // CUSUM on points done: "team unblocked" (sustained speed-up) or
  // "delivery stalled". The dense run starts at day 0, so an index is a day.
  const changepointDays = useMemo(() => {
    if (dense.length < 4) return [] as Array<{ day: number; direction: "up" | "down" }>;
    return cusum(dense)
      .map((cp) => ({ day: cp.index, direction: cp.direction }))
      .filter((x) => x.day >= 0 && x.day <= config.sprintDays);
  }, [dense, config.sprintDays]);

  // Mann-Kendall needs 5 or more samples; the chip shows only a significant trend.
  const trendTest = useMemo(() => (dense.length < 5 ? null : mannKendall(dense)), [dense]);

  /* -- Chart data ---------------------------------------------------------- */

  const chartData = useMemo(
    () =>
      entries
        .filter((e) => e.day <= config.sprintDays)
        .map((e) => {
          const fc = forecastByDay.get(e.day);
          return {
            day: e.day,
            scope: e.scopeInForce,
            completed: e.completed,
            forecast: fc ? parseFloat(fc.yHat.toFixed(1)) : undefined,
            // Points done can't be negative or pass the scope: clamp the band.
            band80Lower: fc ? parseFloat(Math.max(0, fc.lower80).toFixed(1)) : undefined,
            band80Upper: fc
              ? parseFloat(Math.min(e.scopeInForce, Math.max(0, fc.upper80)).toFixed(1))
              : undefined,
            description: e.description ?? "",
          };
        }),
    [entries, config.sprintDays, forecastByDay]
  );

  const todayDay = useMemo(() => {
    const d = dayForDate(sprint, todayIso());
    return d !== null && d >= 0 && d <= config.sprintDays ? d : null;
  }, [sprint, config.sprintDays]);

  /* -- Summary stats ------------------------------------------------------- */

  const stats = useMemo(() => {
    const scopes = chartData.map((d) => d.scope);
    const initialScope = scopes[0] ?? 0;
    const maxScope = scopes.length > 0 ? Math.max(...scopes) : 0;
    const scopeCreep = round1(Math.max(0, maxScope - initialScope));
    const done = entries.filter((e) => e.completed !== null);
    const latestCompleted = done[done.length - 1]?.completed ?? 0;
    const currentScope = scopes[scopes.length - 1] ?? maxScope;
    const completionPct = Math.max(
      0,
      Math.min(100, currentScope > 0 ? Math.round((latestCompleted / currentScope) * 100) : 0)
    );

    // Projected finish: straight line through the last two days with a number.
    let projectedDay: number | null = null;
    if (done.length >= 2) {
      const last = done[done.length - 1];
      const prev = done[done.length - 2];
      const rate =
        ((last.completed as number) - (prev.completed as number)) /
        Math.max(1, last.day - prev.day);
      if (rate > 0 && Number.isFinite(rate)) {
        const daysLeft = (currentScope - (last.completed as number)) / rate;
        if (Number.isFinite(daysLeft) && daysLeft >= 0) {
          // Capped: a year past the end is already "after the sprint".
          projectedDay = Math.min(config.sprintDays + 365, Math.round(last.day + daysLeft));
        }
      }
    }
    return { initialScope, maxScope, scopeCreep, latestCompleted, completionPct, projectedDay };
  }, [chartData, entries, config.sprintDays]);

  /* -- Export -------------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Day", "Scope (pts)", "Completed (pts)", "Note"],
      rows: chartData.map((d) => [d.day, d.scope, d.completed ?? "", d.description ?? ""]),
    }),
    [chartData]
  );

  const promptConfig = useMemo(
    () => ({ toolName: "Burnup Chart", prompts: generateBurnupPrompts({ config, entries }) }),
    [config, entries]
  );

  /* -- Render -------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      {loggedDays === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-sub">
          No days logged yet. At the end of each day, log the points done so far.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Completion" value={stats.completionPct} unit="%" icon={Target} />
        <StatCard
          label="Scope creep"
          value={stats.scopeCreep > 0 ? `+${stats.scopeCreep}` : stats.scopeCreep}
          unit="pts"
          icon={AlertTriangle}
          color={stats.scopeCreep > 0 ? "#ffaa00" : "#00ff88"}
        />
        <StatCard
          label="Points completed"
          value={stats.latestCompleted}
          unit={`/ ${stats.maxScope} pts`}
          icon={TrendingUp}
          color="#00ff88"
        />
        <StatCard
          label="Projected done"
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

      <SprintSettings
        tool="burnup"
        sprint={sprint}
        readOnly={readOnly}
        onChanged={onSettingsChanged}
      />

      <ChartCard
        title="Burnup chart"
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
            <div className="flex items-center gap-2 text-xs text-accent-amber bg-accent-amber/8 border border-accent-amber/20 rounded-md px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              Scope creep: scope grew by {stats.scopeCreep} pts ({stats.initialScope} →{" "}
              {stats.maxScope}).
            </div>
          ) : null
        }
      >
        <BurnupChart data={chartData} todayDay={todayDay} changepointDays={changepointDays} />
      </ChartCard>

      {/* Mann-Kendall chip: only with 5+ samples and a trend significant at
          α=0.05. Up reads as good (accent), down as worth a look. */}
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

      <SectionCard
        title="Daily data"
        icon={TrendingUp}
        titleSize="lg"
        headerClassName="pb-4"
        actions={
          <Button
            variant="danger-ghost"
            size="sm"
            disabled={readOnly || loggedDays === 0}
            onClick={() => setConfirmClearOpen(true)}
          >
            Clear log
          </Button>
        }
      >
        {/* One compact row per day; the note is a single-line input to keep
            the rhythm of the tracker. */}
        <div className="hidden sm:grid grid-cols-[96px_1fr_1fr_1.2fr_auto] gap-3 px-1 pb-2 border-b border-border mb-2">
          <span className="text-xs text-sub font-medium uppercase tracking-wider">Day</span>
          <span className="text-xs text-sub font-medium uppercase tracking-wider">
            Scope (total pts)
          </span>
          <span className="text-xs text-sub font-medium uppercase tracking-wider">
            Completed (pts)
          </span>
          <span className="text-xs text-sub font-medium uppercase tracking-wider">Note</span>
          <span className="w-9" />
        </div>

        <div className="space-y-2">
          {entries.map((e) => {
            const scopeCaptionId = `${rowsId}-scope-${e.day}`;
            const doneCaptionId = `${rowsId}-done-${e.day}`;
            const planScope = e.day === 0 && e.typedScope === null;
            const date = shortDate(dayDate(sprint, e.day));
            return (
              <div
                key={e.id}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[96px_1fr_1fr_1.2fr_auto] gap-2 sm:gap-3 sm:items-start rounded-md border border-border sm:border-0 p-2 sm:p-0"
              >
                <div className="flex flex-col sm:pt-1.5">
                  <span className="font-data text-sm font-semibold text-accent">Day {e.day}</span>
                  <span className="text-xs text-sub">
                    {e.afterEnd ? `${date}, after the end` : date}
                  </span>
                </div>

                <IconButton
                  label={`Clear day ${e.day}`}
                  icon={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                  variant="danger-ghost"
                  disabled={readOnly || !e.stored}
                  onClick={() => clearOneDay(e.day)}
                  className="min-touch-coarse h-9 w-9 disabled:opacity-30 justify-self-end sm:order-last"
                />

                <div className="col-span-2 sm:col-span-1">
                  <DraftInput
                    type="number"
                    inputMode="decimal"
                    min={0}
                    aria-label={`Scope points on day ${e.day}`}
                    aria-describedby={planScope ? scopeCaptionId : undefined}
                    // A blank day carries the scope forward; show it dimmed.
                    placeholder={formatPoints(e.scopeInForce)}
                    value={e.typedScope === null ? "" : String(e.typedScope)}
                    readOnly={readOnly}
                    onCommit={(v) => setScope(e.day, v, e.scopeInForce)}
                    className="font-data focus:border-accent-magenta/50 focus:ring-accent-magenta/20"
                  />
                  {planScope && (
                    <DerivedCaption id={scopeCaptionId} value={e.scopeInForce} from="the plan" />
                  )}
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <DraftInput
                    type="number"
                    inputMode="decimal"
                    min={0}
                    aria-label={`Completed points on day ${e.day}`}
                    aria-describedby={e.derivedCompleted !== null ? doneCaptionId : undefined}
                    placeholder={
                      e.derivedCompleted !== null
                        ? formatPoints(e.derivedCompleted)
                        : e.day === 0
                          ? "0"
                          : "— pts"
                    }
                    value={e.typedCompleted === null ? "" : String(e.typedCompleted)}
                    readOnly={readOnly}
                    onCommit={(v) => setCompleted(e.day, v)}
                    className="font-data"
                  />
                  {e.derivedCompleted !== null && (
                    <DerivedCaption id={doneCaptionId} value={e.derivedCompleted} from="Burndown" />
                  )}
                </div>

                <DraftInput
                  type="text"
                  placeholder="Optional note"
                  aria-label={`Note for day ${e.day}`}
                  value={e.description ?? ""}
                  readOnly={readOnly}
                  maxLength={280}
                  onCommit={(v) => setNote(e.day, v)}
                  className="col-span-2 sm:col-span-1 text-xs"
                />
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-xs text-sub">
          Completed is a running total. Enter scope only on days it changes: the chart carries it
          forward from the planned points. A dimmed number was logged in Burndown; type over it to
          use your own.
        </p>
      </SectionCard>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear the log?"
        description={`The ${loggedDays} logged day${loggedDays === 1 ? "" : "s"} of ${sprint.name} ${
          loggedDays === 1 ? "is" : "are"
        } cleared, here and in Burndown. The sprint and its settings stay.`}
        confirmLabel="Clear log"
        onConfirm={clearWholeLog}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export function BurnupClient() {
  const { log } = useHistoryLogger("burnup");

  return (
    <ToolPageWrapper
      toolId="burnup"
      title="Burnup Generator"
      description="Visualise completed work climbing toward total scope. Scope creep is immediately visible when the scope line rises."
      category="Metrics & Dashboards"
    >
      <SprintToolShell
        tool="burnup"
        onSettingsChanged={(sprintId, change) =>
          log(BURNUP_ACTIONS.CONFIG_UPDATED, { sprintId, ...change })
        }
      >
        {(ctx) => <BurnupSprint key={ctx.sprint.id} {...ctx} log={log} />}
      </SprintToolShell>
    </ToolPageWrapper>
  );
}
