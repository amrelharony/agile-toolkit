/**
 * The owner's Insights: what readers do with each weekly story, rolled up by
 * theme and character, and a print score for choosing stories for a printed
 * volume. Pure, from the anonymous weekly totals (migration 0036), the guess and
 * "Seen this at work?" totals (0035) and the stories themselves.
 *
 * Two periods: all time, or each story's first four weeks from its release
 * week, which compares an old story and a new one on the same footing. Taps
 * keep no dates, so guesses and "seen" answers are all time in both.
 */

import { THEME_LABELS } from "./themes";
import { TIME_BAND_COUNT, TIME_BAND_LABELS } from "./stats";

export type InsightPeriod = "all" | "first4";

/** A comic_story_stats row. */
export interface StatRow {
  ep: number;
  /** yyyy-mm-dd, the Sunday that starts the week. */
  week: string;
  metric: string;
  bucket: number;
  count: number;
}

/** A comic_story_taps row. */
export interface TapRow {
  ep: number;
  kind: string;
  choice: number;
  count: number;
}

/** What Insights needs of a weekly story. */
export interface InsightStory {
  ep: number;
  title: string;
  themes: string[];
  castNames: string[];
  releaseAt: string | null;
  /** The option the last panel shows, when the story has a guess. */
  happened: number | null;
  shortlisted: boolean;
}

export interface StoryInsight extends InsightStory {
  views: number;
  visitors: number;
  readers: number;
  /** Readers ÷ visitors, or null with no visitors. */
  completion: number | null;
  /** Reading-time counts per band. */
  bands: number[];
  /** The band holding the middle view, or null with no timed views. */
  medianBand: number | null;
  loves: number;
  /** Loves per 100 readers. */
  loveRate: number | null;
  shares: number;
  retros: number;
  tools: number;
  /** Shares, retro hand-offs and tool clicks per 100 readers. */
  actionRate: number | null;
  guessTotal: number;
  /** Share of guesses that picked what happened. */
  guessRight: number | null;
  seenTotal: number;
  /** Share of "Seen this at work?" answers that said yes. */
  seenYes: number | null;
  /** 0–100 among stories with enough readers, else null ("too early"). */
  score: number | null;
}

/** A score needs this many readers: below it, one reader's love moves the number. */
export const MIN_READERS_FOR_SCORE = 20;
/** A printed volume holds this many stories. */
export const VOLUME_SIZE = 26;
const FIRST_WEEKS = 4;
const DAY_MS = 86_400_000;

/** The Sunday (UTC) that starts the week holding `iso`, as yyyy-mm-dd. */
export function weekOf(iso: string): string {
  const at = new Date(iso);
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return new Date(day - at.getUTCDay() * DAY_MS).toISOString().slice(0, 10);
}

function inPeriod(row: StatRow, story: InsightStory, period: InsightPeriod): boolean {
  if (period === "all") return true;
  if (!story.releaseAt) return false;
  const start = Date.parse(`${weekOf(story.releaseAt)}T00:00:00Z`);
  const week = Date.parse(`${row.week}T00:00:00Z`);
  return week >= start && week < start + FIRST_WEEKS * 7 * DAY_MS;
}

const rate = (part: number, whole: number, per = 1) => (whole > 0 ? (part / whole) * per : null);

/** The band holding the middle of these counts, or null if there are none. */
export function medianBand(bands: readonly number[]): number | null {
  const total = bands.reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;
  let seen = 0;
  for (let i = 0; i < bands.length; i += 1) {
    seen += bands[i];
    if (seen * 2 >= total) return i;
  }
  return bands.length - 1;
}

export function bandLabel(band: number | null): string {
  return band === null ? "—" : TIME_BAND_LABELS[band];
}

/**
 * Where `value` sits among `values`, 0 to 1, ties sharing the middle: the
 * lowest scores near 0, the highest near 1.
 */
export function percentile(value: number, values: readonly number[]): number {
  if (values.length <= 1) return 0.5;
  const below = values.filter((v) => v < value).length;
  const equal = values.filter((v) => v === value).length;
  return (below + (equal - 1) / 2) / (values.length - 1);
}

type ScorePart = "loveRate" | "completion" | "seenYes" | "actionRate";
const SCORE_PARTS: readonly ScorePart[] = ["loveRate", "completion", "seenYes", "actionRate"];

/**
 * The print score: for each story with MIN_READERS_FOR_SCORE readers, the
 * average of where its love rate, completion, "seen it" yes share and actions
 * per reader sit among those stories, 0 to 100. A part a story has no figure
 * for is left out of its average. Fewer readers: null.
 */
