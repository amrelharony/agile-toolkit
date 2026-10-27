"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { Clock, FileUp, GitPullRequest, Layers, Pencil, Trash2, TrendingUp } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ChartCard, ChartFigure } from "@/components/shared/chart-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { generateCodeReviewPrompts } from "@/lib/ai-prompts/code-review-metrics";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { xmrLimits } from "@/lib/analytics/control-chart";
import { enoughData, needMore } from "@/lib/analytics/min-sample";
import { periodLabel } from "@/lib/analytics/periods";
import { mannKendall } from "@/lib/analytics/trend-test";
import { plural } from "@/lib/charts/chart-text";
import { CODE_REVIEW_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  CODE_REVIEW_LOG_ID,
  formatReviewHours,
  newSampleId,
  reviewSummary,
  reviewTimes,
  reviewVerdict,
  sampleFromDraft,
  windowMinutes,
  workingBasisLabel,
  type ReviewTimes,
} from "@/lib/quality/review";
import { cadenceCalendar, normalizeCadence } from "@/lib/sprints/cadence";
import { selectCadenceDoc } from "@/lib/sprints/use-ceremony-cadence";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  CodeReviewLog,
  CodeReviewWorkingWindow,
  PrSample,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { CsvImport } from "./csv-import";
import { buildExample } from "./example";
import { reviewMarkdown } from "./markdown";
import { SampleForm, type SampleDraftText } from "./sample-form";
import {
  bandChartText,
  hoursText,
  scatterText,
  stateText,
  weeklyChartText,
  whenText,
  type ScatterPoint,
} from "./view";
import { WorkingWindowForm } from "./working-window";

// Recharts loads with each chart, not the page. The fixed-height boxes
// reserve the space while the chunk loads.
const BandChart = dynamic(() => import("./charts").then((m) => m.BandChart), { ssr: false });
const WeeklyMedianChart = dynamic(() => import("./charts").then((m) => m.WeeklyMedianChart), {
  ssr: false,
});
const PrSizeScatterChart = dynamic(() => import("./charts").then((m) => m.PrSizeScatterChart), {
  ssr: false,
});

// A stable empty list: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NONE: PrSample[] = [];

/** Weeks with a median before the weekly line is drawn: one point is the verdict's job. */
const CHART_MIN_WEEKS = 2;

type Write = (fn: (log: CodeReviewLog) => CodeReviewLog) => void;

const storedLog = () =>
  (useWorkspaceStore.getState().codeReviewLogs ?? []).find((d) => d.id === CODE_REVIEW_LOG_ID) ??
  null;

const samplesOf = (log: CodeReviewLog | null | undefined) =>
  Array.isArray(log?.samples) ? log.samples : NONE;

/**
 * The synced singleton (CODE_REVIEW_LOG_ID) that agents write too. Every
 * write starts from the stored log and spreads it, so the working window an
 * agent set (set_working_window) is kept; the old hook upserted
 * {id, samples} and erased it.
 */
function useCodeReviewLog(): [CodeReviewLog | null, Write] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.codeReviewLogs ?? []).find((d) => d.id === CODE_REVIEW_LOG_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertCodeReviewLog);
  const write: Write = (fn) => {
    const cur = storedLog();
    const base: CodeReviewLog = cur
      ? { ...cur, samples: samplesOf(cur) }
      : { id: CODE_REVIEW_LOG_ID, samples: [] };
    const next = fn(base);
    if (next !== base) upsert({ ...next, id: CODE_REVIEW_LOG_ID });
  };
  return [doc ?? null, write];
}

/** Focus the Edit button of PR `id` (the one on screen: the table's or its phone card's). */
function focusEditButton(id: string) {
  requestAnimationFrame(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("[data-edit-pr]")).filter(
      (el) => el.getAttribute("data-edit-pr") === id
    );
    (buttons.find((el) => el.getClientRects().length > 0) ?? buttons[0])?.focus();
  });
}

const finite = (xs: readonly (number | null)[]) =>
  xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

const prName = (s: PrSample) =>
  s.prNumber ? `PR ${s.prNumber}` : `the PR opened ${whenText(s.openedAt)}`;

