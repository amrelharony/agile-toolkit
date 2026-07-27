/**
 * Health-dashboard KPIs computed from the SYNCED workspace entities.
 *
 * These replace the dashboard UI's old per-tool localStorage extractors for the
 * four cards that have a synced source of truth (velocity←sprints, team-health
 * ←healthChecks, impediments, standup←standupEntries), so agent + cross-device
 * writes show up in the human dashboard. Cycle-time has no synced entity and
 * stays device-local (covered elsewhere). Pure functions → unit-tested here.
 */

import { describe, it, expect } from "vitest";
import {
  velocityKPIs,
  healthCheckKPIs,
  impedimentKPIs,
  standupKPIs,
} from "@/app/(tools)/health-dashboard/synced-kpis";
import { todayLocalISO } from "@/lib/utils/formatters";
import type {
  Sprint,
  HealthCheck,
  Impediment,
  StandupEntry,
  HealthDimensionScore,
} from "@/lib/stores/workspace-types";

const sprint = (o: Partial<Sprint>): Sprint => o as Sprint;
const imp = (o: Partial<Impediment>): Impediment => o as Impediment;
const entry = (o: Partial<StandupEntry>): StandupEntry => o as StandupEntry;
const light = (l: HealthDimensionScore["light"]): HealthDimensionScore => ({
  light: l,
  trend: "same",
});

describe("velocityKPIs (synced sprints)", () => {
  it("returns nulls when there are no completed sprints", () => {
    const r = velocityKPIs([sprint({ id: "s1", status: "active", pointsPlanned: 10 })]);
    expect(r.predictability).toBeNull();
    expect(r.avgVelocity).toBeNull();
    expect(r.series).toEqual([]);
    expect(r.trend).toBe("same");
  });

  it("computes predictability, avg velocity, series and trend over completed sprints", () => {
    const sprints: Sprint[] = [
      sprint({ id: "1", status: "completed", pointsPlanned: 10, pointsCompleted: 8 }),
      sprint({ id: "2", status: "completed", pointsPlanned: 10, pointsCompleted: 10 }),
      sprint({ id: "3", status: "completed", pointsPlanned: 10, pointsCompleted: 12 }),
      sprint({ id: "4", status: "completed", pointsPlanned: 10, pointsCompleted: 9 }),
      // active sprint is ignored
      sprint({ id: "5", status: "active", pointsPlanned: 10, pointsCompleted: 0 }),
    ];
    const r = velocityKPIs(sprints);
    expect(r.series).toEqual([8, 10, 12, 9]);
    expect(r.avgVelocity).toBeCloseTo(9.8, 5); // (8+10+12+9)/4 = 9.75 → 9.8
    expect(r.predictability).toBe(50); // 10>=10 and 12>=10 → 2 of 4
    expect(r.trend).toBe("up"); // [8,10]=9 vs [12,9]=10.5, diff +1.5
  });
});

