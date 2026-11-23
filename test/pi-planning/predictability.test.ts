// @vitest-environment node
/**
 * PI predictability (lib/pi-planning/predictability): planned value is the
 * committed objectives' business value, actual value counts every
 * objective; a team reads "Not scored yet" until everything it planned is
 * scored; the band defaults to 80–100%; the train's total covers the scored
 * teams; a closed PI keeps the scored teams; the average needs three.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BAND, type PiObjective, type PiState } from "@/lib/pi-planning/model";
import {
  HISTORY_AVERAGE_MIN,
  bandOf,
  bandStatus,
  historyAverage,
  piPredictability,
  predictabilityVerdict,
  recordFrom,
  recordPct,
  teamPctText,
  teamPredictability,
} from "@/lib/pi-planning/predictability";

const obj = (id: string, teamId: string, over: Partial<PiObjective> = {}): PiObjective => ({
  id,
  teamId,
  title: id,
  committed: true,
  ...over,
});

const board = (objectives: PiObjective[], over: Partial<PiState> = {}): PiState => ({
  teams: [
    { id: "a", name: "Checkout" },
    { id: "b", name: "Payments" },
    { id: "c", name: "Mobile" },
  ],
  items: [],
  iterations: 5,
  objectives,
  ...over,
});

describe("a team's predictability", () => {
  it("plans committed objectives only, and counts every objective's actual", () => {
    const s = board([
      obj("o1", "a", { businessValue: 9, actualBusinessValue: 8 }),
      obj("o2", "a", { businessValue: 7, actualBusinessValue: 5 }),
      // A stretch goal: not in the plan, but what it delivered counts.
      obj("o3", "a", { committed: false, businessValue: 5, actualBusinessValue: 2 }),
    ]);
    expect(teamPredictability(s, s.teams[0])).toEqual({
      teamId: "a",
      name: "Checkout",
      plannedBv: 16,
      actualBv: 15,
      toScore: 0,
      pct: 94,
      status: "within",
    });
  });

  it("reads a stretch goal met as above the band", () => {
    const s = board([
      obj("o1", "a", { businessValue: 5, actualBusinessValue: 5 }),
      obj("o2", "a", { committed: false, businessValue: 4, actualBusinessValue: 4 }),
    ]);
    expect(teamPredictability(s, s.teams[0])).toMatchObject({ pct: 180, status: "above" });
  });

  it("says nothing is scored until a committed objective has a business value", () => {
    const s = board([
      obj("o1", "a"),
      obj("o2", "a", { committed: false, businessValue: 6, actualBusinessValue: 6 }),
    ]);
    const t = teamPredictability(s, s.teams[0]);
    expect(t).toMatchObject({ plannedBv: 0, pct: null, status: "nothing-planned" });
    expect(teamPctText(t)).toBe("Not scored yet");
  });

  it("waits for every planned objective's actual, never reading a half-scored team as low", () => {
    const s = board([
      obj("o1", "a", { businessValue: 9, actualBusinessValue: 8 }),
      obj("o2", "a", { businessValue: 7 }),
    ]);
    const t = teamPredictability(s, s.teams[0]);
    expect(t).toMatchObject({
      plannedBv: 16,
      actualBv: 8,
      toScore: 1,
      pct: null,
      status: "to-score",
    });
    expect(teamPctText(t)).toBe("1 objective to score");
  });

  it("scores an actual of 0 as delivered nothing", () => {
    const s = board([obj("o1", "a", { businessValue: 6, actualBusinessValue: 0 })]);
    expect(teamPredictability(s, s.teams[0])).toMatchObject({ pct: 0, status: "below" });
  });
});

describe("the band", () => {
  it("defaults to the common aim, and uses the train's own when set", () => {
    expect(bandOf({})).toEqual(DEFAULT_BAND);
    expect(DEFAULT_BAND).toEqual({ low: 80, high: 100 });
    expect(bandOf({ band: { low: 70, high: 90 } })).toEqual({ low: 70, high: 90 });
  });

  it("places a percentage below, within or above it, ends included", () => {
    const band = { low: 80, high: 100 };
    expect([79, 80, 100, 101].map((p) => bandStatus(p, band))).toEqual([
      "below",
      "within",
      "within",
      "above",
    ]);
  });

  it("moves a team's status with the band", () => {
    const s = board([obj("o1", "a", { businessValue: 10, actualBusinessValue: 7 })], {
      band: { low: 60, high: 90 },
    });
    expect(teamPredictability(s, s.teams[0]).status).toBe("within");
  });
});

describe("the train's total", () => {
  const s = board([
    obj("o1", "a", { businessValue: 9, actualBusinessValue: 8 }),
    obj("o2", "a", { businessValue: 7, actualBusinessValue: 5 }),
    obj("o3", "a", { committed: false, businessValue: 5, actualBusinessValue: 2 }),
    obj("o4", "b", { businessValue: 8, actualBusinessValue: 6 }),
    obj("o5", "b"),
    obj("o6", "c", { businessValue: 6 }),
  ]);

  it("adds up the scored teams only", () => {
    const p = piPredictability(s);
    expect(p.teams.map((t) => t.pct)).toEqual([94, 75, null]);
    expect(p.total).toEqual({ plannedBv: 24, actualBv: 21, pct: 88, status: "within", teams: 2 });
  });

  it("is null while no team is scored", () => {
    expect(piPredictability(board([obj("o1", "a", { businessValue: 3 })])).total).toBeNull();
  });

  it("says it in one sentence, with the team still to score", () => {
    expect(predictabilityVerdict(piPredictability(s))).toBe(
      "Checkout 94% and Payments 75% against an aim of 80–100%; the train 88%. Mobile has 1 objective to score."
    );
    expect(predictabilityVerdict(piPredictability(board([])))).toMatch(/^Not scored yet/);
    expect(predictabilityVerdict(piPredictability(board([], { teams: [] })))).toBe(
      "No teams on the board yet."
    );
  });
});

describe("closed PIs", () => {
  const s = board([
    obj("o1", "a", { businessValue: 10, actualBusinessValue: 9 }),
    obj("o2", "b", { businessValue: 5 }),
  ]);

  it("keep the scored teams, under the PI's name", () => {
    const r = recordFrom(s, { id: "h1", name: "PI 2026.4", closedAt: "2026-11-23T10:00:00Z" });
    expect(r).toEqual({
      id: "h1",
      name: "PI 2026.4",
      closedAt: "2026-11-23T10:00:00Z",
      teams: [{ teamId: "a", name: "Checkout", plannedBv: 10, actualBv: 9 }],
    });
    expect(recordPct(r!)).toBe(90);
  });

  it("can't be made from a PI with nothing scored", () => {
    expect(recordFrom(board([]), { id: "h", name: "x", closedAt: "2026-11-23" })).toBeNull();
    expect(recordPct({ teams: [] })).toBeNull();
  });

  it("average from three of them, with no trend read", () => {
    const rec = (id: string, planned: number, actual: number) => ({
      id,
      name: id,
      closedAt: "2026-01-01",
      teams: [{ teamId: "a", name: "A", plannedBv: planned, actualBv: actual }],
    });
    expect(HISTORY_AVERAGE_MIN).toBe(3);
    expect(historyAverage([rec("1", 10, 8), rec("2", 10, 9)])).toBeNull();
    expect(historyAverage(undefined)).toBeNull();
    expect(historyAverage([rec("1", 10, 8), rec("2", 10, 9), rec("3", 10, 10)])).toEqual({
      pct: 90,
      count: 3,
    });
    // A record that planned nothing has no number, and doesn't count toward the three.
    expect(historyAverage([rec("1", 10, 8), rec("2", 0, 0), rec("3", 10, 10)])).toBeNull();
  });
});
