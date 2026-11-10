"use client";

import { useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, BarChart3, Plus } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartFigure } from "@/components/shared/chart-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { nextSprintName } from "@/components/sprints/sprint-picker";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { CloseSprintDialog } from "@/components/sprints/close-sprint-dialog";
import { LoadingSprints } from "@/components/sprints/start";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { targetDoneIn } from "@/lib/retro/actions";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_METRICS_ACTIONS } from "@/lib/history/event-actions";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import { SAY_DO_GRADE_LABEL } from "@/lib/sprints/metrics";
import { points, sprintDayLine, sprintNudges } from "@/lib/sprints/hub-view";
import { sprintTrends, trendTests, type SprintTrendRow } from "@/lib/sprints/trends";
import {
  pickDefaultSprint,
  sprintHref,
  useSelectedSprint,
} from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStatus } from "@/lib/sprints/migration-status";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { seriesFor, todayIso } from "@/lib/sprints/series";
import { updateSprint } from "@/lib/sprints/store";
import { usePersistedLocal } from "@/lib/utils/use-persisted";
import { undoable } from "@/lib/utils/undoable";
import { BoardLevelTools, SprintToolCards } from "./components/tool-cards";
import { Nudges, type SprintNudge } from "./components/nudges";
import { buildExample, type MetricsExample } from "./example";
import { toMarkdown } from "./markdown";
import { trendVerdict } from "./verdict";
import {
  DEFAULT_WINDOW,
  WINDOW_KEY,
  WINDOW_OPTIONS,
  carryOverText,
  churnChartText,
  churnPoints,
  followThroughText,
  normalizeWindow,
  retroFollowThrough,
  sayDoChartText,
  sayDoPoints,
  scopeText,
  sourcesText,
  windowLabel,
  windowSize,
  type TrendWindow,
} from "./view";

const SayDoChart = dynamic(() => import("./charts").then((m) => m.SayDoChart), { ssr: false });
const ChurnChart = dynamic(() => import("./charts").then((m) => m.ChurnChart), { ssr: false });

const TOOL_ID = "sprint-metrics";
const NO_SERIES: SprintSeries[] = [];
const NO_STORIES: Story[] = [];
const NO_BOARDS: RetroBoard[] = [];
const NO_IDS: string[] = [];

/** Migrated sprints the user said look right (this browser only), capped. */
export const CHECKED_SPRINTS_KEY = "agile-toolkit:sprint-metrics:checked";
const CHECKED_CAP = 200;

const isOpen = (s: Sprint) => s.status === "planned" || s.status === "active";

/** The trend table; in the example preview the names are plain text (its sprints aren't the team's). */
const columnsFor = (preview: boolean): DataTableColumn<SprintTrendRow>[] => [
  {
    key: "sprint",
    header: "Sprint",
    primary: true,
    cell: (r) =>
      preview ? (
        <span className="font-medium text-text">{r.sprint.name}</span>
      ) : (
        <Link
          href={sprintHref("/sprint", r.sprint.id)}
          aria-label={`${r.sprint.name} (open in the cockpit)`}
          className="font-medium text-text underline-offset-2 hover:text-accent hover:underline"
        >
          {r.sprint.name}
        </Link>
      ),
  },
  { key: "committed", header: "Committed", align: "right", cell: (r) => r.committed },
  { key: "completed", header: "Completed", align: "right", cell: (r) => r.completed ?? "—" },
  {
    key: "sayDo",
    header: "Say/do",
    cell: (r) =>
      r.sayDo ? `${r.sayDo.pct}% · ${SAY_DO_GRADE_LABEL[r.sayDo.grade]}` : "No commitment",
    sortValue: (r) => r.sayDo?.pct,
  },
  {
    key: "carry",
    header: "Carried over",
    cell: carryOverText,
    sortValue: (r) => r.carryOver.points,
  },
  {
    key: "scope",
    header: "Scope +/−",
    cell: scopeText,
    sortValue: (r) => r.scope.churnPct,
  },
  {
    key: "source",
    header: "Source",
    hiddenBelow: "lg",
    cell: (r) => <span className="text-xs text-sub">{sourcesText(r)}</span>,
  },
];

