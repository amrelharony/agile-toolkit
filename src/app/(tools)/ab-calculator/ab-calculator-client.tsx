"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { Calculator, FlaskConical, ListChecks, Plus, Save, Scale } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { generateAbCalculatorPrompts } from "@/lib/ai-prompts/ab-calculator";
import { HOW_TO_READ } from "@/lib/experiments/ab";
import {
  abTests,
  countedTests,
  countsDraftFrom,
  countsTyped,
  emptyCountsDraft,
  emptyPlanDraft,
  planDraftFrom,
  planResult,
  testSummary,
  validateCounts,
  validatePlan,
  withCounts,
  type CountsDraft,
  type CountsValues,
  type PlanDraft,
} from "@/lib/experiments/model";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { AB_CALCULATOR_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  AbDecision,
  AbTest,
  AbTestStatus,
  Hypothesis,
  HypothesisTracker,
  ProductMetric,
} from "@/lib/stores/workspace-types";
import { TOOL_LIST_MAX, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { CountsFields } from "./counts-fields";
import { DetailsFields } from "./details-fields";
import { buildExample } from "./example";
import { testsToMarkdown } from "./markdown";
import { PlanFields } from "./plan-fields";
import { currentTests, findTest, removeTest, saveTest } from "./store";
import { TestCard, type CheckItem } from "./test-card";
import {
  emptyDetailsDraft,
  planForHypothesis,
  readHypothesisParam,
  validateDetails,
  type DetailsDraft,
  type DetailsField,
  type DetailsValues,
} from "./view";

export const TOOL_ID = "ab-calculator";

// Stable empty lists: zustand re-renders forever on a selector that returns a fresh array.
const NO_TESTS: AbTest[] = [];
const NO_TRACKERS: HypothesisTracker[] = [];
const NO_METRICS: ProductMetric[] = [];
const NO_HYPOTHESES: Hypothesis[] = [];

const nowIso = () => new Date().toISOString();
const sameCounts = (a: CountsValues | null, b: CountsValues | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The test with these details: a value left blank removes its key. */
function withDetails(base: AbTest, d: DetailsValues): AbTest {
  const next = { ...base, name: d.name, status: d.status } as AbTest & Record<string, unknown>;
  for (const key of ["question", "metricName", "metricId", "hypothesisId"] as const) {
    if (d[key] === undefined) delete next[key];
    else next[key] = d[key];
  }
  return next;
}

/** Days stamped as a test moves on: started when it runs, ended when it is done. */
function stampDays(t: AbTest, today: string): AbTest {
  const next = { ...t };
  if ((t.status === "running" || t.status === "done") && !t.startedOn) next.startedOn = today;
  if (t.status === "done" && !t.endedOn) next.endedOn = today;
  return next;
}

/** Focus the first field marked invalid inside `root`, once React has re-rendered. */
function focusInvalid(root: HTMLElement | null) {
  requestAnimationFrame(() => root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

/** Focus the "Open" button of the test with `id` (or `fallback`) once React has re-rendered. */
function focusTest(id: string | null, fallback?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const el = id
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-ab-open]")).find(
          (e) => e.getAttribute("data-ab-open") === id
        )
      : undefined;
    (el ?? fallback)?.focus();
  });
}

/**
 * A/B Calculator (on the More tools shelf): plan a conversion test before
 * it starts (how many people each version needs, and how long that takes
 * at your traffic), then read it when it ends (B against A with intervals,
 * p and a split check; "Too early to call" until the planned sample is
 * in). A saved test keeps its plan, counts, guardrails, status and the
 * team's decision in workspace.abTests, which tool.ab_calculator and the
 * next step read too. A test linked to a hypothesis shows that
 * hypothesis's status live; the result goes on the hypothesis card in the
 * Hypothesis Tracker, never from here.
 */
