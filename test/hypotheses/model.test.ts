/**
 * lib/hypotheses/model: the rate over decisive results, the suggested
 * verdict from a target and a measured result, hand-off drafts, a source's
 * linked test, and the form's checks (backdating, targets, kept text).
 */

import { describe, expect, it } from "vitest";
import type { Hypothesis, HypothesisStatus } from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import {
  HYPOTHESIS_STATUSES,
  HYPOTHESIS_TEXT_MAX,
  HYPOTHESIS_TRACKER_ID,
  RESOLVED,
  applyHypothesisValues,
  believeLine,
  emptyHypothesisDraft,
  formatMetric,
  hypothesisDraftFrom,
  hypothesisFromSource,
  hypothesisLink,
  hypothesisVerdict,
  isDay,
  isResolved,
  linkedTest,
  missingFields,
  suggestVerdict,
  suggestionText,
  validateHypothesis,
  validationRate,
  withHypothesis,
  type HypothesisDraft,
} from "@/lib/hypotheses/model";
import { HYPOTHESIS_TRACKER_ID as TARGET_TRACKER_ID } from "@/lib/handoffs/targets/hypothesis";

const TODAY = "2026-10-27";

const hyp = (id: string, status: HypothesisStatus, over: Partial<Hypothesis> = {}): Hypothesis => ({
  id,
  believe: `b ${id}`,
  willDo: "w",
  toLearn: "l",
  successMetric: "m",
  status,
  raisedAt: "2026-10-01",
  ...over,
});

const draft = (over: Partial<HypothesisDraft> = {}): HypothesisDraft => ({
  ...emptyHypothesisDraft(TODAY),
  believe: "Teams will pay for a weekly report",
  willDo: "Offer it on the pricing page",
  toLearn: "Whether it is worth building",
  successMetric: "8% of visitors click",
  ...over,
});

describe("statuses", () => {
  it("lists the lifecycle, and only the three results are resolved", () => {
    expect(HYPOTHESIS_STATUSES).toEqual([
      "drafted",
      "running",
      "validated",
      "invalidated",
      "inconclusive",
    ]);
    expect(Array.from(RESOLVED).sort()).toEqual(["inconclusive", "invalidated", "validated"]);
    expect(isResolved("running")).toBe(false);
    expect(isResolved("inconclusive")).toBe(true);
    expect(isResolved(undefined)).toBe(false);
  });

  it("keeps one tracker id, which the hand-off re-exports", () => {
    expect(HYPOTHESIS_TRACKER_ID).toBe("hypothesisTracker:current");
    expect(TARGET_TRACKER_ID).toBe(HYPOTHESIS_TRACKER_ID);
  });
});

describe("validationRate", () => {
  it("is validated over decisive: inconclusive results aren't counted", () => {
    const r = validationRate([
      hyp("a", "validated"),
      hyp("b", "invalidated"),
      hyp("c", "inconclusive"),
      hyp("d", "running"),
      hyp("e", "drafted"),
    ]);
    expect(r).toEqual({
      validated: 1,
      invalidated: 1,
      inconclusive: 1,
      open: 2,
      decisive: 2,
      rate: 0.5,
    });
  });

  it("is null, not 0, with no decisive result", () => {
    expect(validationRate([hyp("a", "inconclusive"), hyp("b", "running")]).rate).toBeNull();
    expect(validationRate([]).rate).toBeNull();
    expect(validationRate(undefined).decisive).toBe(0);
  });

  it("leaves out example rows, and counts an unknown status as open", () => {
    const r = validationRate([
      hyp("example-1", "validated"),
      hyp("a", "invalidated"),
      { id: "x", status: "parked" as HypothesisStatus },
    ]);
    expect(r.validated).toBe(0);
    expect(r.rate).toBe(0);
    expect(r.open).toBe(1);
  });
});

