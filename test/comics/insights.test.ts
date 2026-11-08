/**
 * The owner's Insights maths: per-story figures from the sums the database
 * works out (all time and each story's first four weeks), the print score, the
 * theme and character roll-ups, the trend, the summary and the CSV. Which weeks
 * count as a story's first four is the database's (migration 0036), checked in
 * test/comics/stats.test.ts and a rolled-back run against PostgreSQL.
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
  weeklyTrend,
  type InsightStory,
  type TapRow,
  type TotalRow,
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

const total = (ep: number, metric: string, count: number, scope = "all", bucket = 0): TotalRow => ({
  ep,
  scope,
  metric,
  bucket,
  count,
});

describe("helpers", () => {
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
  const totals = [
    total(27, "view", 57),
    total(27, "visitor", 40),
    total(27, "reader", 30),
    total(27, "love", 9),
    total(27, "unlove", 3),
    total(27, "share", 2),
    total(27, "retro", 1),
    total(27, "tool", 3),
    total(27, "time", 10, "all", 3),
    total(27, "time", 4, "all", 1),
    total(27, "view", 50, "first4"),
    total(99, "view", 5), // a story Insights doesn't know
  ];
  const taps: TapRow[] = [
    { ep: 27, kind: "guess", choice: 1, count: 6 },
    { ep: 27, kind: "guess", choice: 0, count: 2 },
    { ep: 27, kind: "seen", choice: 0, count: 3 },
    { ep: 27, kind: "seen", choice: 1, count: 1 },
    { ep: 28, kind: "guess", choice: 0, count: 4 },
  ];

  it("works out each story's figures", () => {
    const [a, b] = storyInsights(stories, totals, taps, "all");
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

  it("takes the period's sums, and taps as they are", () => {
    const [a] = storyInsights(stories, totals, taps, "first4");
    expect(a.views).toBe(50);
    expect(a.readers).toBe(0);
    expect(a.guessTotal).toBe(8);
  });
});

describe("the print score", () => {
  it("ranks stories with enough readers and leaves the rest too early", () => {
    const stories = [27, 28, 29].map((ep) => story(ep));
    const totals = [
      total(27, "visitor", 40),
      total(27, "reader", MIN_READERS_FOR_SCORE),
      total(27, "love", 2),
      total(28, "visitor", 40),
      total(28, "reader", 30),
      total(28, "love", 15),
      total(28, "share", 6),
      total(29, "visitor", 10),
      total(29, "reader", MIN_READERS_FOR_SCORE - 1),
      total(29, "love", 19),
    ];
    const scored = storyInsights(stories, totals, [], "all");
    expect(scored.map((s) => s.score)).toEqual([0, 100, null]);
  });
});

describe("roll-ups, trend and summary", () => {
  const stories = [
    story(27, { themes: ["T01"], castNames: ["Amr", "HiPPO"], shortlisted: true }),
    story(28, { themes: ["T01", "T08"], castNames: ["HiPPO"] }),
  ];
  const totals = [
    total(27, "visitor", 10),
    total(27, "reader", 10),
    total(27, "love", 5),
    total(28, "visitor", 20),
    total(28, "reader", 10),
    total(28, "love", 1),
    total(28, "unlove", 1),
  ];
  const insights = storyInsights(stories, totals, [], "all");

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

  it("charts views, readers and net loves week by week, oldest first", () => {
    expect(
      weeklyTrend([
        { week: "2026-11-15", metric: "view", count: 4 },
        { week: "2026-11-15", metric: "unlove", count: 1 },
        { week: "2026-11-08", metric: "view", count: 3 },
        { week: "2026-11-08", metric: "reader", count: 20 },
        { week: "2026-11-08", metric: "love", count: 6 },
      ])
    ).toEqual([
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

  it("writes one full CSV row per story, column for column", () => {
    const [row] = csvRows(
      storyInsights(
        [story(27, { castNames: ["Amr", "HiPPO"], shortlisted: true })],
        [
          total(27, "view", 50),
          total(27, "visitor", 40),
          total(27, "reader", 30),
          total(27, "love", 9),
          total(27, "unlove", 3),
          total(27, "share", 2),
          total(27, "retro", 1),
          total(27, "tool", 3),
          total(27, "time", 10, "all", 3),
        ],
        [
          { ep: 27, kind: "guess", choice: 1, count: 3 },
          { ep: 27, kind: "guess", choice: 0, count: 1 },
          { ep: 27, kind: "seen", choice: 0, count: 2 },
          { ep: 27, kind: "seen", choice: 1, count: 2 },
        ],
        "all"
      )
    );
    expect(Object.fromEntries(CSV_HEADERS.map((h, i) => [h, row[i]]))).toEqual({
      Episode: 27,
      Title: "Story 27",
      Released: "2026-11-08",
      Themes: "Shared language and direct understanding",
      Characters: "Amr; HiPPO",
      Shortlisted: "yes",
      Views: 50,
      Visitors: 40,
      Readers: 30,
      "Finished %": 75,
      "Median reading time": "1–2 min",
      Loves: 6,
      "Loves per 100 readers": 20,
      Shares: 2,
      "Retro hand-offs": 1,
      "Tool clicks": 3,
      "Actions per 100 readers": 20,
      "Guessed right %": 75,
      "Seen this at work %": 50,
      // The only story with enough readers sits in the middle of itself.
      "Print score": 50,
    });
  });
});
