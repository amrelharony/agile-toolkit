/**
 * tool.health_dashboard.* coverage.
 *
 * The dashboard's only state is the team's settings (healthDashboards /
 * HEALTH_DASHBOARD_ID); its numbers come from the synced entities through
 * lib/health-dashboard, the code the page runs (parity with the page is in
 * test/tools/health-dashboard-upgrade.test.tsx).
 *
 *   1. registration — get_summary is a read, set_thresholds a write.
 *   2. get_summary — the older roll-ups, the KPIs, flags from the thresholds.
 *   3. set_thresholds — validated like the page, only changes stored.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HealthCheck, HealthCheckEntry } from "@/lib/stores/workspace-types";
import { HEALTH_DASHBOARD_ID } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/health-dashboard";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const run = (id: string, params: unknown = {}) => registry.get(id)!.handler(params, ctx());

type Summary = {
  sprints: { total: number; active: number; completed: number; predictability: number | null };
  stories: { total: number; done: number; completionPct: number | null };
  impediments: { total: number; open: number; critical: number };
  risks: { total: number; open: number; high: number };
  okrs: { total: number; avgProgress: number | null };
  healthCheck: { exists: boolean; healthPct: number | null };
  flags: string[];
  kpis: { id: string; value: number | null; status: string | null; enough: boolean }[];
  overall: { score: number | null; counted: number };
  verdict: string;
  thresholds: Record<string, { green: number; amber: number }>;
  windows: { sprintWindow: number; blockerWindowDays: number; cycleWindowDays: number };
};

const lights = (l: Record<string, "green" | "yellow" | "red">) =>
  Object.fromEntries(
    Object.entries(l).map(([d, light]) => [d, { light, trend: "same" }])
  ) as unknown as HealthCheckEntry["scores"];

describe("tool.health_dashboard — registration", () => {
  it("get_summary is a read and set_thresholds a write, both with an mcpHandler", () => {
    expect(registry.get("tool.health_dashboard.get_summary")?.category).toBe("read");
    expect(registry.get("tool.health_dashboard.get_summary")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.health_dashboard.set_thresholds")?.category).toBe("write");
    expect(registry.get("tool.health_dashboard.set_thresholds")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.health_dashboard.get_summary", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      healthDashboards: [],
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
          id: "sp4",
          name: "S0",
          startDate: "2025-12-15",
          endDate: "2025-12-28",
          pointsPlanned: 20,
          pointsCompleted: 12,
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
        // Example rows never count.
        {
          id: "example-sp",
          name: "Example",
          startDate: "2026-01-01",
          endDate: "2026-01-14",
          pointsPlanned: 20,
          pointsCompleted: 20,
          status: "completed",
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
        { id: "example-i", title: "z", severity: "critical", raisedAt: "2026-01-03" },
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
          // The draft the Health Check page resets to after a save: all green.
          current: {
            sprintName: "",
            scores: lights({ "Delivering Value": "green", Fun: "green" }),
          },
          history: [
            {
              id: "h1",
              sprintName: "S2",
              date: "2026-01-28",
              scores: lights({
                "Delivering Value": "green",
                "Easy to Release": "yellow",
                Fun: "red",
                Speed: "green",
              }),
            },
          ],
        },
      ] as HealthCheck[],
      kanbanBoards: [],
      standupEntries: [],
      asyncUpdates: [],
    })
  );

  it("aggregates the roll-ups, the KPIs and the flags from the synced entities", async () => {
    const r = (await run("tool.health_dashboard.get_summary")) as Summary;

    // 22/20 met; 10/20 and 12/20 missed: 1 of 3 pointed sprints met their commitment.
    expect(r.sprints).toMatchObject({ total: 4, active: 1, completed: 3, predictability: 33 });
    expect(r.stories).toMatchObject({ total: 4, done: 2, completionPct: 50 });
    expect(r.impediments).toMatchObject({ total: 2, open: 1, critical: 1 });
    expect(r.risks).toMatchObject({ total: 2, open: 1, high: 1 });
    expect(r.okrs).toMatchObject({ total: 1, avgProgress: 75 });
    // The saved check (green 1, yellow ½, red 0: 2.5 of 4), never the all-green draft.
    expect(r.healthCheck).toMatchObject({ exists: true, healthPct: 63 });

    const byId = Object.fromEntries(r.kpis.map((k) => [k.id, k]));
    expect(byId.predictability).toMatchObject({ value: 33, status: "red", enough: true });
    expect(byId["team-health"]).toMatchObject({ value: 63, status: "amber" });
    expect(byId["critical-impediments"]).toMatchObject({ value: 1, status: "red" });
    expect(byId["open-blockers"]).toMatchObject({ value: null, status: null });

    expect(r.flags).toContain("critical_impediments_open");
    expect(r.flags).toContain("high_risks_open");
    expect(r.flags).toContain("low_predictability");
    expect(r.flags).toContain("low_team_health");
    expect(r.flags).not.toContain("low_story_completion"); // 50 is not < 50
    expect(r.verdict).toMatch(/KPIs need attention/);
    expect(r.thresholds.predictability).toEqual({ green: 80, amber: 60 });
  });

  it("flags follow the team's thresholds", async () => {
    useWorkspaceStore.setState({
      healthDashboards: [
        {
          id: HEALTH_DASHBOARD_ID,
          thresholds: {
            predictability: { green: 30, amber: 20 },
            "team-health": { green: 60, amber: 40 },
          },
        },
      ],
    });
    const r = (await run("tool.health_dashboard.get_summary")) as Summary;
    expect(r.flags).not.toContain("low_predictability");
    expect(r.flags).not.toContain("low_team_health");
    expect(r.thresholds.predictability).toEqual({ green: 30, amber: 20 });
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
    const r = (await run("tool.health_dashboard.get_summary")) as Summary;
    expect(r.sprints.predictability).toBeNull();
    expect(r.stories.completionPct).toBeNull();
    expect(r.healthCheck.exists).toBe(false);
    expect(r.flags).toEqual([]);
    expect(r.kpis.every((k) => k.value === null && k.status === null)).toBe(true);
    expect(r.overall).toMatchObject({ score: null, counted: 0 });
    expect(r.verdict).toBe("No KPI has enough data yet.");
  });
});

describe("tool.health_dashboard.set_thresholds", () => {
  beforeEach(() => useWorkspaceStore.setState({ healthDashboards: [] }));
  const stored = () =>
    (useWorkspaceStore.getState().healthDashboards ?? []).find((c) => c.id === HEALTH_DASHBOARD_ID);

  it("stores only what differs from the defaults", async () => {
    const r = (await run("tool.health_dashboard.set_thresholds", {
      thresholds: { "cycle-time-p85": { green: 5 } },
      blockerWindowDays: 14,
    })) as { saved: boolean; thresholds: Record<string, unknown> };
    expect(r.saved).toBe(true);
    expect(r.thresholds["cycle-time-p85"]).toEqual({ green: 5, amber: 14 });
    expect(stored()).toMatchObject({
      thresholds: { "cycle-time-p85": { green: 5, amber: 14 } },
      blockerWindowDays: 14,
    });
    expect(stored()?.thresholds?.predictability).toBeUndefined();
    expect(stored()?.sprintWindow).toBeUndefined();
  });

  it("refuses limits the page would refuse, and saves nothing", async () => {
    const r = (await run("tool.health_dashboard.set_thresholds", {
      thresholds: {
        predictability: { green: 50, amber: 70 },
        "team-health": { green: 120 },
        "open-blockers": { amber: 1.5 },
      },
      cycleWindowDays: 0,
    })) as { saved: boolean; errors: Record<string, string> };
    expect(r.saved).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual([
      "cycleWindowDays",
      "open-blockers.amber",
      "predictability.amber",
      "team-health.green",
    ]);
    expect(stored()).toBeUndefined();
  });

  it("merges over what is set, and reset goes back to the defaults", async () => {
    await run("tool.health_dashboard.set_thresholds", {
      thresholds: { predictability: { green: 90, amber: 70 } },
    });
    await run("tool.health_dashboard.set_thresholds", {
      thresholds: { "open-impediments": { amber: 5 } },
    });
    expect(stored()?.thresholds).toEqual({
      predictability: { green: 90, amber: 70 },
      "open-impediments": { green: 0, amber: 5 },
    });
    await run("tool.health_dashboard.set_thresholds", { reset: true });
    expect(stored()?.thresholds).toBeUndefined();
  });
});
