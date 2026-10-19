/**
 * The hub's sprint status uses the same formulas as the MCP compute actions
 * an agent would call, on the tools' calendar-day convention (the ideal line
 * reaches 0 on the end date, i.e. `sprintDays = lengthDays + 1` for
 * `tool.burndown.compute`).
 */

import { describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { denseSeries, recentVelocity, sprintStatus } from "@/lib/sprints/metrics";

import "@/lib/actions/tools/burndown";
import "@/lib/actions/tools/burnup";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-05",
  endDate: "2026-10-15",
  pointsPlanned: 40,
  status: "active",
};
const SERIES: SprintSeries = {
  id: "s1",
  days: [
    { day: 0, remaining: 40 },
    { day: 1, remaining: 37 },
    // day 2 not logged: carries day 1 forward
    { day: 3, completed: 9, scope: 44, scopeChange: true },
    { day: 4, remaining: 31 },
  ],
};

describe("sprint status", () => {
  it("fills unlogged days with the previous reading", () => {
    const d = denseSeries(SPRINT, SERIES);
    expect(d.remaining).toEqual([40, 37, 37, 35, 31]);
    expect(d.completed).toEqual([0, 3, 3, 9, 13]);
    expect(d.scope).toEqual([40, 40, 40, 44, 44]);
  });

  it("matches tool.burndown.compute", async () => {
    const status = sprintStatus(SPRINT, SERIES);
    const d = denseSeries(SPRINT, SERIES);
    const mcp = (await registry
      .get("tool.burndown.compute")!
      .handler(
        { totalPoints: SPRINT.pointsPlanned, remaining: d.remaining, sprintDays: 10 + 1 },
        ctx()
      )) as {
      idealRemainingNow: number;
      gap: number;
      onTrack: boolean;
      projectedCompletionDay: number | null;
      willFinishOnTime: boolean;
    };
    expect(status.lengthDays).toBe(10);
    expect(status.idealRemaining).toBe(mcp.idealRemainingNow);
    expect(status.gap).toBe(mcp.gap);
    expect(status.onTrack).toBe(mcp.onTrack);
    expect(status.projectedFinishDay).toBe(mcp.projectedCompletionDay);
    expect(status.willFinishOnTime).toBe(mcp.willFinishOnTime);
  });

  it("matches tool.burnup.compute", async () => {
    const status = sprintStatus(SPRINT, SERIES);
    const d = denseSeries(SPRINT, SERIES);
    const mcp = (await registry
      .get("tool.burnup.compute")!
      .handler({ scope: d.scope, completed: d.completed }, ctx())) as {
      currentScope: number;
      currentCompleted: number;
      remaining: number;
      percentComplete: number;
    };
    expect(status.scopeNow).toBe(mcp.currentScope);
    expect(status.done).toBe(mcp.currentCompleted);
    expect(status.percentDone).toBe(mcp.percentComplete);
    expect(status.scopeChange).toBe(4);
  });

  it("is empty-handed, not wrong, before anything is logged", () => {
    const status = sprintStatus(SPRINT, undefined);
    expect(status.lastDay).toBeNull();
    expect(status.remaining).toBeNull();
    expect(status.gap).toBeNull();
    expect(status.scopeNow).toBe(40);
    expect(status.loggedDays).toBe(0);
  });

  it("averages the latest finished sprints that have points", () => {
    const done = (id: string, pts?: number): Sprint => ({
      ...SPRINT,
      id,
      status: "completed",
      pointsCompleted: pts,
    });
    expect(recentVelocity([done("a", 20), done("b", 30), done("c", 25), done("d", 35)])).toBe(30);
    expect(recentVelocity([done("a")])).toBeNull();
  });
});
