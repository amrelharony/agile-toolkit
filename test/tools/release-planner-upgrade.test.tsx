import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  CEREMONY_CADENCE_ID,
  type Sprint,
  type Story,
  type StoryMap,
} from "@/lib/stores/workspace-types";
import { velocity } from "@/lib/sprints/metrics";

/**
 * Release Planner, Phase 2 of the tool upgrade:
 *   - scope from the backlog, a story-map slice (?slice=) or typed, with
 *     unestimated items counted and named;
 *   - sprint length from the team's cadence;
 *   - completed sprints with 0 points count, the headline is the shared
 *     velocity, and no forecast below the minimum sample;
 *   - "probability of finishing by <date>" and "scope by <date>";
 *   - one expected scope change (old buffer × adjustment combined);
 *   - example data instead of fake defaults, Reset with confirm and Undo,
 *     validated inputs, a verdict and a Markdown export.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { ReleasePlannerClient } from "@/app/(tools)/release-planner/release-planner-client";
import {
  EMPTY_CONFIG,
  combineScopeChange,
  migrateLegacyConfig,
  normalizeConfig,
  useReleasePlannerStore,
} from "@/app/(tools)/release-planner/store";
import {
  backlogScope,
  effectiveScope,
  readSliceParam,
  resolveScope,
  resolveScopeSource,
  storyMapSlices,
} from "@/app/(tools)/release-planner/scope-source";
import {
  LEGACY_STARTER_VELOCITIES,
  headlineVelocity,
  parseVelocities,
  sprintEndingBefore,
  sprintSample,
  validateVelocities,
} from "@/app/(tools)/release-planner/velocity-source";
import {
  MAX_SPRINTS,
  addDaysIso,
  chanceWithin,
  deliverableIn,
  finishDate,
  formatDay,
  simulateRelease,
  sprintsUntil,
} from "@/lib/sprints/release-forecast";
import {
  planRelease,
  resolveTargetDate,
  signedPct,
  type ReleasePlanInput,
} from "@/app/(tools)/release-planner/plan";
import { releaseVerdict } from "@/app/(tools)/release-planner/verdict";
import { toMarkdown } from "@/app/(tools)/release-planner/markdown";
import { releaseNextStep } from "@/app/(tools)/release-planner/next-step";
import {
  buildExample,
  clearedExample,
  withExample,
  EXAMPLE_ID,
} from "@/app/(tools)/release-planner/example";
import {
  isPartialNumber,
  validateScopeChange,
  validateScopePoints,
  validateSprintLength,
} from "@/app/(tools)/release-planner/validate";
import { releasePrompts } from "@/app/(tools)/release-planner/prompts";
import { estimatePoints } from "@/lib/story-map/points";
import { bootstrapCrossCheck, recentShift } from "@/app/(tools)/release-planner/advanced";
import { simulationHistogramText } from "@/app/(tools)/release-planner/chart-text";

/* ── Fixtures ────────────────────────────────────────────────────────── */

const sprint = (
  n: number,
  points: number | undefined,
  status: Sprint["status"] = "completed"
): Sprint => {
  const start = addDaysIso("2026-01-05", (n - 1) * 14);
  return {
    id: `s${n}`,
    name: `Sprint ${n}`,
    startDate: start,
    endDate: addDaysIso(start, 14),
    pointsPlanned: 20,
    pointsCompleted: points,
    status,
  };
};
const story = (id: string, points: number | undefined, extra: Partial<Story> = {}): Story => ({
  id,
  title: id,
  points,
  status: "backlog",
  ...extra,
});
const MAP: StoryMap = {
  id: "story-mapper:current",
  steps: [
    { id: "a", name: "Find" },
    { id: "b", name: "Buy" },
  ],
  slices: [
    {
      id: "mvp",
      name: "MVP",
      cards: {
        a: [{ id: "c1", title: "Search", description: "", color: "", estimate: "5" }],
        b: [
          { id: "c2", title: "Pay", description: "", color: "", estimate: "8" },
          { id: "c3", title: "Receipt", description: "", color: "", estimate: "XL" },
        ],
        gone: [{ id: "c9", title: "Orphan", description: "", color: "", estimate: "40" }],
      },
    },
    { id: "r2", name: "  ", cards: { a: [], b: [] } },
  ],
};

/** A plan's input with a typed scope and typed velocities. */
function input(over: Partial<ReleasePlanInput> = {}): ReleasePlanInput {
  const points = over.sample?.points ?? [10, 10, 10, 10];
  return {
    scope: { source: "typed", points: 50, items: 0, unestimated: 0 },
    scopeChangePct: null,
    velocitySource: "manual",
    sample: { points, labels: points.map((_, i) => `Sprint ${i + 1}`) },
    headline: velocity([]),
    lengthDays: 14,
    lengthFrom: "cadence",
    start: { date: "2027-01-04", from: "user" },
    targetDate: "",
    targetFrom: null,
    ...over,
  };
}

/* ── Scope ───────────────────────────────────────────────────────────── */

