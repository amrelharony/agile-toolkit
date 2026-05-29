/**
 * tool.health_dashboard.* coverage (read-only aggregate; no persistence).
 *
 * The dashboard has no state of its own — it aggregates other tools. The
 * client reads per-tool localStorage; the agent computes from the SYNCED
 * entities (the authoritative source post-migration).
 *
 *   1. registration — get_summary is a read.
 *   2. get_summary — KPIs + predictability + flags from seeded entities.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HealthCheck } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/health-dashboard";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.health_dashboard — registration", () => {
  it("get_summary is a read with an mcpHandler", () => {
    expect(registry.get("tool.health_dashboard.get_summary")?.category).toBe("read");
    expect(registry.get("tool.health_dashboard.get_summary")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.health_dashboard.get_summary", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "sp1",
          name: "S1",
          startDate: "2026-01-01",
          endDate: "2026-01-14",
          pointsPlanned: 20,
          pointsCompleted: 22,
          status: "completed",
        },
        {
          id: "sp2",
          name: "S2",
          startDate: "2026-01-15",
          endDate: "2026-01-28",
          pointsPlanned: 20,
          pointsCompleted: 10,
          status: "completed",
        },
        {
          id: "sp3",
          name: "S3",
          startDate: "2026-01-29",
          endDate: "2026-02-11",
          pointsPlanned: 20,
          status: "active",
        },
      ],
      stories: [
        { id: "st1", title: "A", status: "done" },
        { id: "st2", title: "B", status: "done" },
        { id: "st3", title: "C", status: "in_progress" },
        { id: "st4", title: "D", status: "todo" },
      ],
      impediments: [
        { id: "i1", title: "x", severity: "critical", raisedAt: "2026-01-02" },
        { id: "i2", title: "y", severity: "low", raisedAt: "2026-01-03", resolvedAt: "2026-01-05" },
      ],
      risks: [
        {
          id: "r1",
          title: "big",
          probability: 5,
          impact: 4,
          status: "open",
          raisedAt: "2026-01-01",
        },
        {
          id: "r2",
          title: "small",
          probability: 1,
          impact: 1,
          status: "closed",
          raisedAt: "2026-01-01",
        },
      ],
      okrs: [
        {
          id: "o1",
          objective: "Obj",
          quarter: "2026Q1",
          keyResults: [
            { id: "k1", title: "KR1", target: 100, current: 50 },
            { id: "k2", title: "KR2", target: 10, current: 10 },
          ],
        },
      ],
      healthChecks: [
        {
          id: "healthCheck:current",
          current: {
            sprintName: "",
            scores: {
              a: { light: "green", trend: "same" },
              b: { light: "yellow", trend: "same" },
              c: { light: "red", trend: "same" },
              d: { light: "green", trend: "same" },
            },
          },
          history: [],
        },
      ] as unknown as HealthCheck[],
    })
  );

  it("aggregates KPIs, predictability, and risk flags from synced entities", async () => {
    const r = (await registry.get("tool.health_dashboard.get_summary")!.handler({}, ctx())) as {
      sprints: { total: number; active: number; completed: number; predictability: number | null };
      stories: { total: number; done: number; completionPct: number | null };
      impediments: { total: number; open: number; critical: number };
      risks: { total: number; open: number; high: number };
      okrs: { total: number; avgProgress: number | null };
      healthCheck: { exists: boolean; healthPct: number | null };
      flags: string[];
    };

    expect(r.sprints).toMatchObject({ total: 3, active: 1, completed: 2, predictability: 50 });
    expect(r.stories).toMatchObject({ total: 4, done: 2, completionPct: 50 });
    expect(r.impediments).toMatchObject({ total: 2, open: 1, critical: 1 });
    expect(r.risks).toMatchObject({ total: 2, open: 1, high: 1 });
    expect(r.okrs).toMatchObject({ total: 1, avgProgress: 75 });
    expect(r.healthCheck).toMatchObject({ exists: true, healthPct: 63 });

    expect(r.flags).toContain("critical_impediments_open");
    expect(r.flags).toContain("high_risks_open");
    expect(r.flags).toContain("low_predictability");
    expect(r.flags).not.toContain("low_story_completion"); // 50 is not < 50
  });

  it("returns null KPIs on an empty workspace", async () => {
    useWorkspaceStore.setState({
      sprints: [],
      stories: [],
      impediments: [],
      risks: [],
      okrs: [],
      healthChecks: [],
    });
    const r = (await registry.get("tool.health_dashboard.get_summary")!.handler({}, ctx())) as {
      sprints: { predictability: number | null };
      stories: { completionPct: number | null };
      healthCheck: { exists: boolean };
      flags: string[];
    };
    expect(r.sprints.predictability).toBeNull();
    expect(r.stories.completionPct).toBeNull();
    expect(r.healthCheck.exists).toBe(false);
    expect(r.flags).toEqual([]);
  });
});
