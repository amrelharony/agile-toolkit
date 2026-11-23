// @vitest-environment node
/**
 * Value checks (lib/hypotheses/value and value-steps): the shipped work a
 * check can follow, the "Check its value" form and its rules, how a check
 * is measured and read, "Use the A/B result", the summary, and the next
 * step for a due check.
 */

import { describe, expect, it } from "vitest";
import type {
  AbTest,
  EpicRoadmap,
  Hypothesis,
  Okr,
  ProductMetric,
  Story,
} from "@/lib/stores/workspace-types";
import { validateHypothesis, hypothesisDraftFrom } from "@/lib/hypotheses/model";
import {
  AB_RESULT_REASON,
  abResultUpdate,
  applyValueCheck,
  isDue,
  isValueCheck,
  measureDefaults,
  measuredByOf,
  measuredByText,
  readMeasure,
  readingOnOrAfter,
  readingOnOrBefore,
  shippedCandidates,
  shippedText,
  validateValueCheck,
  valueCheckDraft,
  valueCheckSteps,
  valueSummary,
  valueSummaryText,
  withMeasuredBy,
  type ShippedCandidate,
} from "@/lib/hypotheses/value";

const TODAY = "2026-11-20";
const AT = "2026-11-01T09:00:00.000Z";

const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  doneAt: "2026-11-10T12:00:00",
  ...over,
});
const roadmap = (epics: EpicRoadmap["epics"]): EpicRoadmap[] => [
  { id: "epicRoadmap:current", epics },
];
const epic = (id: string, over: Partial<EpicRoadmap["epics"][number]> = {}) => ({
  id,
  title: `Epic ${id}`,
  startQuarter: "2026-Q4",
  endQuarter: "2026-Q4",
  progress: 0,
  ...over,
});
const hyp = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
  id,
  believe: `Belief ${id}`,
  willDo: "Run it",
  toLearn: "Whether it works",
  successMetric: "Sign-ups",
  status: "running",
  raisedAt: "2026-10-01",
  ...over,
});
const metric = (over: Partial<ProductMetric> = {}): ProductMetric => ({
  id: "m1",
  name: "Weekly active teams",
  unit: "teams",
  direction: "increase",
  baseline: 40,
  target: 60,
  readings: [
    { id: "r1", date: "2026-10-01", value: 42 },
    { id: "r2", date: "2026-11-05", value: 45 },
    { id: "r3", date: "2026-11-25", value: 58 },
  ],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const okr = (over: Partial<Okr> = {}): Okr => ({
  id: "o1",
  objective: "Teams get going fast",
  quarter: "2026-Q4",
  keyResults: [
    {
      id: "kr1",
      title: "Days to the first sprint",
      target: 3,
      current: 5,
      baseline: 6,
      direction: "decrease",
      unit: "days",
      checkIns: [
        { id: "c1", date: "2026-11-01", value: 5.5 },
        { id: "c2", date: "2026-12-01", value: 2.5 },
      ],
    },
  ],
  ...over,
});
const sources = { metrics: [metric()], okrs: [okr()] };
const shipped = { kind: "story" as const, id: "s1", title: "Checklist", doneAt: "2026-11-01" };

describe("shipped work to check", () => {
  it("lists stories done in the last 90 days, the newest first, examples and checked ones left out", () => {
    const out = shippedCandidates(
      {
        stories: [
          story("old", { doneAt: "2026-08-01T12:00:00" }),
          story("new", { doneAt: "2026-11-15T12:00:00" }),
          story("mid"),
          story("open", { status: "review" }),
          story("example-s1"),
          story("checked"),
          story("future", { doneAt: "2026-11-25T12:00:00" }),
        ],
        roadmaps: [],
        hypotheses: [hyp("h", { shipped: { ...shipped, id: "checked" } })],
      },
      TODAY
    );
    expect(out).toEqual([
      { kind: "story", id: "new", title: "Story new", doneAt: "2026-11-15" },
      { kind: "story", id: "mid", title: "Story mid", doneAt: "2026-11-10" },
    ]);
  });

  it("reads a story's done day from its history when it has no stamp", () => {
    const [c] = shippedCandidates(
      {
        stories: [
          story("s", {
            doneAt: undefined,
            statusHistory: [{ status: "done", at: "2026-11-12T10:00:00" }],
          }),
        ],
        roadmaps: [],
        hypotheses: [],
      },
      TODAY
    );
    expect(c.doneAt).toBe("2026-11-12");
  });

  it("lists finished epics on their last story's day, or with no day", () => {
    const stories = [
      story("s1", { epicId: "e1", doneAt: "2026-11-02T12:00:00" }),
      story("s2", { epicId: "e1", doneAt: "2026-11-09T12:00:00" }),
      story("s3", { epicId: "e2", status: "in_progress" }),
    ];
    const out = shippedCandidates(
      {
        stories,
        roadmaps: roadmap([
          epic("e1"),
          epic("e2"),
          epic("e3", { progress: 100 }),
          epic("example-e4", { progress: 100 }),
        ]),
        hypotheses: [],
      },
      TODAY
    ).filter((c) => c.kind === "epic");
    expect(out).toEqual([
      { kind: "epic", id: "e1", title: "Epic e1", doneAt: "2026-11-09" },
      { kind: "epic", id: "e3", title: "Epic e3", doneAt: null },
    ]);
  });
});

describe("the Check its value form", () => {
  const candidate: ShippedCandidate = {
    kind: "story",
    id: "s1",
    title: "Checklist",
    doneAt: "2026-11-01",
  };

  it("pre-fills the lines in our words and passes the hypothesis check", () => {
    const d = valueCheckDraft(candidate, TODAY);
    expect(d.believe).toBe("shipping “Checklist” gave people the value we expected");
    expect(d).toMatchObject({ shippedOn: "2026-11-01", lookAfter: 30, measuredKind: "words" });
    const r = validateValueCheck({ ...d, note: "fewer tickets" }, TODAY, sources);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.checkOn).toBe("2026-12-01");
      expect(r.values.shipped).toEqual({
        kind: "story",
        id: "s1",
        title: "Checklist",
        doneAt: "2026-11-01",
      });
      expect(r.values.measuredBy).toEqual({ kind: "words", note: "fewer tickets" });
      expect(r.values.hypothesis.status).toBe("running");
      const h = applyValueCheck({ id: "h1" }, r.values);
      expect(isValueCheck(h)).toBe(true);
      expect(validateHypothesis(hypothesisDraftFrom(h), TODAY).ok).toBe(true);
    }
  });

  it("needs a target for a metric or a key result, and the measure to exist", () => {
    const d = valueCheckDraft(candidate, TODAY);
    const noTarget = validateValueCheck(
      { ...d, measuredKind: "metric", metricId: "m1" },
      TODAY,
      sources
    );
    expect(!noTarget.ok && noTarget.errors.direction).toMatch(/needs a target/);
    const gone = validateValueCheck(
      { ...d, measuredKind: "metric", metricId: "gone", direction: "increase", targetValue: "60" },
      TODAY,
      sources
    );
    expect(!gone.ok && gone.errors.metricId).toMatch(/gone/);
    const kr = validateValueCheck(
      {
        ...d,
        measuredKind: "key-result",
        keyResult: "o1/kr1",
        direction: "decrease",
        targetValue: "3",
        baseline: "6",
      },
      TODAY,
      sources
    );
    expect(kr.ok && kr.values.measuredBy).toEqual({
      kind: "key-result",
      okrId: "o1",
      keyResultId: "kr1",
    });
    const words = validateValueCheck(d, TODAY, sources);
    expect(!words.ok && words.errors.note).toMatch(/Say how you'll tell/);
  });

  it("keeps the check day after the ship day, and the ship day out of the future", () => {
    const d = valueCheckDraft(candidate, TODAY);
    const future = validateValueCheck({ ...d, note: "x", shippedOn: "2026-11-21" }, TODAY, sources);
    expect(!future.ok && future.errors.shippedOn).toMatch(/hasn't happened yet/);
    const odd = validateValueCheck({ ...d, note: "x", lookAfter: 0 }, TODAY, sources);
    expect(!odd.ok && odd.errors.lookAfter).toBe("Pick when to look.");
    for (const lookAfter of [7, 14, 30, 60, 90]) {
      const r = validateValueCheck({ ...d, note: "x", lookAfter }, TODAY, sources);
      expect(r.ok && r.values.checkOn > d.shippedOn).toBe(true);
    }
  });

  it("raises the check on today, whatever later day it allows", () => {
    // Over MCP the verb allows the server's tomorrow (the user's today):
    // the ship day may be that day, and the check is still raised today.
    const d = valueCheckDraft(candidate, TODAY);
    const r = validateValueCheck(
      { ...d, note: "x", shippedOn: "2026-11-21" },
      TODAY,
      sources,
      "2026-11-21"
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.hypothesis.raisedAt).toBe(TODAY);
      expect(r.values.shipped.doneAt).toBe("2026-11-21");
    }
    const page = validateValueCheck({ ...d, note: "x" }, TODAY, sources);
    expect(page.ok && page.values.hypothesis.raisedAt).toBe(TODAY);
  });

  it("fills a picked metric's direction, unit, baseline on or before the ship day, and a target past it", () => {
    expect(measureDefaults({ kind: "metric", metricId: "m1" }, sources, "2026-11-10")).toEqual({
      direction: "increase",
      unit: "teams",
      baseline: "45",
      targetValue: "60",
    });
    // Before any reading: the metric's own baseline.
    expect(
      measureDefaults({ kind: "metric", metricId: "m1" }, sources, "2026-09-01")?.baseline
    ).toBe("40");
    // A target the baseline already passed is left for the person.
    const met = { metrics: [metric({ target: 44 })], okrs: [] };
    expect(
      measureDefaults({ kind: "metric", metricId: "m1" }, met, "2026-11-10")?.targetValue
    ).toBe("");
    expect(
      measureDefaults(
        { kind: "key-result", okrId: "o1", keyResultId: "kr1" },
        sources,
        "2026-11-10"
      )
    ).toEqual({
      direction: "decrease",
      unit: "days",
      baseline: "5.5",
      targetValue: "3",
    });
    expect(measureDefaults({ kind: "metric", metricId: "gone" }, sources, TODAY)).toBeNull();
  });

  it("names a measure, or says it is gone", () => {
    expect(measuredByText({ kind: "metric", metricId: "m1" }, sources)).toBe(
      "Weekly active teams (a product metric)"
    );
    expect(measuredByText({ kind: "key-result", okrId: "o1", keyResultId: "x" }, sources)).toBe(
      "key result removed"
    );
    expect(measuredByText({ kind: "words", note: "tickets" }, sources)).toBe("tickets");
    expect(
      measuredByOf(
        { measuredKind: "key-result", metricId: "", keyResult: "bad", note: "" },
        sources
      )
    ).toMatchObject({
      ok: false,
      field: "keyResult",
    });
    const h = withMeasuredBy(hyp("h"), { kind: "words", note: "x" });
    expect(h.measuredBy).toEqual({ kind: "words", note: "x" });
    expect(withMeasuredBy(h, null)).not.toHaveProperty("measuredBy");
    expect(shippedText({ shipped, checkOn: "2026-12-01" })).toBe(
      "Shipped “Checklist” on 2026-11-01 · check on 2026-12-01"
    );
  });
});

describe("reading a check", () => {
  it("takes the first reading on or after a day, and the last on or before", () => {
    const entries = [
      { date: "2026-11-05", value: 2 },
      { date: "2026-11-01", value: 1 },
      { date: "bad", value: 9 },
      { date: "2026-11-09", value: Number.NaN },
      { date: "2026-11-20", value: 3 },
    ];
    expect(readingOnOrAfter(entries, "2026-11-02")).toEqual({ date: "2026-11-05", value: 2 });
    expect(readingOnOrAfter(entries, "2026-11-21")).toBeNull();
    expect(readingOnOrBefore(entries, "2026-11-19")).toEqual({ date: "2026-11-05", value: 2 });
    expect(readingOnOrBefore(entries, "2026-10-01")).toBeNull();
  });

  it("is due once open on or after its day with nothing measured", () => {
    const check = hyp("h", {
      shipped,
      checkOn: "2026-11-20",
      target: { direction: "increase", value: 5 },
    });
    expect(isDue(check, TODAY)).toBe(true);
    expect(isDue(check, "2026-11-19")).toBe(false);
    expect(isDue({ ...check, actual: 4 }, TODAY)).toBe(false);
    expect(isDue({ ...check, status: "validated" }, TODAY)).toBe(false);
    expect(isDue(hyp("plain", { checkOn: "2026-11-01" }), TODAY)).toBe(false);
  });

  it("reads the metric on or after the check day, only with a target", () => {
    const check = hyp("h", {
      shipped,
      checkOn: "2026-11-20",
      measuredBy: { kind: "metric", metricId: "m1" },
      target: { direction: "increase", value: 55, unit: "teams" },
    });
    expect(readMeasure(check, sources)).toMatchObject({
      state: "ready",
      reading: { date: "2026-11-25", value: 58 },
    });
    expect(readMeasure({ ...check, checkOn: "2026-11-26" }, sources).state).toBe("no_reading");
    expect(readMeasure({ ...check, target: undefined }, sources).state).toBe("no_target");
    expect(
      readMeasure({ ...check, measuredBy: { kind: "metric", metricId: "gone" } }, sources).state
    ).toBe("missing");
    expect(readMeasure({ ...check, measuredBy: { kind: "words", note: "x" } }, sources).state).toBe(
      "none"
    );
    expect(readMeasure({ ...check, shipped: undefined }, sources).state).toBe("none");
  });
});

describe("Use the A/B result", () => {
  const test = (over: Partial<AbTest> = {}): AbTest => ({
    id: "t1",
    name: "Shorter form",
    hypothesisId: "h1",
    plan: {
      baseline: 0.1,
      mde: 0.2,
      mdeMode: "relative",
      confidence: 0.95,
      power: 0.8,
      sided: "two",
    },
    variants: [
      { id: "a", name: "A", visitors: 4020, conversions: 402 },
      { id: "b", name: "B", visitors: 3980, conversions: 477 },
    ],
    status: "done",
    createdAt: AT,
    updatedAt: AT,
    ...over,
  });
  const pct = hyp("h1", {
    target: { direction: "increase", value: 11.5, unit: "%", baseline: 10 },
  });

  it("adds the sentence and sets B's rate when the plan is met, it is significant and the target is in %", () => {
    const r = abResultUpdate(pct, test());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sentence).toBe(
      "A/B test “Shorter form”: B converted better than A by 2.0 points (95% interval +0.6 to +3.4 points; p = 0.0045), significant at 95% confidence."
    );
    expect(r.actualSet).toBe(true);
    expect(r.next.actual).toBe(11.98);
    expect(r.next.outcome).toBe(r.sentence);
    expect(r.next.status).toBe("running");
    expect(r.suggestedVerdict?.verdict).toBe("validated");
    // Once only.
    expect(abResultUpdate(r.next, test())).toEqual({ ok: false, reason: "already_used" });
  });

  it("adds the sentence only below the plan, when not significant, or for another unit", () => {
    const early = test({
      variants: [
        { id: "a", name: "A", visitors: 3000, conversions: 300 },
        { id: "b", name: "B", visitors: 3000, conversions: 360 },
      ],
    });
    const notSig = test({
      variants: [
        { id: "a", name: "A", visitors: 4000, conversions: 400 },
        { id: "b", name: "B", visitors: 4000, conversions: 410 },
      ],
    });
    for (const [h, t] of [
      [pct, early],
      [pct, notSig],
      [hyp("h1", { target: { direction: "increase", value: 5, unit: "points" } }), test()],
    ] as const) {
      const r = abResultUpdate(h, t);
      expect(r.ok && r.actualSet).toBe(false);
      expect(r.ok && r.next.actual).toBeUndefined();
    }
    const kept = abResultUpdate({ ...pct, outcome: "Earlier notes." }, test());
    expect(kept.ok && kept.next.outcome?.startsWith("Earlier notes.\nA/B test")).toBe(true);
  });

  it("says it is too early below the planned sample, even when the peek reads significant", () => {
    const peek = test({
      variants: [
        { id: "a", name: "A", visitors: 600, conversions: 48 },
        { id: "b", name: "B", visitors: 600, conversions: 84 },
      ],
    });
    const r = abResultUpdate(pct, peek);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sentence).toMatch(
      /^A\/B test “Shorter form”: Too early to call: 600 of 3,841 per variant\. So far: B converted better than A by 6\.0 points .*, significant at 95% confidence\.$/
    );
    expect(r.next.outcome).toBe(r.sentence);
    expect(r.actualSet).toBe(false);
    expect(r.next.actual).toBeUndefined();
    expect(r.suggestedVerdict).toBeNull();
    // With the sample in, the full result can still go in on its own line.
    const later = abResultUpdate(r.next, test());
    expect(later.ok && later.next.outcome?.split("\n")).toEqual([
      r.sentence,
      "A/B test “Shorter form”: B converted better than A by 2.0 points (95% interval +0.6 to +3.4 points; p = 0.0045), significant at 95% confidence.",
    ]);
  });

  it("refuses without counts, or with no room in what we learned", () => {
    const empty = test({
      variants: [
        { id: "a", name: "A", visitors: 0, conversions: 0 },
        { id: "b", name: "B", visitors: 0, conversions: 0 },
      ],
    });
    expect(abResultUpdate(pct, empty)).toEqual({ ok: false, reason: "no_result" });
    expect(abResultUpdate({ ...pct, outcome: "x".repeat(1950) }, test())).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(AB_RESULT_REASON.no_test).toBe("No A/B test is linked to it.");
  });
});