describe("scope sources", () => {
  it("counts open stories outside closed sprints, and the unestimated ones", () => {
    const sprints = [
      sprint(1, 20),
      sprint(2, undefined, "cancelled"),
      sprint(3, undefined, "active"),
      sprint(4, undefined, "planned"),
    ];
    const scope = backlogScope(
      [
        story("b1", 5),
        story("b2", undefined),
        story("b3", 3, { status: "done" }),
        story("in-done-sprint", 8, { sprintId: "s1", status: "todo" }),
        story("in-cancelled", 8, { sprintId: "s2", status: "todo" }),
        story("in-active", 2, { sprintId: "s3", status: "in_progress" }),
        story("in-planned", 1.5, { sprintId: "s4", status: "todo" }),
        story("lost-sprint", 1, { sprintId: "nope", status: "todo" }),
        story("example-x", 13),
        story("zero", 0),
      ],
      sprints
    );
    expect(scope).toEqual({
      points: 9.5,
      stories: 6,
      unestimated: 1,
      inOpenSprints: 2,
      skipped: 0,
    });
    expect(backlogScope([], [])).toEqual({
      points: 0,
      stories: 0,
      unestimated: 0,
      inOpenSprints: 0,
      skipped: 0,
    });
  });

  it("reads card estimates on the Story Mapper's rule, and anything else as unestimated", () => {
    // One reading (lib/story-map/points), so "Plan this release" opens on
    // the total the Story Mapper's slice header shows.
    expect(["5", "3.5", "0", " 21 ", "0,5", "½", "8 pts"].map(estimatePoints)).toEqual([
      5, 3.5, 0, 21, 0.5, 0.5, 8,
    ]);
    const custom = ["?", "XL", "", "  ", "☕", "-3", "1/2", ".5", "1e1", "0x10", "Infinity"];
    expect([...custom, undefined].map(estimatePoints)).toEqual(Array(12).fill(undefined));
  });

  it("leaves out the running sprint's stories when the forecast starts after it", () => {
    const sprints = [
      sprint(1, 20),
      sprint(3, undefined, "active"),
      sprint(4, undefined, "planned"),
    ];
    const stories = [
      story("b1", 5),
      story("in-active", 2, { sprintId: "s3", status: "in_progress" }),
      story("in-active-2", undefined, { sprintId: "s3", status: "todo" }),
      story("in-planned", 1.5, { sprintId: "s4", status: "todo" }),
    ];
    expect(backlogScope(stories, sprints, "s3")).toEqual({
      points: 6.5,
      stories: 2,
      unestimated: 0,
      inOpenSprints: 1,
      skipped: 2,
    });
    // Starting during the sprint keeps its stories in the scope.
    expect(backlogScope(stories, sprints)).toMatchObject({ points: 8.5, stories: 4, skipped: 0 });
  });

  it("totals each slice over the map's steps only", () => {
    expect(storyMapSlices(MAP)).toEqual([
      { id: "mvp", name: "MVP", points: 13, cards: 3, unestimated: 1 },
      { id: "r2", name: "Untitled slice", points: 0, cards: 0, unestimated: 0 },
    ]);
    expect(storyMapSlices(undefined)).toEqual([]);
  });

  it("picks a source: the user's, an old typed number, the backlog, else typing", () => {
    const none = { stories: 0 };
    const some = { stories: 3 };
    expect(resolveScopeSource({ scopeSource: "slice", backlogSize: 80 }, some)).toBe("slice");
    expect(resolveScopeSource({ backlogSize: 80 }, some)).toBe("typed");
    expect(resolveScopeSource({ backlogSize: null }, some)).toBe("backlog");
    expect(resolveScopeSource({ backlogSize: null }, none)).toBe("typed");
  });

  it("resolves the scope of each source, flagging a slice that's gone", () => {
    const backlog = { points: 40, stories: 5, unestimated: 2, inOpenSprints: 0, skipped: 0 };
    const slices = storyMapSlices(MAP);
    expect(resolveScope("backlog", { backlogSize: null }, backlog, slices)).toMatchObject({
      points: 40,
      items: 5,
      unestimated: 2,
    });
    expect(
      resolveScope("slice", { backlogSize: null, sliceId: "mvp" }, backlog, slices)
    ).toMatchObject({ points: 13, items: 3, unestimated: 1, slice: { name: "MVP" } });
    expect(
      resolveScope("slice", { backlogSize: null, sliceId: "deleted" }, backlog, slices)
    ).toMatchObject({ points: null, sliceMissing: true });
    expect(resolveScope("slice", { backlogSize: null }, backlog, slices)).toMatchObject({
      points: null,
      sliceMissing: false,
    });
    // An empty slice has nothing to forecast.
    expect(
      resolveScope("slice", { backlogSize: null, sliceId: "r2" }, backlog, slices).points
    ).toBeNull();
    expect(resolveScope("typed", { backlogSize: null }, backlog, slices).points).toBeNull();
    expect(resolveScope("typed", { backlogSize: 75 }, backlog, slices).points).toBe(75);
  });

  it("applies the expected change, and has no scope at 0 or below", () => {
    expect(effectiveScope(100, null)).toBe(100);
    expect(effectiveScope(100, 32)).toBe(132);
    expect(effectiveScope(100, -50)).toBe(50);
    expect(effectiveScope(1, -90)).toBe(1);
    expect(effectiveScope(100_000, 300)).toBe(400_000);
    expect(effectiveScope(0, 10)).toBeNull();
    expect(effectiveScope(null, 10)).toBeNull();
    expect(effectiveScope(-5, 10)).toBeNull();
  });

  it("reads ?slice= from the address", () => {
    expect(readSliceParam("?slice=mvp")).toBe("mvp");
    expect(readSliceParam("?sprint=s1")).toBeNull();
    expect(readSliceParam(`?slice=${"x".repeat(200)}`)).toBeNull();
  });
});

/* ── Velocity ─────────────────────────────────────────────────────────── */

describe("velocities", () => {
  it("keeps 0-point sprints in the sample, oldest first by end date", () => {
    const sample = sprintSample([sprint(3, 18), sprint(1, 0), sprint(2, 22), sprint(4, undefined)]);
    expect(sample.points).toEqual([0, 22, 18]);
    expect(sample.sprintIds).toEqual(["s1", "s2", "s3"]);
  });

  it("uses the shared velocity (latest three) for the headline", () => {
    const sprints = [sprint(1, 30), sprint(2, 0), sprint(3, 12), sprint(4, 18)];
    expect(headlineVelocity("sprints", sprints, [])).toMatchObject({ average: 10, count: 3 });
    // Typed numbers are oldest first: the last three.
    expect(headlineVelocity("manual", sprints, [40, 10, 20, 30])).toMatchObject({
      average: 20,
      count: 3,
    });
    expect(headlineVelocity("manual", [], []).average).toBeNull();
  });

  it("validates a typed list instead of dropping what doesn't parse", () => {
    expect(validateVelocities("18, 22 0\n19;7.5")).toEqual({
      ok: true,
      values: [18, 22, 0, 19, 7.5],
    });
    expect(validateVelocities("")).toEqual({ ok: true, values: [] });
    const bad = validateVelocities("18, abc, -3");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.velocities).toMatch(/^“abc”, “-3” aren't a number of points/);
    expect(parseVelocities("18, abc, 0, -3")).toEqual([18, 0]);
  });
});

/* ── Old saved state ─────────────────────────────────────────────────── */