describe("healthCheckKPIs (synced healthChecks singleton)", () => {
  it("returns null when there is no health check", () => {
    expect(healthCheckKPIs([]).healthPct).toBeNull();
  });

  it("computes weighted health pct from the current scores", () => {
    const hc: HealthCheck = {
      id: "healthCheck:current",
      current: {
        sprintName: "S1",
        scores: { a: light("green"), b: light("green"), c: light("red") } as never,
      },
      history: [],
    };
    const r = healthCheckKPIs([hc]);
    expect(r.healthPct).toBe(67); // (2+2+0)/6 = 0.666 → 67
    expect(r.trend).toBe("same");
  });

  it("ignores the `current` draft once anything has been saved", () => {
    // Regression lock: the Squad Health Check tool's `saveCheck()` archives
    // the scored snapshot into `history` and resets `current` to a pristine
    // ALL-GREEN form. Sourcing the headline from `current` therefore reported
    // 100% / "On Track" the instant a user saved an all-red check, pinned the
    // sparkline's last point at 100 and made the trend arrow always point up.
    // `current` is a draft, never a measurement — only saved checks count.
    const hc: HealthCheck = {
      id: "healthCheck:current",
      // What `saveCheck()` leaves behind: empty name, every dimension green.
      current: { sprintName: "", scores: { a: light("green"), b: light("green") } as never },
      history: [
        {
          id: "h1",
          sprintName: "S1",
          date: "2026-01-01",
          scores: { a: light("red"), b: light("red") } as never,
        },
      ],
    };
    const r = healthCheckKPIs([hc]);
    expect(r.healthPct).toBe(0); // the all-red check the user actually saved
    expect(r.series).toEqual([0]); // and no phantom 100 appended
    expect(r.trend).toBe("same"); // a single point has no trend
  });

  it("derives an upward trend across saved checks", () => {
    // The prior entry scores 50% (one green, one red), the latest 100%.
    // Going 50% → 100% is a real "up".
    const hc: HealthCheck = {
      id: "healthCheck:current",
      current: { sprintName: "", scores: { a: light("green"), b: light("green") } as never },
      history: [
        {
          id: "h1",
          sprintName: "S1",
          date: "2026-01-01",
          scores: { a: light("green"), b: light("red") } as never,
        },
        {
          id: "h2",
          sprintName: "S2",
          date: "2026-01-15",
          scores: { a: light("green"), b: light("green") } as never,
        },
      ],
    };
    const r = healthCheckKPIs([hc]);
    expect(r.healthPct).toBe(100);
    expect(r.trend).toBe("up"); // prev 50% → now 100%
    expect(r.series).toEqual([50, 100]);
  });

  it("treats an all-red (0%) prior entry as a valid baseline for the trend", () => {
    // Recovery from an all-red check is exactly the "up" the dashboard
    // should surface. The trend diff is a subtraction, so a 0% baseline is
    // well-defined; malformed/empty rows yield null from healthPctOf and
    // are skipped separately.
    const hc: HealthCheck = {
      id: "healthCheck:current",
      current: { sprintName: "", scores: { a: light("green"), b: light("green") } as never },
      history: [
        {
          id: "h1",
          sprintName: "S1",
          date: "2026-01-01",
          scores: { a: light("red"), b: light("red") } as never,
        },
        {
          id: "h2",
          sprintName: "S2",
          date: "2026-01-15",
          scores: { a: light("green"), b: light("green") } as never,
        },
      ],
    };
    const r = healthCheckKPIs([hc]);
    expect(r.healthPct).toBe(100);
    expect(r.trend).toBe("up"); // prev 0% → now 100%
    expect(r.series).toEqual([0, 100]);
  });

  it("falls back to `current` when nothing has been saved yet", () => {
    // Before the first save there is no measurement but the live form is
    // meaningful, so it still drives the card.
    const hc: HealthCheck = {
      id: "healthCheck:current",
      current: {
        sprintName: "S1",
        scores: { a: light("green"), b: light("green"), c: light("red") } as never,
      },
      history: [],
    };
    const r = healthCheckKPIs([hc]);
    expect(r.healthPct).toBe(67);
    expect(r.series).toEqual([67]);
    expect(r.trend).toBe("same");
  });
});

describe("impedimentKPIs (synced impediments)", () => {
  it("returns null when there are no impediments", () => {
    expect(impedimentKPIs([]).openCount).toBeNull();
  });

  it("counts open + critical and averages resolution days", () => {
    const imps: Impediment[] = [
      imp({ id: "1", severity: "critical", raisedAt: "2026-01-01", resolvedAt: "2026-01-03" }),
      imp({ id: "2", severity: "critical", raisedAt: "2026-01-01" }),
      imp({ id: "3", severity: "low", raisedAt: "2026-01-02" }),
    ];
    const r = impedimentKPIs(imps);
    expect(r.openCount).toBe(2); // #2, #3 unresolved
    expect(r.criticalCount).toBe(1); // only #2 is open + critical
    expect(r.avgResolutionDays).toBe(2); // #1 resolved in 2 days
  });
});

describe("standupKPIs (synced standupEntries)", () => {
  it("returns null when there are no entries", () => {
    expect(standupKPIs([], 4).openBlockers).toBeNull();
  });

  it("counts unresolved blockers and today's participation", () => {
    const today = todayLocalISO();
    const entries: StandupEntry[] = [
      entry({ id: "1", member: "Ana", date: today, blockers: "stuck", blockerResolved: false }),
      entry({ id: "2", member: "Ben", date: today, blockers: "" }),
      entry({ id: "3", member: "Ana", date: today, blockers: "old", blockerResolved: true }),
    ];
    const r = standupKPIs(entries, 4);
    expect(r.openBlockers).toBe(1); // only #1 (non-empty + unresolved)
    expect(r.participationRate).toBe(50); // distinct today {Ana,Ben}=2 of 4 members
  });
});