describe("the summary", () => {
  it("counts value checks only, decisive ones in the rate", () => {
    const rows = [
      hyp("a", { shipped, status: "validated", resolvedAt: "2026-11-19" }),
      hyp("b", { shipped, status: "validated", resolvedAt: "2026-11-19" }),
      hyp("c", { shipped, status: "invalidated", resolvedAt: "2026-11-19" }),
      hyp("d", { shipped, checkOn: "2026-11-01" }),
      hyp("plain", { status: "validated", resolvedAt: "2026-11-19" }),
      hyp("example-e", { shipped, status: "invalidated", resolvedAt: "2026-11-19" }),
    ];
    const s = valueSummary(rows, TODAY);
    expect(s).toMatchObject({
      total: 4,
      validated: 2,
      invalidated: 1,
      open: 1,
      due: 1,
      decisive: 3,
    });
    expect(valueSummaryText(s)).toBe("Value validated: 2 of 3 decisive (67%)");
    expect(valueSummary(rows, TODAY, { includeExamples: true }).total).toBe(5);
    expect(valueSummaryText(valueSummary([hyp("d", { shipped })], TODAY))).toBe(
      "Value validated: no check has a decisive result yet (1 open)"
    );
  });

  it("names only the parts there are while nothing is decisive", () => {
    const inconclusive = hyp("i", { shipped, status: "inconclusive", resolvedAt: "2026-11-19" });
    expect(valueSummaryText(valueSummary([inconclusive], TODAY))).toBe(
      "Value validated: no check has a decisive result yet (1 inconclusive)"
    );
    expect(valueSummaryText(valueSummary([inconclusive, hyp("d", { shipped })], TODAY))).toBe(
      "Value validated: no check has a decisive result yet (1 open, 1 inconclusive)"
    );
  });
});