describe("saved config", () => {
  const legacy = {
    backlogSize: 100,
    velocityInput: "10, 12, 9",
    scopeBuffer: 10,
    sprintLengthDays: 14,
    startDate: "2027-01-04",
    scopeAdjustment: 20,
    sprintsToReleaseTarget: "6",
    velocitySource: "manual",
  };

  it("combines the old buffer and adjustment into one change", () => {
    expect(combineScopeChange(10, 20)).toBe(32);
    expect(combineScopeChange(10, -50)).toBe(-45);
    expect(combineScopeChange(undefined, undefined)).toBe(0);
    expect(combineScopeChange(0, 0)).toBe(0);
  });

  it("reads a version-0 config into the new shape", () => {
    expect(migrateLegacyConfig(legacy)).toEqual({
      backlogSize: 100,
      scopeChangePct: 32,
      velocitySource: "manual",
      velocityInput: "10, 12, 9",
      // 14 was the fixed default: the cadence decides now.
      sprintLengthDays: null,
      startDate: "2027-01-04",
      targetDate: "",
      sprintsToReleaseTarget: "6",
    });
    expect(migrateLegacyConfig({ ...legacy, sprintLengthDays: 10 }).sprintLengthDays).toBe(10);
    // Migrating twice changes nothing.
    const once = migrateLegacyConfig(legacy);
    expect(normalizeConfig(once)).toEqual(once);
  });

  it("treats the untouched starter values as never filled in", () => {
    expect(
      migrateLegacyConfig({
        backlogSize: 120,
        velocityInput: LEGACY_STARTER_VELOCITIES,
        scopeBuffer: 10,
        sprintLengthDays: 14,
        startDate: "",
        scopeAdjustment: 0,
        sprintsToReleaseTarget: "",
      })
    ).toEqual(EMPTY_CONFIG);
    // A real backlog with the starter velocities keeps the backlog and the buffer.
    expect(
      migrateLegacyConfig({
        backlogSize: 300,
        velocityInput: LEGACY_STARTER_VELOCITIES,
        scopeBuffer: 10,
      })
    ).toMatchObject({ backlogSize: 300, velocityInput: "", scopeChangePct: 10 });
  });

  it("keeps a 120 backlog's buffer once anything else was set", () => {
    // The old box kept the starter numbers when velocities came from
    // sprints, so 120 + the starter list alone doesn't mean "never used".
    expect(
      migrateLegacyConfig({
        backlogSize: 120,
        velocityInput: LEGACY_STARTER_VELOCITIES,
        scopeBuffer: 25,
        scopeAdjustment: 10,
        sprintLengthDays: 10,
        startDate: "2027-01-04",
        sprintsToReleaseTarget: "5",
        velocitySource: "sprints",
      })
    ).toEqual({
      backlogSize: 120,
      scopeChangePct: 37.5,
      velocitySource: "sprints",
      velocityInput: "",
      sprintLengthDays: 10,
      startDate: "2027-01-04",
      targetDate: "",
      sprintsToReleaseTarget: "5",
    });
    // Any one changed field is enough to keep the backlog and the change.
    const starter = {
      backlogSize: 120,
      velocityInput: LEGACY_STARTER_VELOCITIES,
      scopeBuffer: 10,
      scopeAdjustment: 0,
      sprintLengthDays: 14,
      startDate: "",
      sprintsToReleaseTarget: "",
    };
    expect(migrateLegacyConfig({ ...starter, scopeBuffer: 20 })).toMatchObject({
      backlogSize: 120,
      scopeChangePct: 20,
    });
    expect(migrateLegacyConfig({ ...starter, sprintsToReleaseTarget: "6" })).toMatchObject({
      backlogSize: 120,
      scopeChangePct: 10,
    });
    // Only the velocity source picked: still the starter scope.
    expect(migrateLegacyConfig({ ...starter, velocitySource: "sprints" })).toEqual({
      ...EMPTY_CONFIG,
      velocitySource: "sprints",
    });
    // An older save without the later fields reads as untouched too.
    expect(
      migrateLegacyConfig({ backlogSize: 120, velocityInput: LEGACY_STARTER_VELOCITIES })
    ).toEqual(EMPTY_CONFIG);
  });

  it("survives junk", () => {
    expect(normalizeConfig(null)).toEqual(EMPTY_CONFIG);
    expect(
      normalizeConfig({
        backlogSize: -4,
        scopeChangePct: "x",
        velocityInput: 7,
        sprintLengthDays: 2.5,
        startDate: "soon",
        scopeSource: "nope",
        velocitySource: "maybe",
        example: "not-an-example",
      })
    ).toEqual(EMPTY_CONFIG);
  });

  it("migrates a version-0 blob through the store", async () => {
    localStorage.setItem(
      "agile-toolkit:release-planner",
      JSON.stringify({ state: { config: legacy }, version: 0 })
    );
    await useReleasePlannerStore.persist.rehydrate();
    expect(useReleasePlannerStore.getState().config).toMatchObject({
      backlogSize: 100,
      scopeChangePct: 32,
    });
    const saved = JSON.parse(localStorage.getItem("agile-toolkit:release-planner") ?? "{}");
    expect(saved.version).toBe(1);
    expect(saved.state.config.scopeBuffer).toBeUndefined();
    localStorage.removeItem("agile-toolkit:release-planner");
    useReleasePlannerStore.setState({ config: EMPTY_CONFIG });
  });
});

/* ── Forecast maths ──────────────────────────────────────────────────── */

describe("simulation", () => {
  it("counts a 0-point sprint as a sprint", () => {
    const steady = simulateRelease(50, [10, 10]);
    const withZero = simulateRelease(50, [10, 0]);
    expect(steady).toMatchObject({ p50: 5, p85: 5, p95: 5, unfinished: 0 });
    // Half the draws deliver nothing: about twice as long.
    expect(withZero!.p50).toBeGreaterThanOrEqual(9);
    expect(withZero!.p85).toBeGreaterThan(withZero!.p50!);
  });

  it("gives the same numbers for the same inputs", () => {
    const a = simulateRelease(120, [18, 0, 25, 21, 17]);
    const b = simulateRelease(120, [18, 0, 25, 21, 17]);
    expect([a!.p50, a!.p85, a!.p95]).toEqual([b!.p50, b!.p85, b!.p95]);
    expect(a!.histogram.reduce((s, h) => s + h.count, 0)).toBe(10_000);
  });

  it("has nothing to say without a scope or a sample", () => {
    expect(simulateRelease(0, [10])).toBeNull();
    expect(simulateRelease(50, [])).toBeNull();
    expect(simulateRelease(50, [Number.NaN, -3])).toBeNull();
  });

  it("never finishes when every sprint delivered 0, or past the cap", () => {
    const zero = simulateRelease(50, [0, 0, 0], { iterations: 100 });
    expect(zero).toMatchObject({ p50: null, unfinished: 100, histogram: [] });
    const far = simulateRelease(1_000_000, [1, 2], { iterations: 50 });
    expect(far).toMatchObject({ p50: null, unfinished: 50 });
  });

  it("answers the chance of finishing within N sprints", () => {
    const f = simulateRelease(50, [10, 10])!;
    expect(chanceWithin(f, 4)).toBe(0);
    expect(chanceWithin(f, 5)).toBe(1);
    expect(chanceWithin(f, 0)).toBe(0);
    const mixed = simulateRelease(40, [5, 15])!;
    // Done within 4 when at least two of four draws are 15s: 11/16.
    expect(chanceWithin(mixed, 4)).toBeCloseTo(11 / 16, 1);
  });

  it("answers the scope delivered in N sprints at P50 and P85", () => {
    expect(deliverableIn([10, 10], 3)).toEqual({ p50: 30, p85: 30 });
    const spread = deliverableIn([0, 20], 4)!;
    expect(spread.p50).toBe(40);
    expect(spread.p85).toBeLessThan(spread.p50);
    expect(deliverableIn([10], 0)).toBeNull();
    expect(deliverableIn([], 3)).toBeNull();
    // A far-off date is capped, not a hang.
    expect(deliverableIn([1], 10_000, { iterations: 10 })).toEqual({
      p50: MAX_SPRINTS,
      p85: MAX_SPRINTS,
    });
  });

  it("counts whole sprints to a date and finds the finish date", () => {
    expect(finishDate("2027-01-04", 2, 14)).toBe("2027-02-01");
    expect(sprintsUntil("2027-01-04", "2027-02-01", 14)).toBe(2);
    expect(sprintsUntil("2027-01-04", "2027-01-31", 14)).toBe(1);
    expect(sprintsUntil("2027-01-04", "2027-01-17", 14)).toBe(0);
    expect(sprintsUntil("2027-01-04", "2026-12-01", 14)).toBe(0);
    expect(sprintsUntil("2027-01-04", "", 14)).toBe(0);
    expect(formatDay("2027-06-07")).toBe("Jun 7, 2027");
    expect(formatDay("")).toBe("—");
  });

  it("gates the extras behind their minimum samples", () => {
    expect(bootstrapCrossCheck(100, [20, 20, 20, 20])).toBeNull();
    expect(bootstrapCrossCheck(100, [20, 20, 20, 20, 20])).toEqual({
      point: 5,
      optimistic: 5,
      pessimistic: 5,
    });
    // A slow tail of 0 has no pace to divide by.
    expect(bootstrapCrossCheck(100, [0, 0, 0, 20, 20])).toBeNull();
    // One 0-point sprint: the slow bound is 0, so there's no upper bound
    // (dividing by a clamped 0.01 read "scope × 100 sprints").
    expect(bootstrapCrossCheck(207, [23, 19, 27, 0, 22, 25, 21, 26])).toEqual({
      point: 11,
      optimistic: 10,
      pessimistic: null,
    });
    expect(bootstrapCrossCheck(100, [20, 0, 22, 18, 21])?.pessimistic).toBeNull();
    expect(bootstrapCrossCheck(207, [23, 19, 27, 14, 22, 25, 21, 26])).toEqual({
      point: 11,
      optimistic: 10,
      pessimistic: 15,
    });
    expect(recentShift([1, 2, 3, 4, 5, 6, 7])).toBeNull();
    expect(recentShift([20, 21, 19, 20, 22, 21, 20, 21])).toBe(false);
  });

  it("describes runs that never finish in the chart summary", () => {
    const text = simulationHistogramText({
      histogram: [{ sprints: 5, count: 8_000 }],
      total: 10_000,
      p50: 5,
      p85: null,
      p95: null,
      target: null,
    });
    expect(text.summary).toBe(
      "In 10,000 simulated runs, half finish within 5 sprints; 20% don't finish within 500 sprints."
    );
  });
});

