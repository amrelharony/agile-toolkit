"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Activity, Gauge, Plus, Sigma, Target, Users } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityPlan, Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartCard, ChartFigure } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { CloseSprintDialog, type CarryOverPlan } from "@/components/sprints/close-sprint-dialog";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { nextSprintName } from "@/components/sprints/sprint-picker";
import { chartTheme } from "@/components/charts/chart-theme";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VELOCITY_ACTIONS } from "@/lib/history/event-actions";
import { undoable } from "@/lib/utils/undoable";
import { enoughData, MIN_SAMPLE, needMore } from "@/lib/analytics/min-sample";
import { stdDev } from "@/lib/analytics/anomaly";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { mannKendall } from "@/lib/analytics/trend-test";
import { DEFAULT_VELOCITY_WINDOW, fitLine } from "@/lib/sprints/metrics";
import { fmt, points } from "@/lib/sprints/hub-view";
import { useSprintMigrationStatus } from "@/lib/sprints/migration-status";
import { seriesFor, todayIso } from "@/lib/sprints/series";
import { removeSprintWithSeries, updateSprint } from "@/lib/sprints/store";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { carryOverLine, closeSprint, type ClosedSprint } from "@/app/(tools)/sprint/close";
import { toMarkdown } from "./markdown";
import { velocityPrompts } from "./prompts";
import { changepointMarkers as buildChangepointMarkers } from "./changepoints";
import { forecastChartText, velocityChartText } from "./chart-text";
import type { VelocityChartRow } from "./charts";
import { buildExample, type VelocityExample } from "./example";
import { SprintRow, validatePoints } from "./sprint-row";
import { velocityVerdict } from "./verdict";
import {
  completedPointsPatch,
  finishedRows,
  nextSprintDates,
  perDayText,
  statusLabel,
  toVelocityRows,
  velocitySummary,
} from "./view";

// Recharts loads with the chart, not the page; the chart boxes reserve the
// space while it does.
const VelocityChart = dynamic(() => import("./charts").then((m) => m.VelocityChart), {
  ssr: false,
});
const ForecastChart = dynamic(() => import("./charts").then((m) => m.ForecastChart), {
  ssr: false,
});

const NO_PLANS: CapacityPlan[] = [];
const NO_STORIES: Story[] = [];
const NO_SERIES: SprintSeries[] = [];

const TITLE = "Velocity Tracker";
const DESCRIPTION =
  "Your team's velocity from the shared sprints: the last three finished sprints, graded say/do and points per person-day.";

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where a new sprint came from, for its history event. */
type NewSprintSource = "add" | "plan";

/**
 * Velocity over the shared sprints: each row IS a workspace sprint (the same
 * one Burndown, Burnup, Sprint Comparison and the cockpit show), and an
 * edit writes to it straight away. Closing a sprint goes through the
 * cockpit's close dialog (carry-over, one Undo), never as a side effect of
 * typing points, and new sprints are created through the New sprint dialog
 * only. The example is an in-memory preview and is never saved.
 */
