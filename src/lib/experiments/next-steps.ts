/**
 * The A/B Calculator's data-aware next steps (lib/tools/next-steps.ts calls
 * `abCalculatorSteps` with the workspace's tests and the Hypothesis
 * Tracker's list). Example rows are left out. In order:
 *   1. a running test has run its planned days, or its smaller version has
 *      reached the planned sample: read its result;
 *   2. a decided test's hypothesis is still drafted or running: use the
 *      result on the hypothesis card (the tracker writes it, not this page);
 *   3. a running hypothesis with a "%" target and an A/B or split
 *      experiment has no test yet: plan one.
 * Pure: no store, no React, no "use client" module.
 */

import type { AbTest, HypothesisTracker } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { addDays } from "@/lib/flow/days";
import { isExampleId } from "@/lib/utils/example-id";
import { abTests, countText, planResult, testCounts } from "./model";

/** What the rule reads from the workspace. */
export interface AbCalculatorStepsInput {
  tests: readonly AbTest[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
}

/** An experiment line that names a split test. */
export const SPLIT_EXPERIMENT = /\b(a\/b|split)\b/i;

const QUOTE_MAX = 60;

/** A name for a label: one line, cut at a word, in curly quotes. */
function quoted(text: string | undefined, untitled: string): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return `“${untitled}”`;
  if (t.length <= QUOTE_MAX) return `“${t}”`;
  const cut = t.slice(0, QUOTE_MAX);
  const space = cut.lastIndexOf(" ");
  return `“${(space > QUOTE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…”`;
}

/** Why a running test is ready to read, or null while it still runs. */
function readyReason(t: AbTest, today: string): string | null {
  const sized = planResult(t.plan);
  if (!sized) return null;
  const counts = testCounts(t);
  if (counts) {
    const smaller = Math.min(counts.a.visitors, counts.b.visitors);
    if (smaller >= sized.perVariant) {
      return `Each version has at least ${countText(sized.perVariant)} visitors, the sample the plan needs.`;
    }
  }
  if (sized.run && t.startedOn) {
    const end = addDays(t.startedOn, sized.run.days);
    if (end && end <= today) {
      return `It started on ${t.startedOn} and has run the ${sized.run.days} days the plan needs. Type the visitors and conversions to read it.`;
    }
  }
  return null;
}

/** The A/B Calculator's next steps, given today (YYYY-MM-DD). */
export function abCalculatorSteps(s: AbCalculatorStepsInput, today: string): NextStep[] {
  const tests = abTests(s.tests).filter((t) => !isExampleId(t.id));
  const hypotheses = (
    (s.trackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? []
  ).filter((h) => !isExampleId(h.id));
  const steps: NextStep[] = [];

  const ready = tests
    .filter((t) => t.status === "running")
    .map((t) => ({ t, why: readyReason(t, today) }))
    .filter((x): x is { t: AbTest; why: string } => x.why !== null);
  const [first] = ready;
  if (first) {
    steps.push({
      id: "ab-calculator-read",
      label: `Read the result of ${quoted(first.t.name, "a running test")}`,
      detail:
        ready.length > 1
          ? `${first.why} ${ready.length - 1} other running ${ready.length - 1 === 1 ? "test is" : "tests are"} ready too.`
          : first.why,
      href: "/ab-calculator",
    });
  }

  const byId = new Map(hypotheses.map((h) => [h.id, h]));
  const decided = tests.find((t) => {
    if (!t.decision || !t.hypothesisId) return false;
    const h = byId.get(t.hypothesisId);
    return h !== undefined && (h.status === "drafted" || h.status === "running");
  });
  if (decided) {
    const h = byId.get(decided.hypothesisId as string);
    steps.push({
      id: "ab-calculator-use-result",
      label: "Use the A/B result on its hypothesis",
      detail: `${quoted(decided.name, "A test")} is decided, and its hypothesis ${quoted(h?.believe, "untitled")} is still ${h?.status}. “Use the A/B result” on its card records it there.`,
      href: "/hypothesis-tracker",
    });
  }

  const tested = new Set(tests.map((t) => t.hypothesisId).filter(Boolean));
  const untested = hypotheses.find(
    (h) =>
      h.status === "running" &&
      h.target?.unit?.trim() === "%" &&
      SPLIT_EXPERIMENT.test(h.experiment ?? "") &&
      !tested.has(h.id)
  );
  if (untested) {
    steps.push({
      id: "ab-calculator-plan",
      label: "Plan the A/B test",
      detail: `${quoted(untested.believe, "A running hypothesis")} is tested with a split, but no A/B plan says how many people it needs or for how long.`,
      href: `/ab-calculator?hypothesis=${encodeURIComponent(untested.id)}`,
    });
  }
  return steps;
}