describe("hypothesisVerdict", () => {
  it("says how many decisive tests held up, what isn't counted and what is open", () => {
    const r = validationRate([
      hyp("a", "validated"),
      hyp("b", "validated"),
      hyp("c", "validated"),
      hyp("d", "invalidated"),
      hyp("e", "invalidated"),
      hyp("f", "inconclusive"),
      hyp("g", "inconclusive"),
      hyp("h", "running"),
      hyp("i", "running"),
      hyp("j", "drafted"),
      hyp("k", "drafted"),
    ]);
    expect(hypothesisVerdict(r)).toBe(
      "3 of 5 decisive tests held up (60%); 2 inconclusive aren't counted; 4 still open."
    );
  });

  it("reads in the singular, without a rate, and with nothing at all", () => {
    expect(
      hypothesisVerdict(validationRate([hyp("a", "validated"), hyp("b", "inconclusive")]))
    ).toBe("1 of 1 decisive test held up (100%); 1 inconclusive isn't counted.");
    expect(hypothesisVerdict(validationRate([hyp("a", "running")]))).toBe(
      "No test has a decisive result yet; 1 still open."
    );
    expect(hypothesisVerdict(validationRate([]))).toBe("No hypotheses yet.");
  });
});

describe("suggestVerdict", () => {
  it("suggests validated when a rise reaches its target, with how far it moved", () => {
    expect(
      suggestVerdict({
        target: { direction: "increase", value: 12, unit: "%", baseline: 10 },
        actual: 14,
      })
    ).toEqual({ verdict: "validated", met: true, margin: 2, moved: 4 });
  });

  it("counts reaching the target exactly as met", () => {
    expect(suggestVerdict({ target: { direction: "increase", value: 12 }, actual: 12 })?.met).toBe(
      true
    );
    expect(suggestVerdict({ target: { direction: "decrease", value: 5 }, actual: 5 })?.met).toBe(
      true
    );
  });

  it("signs the margin so that positive is better for a fall too", () => {
    expect(
      suggestVerdict({ target: { direction: "decrease", value: 5, baseline: 9 }, actual: 7 })
    ).toEqual({ verdict: "invalidated", met: false, margin: -2, moved: -2 });
    expect(suggestVerdict({ target: { direction: "decrease", value: 5 }, actual: 3 })).toEqual({
      verdict: "validated",
      met: true,
      margin: 2,
    });
  });

  it("tidies floating-point noise", () => {
    expect(
      suggestVerdict({ target: { direction: "increase", value: 0.2, baseline: 0.1 }, actual: 0.3 })
    ).toMatchObject({ margin: 0.1, moved: 0.2 });
  });

  it("is null without a target or a measured number", () => {
    expect(suggestVerdict({ actual: 3 })).toBeNull();
    expect(suggestVerdict({ target: { direction: "increase", value: 3 } })).toBeNull();
    expect(suggestVerdict({ target: { direction: "increase", value: 3 }, actual: NaN })).toBeNull();
    expect(
      suggestVerdict({ target: { direction: "increase", value: Infinity }, actual: 3 })
    ).toBeNull();
  });

  it("puts the suggestion in words", () => {
    expect(
      suggestionText({
        target: { direction: "increase", value: 12, unit: "%", baseline: 10 },
        actual: 14,
      })
    ).toBe("Target met: 14% against at least 12% (up 4 from 10%). Suggested verdict: validated.");
    expect(
      suggestionText({
        target: { direction: "decrease", value: 5, unit: "s", baseline: 9 },
        actual: 9,
      })
    ).toBe(
      "Target missed: 9 s against at most 5 s (no change from 9 s). Suggested verdict: invalidated."
    );
    expect(
      suggestionText({
        target: { direction: "increase", value: 40, unit: "sign-ups", baseline: 60 },
        actual: 50,
      })
    ).toBe(
      "Target met: 50 sign-ups against at least 40 sign-ups (down 10 from 60 sign-ups). Suggested verdict: validated."
    );
    expect(suggestionText({ target: { direction: "increase", value: 1 } })).toBeNull();
  });

  it("formats a number with its unit", () => {
    expect(formatMetric(14, "%")).toBe("14%");
    expect(formatMetric(3.14159, " sign-ups ")).toBe("3.14 sign-ups");
    expect(formatMetric(7)).toBe("7");
  });
});

