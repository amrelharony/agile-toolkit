/**
 * The owner's Insights maths: per-story figures from the weekly totals, the
 * first-four-weeks window, the print score, the theme and character roll-ups,
 * the trend and the CSV.
 */

import { describe, expect, it } from "vitest";
import {
  CSV_HEADERS,
  MIN_READERS_FOR_SCORE,
  csvRows,
  medianBand,
  percentile,
  rollUp,
  storyInsights,
  summarise,
  weekOf,
  weeklyTrend,
  type InsightStory,
  type StatRow,
  type TapRow,
} from "@/lib/comics/insights";

const story = (ep: number, over: Partial<InsightStory> = {}): InsightStory => ({
  ep,
  title: `Story ${ep}`,
  themes: ["T01"],
  castNames: ["Amr"],
  releaseAt: "2026-11-08T07:00:00.000Z",
  happened: 1,
  shortlisted: false,
  ...over,
});

const row = (
  ep: number,
  metric: string,
  count: number,
  week = "2026-11-08",
  bucket = 0
): StatRow => ({
  ep,
  week,
  metric,
  bucket,
  count,
});

describe("helpers", () => {
  it("finds the Sunday that starts a week, in UTC", () => {
    expect(weekOf("2026-11-08T07:00:00.000Z")).toBe("2026-11-08"); // a Sunday
    expect(weekOf("2026-11-14T23:59:00.000Z")).toBe("2026-11-08"); // the Saturday after
    expect(weekOf("2026-11-15T00:00:00.000Z")).toBe("2026-11-15");
  });

  it("finds the band holding the middle view", () => {
    expect(medianBand([0, 0, 0, 0, 0, 0])).toBeNull();
    expect(medianBand([1, 0, 0, 5, 0, 0])).toBe(3);
    expect(medianBand([3, 3, 0, 0, 0, 0])).toBe(0);
    expect(medianBand([2, 1, 1, 0, 0, 0])).toBe(0);
  });

  it("ranks a value among others from 0 to 1, ties sharing", () => {
    expect(percentile(1, [1, 2, 3])).toBe(0);
    expect(percentile(3, [1, 2, 3])).toBe(1);
    expect(percentile(2, [1, 2, 2, 3])).toBeCloseTo(0.5);
    expect(percentile(5, [5])).toBe(0.5);
  });
});

describe("storyInsights", () => {
  const stories = [story(27), story(28, { happened: null, themes: ["T01", "T08"] })];
  const stats = [
    row(27, "view", 50),
    row(27, "visitor", 40),
    row(27, "reader", 30),
    row(27, "love", 9),
    row(27, "unlove", 3),
    row(27, "share", 2),
    row(27, "retro", 1),
    row(27, "tool", 3),
    row(27, "time", 10, "2026-11-08", 3),
    row(27, "time", 4, "2026-11-08", 1),
    row(27, "view", 7, "2026-12-13"), // the fifth week after release
    row(99, "view", 5), // a story Insights doesn't know
  ];
  const taps: TapRow[] = [
    { ep: 27, kind: "guess", choice: 1, count: 6 },
    { ep: 27, kind: "guess", choice: 0, count: 2 },
    { ep: 27, kind: "seen", choice: 0, count: 3 },
    { ep: 27, kind: "seen", choice: 1, count: 1 },
    { ep: 28, kind: "guess", choice: 0, count: 4 },
  ];

  it("works out each story's figures", () => {
    const [a, b] = storyInsights(stories, stats, taps, "all");
    expect(a).toMatchObject({
      views: 57,
      visitors: 40,
      readers: 30,
      completion: 0.75,
      loves: 6,
      loveRate: 20,
      shares: 2,
      retros: 1,
      tools: 3,
      actionRate: 20,
      medianBand: 3,
      guessTotal: 8,
      guessRight: 0.75,
      seenTotal: 4,
      seenYes: 0.75,
    });
    expect(a.score).not.toBeNull();
    // No guess on 28, so no "right" share, and nothing read: no rates, no score.
    expect(b).toMatchObject({
      readers: 0,
      completion: null,
      loveRate: null,
      guessRight: null,
      score: null,
    });
  });

  it("keeps each story's first four weeks, from its release week", () => {
    const [a] = storyInsights(stories, stats, taps, "first4");
    expect(a.views).toBe(50);
    const [unreleased] = storyInsights([story(27, { releaseAt: null })], stats, taps, "first4");
    expect(unreleased.views).toBe(0);
  });
});

describe("the print score", () => {
  it("ranks stories with enough readers and leaves the rest too early", () => {
    const stories = [27, 28, 29].map((ep) => story(ep));
    const stats = [
      row(27, "visitor", 40),
      row(27, "reader", MIN_READERS_FOR_SCORE),
      row(27, "love", 2),
      row(28, "visitor", 40),
      row(28, "reader", 30),
      row(28, "love", 15),
      row(28, "share", 6),
      row(29, "visitor", 10),
      row(29, "reader", MIN_READERS_FOR_SCORE - 1),
      row(29, "love", 19),
    ];
    const scored = storyInsights(stories, stats, [], "all");
    expect(scored.map((s) => s.score)).toEqual([0, 100, null]);
  });
});

describe("roll-ups, trend and summary", () => {
  const stories = [
    story(27, { themes: ["T01"], castNames: ["Amr", "HiPPO"], shortlisted: true }),
    story(28, { themes: ["T01", "T08"], castNames: ["HiPPO"] }),
  ];
  const stats = [
    row(27, "visitor", 10),
    row(27, "reader", 10),
    row(27, "love", 5),
    row(28, "visitor", 20),
    row(28, "reader", 10),
    row(28, "love", 1),
    row(28, "view", 4, "2026-11-15"),
    row(27, "view", 3, "2026-11-08"),
    row(28, "unlove", 1, "2026-11-15"),
  ];
  const insights = storyInsights(stories, stats, [], "all");

  it("rolls figures up by theme and by character, from summed counts", () => {
    const themes = rollUp(insights, "themes");
    expect(themes.map((g) => [g.key, g.stories, g.readers, g.loveRate, g.shortlisted])).toEqual([
      ["T01", 2, 20, 25, 1],
      ["T08", 1, 10, 0, 0],
    ]);
    expect(themes[0].label).toBe("Shared language and direct understanding");
    const cast = rollUp(insights, "castNames");
    expect(cast.map((g) => g.key)).toEqual(["Amr", "HiPPO"]);
    expect(cast[1].completion).toBeCloseTo(20 / 30);
  });

  it("charts views, readers and net loves week by week", () => {
    expect(weeklyTrend(stats)).toEqual([
      { week: "2026-11-08", views: 3, readers: 20, loves: 6 },
      { week: "2026-11-15", views: 4, readers: 0, loves: -1 },
    ]);
  });

  it("sums the whole picture", () => {
    expect(summarise(insights, Date.parse("2026-11-20T00:00:00Z"))).toMatchObject({
      storiesOut: 2,
      visitors: 30,
      readers: 20,
      // 28's love was taken back.
      loves: 5,
      shortlisted: 1,
    });
  });

  it("writes one CSV row per story under the headers", () => {
    const rows = csvRows(insights);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(CSV_HEADERS.length);
    expect(rows[0].slice(0, 6)).toEqual([
      27,
      "Story 27",
      "2026-11-08",
      "Shared language and direct understanding",
      "Amr; HiPPO",
      "yes",
    ]);
  });
});
