/**
 * Health-dashboard KPIs computed from the SYNCED workspace entities.
 *
 * The dashboard's numbers come from lib/health-dashboard/kpis (moved there
 * from the page's synced-kpis.ts so the agent's get_summary runs the same
 * code): predictability ← sprints, team health ← saved health checks,
 * impediments, standup blockers ← standup entries, and cycle time ← the
 * Sprint and Flow boards (no longer the Cycle Time tool's device-local
 * store). Pure functions → unit-tested here; the page, the thresholds and
 * the agent parity are in test/tools/health-dashboard-upgrade.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { dashboardKpis, type HealthKpi } from "@/lib/health-dashboard/kpis";
import type { HealthKpiId } from "@/lib/health-dashboard/settings";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/flow";
import type {
  Sprint,
  HealthCheck,
  HealthCheckEntry,
  Impediment,
  StandupEntry,
  HealthDimensionScore,
} from "@/lib/stores/workspace-types";

const TODAY = todayLocalISO();
const sprint = (o: Partial<Sprint>): Sprint => o as Sprint;
const imp = (o: Partial<Impediment>): Impediment => o as Impediment;
const entry = (o: Partial<StandupEntry>): StandupEntry => o as StandupEntry;
const light = (l: HealthDimensionScore["light"]): HealthDimensionScore => ({
  light: l,
  trend: "same",
});
const scores = (...lights: HealthDimensionScore["light"][]) =>
  Object.fromEntries(
    ["Delivering Value", "Easy to Release", "Fun", "Health of Codebase"]
      .slice(0, lights.length)
      .map((d, i) => [d, light(lights[i])])
  ) as HealthCheckEntry["scores"];

const kpi = (id: HealthKpiId, src: Parameters<typeof dashboardKpis>[0]): HealthKpi =>
  dashboardKpis(src).find((k) => k.id === id)!;

describe("predictability (synced sprints)", () => {
  it("is empty when there are no finished sprints", () => {
    const r = kpi("predictability", {
      sprints: [sprint({ id: "s1", status: "active", pointsPlanned: 10 })],
      today: TODAY,
    });
    expect(r.value).toBeNull();
    expect(r.status).toBeNull();
    expect(r.hasData).toBe(false);
    expect(r.series).toEqual([]);
  });

  it("grades each pointed sprint's say/do and counts the ones that met it", () => {
    const sprints: Sprint[] = [
      sprint({
        id: "1",
        status: "completed",
        endDate: "2026-01-14",
        pointsPlanned: 10,
        pointsCompleted: 8,
      }),
      sprint({
        id: "2",
        status: "completed",
        endDate: "2026-01-28",
        pointsPlanned: 10,
        pointsCompleted: 10,
      }),
      sprint({
        id: "3",
        status: "completed",
        endDate: "2026-02-11",
        pointsPlanned: 10,
        pointsCompleted: 12,
      }),
      sprint({
        id: "4",
        status: "completed",
        endDate: "2026-02-25",
        pointsPlanned: 10,
        pointsCompleted: 9,
      }),
      // An active sprint is ignored.
      sprint({ id: "5", status: "active", pointsPlanned: 10, pointsCompleted: 0 }),
    ];
    const r = kpi("predictability", { sprints, today: TODAY });
    // 80% close, 100% met, 120% over, 90% met: 2 of 4 met (pass/fail said 2 of 4 too, for other reasons).
    expect(r.series).toEqual([80, 100, 120, 90]);
    expect(r.value).toBe(50);
    expect(r.detail).toContain("Velocity 10.3 points"); // the shared velocity: latest 3
  });
});

describe("team health (synced healthChecks singleton)", () => {
  it("is empty when there is no health check", () => {
    expect(kpi("team-health", { healthChecks: [], today: TODAY }).value).toBeNull();
  });

  it("ignores the `current` draft once anything has been saved", () => {
    // Regression lock: the Squad Health Check tool's `saveCheck()` archives
    // the scored snapshot into `history` and resets `current` to a pristine
    // ALL-GREEN form. `current` is a draft, never a measurement.
    const hc: HealthCheck = {
      id: "healthCheck:current",
      current: { sprintName: "", scores: scores("green", "green") },
      history: [{ id: "h1", sprintName: "S1", date: "2026-01-01", scores: scores("red", "red") }],
    };
    const r = kpi("team-health", { healthChecks: [hc], today: TODAY });
    expect(r.value).toBe(0); // the all-red check the user actually saved
    expect(r.series).toEqual([0]); // and no phantom 100 appended
    expect(r.detail).toBeUndefined(); // a single check has nothing to compare with
  });

  it("compares the latest saved check with the one before", () => {
    const hc: HealthCheck = {
      id: "healthCheck:current",
      current: { sprintName: "", scores: scores("green", "green") },
      history: [
        { id: "h1", sprintName: "S1", date: "2026-01-01", scores: scores("green", "red") },
        { id: "h2", sprintName: "S2", date: "2026-01-15", scores: scores("green", "green") },
      ],
    };
    const r = kpi("team-health", { healthChecks: [hc], today: TODAY });
    expect(r.value).toBe(100);
    expect(r.series).toEqual([50, 100]);
    expect(r.detail).toBe("Up 50 points since the check before.");
  });

  it("treats an all-red (0%) prior check as a valid baseline", () => {
    const hc: HealthCheck = {
      id: "healthCheck:current",
      current: { sprintName: "", scores: scores("green", "green") },
      history: [
        { id: "h1", sprintName: "S1", date: "2026-01-01", scores: scores("red", "red") },
        { id: "h2", sprintName: "S2", date: "2026-01-15", scores: scores("green", "green") },
      ],
    };
    const r = kpi("team-health", { healthChecks: [hc], today: TODAY });
    expect(r.value).toBe(100);
    expect(r.series).toEqual([0, 100]);
    expect(r.detail).toBe("Up 100 points since the check before.");
  });

  it("weights yellow as half: green 1, yellow ½, red 0", () => {
    const hc: HealthCheck = {
      id: "healthCheck:current",
      current: { sprintName: "", scores: scores("green") },
      history: [
        {
          id: "h1",
          sprintName: "S1",
          date: "2026-01-01",
          scores: scores("green", "yellow", "red", "green"),
        },
      ],
    };
    expect(kpi("team-health", { healthChecks: [hc], today: TODAY }).value).toBe(63);
  });

  it("no longer falls back to the unsaved draft (which starts all green)", () => {
    const hc: HealthCheck = {
      id: "healthCheck:current",
      current: { sprintName: "S1", scores: scores("green", "green", "red") },
      history: [],
    };
    const r = kpi("team-health", { healthChecks: [hc], today: TODAY });
    expect(r.value).toBeNull();
    expect(r.status).toBeNull();
    expect(r.basis).toMatch(/No saved health check yet/);
  });
});

describe("impediments (synced impediments)", () => {
  it("is empty when there are no impediments", () => {
    const r = kpi("open-impediments", { impediments: [], today: TODAY });
    expect(r.value).toBeNull();
    expect(r.status).toBeNull();
  });

  it("counts open (escalated too) and critical ones", () => {
    const imps: Impediment[] = [
      imp({ id: "1", severity: "critical", raisedAt: "2026-01-01", resolvedAt: "2026-01-03" }),
      imp({ id: "2", severity: "critical", raisedAt: "2026-01-01" }),
      imp({ id: "3", severity: "low", raisedAt: "2026-01-02", escalatedAt: "2026-01-04" }),
    ];
    expect(kpi("open-impediments", { impediments: imps, today: TODAY }).value).toBe(2);
    expect(kpi("critical-impediments", { impediments: imps, today: TODAY }).value).toBe(1);
  });
});

describe("standup blockers (synced standupEntries)", () => {
  it("is empty when there are no entries", () => {
    expect(kpi("open-blockers", { standupEntries: [], today: TODAY }).value).toBeNull();
  });

  it("counts unresolved recent blockers", () => {
    const entries: StandupEntry[] = [
      entry({ id: "1", member: "Ana", date: TODAY, blockers: "stuck", blockerResolved: false }),
      entry({ id: "2", member: "Ben", date: TODAY, blockers: "" }),
      entry({ id: "3", member: "Ana", date: TODAY, blockers: "old", blockerResolved: true }),
      // Outside the 7-day window: listed as older, not counted.
      entry({ id: "4", member: "Cy", date: addDays(TODAY, -20)!, blockers: "VPN" }),
    ];
    const r = kpi("open-blockers", { standupEntries: entries, today: TODAY });
    expect(r.value).toBe(1); // only #1
    expect(r.olderOpen).toBe(1);
  });
});
