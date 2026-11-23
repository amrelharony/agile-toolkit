"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { Lightbulb, ListChecks, X } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartFigure } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { generateHypothesisTrackerPrompts } from "@/lib/ai-prompts/hypothesis-tracker";
import { sourceLabel } from "@/lib/handoffs/registry";
import { HYPOTHESIS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  HYPOTHESIS_TRACKER_ID,
  applyHypothesisValues,
  formatMetric,
  hypothesisVerdict,
  missingFields,
  suggestionText,
  withHypothesis,
  type HypothesisValues,
} from "@/lib/hypotheses/model";
import { emit as sonify } from "@/lib/sonification/emit";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  AbTest,
  EpicRoadmap,
  Hypothesis,
  HypothesisMeasuredBy,
  HypothesisTracker,
  Okr,
  ProductMetric,
  Story,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayLocalISO } from "@/lib/utils/formatters";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import {
  AB_RESULT_REASON,
  TRACKER_FULL,
  abResultUpdate,
  applyValueCheck,
  isValueCheck,
  measuredByText,
  readMeasure,
  shippedCandidates,
  trackerFits,
  valueSummary,
  valueSummaryText,
  withMeasuredBy,
  type ValueCheckValues,
} from "@/lib/hypotheses/value";
import { buildExample } from "./example";
import {
  HypothesisCard,
  type CardChange,
  type CardContext,
  type ValueAction,
} from "./hypothesis-card";
import { NewHypothesisForm, type HypothesisSeed } from "./hypothesis-form";
import { hypothesesToMarkdown } from "./markdown";
import { ShippedWork } from "./value-checks";
import {
  KIND_FILTERS,
  STATUS_FILTERS,
  countedRows,
  draftForMetric,
  filterCounts,
  matchesFilter,
  matchesKind,
  missingText,
  rateOf,
  rateText,
  readMetricParam,
  statusLabel,
  targetText,
  timeToLearn,
  type KindFilter,
  type StatusFilter,
} from "./view";

// Recharts loads with the survival chart, not the page.
const SurvivalCurveChart = dynamic(() => import("./charts").then((m) => m.SurvivalCurveChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

// Stable empty lists: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NO_TRACKERS: HypothesisTracker[] = [];
const NONE: Hypothesis[] = [];
const NO_METRICS: ProductMetric[] = [];
const NO_OKRS: Okr[] = [];
const NO_TESTS: AbTest[] = [];
const NO_STORIES: Story[] = [];
const NO_ROADMAPS: EpicRoadmap[] = [];

const RESULTS = ["result", "results"] as const;

/** Added to the announcement when a change takes the card out of the filtered list. */
const HIDDEN_NOTE = ", now hidden by the filter";

/** The Edit button of the card for `id`; ids go in no selector, so need no escaping. */
function editButtonOf(id: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-hypothesis-edit]")).find(
    (el) => el.getAttribute("data-hypothesis-edit") === id
  );
}

const titleOf = (h: Pick<Hypothesis, "believe">) => h.believe?.trim() || "Untitled hypothesis";

/**
 * Hypothesis Tracker: product bets as testable hypotheses. A new one is
 * saved only once it is complete (validateHypothesis, the same check the
 * agent's add_hypothesis runs); a hand-off draft from Riskiest
 * Assumption, the Opportunity Tree, Cynefin or a Design Sprint arrives
 * with what it knows and reads "Needs detail" until it can run. A numeric
 * target and the measured result suggest a verdict the team applies; the
 * validation rate leaves inconclusive results out and reads "—" with no
 * decisive result. Every number comes from lib/hypotheses, as
 * tool.hypothesis_tracker reads it.
 */