/* ── Plan, verdict, export, next step ────────────────────────────────── */

describe("the plan and its verdict", () => {
  it("says why there's no forecast yet", () => {
    expect(
      planRelease(input({ scope: { source: "typed", points: null, items: 0, unestimated: 0 } }))
        .blocked
    ).toBe("no-scope");
    expect(planRelease(input({ sample: { points: [], labels: [] } })).blocked).toBe("no-sample");
    const small = planRelease(input({ sample: { points: [10, 10, 10], labels: [] } }));
    expect(small.blocked).toBe("small-sample");
    expect(small.forecast).toBeNull();
    expect(releaseVerdict(small)).toBe(
      "A forecast needs at least 4 sprints of history: type 1 more velocity."
    );
    expect(
      releaseVerdict(
        planRelease(input({ velocitySource: "sprints", sample: { points: [10, 10], labels: [] } }))
      )
    ).toBe(
      "A forecast needs at least 4 sprints of history: close 2 more sprints with their points."
    );
    expect(
      releaseVerdict(planRelease(input({ sample: { points: [0, 0, 0, 0], labels: [] } })))
    ).toBe("Every sampled sprint delivered 0 points, so at this pace the release never finishes.");
    expect(
      planRelease(
        input({
          scope: { source: "typed", points: 100_000, items: 0, unestimated: 0 },
          sample: { points: [1, 1, 1, 1], labels: [] },
        }),
        { iterations: 20 }
      ).blocked
    ).toBe("beyond-cap");
  });

  it("names what's missing from the scope", () => {
    const backlog = planRelease(
      input({ scope: { source: "backlog", points: null, items: 12, unestimated: 12 } })
    );
    expect(releaseVerdict(backlog)).toBe(
      "None of the 12 open stories has points yet, so there's nothing to forecast."
    );
    const pick = planRelease(
      input({ scope: { source: "slice", points: null, items: 0, unestimated: 0 } })
    );
    expect(releaseVerdict(pick)).toBe("Pick a story-map slice to get a forecast.");
  });

  it("gives the date to plan for, and the dates by confidence", () => {
    const plan = planRelease(input());
    expect(plan.rows).toEqual([
      { pct: 50, sprints: 5, date: "2027-03-15" },
      { pct: 75, sprints: 5, date: "2027-03-15" },
      { pct: 85, sprints: 5, date: "2027-03-15" },
      { pct: 95, sprints: 5, date: "2027-03-15" },
    ]);
    expect(releaseVerdict(plan)).toBe(
      "Plan for Mar 15, 2027 (5 sprints) to be 85% sure of finishing all 50 points."
    );
    const spread = planRelease(
      input({
        sample: { points: [5, 15, 5, 15], labels: [] },
        scope: { source: "typed", points: 40, items: 0, unestimated: 0 },
      })
    );
    expect(releaseVerdict(spread)).toMatch(
      /^Plan for [A-Z][a-z]{2} \d+, 2027 \(\d sprints\) to be 85% sure of finishing all 40 points; half the runs finish by [A-Z][a-z]{2} \d+, 2027\.$/
    );
    // Unestimated items are called out.
    const partial = planRelease(
      input({ scope: { source: "backlog", points: 50, items: 6, unestimated: 2 } })
    );
    expect(releaseVerdict(partial)).toBe(
      "Plan for Mar 15, 2027 (5 sprints) to be 85% sure of finishing the 50 estimated points."
    );
  });

  it("answers the target date: chance and scope by then", () => {
    const sure = planRelease(input({ targetDate: "2027-03-15", targetFrom: "user" }));
    expect(sure.target).toMatchObject({ sprints: 5, chance: 1, deliverable: { p50: 50, p85: 50 } });
    expect(releaseVerdict(sure)).toBe(
      "Very likely: almost every run finishes all 50 points by Mar 15, 2027."
    );

    const short = planRelease(input({ targetDate: "2027-03-01", targetFrom: "user" }));
    expect(short.target).toMatchObject({
      sprints: 4,
      chance: 0,
      deliverable: { p50: 40, p85: 40 },
    });
    expect(releaseVerdict(short)).toBe(
      "Very unlikely: almost no run finishes all 50 points by Mar 1, 2027; to be 85% sure, plan for Mar 15, 2027 or cut the 50 points to about 40."
    );

    const mixed = planRelease(
      input({
        scope: { source: "typed", points: 40, items: 0, unestimated: 0 },
        sample: { points: [5, 15, 5, 15], labels: [] },
        targetDate: "2027-03-01",
        targetFrom: "user",
      })
    );
    expect(mixed.target!.chance).toBeGreaterThan(0.6);
    expect(mixed.target!.chance).toBeLessThan(0.75);
    expect(releaseVerdict(mixed)).toMatch(
      /^A 6\d% chance of finishing all 40 points by Mar 1, 2027; to be 85% sure, plan for [A-Z][a-z]{2} \d+, 2027 or cut the 40 points to about \d+\.$/
    );

    const none = planRelease(input({ targetDate: "2027-01-10", targetFrom: "user" }));
    expect(none.target).toMatchObject({ sprints: 0, chance: 0, deliverable: null });
    expect(releaseVerdict(none)).toBe(
      "No full sprint fits between the start (Jan 4, 2027) and Jan 10, 2027; plan for Mar 15, 2027 to be 85% sure of finishing all 50 points."
    );
  });

  it("keeps an old target in sprints until a date is picked", () => {
    expect(
      resolveTargetDate({ targetDate: "", sprintsToReleaseTarget: "6" }, "2027-01-04", 14)
    ).toEqual({
      date: "2027-03-29",
      from: "legacy",
    });
    expect(
      resolveTargetDate({ targetDate: "2027-05-01", sprintsToReleaseTarget: "6" }, "2027-01-04", 14)
    ).toEqual({ date: "2027-05-01", from: "user" });
    expect(
      resolveTargetDate({ targetDate: "", sprintsToReleaseTarget: "abc" }, "2027-01-04", 14)
    ).toEqual({
      date: "",
      from: null,
    });
    expect([signedPct(null), signedPct(10), signedPct(-5.26)]).toEqual(["0%", "+10%", "−5.3%"]);
  });

  it("exports the forecast as Markdown", () => {
    const plan = planRelease(
      input({
        scope: { source: "backlog", points: 48, items: 9, unestimated: 1 },
        scopeChangePct: 4.2,
        targetDate: "2027-03-15",
        targetFrom: "user",
      })
    );
    const md = toMarkdown(plan, new Date(2026, 9, 23));
    expect(md.startsWith("# Release forecast — 23 Oct 2026\n")).toBe(true);
    expect(md).toContain(`**${releaseVerdict(plan)}**`);
    expect(md).toContain(
      "| Scope | 48 points from the backlog (9 open stories, 1 without points) |"
    );
    expect(md).toContain("| Expected scope change | +4.2% |");
    expect(md).toContain("| Scope to forecast | 50 points |");
    expect(md).toContain("| Simulation sample | 4 typed velocities: 10, 10, 10, 10 |");
    expect(md).toContain("| Sprint length | 14 days (the team's cadence) |");
    expect(md).toContain("| 85% | 5 | Mar 15, 2027 |");
    expect(md).toContain("## By Mar 15, 2027 (5 sprints)");
    expect(md).toContain("- Chance of finishing the scope: 100%");
    expect(md.endsWith("\n")).toBe(true);
    // Nothing to forecast: the verdict and the inputs, no tables.
    const empty = toMarkdown(planRelease(input({ sample: { points: [], labels: [] } })));
    expect(empty).not.toContain("## When it finishes");
  });

  it("points at the weakest input", () => {
    expect(
      releaseNextStep(
        planRelease(input({ scope: { source: "backlog", points: 50, items: 6, unestimated: 2 } }))
      )
    ).toMatchObject({ id: "release-estimate-stories", href: "/planning-poker" });
    expect(
      releaseNextStep(
        planRelease(
          input({ velocitySource: "sprints", sample: { points: [10], labels: ["Sprint 1"] } })
        )
      )
    ).toMatchObject({ id: "release-log-sprints", href: "/velocity" });
    expect(
      releaseNextStep(planRelease(input({ targetDate: "2027-03-01", targetFrom: "user" })))
    ).toMatchObject({ id: "release-cut-scope", href: "/moscow" });
    expect(releaseNextStep(planRelease(input()))).toBeNull();
  });
});

