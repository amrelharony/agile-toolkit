/**
 * The tools plan's phase 2 next steps, as the base wires them: each of the
 * 17 new tools has a lazy rule over its own module (a stub until its builder
 * fills it), and the two existing rules the base touched keep their steps:
 * the Hypothesis Tracker leaves value checks out of "Record the result", and
 * Release Readiness appends the release-notes steps (none yet). The tools'
 * own cases go in their chains' files, not here.
 */

import { describe, expect, it } from "vitest";
import {
  getNextStepRule,
  loadNextStepRule,
  toolsWithNextSteps,
  type NextStep,
} from "@/lib/tools/next-steps";
import { emptyWorkspace, type Hypothesis, type Workspace } from "@/lib/stores/workspace-types";
import { isValueCheck } from "@/lib/hypotheses/value-steps";

const PHASE_2_TOOLS = [
  "example-mapping",
  "relative-sizing",
  "bug-triage",
  "hill-chart",
  "test-sessions",
  "notes-to-actions",
  "product-canvas",
  "impact-map",
  "strategy-tree",
  "persona-library",
  "product-metrics",
  "ab-calculator",
  "ebm-dashboard",
  "flow-insights",
  "improve",
  "kickoff",
  "team-time",
];

const steps = (toolId: string, ws: Partial<Workspace>): NextStep[] => {
  const rule = getNextStepRule(toolId);
  if (!rule) throw new Error(`no rule for ${toolId}`);
  return rule.steps(rule.select({ ...emptyWorkspace, ...ws } as Workspace));
};

describe("the phase 2 tools' next-step rules", () => {
  it.each(PHASE_2_TOOLS)("%s has a lazy rule whose module loads", async (toolId) => {
    expect(toolsWithNextSteps()).toContain(toolId);
    const rule = getNextStepRule(toolId)!;
    expect(rule.load, toolId).toBeDefined();
    await loadNextStepRule(toolId);
    expect(rule.ready?.()).toBe(true);
    expect(Array.isArray(steps(toolId, {}))).toBe(true);
  });
});

describe("the rules the base touched", () => {
  const hypothesis = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
    id,
    believe: `Belief ${id}`,
    willDo: "Run it",
    toLearn: "Whether it works",
    successMetric: "Sign-ups",
    status: "running",
    raisedAt: "2026-10-01",
    target: { direction: "increase", value: 12 },
    ...over,
  });
  const trackers = (hypotheses: Hypothesis[]) => [{ id: "hypothesisTracker:current", hypotheses }];

  it("a value check is a hypothesis that follows shipped work", () => {
    expect(isValueCheck(hypothesis("h"))).toBe(false);
    expect(
      isValueCheck(
        hypothesis("h", {
          shipped: { kind: "story", id: "s1", title: "Pay", doneAt: "2026-10-02" },
        })
      )
    ).toBe(true);
  });

  it("the Hypothesis Tracker doesn't ask for a value check's result on day one", () => {
    const shipped = { kind: "story" as const, id: "s1", title: "Pay", doneAt: "2026-10-02" };
    const ids = (hs: Hypothesis[]) =>
      steps("hypothesis-tracker", { hypothesisTrackers: trackers(hs) }).map((s) => s.id);
    expect(ids([hypothesis("h1", { shipped })])).not.toContain("hypothesis-tracker-result");
    expect(ids([hypothesis("h1")])).toContain("hypothesis-tracker-result");
  });

  it("Release Readiness gives no release-notes step yet", () => {
    expect(steps("release-readiness", {})).toEqual([]);
  });
});
