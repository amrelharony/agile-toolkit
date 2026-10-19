"use client";

import { useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BarChart3, Flag, Minus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartCard } from "@/components/shared/chart-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { useChartHeight } from "@/hooks/use-chart-height";
import { generateBurndownPrompts } from "@/lib/ai-prompts/burndown";
import { cusum } from "@/lib/analytics/changepoint";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { BURNDOWN_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger, type HistoryLogger } from "@/lib/history/use-history-logger";
import { useToolSonification } from "@/lib/sonification/use-sonification";
import { denseSeries } from "@/lib/sprints/metrics";
import { dayDate, dayForDate, todayIso } from "@/lib/sprints/series";
import type { SprintDay } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { burndownChartText } from "./chart-text";
import { toMarkdown } from "./markdown";
import {
  clearDay,
  clearLog,
  restoreDay,
  restoreLog,
  toggleScopeChange,
  writeBurndownDay,
} from "./series-writes";
import {
  DerivedCaption,
  DraftInput,
  SprintSettings,
  SprintToolShell,
  formatPoints,
  shortDate,
  type SprintSettingsChange,
  type SprintToolContext,
} from "./sprint-shell";
import { burndownView } from "./view";

// Recharts loads with the chart, not the page. ChartCard reserves the
// chart's height while the chunk loads.
const BurndownChart = dynamic(() => import("./charts").then((m) => m.BurndownChart), {
  ssr: false,
});