describe("hand-off drafts", () => {
  it("lists the lines a test can't run without", () => {
    expect(missingFields(hyp("a", "drafted", { willDo: " ", successMetric: "" }))).toEqual([
      "willDo",
      "successMetric",
    ]);
    expect(missingFields(hyp("a", "drafted"))).toEqual([]);
    expect(
      missingFields({ willDo: undefined, successMetric: "m" } as unknown as Hypothesis)
    ).toEqual(["willDo"]);
  });

  it("drops a leading 'We believe' the tracker's label already says", () => {
    expect(believeLine("We believe that teams will pay")).toBe("that teams will pay");
    expect(believeLine("  we believe: teams will pay ")).toBe("teams will pay");
    expect(believeLine("We believe")).toBe("We believe");
    expect(believeLine("Teams will pay")).toBe("Teams will pay");
  });

  it("builds the drafted hypothesis a source hands over", () => {
    const src: HandoffSource = {
      title: " Teams will pay ",
      description: "Whether to build it",
      hypothesis: { willDo: "Fake door", experiment: "2 weeks", successMetric: "8%" },
      sourceRef: { tool: "riskiest-assumption", id: "a1", doc: "riskiestAssumption:current" },
    };
    expect(hypothesisFromSource(src, "h1", TODAY)).toEqual({
      id: "h1",
      believe: "Teams will pay",
      willDo: "Fake door",
      toLearn: "Whether to build it",
      successMetric: "8%",
      experiment: "2 weeks",
      status: "drafted",
      raisedAt: TODAY,
      sourceRef: src.sourceRef,
    });
    const bare = hypothesisFromSource(
      { title: "X", sourceRef: { tool: "cynefin", id: "c" } },
      "h2",
      TODAY
    );
    expect(bare).toEqual({
      id: "h2",
      believe: "X",
      willDo: "",
      toLearn: "",
      successMetric: "",
      status: "drafted",
      raisedAt: TODAY,
      sourceRef: { tool: "cynefin", id: "c" },
    });
  });

  it("caps each field", () => {
    const long = "z".repeat(HYPOTHESIS_TEXT_MAX + 10);
    const h = hypothesisFromSource(
      {
        title: long,
        description: long,
        hypothesis: { willDo: long },
        sourceRef: { tool: "t", id: "i" },
      },
      "h",
      TODAY
    );
    expect(h.believe).toHaveLength(HYPOTHESIS_TEXT_MAX);
    expect(h.toLearn).toHaveLength(HYPOTHESIS_TEXT_MAX);
    expect(h.willDo).toHaveLength(HYPOTHESIS_TEXT_MAX);
  });
});

describe("linkedTest", () => {
  const link = (targetId: string) => [
    { route: "kanban" as const, targetId: "k1", at: "2026-10-01T00:00:00Z" },
    { route: "hypothesis" as const, targetId, at: "2026-10-01T00:00:00Z" },
  ];

  it("is none with no link, or when its hypothesis is gone", () => {
    expect(linkedTest(undefined, [hyp("h1", "running")])).toEqual({ state: "none" });
    expect(linkedTest(link("gone"), [hyp("h1", "running")])).toEqual({ state: "none" });
    expect(linkedTest(link("h1"), undefined)).toEqual({ state: "none" });
  });

  it("is testing while drafted or running", () => {
    expect(linkedTest(link("h1"), [hyp("h1", "drafted")])).toEqual({
      state: "testing",
      hypothesisId: "h1",
      status: "drafted",
    });
    expect(linkedTest(link("h1"), [hyp("h1", "running")])).toMatchObject({ status: "running" });
  });

  it("is tested with the result once resolved", () => {
    for (const result of ["validated", "invalidated", "inconclusive"] as const) {
      expect(linkedTest(link("h1"), [hyp("h1", result)])).toEqual({
        state: "tested",
        hypothesisId: "h1",
        result,
      });
    }
  });

  it("finds the hypothesis link among the others", () => {
    expect(hypothesisLink(link("h1"))?.targetId).toBe("h1");
    expect(hypothesisLink([])).toBeUndefined();
  });
});

