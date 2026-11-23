// @vitest-environment node
/**
 * The Emotional Seismograph's rules (lib/retro/seismograph): the days a
 * board draws (with and without a sprint, capped at 31), the moments it
 * charts (the team's own cards, groups folded), where they sit, the team's
 * mood on its own scale (no examples, no placeholders, only days with 3
 * check-ins), the plain read, the format and its Markdown.
 */

import { describe, expect, it } from "vitest";
import { retroFormats } from "@/lib/constants/retro-formats";
import {
  SEISMOGRAPH_FORMAT_ID,
  isCardDay,
  isSeismograph,
  momentCards,
  placedCards,
  seismographDays,
  seismographMarkdown,
  seismographRead,
  shortDate,
  teamMoodLine,
  type MoodPoint,
} from "@/lib/retro/seismograph";
import type { RetroCard } from "@/app/(tools)/retro/types";
import { toMarkdown } from "@/app/(tools)/retro/markdown";
import { buildExportJson } from "@/app/(tools)/retro/helpers";
import { exampleId } from "@/lib/utils/example-id";
import type { MoodEntry, MoodPulse, Sprint } from "@/lib/stores/workspace-types";

const SEISMO = retroFormats.find((f) => f.id === SEISMOGRAPH_FORMAT_ID)!;

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s1",
  name: "Sprint 12",
  startDate: "2026-11-09",
  endDate: "2026-11-20",
  pointsPlanned: 20,
  status: "completed",
  ...over,
});

