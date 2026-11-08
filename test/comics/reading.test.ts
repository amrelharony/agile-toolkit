/**
 * What this browser keeps of its reading: each story counted once, the week
 * streak the trophies read, and where a story's question was sent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  READING_KEY,
  hasRead,
  markAsked,
  markRead,
  sentLinks,
  setSentLinks,
  weekNumber,
  weekStreak,
  SKIPPED,
  guessFor,
  markGuessed,
  markSeen,
  seenFor,
} from "@/lib/comics/reading";

const SUNDAY = new Date("2026-11-01T07:00:00.000Z");
const days = (n: number) => new Date(SUNDAY.getTime() + n * 86_400_000);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("reading", () => {
  it("counts a story once, however often it's read", () => {
    expect(hasRead(30)).toBe(false);
    expect(markRead(30, SUNDAY)).toEqual({ total: 1, weekStreak: 1 });
    expect(markRead(30, days(1))).toBeNull();
    expect(markRead(31, days(1))).toEqual({ total: 2, weekStreak: 1 });
    expect(hasRead(30)).toBe(true);
  });

  it("keeps it under the agile-toolkit prefix, so Clear data and backups know it", () => {
    markRead(30, SUNDAY);
    expect(READING_KEY.startsWith("agile-toolkit:")).toBe(true);
    expect(JSON.parse(localStorage.getItem(READING_KEY)!).read).toEqual({
      "30": SUNDAY.toISOString(),
    });
  });

  it("counts nothing it couldn't remember", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(markRead(30, SUNDAY)).toBeNull();
  });

  it("survives a damaged record", () => {
    localStorage.setItem(READING_KEY, "{not json");
    expect(markRead(30, SUNDAY)).toEqual({ total: 1, weekStreak: 1 });
    localStorage.setItem(
      READING_KEY,
      JSON.stringify({ read: { 31: 5 }, sent: { 31: "x", 32: [null, { route: "retro-topic" }] } })
    );
    expect(hasRead(31)).toBe(false);
    expect(sentLinks(31)).toEqual([]);
    expect(sentLinks(32)).toEqual([]);
  });
});

describe("the week streak", () => {
  it("starts its weeks on Sunday, in UTC like the releases", () => {
    expect(weekNumber(new Date("2026-10-31T23:59:59.000Z"))).toBe(weekNumber(SUNDAY) - 1);
    expect(weekNumber(new Date("2026-11-01T00:00:00.000Z"))).toBe(weekNumber(SUNDAY));
    expect(weekNumber(new Date("2026-11-07T23:59:59.000Z"))).toBe(weekNumber(SUNDAY));
    expect(weekNumber(new Date("2026-11-08T00:00:00.000Z"))).toBe(weekNumber(SUNDAY) + 1);
  });

  it("counts weeks in a row up to this one", () => {
    const read = [days(-21), days(-14), days(-12), days(-7), days(0)].map((d) => d.toISOString());
    expect(weekStreak(read, days(2))).toBe(4);
  });

  it("starts again after a week with nothing read", () => {
    const read = [days(-21), days(-7), days(0)].map((d) => d.toISOString());
    expect(weekStreak(read, days(0))).toBe(2);
  });

  it("is nothing when this week has nothing read yet", () => {
    expect(weekStreak([days(-7).toISOString()], days(0))).toBe(0);
  });

  it("comes back with each new story read", () => {
    markRead(27, days(-21));
    markRead(28, days(-14));
    markRead(29, days(-7));
    expect(markRead(30, days(1))).toEqual({ total: 4, weekStreak: 4 });
  });
});

describe("a question sent to the retro", () => {
  it("is counted once per story", () => {
    expect(markAsked(30, SUNDAY)).toBe(true);
    expect(markAsked(30, days(1))).toBe(false);
    expect(markAsked(31, days(1))).toBe(true);
  });
});

describe("where a story's question went", () => {
  it("keeps each story's links apart, and forgets a story with none left", () => {
    const link = { route: "retro-topic" as const, targetId: "card-1", at: SUNDAY.toISOString() };
    setSentLinks(30, () => [link]);
    expect(sentLinks(30)).toEqual([link]);
    expect(sentLinks(31)).toEqual([]);
    setSentLinks(30, () => []);
    expect(JSON.parse(localStorage.getItem(READING_KEY)!).sent).toEqual({});
  });
});

describe("a story's guess and Seen this at work", () => {
  it("keeps each story's first answer only, so a reload can't count twice", () => {
    expect(guessFor(30)).toBeNull();
    expect(markGuessed(30, 2)).toBe(true);
    expect(markGuessed(30, 0)).toBe(false);
    expect(guessFor(30)).toBe(2);
    expect(markGuessed(31, SKIPPED)).toBe(true);
    expect(guessFor(31)).toBe(SKIPPED);
    expect(seenFor(30)).toBeNull();
    expect(markSeen(30, 1)).toBe(true);
    expect(markSeen(30, 0)).toBe(false);
    expect(seenFor(30)).toBe(1);
  });

  it("drops a damaged answer rather than trusting it", () => {
    localStorage.setItem(
      READING_KEY,
      JSON.stringify({ guessed: { 30: 9, 31: "1", 32: 1 }, seen: { 30: -1, 31: 0 } })
    );
    expect(guessFor(30)).toBeNull();
    expect(guessFor(31)).toBeNull();
    expect(guessFor(32)).toBe(1);
    expect(seenFor(30)).toBeNull();
    expect(seenFor(31)).toBe(0);
  });

  it("leaves the reading record's other parts alone", () => {
    markRead(30, SUNDAY);
    markGuessed(30, 1);
    expect(hasRead(30)).toBe(true);
  });
});
