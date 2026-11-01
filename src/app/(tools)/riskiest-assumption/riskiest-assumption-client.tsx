"use client";

import { useMemo, useRef } from "react";
import { CheckCircle2, CircleDashed, FlaskConical, Grid2x2, ListOrdered } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { useStableOrder } from "@/hooks/use-stable-order";
import { generateRiskiestAssumptionPrompts } from "@/lib/ai-prompts/riskiest-assumption";
import {
  RA_ID,
  assumptionHypothesisSource,
  assumptionScore,
  quadrantOf,
  rankAssumptions,
  ratingOf,
} from "@/lib/assumptions/model";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { RISKIEST_ASSUMPTION_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HYPOTHESIS_TRACKER_ID, linkedTest } from "@/lib/hypotheses/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Assumption,
  AssumptionLevel,
  AssumptionStatus,
  Hypothesis,
  HypothesisTracker,
  RiskiestAssumption,
  Workspace,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import { removeWithUndo } from "@/lib/utils/undoable";
import { AssumptionCard, type AssumptionCardProps } from "./assumption-card";
import { AddAssumptionForm } from "./assumption-form";
import { buildExample } from "./example";
import { applyAssumptionValues, type AssumptionValues } from "./form";
import { assumptionsToMarkdown } from "./markdown";
import {
  QUADRANTS,
  assumptionsVerdict,
  canvasView,
  countedAssumptions,
  offeredStatus,
  resultText,
  statusLabel,
} from "./view";

// Stable empty lists: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NO_DOCS: RiskiestAssumption[] = [];
const NO_TRACKERS: HypothesisTracker[] = [];
const NONE: Assumption[] = [];
const NO_HYPOTHESES: Hypothesis[] = [];

const keyOf = (a: Assumption) => a.id;
const titleOf = (a: Pick<Assumption, "statement">) => a.statement?.trim() || "Untitled assumption";

/** The control on a card that takes focus back after a change. */
type FocusTarget = "riskLevel" | "evidenceLevel" | "status" | "test";

/** The card for `id`, wherever it is drawn now; ids go in no selector, so need no escaping. */
function cardOf(id: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-assumption-card]")).find(
    (el) => el.getAttribute("data-assumption-card") === id
  );
}

/**
 * Put focus back on `target` in the card for `id` once the page has drawn
 * the change, when focus was lost: a rating or a status moves the card to
 * another list (Ranked, Not rated, Tested), which draws it anew, and Test
 * and "Mark …" swap the control that had focus for another. A control
 * that kept focus is left alone.
 */
function refocus(id: string, target: FocusTarget) {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const card = cardOf(id);
    if (!card) return;
    const el =
      target === "status"
        ? card.querySelector<HTMLElement>("select")
        : target === "test"
          ? card.querySelector<HTMLElement>("[data-assumption-test]")
          : card.querySelector<HTMLElement>(
              `[data-rating="${target}"] [role="radio"][tabindex="0"]`
            );
    (el ?? card.querySelector<HTMLElement>("[data-assumption-edit]"))?.focus();
  });
}

/**
 * Riskiest Assumption Canvas: the assumptions behind a bet, rated on risk
 * and evidence and ranked by risk × (6 − evidence) through lib/assumptions
 * (tool.riskiest_assumption ranks with the same function). Ratings start
 * unset: an unrated assumption waits under "Not rated" and is neither
 * ranked nor placed in the matrix. "Test" makes a linked hypothesis in the
 * Hypothesis Tracker; once that hypothesis (or the assumption's own
 * status) says validated or invalidated, the assumption leaves the
 * ranking, while an inconclusive test keeps it there to test again. The
 * ranking holds still while ratings change, until "Re-sort".
 */