type Log = HistoryLogger["log"];
type ForecastPoint = ReturnType<typeof forecastBayesianHolt>[number];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getIdealValue(day: number, totalPoints: number, sprintDays: number): number {
  // A zero or negative length would make the slope Infinity/NaN and crash
  // the chart's domain; draw a flat line at the plan instead.
  if (!Number.isFinite(sprintDays) || sprintDays <= 0) return totalPoints;
  return Math.max(0, totalPoints - (totalPoints / sprintDays) * day);
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

function BurndownSprint({ sprint, series, readOnly, log }: SprintToolContext & { log: Log }) {
  const sonify = useToolSonification("burndown");
  const rowsId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartHeight = useChartHeight({ min: 260, max: 420 });
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const view = useMemo(() => burndownView(sprint, series), [sprint, series]);
  const { config, entries } = view;
  const loggedDays = entries.filter((e) => e.stored).length;

  /* -- Writes -------------------------------------------------------------- */

  const setRemaining = (day: number, raw: string) => {
    if (readOnly) return;
    const text = raw.trim();
    const n = text === "" ? null : Number(text);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return;
    const write = writeBurndownDay(sprint.id, day, { remaining: n });
    if (write && n !== null && write.before?.remaining == null) {
      log(BURNDOWN_ACTIONS.DAY_LOGGED, { sprintId: sprint.id, day, remaining: n });
      sonify("day-logged");
    }
  };

  const setNote = (day: number, note: string) => {
    if (!readOnly) writeBurndownDay(sprint.id, day, { note });
  };

  const flipScopeChange = (day: number) => {
    if (readOnly) return;
    const write = toggleScopeChange(sprint.id, day);
    if (!write) return;
    const on = Boolean(write.after?.scopeChange);
    log(BURNDOWN_ACTIONS.SCOPE_CHANGED, {
      sprintId: sprint.id,
      day,
      scopeChange: on,
      scope: write.after?.scope ?? null,
    });
    if (on) sonify("scope-change");
  };

  const clearOneDay = (day: number) => {
    if (readOnly) return;
    let removed: SprintDay | undefined;
    undoable({
      label: `Cleared day ${day}`,
      apply: () => {
        removed = clearDay(sprint.id, day);
        if (removed) log(BURNDOWN_ACTIONS.DAY_REMOVED, { sprintId: sprint.id, day });
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
        log(BURNDOWN_ACTIONS.BURNDOWN_RESET, { sprintId: sprint.id, days: previous.length });
      },
      revert: () => restoreLog(sprint.id, previous),
    });
  };

  const onSettingsChanged = (change: SprintSettingsChange) =>
    log(BURNDOWN_ACTIONS.CONFIG_UPDATED, { sprintId: sprint.id, ...change });

  /* -- Forecast and change points ------------------------------------------ */

  // Remaining for days 0..last logged day, a missed day carrying the previous
  // reading forward. Holt needs evenly spaced samples and extrapolates from
  // the last one, so it fits this dense run and the forecast is plotted from
  // the day after it.
  const dense = useMemo(() => denseSeries(sprint, series).remaining, [sprint, series]);
  const lastDenseDay = dense.length - 1;

  const forecastByDay = useMemo(() => {
    const m = new Map<number, ForecastPoint>();
    if (dense.length < 2) return m;
    const horizon = Math.max(1, config.sprintDays - lastDenseDay);
    forecastBayesianHolt(dense, horizon).forEach((fp, i) => m.set(lastDenseDay + i + 1, fp));
    return m;
  }, [dense, lastDenseDay, config.sprintDays]);

  // CUSUM burn-rate shifts. The dense run starts at day 0, so an index is a
  // day. Kept inside the chart's days so a marker can't stretch the axis.
  const changepointDays = useMemo(() => {
    if (dense.length < 4) return [] as Array<{ day: number; direction: "up" | "down" }>;
    return cusum(dense)
      .map((cp) => ({ day: cp.index, direction: cp.direction }))
      .filter((x) => x.day >= 0 && x.day <= config.sprintDays);
  }, [dense, config.sprintDays]);

  /* -- Chart data ---------------------------------------------------------- */

  const chartData = useMemo(
    () =>
      entries
        .filter((e) => e.day <= config.sprintDays)
        .map((e) => {
          const fc = forecastByDay.get(e.day);
          return {
            day: e.day,
            ideal: parseFloat(
              getIdealValue(e.day, config.totalPoints, config.sprintDays).toFixed(1)
            ),
            actual: e.remaining,
            forecast: fc ? parseFloat(fc.yHat.toFixed(1)) : undefined,
            // Remaining can't go below 0: clamp the band so it doesn't stretch the axis.
            band80Lower: fc ? parseFloat(Math.max(0, fc.lower80).toFixed(1)) : undefined,
            band80Upper: fc ? parseFloat(Math.max(0, fc.upper80).toFixed(1)) : undefined,
            scopeChange: e.scopeChange,
            description: e.description ?? "",
          };
        }),
    [entries, config, forecastByDay]
  );

  // The chart in words: a summary sentence and the plotted series as a table.
  const chartText = useMemo(() => burndownChartText(chartData), [chartData]);

  const todayDay = useMemo(() => {
    const d = dayForDate(sprint, todayIso());
    return d !== null && d >= 0 && d <= config.sprintDays ? d : null;
  }, [sprint, config.sprintDays]);

  /* -- Summary stats ------------------------------------------------------- */

  const stats = useMemo(() => {
    const filled = entries.filter((e) => e.remaining !== null);
    // Day 0 always has the starting scope, so one point is only the starting
    // line. Until a second day has a number there's no trend to report.
    if (filled.length < 2) {
      return { hasData: false, variance: 0, trend: "neutral" as const, completionRate: 0 };
    }
    const last = filled[filled.length - 1];
    const remaining = last.remaining ?? config.totalPoints;
    const idealAtLastDay = getIdealValue(last.day, config.totalPoints, config.sprintDays);
    const variance = parseFloat((idealAtLastDay - remaining).toFixed(1));
    const trend = variance > 0.5 ? "ahead" : variance < -0.5 ? "behind" : "neutral";
    // Zero-guarded, and clamped: remaining can pass the plan after scope is added.
    const completionRate =
      config.totalPoints > 0
        ? Math.max(
            0,
            Math.min(100, Math.round(((config.totalPoints - remaining) / config.totalPoints) * 100))
          )
        : 0;
    return { hasData: true, variance, trend, completionRate };
  }, [entries, config]);

  /* -- Export -------------------------------------------------------------- */

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

  const markdown = useMemo(() => toMarkdown({ config, entries }), [config, entries]);

  const promptConfig = useMemo(
    () => ({ toolName: "Burndown Chart", prompts: generateBurndownPrompts({ config, entries }) }),
    [config, entries]
  );

  /* -- Trend --------------------------------------------------------------- */

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
    <div className="space-y-6">
      {loggedDays === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-sub">
          No days logged yet. At the end of each day, log the points still to do.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Planned points" value={config.totalPoints} unit="pts" icon={BarChart3} />
        <StatCard
          label="Variance from ideal"
          value={!stats.hasData ? "—" : stats.variance > 0 ? `+${stats.variance}` : stats.variance}
          unit={stats.hasData ? "pts" : undefined}
          icon={TrendIcon}
          color={trendColor}
        />
        <StatCard
          label="Completion rate"
          value={stats.hasData ? stats.completionRate : "—"}
          unit={stats.hasData ? "%" : undefined}
          icon={TrendingDown}
          color="#00f0ff"
        />
        <StatCard label="Trend" value={trendLabel} icon={TrendIcon} color={trendColor} />
      </div>

      <SprintSettings
        tool="burndown"
        sprint={sprint}
        readOnly={readOnly}
        onChanged={onSettingsChanged}
      />

      <ChartCard
        title="Burndown chart"
        icon={BarChart3}
        height={chartHeight}
        chartContainerRef={chartRef}
        summary={chartText.summary}
        table={chartText.table}
        headerExtras={
          <>
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="burndown-chart"
              csvData={csvData}
              markdown={markdown}
              targetRef={chartRef}
            />
          </>
        }
      >
        <BurndownChart
          data={chartData}
          scopeChangeDays={view.scopeChangeDays}
          todayDay={todayDay}
          changepointDays={changepointDays}
        />
      </ChartCard>

      <SectionCard
        title="Daily progress"
        icon={TrendingDown}
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
        <div className="hidden sm:grid grid-cols-[96px_1fr_1.2fr_140px_auto] gap-3 px-1 pb-2 border-b border-border mb-2">
          <span className="text-xs text-sub font-medium uppercase tracking-wider">Day</span>
          <span className="text-xs text-sub font-medium uppercase tracking-wider">
            Points remaining
          </span>
          <span className="text-xs text-sub font-medium uppercase tracking-wider">Note</span>
          <span className="text-xs text-sub font-medium uppercase tracking-wider flex items-center gap-1">
            <Flag className="w-3 h-3" aria-hidden="true" /> Scope change
          </span>
          <span className="w-9" />
        </div>

        <div className="space-y-2">
          {entries.map((e) => {
            const captionId = `${rowsId}-day-${e.day}`;
            const from =
              e.source === "derived" ? "Burnup" : e.source === "plan" ? "the plan" : null;
            const date = shortDate(dayDate(sprint, e.day));
            return (
              <div
                key={e.id}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[96px_1fr_1.2fr_140px_auto] gap-2 sm:gap-3 sm:items-start rounded-md border border-border sm:border-0 p-2 sm:p-0"
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
                    aria-label={`Remaining points on day ${e.day}`}
                    aria-describedby={from ? captionId : undefined}
                    placeholder={from && e.remaining !== null ? formatPoints(e.remaining) : "— pts"}
                    value={e.typed === null ? "" : String(e.typed)}
                    readOnly={readOnly}
                    onCommit={(v) => setRemaining(e.day, v)}
                    className="font-data"
                  />
                  {from && e.remaining !== null && (
                    <DerivedCaption id={captionId} value={e.remaining} from={from} />
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

                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => flipScopeChange(e.day)}
                  className={`col-span-2 sm:col-span-1 h-9 px-3 rounded-md text-xs font-medium border transition-colors disabled:cursor-not-allowed ${
                    e.scopeChange
                      ? "bg-accent-amber/15 border-accent-amber/40 text-accent-amber"
                      : "bg-card border-border text-sub hover:border-accent-amber/30 hover:text-accent-amber"
                  }`}
                >
                  {e.scopeChange ? "Scope changed" : "Mark change"}{" "}
                  <span className="sr-only">on day {e.day}</span>
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-xs text-sub">
          Leave a day blank until you reach it. Day 0 is the first day of the sprint. A dimmed
          number was logged in Burnup; type over it to use your own. Mark a scope change on a day
          the points went up because work was added, and Burnup&apos;s scope line rises with it.
        </p>
      </SectionCard>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear the log?"
        description={`The ${loggedDays} logged day${loggedDays === 1 ? "" : "s"} of ${sprint.name} ${
          loggedDays === 1 ? "is" : "are"
        } cleared, here and in Burnup. The sprint and its settings stay.`}
        confirmLabel="Clear log"
        onConfirm={clearWholeLog}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export function BurndownClient() {
  const { log } = useHistoryLogger("burndown");

  return (
    <ToolPageWrapper
      toolId="burndown"
      title="Burndown Generator"
      description="Track sprint progress with ideal vs. actual remaining points, today marker, and scope change annotations."
      category="Metrics & Dashboards"
    >
      <SprintToolShell
        tool="burndown"
        onSettingsChanged={(sprintId, change) =>
          log(BURNDOWN_ACTIONS.CONFIG_UPDATED, { sprintId, ...change })
        }
      >
        {(ctx) => <BurndownSprint key={ctx.sprint.id} {...ctx} log={log} />}
      </SprintToolShell>
    </ToolPageWrapper>
  );
}