export function VelocityClient() {
  const { log } = useHistoryLogger("velocity");
  const announce = useAnnounce();
  const migration = useSprintMigrationStatus();
  const { sprints: ownSprints, selected, select } = useSelectedSprint();
  const ownPlans = useWorkspaceStore((s) => s.capacityPlans) ?? NO_PLANS;
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const allSeries = useWorkspaceStore((s) => s.sprintSeries) ?? NO_SERIES;
  const [cadence] = useCeremonyCadence();
  const [today] = useState(() => todayIso());

  // The example: read-only, in memory, gone on "Clear example".
  const [example, setExample] = useState<VelocityExample | null>(null);
  const preview = example !== null;
  const sprints = example ? example.sprints : ownSprints;
  const plans = example ? example.capacityPlans : ownPlans;
  const selectedId = example ? example.current.id : selected?.id;

  const [creating, setCreating] = useState<{ source: NewSprintSource; points?: number } | null>(
    null
  );
  const [closingId, setClosingId] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  /* -- Writes ---------------------------------------------------------------- */

  const logUpdate = (id: string, field: string, value: unknown) =>
    log(VELOCITY_ACTIONS.SPRINT_UPDATED, { sprintId: id, field, value });

  const rename = (id: string, name: string) => {
    if (updateSprint(id, { name })) logUpdate(id, "name", name);
  };

  const setGoal = (id: string, goal: string) => {
    if (updateSprint(id, { goal: goal || undefined })) logUpdate(id, "goal", goal);
  };

  const setCommitted = (id: string, n: number) => {
    if (updateSprint(id, { pointsPlanned: n })) logUpdate(id, "committed", n);
  };

  // Points only: closing the sprint is its own, confirmed step.
  const setCompleted = (id: string, n: number | null) => {
    if (updateSprint(id, completedPointsPatch(n))) logUpdate(id, "completed", n);
  };

  const removeSprint = (sprint: Sprint) => {
    let restore: (() => void) | null = null;
    const name = shortName(sprint.name);
    const label = name
      ? `Removed “${name}” from every sprint tool`
      : "Removed a sprint from every sprint tool";
    undoable({
      label,
      apply: () => {
        restore = removeSprintWithSeries(sprint.id);
        log(VELOCITY_ACTIONS.SPRINT_REMOVED, { sprintId: sprint.id, name: sprint.name });
      },
      revert: () => restore?.(),
    });
    announce(label);
  };

  const closing = closingId ? ownSprints.find((s) => s.id === closingId) : undefined;
  // The close just made, so the dialog's finished step can add the goal
  // answer to it (and to its Undo).
  const lastClose = useRef<ClosedSprint | null>(null);

  // The cockpit's close: the sprint, its points and every story it moves
  // are one change with one Undo.
  const confirmClose = (sprintId: string, done: number, carry?: CarryOverPlan) => {
    const current = useWorkspaceStore.getState().sprints.find((s) => s.id === sprintId);
    if (!current) return;
    const closed: { result: ClosedSprint | null } = { result: null };
    const label = `Closed ${current.name} with ${points(done)} done`;
    // The close dialog starts from the board's (or the daily log's) number,
    // not the one typed in the row: say when the close replaced it, so it
    // isn't lost without a word and Undo can bring it back.
    const typed = current.pointsCompleted;
    const replaced =
      typeof typed === "number" && Number.isFinite(typed) && typed !== done
        ? `It replaces the ${points(typed)} typed here.`
        : undefined;
    const description = [carryOverLine(carry), replaced].filter(Boolean).join(" ") || undefined;
    undoable({
      label,
      description,
      apply: () => {
        closed.result = closeSprint(sprintId, done, carry);
      },
      revert: () => closed.result?.revert(),
    });
    const result = closed.result;
    lastClose.current = result;
    if (!result) return;
    log(VELOCITY_ACTIONS.SPRINT_CLOSED, {
      sprintId,
      name: result.sprint.name,
      pointsPlanned: result.sprint.pointsPlanned,
      pointsCompleted: done,
      ...(carry
        ? {
            carryOver: carry.target,
            unfinished: carry.stories.length,
            moved: result.moved,
            ...(result.movedTo ? { movedTo: result.movedTo.id } : {}),
          }
        : {}),
    });
    announce(replaced ? `${label}. ${replaced}` : label);
  };

  const onCreated = (sprint: Sprint) => {
    const source = creating?.source ?? "add";
    setExample(null);
    select(sprint.id);
    log(source === "plan" ? VELOCITY_ACTIONS.NEXT_SPRINT_PLANNED : VELOCITY_ACTIONS.SPRINT_ADDED, {
      sprintId: sprint.id,
      name: sprint.name,
      committed: sprint.pointsPlanned,
    });
    announce(`Added ${sprint.name}`);
  };

  /* -- Derived rows and numbers ---------------------------------------------- */

  const rows = useMemo(
    () => toVelocityRows(sprints, plans, { includeExamples: preview }),
    [sprints, plans, preview]
  );
  const summary = useMemo(
    () => velocitySummary(sprints, plans, { includeExamples: preview }),
    [sprints, plans, preview]
  );
  const verdict = velocityVerdict(rows, summary);
  const sprintById = useMemo(() => new Map(sprints.map((s) => [s.id, s])), [sprints]);

  // Only finished sprints (done, with completed points) feed the analytics:
  // a planned or running sprint would drag the average toward zero.
  const finished = useMemo(() => finishedRows(rows), [rows]);
  const completedSeries = useMemo(() => finished.map((r) => r.completed), [finished]);
  const n = completedSeries.length;

  const showTrend = enoughData(n, "trend");
  const chartData = useMemo<VelocityChartRow[]>(() => {
    // Cancelled sprints stay in the table (to be fixed or removed), not the chart.
    const plotted = rows.filter((r) => r.status !== "cancelled");
    const fit = showTrend ? fitLine(completedSeries) : null;
    const finishedIndex = new Map(finished.map((r, i) => [r.id, i]));
    return plotted.map((r) => {
      const i = finishedIndex.get(r.id);
      const rolling = summary.rolling.get(r.id);
      return {
        name: r.name,
        committed: r.committed,
        completed: i !== undefined ? r.completed : null,
        ...(r.sayDo ? { grade: r.sayDo.grade, sayDoPct: r.sayDo.pct } : {}),
        // The rolling velocity once its window is full.
        ...(i !== undefined && i >= DEFAULT_VELOCITY_WINDOW - 1 && rolling !== undefined
          ? { rollingAvg: rolling }
          : {}),
        ...(fit && i !== undefined
          ? { trend: Math.max(0, Math.round((fit.slope * i + fit.intercept) * 10) / 10) }
          : {}),
      };
    });
  }, [rows, finished, completedSeries, showTrend, summary.rolling]);
  const chartText = useMemo(
    () => velocityChartText(chartData, summary.velocity),
    [chartData, summary.velocity]
  );

  /* -- Advanced analysis: each method only from its minimum sample -------- */

  const forecast = useMemo(
    () => (enoughData(n, "forecast") ? forecastBayesianHolt(completedSeries, 1) : []),
    [n, completedSeries]
  );
  const markers = useMemo(() => buildChangepointMarkers(finished), [finished]);
  const trendTest = useMemo(
    () => (enoughData(n, "trend") ? mannKendall(completedSeries) : null),
    [n, completedSeries]
  );
  const forecastData = useMemo<VelocityChartRow[]>(() => {
    const data: VelocityChartRow[] = finished.map((r) => ({
      name: r.name,
      committed: r.committed,
      completed: r.completed,
    }));
    const fc = forecast[0];
    if (fc && data.length > 0) {
      const last = data[data.length - 1];
      // Bridge the band from the last finished sprint so it starts where
      // history ends. Lower bound 0 rather than collapsing onto the value:
      // with connectNulls Recharts can draw a stray fill triangle otherwise.
      data[data.length - 1] = {
        ...last,
        forecast: last.completed ?? undefined,
        band80Lower: 0,
        band80Upper: last.completed ?? undefined,
      };
      const r1 = (v: number) => Math.round(Math.max(0, v) * 10) / 10;
      data.push({
        name: "Next",
        committed: 0,
        completed: null,
        forecast: r1(fc.yHat),
        band80Lower: r1(fc.lower80),
        band80Upper: r1(fc.upper80),
        forecastOnly: true,
      });
    }
    return data;
  }, [finished, forecast]);
  const forecastText = useMemo(
    () => forecastChartText(forecastData, markers),
    [forecastData, markers]
  );
  const spread = enoughData(n, "distribution") ? stdDev(completedSeries) : null;

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: [
        "Sprint",
        "Status",
        "Goal",
        "Committed",
        "Completed",
        "Say/do %",
        "Points per person-day",
      ],
      rows: rows.map((r) => [
        r.name,
        statusLabel(r.status),
        r.description ?? "",
        r.committed,
        r.completed ?? "",
        r.sayDo ? r.sayDo.pct : "",
        r.perDay ?? "",
      ]),
    }),
    [rows]
  );

  const markdown = useMemo(
    () => toMarkdown(rows, new Date(), { summary, verdict }),
    [rows, summary, verdict]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: TITLE,
      prompts: velocityPrompts(
        finished.map((r) => ({ name: r.name, committed: r.committed, completed: r.completed })),
        {
          velocity: summary.velocity,
          sayDo: {
            count: summary.sayDo.count,
            met: summary.sayDo.byGrade.met,
            pct: summary.sayDo.pct,
          },
          spread,
          trend: trendTest ? trendTest.trend : "not enough sprints to say",
        }
      ),
    }),
    [finished, summary, spread, trendTest]
  );

  /* -- Plan next sprint -------------------------------------------------- */

  const nextDates = useMemo(
    () => nextSprintDates(ownSprints, cadence.sprintLengthDays),
    [ownSprints, cadence.sprintLengthDays]
  );
  const suggested =
    summary.velocity.average === null || preview ? undefined : Math.round(summary.velocity.average);
  const [planDraft, setPlanDraft] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const planInput = useRef<HTMLInputElement>(null);
  const planNext = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validatePoints(planDraft, true);
    if (!check.ok) {
      setPlanError(check.error);
      // Submitted with the button: take the user to the field that's wrong.
      planInput.current?.focus();
      return;
    }
    setPlanError(null);
    // Nothing is saved here: the dialog shows the name, dates and points first.
    setCreating({ source: "plan", points: check.value ?? suggested });
  };

  /* -- Render -------------------------------------------------------------- */

  const newSprintDialog = (
    <NewSprintDialog
      open={creating !== null}
      onOpenChange={(open) => {
        if (!open) setCreating(null);
      }}
      onCreated={(s) => {
        onCreated(s);
        setPlanDraft("");
      }}
      defaultName={nextSprintName(ownSprints)}
      defaultStart={nextDates.start > today ? nextDates.start : today}
      defaultLengthDays={nextDates.lengthDays}
      defaultPoints={creating?.points}
    />
  );

  const closeDialog = closing && (
    <CloseSprintDialog
      open
      onOpenChange={(open) => {
        if (!open) setClosingId(null);
      }}
      sprint={closing}
      series={seriesFor(allSeries, closing.id)}
      mode="close"
      stories={stories}
      sprints={ownSprints}
      nextLengthDays={cadence.sprintLengthDays}
      onConfirm={(done, carry) => confirmClose(closing.id, done, carry)}
      // The finished step's goal answer joins that close, under its Undo.
      onGoalOutcome={(values) => {
        if (lastClose.current?.sprint.id === closing.id) lastClose.current.answerGoal(values);
      }}
    />
  );

  const wrap = (children: React.ReactNode) => (
    <ToolPageWrapper
      toolId="velocity"
      title={TITLE}
      description={DESCRIPTION}
      category="Metrics & Dashboards"
    >
      {children}
      {newSprintDialog}
      {closeDialog}
    </ToolPageWrapper>
  );

  if (migration === "pending" && !example) {
    return wrap(
      <p role="status" className="py-12 text-center text-sm text-sub">
        Loading sprints…
      </p>
    );
  }

  if (rows.length === 0) {
    return wrap(
      <EmptyState
        icon={Activity}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="toolkit"
              onClick={() => setCreating({ source: "add" })}
            >
              <Plus aria-hidden="true" />
              Create your first sprint
            </Button>
            <LoadExampleButton onLoad={() => setExample(buildExample(today))} />
          </div>
        }
      >
        No sprints yet. Add each sprint with the points the team committed to; close it with the
        points it finished. Burndown, Burnup, Sprint Comparison and the cockpit use the same
        sprints.
      </EmptyState>
    );
  }

  const v = summary.velocity;
  const sd = summary.sayDo;
  const pd = summary.perPersonDay;

  return wrap(
    <div ref={exportRef} className="space-y-6">
      {example && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-sub">
            <span>
              Example: four finished sprints and one running, each with a capacity plan. A preview
              only: nothing in it is saved.
            </span>
            <Button
              type="button"
              size="sm"
              variant="toolkit"
              onClick={() => setCreating({ source: "add" })}
            >
              <Plus aria-hidden="true" />
              Start your own
            </Button>
          </div>
        </div>
      )}

      <p className="text-sm font-medium text-text">{verdict}</p>

      {/* ---- Tiles: the shared definitions, each from its minimum sample ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Velocity"
          value={v.average === null ? "—" : fmt(v.average)}
          unit={v.average === null ? undefined : "pts"}
          hint={
            v.average === null
              ? "Close a sprint with its completed points"
              : v.count === 1
                ? "The last finished sprint"
                : `Last ${v.count} finished sprints, by end date`
          }
          icon={Activity}
          iconColor={chartTheme.colors.cyan}
        />
        <StatCard
          label="Met the commitment"
          value={sd.count === 0 ? "—" : `${sd.byGrade.met} of ${sd.count}`}
          hint={
            sd.count === 0
              ? "No finished sprint with a commitment yet"
              : `Last ${plural(sd.count, "sprint")} with a commitment, 90–110% of it · mean ${sd.meanSayDoPct}% · ${sd.byGrade.close} close, ${sd.byGrade.missed} missed, ${sd.byGrade.over} over`
          }
          icon={Target}
          iconColor={chartTheme.colors.green}
        />
        {pd.average !== null && pd.count >= MIN_SAMPLE.average ? (
          <StatCard
            label="Per person-day"
            value={perDayText(pd.average)}
            unit="pts"
            hint={`Last ${plural(pd.count, "sprint")}, from their capacity plans`}
            icon={Users}
            iconColor={chartTheme.colors.purple}
          />
        ) : v.count < MIN_SAMPLE.average ? (
          // Plans can't make up for sprints that haven't finished yet.
          <NotEnoughData
            have={v.count}
            need="average"
            unit={["finished sprint", "finished sprints"]}
            action="Close"
            what="points per person-day"
            className="h-full"
          />
        ) : (
          <div className="flex h-full flex-col gap-1">
            <NotEnoughData
              have={pd.count}
              need="average"
              unit={[
                `capacity plan for the last ${DEFAULT_VELOCITY_WINDOW} sprints`,
                `capacity plans for the last ${DEFAULT_VELOCITY_WINDOW} sprints`,
              ]}
              action="Add"
              what="points per person-day"
              className="flex-1"
            />
            {!preview && (
              <Link
                href="/capacity-planner"
                className="px-1 text-xs text-accent underline-offset-2 hover:underline"
              >
                Plan capacity in Capacity Planner
              </Link>
            )}
          </div>
        )}
        {spread !== null ? (
          <StatCard
            label="Spread"
            value={`±${fmt(spread)}`}
            unit="pts"
            hint={`Standard deviation over ${plural(n, "finished sprint")}`}
            icon={Sigma}
            iconColor={chartTheme.colors.amber}
          />
        ) : (
          <NotEnoughData
            have={n}
            need="distribution"
            unit={["finished sprint", "finished sprints"]}
            action="Close"
            what="the spread"
            className="h-full"
          />
        )}
      </div>

      {/* ---- Chart ---- */}
      <ChartCard
        title="Velocity chart"
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
        <VelocityChart data={chartData} />
      </ChartCard>
      {!showTrend && n > 0 && (
        <NotEnoughData
          have={n}
          need="trend"
          unit={["finished sprint", "finished sprints"]}
          action="Close"
          what="a trend line"
        />
      )}

      {/* ---- Advanced: forecast, change points, trend test ---- */}
      <AdvancedAnalysis summary="Advanced analysis: forecast and trend tests">
        {enoughData(n, "forecast") ? (
          <ChartFigure
            label="Velocity forecast"
            summary={forecastText.summary}
            table={forecastText.table}
            caption="Completed points and the forecast by sprint"
            plotClassName="h-[260px]"
          >
            <ForecastChart data={forecastData} markers={markers} />
          </ChartFigure>
        ) : (
          <NotEnoughData
            have={n}
            need="forecast"
            unit={["finished sprint", "finished sprints"]}
            action="Close"
            what="a forecast of the next sprint"
          />
        )}
        {!enoughData(n, "changePoint") && (
          <NotEnoughData
            have={n}
            need="changePoint"
            unit={["finished sprint", "finished sprints"]}
            action="Close"
            what="change points (CUSUM)"
          />
        )}
        {trendTest ? (
          <p className="text-sm text-text">
            {trendTest.significant
              ? `Mann-Kendall: velocity is trending ${trendTest.trend} (p = ${trendTest.pValue.toFixed(2)}).`
              : `Mann-Kendall: no significant trend over ${plural(n, "finished sprint")} (p = ${trendTest.pValue.toFixed(2)}).`}
          </p>
        ) : (
          <NotEnoughData
            have={n}
            need="trend"
            unit={["finished sprint", "finished sprints"]}
            action="Close"
            what="a trend test"
          />
        )}
      </AdvancedAnalysis>

      {/* ---- Plan next sprint: through the New sprint dialog ---- */}
      {!example && (
        <SectionCard title="Plan next sprint" titleSize="lg" headerClassName="pb-4" icon={Gauge}>
          <form
            onSubmit={planNext}
            noValidate
            className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,16rem)_auto]"
          >
            <Field
              label="Points to commit"
              hint={
                suggested === undefined
                  ? "Optional. Close a sprint first to get a suggestion from the velocity."
                  : `Optional. Blank: the velocity, ${points(suggested)}.`
              }
              error={planError ?? undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  ref={planInput}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={planDraft}
                  placeholder={suggested === undefined ? "Points" : String(suggested)}
                  onChange={(e) => {
                    setPlanDraft(e.target.value);
                    if (planError) setPlanError(null);
                  }}
                  className="bg-surface-deep border-border text-text font-data"
                />
              )}
            </Field>
            <Button type="submit" size="sm" variant="toolkit" className="gap-1.5 sm:mt-7">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Commit
            </Button>
          </form>
          <p className="mt-2 text-xs text-sub">
            Commit opens the new sprint with its name and dates to check before it is saved.
            {needMore(v.count, "average") > 0 && v.count > 0
              ? ` The velocity is from ${plural(v.count, "sprint")} only, so plan with care.`
              : ""}
          </p>
        </SectionCard>
      )}

      {/* ---- Data table ---- */}
      <SectionCard
        title="Sprint data"
        titleSize="lg"
        headerClassName="pb-4"
        contentClassName="space-y-3"
        actions={
          !example && (
            <Button
              size="sm"
              variant="toolkit"
              onClick={() => setCreating({ source: "add" })}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add sprint
            </Button>
          )
        }
      >
        <p className="px-1 text-xs text-sub">
          These are your shared sprints: changes show in Burndown, Burnup, Sprint Comparison and the
          cockpit too. Oldest first by end date, the order velocity counts them in.
        </p>
        <div className="hidden grid-cols-[1fr_0.6fr_0.6fr_auto] gap-3 border-b border-border px-1 pb-2 sm:grid">
          <span className="text-xs font-medium uppercase tracking-wider text-sub">Sprint</span>
          <span className="text-xs font-medium uppercase tracking-wider text-sub">Committed</span>
          <span className="text-xs font-medium uppercase tracking-wider text-sub">Completed</span>
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
              readOnly={preview}
              today={today}
              onRename={(val) => rename(row.id, val)}
              onGoal={(val) => setGoal(row.id, val)}
              onCommitted={(val) => setCommitted(row.id, val)}
              onCompleted={(val) => setCompleted(row.id, val)}
              onRequestClose={() => {
                select(row.id);
                setClosingId(row.id);
              }}
              onRemove={() => removeSprint(sprint)}
            />
          );
        })}
      </SectionCard>
    </div>
  );
}
