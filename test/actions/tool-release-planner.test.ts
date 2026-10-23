/**
 * tool.release_planner.* action coverage.
 *
 * Pure compute (Monte-Carlo), so we assert shape + monotonic percentile
 * ordering + sane magnitude rather than exact values:
 *   1. forecast is a read action
 *   2. empty velocities / zero backlog → all-zero forecast (no NaN)
 *   3. valid input → p50 ≤ p75 ≤ p85 ≤ p95, all finite, and the P50 is in
 *      the right ballpark (backlog / avg velocity)
 *   4. scopeBufferPct inflates the effective backlog
 */

import { describe, it, expect } from "vitest";
import { registry } from "@/lib/actions/registry";

import "@/lib/actions/tools/release-planner";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Forecast = {
  effectiveBacklog: number;
  avgVelocity: number;
  sprints: { p50: number; p75: number; p85: number; p95: number };
  minSprints: number;
  maxSprints: number;
  unfinishedRuns: number;
  finishDates: { p50: string; p85: string; p95: string } | null;
  target: {
    date: string;
    sprints: number;
    chance: number;
    deliverable: { p50: number; p85: number };
  } | null;
};

describe("tool.release_planner.forecast", () => {
  it("is registered as a read action", () => {
    expect(registry.get("tool.release_planner.forecast")?.category).toBe("read");
  });

  it("can't forecast without velocities: nulls, not 0 sprints (no NaN)", async () => {
    const action = registry.get("tool.release_planner.forecast");
    const r = (await action!.handler({ backlogPoints: 100, velocities: [] }, ctx())) as Forecast;
    expect(r.sprints).toEqual({ p50: null, p75: null, p85: null, p95: null });
    expect(r.avgVelocity).toBe(0);
  });

  it("returns an all-zero forecast for a zero backlog", async () => {
    const action = registry.get("tool.release_planner.forecast");
    const r = (await action!.handler(
      { backlogPoints: 0, velocities: [20, 22, 18] },
      ctx()
    )) as Forecast;
    expect(r.sprints.p95).toBe(0);
  });

  it("produces monotonically ordered percentiles in a sane range", async () => {
    const action = registry.get("tool.release_planner.forecast");
    // 200 pts at ~20/sprint → ~10 sprints around the median.
    const r = (await action!.handler(
      { backlogPoints: 200, velocities: [18, 22, 19, 25, 21, 17, 23, 20], iterations: 3000 },
      ctx()
    )) as Forecast;
    expect(Number.isFinite(r.sprints.p50)).toBe(true);
    expect(r.sprints.p50).toBeGreaterThan(0);
    expect(r.sprints.p50).toBeLessThanOrEqual(r.sprints.p75);
    expect(r.sprints.p75).toBeLessThanOrEqual(r.sprints.p85);
    expect(r.sprints.p85).toBeLessThanOrEqual(r.sprints.p95);
    // ballpark: 200 / 20 = 10 sprints; allow a wide MC band.
    expect(r.sprints.p50).toBeGreaterThanOrEqual(7);
    expect(r.sprints.p50).toBeLessThanOrEqual(14);
  });

  it("inflates the effective backlog by scopeBufferPct", async () => {
    const action = registry.get("tool.release_planner.forecast");
    const r = (await action!.handler(
      { backlogPoints: 100, velocities: [20], scopeBufferPct: 25 },
      ctx()
    )) as Forecast;
    expect(r.effectiveBacklog).toBe(125);
  });
});

describe("tool.release_planner.forecast matches the page", () => {
  const run = async (params: Record<string, unknown>) =>
    (await registry.get("tool.release_planner.forecast")!.handler(params, ctx())) as Forecast;

  it("counts 0-point sprints instead of dropping them", async () => {
    const withZero = await run({ backlogPoints: 100, velocities: [20, 0], iterations: 2000 });
    const without = await run({ backlogPoints: 100, velocities: [20], iterations: 2000 });
    expect(without.sprints.p50).toBe(5);
    expect(withZero.sprints.p50).toBeGreaterThan(5);
  });

  it("never finishes when every sprint delivered 0", async () => {
    const r = await run({ backlogPoints: 50, velocities: [0, 0], iterations: 200 });
    expect(r.sprints.p50).toBeNull();
    expect(r.unfinishedRuns).toBe(200);
  });

  it("prefers scopeChangePct, and accepts a cut", async () => {
    expect(
      (await run({ backlogPoints: 100, velocities: [20], scopeChangePct: -20, scopeBufferPct: 50 }))
        .effectiveBacklog
    ).toBe(80);
  });

  it("answers 'by this date?' with dates and the deliverable scope", async () => {
    const r = await run({
      backlogPoints: 100,
      velocities: [20],
      startDate: "2026-11-02",
      sprintLengthDays: 14,
      targetDate: "2026-12-28",
    });
    expect(r.finishDates?.p50).toBe("2027-01-11");
    expect(r.target).toEqual({
      date: "2026-12-28",
      sprints: 4,
      chance: 0,
      deliverable: { p50: 80, p85: 80 },
    });
  });
});
