"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { AlertOctagon, ListChecks, Trash2, TrendingUp } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ChartCard, ChartFigure } from "@/components/shared/chart-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useStableOrder } from "@/hooks/use-stable-order";
import { generateFlakyPrompts } from "@/lib/ai-prompts/flaky-tests";
import { xmrLimits } from "@/lib/analytics/control-chart";
import { enoughData } from "@/lib/analytics/min-sample";
import { mannKendall } from "@/lib/analytics/trend-test";
import { plural } from "@/lib/charts/chart-text";
import { FLAKY_TEST_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  FLAKY_BOARD_ID,
  FLAKY_HIGH_RATE,
  FLAKY_STATUS_LABEL,
  QUARANTINE_ALERT_DAYS,
  applyFlakyStatus,
  flakyRate,
  flakySummary,
  flakyVerdict,
  hasRunCounts,
  ratePercent,
  weeklyNewFlakies,
  withRunCounts,
  worstOffenders,
} from "@/lib/quality/flaky";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FlakyStatus, FlakyTest, FlakyTestBoard } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { buildExample } from "./example";
import { flakyMarkdown } from "./markdown";
import { TestCard } from "./test-card";
import { TestForm, type TestValues } from "./test-form";
import {
  SORT_LABEL,
  compareTests,
  offendersChartText,
  weeklyChartText,
  type SortKey,
} from "./view";

// Recharts loads with each chart, not the page. ChartCard reserves the
// chart's height while the chunk loads.
const FlakiestTestsChart = dynamic(() => import("./charts").then((m) => m.FlakiestTestsChart), {
  ssr: false,
});
const WeeklyNewChart = dynamic(() => import("./charts").then((m) => m.WeeklyNewChart), {
  ssr: false,
});
const WeeklyControlChart = dynamic(() => import("./charts").then((m) => m.WeeklyControlChart), {
  ssr: false,
});

// A stable empty list: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NONE: FlakyTest[] = [];

/** Weeks spanned before the weekly chart is drawn: one or two bars say less than the verdict. */
const CHART_MIN_WEEKS = 3;
/** Bars in the worst-offender chart. */
const OFFENDER_BARS = 10;

type Write = (fn: (tests: FlakyTest[]) => FlakyTest[]) => void;

const storedBoard = () =>
  (useWorkspaceStore.getState().flakyTestBoards ?? []).find((d) => d.id === FLAKY_BOARD_ID) ?? null;

const testsOf = (board: FlakyTestBoard | null | undefined) =>
  Array.isArray(board?.tests) ? board.tests : NONE;

/**
 * The synced singleton (FLAKY_BOARD_ID) that agents write too. A write
 * changes the tests of the stored board and spreads the rest of it.
 */
function useFlakyBoard(): [FlakyTestBoard | null, Write] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.flakyTestBoards ?? []).find((d) => d.id === FLAKY_BOARD_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertFlakyTestBoard);
  const write: Write = (fn) => {
    const cur = storedBoard();
    const tests = testsOf(cur);
    const next = fn(tests);
    if (next !== tests) upsert({ ...(cur ?? {}), id: FLAKY_BOARD_ID, tests: next });
  };
  return [doc ?? null, write];
}

/** Focus what `find` returns once React has re-rendered (the focused control may have gone). */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

const editButtonOf = (id: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-edit-test]")).find(
    (el) => el.getAttribute("data-edit-test") === id
  );

const STATUS_DONE: Record<FlakyStatus, string> = {
  active: "Reopened",
  quarantined: "Quarantined",
  fixed: "Fixed",
};