describe("withHypothesis", () => {
  it("puts a new hypothesis first and starts a tracker that doesn't exist", () => {
    expect(withHypothesis(null, hyp("a", "drafted"))).toEqual({
      id: HYPOTHESIS_TRACKER_ID,
      hypotheses: [hyp("a", "drafted")],
    });
    const doc = { id: HYPOTHESIS_TRACKER_ID, hypotheses: [hyp("a", "drafted")] };
    expect(withHypothesis(doc, hyp("b", "running")).hypotheses.map((h) => h.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("replaces a known id where it stands", () => {
    const doc = {
      id: HYPOTHESIS_TRACKER_ID,
      hypotheses: [hyp("a", "drafted"), hyp("b", "drafted")],
    };
    const next = withHypothesis(doc, hyp("b", "running"));
    expect(next.hypotheses.map((h) => [h.id, h.status])).toEqual([
      ["a", "drafted"],
      ["b", "running"],
    ]);
  });
});

describe("validateHypothesis", () => {
  it("saves a complete draft with trimmed text, and no result day while open", () => {
    const r = validateHypothesis(
      draft({ believe: "  Teams will pay  ", resolvedAt: TODAY }),
      TODAY
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual({
      believe: "Teams will pay",
      willDo: "Offer it on the pricing page",
      toLearn: "Whether it is worth building",
      successMetric: "8% of visitors click",
      experiment: undefined,
      description: undefined,
      outcome: undefined,
      status: "drafted",
      raisedAt: TODAY,
      resolvedAt: undefined,
      target: undefined,
      actual: undefined,
    });
  });

  it("needs every line on a new hypothesis", () => {
    const r = validateHypothesis(
      draft({ believe: " ", willDo: "", toLearn: "", successMetric: "" }),
      TODAY
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["believe", "successMetric", "toLearn", "willDo"]);
  });

  it("lets a hand-off draft stay without what we'll do while drafted, and asks once it runs", () => {
    const stored = hyp("h", "drafted", { willDo: "", successMetric: "", toLearn: "" });
    const base = hypothesisDraftFrom(stored);
    expect(validateHypothesis(base, TODAY, { stored }).ok).toBe(true);
    const running = validateHypothesis({ ...base, status: "running" }, TODAY, { stored });
    expect(running.ok).toBe(false);
    if (running.ok) return;
    expect(running.errors.willDo).toMatch(/before it runs/);
    expect(running.errors.successMetric).toMatch(/before it runs/);
    // What to learn may stay blank on a saved row that never had it.
    expect(running.errors.toLearn).toBeUndefined();
  });

  it("keeps a saved row's status as it is: an older running draft stays editable", () => {
    const stored = hyp("h", "running", { successMetric: "" });
    expect(validateHypothesis(hypothesisDraftFrom(stored), TODAY, { stored }).ok).toBe(true);
  });

  it("won't clear a line the saved row has", () => {
    const stored = hyp("h", "drafted");
    const r = validateHypothesis(
      { ...hypothesisDraftFrom(stored), willDo: "", toLearn: "" },
      TODAY,
      {
        stored,
      }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.willDo).toBeDefined();
    expect(r.errors.toLearn).toBeDefined();
  });

  it("caps text, but keeps a longer text saved before while it is unchanged", () => {
    const long = "q".repeat(HYPOTHESIS_TEXT_MAX + 1);
    const fresh = validateHypothesis(draft({ believe: long }), TODAY);
    expect(fresh.ok).toBe(false);
    if (!fresh.ok) expect(fresh.errors.believe).toMatch(/2000 characters/);

    const stored = hyp("h", "running", { believe: long });
    const kept = validateHypothesis(hypothesisDraftFrom(stored), TODAY, { stored });
    expect(kept.ok && kept.values.believe).toBe(long);
    const edited = validateHypothesis(
      { ...hypothesisDraftFrom(stored), believe: `${long}!` },
      TODAY,
      {
        stored,
      }
    );
    expect(edited.ok).toBe(false);
  });

  it("takes a backdated day, never a future one or one that doesn't exist", () => {
    expect(validateHypothesis(draft({ raisedAt: "2026-09-01" }), TODAY).ok).toBe(true);
    for (const [raisedAt, msg] of [
      ["", /Pick the day/],
      ["2026-02-30", /calendar/],
      ["2026-10-27T10:00", /calendar/],
      ["2026-10-28", /hasn't happened/],
    ] as const) {
      const r = validateHypothesis(draft({ raisedAt }), TODAY);
      expect(r.ok, raisedAt).toBe(false);
      if (!r.ok) expect(r.errors.raisedAt).toMatch(msg);
    }
  });

  it("needs a result's day once the status has a result, not before it was raised", () => {
    const base = draft({ status: "validated", raisedAt: "2026-10-10" });
    const none = validateHypothesis({ ...base, resolvedAt: "" }, TODAY);
    expect(!none.ok && none.errors.resolvedAt).toMatch(/Pick the day/);
    const early = validateHypothesis({ ...base, resolvedAt: "2026-10-09" }, TODAY);
    expect(!early.ok && early.errors.resolvedAt).toMatch(/before the day it was raised/);
    const future = validateHypothesis({ ...base, resolvedAt: "2026-10-28" }, TODAY);
    expect(!future.ok && future.errors.resolvedAt).toMatch(/hasn't happened/);
    const ok = validateHypothesis({ ...base, resolvedAt: "2026-10-10" }, TODAY);
    expect(ok.ok && ok.values.resolvedAt).toBe("2026-10-10");
  });

  it("reads a target from a direction and a number, with an optional unit and baseline", () => {
    const r = validateHypothesis(
      draft({
        direction: "increase",
        targetValue: "12",
        unit: " % ",
        baseline: "10",
        actual: "14",
      }),
      TODAY
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.target).toEqual({ direction: "increase", value: 12, unit: "%", baseline: 10 });
    expect(r.values.actual).toBe(14);
  });

  it("refuses a half-typed target, a baseline on the wrong side, and a result with no target", () => {
    const errorsOf = (over: Partial<HypothesisDraft>) => {
      const r = validateHypothesis(draft(over), TODAY);
      return r.ok ? {} : r.errors;
    };
    expect(errorsOf({ targetValue: "12" }).direction).toMatch(/rise or fall/);
    expect(errorsOf({ baseline: "3" }).direction).toMatch(/rise or fall/);
    expect(errorsOf({ direction: "increase" }).targetValue).toMatch(/counts as success/);
    expect(errorsOf({ direction: "increase", targetValue: "abc" }).targetValue).toBe(
      "Enter a number."
    );
    expect(errorsOf({ direction: "increase", targetValue: "5", baseline: "x" }).baseline).toBe(
      "Enter a number."
    );
    expect(
      errorsOf({ direction: "increase", targetValue: "10", baseline: "10" }).targetValue
    ).toMatch(/above the baseline \(10\)/);
    expect(
      errorsOf({ direction: "decrease", targetValue: "12", baseline: "10", unit: "%" }).targetValue
    ).toMatch(/below the baseline \(10%\)/);
    expect(errorsOf({ actual: "4" }).actual).toMatch(/Set a target first/);
    expect(errorsOf({ direction: "increase", targetValue: "5", actual: "x" }).actual).toBe(
      "Enter a number."
    );
    expect(
      errorsOf({ direction: "increase", targetValue: "5", unit: "u".repeat(41) }).unit
    ).toMatch(/40 characters/);
  });

  it("refuses a status the tracker doesn't know", () => {
    const r = validateHypothesis(draft({ status: "parked" as HypothesisStatus }), TODAY);
    expect(!r.ok && r.errors.status).toBe("Pick a status.");
  });
});

describe("the form round trip", () => {
  it("reads a saved row into the form, day stamps as their day", () => {
    const stored = hyp("h", "validated", {
      raisedAt: "2026-10-01T08:00:00.000Z",
      resolvedAt: "2026-10-05",
      outcome: "It held",
      target: { direction: "decrease", value: 5, baseline: 9 },
      actual: 4,
    });
    expect(hypothesisDraftFrom(stored)).toMatchObject({
      raisedAt: "2026-10-01",
      resolvedAt: "2026-10-05",
      direction: "decrease",
      targetValue: "5",
      baseline: "9",
      unit: "",
      actual: "4",
      outcome: "It held",
    });
  });

  it("applies values onto the saved row, keeping its id and source, dropping what was cleared", () => {
    const stored = hyp("h", "validated", {
      resolvedAt: "2026-10-05",
      sourceRef: { tool: "cynefin", id: "c1" },
      target: { direction: "increase", value: 3 },
      actual: 4,
      experiment: "old",
    });
    const d = {
      ...hypothesisDraftFrom(stored),
      status: "running" as const,
      direction: "" as const,
      targetValue: "",
      actual: "",
      experiment: "",
    };
    const r = validateHypothesis(d, TODAY, { stored });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next = applyHypothesisValues(stored, r.values);
    expect(next.id).toBe("h");
    expect(next.sourceRef).toEqual({ tool: "cynefin", id: "c1" });
    expect(next.status).toBe("running");
    for (const key of ["resolvedAt", "target", "actual", "experiment", "description", "outcome"]) {
      expect(next, key).not.toHaveProperty(key);
    }
  });

  it("tells a whole day from a timestamp or an impossible date", () => {
    expect(isDay("2026-10-27")).toBe(true);
    expect(isDay("2026-10-27T00:00")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay(undefined)).toBe(false);
  });
});
