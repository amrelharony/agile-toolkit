"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
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
import type { Hypothesis, HypothesisTracker } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayLocalISO } from "@/lib/utils/formatters";
import { removeWithUndo } from "@/lib/utils/undoable";
import { buildExample } from "./example";
import { HypothesisCard, type CardChange } from "./hypothesis-card";
import { NewHypothesisForm } from "./hypothesis-form";
import { hypothesesToMarkdown } from "./markdown";
import {
  STATUS_FILTERS,
  countedRows,
  filterCounts,
  matchesFilter,
  missingText,
  rateOf,
  rateText,
  statusLabel,
  targetText,
  timeToLearn,
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
  const exportRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const counted = useMemo(() => countedRows(list), [list]);
  /** Example rows next to the team's own: on the page, but not in the numbers. */
  const mixed = !counted.example && counted.rows.length < list.length;
  // The same function the agent's list_state calls, over the same rows.
  const rate = useMemo(() => rateOf(counted), [counted]);
  const verdict = hypothesisVerdict(rate);
  const learn = useMemo(() => timeToLearn(counted.rows, new Date()), [counted]);
  const counts = useMemo(() => filterCounts(list), [list]);
  const shown = useMemo(() => list.filter((h) => matchesFilter(h, filter)), [list, filter]);
  const needsDetail = counts["needs-detail"];

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

  function add(values: HypothesisValues) {
    const h = applyHypothesisValues({ id: nanoid(8) }, values);
    put(h);
    record(h.id, HYPOTHESIS_ACTIONS.HYPOTHESIS_ADDED, { hypothesisId: h.id, status: h.status });
    // A new hypothesis the filter would hide is shown: the filter goes back to All.
    if (!matchesFilter(h, filter)) setFilter("all");
    announce(`Added “${titleOf(h)}”`);
  }

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
      record(h.id, HYPOTHESIS_ACTIONS.RESULT_RECORDED, {
        hypothesisId: h.id,
        actual: next.actual ?? null,
      });
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

  const markdown = hypothesesToMarkdown(list, rate);
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
        verdict,
      }),
    }),
    [counted, rate, learn.median, verdict]
  );

  const filterOptions: ToggleOption<StatusFilter>[] = STATUS_FILTERS.map(([value, label]) => ({
    value,
    label: `${label} (${counts[value]})`,
  }));

  return (
    <ToolPageWrapper
      toolId="hypothesis-tracker"
      title="Hypothesis Tracker"
      description="Frame product bets as testable hypotheses, set a numeric target, and see which held up."
      category="Product Discovery"
    >
      <div ref={exportRef} className="space-y-6">
        {hasExampleItems(list) && <ExampleNotice onClear={clearExample} />}

        <div ref={formRef}>
          <NewHypothesisForm today={today} onAdd={add} />
        </div>

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
                {filter !== "all" && (
                  <p className="flex items-center gap-2 text-xs text-sub" role="status">
                    Showing {shown.length} of {list.length}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={() => setFilter("all")}
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
