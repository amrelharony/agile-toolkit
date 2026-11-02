/**
 * What this browser keeps of its reading: each story counted once, the week
 * streak the trophies read, and where a story's question was sent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  READING_KEY,
  hasRead,
  markRead,
  sentLinks,
  setSentLinks,
  weekNumber,
  weekStreak,
} from "@/lib/comics/reading";

const MONDAY = new Date("2026-11-02T07:00:00.000Z");
const days = (n: number) => new Date(MONDAY.getTime() + n * 86_400_000);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("reading", () => {
  it("counts a story once, however often it's read", () => {
    expect(hasRead(30)).toBe(false);
    expect(markRead(30, MONDAY)).toEqual({ total: 1, weekStreak: 1 });
    expect(markRead(30, days(1))).toBeNull();
    expect(markRead(31, days(1))).toEqual({ total: 2, weekStreak: 1 });
    expect(hasRead(30)).toBe(true);
  });

  it("keeps it under the agile-toolkit prefix, so Clear data and backups know it", () => {
    markRead(30, MONDAY);
    expect(READING_KEY.startsWith("agile-toolkit:")).toBe(true);
    expect(JSON.parse(localStorage.getItem(READING_KEY)!).read).toEqual({
      "30": MONDAY.toISOString(),
    });
  });

  it("counts nothing it couldn't remember", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(markRead(30, MONDAY)).toBeNull();
  });

  it("survives a damaged record", () => {
    localStorage.setItem(READING_KEY, "{not json");
    expect(markRead(30, MONDAY)).toEqual({ total: 1, weekStreak: 1 });
    localStorage.setItem(READING_KEY, JSON.stringify({ read: { 31: 5 }, sent: { 31: "x" } }));
    expect(hasRead(31)).toBe(false);
    expect(sentLinks(31)).toEqual([]);
  });
});

describe("the week streak", () => {
  it("starts its weeks on Monday, in UTC like the releases", () => {
    expect(weekNumber(new Date("2026-11-01T23:59:59.000Z"))).toBe(weekNumber(MONDAY) - 1);
    expect(weekNumber(new Date("2026-11-02T00:00:00.000Z"))).toBe(weekNumber(MONDAY));
    expect(weekNumber(new Date("2026-11-08T23:59:59.000Z"))).toBe(weekNumber(MONDAY));
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

describe("where a story's question went", () => {
  it("keeps each story's links apart, and forgets a story with none left", () => {
    const link = { route: "retro-topic" as const, targetId: "card-1", at: MONDAY.toISOString() };
    setSentLinks(30, () => [link]);
    expect(sentLinks(30)).toEqual([link]);
    expect(sentLinks(31)).toEqual([]);
    setSentLinks(30, () => []);
    expect(JSON.parse(localStorage.getItem(READING_KEY)!).sent).toEqual({});
  });
});
