/**
 * lib/releases: the gates that apply to a release (built-in, the team's
 * own, frozen at ship) and every ship, the reopened releases' earlier ones
 * included.
 */

import { describe, expect, it } from "vitest";
import type { Release, ReleaseReadiness } from "@/lib/stores/workspace-types";
import { RELEASE_GATE_IDS } from "@/lib/stores/workspace-types";
import { BUILT_IN_GATES, DOD_GATE, gatesOf, openGateCount, teamGates } from "@/lib/releases/gates";
import {
  onTimeRate,
  releaseStats,
  shipEvents,
  shippedBetween,
  wentOut,
} from "@/lib/releases/model";

const release = (over: Partial<Release> = {}): Release => ({
  id: "r1",
  name: "v1",
  plannedDate: "2026-10-10",
  status: "planning",
  gates: {},
  ...over,
});

describe("gates", () => {
  it("lists the built-ins until the team has its own list, without archived gates", () => {
    expect(teamGates(undefined).map((g) => g.id)).toEqual(RELEASE_GATE_IDS);
    const doc = {
      gates: [
        { id: "smoke", label: "Smoke test" },
        { id: "old", label: "Old", archived: true },
      ],
    };
    expect(teamGates(doc).map((g) => g.id)).toEqual(["smoke"]);
  });

  it("reads a shipped release by its frozen gates, a legacy one by the built-ins", () => {
    const doc = { gates: [{ id: "smoke", label: "Smoke test", archived: true }] };
    expect(
      gatesOf(release({ status: "shipped", gateIds: ["smoke", "dod_met", "gone"] }), doc)
    ).toEqual([
      { id: "smoke", label: "Smoke test", archived: true },
      DOD_GATE,
      { id: "gone", label: "gone" },
    ]);
    expect(gatesOf(release({ status: "shipped" }), doc).map((g) => g.id)).toEqual(RELEASE_GATE_IDS);
    expect(gatesOf(release(), doc)).toEqual([]);
  });

  it("counts a gate missing from a release as open", () => {
    expect(openGateCount(release({ gates: { a11y_audit: true } }), BUILT_IN_GATES)).toBe(8);
  });
});

describe("ship events", () => {
  const doc: ReleaseReadiness = {
    id: "releaseReadiness:current",
    releases: [
      release({
        id: "r1",
        status: "shipped",
        shippedDate: "2026-10-12",
        gates: Object.fromEntries(RELEASE_GATE_IDS.map((id) => [id, true])),
        previousShips: [
          { shippedDate: "2026-10-05", rolledBackAt: "2026-10-06", gatesOpenAtShip: 2 },
        ],
      }),
      release({
        id: "r2",
        name: "v2",
        plannedDate: "2026-10-20",
        status: "rolled_back",
        shippedDate: "2026-10-19",
        rolledBackAt: "2026-10-21",
      }),
      release({ id: "r3", name: "v3", status: "rolled_back" }), // never went out
      release({ id: "r4", name: "v4" }),
    ],
  };

  it("lists every time a release went out, oldest first", () => {
    const events = shipEvents(doc);
    expect(events.map((e) => [e.releaseId, e.shippedDate, e.rolledBack])).toEqual([
      ["r1", "2026-10-05", true],
      ["r1", "2026-10-12", false],
      ["r2", "2026-10-19", true],
    ]);
    expect(events[0].gatesOpen).toBe(2);
    expect(events[1].gatesOpen).toBe(0);
    expect(events[2].gatesOpen).toBe(9);
    expect(wentOut(doc.releases[2])).toBe(false);
    expect(shippedBetween(events, "2026-10-10", "2026-10-19").map((e) => e.shippedDate)).toEqual([
      "2026-10-12",
      "2026-10-19",
    ]);
  });

  it("rates on-time ships and keeps rolled-back ones in the stats", () => {
    const events = shipEvents(doc);
    expect(onTimeRate(events)).toEqual({
      pct: (2 / 3) * 100,
      shipped: 3,
      onTime: 2,
      rolledBack: 2,
    });
    const stats = releaseStats(doc);
    expect(stats.shipped).toBe(3);
    expect(stats.avgGatesOpen).toBeCloseTo((2 + 0 + 9) / 3);
    expect(stats.skippedByGate[0]).toEqual({ gateId: "a11y_audit", skipped: 2, of: 3 });
    expect(onTimeRate([])).toMatchObject({ pct: null, shipped: 0 });
  });
});
