/**
 * Rotations: the occurrence of each cycle on its option's clock, In turn
 * against Fairest, a skip that keeps the turn, holidays skipped, a meeting
 * that started less than a day ago still listed, the totals and the
 * fairness line, and the held cap.
 */

import { describe, expect, it } from "vitest";
import {
  burdenTotals,
  cycleOf,
  fairnessLine,
  nextOccurrences,
  rotationAttendees,
} from "@/lib/team-time/rotation";
import { withHeld } from "@/lib/team-time/model";
import { TEAM_TIME_MAX, type TeamTimeRotation } from "@/lib/stores/workspace-types";
import { AT, london, newYork, t } from "./fixtures";

/** A: Tuesday 09:00 London (04:00 in New York). B: Tuesday 15:00 New York (20:00 in London). */
const rotation = (over: Partial<TeamTimeRotation> = {}): TeamTimeRotation => ({
  id: "r1",
  meeting: "Retro",
  minutes: 60,
  everyWeeks: 1,
  startDate: "2026-11-16",
  mode: "in-turn",
  options: [
    { id: "A", weekday: 2, time: "09:00", timeZone: "Europe/London" },
    { id: "B", weekday: 2, time: "15:00", timeZone: "America/New_York" },
  ],
  held: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const people = [london, newYork];
const FROM = t("2026-11-16T00:00:00Z");
const plan = (r: TeamTimeRotation, from = FROM, opts = {}) =>
  nextOccurrences(r, people, from, 4, opts).map((o) => `${o.date} ${o.optionId}`);

describe("occurrences", () => {
  it("puts each cycle's meeting on its option's weekday, at its time on its clock", () => {
    const [first] = nextOccurrences(rotation(), people, FROM, 1);
    expect(first).toMatchObject({
      cycle: 0,
      date: "2026-11-17",
      optionId: "A",
      start: "2026-11-17T09:00:00.000Z",
      end: "2026-11-17T10:00:00.000Z",
      burdens: { london: 0, ny: 2 },
    });
    expect(cycleOf(rotation({ everyWeeks: 2 }), "2026-11-30")).toBe(1);
  });

  it("goes round the options in turn", () => {
    expect(plan(rotation())).toEqual([
      "2026-11-17 A",
      "2026-11-24 B",
      "2026-12-01 A",
      "2026-12-08 B",
    ]);
  });

  it("picks the fairest option, the in-turn order breaking ties", () => {
    // B first (Lou early or late beats Noor at night), then a tie the turn
    // breaks (A), then whichever keeps the worst-off total lowest.
    expect(plan(rotation({ mode: "fairest" }))).toEqual([
      "2026-11-17 B",
      "2026-11-24 A",
      "2026-12-01 B",
      "2026-12-08 B",
    ]);
  });

  it("goes on after the last held meeting, with the next option", () => {
    const held = rotation({ held: [{ date: "2026-11-17", optionId: "A" }] });
    expect(plan(held)[0]).toBe("2026-11-24 B");
  });

  it("keeps the turn after a skipped meeting", () => {
    const skipped = rotation({ held: [{ date: "2026-11-17", optionId: "A", skipped: true }] });
    expect(plan(skipped)[0]).toBe("2026-11-24 A");
  });

  it("skips a team holiday, keeping the turn", () => {
    expect(plan(rotation(), FROM, { holidays: ["2026-11-24"] })).toEqual([
      "2026-11-17 A",
      "2026-12-01 B",
      "2026-12-08 A",
      "2026-12-15 B",
    ]);
  });

  it("still lists a meeting that started less than a day ago, then drops it", () => {
    expect(plan(rotation(), t("2026-11-17T12:00:00Z"))[0]).toBe("2026-11-17 A");
    expect(plan(rotation(), t("2026-11-18T12:00:00Z"))[0]).toBe("2026-11-24 A");
  });

  it("counts its attendees only, everyone when it names none", () => {
    expect(rotationAttendees(rotation(), people).map((p) => p.id)).toEqual(["london", "ny"]);
    expect(rotationAttendees(rotation({ attendees: ["ny"] }), people).map((p) => p.id)).toEqual([
      "ny",
    ]);
  });
});

describe("totals", () => {
  it("adds the held and planned points per attendee, and the spread", () => {
    const r = rotation({ held: [{ date: "2026-11-10", optionId: "A" }], startDate: "2026-11-09" });
    const totals = burdenTotals(r, people, FROM, 2);
    // Held A (London 0, New York 2), then B (1, 0) and A (0, 2).
    expect(totals.totals).toEqual([
      { personId: "london", points: 1 },
      { personId: "ny", points: 4 },
    ]);
    expect(totals.total).toBe(5);
    expect(totals.spread).toBe(3);
    const names = { london: "Lou", ny: "Noor" } as Record<string, string>;
    expect(
      fairnessLine(
        totals,
        (id) => names[id],
        () => "New York"
      )
    ).toBe("Noor carries 4 of 5 late or night points. Add a time that suits New York.");
  });

  it("says when the points are shared, or when there are none", () => {
    const shared = {
      totals: [
        { personId: "a", points: 2 },
        { personId: "b", points: 2 },
      ],
      total: 4,
      spread: 0,
    };
    expect(
      fairnessLine(
        shared,
        (id) => id,
        () => ""
      )
    ).toBe("The late and night calls are shared: the most anyone carries is 2 of 4 points.");
    expect(
      fairnessLine(
        { totals: [], total: 0, spread: 0 },
        (id) => id,
        () => ""
      )
    ).toBe("Every meeting falls in everyone's working hours.");
  });
});

describe("withHeld", () => {
  it("marks a meeting held or skipped, the newest 52 kept", () => {
    const r = rotation({
      held: Array.from({ length: TEAM_TIME_MAX.held }, (_, i) => ({
        date: `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
        optionId: "A",
      })),
    });
    const next = withHeld(r, { date: "2026-11-17", optionId: "B" }, true, AT);
    expect(next.held).toHaveLength(TEAM_TIME_MAX.held);
    expect(next.held.at(-1)).toEqual({ date: "2026-11-17", optionId: "B", skipped: true });
  });
});
