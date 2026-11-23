// @vitest-environment node
/**
 * lib/product-metrics/model: readings one per day and capped, change and
 * trend in the metric's own direction, progress that reads "not measured"
 * rather than 0, the funnel's shares (only the first three stages nest),
 * the view rules with examples counted apart, and the form checks.
 */

import { describe, expect, it } from "vitest";
import type { MetricReading, ProductMetric } from "@/lib/stores/workspace-types";
import {
  EMPTY_METRIC_DRAFT,
  READINGS_MAX,
  emptyFunnelDraft,
  funnelView,
  heartView,
  isEbmExample,
  isMetricsExample,
  isStale,
  latestReading,
  metricChange,
  metricProgress,
  metricRuleErrors,
  metricRuleProblems,
  metricTrend,
  metricsVerdict,
  northStarView,
  northStarWrites,
  parseReadingsPaste,
  pointsText,
  sortedReadings,
  trendText,
  validateFunnelPeriod,
  validateMetric,
  validateReading,
  withReading,
} from "@/lib/product-metrics/model";
import { buildExample } from "@/app/(tools)/product-metrics/example";

const NOW = "2026-11-20T10:00:00.000Z";
const TODAY = "2026-11-20";

const r = (date: string, value: number, id = `r-${date}`): MetricReading => ({ id, date, value });
const metric = (over: Partial<ProductMetric> = {}): ProductMetric => ({
  id: "metric_a",
  name: "Weekly teams",
  direction: "increase",
  readings: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe("readings", () => {
  it("sorts oldest first, keeps one per day (the later one) and drops unreadable ones", () => {
    const m = metric({
      readings: [
        r("2026-11-10", 5, "b"),
        r("2026-11-01", 3, "a"),
        r("2026-11-10", 6, "c"),
        { id: "bad", date: "2026-02-30", value: 1 },
        { id: "nan", date: "2026-11-02", value: Number.NaN },
      ],
    });
    expect(sortedReadings(m).map((x) => x.id)).toEqual(["a", "c"]);
    expect(latestReading(m)?.value).toBe(6);
  });

  it("replaces a reading on the same day and keeps the newest 52", () => {
    const base = metric({ readings: [r("2026-11-01", 1)] });
    const once = withReading(base, r("2026-11-01", 2, "x"), NOW);
    expect(once.replaced).toBe(true);
    expect(once.metric.readings).toEqual([r("2026-11-01", 2, "x")]);
    let m = metric();
    for (let i = 0; i < READINGS_MAX + 3; i++) {
      const day = `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
      m = withReading(m, r(day, i), NOW).metric;
    }
    expect(m.readings).toHaveLength(READINGS_MAX);
    expect(m.readings[0].value).toBe(3);
  });

  it("reads the change in the metric's own direction", () => {
    const up = metric({ readings: [r("2026-11-01", 10), r("2026-11-08", 12)] });
    expect(metricChange(up)).toEqual({ delta: 2, better: true });
    expect(metricChange({ ...up, direction: "decrease" })).toEqual({ delta: 2, better: false });
    expect(
      metricChange(metric({ readings: [r("2026-11-01", 4), r("2026-11-08", 4)] }))?.better
    ).toBe(null);
    expect(metricChange(metric({ readings: [r("2026-11-01", 4)] }))).toBeNull();
  });

  it("is stale with no reading in 30 days", () => {
    expect(isStale(metric(), TODAY)).toBe(true);
    expect(isStale(metric({ readings: [r("2026-10-22", 1)] }), TODAY)).toBe(false);
    expect(isStale(metric({ readings: [r("2026-10-21", 1)] }), TODAY)).toBe(true);
  });
});

describe("metricProgress", () => {
  it("is null without a target or a reading: not measured, never 0", () => {
    expect(metricProgress(metric({ readings: [r("2026-11-01", 5)] }))).toBeNull();
    expect(metricProgress(metric({ target: 10 }))).toBeNull();
  });

  it("measures from the baseline, else the first reading", () => {
    const first = metric({ target: 80, readings: [r("2026-10-01", 42), r("2026-11-01", 58)] });
    expect(Math.round((metricProgress(first) as number) * 100)).toBe(42);
    const based = { ...first, baseline: 50 };
    expect(metricProgress(based)).toBeCloseTo(8 / 30);
    const down = metric({
      direction: "decrease",
      baseline: 10,
      target: 2,
      readings: [r("2026-11-01", 6)],
    });
    expect(metricProgress(down)).toBe(0.5);
  });

  it("reads a baseline already past the target as 1 on the right side, else 0", () => {
    const m = metric({ baseline: 90, target: 80, readings: [r("2026-11-01", 85)] });
    expect(metricProgress(m)).toBe(1);
    expect(metricProgress({ ...m, readings: [r("2026-11-01", 70)] })).toBe(0);
    const down = metric({
      direction: "decrease",
      baseline: 2,
      target: 5,
      readings: [r("2026-11-01", 4)],
    });
    expect(metricProgress(down)).toBe(1);
  });
});

describe("metricTrend", () => {
  it("waits for six readings", () => {
    const five = metric({ readings: [1, 2, 3, 4, 5].map((v, i) => r(`2026-11-0${i + 1}`, v)) });
    expect(metricTrend(five)).toMatchObject({ word: null, need: 1 });
    expect(trendText(metricTrend(five))).toBe("Add 1 more reading to see a trend.");
  });

  it("reads the example's North Star as rising, and the wrong way for a falling metric", () => {
    const ns = buildExample(TODAY, NOW).find((m) => m.role === "north-star") as ProductMetric;
    expect(metricTrend(ns)).toMatchObject({ word: "rising", better: true, n: 8 });
    expect(Math.round((metricProgress(ns) as number) * 100)).toBe(42);
    const bad = metricTrend({ ...ns, direction: "decrease" });
    expect(bad.better).toBe(false);
    expect(trendText(bad)).toBe("Rising over 8 readings, the wrong way.");
  });

  it("reads noise as flat", () => {
    const m = metric({ readings: [5, 7, 4, 6, 5, 7].map((v, i) => r(`2026-11-0${i + 1}`, v)) });
    expect(metricTrend(m).word).toBe("flat");
  });
});

describe("the funnel", () => {
  const example = () => buildExample(TODAY, NOW);

  it("reads the latest period, nests only the first three stages, and names the leakiest", () => {
    const f = funnelView(example());
    expect(f.date).toBe(TODAY);
    expect(f.nested).toBe(true);
    const by = Object.fromEntries(f.stages.map((s) => [s.stage, s]));
    const pct = (n: number | null, scale = 100) => Math.round((n ?? Number.NaN) * scale);
    expect(pct(by.activation.ofBefore)).toBe(35);
    expect(pct(by.retention.ofBefore)).toBe(50);
    expect(pct(by.referral.ofBefore)).toBe(17);
    expect(pct(by.revenue.ofBefore)).toBe(13);
    expect(pct(by.revenue.ofAcquired, 1000)).toBe(23);
    expect(f.leakiest).toBe("activation");
    expect(pointsText(by.activation.change)).toBe("up 1 point");
  });

  it("flags counts that don't nest and names no leakiest stage", () => {
    const rows = example().map((m) =>
      m.aarrr === "retention"
        ? { ...m, readings: m.readings.map((x) => ({ ...x, value: x.value * 3 })) }
        : m
    );
    const f = funnelView(rows);
    expect(f.nested).toBe(false);
    expect(f.leakiest).toBeNull();
  });

  it("aligns periods: the latest day with Acquisition and another stage", () => {
    const rows = example().map((m) =>
      m.aarrr && m.aarrr !== "acquisition" ? { ...m, readings: m.readings.slice(0, 2) } : m
    );
    const f = funnelView(rows);
    expect(f.date).not.toBe(TODAY);
    expect(f.stages.find((s) => s.stage === "activation")?.count).toBe(1290);
  });

  it("reads the team's own stages over the example's", () => {
    const own = metric({
      id: "metric_acq",
      aarrr: "acquisition",
      readings: [r("2026-11-01", 100)],
    });
    const f = funnelView([...example(), own]);
    expect(f.stages[0].metric?.id).toBe("metric_acq");
    expect(f.date).toBeNull();
  });
});

describe("the view rules", () => {
  const all = [
    metric({ id: "metric_ns", name: "NS", role: "north-star" }),
    ...[1, 2, 3, 4, 5].map((i) => metric({ id: `metric_i${i}`, name: `In ${i}`, role: "input" })),
    metric({ id: "metric_act", name: "Act", aarrr: "activation" }),
    metric({
      id: "metric_h",
      name: "Happy",
      heart: { category: "happiness", feature: "Action follow-up" },
    }),
  ];

  it("refuses a second North Star, a sixth input, a second stage metric and a repeated HEART goal", () => {
    expect(metricRuleErrors(metric({ id: "metric_x", role: "north-star" }), all).role).toMatch(
      /“NS” is the North Star/
    );
    expect(metricRuleErrors(metric({ id: "metric_x", role: "input" }), all).role).toMatch(
      /already has 5 inputs/
    );
    expect(metricRuleErrors(metric({ id: "metric_x", aarrr: "activation" }), all).aarrr).toMatch(
      /Activation stage/
    );
    expect(
      metricRuleErrors(
        metric({
          id: "metric_x",
          heart: { category: "happiness", feature: "  action FOLLOW-up " },
        }),
        all
      ).heart
    ).toMatch(/one per feature and category/);
    expect(
      metricRuleProblems(
        metric({ id: "metric_x", heart: { category: "adoption", feature: "Action follow-up" } }),
        all
      )
    ).toEqual([]);
  });

  it("lets a row keep its own role, and counts examples apart", () => {
    expect(metricRuleProblems(all[0], all)).toEqual([]);
    expect(metricRuleProblems(metric({ id: "example-pm-ns", role: "north-star" }), all)).toEqual(
      []
    );
    const withExample = [...all, metric({ id: "example-pm-ns", role: "north-star" })];
    expect(
      metricRuleProblems(metric({ id: "example-pm-x", role: "north-star" }), withExample)
    ).toHaveLength(1);
  });

  it("refuses a 61st metric but not an edit of the 60th", () => {
    const sixty = Array.from({ length: 60 }, (_, i) =>
      metric({ id: `metric_${i}`, name: `M${i}` })
    );
    expect(metricRuleErrors(metric({ id: "metric_new" }), sixty).cap).toMatch(/60 metrics/);
    expect(metricRuleErrors(sixty[0], sixty).cap).toBeUndefined();
  });

  it("moves the North Star with the old one cleared first", () => {
    const writes = northStarWrites(all, "metric_i1", NOW);
    expect(writes.map((w) => [w.id, w.role])).toEqual([
      ["metric_ns", undefined],
      ["metric_i1", "north-star"],
    ]);
    expect("role" in writes[0]).toBe(false);
    expect(northStarWrites(all, "metric_ns", NOW)).toEqual([]);
    expect(northStarWrites(all, "missing", NOW)).toEqual([]);
  });

  it("tells the two example prefixes apart", () => {
    expect(isMetricsExample("example-pm-ns")).toBe(true);
    expect(isMetricsExample("example-ebm-nps")).toBe(false);
    expect(isEbmExample("example-ebm-nps")).toBe(true);
    expect(isEbmExample("metric_a")).toBe(false);
  });
});

describe("the views", () => {
  it("groups HEART by feature, any case, and reads the team's North Star over the example's", () => {
    const rows = [
      ...buildExample(TODAY, NOW),
      metric({
        id: "metric_h",
        name: "Own",
        heart: { category: "engagement", feature: "action Follow-up" },
      }),
      metric({ id: "metric_ns", name: "Own NS", role: "north-star" }),
    ];
    const heart = heartView(rows);
    expect(heart).toHaveLength(1);
    expect(Object.keys(heart[0].rows).sort()).toEqual([
      "adoption",
      "engagement",
      "happiness",
      "task-success",
    ]);
    expect(northStarView(rows).northStar?.id).toBe("metric_ns");
    expect(northStarView(rows).inputs).toEqual([]);
  });

  it("says a verdict over the team's own rows", () => {
    expect(metricsVerdict(buildExample(TODAY, NOW), TODAY)).toMatch(/No metrics yet/);
    expect(
      metricsVerdict(
        [metric({ role: "north-star", baseline: 0, target: 10, readings: [r("2026-11-19", 5)] })],
        TODAY
      )
    ).toMatch(/50% of the way/);
  });
});

describe("the forms", () => {
  it("needs a name, caps the unit at 40 and puts the target beyond the baseline", () => {
    const bad = validateMetric({
      ...EMPTY_METRIC_DRAFT,
      unit: "x".repeat(41),
      baseline: "10",
      target: "5",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.name).toBeDefined();
      expect(bad.errors.unit).toMatch(/40/);
    }
    const order = validateMetric({ ...EMPTY_METRIC_DRAFT, name: "A", baseline: "10", target: "5" });
    expect(order.ok).toBe(false);
    if (!order.ok) expect(order.errors.target).toMatch(/above the baseline/);
    const down = validateMetric({
      ...EMPTY_METRIC_DRAFT,
      name: "A",
      direction: "decrease",
      baseline: "10",
      target: "5",
    });
    expect(down.ok).toBe(true);
    const heart = validateMetric({ ...EMPTY_METRIC_DRAFT, name: "A", heartCategory: "adoption" });
    expect(heart.ok).toBe(false);
  });

  it("refuses a reading after today or without a number", () => {
    expect(validateReading({ date: "2026-11-21", value: "3", note: "" }, TODAY).ok).toBe(false);
    expect(validateReading({ date: TODAY, value: "", note: "" }, TODAY).ok).toBe(false);
    expect(validateReading({ date: TODAY, value: "4.5", note: " ok " }, TODAY)).toEqual({
      ok: true,
      values: { date: TODAY, value: 4.5, note: "ok" },
    });
  });

  it("reads a paste and names its bad lines", () => {
    const { readings, problems } = parseReadingsPaste(
      "2026-11-01, 42\n\n2026-11-08\t1,200\nnot a line\n2026-11-30, 3\n2026-02-30, 1\n2026-11-01; 43",
      TODAY
    );
    expect(readings).toEqual([
      { date: "2026-11-01", value: 43 },
      { date: "2026-11-08", value: 1200 },
    ]);
    expect(problems.map((p) => p.line)).toEqual([4, 5, 6]);
    const many = Array.from(
      { length: 55 },
      (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")}, ${i}`
    ).join("\n");
    expect(parseReadingsPaste(many, TODAY).problems).toHaveLength(3);
  });

  it("needs Acquisition and another stage, each with a metric, for a funnel period", () => {
    const has = {
      acquisition: true,
      activation: true,
      retention: false,
      referral: true,
      revenue: true,
    };
    const only = validateFunnelPeriod(
      { ...emptyFunnelDraft(TODAY), acquisition: "100" },
      TODAY,
      has
    );
    expect(only.ok).toBe(false);
    const noMetric = validateFunnelPeriod(
      { ...emptyFunnelDraft(TODAY), acquisition: "100", retention: "20" },
      TODAY,
      has
    );
    expect(noMetric.ok).toBe(false);
    if (!noMetric.ok) expect(noMetric.errors.retention).toMatch(/no metric/);
    expect(
      validateFunnelPeriod(
        { ...emptyFunnelDraft(TODAY), acquisition: "100", activation: "1.5" },
        TODAY,
        has
      ).ok
    ).toBe(false);
    expect(
      validateFunnelPeriod(
        { ...emptyFunnelDraft(TODAY), acquisition: "100", activation: "30" },
        TODAY,
        has
      )
    ).toEqual({ ok: true, values: { date: TODAY, counts: { acquisition: 100, activation: 30 } } });
  });
});