export function RiskiestAssumptionClient() {
  const hydrated = useWorkspaceHydrated();
  const docs = useWorkspaceStore((s) => s.riskiestAssumptions) ?? NO_DOCS;
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers) ?? NO_TRACKERS;
  const list = docs.find((d) => d.id === RA_ID)?.assumptions ?? NONE;
  const hypotheses =
    trackers.find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? NO_HYPOTHESES;
  const { log } = useHistoryLogger("riskiest-assumption");
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // The team's rows once any exist, as the agent ranks them; example rows
  // next to them are shown apart and ranked on their own.
  const counted = useMemo(() => countedAssumptions(list), [list]);
  const view = useMemo(() => canvasView(counted.rows, hypotheses), [counted, hypotheses]);
  const aside = useMemo(
    () => (counted.aside.length > 0 ? canvasView(counted.aside, hypotheses) : null),
    [counted, hypotheses]
  );
  const rankOf = useMemo(
    () => new Map(view.ranked.map((r) => [r.assumption.id, r])),
    [view.ranked]
  );
  const asideRankOf = useMemo(
    () => new Map((aside?.ranked ?? []).map((r) => [r.assumption.id, r])),
    [aside]
  );
  // The ranking as it was last sorted: a rating change marks it stale
  // ("Re-sort") instead of moving the card being rated.
  const { ordered, isStale, resort } = useStableOrder(
    view.ranked.map((r) => r.assumption),
    keyOf,
    (x, y) => (rankOf.get(x.id)?.rank ?? 0) - (rankOf.get(y.id)?.rank ?? 0)
  );
  const verdict = assumptionsVerdict(view);

  /* ── Writes ── */

  const ws = () => useWorkspaceStore.getState();
  const currentDoc = () => (ws().riskiestAssumptions ?? []).find((d) => d.id === RA_ID);
  const updateList = (fn: (list: readonly Assumption[]) => Assumption[]) => {
    const doc = currentDoc();
    ws().upsertRiskiestAssumption({
      ...(doc ?? {}),
      id: RA_ID,
      assumptions: fn(doc?.assumptions ?? []),
    });
  };
  const fresh = (id: string) => currentDoc()?.assumptions.find((a) => a.id === id);
  const patch = (id: string, fn: (a: Assumption) => Assumption) =>
    updateList((l) => l.map((a) => (a.id === id ? fn(a) : a)));
  // Example rows aren't the team's history.
  const record = (id: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(id)) log(action, payload);
  };
  /** Where an assumption stands after a change (its list too), for the announcement. */
  const standing = (id: string) => {
    const c = countedAssumptions(currentDoc()?.assumptions ?? []);
    const group = c.rows.some((a) => a.id === id) ? c.rows : c.aside;
    const { ranked, tested } = rankAssumptions(group, hypotheses);
    const r = ranked.find((x) => x.assumption.id === id);
    if (r) return `ranked #${r.rank}, score ${r.score}`;
    return tested.some((a) => a.id === id)
      ? "tested, so out of the ranking"
      : "not rated, so not ranked";
  };

  /** Focus the card drawn after `id` (or before it), else the add form, once it is gone. */
  function focusPast(id: string) {
    const shown = [
      ...ordered,
      ...view.unrated,
      ...view.tested,
      ...(aside
        ? [...aside.ranked.map((r) => r.assumption), ...aside.unrated, ...aside.tested]
        : []),
    ];
    const at = shown.findIndex((a) => a.id === id);
    const near = at >= 0 ? (shown[at + 1] ?? shown[at - 1]) : undefined;
    requestAnimationFrame(() =>
      (
        (near && cardOf(near.id)?.querySelector<HTMLElement>("[data-assumption-edit]")) ||
        formRef.current?.querySelector<HTMLElement>("input, textarea")
      )?.focus()
    );
  }

  function add(values: AssumptionValues) {
    const a = applyAssumptionValues(
      { id: crypto.randomUUID(), statement: "", status: "untested" },
      values
    );
    // Last in the list, as an agent's add_assumption puts it.
    updateList((l) => [...l, a]);
    record(a.id, RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_ADDED, {
      assumptionId: a.id,
      statement: a.statement,
      riskLevel: a.riskLevel ?? null,
      evidenceLevel: a.evidenceLevel ?? null,
    });
    announce(`Added “${titleOf(a)}”: ${standing(a.id)}`);
  }

  function saveWords(a: Assumption, values: AssumptionValues) {
    // The ratings are edited on the card: the word editor leaves them as stored.
    const next = applyAssumptionValues(a, {
      ...values,
      riskLevel: a.riskLevel,
      evidenceLevel: a.evidenceLevel,
    });
    if (JSON.stringify(next) === JSON.stringify(a)) return;
    patch(a.id, (x) =>
      applyAssumptionValues(x, {
        ...values,
        riskLevel: x.riskLevel,
        evidenceLevel: x.evidenceLevel,
      })
    );
    record(a.id, RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_UPDATED, {
      assumptionId: a.id,
      statement: next.statement,
    });
    announce(`Saved “${titleOf(next)}”`);
  }

  function rate(a: Assumption, key: "riskLevel" | "evidenceLevel", value: AssumptionLevel | null) {
    if ((a[key] ?? null) === value) return;
    patch(a.id, (x) => {
      const next = { ...x };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
    record(a.id, RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_UPDATED, {
      assumptionId: a.id,
      [key]: value,
    });
    announce(
      `${key === "riskLevel" ? "Risk" : "Evidence"} ${value ?? "cleared"}: “${titleOf(a)}” is ${standing(a.id)}`
    );
    refocus(a.id, key);
  }

  function setStatus(a: Assumption, status: AssumptionStatus) {
    if (status === a.status) return;
    patch(a.id, (x) => ({ ...x, status }));
    record(a.id, RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_UPDATED, { assumptionId: a.id, status });
    announce(`“${titleOf(a)}” is now ${statusLabel(status).toLowerCase()}: ${standing(a.id)}`);
    refocus(a.id, "status");
  }

  function test(a: Assumption) {
    const current = fresh(a.id) ?? a;
    const link = sendHandoff("hypothesis", assumptionHypothesisSource(current), {
      getLinks: () => fresh(a.id)?.sentTo,
      setLinks: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) =>
        patch(a.id, (x) => ({ ...x, sentTo: update(x.sentTo) })),
    });
    if (!link) return;
    record(a.id, RISKIEST_ASSUMPTION_ACTIONS.TEST_GENERATED, {
      assumptionId: a.id,
      statement: a.statement,
      riskLevel: a.riskLevel ?? null,
      evidenceLevel: a.evidenceLevel ?? null,
    });
    record(a.id, RISKIEST_ASSUMPTION_ACTIONS.TEST_CREATED, {
      assumptionId: a.id,
      hypothesisId: link.targetId,
    });
    announce(`“${titleOf(a)}” is now a hypothesis to test in the Hypothesis Tracker`);
    refocus(a.id, "test");
  }

  function remove(a: Assumption) {
    focusPast(a.id);
    // Its hypothesis, if it has one, stays in the tracker.
    removeWithUndo<Assumption>({
      label: `Deleted “${titleOf(a)}”`,
      update: updateList,
      match: (x) => x.id === a.id,
    });
    record(a.id, RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_REMOVED, {
      assumptionId: a.id,
      statement: a.statement,
    });
    announce(`Deleted “${titleOf(a)}”`);
  }

  const loadExample = () => updateList((l) => [...buildExample(), ...l]);
  const clearExample = () => updateList((l) => l.filter((a) => !isExampleId(a.id)));

  /* ── Exports ── */

  const markdown = assumptionsToMarkdown(list, hypotheses);
  const csvData = {
    headers: [
      "Rank",
      "Assumption",
      "Risk",
      "Evidence",
      "Score",
      "Quadrant",
      "Status",
      "Test",
      "Test idea",
      "Description",
    ],
    rows: list.map((a) => {
      const t = linkedTest(a.sentTo, hypotheses);
      return [
        rankOf.get(a.id)?.rank ?? "",
        a.statement,
        ratingOf(a.riskLevel) ?? "",
        ratingOf(a.evidenceLevel) ?? "",
        assumptionScore(a) ?? "",
        rankOf.has(a.id) ? (QUADRANTS.find((q) => q.id === quadrantOf(a))?.label ?? "") : "",
        statusLabel(a.status),
        t.state === "none" ? "" : t.state === "testing" ? `testing (${t.status})` : t.result,
        a.testIdea ?? "",
        a.description ?? "",
      ];
    }),
  };
  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Riskiest Assumption Canvas",
      // The rows the page ranks: example rows next to the team's own stay out.
      prompts: generateRiskiestAssumptionPrompts(
        { assumptions: counted.rows, hypotheses },
        workspace
      ),
    }),
    [counted, hypotheses, workspace]
  );

  const cardProps = (a: Assumption): AssumptionCardProps => {
    // An example row aside is ranked among the example only.
    const r = rankOf.get(a.id) ?? asideRankOf.get(a.id);
    return {
      assumption: a,
      rank: r ? { rank: r.rank, score: r.score } : null,
      result: resultText(a, hypotheses),
      test: linkedTest(a.sentTo, hypotheses),
      offered: offeredStatus(a, hypotheses),
      example: isExampleId(a.id),
      first: view.ranked[0]?.assumption.id === a.id && view.ranked.length > 1,
      onWords: saveWords,
      onRate: rate,
      onStatus: setStatus,
      onTest: test,
      onRemove: remove,
    };
  };

  return (
    <ToolPageWrapper
      toolId="riskiest-assumption"
      title="Riskiest Assumption Canvas"
      description="List the assumptions behind your bet, rate each on risk and evidence, and test the riskiest, least-proven one first."
      category="Workshops & Facilitation"
    >
      <div ref={exportRef} className="space-y-6">
        {hasExampleItems(list) && <ExampleNotice onClear={clearExample} />}

        {list.length > 0 && (
          <ActionRow>
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="riskiest-assumption"
              csvData={csvData}
              jsonData={list}
              markdown={markdown}
              targetRef={exportRef}
            />
          </ActionRow>
        )}

        <div ref={formRef}>
          <AddAssumptionForm onAdd={add} />
        </div>

        {list.length === 0 ? (
          hydrated && (
            <EmptyState icon={ListOrdered} action={<LoadExampleButton onLoad={loadExample} />}>
              No assumptions yet. Add the beliefs your plan rests on and rate how risky and how
              proven each is, or load an example to see the ranking and the matrix.
            </EmptyState>
          )
        ) : (
          <>
            <p className="text-sm font-medium text-text">
              {verdict}
              {counted.example && <span className="text-sub"> (the example)</span>}
            </p>
            <KpiGrid cols={4}>
              <StatCard
                variant="compact"
                label="To test"
                value={view.ranked.length}
                hint="rated, not tested"
              />
              <StatCard
                variant="compact"
                label="Untested + risky"
                value={view.untestedRisky}
                hint="risk 4 or 5, no test yet"
                tone={view.untestedRisky > 0 ? "danger" : "default"}
              />
              <StatCard
                variant="compact"
                label="Not rated"
                value={view.unrated.length}
                tone={view.unrated.length > 0 ? "warning" : "default"}
              />
              <StatCard
                variant="compact"
                label="Tested"
                value={view.tested.length}
                tone={view.tested.length > 0 ? "success" : "default"}
              />
            </KpiGrid>

            {view.ranked.length > 0 && (
              <SectionCard title="Risk × Evidence matrix" icon={Grid2x2}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {QUADRANTS.map((q) => (
                    <section
                      key={q.id}
                      aria-label={`${q.label}: ${q.hint}`}
                      className={cn("min-w-0 rounded-lg border p-3", q.tone)}
                    >
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider">
                        {q.label} · {q.hint}
                      </h3>
                      {view.quadrants[q.id].length === 0 ? (
                        <p className="text-xs italic text-sub">None</p>
                      ) : (
                        <ul className="space-y-1 text-xs text-text">
                          {view.quadrants[q.id].map((a) => (
                            <li key={a.id} className="break-words">
                              {titleOf(a)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
              </SectionCard>
            )}

            <SectionCard
              title={`Ranked (${view.ranked.length})`}
              icon={ListOrdered}
              titleSuffix={<span className="text-xs text-sub">score = risk × (6 − evidence)</span>}
              contentClassName="space-y-3"
            >
              <ResortChip isStale={isStale} onResort={resort} what="Ratings" />
              {ordered.length === 0 ? (
                <p className="text-sm text-sub">
                  Nothing to rank: rate an assumption on both risk and evidence.
                </p>
              ) : (
                <ul className="space-y-3" aria-label="Ranked assumptions, test the first one first">
                  {ordered.map((a) => (
                    <li key={a.id} className="min-w-0">
                      <AssumptionCard {...cardProps(a)} />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {view.unrated.length > 0 && (
              <SectionCard
                title={`Not rated (${view.unrated.length})`}
                icon={CircleDashed}
                titleSuffix={<span className="text-xs text-sub">rate both to rank</span>}
              >
                <ul className="space-y-3" aria-label="Assumptions not rated yet">
                  {view.unrated.map((a) => (
                    <li key={a.id} className="min-w-0">
                      <AssumptionCard {...cardProps(a)} />
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}

            {view.tested.length > 0 && (
              <SectionCard title={`Tested (${view.tested.length})`} icon={CheckCircle2}>
                <ul className="space-y-3" aria-label="Tested assumptions">
                  {view.tested.map((a) => (
                    <li key={a.id} className="min-w-0">
                      <AssumptionCard {...cardProps(a)} />
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}

            {aside && (
              <SectionCard
                title={`Example (${counted.aside.length})`}
                icon={FlaskConical}
                titleSuffix={
                  <span className="text-xs text-sub">
                    ranked on its own, not counted with yours
                  </span>
                }
              >
                <ul className="space-y-3" aria-label="Example assumptions, not counted">
                  {[
                    ...aside.ranked.map((r) => r.assumption),
                    ...aside.unrated,
                    ...aside.tested,
                  ].map((a) => (
                    <li key={a.id} className="min-w-0">
                      <AssumptionCard {...cardProps(a)} />
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
