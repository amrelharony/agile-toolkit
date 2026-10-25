/**
 * lib/flow throughput: finished work per day and per ISO week (gaps as 0,
 * across a year boundary), the last 7 days, Little's Law over elapsed days
 * (uneven dates, too few, no throughput), recent board moves (distinct
 * items in a window) and DORA's lead time in hours.
 */

import { describe, expect, it } from "vitest";
import {
  cardItems,
  isoWeek,
  leadTimeHours,
  littlesLaw,
  recentMoves,
  throughputByDay,
  throughputByWeek,
  throughputLastWeek,
  weekOf,
} from "@/lib/flow";
import { movedCard } from "@/lib/kanban/flow";
import { card, local } from "./fixtures";

const done = (...days: (string | null)[]) => days.map((doneOn) => ({ doneOn }));

describe("throughputByDay", () => {
  it("counts finishes per day over the range, quiet days as 0", () => {
    expect(
      throughputByDay(done("2026-10-01", "2026-10-03", "2026-10-03", null, "2026-10-09"), {
        from: "2026-10-01",
        to: "2026-10-04",
      })
    ).toEqual([
      { label: "2026-10-01", value: 1 },
      { label: "2026-10-02", value: 0 },
      { label: "2026-10-03", value: 2 },
      { label: "2026-10-04", value: 0 },
    ]);
    expect(throughputByDay([], { from: "2026-10-04", to: "2026-10-01" })).toEqual([]);
  });
});

describe("throughputByWeek", () => {
  it("lists every ISO week from the first finish to the last, gaps as 0", () => {
    expect(throughputByWeek(done("2026-10-12", "2026-10-13", "2026-10-30", null))).toEqual([
      { label: "2026-W42", value: 2 },
      { label: "2026-W43", value: 0 },
      { label: "2026-W44", value: 1 },
    ]);
    expect(throughputByWeek([])).toEqual([]);
    expect(throughputByWeek(done(null))).toEqual([]);
  });

  it("keeps the weeks consecutive over a year boundary (2026 has a week 53)", () => {
    expect(throughputByWeek(done("2027-01-11", "2026-12-28"))).toEqual([
      { label: "2026-W53", value: 1 },
      { label: "2027-W01", value: 0 },
      { label: "2027-W02", value: 1 },
    ]);
  });

  it("numbers weeks the ISO way, from a local date or a day", () => {
    expect(isoWeek(new Date(2026, 9, 20, 23, 30))).toEqual({ year: 2026, week: 43 });
    expect(isoWeek(new Date(2027, 0, 1))).toEqual({ year: 2026, week: 53 });
    expect(weekOf("2027-01-04")).toBe("2027-W01");
    expect(weekOf(local("2026-10-19", 0, 10))).toBe("2026-W43");
    expect(weekOf(null)).toBeNull();
  });
});

describe("throughputLastWeek", () => {
  it("counts the 7 local days up to and including today", () => {
    const finished = done("2026-10-20", "2026-10-14", "2026-10-13", "2026-10-21", null);
    expect(throughputLastWeek(finished, "2026-10-20")).toBe(2);
    expect(throughputLastWeek([], "2026-10-20")).toBe(0);
    expect(throughputLastWeek(finished, "today")).toBe(0);
  });
});

describe("littlesLaw", () => {
  it("divides by the days elapsed between the dates, not the number of points", () => {
    const law = littlesLaw([
      { date: "2026-10-01", wip: 2, done: 0 },
      { date: "2026-10-02", wip: 4, done: 1 },
      { date: "2026-10-30", wip: 3, done: 29 },
    ]);
    expect(law).toEqual({ days: 29, avgWip: 3, throughputPerDay: 1, leadTimeDays: 3 });
  });

  it("reads the points in date order, whatever order they come in", () => {
    const law = littlesLaw([
      { date: "2026-10-11", wip: 6, done: 10 },
      { date: "2026-10-01", wip: 2, done: 0 },
    ]);
    expect(law).toEqual({ days: 10, avgWip: 4, throughputPerDay: 1, leadTimeDays: 4 });
  });

  it("says nothing with fewer than 2 dates or no throughput", () => {
    expect(littlesLaw([])).toBeNull();
    expect(littlesLaw([{ date: "2026-10-01", wip: 2, done: 0 }])).toBeNull();
    expect(
      littlesLaw([
        { date: "2026-10-01", wip: 2, done: 0 },
        { date: "2026-10-01", wip: 3, done: 4 },
      ])
    ).toBeNull();
    expect(
      littlesLaw([
        { date: "2026-10-01", wip: 2, done: 5 },
        { date: "2026-10-05", wip: 3, done: 5 },
      ])
    ).toBeNull();
    // Done fell (a typed running total that went down): no throughput to read.
    expect(
      littlesLaw([
        { date: "2026-10-01", wip: 2, done: 14 },
        { date: "2026-10-05", wip: 3, done: 12 },
      ])
    ).toBeNull();
    expect(
      littlesLaw([
        { date: "nope", wip: 2, done: 0 },
        { date: "2026-10-05", wip: 3, done: 2 },
      ])
    ).toBeNull();
  });
});

describe("recentMoves", () => {
  it("counts distinct items with a move in the window", () => {
    let busy = card("busy");
    busy = movedCard(busy, "ready", local("2026-10-15"));
    busy = movedCard(busy, "in_progress", local("2026-10-18"));
    busy = movedCard(busy, "review", local("2026-10-20", 23, 50));
    const items = cardItems([
      busy,
      movedCard(card("edge"), "ready", local("2026-10-14", 0, 5)),
      movedCard(card("old"), "ready", local("2026-10-13", 23, 55)),
      card("still"),
    ]);
    expect(recentMoves(items, "2026-10-20")).toBe(2);
    expect(recentMoves(items, "2026-10-20", 1)).toBe(1);
    expect(recentMoves(items, "2026-10-20", 30)).toBe(3);
    expect(recentMoves(items, "2026-10-20", 0)).toBe(0);
    expect(recentMoves([], "2026-10-20")).toBe(0);
  });
});

describe("leadTimeHours", () => {
  it("runs from the start day to the done day, or to a later ship day, in whole days", () => {
    const item = { startedOn: "2026-10-01", doneOn: "2026-10-03" };
    expect(leadTimeHours(item)).toBe(72);
    expect(leadTimeHours(item, "2026-10-05")).toBe(120);
    expect(leadTimeHours(item, local("2026-10-03", 23))).toBe(72);
    // Shipped "before" it was done: the release doesn't date it.
    expect(leadTimeHours(item, "2026-09-30")).toBe(72);
    expect(leadTimeHours({ startedOn: "2026-10-01", doneOn: "2026-10-01" }, null)).toBe(24);
    expect(leadTimeHours({ startedOn: null, doneOn: "2026-10-03" })).toBeNull();
    expect(leadTimeHours({ startedOn: "2026-10-01", doneOn: null }, "2026-10-05")).toBeNull();
  });
});