/**
 * Sprint Metrics: how the team's sprints went over time. Say/do, carry-over
 * and scope churn across the last finished sprints, read from the sprints
 * and their stories' moves (with the typed numbers as a labelled
 * fallback), and beside say/do the retros' follow-through. The current
 * sprint lives in the cockpit; this page links to it and to the sprint
 * tools, and keeps the data checks.
 */
export function SprintMetricsClient() {
  const hydrated = useWorkspaceHydrated();
  const migration = useSprintMigrationStatus();
  const { sprints, select } = useSelectedSprint();
  const allSeries = useWorkspaceStore((s) => s.sprintSeries) ?? NO_SERIES;
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  // The retros, and what their actions were sent to, for the follow-through.
  const retroBoards = useWorkspaceStore((s) => s.retroBoards) ?? NO_BOARDS;
  const impediments = useWorkspaceStore((s) => s.impediments);
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards);
  const [cadence] = useCeremonyCadence();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [creating, setCreating] = useState(false);
  const [example, setExample] = useState<MetricsExample | null>(null);
  const [pointsFor, setPointsFor] = useState<string | null>(null);
  const [storedWindow, setStoredWindow] = usePersistedLocal<unknown>(WINDOW_KEY, DEFAULT_WINDOW);
  const [checkedIds, setCheckedIds] = usePersistedLocal<string[]>(CHECKED_SPRINTS_KEY, NO_IDS);
  const windowChoice = normalizeWindow(storedWindow);
  const windowGroup = useId();

  const preview = example !== null;
  const columns = useMemo(() => columnsFor(preview), [preview]);
  const viewSprints = example ? example.sprints : sprints;
  const viewStories = example ? example.stories : stories;
  const viewSeries = example ? example.series : allSeries;

  const summary = useMemo(
    () =>
      sprintTrends({
        sprints: viewSprints,
        stories: viewStories,
        series: viewSeries,
        window: windowSize(windowChoice),
        includeExamples: preview,
      }),
    [viewSprints, viewStories, viewSeries, windowChoice, preview]
  );
  const verdict = trendVerdict(summary);
  // Not in the example: its sprints have no retros of their own.
  const followThrough = useMemo(
    () =>
      preview
        ? undefined
        : retroFollowThrough(
            retroBoards,
            windowSize(windowChoice),
            targetDoneIn({ impediments, kanbanBoards, stories })
          ),
    [preview, retroBoards, windowChoice, impediments, kanbanBoards, stories]
  );
  const tests = useMemo(() => trendTests(summary), [summary]);
  const n = summary.rows.length;
  const charts = enoughData(n, "average");

  const current = example ? example.current : pickDefaultSprint(sprints, null);
  const running = current && isOpen(current) ? current : undefined;

  const checked = useMemo(() => new Set(Array.isArray(checkedIds) ? checkedIds : []), [checkedIds]);
  const nudges = useMemo<SprintNudge[]>(
    () =>
      preview
        ? []
        : sprints.flatMap((s) => {
            const series = seriesFor(allSeries, s.id);
            const kinds = sprintNudges(s, series, checked);
            return kinds.length > 0 ? [{ sprint: s, series, kinds }] : [];
          }),
    [preview, sprints, allSeries, checked]
  );

  const chooseWindow = (w: TrendWindow) => {
    setStoredWindow(w);
    announce(`Showing ${windowLabel(w).toLowerCase()}`);
  };

  const onCreated = (sprint: Sprint) => {
    setExample(null);
    select(sprint.id);
    log(SPRINT_METRICS_ACTIONS.SPRINT_CREATED, {
      sprintId: sprint.id,
      name: sprint.name,
      pointsPlanned: sprint.pointsPlanned,
      status: sprint.status,
    });
    announce(`Added ${sprint.name}`);
  };

  const markChecked = (sprint: Sprint) => {
    setCheckedIds((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.includes(sprint.id) ? list : [...list, sprint.id].slice(-CHECKED_CAP);
    });
    announce(`${sprint.name} marked as checked`);
  };

  // Points for a finished sprint that has none, with Undo; it isn't a close.
  const pointsSprint = pointsFor ? sprints.find((s) => s.id === pointsFor) : undefined;
  const addPoints = (sprint: Sprint, done: number) => {
    const before = useWorkspaceStore.getState().sprints.find((s) => s.id === sprint.id);
    if (!before) return;
    const label = `Added ${points(done)} to ${sprint.name}`;
    undoable({
      label,
      apply: () => {
        updateSprint(sprint.id, { pointsCompleted: done });
      },
      revert: () => useWorkspaceStore.getState().upsertSprint(before),
    });
    announce(label);
  };

  const markdown = useMemo(
    () => toMarkdown(summary, { verdict, followThrough }),
    [summary, verdict, followThrough]
  );
  const jsonData = useMemo(
    () => ({
      window: summary.window,
      finishedCount: summary.finishedCount,
      rows: summary.rows,
      sayDo: summary.sayDo,
      carryOver: summary.carryOver,
      churn: summary.churn,
      ...(followThrough ? { retroFollowThrough: followThrough } : {}),
    }),
    [summary, followThrough]
  );
  const sayDoText = useMemo(() => sayDoChartText(summary), [summary]);
  const churnText = useMemo(() => churnChartText(summary), [summary]);
  const sayDoData = useMemo(() => sayDoPoints(summary), [summary]);
  const churnData = useMemo(() => churnPoints(summary), [summary]);

  const newSprintDialog = (
    <NewSprintDialog
      open={creating}
      onOpenChange={setCreating}
      onCreated={onCreated}
      defaultName={nextSprintName(sprints)}
      defaultLengthDays={cadence.sprintLengthDays}
    />
  );

  const wrap = (children: React.ReactNode) => (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Sprint Metrics"
      description="How your sprints went over time: say/do, carry-over and scope churn across the last finished sprints."
      category="Metrics & Dashboards"
    >
      {children}
      {newSprintDialog}
      {pointsSprint && (
        <CloseSprintDialog
          open
          onOpenChange={(open) => {
            if (!open) setPointsFor(null);
          }}
          sprint={pointsSprint}
          series={seriesFor(allSeries, pointsSprint.id)}
          mode="points"
          onConfirm={(done) => addPoints(pointsSprint, done)}
        />
      )}
    </ToolPageWrapper>
  );

  if (!hydrated || migration === "pending") return wrap(<LoadingSprints />);

  if (!example && sprints.length === 0) {
    return wrap(
      <div className="space-y-6">
        <EmptyState
          icon={BarChart3}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" variant="toolkit" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" />
                Create your first sprint
              </Button>
              <LoadExampleButton onLoad={() => setExample(buildExample(today))} />
            </div>
          }
        >
          No sprints yet. Once a few are closed with their points, this page shows how often the
          team met its commitment, what it carried over and how much its scope changed.
        </EmptyState>
        <BoardLevelTools />
      </div>
    );
  }

  return wrap(
    <div className="space-y-6">
      {example && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-sub">
            <span>
              Example: six closed sprints and their stories. A preview only: nothing in it is saved.
            </span>
            <Button type="button" size="sm" variant="toolkit" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              Start your own
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p id={windowGroup} className="mb-1 text-xs font-medium text-sub">
            Look back over
          </p>
          <div role="group" aria-labelledby={windowGroup} className="flex flex-wrap gap-1">
            {WINDOW_OPTIONS.map((w) => (
              <Button
                key={String(w)}
                type="button"
                size="sm"
                variant={windowChoice === w ? "default" : "outline"}
                aria-pressed={windowChoice === w}
                onClick={() => chooseWindow(w)}
              >
                {windowLabel(w)}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!example && (
            <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              New sprint
            </Button>
          )}
          <ExportButton filename="sprint-trends" markdown={markdown} jsonData={jsonData} />
        </div>
      </div>

      {running && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <p className="min-w-0 flex-1 text-text">
            <span className="font-medium">{running.name}</span>{" "}
            {running.status === "active" ? "is running" : "is planned"} ·{" "}
            {sprintDayLine(running, today)}. Its burndown, blockers and close live in the cockpit.
          </p>
          {!example && (
            <Link
              href={sprintHref("/sprint", running.id)}
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              Open the cockpit
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}

      {verdict ? (
        <p className="text-sm font-medium text-text">{verdict}</p>
      ) : (
        <NotEnoughData
          have={n}
          need="average"
          unit={["sprint with its points", "sprints with their points"]}
          action="Close"
          what="the trend"
        />
      )}

      {!preview && (
        <Nudges items={nudges} onAddPoints={(s) => setPointsFor(s.id)} onLooksRight={markChecked} />
      )}

      {charts && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Say/do by sprint" titleSize="base">
            <ChartFigure
              label="Say/do by sprint"
              summary={sayDoText.summary}
              table={sayDoText.table}
              plotClassName="h-[240px]"
            >
              <SayDoChart data={sayDoData} />
            </ChartFigure>
          </SectionCard>
          <SectionCard title="Carry-over and scope change" titleSize="base">
            <ChartFigure
              label="Carry-over and scope change by sprint"
              summary={churnText.summary}
              table={churnText.table}
              plotClassName="h-[240px]"
            >
              <ChurnChart data={churnData} />
            </ChartFigure>
          </SectionCard>
        </div>
      )}

      {n > 0 && (
        <SectionCard title="Finished sprints" titleSize="base">
          <p className="mb-3 text-xs text-sub">
            {summary.window === null
              ? `All ${n} finished sprints`
              : `The last ${n} of ${summary.finishedCount} finished sprints`}
            , oldest first by end date.{preview ? "" : " Each opens in the cockpit."}
          </p>
          <DataTable columns={columns} rows={summary.rows} rowKey={(r) => r.sprint.id} />
          {charts && (
            <dl
              className={`mt-4 grid gap-3 border-t border-border pt-3 text-sm ${
                followThrough ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
              }`}
            >
              <div>
                <dt className="text-xs text-sub">Say/do</dt>
                <dd className="text-text">
                  {summary.sayDo.meanPct === null ? "—" : `${summary.sayDo.meanPct}% on average`} ·{" "}
                  {summary.sayDo.met} met, {summary.sayDo.close} close, {summary.sayDo.missed}{" "}
                  missed, {summary.sayDo.over} over
                </dd>
              </div>
              {followThrough && (
                <div data-field="retro-follow-through">
                  <dt className="text-xs text-sub">Retro follow-through</dt>
                  <dd className="text-text">
                    {followThroughText(followThrough)}
                    {followThrough.retros > 0 && (
                      <>
                        {" · "}
                        <Link href="/retro-actions" className="text-accent hover:underline">
                          Retro Actions
                        </Link>
                      </>
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-sub">Carry-over</dt>
                <dd className="text-text">
                  {summary.carryOver.meanPoints === null
                    ? "Not enough sprints say yet"
                    : `${summary.carryOver.meanPoints} points a sprint`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-sub">Scope churn</dt>
                <dd className="text-text">
                  {summary.churn.meanPct === null
                    ? "Not enough sprints record it yet"
                    : `${summary.churn.meanPct}% of the commitment`}
                </dd>
              </div>
            </dl>
          )}
        </SectionCard>
      )}

      {n > 0 && (
        <AdvancedAnalysis summary="Advanced analysis: is it drifting?">
          {tests.sayDo ? (
            <p className="text-sm text-text">
              Say/do:{" "}
              {tests.sayDo.significant
                ? `trending ${tests.sayDo.trend} (Mann-Kendall, p = ${tests.sayDo.pValue.toFixed(2)}).`
                : `no significant trend (Mann-Kendall, p = ${tests.sayDo.pValue.toFixed(2)}).`}
            </p>
          ) : (
            <NotEnoughData
              have={summary.sayDo.considered}
              need="trend"
              unit={["sprint with a commitment", "sprints with a commitment"]}
              action="Close"
              what="whether say/do is drifting"
            />
          )}
          {tests.churn ? (
            <p className="text-sm text-text">
              Scope churn:{" "}
              {tests.churn.significant
                ? `trending ${tests.churn.trend} (Mann-Kendall, p = ${tests.churn.pValue.toFixed(2)}).`
                : `no significant trend (Mann-Kendall, p = ${tests.churn.pValue.toFixed(2)}).`}
            </p>
          ) : (
            <NotEnoughData
              have={summary.churn.count}
              need="trend"
              unit={["sprint with a scope record", "sprints with a scope record"]}
              action="Close"
              what="whether scope churn is drifting"
            />
          )}
          <p className="text-xs text-sub">
            A trend needs {MIN_SAMPLE.trend} sprints; pick a longer window above to include more.
          </p>
        </AdvancedAnalysis>
      )}

      <SprintToolCards sprintId={example ? undefined : running?.id} />
      <BoardLevelTools />
    </div>
  );
}