export function AbCalculatorClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.abTests) ?? NO_TESTS;
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers) ?? NO_TRACKERS;
  const metrics = useWorkspaceStore((s) => s.productMetrics) ?? NO_METRICS;
  const hypotheses =
    trackers.find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? NO_HYPOTHESES;
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const today = todayLocalISO();

  const [plan, setPlan] = useState<PlanDraft>(emptyPlanDraft);
  const [counts, setCounts] = useState<CountsDraft>(emptyCountsDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [pendingHypothesis, setPendingHypothesis] = useState<string | null>(null);
  const calcRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);

  const tests = useMemo(
    () => [...abTests(raw)].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [raw]
  );
  const counted = useMemo(() => countedTests(tests), [tests]);
  const editing = editingId ? (tests.find((t) => t.id === editingId) ?? null) : null;
  const checkedPlan = validatePlan(plan);
  const markdown = useMemo(() => testsToMarkdown(tests), [tests]);
  const promptConfig = useMemo(
    () => ({ toolName: "A/B Calculator", prompts: generateAbCalculatorPrompts(counted.tests) }),
    [counted]
  );

  // The example's tests aren't the team's history.
  const record = (id: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(id)) log(action, payload);
  };

  const details = useItemForm<DetailsDraft, DetailsValues, DetailsField>({
    initial: emptyDetailsDraft,
    validate: validateDetails,
    onSave: (values) => saveAll(values),
    resetOnSave: false,
  });

  /* ── The calculator ──────────────────────────────────────────────── */

  function startNew() {
    setPlan(emptyPlanDraft());
    setCounts(emptyCountsDraft());
    details.reset(emptyDetailsDraft());
    setEditingId(null);
    setTried(false);
  }

  function open(t: AbTest) {
    setPlan(planDraftFrom(t.plan));
    setCounts(countsDraftFrom(t.variants));
    details.reset({
      name: t.name,
      question: t.question ?? "",
      metricName: t.metricName ?? "",
      metricId: t.metricId ?? "",
      hypothesisId: t.hypothesisId ?? "",
      status: t.status,
    });
    setEditingId(t.id);
    setTried(false);
    announce(`Opened “${t.name}” in the calculator`);
    requestAnimationFrame(() => calcRef.current?.querySelector<HTMLElement>("input")?.focus());
  }

  function saveAll(values: DetailsValues) {
    setTried(true);
    const p = validatePlan(plan);
    const c = countsTyped(counts) ? validateCounts(counts) : null;
    if (!p.ok || (c && !c.ok)) {
      announce("Not saved yet: fix the plan or the counts first.");
      focusInvalid(calcRef.current);
      return;
    }
    const nextCounts = c?.ok ? c.values : null;
    const at = nowIso();
    const prev = editingId ? findTest(editingId) : undefined;
    if (prev) {
      const next = stampDays(
        withDetails(
          {
            ...prev,
            plan: p.values,
            variants: withCounts(prev.variants, nextCounts),
            updatedAt: at,
          },
          values
        ),
        today
      );
      if (
        JSON.stringify({ ...next, updatedAt: "" }) === JSON.stringify({ ...prev, updatedAt: "" })
      ) {
        announce(`No changes to save on “${prev.name}”`);
        return;
      }
      saveTest(next);
      record(next.id, AB_CALCULATOR_ACTIONS.TEST_UPDATED, { testId: next.id });
      if (!sameCounts(nextCounts, testSummary(prev).counts) && nextCounts) {
        record(next.id, AB_CALCULATOR_ACTIONS.COUNTS_RECORDED, {
          testId: next.id,
          significant: testSummary(next).result?.analysis.significant ?? false,
        });
      }
      announce(`Saved “${next.name}”`);
      return;
    }
    const sized = planResult(p.values);
    const next = stampDays(
      withDetails(
        {
          id: `abtest_${nanoid(8)}`,
          name: values.name,
          plan: p.values,
          variants: withCounts(undefined, nextCounts),
          status: values.status,
          createdAt: at,
          updatedAt: at,
        },
        values
      ),
      today
    );
    saveTest(next);
    record(next.id, AB_CALCULATOR_ACTIONS.TEST_SAVED, {
      testId: next.id,
      perVariant: sized?.perVariant ?? null,
      days: sized?.run?.days ?? null,
    });
    if (nextCounts) {
      record(next.id, AB_CALCULATOR_ACTIONS.COUNTS_RECORDED, {
        testId: next.id,
        significant: testSummary(next).result?.analysis.significant ?? false,
      });
    }
    setEditingId(next.id);
    announce(`Saved “${next.name}”`);
  }

  /* ── `?hypothesis=<id>`: a new plan for a hypothesis ─────────────── */

  useEffect(() => {
    if (!pendingHypothesis || !hydrated) return;
    const h = hypotheses.find((x) => x.id === pendingHypothesis);
    setPendingHypothesis(null);
    dropSearchParam("hypothesis");
    if (!h) {
      announce("That hypothesis isn't in the Hypothesis Tracker any more.");
      return;
    }
    const start = planForHypothesis(h);
    setPlan(start.plan);
    setCounts(emptyCountsDraft());
    details.reset(start.details);
    setEditingId(null);
    setTried(false);
    announce(`A new plan for “${start.details.name}”`);
    requestAnimationFrame(() => calcRef.current?.querySelector<HTMLElement>("input")?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per link, when the workspace is in
  }, [pendingHypothesis, hydrated, hypotheses]);

  /* ── A saved test's card ─────────────────────────────────────────── */

  const update = (t: AbTest, patch: (cur: AbTest) => AbTest | null) => {
    const cur = findTest(t.id);
    if (!cur) return null;
    const next = patch(cur);
    if (!next) return null;
    saveTest({ ...next, updatedAt: nowIso() });
    return next;
  };

  const setStatus = (t: AbTest, status: AbTestStatus) => {
    if (t.status === status) return;
    const next = update(t, (cur) => stampDays({ ...cur, status }, today));
    if (!next) return;
    // The calculator's form follows when it holds this test, so "Save
    // changes" keeps the status the card set rather than the one it opened with.
    if (t.id === editingId) details.update({ status });
    record(t.id, AB_CALCULATOR_ACTIONS.TEST_UPDATED, { testId: t.id });
    announce(`“${t.name}” is now ${status}`);
  };

  const setDecision = (t: AbTest, decision: AbDecision | null) => {
    if ((t.decision ?? null) === decision) return;
    const next = update(t, (cur) => {
      const n = { ...cur };
      if (decision) n.decision = decision;
      else delete n.decision;
      return n;
    });
    if (!next) return;
    record(t.id, AB_CALCULATOR_ACTIONS.DECISION_SET, { testId: t.id, decision });
    announce(decision ? `Decided on “${t.name}”` : `Cleared the decision on “${t.name}”`);
  };

  const setNote = (t: AbTest, value: string) => {
    const note = value.trim().slice(0, Math.max(TOOL_TEXT_MAX.text, (t.note ?? "").length));
    if (note === (t.note ?? "")) return;
    update(t, (cur) => {
      const n = { ...cur };
      if (note) n.note = note;
      else delete n.note;
      return n;
    });
    record(t.id, AB_CALCULATOR_ACTIONS.TEST_UPDATED, { testId: t.id });
  };

  /** Accepted checks: guardrails join the test's (at most three), risks its note; with Undo. */
  const acceptChecks = (t: AbTest, items: readonly CheckItem[]) => {
    const prev = findTest(t.id);
    if (!prev) return;
    const guardrails = [...(prev.guardrails ?? [])];
    const lines = (prev.note ?? "").split("\n").filter((l) => l.trim());
    let added = 0;
    let full = false;
    for (const item of items) {
      if (item.kind === "guardrail") {
        if (
          guardrails.some((g) => g.name.trim().toLowerCase() === item.name.trim().toLowerCase())
        ) {
          continue;
        }
        if (guardrails.length >= TOOL_LIST_MAX.abGuardrails) {
          full = true;
          continue;
        }
        guardrails.push({
          name: item.name.slice(0, TOOL_TEXT_MAX.short),
          why: item.why.slice(0, TOOL_TEXT_MAX.text),
        });
        added += 1;
      } else {
        if (lines.includes(item.text)) continue;
        if ([...lines, item.text].join("\n").length > TOOL_TEXT_MAX.text) {
          full = true;
          continue;
        }
        lines.push(item.text);
        added += 1;
      }
    }
    if (added === 0) {
      announce(
        full
          ? `“${prev.name}” has no room for that: it keeps ${TOOL_LIST_MAX.abGuardrails} guardrails and a note of up to ${TOOL_TEXT_MAX.text} characters.`
          : `“${prev.name}” has those already.`
      );
      return;
    }
    const label =
      added === 1 ? `Added a check to “${prev.name}”` : `Added ${added} checks to “${prev.name}”`;
    undoable({
      label,
      apply: () => {
        const next: AbTest = { ...prev, updatedAt: nowIso() };
        if (guardrails.length > 0) next.guardrails = guardrails;
        const note = lines.join("\n");
        if (note) next.note = note;
        saveTest(next);
        record(prev.id, AB_CALCULATOR_ACTIONS.TEST_UPDATED, { testId: prev.id });
      },
      revert: () => {
        saveTest(prev);
      },
    });
    announce(full ? `${label}; the rest didn't fit` : label);
  };

  const removeGuardrail = (t: AbTest, index: number) => {
    const prev = findTest(t.id);
    const g = prev?.guardrails?.[index];
    if (!prev || !g) return;
    const label = `Removed the guardrail ${g.name}`;
    undoable({
      label,
      apply: () => {
        const next: AbTest = { ...prev, updatedAt: nowIso() };
        const kept = (prev.guardrails ?? []).filter((_, i) => i !== index);
        if (kept.length > 0) next.guardrails = kept;
        else delete next.guardrails;
        saveTest(next);
        record(prev.id, AB_CALCULATOR_ACTIONS.TEST_UPDATED, { testId: prev.id });
      },
      revert: () => {
        saveTest(prev);
      },
    });
    announce(label);
  };

  const remove = (t: AbTest) => {
    const at = tests.findIndex((x) => x.id === t.id);
    const neighbour = tests[at + 1] ?? tests[at - 1];
    let snapshot: AbTest | null = null;
    const label = `Deleted “${t.name}”`;
    undoable({
      label,
      apply: () => {
        snapshot = removeTest(t.id);
        record(t.id, AB_CALCULATOR_ACTIONS.TEST_REMOVED, { testId: t.id });
      },
      revert: () => {
        if (snapshot) saveTest(snapshot);
        focusTest(t.id);
      },
    });
    // The calculator keeps its numbers, now as an unsaved plan.
    if (editingId === t.id) setEditingId(null);
    focusTest(neighbour?.id ?? null, newRef.current);
    announce(label);
  };

  // Loading is offered on an empty list only, and neither it nor its
  // clearing is logged: the example isn't the team's work.
  const loadExample = () => buildExample(today).forEach(saveTest);
  const clearExample = () => {
    let removed: AbTest[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = currentTests()
          .filter((t) => isExampleId(t.id))
          .map((t) => removeTest(t.id))
          .filter((t): t is AbTest => t !== null);
      },
      revert: () => removed.forEach(saveTest),
    });
    if (editingId && isExampleId(editingId)) startNew();
    focusTest(null, newRef.current);
  };

  return (
    <ToolPageWrapper
      toolId="ab-calculator"
      title="A/B Calculator"
      description="Plan an A/B test's size and length, then read its result."
      category="Experimentation & A/B"
    >
      <OnSearchParams onChange={(search) => setPendingHypothesis(readHypothesisParam(search))} />
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the A/B tests…
        </p>
      ) : (
        <div className="space-y-4">
          {hasExampleItems(tests) && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                Example: a sign-up test whose counts are in, and one still being planned.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {tests.length > 0 && (
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="ab-tests"
                  markdown={markdown}
                  clipboardText={markdown}
                  jsonData={tests}
                />
              </>
            )}
            <Button ref={newRef} type="button" size="sm" className="gap-1" onClick={startNew}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New test
            </Button>
          </div>

          <div ref={calcRef} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SectionCard
              title={editing ? `Plan: ${editing.name}` : "Plan a test"}
              icon={Calculator}
            >
              <PlanFields
                draft={plan}
                onChange={(patch) => setPlan((d) => ({ ...d, ...patch }))}
                showAll={tried}
              />
            </SectionCard>
            <SectionCard title="Read the result" icon={Scale}>
              <CountsFields
                draft={counts}
                plan={checkedPlan.ok ? checkedPlan.values : null}
                onChange={(patch) => setCounts((d) => ({ ...d, ...patch }))}
                showAll={tried}
              />
            </SectionCard>
          </div>

          <SectionCard title={editing ? "Save the changes" : "Save this test"} icon={Save}>
            <ItemForm
              form={details}
              submitLabel={editing ? "Save changes" : "Save test"}
              submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
            >
              <DetailsFields form={details} hypotheses={hypotheses} metrics={metrics} />
            </ItemForm>
          </SectionCard>

          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            <p className="font-medium text-text">How to read this</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sub">
              {HOW_TO_READ.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <SectionCard title={`Saved tests (${tests.length})`} icon={ListChecks}>
            {tests.length === 0 ? (
              <EmptyState icon={FlaskConical} action={<LoadExampleButton onLoad={loadExample} />}>
                No saved tests yet. Plan one above and save it to keep its counts and decision, or
                load an example to see a finished test read.
              </EmptyState>
            ) : (
              <ul className="space-y-3" aria-label="Saved tests, newest first">
                {tests.map((t) => (
                  <li key={t.id} className="min-w-0">
                    <TestCard
                      test={t}
                      hypotheses={hypotheses}
                      metrics={metrics}
                      onOpen={open}
                      onRemove={remove}
                      onStatus={setStatus}
                      onDecision={setDecision}
                      onNote={setNote}
                      onAcceptChecks={acceptChecks}
                      onRemoveGuardrail={removeGuardrail}
                    />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      )}
    </ToolPageWrapper>
  );
}