export function scoreStories(insights: readonly StoryInsight[]): StoryInsight[] {
  const eligible = insights.filter((s) => s.readers >= MIN_READERS_FOR_SCORE);
  const pools = Object.fromEntries(
    SCORE_PARTS.map((part) => [
      part,
      eligible.map((s) => s[part]).filter((v): v is number => v !== null),
    ])
  ) as Record<ScorePart, number[]>;
  return insights.map((s) => {
    if (s.readers < MIN_READERS_FOR_SCORE) return { ...s, score: null };
    const parts = SCORE_PARTS.flatMap((part) => {
      const value = s[part];
      return value === null ? [] : [percentile(value, pools[part])];
    });
    const score =
      parts.length === 0
        ? null
        : Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
    return { ...s, score };
  });
}

/** Every weekly story's figures for `period`, scored. */
export function storyInsights(
  stories: readonly InsightStory[],
  stats: readonly StatRow[],
  taps: readonly TapRow[],
  period: InsightPeriod
): StoryInsight[] {
  const byEp = new Map(stories.map((s) => [s.ep, s]));
  const sums = new Map<number, Record<string, number>>();
  const bands = new Map<number, number[]>();
  for (const row of stats) {
    const story = byEp.get(row.ep);
    if (!story || !inPeriod(row, story, period)) continue;
    const n = Number(row.count) || 0;
    if (row.metric === "time") {
      const list = bands.get(row.ep) ?? Array.from({ length: TIME_BAND_COUNT }, () => 0);
      if (row.bucket >= 0 && row.bucket < TIME_BAND_COUNT) list[row.bucket] += n;
      bands.set(row.ep, list);
      continue;
    }
    const sum = sums.get(row.ep) ?? {};
    sum[row.metric] = (sum[row.metric] ?? 0) + n;
    sums.set(row.ep, sum);
  }
  const guesses = new Map<number, number[]>();
  const seen = new Map<number, number[]>();
  for (const tap of taps) {
    const target = tap.kind === "guess" ? guesses : tap.kind === "seen" ? seen : null;
    if (!target || tap.choice < 0 || tap.choice > 3) continue;
    const list = target.get(tap.ep) ?? [0, 0, 0, 0];
    list[tap.choice] += Number(tap.count) || 0;
    target.set(tap.ep, list);
  }

  const insights = stories.map((story): StoryInsight => {
    const sum = sums.get(story.ep) ?? {};
    const get = (metric: string) => sum[metric] ?? 0;
    const visitors = get("visitor");
    const readers = get("reader");
    const loves = Math.max(0, get("love") - get("unlove"));
    const actions = get("share") + get("retro") + get("tool");
    const timeBands = bands.get(story.ep) ?? Array.from({ length: TIME_BAND_COUNT }, () => 0);
    const guessCounts = guesses.get(story.ep) ?? [0, 0, 0, 0];
    const guessTotal = guessCounts.reduce((a, b) => a + b, 0);
    const seenCounts = seen.get(story.ep) ?? [0, 0, 0, 0];
    const seenTotal = seenCounts[0] + seenCounts[1];
    return {
      ...story,
      views: get("view"),
      visitors,
      readers,
      completion: visitors > 0 ? Math.min(1, readers / visitors) : null,
      bands: timeBands,
      medianBand: medianBand(timeBands),
      loves,
      loveRate: rate(loves, readers, 100),
      shares: get("share"),
      retros: get("retro"),
      tools: get("tool"),
      actionRate: rate(actions, readers, 100),
      guessTotal,
      guessRight:
        story.happened === null || guessTotal === 0
          ? null
          : (guessCounts[story.happened] ?? 0) / guessTotal,
      seenTotal,
      seenYes: rate(seenCounts[0], seenTotal),
      score: null,
    };
  });
  return scoreStories(insights);
}

export interface GroupInsight {
  key: string;
  label: string;
  stories: number;
  readers: number;
  loves: number;
  loveRate: number | null;
  completion: number | null;
  medianBand: number | null;
  seenYes: number | null;
  shortlisted: number;
}

/**
 * The same figures per theme or per character, from the stories that carry
 * it: a story with two themes counts in both. Rates come from the summed
 * counts, so a busy story weighs more than a quiet one.
 */