export function FlakyTestsClient() {
  const [board, writeStored] = useFlakyBoard();
  const today = todayLocalISO();
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<FlakyTestBoard | null>(null);
  const preview = example !== null;
  const tests = testsOf(example ?? board);
  // Bound to the mode the change was made in, so an Undo lands where it
  // was made even if the example is loaded or cleared in between.
  const write: Write = preview
    ? (fn) => setExample((ex) => (ex ? { ...ex, tests: fn(ex.tests) } : ex))
    : writeStored;

  const { log: logHistory } = useHistoryLogger("flaky-tests");
  // The example's edits aren't the team's history, so they aren't logged.
  const log: typeof logHistory = (...args) => {
    if (!preview) logHistory(...args);
  };
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rate");
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const summary = useMemo(() => flakySummary(tests, today), [tests, today]);
  const verdict = flakyVerdict(summary);
  const offenders = useMemo(() => worstOffenders(tests, OFFENDER_BARS), [tests]);
  const weeks = useMemo(() => weeklyNewFlakies(tests), [tests]);
  // The sort is part of each key, so picking another sort re-sorts at once,
  // while a status change or an edit only marks the order stale.
  const { ordered, isStale, resort } = useStableOrder(
    tests,
    (t) => `${sortKey}\u0000${t.id}`,
    compareTests(sortKey)
  );

  /* ── Changes ── */

  const firstField = () => formRef.current?.querySelector<HTMLElement>("input");

  function add(v: TestValues) {
    const id = preview ? exampleId(`ft-${nanoid(6)}`) : crypto.randomUUID();
    const base: FlakyTest = {
      id,
      name: v.name,
      failureRate: 0,
      status: "active",
      firstSeenAt: v.firstSeenAt,
      ...(v.suite ? { suite: v.suite } : {}),
      ...(v.owner ? { owner: v.owner } : {}),
      ...(v.description ? { description: v.description } : {}),
    };
    // A new test always has run counts (the form needs them).
    const test = withRunCounts(base, v.failures as number, v.runs as number);
    write((list) => [...list, test]);
    log(FLAKY_TEST_ACTIONS.TEST_ADDED, {
      testId: id,
      name: test.name,
      suite: test.suite,
      owner: test.owner,
      failures: test.failures,
      runs: test.runs,
      failureRate: test.failureRate,
    });
    announce(`Logged “${test.name}”: ${ratePercent(test.failureRate)} of ${test.runs} runs`);
  }

  function save(t: FlakyTest, v: TestValues) {
    let next: FlakyTest = { ...t, name: v.name, firstSeenAt: v.firstSeenAt };
    for (const key of ["suite", "owner", "description"] as const) {
      if (v[key]) next[key] = v[key];
      else delete next[key];
    }
    if (v.failures !== undefined && v.runs !== undefined) {
      next = withRunCounts(next, v.failures, v.runs);
    }
    // A backdated quarantine or fix (the form offers the day of the test's own status).
    if (v.quarantinedAt && t.status === "quarantined") next.quarantinedAt = v.quarantinedAt;
    if (v.fixedAt && t.status === "fixed") next.fixedAt = v.fixedAt;
    const keys = [...Object.keys(t), ...Object.keys(next)] as (keyof FlakyTest)[];
    const fields = keys.filter((k, i) => keys.indexOf(k) === i && next[k] !== t[k]);
    closeEditor(t.id);
    if (fields.length === 0) return;
    write((list) => list.map((x) => (x.id === t.id ? next : x)));
    log(FLAKY_TEST_ACTIONS.TEST_UPDATED, { testId: t.id, fields });
    announce(`Saved “${next.name}”`);
  }

  function closeEditor(id: string) {
    setEditingId(null);
    focusSoon(() => editButtonOf(id));
  }

  function setStatus(t: FlakyTest, status: FlakyStatus) {
    const next = applyFlakyStatus(t, status, today);
    if (next === t) return;
    write((list) => list.map((x) => (x.id === t.id ? next : x)));
    if (status === "quarantined") {
      log(FLAKY_TEST_ACTIONS.TEST_QUARANTINED, { testId: t.id, name: t.name });
    } else if (status === "fixed") {
      log(FLAKY_TEST_ACTIONS.TEST_FIXED, { testId: t.id, name: t.name });
    } else {
      log(FLAKY_TEST_ACTIONS.TEST_UPDATED, { testId: t.id, fields: ["status"] });
    }
    announce(`${STATUS_DONE[status]}: “${t.name}”`);
  }

  function remove(t: FlakyTest) {
    const at = ordered.findIndex((x) => x.id === t.id);
    const near = ordered[at + 1] ?? ordered[at - 1];
    removeWithUndo<FlakyTest>({
      label: `Deleted “${t.name}”`,
      update: (fn) => write((list) => fn(list)),
      match: (x) => x.id === t.id,
    });
    log(FLAKY_TEST_ACTIONS.TEST_REMOVED, { testId: t.id, name: t.name });
    announce(`Deleted “${t.name}”`);
    focusSoon(() => (near && editButtonOf(near.id)) || firstField());
  }

  /** Each "Delete all" keeps what it took for its own Undo. */
  function deleteAll() {
    const removed = testsOf(preview ? example : storedBoard());
    setEditingId(null);
    undoable({
      label: `Deleted ${plural(removed.length, "flaky test")}`,
      apply: () => {
        write(() => []);
        log(FLAKY_TEST_ACTIONS.FLAKY_RESET, { tests: removed.length });
      },
      revert: () =>
        write((list) => [...removed.filter((r) => !list.some((x) => x.id === r.id)), ...list]),
    });
    focusSoon(firstField);
  }

  /* ── Exports ── */

  const promptConfig = useMemo(
    () => ({
      toolName: "Flaky Test Scoreboard",
      // Failures of runs, the weighted rate and quarantine ages, as the page reads them.
      prompts: generateFlakyPrompts({ tests, today }),
    }),
    [tests, today]
  );

  const csvData = {
    headers: [
      "Name",
      "Suite",
      "Owner",
      "Failures",
      "Runs",
      "Failure %",
      "Status",
      "First seen",
      "Quarantined since",
      "Fixed",
      "Description",
    ],
    rows: tests.map((t) => {
      const rate = flakyRate(t);
      return [
        t.name,
        t.suite ?? "",
        t.owner ?? "",
        hasRunCounts(t) ? t.failures : "",
        hasRunCounts(t) ? t.runs : "",
        rate === null ? "" : Math.round(rate * 1000) / 10,
        FLAKY_STATUS_LABEL[t.status],
        t.firstSeenAt,
        t.quarantinedAt ?? "",
        t.fixedAt ?? "",
        t.description ?? "",
      ];
    }),
  };

  const { weighted } = summary;
  const offenderChart = offendersChartText(offenders);
  const weeklyChart = weeklyChartText(weeks);
  const counts = weeks.map((w) => w.count);
  const control = enoughData(weeks.length, "changePoint") ? xmrLimits(counts, true) : null;
  const trend = enoughData(weeks.length, "trend") ? mannKendall(counts) : null;
  const weekData = weeks.map((w) => ({ week: w.week.slice(5), count: w.count }));

  return (
    <ToolPageWrapper
      toolId="flaky-tests"
      title="Flaky Test Scoreboard"
      description="Log flaky tests with their failed runs out of all runs, triage them through quarantine to fixed, and see the failure rate weighted by runs."
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

        <SectionCard title="Log a flaky test" icon={AlertOctagon}>
          <div ref={formRef}>
            <TestForm key={preview ? "example" : "saved"} today={today} onSave={add} />
          </div>
        </SectionCard>

        {tests.length === 0 ? (
          <EmptyState
            icon={AlertOctagon}
            action={<LoadExampleButton onLoad={() => setExample(buildExample(today))} />}
          >
            No flaky tests logged yet. Log one above with its failed runs out of all its runs, or
            load an example to see a triage queue with a long quarantine.
          </EmptyState>
        ) : (
          <>
            <p className="text-sm font-medium text-text">{verdict}</p>

            {summary.longQuarantined.length > 0 && (
              <CalloutAlert tone="warning">
                <strong>Quarantined {QUARANTINE_ALERT_DAYS} days or more:</strong>{" "}
                {summary.longQuarantined
                  .map((q) => `${q.name} (${plural(q.days, "day")})`)
                  .join(", ")}
                . A quarantined test still hides a bug: plan the fix, or delete the test.
              </CalloutAlert>
            )}

            <KpiGrid cols={4}>
              <StatCard
                variant="compact"
                icon={AlertOctagon}
                label="Active"
                value={summary.byStatus.active}
                tone={summary.byStatus.active > 0 ? "warning" : "default"}
              />
              <StatCard
                variant="compact"
                label="Quarantined"
                value={summary.byStatus.quarantined}
                hint={
                  summary.quarantineDateUnknown > 0
                    ? `${summary.quarantineDateUnknown} with no quarantine date`
                    : summary.longQuarantined.length > 0
                      ? `${summary.longQuarantined.length} for ${QUARANTINE_ALERT_DAYS}+ days`
                      : undefined
                }
                tone={summary.longQuarantined.length > 0 ? "warning" : "default"}
              />
              <StatCard
                variant="compact"
                label="Fixed this quarter"
                value={summary.fixedThisQuarter}
                tone={summary.fixedThisQuarter > 0 ? "success" : "default"}
              />
              <StatCard
                variant="compact"
                label="Failure rate (by runs)"
                value={weighted.rate === null ? "—" : ratePercent(weighted.rate)}
                hint={
                  weighted.runs > 0
                    ? `Over ${weighted.runs.toLocaleString("en-US")} runs${
                        weighted.rateOnly > 0
                          ? `; ${plural(weighted.rateOnly, "test")} without run counts not included`
                          : ""
                      }`
                    : weighted.rateOnly > 0
                      ? `${plural(weighted.rateOnly, "test")} without run counts`
                      : "No open tests"
                }
                tone={
                  weighted.rate !== null && weighted.rate > FLAKY_HIGH_RATE ? "danger" : "default"
                }
              />
            </KpiGrid>

            <SectionCard
              title={`All flaky tests (${tests.length})`}
              icon={ListChecks}
              contentClassName="space-y-3"
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="flaky-tests"
                    csvData={csvData}
                    jsonData={{ tests }}
                    markdown={flakyMarkdown(tests, today)}
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
                      tests.length === 1
                        ? "Delete the 1 flaky test?"
                        : `Delete all ${tests.length} flaky tests?`
                    }
                    description="The scoreboard starts again from nothing, for agents too."
                    confirmLabel="Delete all"
                    onConfirm={deleteAll}
                  />
                </>
              }
            >
              <Field label="Sort by" className="sm:w-56">
                {(props) => (
                  <select
                    {...props}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                  >
                    {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                      <option key={k} value={k}>
                        {SORT_LABEL[k]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <ResortChip isStale={isStale} onResort={resort} what="Rates or statuses" />
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Flaky tests">
                {ordered.map((t) => (
                  <li key={t.id} className="min-w-0">
                    <TestCard
                      test={t}
                      today={today}
                      editing={editingId === t.id}
                      onEdit={() => setEditingId(t.id)}
                      onCancel={() => closeEditor(t.id)}
                      onSave={(v) => save(t, v)}
                      onStatus={(s) => setStatus(t, s)}
                      onRemove={() => remove(t)}
                    />
                  </li>
                ))}
              </ul>
            </SectionCard>

            {offenders.length > 0 && (
              <ChartCard
                title="Worst offenders"
                icon={AlertOctagon}
                height={Math.max(160, offenders.length * 32 + 24)}
                summary={offenderChart.summary}
                table={offenderChart.table}
              >
                <FlakiestTestsChart
                  data={offenders.map((o) => ({
                    name: o.name,
                    failureRatePct: Math.round(o.failureRate * 100),
                    flagged: o.failureRate > FLAKY_HIGH_RATE,
                  }))}
                />
              </ChartCard>
            )}

            {weeks.length >= CHART_MIN_WEEKS && (
              <ChartCard
                title="New flaky tests per week"
                icon={TrendingUp}
                height={220}
                summary={weeklyChart.summary}
                table={weeklyChart.table}
              >
                <WeeklyNewChart data={weekData} />
              </ChartCard>
            )}

            <AdvancedAnalysis>
              {control ? (
                <ChartFigure
                  label="New flaky tests per week, with control limits"
                  summary={`Weeks above ${Math.round(control.ucl * 10) / 10} new flaky tests are out of the usual run; the average is ${Math.round(control.centerLine * 10) / 10} a week.`}
                  table={weeklyChart.table}
                  plotClassName="h-[220px]"
                >
                  <WeeklyControlChart data={weekData} control={control} />
                </ChartFigure>
              ) : (
                <NotEnoughData
                  have={weeks.length}
                  need="changePoint"
                  unit={["week", "weeks"]}
                  action="Log flaky tests across"
                  what="control limits on the weekly count"
                />
              )}
              {trend ? (
                <p className="text-sm text-text">
                  Mann-Kendall over {weeks.length} weeks:{" "}
                  {trend.trend === "none" || !trend.significant
                    ? "no clear trend in new flaky tests"
                    : `new flaky tests are trending ${trend.trend}`}{" "}
                  (p = {trend.pValue.toFixed(3)}).
                </p>
              ) : (
                <NotEnoughData
                  have={weeks.length}
                  need="trend"
                  unit={["week", "weeks"]}
                  action="Log flaky tests across"
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