let n = 0;
function card(over: Partial<RetroCard> = {}): RetroCard {
  n += 1;
  return {
    id: `c${n}`,
    columnKey: "lows",
    text: `Card ${n}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...over,
  };
}

describe("the format", () => {
  it("is the last of the built-in formats, with Highs, Steady and Lows", () => {
    expect(retroFormats[0].id).toBe("start-stop-continue");
    expect(retroFormats[retroFormats.length - 1]).toBe(SEISMO);
    expect(SEISMO.name).toBe("Emotional Seismograph");
    expect(SEISMO.columns.map((c) => [c.key, c.label, c.icon])).toEqual([
      ["highs", "Highs", "▲"],
      ["steady", "Steady", "–"],
      ["lows", "Lows", "▼"],
    ]);
  });

  it("is a seismograph board only with its id and its three columns", () => {
    expect(isSeismograph({ format: SEISMO })).toBe(true);
    expect(isSeismograph({ format: { ...SEISMO, columns: SEISMO.columns.slice(0, 2) } })).toBe(
      false
    );
    expect(isSeismograph({ format: retroFormats[0] })).toBe(false);
    expect(isSeismograph(null)).toBe(false);
  });

  it("takes a whole day from 0 to 30", () => {
    expect([0, 30, 7].every(isCardDay)).toBe(true);
    expect([-1, 31, 2.5, "3", null].some(isCardDay)).toBe(false);
  });
});

describe("seismographDays", () => {
  it("with a sprint, runs Day 0 to its last day, each with its date", () => {
    const days = seismographDays(sprint());
    expect(days).toHaveLength(12);
    expect(days[0]).toEqual({ day: 0, date: "2026-11-09", label: "Day 0 · Mon 9 Nov" });
    expect(days[3].label).toBe("Day 3 · Thu 12 Nov");
    expect(days[11].date).toBe("2026-11-20");
  });

  it("with none, runs Day 0–9 without dates", () => {
    const days = seismographDays(null);
    expect(days.map((d) => d.label)).toEqual(Array.from({ length: 10 }, (_, i) => `Day ${i}`));
    expect(days.every((d) => d.date === null)).toBe(true);
  });

  it("stops at 31 days, Day 30, for a long sprint", () => {
    const days = seismographDays(sprint({ endDate: "2027-01-31" }));
    expect(days).toHaveLength(31);
    expect(days[30].day).toBe(30);
  });

  it("names a date as that calendar day wherever the reader is", () => {
    expect(shortDate("2026-11-12")).toBe("Thu 12 Nov");
  });
});

describe("momentCards", () => {
  it("leaves out action items, carried actions and cards from other tools", () => {
    const mine = card({ text: "Release went out" });
    const moments = momentCards([
      mine,
      card({ isActionItem: true }),
      card({ carriedFrom: "old-1" }),
      card({ sourceRef: { tool: "root-cause", id: "rca_1" } }),
      card({ sourceRef: { tool: "kudos", id: "k1" }, columnKey: "highs" }),
    ]);
    expect(moments.map((m) => m.id)).toEqual([mine.id]);
  });

  it("folds a group into its top card: one moment, its votes added in, at its day", () => {
    const top = card({ columnKey: "highs", votes: 2, day: 3 });
    const child = card({ columnKey: "highs", votes: 1, groupedWith: top.id, day: 7 });
    const grandchild = card({ columnKey: "highs", votes: 4, groupedWith: child.id });
    const moments = momentCards([top, child, grandchild]);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({
      id: top.id,
      band: "highs",
      day: 3,
      votes: 7,
      groupIds: [child.id, grandchild.id],
    });
  });

  it("charts no group whose top card doesn't chart, and survives a grouping loop", () => {
    const action = card({ isActionItem: true });
    const under = card({ groupedWith: action.id });
    const a = card({ id: "loop-a", groupedWith: "loop-b" });
    const b = card({ id: "loop-b", groupedWith: "loop-a" });
    expect(momentCards([action, under])).toEqual([]);
    expect(() => momentCards([a, b])).not.toThrow();
  });

  it("drops a day that isn't a whole number in range", () => {
    expect(momentCards([card({ day: 2.5 })])[0].day).toBeUndefined();
    expect(momentCards([card({ day: 40 })])[0].day).toBeUndefined();
  });
});

describe("placedCards", () => {
  it("sorts moments by day and band, stacks the ones that share both, and keeps the rest", () => {
    const days = seismographDays(null);
    const low1 = card({ day: 4 });
    const high = card({ columnKey: "highs", day: 4 });
    const low2 = card({ day: 4 });
    const none = card({ columnKey: "steady" });
    const placement = placedCards(momentCards([low1, high, low2, none]), days);
    expect(placement.placed.map((m) => [m.id, m.day, m.band, m.stack])).toEqual([
      [high.id, 4, "highs", 0],
      [low1.id, 4, "lows", 0],
      [low2.id, 4, "lows", 1],
    ]);
    expect(placement.unplaced.map((m) => m.id)).toEqual([none.id]);
  });

  it("keeps a day past the board's last day as unplaced, with its day", () => {
    const late = card({ day: 15 });
    const placement = placedCards(momentCards([late]), seismographDays(null));
    expect(placement.placed).toEqual([]);
    expect(placement.unplaced[0]).toMatchObject({ id: late.id, day: 15 });
  });
});

describe("teamMoodLine", () => {
  const entry = (date: string, score: MoodEntry["score"], over: Partial<MoodEntry> = {}) =>
    ({ id: `m-${Math.random()}`, memberId: "p1", date, score, ...over }) as MoodEntry;
  const pulse = (date: string, counts: Partial<MoodPulse["counts"]>, id = `p-${date}`) =>
    ({
      id,
      date,
      counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...counts },
      source: "facilitator",
      createdAt: `${date}T09:00:00.000Z`,
    }) as MoodPulse;

  it("shows only days with 3 check-ins, named and anonymous together, never names", () => {
    const line = teamMoodLine(
      [entry("2026-11-10", 2), entry("2026-11-10", 2), entry("2026-11-11", 5)],
      [pulse("2026-11-10", { 1: 1 }), pulse("2026-11-12", { 4: 2 })],
      sprint()
    );
    expect(line).toEqual([{ day: 1, date: "2026-11-10", average: 5 / 3, n: 3 }]);
    expect(JSON.stringify(line)).not.toContain("p1");
  });

  it("leaves out example and placeholder rows", () => {
    const line = teamMoodLine(
      [
        entry("2026-11-10", 1, { id: exampleId("m1") }),
        entry("2026-11-10", 1, { isPlaceholder: true }),
        entry("2026-11-10", 4),
      ],
      [pulse("2026-11-10", { 4: 2 }), pulse("2026-11-10", { 1: 9 }, exampleId("p"))],
      sprint()
    );
    expect(line).toEqual([{ day: 1, date: "2026-11-10", average: 4, n: 3 }]);
  });

  it("is empty without a sprint", () => {
    expect(teamMoodLine([entry("2026-11-10", 4)], [], null)).toEqual([]);
  });
});

describe("seismographRead", () => {
  const read = (cards: RetroCard[], mood: MoodPoint[] = []) =>
    seismographRead(placedCards(momentCards(cards), seismographDays(sprint())), mood);

  it("says where most lows bunch", () => {
    const lines = read([
      card({ day: 7 }),
      card({ day: 8 }),
      card({ day: 9 }),
      card({ day: 1 }),
      card({ day: 3 }),
    ]);
    expect(lines).toContain("3 of 5 lows came on days 7–9.");
    expect(read([card({ day: 2 }), card({ day: 2 }), card({ day: 2 })])).toContain(
      "3 of 3 lows came on day 2."
    );
    // Spread out: no bunch to name.
    expect(read([card({ day: 0 }), card({ day: 5 }), card({ day: 10 })])).toEqual([]);
  });

  it("names the days with both a high and a low", () => {
    expect(read([card({ day: 4 }), card({ columnKey: "highs", day: 4 })])).toEqual([
      "Day 4 had both a high and a low.",
    ]);
    expect(
      read([
        card({ day: 4 }),
        card({ columnKey: "highs", day: 4 }),
        card({ day: 6 }),
        card({ columnKey: "highs", day: 6 }),
      ])
    ).toContain("Days 4 and 6 had both a high and a low.");
  });

  it("asks about a day the mood dipped with no card on it", () => {
    const mood: MoodPoint[] = [
      { day: 6, date: "2026-11-15", average: 2.2, n: 3 },
      { day: 2, date: "2026-11-11", average: 2, n: 4 },
      { day: 3, date: "2026-11-12", average: 4, n: 3 },
    ];
    expect(read([card({ day: 2 })], mood)).toEqual([
      "The team's mood dipped on day 6 and no card says why: ask about it.",
    ]);
  });

  it("says three lines at most", () => {
    const cards = [
      card({ day: 7 }),
      card({ day: 8 }),
      card({ day: 8 }),
      card({ columnKey: "highs", day: 8 }),
      card({ columnKey: "highs", day: 1 }),
      card({ columnKey: "highs", day: 1 }),
      card({ columnKey: "highs", day: 2 }),
    ];
    const mood: MoodPoint[] = [{ day: 5, date: "2026-11-14", average: 1.5, n: 3 }];
    const lines = read(cards, mood);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("3 of 3 lows came on days 7–8.");
  });
});

describe("the Markdown", () => {
  it("adds a Seismograph section day by day, with the mood, the read and the cards with no day", () => {
    const cards = [
      card({ columnKey: "highs", text: "Shipped the search", day: 3, votes: 2 }),
      card({ text: "Outage", day: 3 }),
      card({ columnKey: "steady", text: "Pairing all week" }),
    ];
    const days = seismographDays(sprint());
    const mood: MoodPoint[] = [{ day: 5, date: "2026-11-14", average: 2.4, n: 3 }];
    const lines = seismographMarkdown(placedCards(momentCards(cards), days), days, mood);
    expect(lines).toContain("## Seismograph");
    expect(lines).toContain("- Day 3 (Thu 12 Nov): ▲ Shipped the search (2 votes); ▼ Outage");
    expect(lines).toContain("- Day 5 (Sat 14 Nov): team mood 2.4");
    expect(lines).toContain("> Day 3 had both a high and a low.");
    expect(lines).toContain("No day: – Pairing all week");
  });

  it("is in the board's Markdown only on a seismograph board", () => {
    const cards = [card({ text: "Outage", day: 2 })];
    expect(toMarkdown({ format: SEISMO, cards })).toContain("## Seismograph");
    expect(toMarkdown({ format: SEISMO, cards })).toContain("- Day 2: ▼ Outage");
    const other = { ...retroFormats[0] };
    expect(
      toMarkdown({ format: other, cards: [{ ...cards[0], columnKey: "stop" }] })
    ).not.toContain("Seismograph");
    // A room's board has no days yet: no section until the host places one.
    expect(toMarkdown({ format: SEISMO, cards: [card()] })).not.toContain("## Seismograph");
  });

  it("keeps a card's day in the JSON export only on a seismograph board", () => {
    const cards = [card({ day: 4 })];
    const json = buildExportJson({ format: SEISMO, cards });
    expect(json.columns.find((c) => c.label === "Lows")?.cards[0]).toMatchObject({ day: 4 });
    const other = buildExportJson({
      format: retroFormats[0],
      cards: [{ ...cards[0], columnKey: "stop" }],
    });
    expect(other.columns.find((c) => c.label === "Stop")?.cards[0]).not.toHaveProperty("day");
  });
});
