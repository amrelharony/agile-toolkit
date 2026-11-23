/**
 * Meeting times: the burden of a meeting's worst minute on each person's
 * clock, the ranking (the past skipped, the cap), answers filled from hours,
 * tallies and the best slot, and the Quick Vote labels (UTC, 30 characters
 * at most, 12 at most).
 */

import { describe, expect, it } from "vitest";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import {
  QUICK_VOTE_SLOTS,
  RANKED_SLOTS_MAX,
  bestSlot,
  burden,
  fillFromHours,
  quickVoteLabels,
  rankSlots,
  tallies,
} from "@/lib/team-time/slots";
import { LINK_OPTION_CHARS } from "@/lib/quick-vote/link";
import type { TeamTimePoll } from "@/lib/stores/workspace-types";
import { AT, london, newYork, person, t, tokyo } from "./fixtures";

const hour = (start: string, minutes = 60) => [t(start), t(start) + minutes * 60_000] as const;

describe("burden", () => {
  it("is 0 in hours, 1 early or late, 2 at night or on a day off", () => {
    expect(burden(london, ...hour("2026-11-16T10:00:00Z"))).toBe(0);
    expect(burden(london, ...hour("2026-11-16T08:00:00Z"))).toBe(1);
    expect(burden(london, ...hour("2026-11-16T17:00:00Z"))).toBe(1);
    expect(burden(london, ...hour("2026-11-16T06:00:00Z"))).toBe(2);
    expect(burden(london, ...hour("2026-11-16T21:30:00Z"))).toBe(2);
    expect(burden(london, ...hour("2026-11-21T12:00:00Z"))).toBe(2);
  });

  it("counts a night shift's hours past midnight as in hours", () => {
    const night = person({ id: "n", timeZone: "Europe/London", start: "22:00", end: "06:00" });
    expect(burden(night, ...hour("2026-11-21T03:00:00Z"))).toBe(0);
    expect(burden(night, ...hour("2026-11-21T12:00:00Z"))).toBe(2);
    expect(burden(night, ...hour("2026-11-17T12:00:00Z"))).toBe(1);
  });
});

describe("rankSlots", () => {
  it("ranks the times everyone is in hours first, the earliest first, never in the past", () => {
    const ranked = rankSlots([london, newYork], {
      minutes: 60,
      from: t("2026-11-16T10:10:00Z"),
      days: 1,
    });
    expect(ranked.slice(0, 6).map((s) => s.start.slice(11, 16))).toEqual([
      "14:00",
      "14:30",
      "15:00",
      "15:30",
      "16:00",
      "16:30",
    ]);
    expect(ranked[0]).toMatchObject({ night: 0, outside: 0, burdens: { london: 0, ny: 0 } });
    expect(ranked.every((s) => t(s.start) >= t("2026-11-16T10:10:00Z"))).toBe(true);
    // Then fewest at night, then fewest early or late.
    const keys = ranked.map((s) => s.night * 100 + s.outside);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
  });

  it("returns at most 20, and nothing without people", () => {
    const ranked = rankSlots([london, newYork, tokyo], {
      minutes: 30,
      from: t(AT),
      days: 14,
    });
    expect(ranked).toHaveLength(RANKED_SLOTS_MAX);
    expect(rankSlots([], { minutes: 30, from: t(AT) })).toEqual([]);
  });
});

const poll = (over: Partial<TeamTimePoll> = {}): TeamTimePoll => ({
  id: "p1",
  title: "Review",
  minutes: 60,
  slots: [
    { id: "a", start: "2026-11-17T10:00:00.000Z" },
    { id: "b", start: "2026-11-17T15:00:00.000Z" },
  ],
  answers: [],
  status: "open",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

describe("answers and tallies", () => {
  it("fills each person's missing picks from their hours, keeping what's recorded", () => {
    const names = new Map([
      ["london", "Lou"],
      ["ny", "Noor"],
    ]);
    const filled = fillFromHours(
      poll({ answers: [{ name: "lou", picks: { a: "no" } }] }),
      [london, newYork],
      names
    );
    expect(filled).toEqual([
      { name: "lou", picks: { a: "no", b: "yes" } },
      { name: "Noor", picks: { a: "no", b: "yes" } },
    ]);
  });

  it("tallies yes, if needed and no, and picks the slot most can make", () => {
    const p = poll({
      answers: [
        { name: "Lou", picks: { a: "yes", b: "yes" } },
        { name: "Noor", picks: { a: "no", b: "maybe" } },
        { name: "Taro", picks: { a: "yes", b: "yes" } },
      ],
    });
    expect(tallies(p)).toEqual({
      a: { yes: 2, maybe: 0, no: 1 },
      b: { yes: 2, maybe: 1, no: 0 },
    });
    expect(bestSlot(p)).toBe("b");
    expect(bestSlot(poll())).toBeNull();
  });

  it("breaks a tie by the earliest time", () => {
    const p = poll({ answers: [{ name: "Lou", picks: { a: "yes", b: "yes" } }] });
    expect(bestSlot(p)).toBe("a");
  });
});

describe("Quick Vote labels", () => {
  it("sends at most the 12 options a live round takes, each in UTC and short enough", () => {
    expect(QUICK_VOTE_SLOTS).toBe(VOTE_LIMITS.maxChoiceOptions);
    const slots = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      start: new Date(t("2026-11-17T09:00:00Z") + i * 3_600_000).toISOString(),
    }));
    const labels = quickVoteLabels(poll({ slots }));
    expect(labels).toHaveLength(12);
    expect(labels[0]).toBe("Tue 17 Nov 09:00 UTC");
    for (const l of labels) expect(l.length).toBeLessThanOrEqual(LINK_OPTION_CHARS);
  });
});