describe("field checks", () => {
  it("validates the numbers instead of clamping them", () => {
    expect(validateScopePoints("")).toEqual({ ok: true, values: null });
    expect(validateScopePoints("120")).toEqual({ ok: true, values: 120 });
    expect(validateScopePoints("0").ok).toBe(false);
    expect(validateScopePoints("abc").ok).toBe(false);
    expect(validateScopePoints("1000000").ok).toBe(false);
    expect(validateScopeChange("-5")).toEqual({ ok: true, values: -5 });
    expect(validateScopeChange("-95").ok).toBe(false);
    expect(validateSprintLength("10")).toEqual({ ok: true, values: 10 });
    expect(validateSprintLength("2.5").ok).toBe(false);
    expect(validateSprintLength("0").ok).toBe(false);
    expect(validateSprintLength("91").ok).toBe(false);
  });
});

/* ── The page ────────────────────────────────────────────────────────── */

const renderPlanner = () => render(<ReleasePlannerClient />);
const config = () => useReleasePlannerStore.getState().config;
const verdict = () => screen.getByTestId("release-verdict").textContent;

beforeEach(() => {
  toastSpy.mockReset();
  useReleasePlannerStore.setState({ config: EMPTY_CONFIG });
  useWorkspaceStore.setState({ sprints: [], stories: [], storyMaps: [], ceremonyCadences: [] });
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("first run", () => {
  it("opens empty, loads the example without touching the workspace, and clears it", () => {
    renderPlanner();
    expect(screen.getByText(/Nothing to forecast yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(config()).toMatchObject({ example: EXAMPLE_ID, backlogSize: 180, scopeChangePct: 15 });
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(verdict()).toMatch(
      /^Unlikely: a \d+% chance of finishing all 207 points \(180 with a \+15% change\) by .+ or cut the 180 points to about \d+\.$/
    );
    expect(useWorkspaceStore.getState().sprints).toEqual([]);
    expect(useWorkspaceStore.getState().stories).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText(/Example data\./)).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing to forecast yet/)).toBeInTheDocument();
    expect(config()).toMatchObject({ backlogSize: null, velocityInput: "", targetDate: "" });
  });

  it("builds the example's target date from today", () => {
    expect(buildExample("2026-10-23").targetDate).toBe("2027-02-26");
  });
});

describe("scope on the page", () => {
  it("reads the backlog by default and names the unestimated stories", () => {
    useWorkspaceStore.setState({
      stories: [story("a", 5), story("b", 8), story("c", undefined)],
      sprints: [1, 2, 3, 4].map((n) => sprint(n, 10)),
    });
    renderPlanner();
    expect(screen.getByRole("radio", { name: "Backlog" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/in 3 open stories\.$/).textContent).toBe(
      "13 points in 3 open stories."
    );
    expect(
      screen.getByText("1 open story has no points, so the forecast leaves it out.")
    ).toBeInTheDocument();
    expect(verdict()).toMatch(/finishing the 13 estimated points\.$/);
    expect(
      screen.getByRole("heading", { name: "Estimate the unsized stories" })
    ).toBeInTheDocument();
  });

  it("opens on the slice a ?slice= link names", () => {
    window.history.replaceState(null, "", "/release-planner?slice=mvp");
    useWorkspaceStore.setState({ storyMaps: [MAP], stories: [story("a", 5)] });
    renderPlanner();
    expect(screen.getByRole("radio", { name: "Story-map slice" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByLabelText("Story-map slice")).toHaveValue("mvp");
    expect(screen.getByText(/in 3 cards\.$/).textContent).toBe("13 points in 3 cards.");
    expect(
      screen.getByText("1 card has no numeric estimate, so the forecast leaves it out.")
    ).toBeInTheDocument();
    expect(config()).toMatchObject({ scopeSource: "slice", sliceId: "mvp" });

    // Picking another source drops the link's slice, so a refresh stays put.
    fireEvent.click(screen.getByRole("radio", { name: "Backlog" }));
    expect(window.location.search).toBe("");
    expect(config().scopeSource).toBe("backlog");
  });

  it("checks the typed scope and keeps the last good value", () => {
    renderPlanner();
    const field = screen.getByLabelText("Points left to deliver");
    fireEvent.change(field, { target: { value: "120" } });
    expect(config().backlogSize).toBe(120);
    fireEvent.change(field, { target: { value: "-5" } });
    expect(screen.getByRole("alert")).toHaveTextContent("The scope must be more than 0 points.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(field);
    expect(config().backlogSize).toBe(120);
    fireEvent.change(field, { target: { value: "" } });
    expect(config().backlogSize).toBeNull();
  });

  it("rejects a typed velocity that isn't a number", () => {
    renderPlanner();
    fireEvent.click(screen.getByRole("radio", { name: "Type them" }));
    const box = screen.getByRole("textbox", { name: /Points completed per sprint/ });
    fireEvent.change(box, { target: { value: "10, 12" } });
    expect(config().velocityInput).toBe("10, 12");
    fireEvent.change(box, { target: { value: "10, 12, lots" } });
    expect(screen.getByRole("alert")).toHaveTextContent("“lots” isn't a number of points.");
    expect(config().velocityInput).toBe("10, 12");
  });
});

describe("velocity and dates on the page", () => {
  it("counts 0-point sprints and asks for more below the minimum", () => {
    useWorkspaceStore.setState({ sprints: [sprint(1, 20), sprint(2, 0), sprint(3, 22)] });
    useReleasePlannerStore.setState({ config: { ...EMPTY_CONFIG, backlogSize: 100 } });
    renderPlanner();
    expect(screen.getByText("20, 0, 22")).toBeInTheDocument();
    expect(
      screen.getByText("14 points per sprint, the average of the last 3 sprints.")
    ).toBeInTheDocument();
    // NotEnoughData is the verdict here, not a second copy under it.
    expect(screen.getByText("Close 1 more sprint to see a forecast.")).toBeInTheDocument();
    expect(screen.queryByTestId("release-verdict")).toBeNull();
    expect(screen.queryByText("Coin flip (P50)")).toBeNull();

    act(() => useWorkspaceStore.getState().upsertSprint(sprint(4, 18)));
    expect(screen.getByText("Coin flip (P50)")).toBeInTheDocument();
    expect(
      screen.getByText(
        /each replaying random sprints from 4 completed sprints \(Sprint 1, Sprint 2, Sprint 3 and Sprint 4\): 20, 0, 22, 18/
      )
    ).toBeInTheDocument();
  });

  it("takes the sprint length from the cadence until one is typed", () => {
    useWorkspaceStore.setState({
      ceremonyCadences: [
        {
          id: CEREMONY_CADENCE_ID,
          sprintLengthDays: 7,
          dailyTime: "09:30",
          dailyWeekdays: [1, 2, 3, 4, 5],
          planningTime: "10:00",
          reviewTime: "14:00",
          retroTime: "15:30",
          refinement: null,
        },
      ],
    });
    useReleasePlannerStore.setState({
      config: {
        ...EMPTY_CONFIG,
        backlogSize: 40,
        velocityInput: "10, 10, 10, 10",
        startDate: "2027-01-04",
      },
    });
    renderPlanner();
    const length = screen.getByLabelText("Sprint length");
    expect(length).toHaveValue("");
    expect(length).toHaveAttribute("placeholder", "7");
    expect(screen.getByText(/7 days, from the team's cadence/)).toBeInTheDocument();
    // 4 sprints of 7 days from Jan 4.
    expect(verdict()).toBe(
      "Plan for Feb 1, 2027 (4 sprints) to be 85% sure of finishing all 40 points."
    );

    fireEvent.change(length, { target: { value: "14" } });
    fireEvent.blur(length);
    expect(config().sprintLengthDays).toBe(14);
    expect(verdict()).toBe(
      "Plan for Mar 1, 2027 (4 sprints) to be 85% sure of finishing all 40 points."
    );
  });

  it("answers the target date on the page", () => {
    useReleasePlannerStore.setState({
      config: {
        ...EMPTY_CONFIG,
        backlogSize: 40,
        velocityInput: "10, 10, 10, 10",
        startDate: "2027-01-04",
      },
    });
    renderPlanner();
    fireEvent.change(screen.getByLabelText("Target date (optional)"), {
      target: { value: "2027-02-15" },
    });
    expect(config().targetDate).toBe("2027-02-15");
    const answer = screen.getByRole("group", { name: /By Feb 15, 2027/ });
    expect(
      within(answer).getByText("Probability of finishing by then").nextSibling
    ).toHaveTextContent("0%");
    expect(within(answer).getByText("Scope we can deliver by then").nextSibling).toHaveTextContent(
      "30 pts to commit to (P85) · 30 on a coin flip (P50)"
    );
  });
});

describe("reset", () => {
  it("confirms, clears, and undoes", () => {
    const filled = {
      ...EMPTY_CONFIG,
      backlogSize: 90,
      scopeChangePct: 12,
      velocityInput: "9, 11, 10, 12",
      targetDate: "2027-05-01",
    };
    useReleasePlannerStore.setState({ config: filled });
    renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset planner" }));
    expect(config()).toEqual(EMPTY_CONFIG);
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Reset the Release Planner");
    act(() => opts.action.onClick());
    expect(config()).toEqual(filled);
  });
});

/* ── Review fixes ────────────────────────────────────────────────────── */

const EXAMPLE_VELOCITIES = [23, 19, 27, 14, 22, 25, 21, 26];

describe("verdict wording", () => {
  const base = planRelease(
    input({
      scope: { source: "typed", points: 40, items: 0, unestimated: 0 },
      sample: { points: [5, 15, 5, 15], labels: [] },
      targetDate: "2027-03-01",
      targetFrom: "user",
    })
  );
  const at = (chance: number) => releaseVerdict({ ...base, target: { ...base.target!, chance } });

  it("follows the rounded percentage the page shows", () => {
    // 84.7% shows as 85%: "Likely", not "85% … to be 85% sure".
    expect(at(0.847)).toBe("Likely: an 85% chance of finishing all 40 points by Mar 1, 2027.");
    expect(at(0.844)).toMatch(
      /^An 84% chance of finishing all 40 points by Mar 1, 2027; to be 85%/
    );
    expect(at(0.496)).toMatch(/^A 50% chance of /);
    expect(at(0.494)).toMatch(/^Unlikely: a 49% chance of /);
    expect(at(0.994)).toBe("Likely: a 99% chance of finishing all 40 points by Mar 1, 2027.");
    expect(at(0.995)).toBe("Very likely: almost every run finishes all 40 points by Mar 1, 2027.");
    expect(at(0.004)).toMatch(/^Very unlikely: almost no run finishes /);
    // "50%" isn't a long shot for the next step either.
    expect(releaseNextStep({ ...base, target: { ...base.target!, chance: 0.496 } })).toBeNull();
    expect(releaseNextStep({ ...base, target: { ...base.target!, chance: 0.494 } })).toMatchObject({
      id: "release-cut-scope",
    });
  });

  it("never advises cutting the scope to 0 points", () => {
    const plan = planRelease(
      input({
        scope: { source: "typed", points: 30, items: 0, unestimated: 0 },
        sample: { points: [0, 0, 0, 30], labels: [] },
        targetDate: "2027-01-18",
        targetFrom: "user",
      })
    );
    expect(plan.target).toMatchObject({ sprints: 1, deliverable: { p85: 0 } });
    const text = releaseVerdict(plan);
    expect(text).toMatch(
      /^Unlikely: a 2\d% chance of finishing all 30 points by Jan 18, 2027; to be 85% sure, plan for [A-Z][a-z]{2} \d+, 2027\.$/
    );
    expect(text).not.toContain("cut");
  });

  it("states the cut in the scope the user edits, before the expected change", () => {
    const typed = (points: number) =>
      planRelease(
        input({
          scope: { source: "typed", points, items: 0, unestimated: 0 },
          scopeChangePct: 15,
          sample: { points: EXAMPLE_VELOCITIES, labels: [] },
          targetDate: addDaysIso("2027-01-04", 126),
          targetFrom: "user",
        })
      );
    const plan = typed(180);
    expect(plan.effective).toBe(207);
    expect(plan.target).toMatchObject({ sprints: 9, deliverable: { p85: 187 } });
    // 187 deliverable ÷ 1.15 = 162 typed points, not "cut to 187" (more than the 180 typed).
    expect(releaseVerdict(plan)).toBe(
      "Unlikely: a 28% chance of finishing all 207 points (180 with a +15% change) by May 10, 2027; to be 85% sure, plan for May 24, 2027 or cut the 180 points to about 162."
    );
    // And the cut gets there.
    expect(typed(162).effective).toBe(186);
    expect(typed(162).target!.chance).toBeGreaterThanOrEqual(0.85);
    // The Markdown export reuses the verdict.
    expect(toMarkdown(plan)).toContain("cut the 180 points to about 162.");
  });

  it("names the scope before the change only when there is one", () => {
    expect(releaseVerdict(planRelease(input({ scopeChangePct: 0 })))).toBe(
      "Plan for Mar 15, 2027 (5 sprints) to be 85% sure of finishing all 50 points."
    );
    expect(releaseVerdict(planRelease(input({ scopeChangePct: -20 })))).toBe(
      "Plan for Mar 1, 2027 (4 sprints) to be 85% sure of finishing all 40 points (50 with a −20% change)."
    );
  });

  it("asks for enough sprints of history, not one", () => {
    const none = { sample: { points: [], labels: [] } };
    expect(releaseVerdict(planRelease(input({ ...none, velocitySource: "sprints" })))).toBe(
      "Close at least 4 sprints with their completed points to get a forecast."
    );
    expect(releaseVerdict(planRelease(input(none)))).toBe(
      "Type the points of at least 4 past sprints to get a forecast."
    );
  });
});

describe("the target date without a forecast", () => {
  const noScope = { source: "typed" as const, points: null, items: 0, unestimated: 0 };

  it("still says what the team can deliver by the date", () => {
    const open = planRelease(
      input({ scope: noScope, targetDate: "2027-03-15", targetFrom: "user" })
    );
    expect(open.blocked).toBe("no-scope");
    expect(open.target).toEqual({
      date: "2027-03-15",
      sprints: 5,
      chance: null,
      deliverable: { p50: 50, p85: 50 },
    });
    const md = toMarkdown(open);
    expect(md).toContain("## By Mar 15, 2027 (5 sprints)");
    expect(md).toContain(
      "- Scope the team can deliver: about 50 points on a coin flip (P50), 50 points to commit to (P85)"
    );
    expect(md).not.toContain("Chance of finishing");
    // Below the minimum sample there's nothing to say about the date.
    expect(
      planRelease(
        input({
          scope: noScope,
          sample: { points: [10, 10, 10], labels: [] },
          targetDate: "2027-03-15",
          targetFrom: "user",
        })
      ).target
    ).toBeNull();
  });

  it("answers the date when the scope is out of reach too", () => {
    const far = planRelease(
      input({
        scope: { source: "typed", points: 100_000, items: 0, unestimated: 0 },
        sample: { points: [1, 1, 1, 1], labels: [] },
        targetDate: "2027-03-15",
        targetFrom: "user",
      }),
      { iterations: 20 }
    );
    expect(far.blocked).toBe("beyond-cap");
    expect(far.target).toMatchObject({ sprints: 5, chance: 0, deliverable: { p50: 5, p85: 5 } });
    // A blocked plan's verdict says what to fix; no "decide what to cut".
    expect(releaseNextStep(far)).toBeNull();
    const none = planRelease(
      input({ scope: noScope, targetDate: "2027-01-10", targetFrom: "user" })
    );
    expect(none.target).toMatchObject({ sprints: 0, chance: null, deliverable: null });
    expect(toMarkdown(none)).toContain("- No full sprint fits between the start and this date.");
  });

  it("shows the scope to promise on the page without a scope", () => {
    useReleasePlannerStore.setState({
      config: {
        ...EMPTY_CONFIG,
        scopeSource: "typed",
        velocityInput: "10, 10, 10, 10",
        startDate: "2027-01-04",
        targetDate: "2027-02-15",
      },
    });
    renderPlanner();
    expect(verdict()).toBe("Add the release scope to get a forecast.");
    const answer = screen.getByRole("group", { name: /By Feb 15, 2027/ });
    expect(within(answer).getByText("Scope we can deliver by then").nextSibling).toHaveTextContent(
      "30 pts to commit to (P85) · 30 on a coin flip (P50)"
    );
    expect(within(answer).queryByText("Probability of finishing by then")).toBeNull();
  });
});

describe("the running sprint and the backlog", () => {
  const running: Sprint = {
    id: "s9",
    name: "Sprint 9",
    startDate: "2026-10-12",
    endDate: "2026-10-25",
    pointsPlanned: 30,
    status: "active",
  };

  it("finds the running sprint the forecast starts after", () => {
    expect(sprintEndingBefore(running, "2026-10-26")).toBe(running);
    expect(sprintEndingBefore(running, "2026-10-25")).toBeUndefined();
    expect(sprintEndingBefore(running, "2026-10-20")).toBeUndefined();
    expect(sprintEndingBefore(undefined, "2026-10-26")).toBeUndefined();
    expect(
      sprintEndingBefore({ ...running, startDate: "2020-01-03", endDate: "" }, "2026-10-26")
    ).toBeUndefined();
  });

  it("counts the running sprint's stories only when the forecast starts during it", () => {
    useWorkspaceStore.setState({
      sprints: [...[1, 2, 3, 4].map((n) => sprint(n, 10)), running],
      stories: [story("b1", 5), story("r1", 3, { sprintId: "s9", status: "in_progress" })],
    });
    renderPlanner();
    // No start set: the day after Sprint 9 ends, so its story is its own work.
    expect(screen.getByLabelText("Start")).toHaveValue("2026-10-26");
    expect(screen.getByText(/in 1 open story\.$/).textContent).toBe("5 points in 1 open story.");
    expect(
      screen.getByText(
        "Leaves out 1 open story in Sprint 9, which ends before the forecast starts."
      )
    ).toBeInTheDocument();
    expect(verdict()).toMatch(/finishing all 5 points\.$/);

    // A start inside the sprint plans its work too.
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-10-20" } });
    expect(screen.getByText(/in 2 open stories\.$/).textContent).toBe(
      "8 points in 2 open stories."
    );
    expect(screen.queryByText(/^Leaves out/)).toBeNull();
    expect(
      screen.getByText("Includes 1 open story in running or planned sprints.")
    ).toBeInTheDocument();
  });
});

describe("the example keeps what was there", () => {
  it("puts back a target date and scope change set before it loaded", () => {
    const before = { ...EMPTY_CONFIG, targetDate: "2027-06-01", scopeChangePct: 5 };
    useReleasePlannerStore.setState({ config: before });
    renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(config()).toMatchObject({
      example: EXAMPLE_ID,
      scopeChangePct: 15,
      beforeExample: { targetDate: "2027-06-01", scopeChangePct: 5 },
    });
    expect(config().targetDate).not.toBe("2027-06-01");
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(config()).toEqual(before);
  });

  it("stores the snapshot only alongside the example", () => {
    const loaded = { ...EMPTY_CONFIG, ...withExample(EMPTY_CONFIG, "2026-10-23") };
    expect(loaded.beforeExample).toEqual({
      backlogSize: null,
      scopeChangePct: null,
      velocityInput: "",
      targetDate: "",
    });
    // A refresh keeps it (persisted), minus anything that isn't the example's.
    const stored = normalizeConfig({
      ...loaded,
      beforeExample: { targetDate: "2027-06-01", sliceId: "x", backlogSize: -3, junk: 1 },
    });
    expect(stored.beforeExample).toEqual({
      backlogSize: null,
      scopeChangePct: null,
      velocityInput: "",
      targetDate: "2027-06-01",
    });
    expect(normalizeConfig({ beforeExample: { targetDate: "2027-06-01" } })).toEqual(EMPTY_CONFIG);
    // An example saved before snapshots existed clears to empty.
    expect(clearedExample({ ...EMPTY_CONFIG, ...buildExample("2026-10-23") })).toMatchObject({
      example: undefined,
      backlogSize: null,
      targetDate: "",
    });
  });
});

describe("number fields", () => {
  it("reads comma decimals and the printed minus in the scope change", () => {
    expect(validateScopeChange("12,5")).toEqual({ ok: true, values: 12.5 });
    expect(validateScopeChange("-12,25")).toEqual({ ok: true, values: -12.25 });
    expect(validateScopeChange("−5")).toEqual({ ok: true, values: -5 });
    // A thousands comma is flagged, not read as 1%.
    expect(validateScopeChange("1,000").ok).toBe(false);
    expect(["-", "−", "+", ".", "-,"].map(isPartialNumber)).toEqual([true, true, true, true, true]);
    expect(["", " ", "-5", "5.", "abc"].map(isPartialNumber)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("lets a phone type a cut, and waits for the number after a lone minus", () => {
    renderPlanner();
    const change = screen.getByLabelText("Expected scope change");
    expect(change).toHaveAttribute("inputmode", "text");
    expect(screen.getByLabelText("Points left to deliver")).toHaveAttribute("inputmode", "decimal");
    fireEvent.change(change, { target: { value: "-" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(config().scopeChangePct).toBeNull();
    fireEvent.change(change, { target: { value: "-5" } });
    expect(config().scopeChangePct).toBe(-5);
    fireEvent.change(change, { target: { value: "-" } });
    fireEvent.blur(change);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a percentage, such as 10 or -5.");
    expect(config().scopeChangePct).toBe(-5);
  });

  it("drops a field's error when its value changes from outside", () => {
    useReleasePlannerStore.setState({
      config: { ...EMPTY_CONFIG, velocitySource: "manual", velocityInput: "10, 12" },
    });
    renderPlanner();
    const box = screen.getByRole("textbox", { name: /Points completed per sprint/ });
    fireEvent.change(box, { target: { value: "10, x" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Undo, another tab: the box shows the new value and no stale message.
    act(() => useReleasePlannerStore.getState().updateConfig({ velocityInput: "9, 9, 9, 9" }));
    expect(box).toHaveValue("9, 9, 9, 9");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box).not.toHaveAttribute("aria-invalid", "true");
  });

  it("clears drafts and messages on Reset, even where the saved value didn't change", () => {
    useReleasePlannerStore.setState({
      config: { ...EMPTY_CONFIG, scopeSource: "typed", backlogSize: 120, targetDate: "2027-05-01" },
    });
    renderPlanner();
    fireEvent.change(screen.getByLabelText("Points left to deliver"), {
      target: { value: "-5" },
    });
    fireEvent.change(screen.getByLabelText("Sprint length"), { target: { value: "2.5" } });
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset planner" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Points left to deliver")).toHaveValue("");
    expect(screen.getByLabelText("Sprint length")).toHaveValue("");
  });
});

describe("focus after replacing every field", () => {
  const scopeHeading = () => screen.getByText("Scope", { selector: "span" });

  it("lands on the Scope heading after Reset, Load example and Clear example", () => {
    useReleasePlannerStore.setState({ config: { ...EMPTY_CONFIG, targetDate: "2027-05-01" } });
    renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset planner" }));
    // The Reset button is disabled now (nothing left to reset).
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
    expect(document.activeElement).toBe(scopeHeading());

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(document.activeElement).toBe(scopeHeading());
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(document.activeElement).toBe(scopeHeading());
  });
});

describe("AI prompts", () => {
  it("give the page's headline velocity, not a plain mean of the sample", () => {
    const sprints = [20, 22, 18, 24].map((p, i) => sprint(i + 1, p));
    const plan = planRelease(
      input({
        velocitySource: "sprints",
        sample: { points: [20, 22, 18, 24], labels: [] },
        headline: velocity(sprints),
      })
    );
    const [first] = releasePrompts(plan);
    expect(first.prompt).toContain(
      "Average Velocity: 21.3 pts/sprint (the last 3 sprints, as the Release Planner shows it)"
    );
    expect(first.prompt).not.toMatch(/^Average Velocity: 21 pts\/sprint$/m);
    expect(first.prompt).toContain("Historical Velocities: 20, 22, 18, 24 pts/sprint");
    expect(releasePrompts(planRelease(input({ sample: { points: [], labels: [] } })))).toEqual([]);
  });
});