describe("the next step for a due check", () => {
  it("reads the metric when a reading is in", () => {
    const steps = valueCheckSteps(
      [
        hyp("h1", {
          shipped,
          checkOn: "2026-11-20",
          measuredBy: { kind: "metric", metricId: "m1" },
          target: { direction: "increase", value: 55, unit: "teams" },
        }),
      ],
      { metrics: [metric({ readings: [{ id: "r", date: "2026-11-20", value: 57 }] })], okrs: [] },
      TODAY
    );
    expect(steps).toEqual([
      {
        id: "hypothesis-tracker-value-check",
        label: "Read the metric for “Checklist”",
        detail:
          "Its check was due on 2026-11-20, and Weekly active teams read 57 teams on 2026-11-20. “Read the metric” on its card records it as the result.",
        href: "/hypothesis-tracker",
      },
    ]);
  });

  it("asks for the result otherwise, the longest waiting first, once", () => {
    const steps = valueCheckSteps(
      [
        hyp("h2", { shipped: { ...shipped, title: "Later" }, checkOn: "2026-11-15" }),
        hyp("h1", { shipped, checkOn: "2026-11-10", measuredBy: { kind: "words", note: "x" } }),
        hyp("h3", { shipped, checkOn: "2026-11-30" }),
      ],
      sources,
      TODAY
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      label: "Check the value of “Checklist”",
      detail:
        "Its check was due on 2026-11-10. Set its status from what you saw. 1 other value check is due too.",
    });
    expect(
      valueCheckSteps([hyp("h3", { shipped, checkOn: "2026-11-30" })], sources, TODAY)
    ).toEqual([]);
  });
});
