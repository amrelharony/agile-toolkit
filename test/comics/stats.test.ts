/**
 * Story engagement counts: what a page may send, the reading-time bands, the
 * thresholds, the browser's own record of firsts and loves, and migration 0036.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FAVOURITES_MIN_LOVES,
  NO_TOTALS,
  STAT_METRICS,
  TIME_BAND_COUNT,
  parseStats,
  pickFavourites,
  readStatsAnswer,
  readTotals,
  timeBand,
  timeEvent,
} from "@/lib/comics/stats";
import {
  READING_KEY,
  addSeconds,
  isLoveCounted,
  isLoved,
  lovedStories,
  markViewed,
  setLoveCounted,
  setLoved,
  totalSeconds,
} from "@/lib/comics/reading";

describe("timeBand", () => {
  it("puts active seconds into six bands", () => {
    expect([0, 9.9, 10, 29, 30, 59, 60, 119, 120, 299, 300, 9_999].map(timeBand)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
    expect(TIME_BAND_COUNT).toBe(6);
  });

  it("treats nonsense as the shortest band", () => {
    expect([-1, Number.NaN, Number.POSITIVE_INFINITY].map(timeBand)).toEqual([0, 0, 0]);
    expect(timeEvent(45)).toBe("time:2");
  });
});

describe("parseStats", () => {
  it("takes a weekly story and known events", () => {
    expect(parseStats({ ep: 30, events: ["view", "visitor"] })).toEqual({
      ep: 30,
      events: ["view", "visitor"],
    });
    expect(parseStats({ ep: 999, events: ["time:5"] })).toEqual({ ep: 999, events: ["time:5"] });
  });

  it("refuses book episodes, unknown events, repeats and too many", () => {
    for (const body of [
      null,
      [],
      "view",
      { ep: 26, events: ["view"] },
      { ep: 1000, events: ["view"] },
      { ep: 30.5, events: ["view"] },
      { ep: "30", events: ["view"] },
      { ep: 30, events: [] },
      { ep: 30, events: "view" },
      { ep: 30, events: ["like"] },
      { ep: 30, events: ["time:6"] },
      { ep: 30, events: ["time:1", "time:2"] },
      { ep: 30, events: ["view", "view"] },
      { ep: 30, events: ["love", "unlove"] },
      // One more than MAX_STAT_EVENTS, with no other reason to refuse them.
      { ep: 30, events: ["view", "visitor", "reader", "love", "share", "retro", "tool"] },
    ]) {
      expect(parseStats(body)).toBeNull();
    }
  });
});

describe("totals", () => {
  it("reads bigints sent as strings and never goes below zero", () => {
    expect(readTotals({ views: "12", visitors: 5, readers: "3", loves: -2, shares: null })).toEqual(
      { ...NO_TOTALS, views: 12, visitors: 5, readers: 3 }
    );
    expect(readTotals(null)).toEqual(NO_TOTALS);
    expect(readStatsAnswer({ loves: 4, readers: 9 })).toEqual({ loves: 4, readers: 9 });
    expect(readStatsAnswer({ loves: "4" })).toBeNull();
  });

  it("picks favourites from the threshold up, most loved first", () => {
    const stories = [27, 28, 29, 30, 31, 32, 33].map((ep) => ({ ep }));
    const loves = new Map([
      [27, FAVOURITES_MIN_LOVES - 1],
      [28, 9],
      [29, 30],
      [30, 9],
      [31, 12],
      [32, 5],
      [33, 6],
    ]);
    expect(pickFavourites(stories, loves).map((s) => [s.ep, s.loves])).toEqual([
      [29, 30],
      [31, 12],
      [30, 9],
      [28, 9],
      [33, 6],
    ]);
    expect(pickFavourites(stories, new Map())).toEqual([]);
  });
});

describe("the reading record's views, loves and time", () => {
  beforeEach(() => localStorage.clear());

  it("counts a first view once", () => {
    expect(markViewed(30)).toBe(true);
    expect(markViewed(30)).toBe(false);
    expect(markViewed(31)).toBe(true);
  });

  it("loves and takes the love back, changing only what changed", () => {
    expect(isLoved(30)).toBe(false);
    expect(setLoved(30, true, new Date("2026-11-08T08:00:00Z"))).toBe("changed");
    expect(setLoved(30, true)).toBe("unchanged");
    expect(setLoved(31, true, new Date("2026-11-09T08:00:00Z"))).toBe("changed");
    expect(lovedStories().map((s) => s.ep)).toEqual([31, 30]);
    expect(setLoved(30, false)).toBe("changed");
    expect(isLoved(30)).toBe(false);
    expect(setLoved(30, false)).toBe("unchanged");
  });

  it("keeps which loves the server counted apart from the loves themselves", () => {
    setLoved(30, true);
    expect(isLoveCounted(30)).toBe(false);
    setLoveCounted(30, true);
    expect(isLoveCounted(30)).toBe(true);
    setLoved(30, false);
    // Taking the love back locally doesn't forget that the server holds it.
    expect(isLoveCounted(30)).toBe(true);
    setLoveCounted(30, false);
    expect(isLoveCounted(30)).toBe(false);
  });

  it("adds up active reading time", () => {
    addSeconds(30, 42.4);
    addSeconds(30, 20);
    addSeconds(31, 100);
    addSeconds(31, -5);
    addSeconds(31, Number.NaN);
    expect(totalSeconds()).toBe(162);
  });

  it("drops damaged entries and keeps the rest", () => {
    localStorage.setItem(
      READING_KEY,
      JSON.stringify({
        read: {},
        viewed: { 30: "2026-11-08T08:00:00Z", 31: 5 },
        loved: { 30: "2026-11-08T08:00:00Z", 32: null },
        seconds: { 30: 60, 31: -1, 32: "9", 33: 1e9 },
      })
    );
    expect(markViewed(30)).toBe(false);
    expect(markViewed(31)).toBe(true);
    expect(lovedStories().map((s) => s.ep)).toEqual([30]);
    expect(totalSeconds()).toBe(60);
  });
});

describe("migration 0036", () => {
  const sql = readFileSync("supabase/migrations/0036_comic_story_stats.sql", "utf8");

  it("allows exactly the metrics a page may send", () => {
    const listed = /metric in \(([^)]*)\)/
      .exec(sql)![1]
      .match(/'([a-z]+)'/g)!
      .map((m) => m.slice(1, -1));
    expect(listed.sort()).toEqual([...STAT_METRICS, "time"].sort());
    expect(sql).toMatch(/bucket between 0 and 5/);
    expect(sql).toMatch(/check \(metric = 'time' or bucket = 0\)/);
    expect(sql).toMatch(/check \(extract\(dow from week\) = 0\)/);
    expect(sql).toMatch(/check \(count >= 0\)/);
  });

  it("keeps the table and functions to the service role", () => {
    expect(sql).toMatch(/alter table public\.comic_story_stats enable row level security;/);
    expect(sql).toMatch(/revoke all on table public\.comic_story_stats from anon, authenticated;/);
    expect(sql).not.toMatch(/create policy/i);
    const functions = [
      "comic_story_stat(int, text[])",
      "comic_story_totals(int)",
      "comic_story_insight_totals(int)",
      "comic_story_weekly_totals()",
    ];
    for (const fn of functions) {
      const name = fn.replace(/[()[\]]/g, "\\$&");
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${name} from public, anon, authenticated;`)
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${name} to service_role;`)
      );
    }
    expect(sql.match(/set search_path = ''/g)).toHaveLength(functions.length);
  });

  it("only takes back a love the story has, one call per story at a time", () => {
    expect(sql).toMatch(/perform pg_advisory_xact_lock\(36, p_ep\);/);
    expect(sql).toMatch(/n := least\(n, greatest\(net, 0\)\);/);
    expect(sql).toMatch(/continue when n <= 0;/);
  });

  it("sums totals for one story or all, and Insights' rows, in the database", () => {
    expect(sql).toMatch(/drop function if exists public\.comic_story_totals\(\);/);
    expect(sql).toMatch(/where p_ep is null or s\.ep = p_ep/);
    expect(sql).toMatch(/s\.week < r\.release_week \+ p_first_weeks \* 7/);
  });

  it("adds the owner's print shortlist", () => {
    expect(sql).toMatch(/add column if not exists print_shortlist boolean not null default false/);
  });
});
