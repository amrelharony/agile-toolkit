// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateHypothesisTrackerPrompts } from "@/lib/ai-prompts/hypothesis-tracker";
import { hypothesisVerdict, validationRate } from "@/lib/hypotheses/model";
import type { Hypothesis } from "@/lib/stores/workspace-types";

/**
 * The hypothesis prompt reads the tests as the page does (lib/hypotheses):
 * the validation rate without inconclusive results, "—" with no decisive
 * one (never 0%), each target and measured result with the verdict the
 * numbers suggest, and what a hand-off draft still needs.
 */

const hyp = (id: string, extra: Partial<Hypothesis> = {}): Hypothesis => ({
  id,
  believe: `Belief ${id}`,
  willDo: "Run a test",
  toLearn: "Whether it works",
  successMetric: "Sign-up rate",
  status: "running",
  raisedAt: "2026-10-01",
  ...extra,
});

const ITEMS: Hypothesis[] = [
  hyp("met", {
    status: "validated",
    resolvedAt: "2026-10-10",
    target: { direction: "increase", value: 12, unit: "%", baseline: 10 },
    actual: 14,
    outcome: "Held up",
  }),
  hyp("missed", {
    target: { direction: "decrease", value: 3, unit: "days" },
    actual: 5,
  }),
  hyp("odd", { status: "inconclusive", resolvedAt: "2026-10-12" }),
  hyp("draft", { status: "drafted", willDo: "", successMetric: "" }),
];

describe("generateHypothesisTrackerPrompts", () => {
  const rate = validationRate(ITEMS);
  const [quality, portfolio] = generateHypothesisTrackerPrompts({
    items: ITEMS,
    validationRate: rate.rate,
    medianTimeToValidate: null,
    results: 2,
    verdict: hypothesisVerdict(rate),
  });

  it("quotes the rate over decisive results only, and the page's verdict", () => {
    expect(quality.prompt).toContain(
      "Validation rate: 100% of decisive results held up (inconclusive ones aren't counted)."
    );
    expect(quality.prompt).toContain(
      "Median time to a result: — (shows once 5 tests have a result; 2 so far)."
    );
    expect(quality.prompt).toContain(
      "Verdict: 1 of 1 decisive test held up (100%); 1 inconclusive isn't counted; 2 still open."
    );
  });

  it("states each target, the measured result and the suggested verdict", () => {
    expect(quality.prompt).toContain(
      "| Belief met | Run a test | Sign-up rate | at least 12% (from 10%) | 14% | validated (target met) | Validated | Held up |"
    );
    expect(quality.prompt).toContain(
      "| Belief missed | Run a test | Sign-up rate | at most 3 days | 5 days | invalidated (target missed) | Running | — |"
    );
    expect(portfolio.prompt).toContain(
      "| Belief odd | Run a test | Sign-up rate | No numeric target | — | — | Inconclusive | — |"
    );
  });

  it("names what a hand-off draft still needs", () => {
    expect(quality.prompt).toContain(
      "| Belief draft | — | — | No numeric target | — | — | Drafted (needs what we'll do and the success metric) | — |"
    );
  });

  it("reads “—”, never 0%, with no decisive result", () => {
    const [p] = generateHypothesisTrackerPrompts({
      items: [hyp("open")],
      validationRate: null,
      medianTimeToValidate: 9,
      results: 6,
    });
    expect(p.prompt).toContain("Validation rate: — (no decisive result yet).");
    expect(p.prompt).not.toContain("0%");
    expect(p.prompt).toContain(
      "Median time to a result: 9 days (over 6 results; open tests count as still waiting)."
    );
    expect(
      generateHypothesisTrackerPrompts({
        items: [],
        validationRate: null,
        medianTimeToValidate: null,
        results: 0,
      })
    ).toEqual([]);
  });

  it("tells too few results apart from fewer than half with a result, as the page does", () => {
    // Enough results for the sample, but the Kaplan-Meier median isn't reached yet.
    const [p] = generateHypothesisTrackerPrompts({
      items: ITEMS,
      validationRate: rate.rate,
      medianTimeToValidate: null,
      results: 5,
    });
    expect(p.prompt).toContain(
      "Median time to a result: — (over 5 results, fewer than half of the tests have given a result yet)."
    );
    expect(p.prompt).not.toContain("shows once");
  });
});