export function rollUp(
  insights: readonly StoryInsight[],
  by: "themes" | "castNames"
): GroupInsight[] {
  const groups = new Map<string, StoryInsight[]>();
  for (const s of insights) {
    for (const key of Array.from(new Set(s[by]))) groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return Array.from(groups, ([key, members]): GroupInsight => {
    const total = (pick: (s: StoryInsight) => number) =>
      members.reduce((sum, s) => sum + pick(s), 0);
    const readers = total((s) => s.readers);
    const visitors = total((s) => s.visitors);
    const loves = total((s) => s.loves);
    const bands = Array.from({ length: TIME_BAND_COUNT }, (_, i) => total((s) => s.bands[i]));
    const seenYes = total((s) => (s.seenYes ?? 0) * s.seenTotal);
    const seenTotal = total((s) => s.seenTotal);
    return {
      key,
      label: by === "themes" ? (THEME_LABELS[key] ?? key) : key,
      stories: members.length,
      readers,
      loves,
      loveRate: rate(loves, readers, 100),
      completion: visitors > 0 ? Math.min(1, readers / visitors) : null,
      medianBand: medianBand(bands),
      seenYes: rate(seenYes, seenTotal),
      shortlisted: members.filter((s) => s.shortlisted).length,
    };
  }).sort((a, b) => (b.loveRate ?? -1) - (a.loveRate ?? -1) || b.readers - a.readers);
}

export interface WeekPoint {
  week: string;
  views: number;
  readers: number;
  loves: number;
}

/** Views, readers and net loves across all stories, week by week, oldest first. */
export function weeklyTrend(stats: readonly StatRow[]): WeekPoint[] {
  const weeks = new Map<string, WeekPoint>();
  for (const row of stats) {
    const point = weeks.get(row.week) ?? { week: row.week, views: 0, readers: 0, loves: 0 };
    const n = Number(row.count) || 0;
    if (row.metric === "view") point.views += n;
    else if (row.metric === "reader") point.readers += n;
    else if (row.metric === "love") point.loves += n;
    else if (row.metric === "unlove") point.loves -= n;
    weeks.set(row.week, point);
  }
  return Array.from(weeks.values()).sort((a, b) => a.week.localeCompare(b.week));
}

export interface InsightSummary {
  storiesOut: number;
  visitors: number;
  readers: number;
  completion: number | null;
  loves: number;
  medianBand: number | null;
  shortlisted: number;
}

export function summarise(insights: readonly StoryInsight[], now = Date.now()): InsightSummary {
  const total = (pick: (s: StoryInsight) => number) => insights.reduce((n, s) => n + pick(s), 0);
  const visitors = total((s) => s.visitors);
  const readers = total((s) => s.readers);
  return {
    storiesOut: insights.filter((s) => s.releaseAt && Date.parse(s.releaseAt) <= now).length,
    visitors,
    readers,
    completion: visitors > 0 ? Math.min(1, readers / visitors) : null,
    loves: total((s) => s.loves),
    medianBand: medianBand(
      Array.from({ length: TIME_BAND_COUNT }, (_, i) => total((s) => s.bands[i]))
    ),
    shortlisted: insights.filter((s) => s.shortlisted).length,
  };
}

const pct = (v: number | null) => (v === null ? "" : Math.round(v * 100));
const one = (v: number | null) => (v === null ? "" : Math.round(v * 10) / 10);

export const CSV_HEADERS = [
  "Episode",
  "Title",
  "Released",
  "Themes",
  "Characters",
  "Shortlisted",
  "Views",
  "Visitors",
  "Readers",
  "Finished %",
  "Median reading time",
  "Loves",
  "Loves per 100 readers",
  "Shares",
  "Retro hand-offs",
  "Tool clicks",
  "Actions per 100 readers",
  "Guessed right %",
  "Seen this at work %",
  "Print score",
];

/** One CSV row per story, in CSV_HEADERS' order. */
export function csvRows(insights: readonly StoryInsight[]): (string | number)[][] {
  return insights.map((s) => [
    s.ep,
    s.title,
    s.releaseAt ? s.releaseAt.slice(0, 10) : "",
    s.themes.map((t) => THEME_LABELS[t] ?? t).join("; "),
    s.castNames.join("; "),
    s.shortlisted ? "yes" : "",
    s.views,
    s.visitors,
    s.readers,
    pct(s.completion),
    s.medianBand === null ? "" : TIME_BAND_LABELS[s.medianBand],
    s.loves,
    one(s.loveRate),
    s.shares,
    s.retros,
    s.tools,
    one(s.actionRate),
    pct(s.guessRight),
    pct(s.seenYes),
    s.score ?? "",
  ]);
}