export function HypothesisTrackerClient() {
  const hydrated = useWorkspaceHydrated();
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers) ?? NO_TRACKERS;
  const list = trackers.find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? NONE;
  const today = todayLocalISO();
  const { log } = useHistoryLogger("hypothesis-tracker");
  const announce = useAnnounce();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [seed, setSeed] = useState<HypothesisSeed | null>(null);
  const [pendingMetric, setPendingMetric] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // What value checks and the A/B line read (P2.5).
  const metrics = useWorkspaceStore((s) => s.productMetrics) ?? NO_METRICS;
  const okrs = useWorkspaceStore((s) => s.okrs) ?? NO_OKRS;
  const tests = useWorkspaceStore((s) => s.abTests) ?? NO_TESTS;
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const roadmaps = useWorkspaceStore((s) => s.epicRoadmaps) ?? NO_ROADMAPS;
  const context = useMemo<CardContext>(() => ({ metrics, okrs, tests }), [metrics, okrs, tests]);
  const candidates = useMemo(
    () => shippedCandidates({ stories, roadmaps, hypotheses: list }, today),
    [stories, roadmaps, list, today]
  );

  const counted = useMemo(() => countedRows(list), [list]);
  /** Example rows next to the team's own: on the page, but not in the numbers. */
  const mixed = !counted.example && counted.rows.length < list.length;
  // The same function the agent's list_state calls, over the same rows.
  const rate = useMemo(() => rateOf(counted), [counted]);
  const verdict = hypothesisVerdict(rate);
  const value = useMemo(
    () => valueSummary(counted.rows, today, { includeExamples: true }),
    [counted, today]
  );
  const learn = useMemo(() => timeToLearn(counted.rows, new Date()), [counted]);
  const counts = useMemo(() => filterCounts(list), [list]);
  const checks = useMemo(() => list.filter((h) => isValueCheck(h)).length, [list]);
  const shown = useMemo(
    () => list.filter((h) => matchesFilter(h, filter) && matchesKind(h, kind)),
    [list, filter, kind]
  );
  const needsDetail = counts["needs-detail"];
  const filtered = filter !== "all" || kind !== "all";

  /* ── Writes ── */

  const ws = () => useWorkspaceStore.getState();
  const current = () =>
    (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID) ?? null;
  const updateList = (fn: (list: readonly Hypothesis[]) => Hypothesis[]) => {
    const doc = current();
    ws().upsertHypothesisTracker({
      ...(doc ?? {}),
      id: HYPOTHESIS_TRACKER_ID,
      hypotheses: fn(doc?.hypotheses ?? []),
    });
  };
  const put = (h: Hypothesis) => ws().upsertHypothesisTracker(withHypothesis(current(), h));
  // Example rows aren't the team's history.
  const record = (id: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(id)) log(action, payload);
  };

  /** Focus the card shown after `id` (or before it), else the "New hypothesis" button. */
  function focusPast(id: string) {
    const at = shown.findIndex((h) => h.id === id);
    const near = at >= 0 ? (shown[at + 1] ?? shown[at - 1]) : undefined;
    requestAnimationFrame(() =>
      (
        (near && editButtonOf(near.id)) ||
        formRef.current?.querySelector<HTMLElement>("[data-new-hypothesis], input")
      )?.focus()
    );
  }

  /** The filters go back to All when they would hide `h`. */
  const reveal = (h: Hypothesis) => {
    if (!matchesFilter(h, filter)) setFilter("all");
    if (!matchesKind(h, kind)) setKind("all");
  };

  function add(values: HypothesisValues, measuredBy?: HypothesisMeasuredBy) {
    const plain = applyHypothesisValues({ id: nanoid(8) }, values);
    const h = measuredBy ? withMeasuredBy(plain, measuredBy) : plain;
    put(h);
    record(h.id, HYPOTHESIS_ACTIONS.HYPOTHESIS_ADDED, { hypothesisId: h.id, status: h.status });
    if (measuredBy) {
      record(h.id, HYPOTHESIS_ACTIONS.MEASURED_BY_SET, {
        hypothesisId: h.id,
        kind: measuredBy.kind,
      });
    }
    // A new hypothesis the filter would hide is shown: the filter goes back to All.
    reveal(h);
    announce(`Added “${titleOf(h)}”`);
  }

  /**
   * "Check its value": a running hypothesis that follows the shipped work.
   * Its id, or null when it would take the tracker past its one synced row
   * (nothing saved; the form says so and keeps what was typed).
   */
  function addValueCheck(values: ValueCheckValues): string | null {
    const h = applyValueCheck({ id: nanoid(8) }, values);
    const doc = withHypothesis(current(), h);
    if (!trackerFits(doc)) return null;
    ws().upsertHypothesisTracker(doc);
    record(h.id, HYPOTHESIS_ACTIONS.VALUE_CHECK_ADDED, {
      hypothesisId: h.id,
      kind: values.shipped.kind,
      id: values.shipped.id,
    });
    reveal(h);
    announce(`Added a value check for “${values.shipped.title}”, to look at on ${values.checkOn}`);
    return h.id;
  }

  /**
   * A value-check write on a card. "Read the metric" and "Use the A/B
   * result" log the number they set as a recorded result, and their Undo
   * puts the row back without logging anything.
   */
  function valueAction(h: Hypothesis, action: ValueAction) {
    const prev = current()?.hypotheses.find((x) => x.id === h.id);
    if (!prev) return;
    if (action.kind === "measured-by") {
      put(withMeasuredBy(prev, action.measuredBy));
      record(h.id, HYPOTHESIS_ACTIONS.MEASURED_BY_SET, {
        hypothesisId: h.id,
        kind: action.measuredBy?.kind ?? null,
      });
      const text = measuredByText(action.measuredBy ?? undefined, { metrics, okrs });
      announce(
        text ? `“${titleOf(h)}” is measured by ${text}` : `Cleared how “${titleOf(h)}” is measured`
      );
      return;
    }
    if (action.kind === "read-measure") {
      const read = readMeasure(prev, { metrics, okrs });
      if (read.state !== "ready") return;
      const next: Hypothesis = { ...prev, actual: read.reading.value };
      const label = `Read ${read.measure.name}: ${formatMetric(read.reading.value, prev.target?.unit)} on ${read.reading.date}`;
      undoable({
        label,
        apply: () => {
          put(next);
          record(h.id, HYPOTHESIS_ACTIONS.RESULT_RECORDED, {
            hypothesisId: h.id,
            actual: next.actual,
          });
        },
        revert: () => put(prev),
      });
      announce(suggestionText(next) ?? label);
      return;
    }
    const test = tests.find((t) => t.id === action.testId);
    const r = test ? abResultUpdate(prev, test) : null;
    if (!test || !r || !r.ok) {
      announce(AB_RESULT_REASON[!test ? "no_test" : r && !r.ok ? r.reason : "no_result"]);
      return;
    }
    if (!trackerFits(withHypothesis(current(), r.next))) {
      announce(TRACKER_FULL);
      return;
    }
    undoable({
      label: `Used the A/B result on “${titleOf(prev)}”`,
      apply: () => {
        put(r.next);
        record(h.id, HYPOTHESIS_ACTIONS.AB_RESULT_USED, { hypothesisId: h.id, testId: test.id });
        if (r.actualSet) {
          record(h.id, HYPOTHESIS_ACTIONS.RESULT_RECORDED, {
            hypothesisId: h.id,
            actual: r.next.actual,
          });
        }
      },
      revert: () => put(prev),
    });
    announce(
      r.actualSet
        ? (suggestionText(r.next) ?? r.sentence)
        : `Added the A/B result to what we learned on “${titleOf(prev)}”`
    );
  }

  /* ── `?metric=<id>`: New hypothesis for a product metric ─────────── */

  useEffect(() => {
    if (!pendingMetric || !hydrated) return;
    const m = metrics.find((x) => x.id === pendingMetric);
    setPendingMetric(null);
    dropSearchParam("metric");
    if (!m) {
      announce("That metric isn't in Product Metrics any more.");
      return;
    }
    const { draft, measuredBy } = draftForMetric(m, today);
    setSeed((s) => ({
      key: (s?.key ?? 0) + 1,
      draft,
      measuredBy,
      measuredLabel: m.name,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per link, when the workspace is in
  }, [pendingMetric, hydrated, metrics]);

  function save(h: Hypothesis, values: HypothesisValues, what: CardChange) {
    const next = applyHypothesisValues(h, values);
    if (JSON.stringify(next) === JSON.stringify(h)) return;
    put(next);
    if (next.status !== h.status) {
      if (next.status === "validated") sonify("hypothesis-tracker", "validated");
      else if (next.status === "invalidated") sonify("hypothesis-tracker", "invalidated");
      else sonify("hypothesis-tracker", "status-change");
      record(h.id, HYPOTHESIS_ACTIONS.STATUS_CHANGED, {
        hypothesisId: h.id,
        from: h.status,
        to: next.status,
      });
    }
    if (what === "result") {
      // A value committed is a measured result; a blank field clears it, logged apart
      // so result_recorded always means a result is there (Amr answers only that one).
      if (typeof next.actual === "number") {
        record(h.id, HYPOTHESIS_ACTIONS.RESULT_RECORDED, {
          hypothesisId: h.id,
          actual: next.actual,
        });
      } else {
        record(h.id, HYPOTHESIS_ACTIONS.RESULT_CLEARED, { hypothesisId: h.id });
      }
    } else if (what !== "status") {
      const fields = (Object.keys(values) as (keyof HypothesisValues)[]).filter(
        (k) => JSON.stringify(next[k]) !== JSON.stringify(h[k])
      );
      record(h.id, HYPOTHESIS_ACTIONS.HYPOTHESIS_UPDATED, { hypothesisId: h.id, fields });
    }
    const hidden = !matchesFilter(next, filter);
    const done =
      next.status !== h.status
        ? `“${titleOf(next)}” is now ${statusLabel(next.status).toLowerCase()}`
        : what === "result"
          ? (suggestionText(next) ?? `Cleared the result of “${titleOf(next)}”`)
          : `Saved “${titleOf(next)}”`;
    announce(`${done}${hidden ? HIDDEN_NOTE : ""}`);
    if (hidden) focusPast(h.id);
  }

  function remove(h: Hypothesis) {
    focusPast(h.id);
    // Undo puts it back where it was, with its id, so a riskiest assumption
    // or an experiment that sent it links to it again.
    removeWithUndo<Hypothesis>({
      label: `Deleted “${titleOf(h)}”`,
      update: updateList,
      match: (x) => x.id === h.id,
    });
    record(h.id, HYPOTHESIS_ACTIONS.HYPOTHESIS_REMOVED, {
      hypothesisId: h.id,
      believe: h.believe,
    });
    announce(`Deleted “${titleOf(h)}”`);
  }

  const loadExample = () => updateList((l) => [...buildExample(today), ...l]);
  const clearExample = () => updateList((l) => l.filter((h) => !isExampleId(h.id)));

  /* ── Exports ── */

  const markdown = hypothesesToMarkdown(list, rate, {
    sources: { metrics, okrs },
    today,
    value,
  });
  const csvData = {
    headers: [
      "We believe",
      "We will",
      "To learn",
      "Success looks like",
      "Target",
      "Measured",
      "Suggested verdict",
      "Experiment",
      "Context",
      "What we learned",
      "Status",
      "Raised",
      "Result on",
      "Source",
      "Needs detail",
    ],
    rows: list.map((h) => [
      h.believe,
      h.willDo,
      h.toLearn,
      h.successMetric,
      h.target ? targetText(h.target) : "",
      typeof h.actual === "number" ? formatMetric(h.actual, h.target?.unit) : "",
      suggestionText(h) ?? "",
      h.experiment ?? "",
      h.description ?? "",
      h.outcome ?? "",
      statusLabel(h.status),
      (h.raisedAt ?? "").slice(0, 10),
      (h.resolvedAt ?? "").slice(0, 10),
      sourceLabel(h.sourceRef) ?? "",
      missingText(missingFields(h)),
    ]),
  };
  const promptConfig = useMemo(
    () => ({
      toolName: "Hypothesis Tracker",
      // The page's numbers: with no decisive result the rate reads "—", never 0%.
      prompts: generateHypothesisTrackerPrompts({
        items: counted.rows,
        validationRate: rate.rate,
        medianTimeToValidate: learn.median,
        results: learn.resolved,
        verdict,
      }),
    }),
    [counted, rate, learn.median, learn.resolved, verdict]
  );

  const filterOptions: ToggleOption<StatusFilter>[] = STATUS_FILTERS.map(([value, label]) => ({
    value,
    label: `${label} (${counts[value]})`,
  }));
  const kindOptions: ToggleOption<KindFilter>[] = KIND_FILTERS.map(([value, label]) => ({
    value,
    label:
      value === "all"
        ? label
        : `${label} (${value === "value-checks" ? checks : list.length - checks})`,
  }));

  return (
    <ToolPageWrapper
      toolId="hypothesis-tracker"
      title="Hypothesis Tracker"
      description="Frame product bets as testable hypotheses, set a numeric target, and see which held up."
      category="Product Discovery"
    >
      <OnSearchParams onChange={(search) => setPendingMetric(readMetricParam(search))} />
      <div ref={exportRef} className="space-y-6">
        {hasExampleItems(list) && <ExampleNotice onClear={clearExample} />}

        <div ref={formRef}>
          <NewHypothesisForm today={today} onAdd={add} seed={seed} />
        </div>

        {hydrated && (
          <ShippedWork
            candidates={candidates}
            today={today}
            metrics={metrics}
            okrs={okrs}
            onAdd={addValueCheck}
          />
        )}

        {list.length === 0 ? (
          hydrated && (
            <EmptyState icon={Lightbulb} action={<LoadExampleButton onLoad={loadExample} />}>
              No hypotheses yet. Use “New hypothesis” to frame a bet you can test, or load an
              example to see the tracker filled in. Assumptions, experiments and complex problems
              sent from Riskiest Assumption, the Opportunity Tree and Cynefin land here too.
            </EmptyState>
          )
        ) : (
          <>
            <KpiGrid cols={3}>
              <StatCard
                variant="compact"
                label="Open"
                value={rate.open}
                // The filter's counts take in every row on the page; the KPIs
                // count the team's own once any exist, so say which.
                hint={mixed ? "drafted or running, examples not counted" : "drafted or running"}
              />
              <StatCard
                variant="compact"
                label="Validation rate"
                value={rateText(rate)}
                hint={
                  rate.rate === null
                    ? "no decisive result yet"
                    : `${rate.validated} of ${rate.decisive} decisive${rate.inconclusive > 0 ? ` · ${rate.inconclusive} inconclusive not counted` : ""}`
                }
                valueClassName="text-accent"
              />
              <StatCard
                variant="compact"
                label="Needs detail"
                value={needsDetail}
                hint="what we'll do or the success metric"
                tone={needsDetail > 0 ? "warning" : "default"}
              />
            </KpiGrid>

            <SectionCard
              title={`Hypotheses (${list.length})`}
              icon={ListChecks}
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="hypotheses"
                    csvData={csvData}
                    jsonData={list}
                    markdown={markdown}
                    targetRef={exportRef}
                  />
                </>
              }
              contentClassName="space-y-4"
            >
              <p className="text-sm font-medium text-text">
                {verdict}
                {counted.example && <span className="text-sub"> (the example)</span>}
              </p>
              {value.total > 0 && <p className="text-sm text-text">{valueSummaryText(value)}</p>}

              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-sm text-text" aria-hidden="true">
                    Show
                  </span>
                  <ToggleGroup
                    label="Show hypotheses"
                    size="sm"
                    options={filterOptions}
                    value={filter}
                    onValueChange={setFilter}
                  />
                </div>
                {(checks > 0 || kind !== "all") && (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-sm text-text" aria-hidden="true">
                      Kind
                    </span>
                    <ToggleGroup
                      label="Kind of hypothesis"
                      size="sm"
                      options={kindOptions}
                      value={kind}
                      onValueChange={setKind}
                    />
                  </div>
                )}
                {filtered && (
                  <p className="flex items-center gap-2 text-xs text-sub" role="status">
                    Showing {shown.length} of {list.length}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        setFilter("all");
                        setKind("all");
                      }}
                    >
                      <X aria-hidden="true" />
                      Show all
                    </Button>
                  </p>
                )}
              </div>

              {shown.length === 0 ? (
                <p className="text-sm text-sub">No hypotheses match this filter.</p>
              ) : (
                // Stored order, newest first: an edit never moves a card.
                <ul className="space-y-3" aria-label="Hypotheses, newest first">
                  {shown.map((h) => (
                    <li key={h.id} className="min-w-0">
                      <HypothesisCard
                        hypothesis={h}
                        today={today}
                        onSave={save}
                        onRemove={remove}
                        context={context}
                        onValueAction={valueAction}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <AdvancedAnalysis summary="Advanced analysis: how long tests take">
              {learn.enough && learn.points.length > 0 ? (
                <ChartFigure
                  label="Share of hypotheses still waiting for a result"
                  summary={learn.summary}
                  table={learn.table}
                  plotClassName="h-40"
                >
                  <SurvivalCurveChart data={learn.points} />
                </ChartFigure>
              ) : (
                <NotEnoughData
                  have={learn.resolved}
                  need="distribution"
                  unit={RESULTS}
                  action="Record"
                  what="how long tests take to give a result"
                />
              )}
              <p className="text-xs text-sub">
                A Kaplan-Meier estimate over the days from raised to result; tests still open count
                as still waiting.
              </p>
            </AdvancedAnalysis>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