interface Row {
  sample: PrSample;
  times: ReviewTimes;
}

export function CodeReviewMetricsClient() {
  const [stored, writeStored] = useCodeReviewLog();
  const today = todayLocalISO();
  // The team calendar: the ceremony cadence's working days and holidays.
  const cadence = useWorkspaceStore(selectCadenceDoc);
  const calendar = useMemo(() => cadenceCalendar(normalizeCadence(cadence)), [cadence]);
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<CodeReviewLog | null>(null);
  const preview = example !== null;
  const doc = example ?? stored;
  const samples = samplesOf(doc);
  const workingWindow = doc?.workingWindow;
  const win = windowMinutes(workingWindow);
  // Bound to the mode the change was made in, so an Undo lands where it
  // was made even if the example is loaded or cleared in between.
  const write: Write = preview ? (fn) => setExample((ex) => (ex ? fn(ex) : ex)) : writeStored;
  const newId = () => (preview ? exampleId(`pr-${nanoid(6)}`) : newSampleId());

  const { log: logHistory } = useHistoryLogger("code-review-metrics");
  // The example's edits aren't the team's history, so they aren't logged.
  const log: typeof logHistory = (...args) => {
    if (!preview) logHistory(...args);
  };
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const summary = useMemo(() => reviewSummary(samples, calendar, win), [samples, calendar, win]);
  const rows: Row[] = useMemo(
    () => samples.map((sample) => ({ sample, times: reviewTimes(sample, calendar, win) })),
    [samples, calendar, win]
  );
  const verdict = reviewVerdict(summary);
  const basis = workingBasisLabel(calendar, workingWindow);
  const h = summary.headline;
  const editing = samples.find((s) => s.id === editingId);

  /* ── Changes ── */

  function add(draft: SampleDraftText) {
    // datetime-local values are this browser's wall-clock already.
    const sample = sampleFromDraft(draft, newId());
    write((d) => ({ ...d, samples: [...d.samples, sample] }));
    log(CODE_REVIEW_ACTIONS.PR_LOGGED, {
      sampleId: sample.id,
      prNumber: sample.prNumber,
      reviewerCount: sample.reviewerCount,
      commentCount: sample.commentCount,
      linesChanged: sample.linesChanged,
    });
    announce(`Logged ${prName(sample)}`);
  }

  function save(s: PrSample, draft: SampleDraftText) {
    const next = sampleFromDraft(draft, s.id);
    const keys = [...Object.keys(s), ...Object.keys(next)] as (keyof PrSample)[];
    const fields = keys.filter((k, i) => keys.indexOf(k) === i && next[k] !== s[k]);
    closeEditor(s.id);
    if (fields.length === 0) return;
    write((d) => ({ ...d, samples: d.samples.map((x) => (x.id === s.id ? next : x)) }));
    log(CODE_REVIEW_ACTIONS.PR_UPDATED, { sampleId: s.id, fields });
    announce(`Saved ${prName(next)}`);
  }

  function closeEditor(id: string) {
    setEditingId(null);
    focusEditButton(id);
  }

  function remove(s: PrSample) {
    if (editingId === s.id) setEditingId(null);
    removeWithUndo<PrSample>({
      label: `Deleted ${prName(s)}`,
      update: (fn) => write((d) => ({ ...d, samples: fn(d.samples) })),
      match: (x) => x.id === s.id,
    });
    log(CODE_REVIEW_ACTIONS.PR_REMOVED, { sampleId: s.id, prNumber: s.prNumber });
    announce(`Deleted ${prName(s)}`);
  }

  function importRows(added: PrSample[], skipped: number) {
    const ids = new Set(added.map((s) => s.id));
    undoable({
      label: `Imported ${plural(added.length, "pull request")}`,
      apply: () => {
        write((d) => ({ ...d, samples: [...d.samples, ...added] }));
        log(CODE_REVIEW_ACTIONS.PRS_IMPORTED, { added: added.length, skipped });
      },
      revert: () => write((d) => ({ ...d, samples: d.samples.filter((s) => !ids.has(s.id)) })),
    });
    announce(`Imported ${plural(added.length, "pull request")}`);
  }

  function setWindow(next: CodeReviewWorkingWindow | null) {
    write((d) => {
      const out: CodeReviewLog = { ...d };
      if (next) out.workingWindow = next;
      else delete out.workingWindow;
      return out;
    });
    log(
      CODE_REVIEW_ACTIONS.WORKING_WINDOW_CHANGED,
      next ? { start: next.start, end: next.end } : {}
    );
    announce(
      next
        ? `Counting ${next.start}–${next.end} of each working day`
        : "Counting whole working days"
    );
  }

  /** Each "Delete all" keeps what it took for its own Undo; the working window stays. */
  function deleteAll() {
    const removed = samplesOf(preview ? example : storedLog());
    setEditingId(null);
    undoable({
      label: `Deleted ${plural(removed.length, "pull request")}`,
      apply: () => {
        write((d) => ({ ...d, samples: [] }));
        log(CODE_REVIEW_ACTIONS.CODE_REVIEW_RESET, { samples: removed.length });
      },
      revert: () =>
        write((d) => ({
          ...d,
          samples: [...removed.filter((r) => !d.samples.some((x) => x.id === r.id)), ...d.samples],
        })),
    });
  }

  /* ── Exports ── */

  const promptConfig = useMemo(
    () => ({
      toolName: "Code Review Metrics",
      prompts: generateCodeReviewPrompts({
        samples: rows.map(({ sample: s, times }) => ({
          prNumber: s.prNumber,
          author: s.author,
          cycleHours: times.cycleWorkingH,
          reviewerCount: s.reviewerCount,
          commentCount: s.commentCount,
          linesChanged: s.linesChanged,
          description: s.description,
        })),
        // The median working cycle (the page's headline), not a mean.
        avgCycleHours: h.medianCycleWorkingH,
        avgReviewDepth: samples.length
          ? samples.reduce((a, s) => a + s.commentCount, 0) / samples.length
          : 0,
        avgPrSize: samples.length
          ? samples.reduce((a, s) => a + s.linesChanged, 0) / samples.length
          : 0,
        unmerged: summary.open,
      }),
    }),
    [rows, samples, h.medianCycleWorkingH, summary.open]
  );

  const csvData = {
    headers: [
      "PR Number",
      "Author",
      "Opened At",
      "First Review At",
      "Merged At",
      "Hours to first review (working)",
      "Cycle hours (working)",
      "Cycle hours (elapsed)",
      "Reviewer Count",
      "Comment Count",
      "Lines Changed",
      "Description",
    ],
    rows: rows.map(({ sample: s, times: t }) => [
      s.prNumber ?? "",
      s.author,
      s.openedAt,
      s.firstReviewAt ?? "",
      s.mergedAt ?? "",
      t.toFirstReviewWorkingH === null ? "" : formatReviewHours(t.toFirstReviewWorkingH),
      t.cycleWorkingH === null ? "" : formatReviewHours(t.cycleWorkingH),
      t.cycleH === null ? "" : formatReviewHours(t.cycleH),
      s.reviewerCount,
      s.commentCount,
      s.linesChanged,
      s.description ?? "",
    ]),
  };

  /* ── Charts ── */

  const bandChart = bandChartText(summary.bySize);
  const weekly = summary.weekly;
  const weeklyChart = weeklyChartText(weekly);
  const timedWeeks = weekly.filter((w) => w.medianCycleWorkingH !== null);
  const weeklyData = weekly.map((w) => ({
    week: w.week.slice(5),
    median: w.medianCycleWorkingH === null ? null : Math.round(w.medianCycleWorkingH * 10) / 10,
  }));
  const scatter: ScatterPoint[] = rows.flatMap(({ sample: s, times: t }) =>
    t.cycleWorkingH === null
      ? []
      : [
          {
            label: s.prNumber ?? whenText(s.openedAt),
            linesChanged: s.linesChanged,
            cycleWorkingH: t.cycleWorkingH,
          },
        ]
  );
  const scatterChart = scatterText(scatter);

  // Advanced: bootstrap intervals from MIN_SAMPLE.distribution merges; the
  // weekly medians' control limits and trend from their own minimums.
  const cycles = finite(rows.map((r) => r.times.cycleWorkingH));
  const intervals = enoughData(cycles.length, "distribution")
    ? { p50: bootstrapQuantile(cycles, 0.5), p85: bootstrapQuantile(cycles, 0.85) }
    : null;
  const medians = finite(timedWeeks.map((w) => w.medianCycleWorkingH));
  const control = enoughData(medians.length, "changePoint") ? xmrLimits(medians, true) : null;
  const trend = enoughData(medians.length, "trend") ? mannKendall(medians) : null;

  const columns: DataTableColumn<Row>[] = [
    {
      key: "pr",
      header: "PR",
      primary: true,
      cell: (r) => r.sample.prNumber ?? <span className="text-sub">No number</span>,
    },
    { key: "author", header: "Author", cell: (r) => r.sample.author },
    {
      key: "opened",
      header: "Opened",
      sortValue: (r) => r.sample.openedAt,
      cell: (r) => <span className="font-data">{whenText(r.sample.openedAt)}</span>,
    },
    {
      key: "review",
      header: "First review",
      hiddenBelow: "lg",
      cell: (r) => (
        <span className="font-data">
          {whenText(r.sample.firstReviewAt)}
          {r.times.reviewOutOfOrder && <span className="ml-1 text-warning">(out of order)</span>}
        </span>
      ),
    },
    {
      key: "merged",
      header: "Merged",
      hiddenBelow: "lg",
      cell: (r) => <span className="font-data">{whenText(r.sample.mergedAt)}</span>,
    },
    {
      key: "state",
      header: "Cycle",
      sortValue: (r) => r.times.cycleWorkingH,
      cell: (r) => (
        <span className={r.times.status === "invalid" ? "text-warning" : "font-data"}>
          {stateText(r.times)}
        </span>
      ),
    },
    {
      key: "lines",
      header: "Lines",
      align: "right",
      sortValue: (r) => r.sample.linesChanged,
      cell: (r) => <span className="font-data">{r.sample.linesChanged}</span>,
    },
    {
      key: "comments",
      header: "Comments",
      align: "right",
      hiddenBelow: "lg",
      cell: (r) => <span className="font-data">{r.sample.commentCount}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-edit-pr={r.sample.id}
            aria-label={`Edit ${prName(r.sample)}`}
            aria-expanded={editingId === r.sample.id}
            onClick={() => setEditingId(r.sample.id)}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <IconButton
            label={`Delete ${prName(r.sample)}`}
            icon={<Trash2 aria-hidden="true" />}
            onClick={() => remove(r.sample)}
            className="text-sub hover:text-danger"
          />
        </span>
      ),
    },
  ];

  const medianHint = (count: number, elapsed: number | null, what: string) =>
    enoughData(count, "average")
      ? `${hoursText(elapsed)} elapsed · ${plural(count, "PR")}`
      : `Shows once ${needMore(count, "average")} more ${what}`;

  return (
    <ToolPageWrapper
      toolId="code-review-metrics"
      title="Code Review Metrics"
      description="Log pull requests by hand or paste a CSV to see time to first review and cycle time in working hours, and how review flows by PR size for the team."
      category="Quality Engineering"
    >
      <div ref={exportRef} className="space-y-6">
        {preview && (
          <ExampleNotice
            onClear={() => {
              setExample(null);
              setEditingId(null);
            }}
          />
        )}

        <SectionCard title="Log a pull request" icon={GitPullRequest}>
          <SampleForm key={preview ? "example" : "saved"} samples={samples} onSave={add} />
        </SectionCard>

        <SectionCard title="Import from CSV" icon={FileUp}>
          <CsvImport
            key={preview ? "example" : "saved"}
            existing={samples}
            newId={newId}
            onImport={importRows}
          />
        </SectionCard>

        <SectionCard title="Working hours" icon={Clock} contentClassName="space-y-3">
          <p className="text-sm text-text" id="working-hours-basis">
            Times count <strong>{basis}</strong>. Working days and holidays come from the
            team&apos;s ceremony cadence; set the hours of a working day here, or leave them blank
            to count whole days.
          </p>
          <WorkingWindowForm
            key={`${preview ? "example" : "saved"}:${workingWindow?.start ?? ""}-${workingWindow?.end ?? ""}`}
            window={workingWindow}
            onSave={(w) => setWindow(w)}
            onClear={() => setWindow(null)}
          />
        </SectionCard>

        {samples.length === 0 ? (
          <EmptyState
            icon={GitPullRequest}
            action={<LoadExampleButton onLoad={() => setExample(buildExample(today))} />}
          >
            No pull requests logged yet. Log one above or paste a CSV, or load an example of eight
            weeks of reviews.
          </EmptyState>
        ) : (
          <>
            <p className="text-sm font-medium text-text">{verdict}</p>

            <div className="space-y-2">
              <KpiGrid cols={4}>
                <StatCard
                  variant="compact"
                  icon={Clock}
                  label="Median time to first review"
                  value={hoursText(h.medianFirstReviewWorkingH)}
                  hint={medianHint(
                    summary.firstReview.count,
                    h.medianFirstReviewH,
                    "PRs with a first review"
                  )}
                  valueClassName="text-accent"
                />
                <StatCard
                  variant="compact"
                  icon={Clock}
                  label="Median cycle time"
                  value={hoursText(h.medianCycleWorkingH)}
                  hint={medianHint(summary.cycle.count, h.medianCycleH, "merged PRs")}
                  valueClassName="text-accent"
                />
                <StatCard
                  variant="compact"
                  icon={Clock}
                  label="P85 cycle time"
                  value={hoursText(h.p85CycleWorkingH)}
                  hint={
                    enoughData(summary.cycle.count, "distribution")
                      ? "85% merge within this"
                      : `Shows once ${needMore(summary.cycle.count, "distribution")} more merged PRs`
                  }
                />
                <StatCard
                  variant="compact"
                  icon={GitPullRequest}
                  label="Still open"
                  value={summary.open}
                  hint={
                    summary.awaitingReview > 0
                      ? `${summary.awaitingReview} awaiting a first review`
                      : `${summary.merged} merged`
                  }
                />
              </KpiGrid>
              <p className="text-xs text-sub">
                In working hours: {basis}.
                {summary.invalid > 0 &&
                  ` ${plural(summary.invalid, "PR")} with dates out of order ${summary.invalid === 1 ? "is" : "are"} counted but not timed: edit ${summary.invalid === 1 ? "it" : "them"} below.`}
              </p>
            </div>

            <SectionCard title="Review flow by PR size" icon={Layers} contentClassName="space-y-4">
              {summary.largeNoComments > 0 && (
                <CalloutAlert tone="warning">
                  {plural(summary.largeNoComments, "large PR")} (over 400 lines){" "}
                  {summary.largeNoComments === 1 ? "was" : "were"} merged with no review comment.
                </CalloutAlert>
              )}
              <ChartFigure
                label="Median working hours by PR size"
                summary={bandChart.summary}
                table={bandChart.table}
                plotClassName="h-[220px]"
              >
                <BandChart
                  data={summary.bySize.map((b) => ({
                    band: b.label,
                    firstReview:
                      b.medianFirstReviewWorkingH === null
                        ? null
                        : Math.round(b.medianFirstReviewWorkingH * 10) / 10,
                    cycle:
                      b.medianCycleWorkingH === null
                        ? null
                        : Math.round(b.medianCycleWorkingH * 10) / 10,
                  }))}
                />
              </ChartFigure>
            </SectionCard>

            <SectionCard title="Weekly median cycle time" icon={TrendingUp}>
              {timedWeeks.length >= CHART_MIN_WEEKS ? (
                <ChartFigure
                  label="Median working cycle time per week"
                  summary={weeklyChart.summary}
                  table={weeklyChart.table}
                  plotClassName="h-[220px]"
                >
                  <WeeklyMedianChart data={weeklyData} />
                </ChartFigure>
              ) : (
                <NotEnoughData
                  have={timedWeeks.length}
                  need={CHART_MIN_WEEKS}
                  unit={["week with three merges", "weeks with three merges"]}
                  action="Log"
                  what="the weekly median"
                />
              )}
            </SectionCard>

            <SectionCard
              title={`Logged pull requests (${samples.length})`}
              icon={GitPullRequest}
              contentClassName="space-y-4"
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="code-review-metrics"
                    csvData={csvData}
                    jsonData={doc}
                    markdown={reviewMarkdown(doc, calendar)}
                    targetRef={exportRef}
                  />
                  <Button
                    type="button"
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteAll(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete all
                  </Button>
                  <ConfirmDialog
                    open={confirmDeleteAll}
                    onOpenChange={setConfirmDeleteAll}
                    title={
                      samples.length === 1
                        ? "Delete the 1 pull request?"
                        : `Delete all ${samples.length} pull requests?`
                    }
                    description="The log starts again from nothing, for agents too. The working hours are kept."
                    confirmLabel="Delete all"
                    onConfirm={deleteAll}
                  />
                </>
              }
            >
              <DataTable
                caption="Logged pull requests"
                columns={columns}
                rows={rows}
                rowKey={(r) => r.sample.id}
                defaultSort={{ key: "opened", dir: "desc" }}
              />
              {editing && (
                <EditPanel key={editing.id} title={`Edit ${prName(editing)}`}>
                  <SampleForm
                    samples={samples}
                    editing={editing}
                    onSave={(d) => save(editing, d)}
                    onCancel={() => closeEditor(editing.id)}
                  />
                </EditPanel>
              )}
            </SectionCard>

            {scatter.length > 0 && (
              <ChartCard
                title="PR size against working hours to merge"
                icon={Layers}
                height={280}
                summary={scatterChart.summary}
                table={scatterChart.table}
              >
                <PrSizeScatterChart data={scatter} />
              </ChartCard>
            )}

            <AdvancedAnalysis>
              {intervals ? (
                <p className="text-sm text-text">
                  Bootstrap 95% intervals over {plural(cycles.length, "merged PR")}: the median
                  cycle lies between {hoursText(intervals.p50.lower)} and{" "}
                  {hoursText(intervals.p50.upper)} of working time, and P85 between{" "}
                  {hoursText(intervals.p85.lower)} and {hoursText(intervals.p85.upper)}.
                </p>
              ) : (
                <NotEnoughData
                  have={cycles.length}
                  need="distribution"
                  unit={["merged pull request", "merged pull requests"]}
                  action="Log"
                  what="intervals around the median"
                />
              )}
              {control ? (
                <ChartFigure
                  label="Weekly median cycle time, with control limits"
                  summary={`A week above ${hoursText(control.ucl)} is out of the usual run; the weekly medians average ${hoursText(control.centerLine)}.`}
                  table={weeklyChart.table}
                  plotClassName="h-[220px]"
                >
                  <WeeklyMedianChart data={weeklyData} control={control} />
                </ChartFigure>
              ) : (
                <NotEnoughData
                  have={medians.length}
                  need="changePoint"
                  unit={["week with three merges", "weeks with three merges"]}
                  action="Log"
                  what="control limits on the weekly median"
                />
              )}
              {trend ? (
                <p className="text-sm text-text">
                  Mann-Kendall over {plural(medians.length, "week")}:{" "}
                  {trend.trend === "none" || !trend.significant
                    ? "no clear trend in the weekly median"
                    : `the weekly median is trending ${trend.trend}`}{" "}
                  (p = {trend.pValue.toFixed(3)}), from {periodLabel(timedWeeks[0].week)}.
                </p>
              ) : (
                <NotEnoughData
                  have={medians.length}
                  need="trend"
                  unit={["week with three merges", "weeks with three merges"]}
                  action="Log"
                  what="a trend test"
                />
              )}
            </AdvancedAnalysis>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}

/** The in-place editor under the table, focused when it opens. */
function EditPanel({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, []);
  return (
    <div ref={ref} className="rounded-lg border border-accent/40 bg-card p-3 sm:p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">{title}</h3>
      {children}
    </div>
  );
}
