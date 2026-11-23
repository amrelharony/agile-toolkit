/**
 * The Emotional Seismograph retro format: each card is a high, a steady
 * stretch or a low on the sprint day it happened, and the board charts them
 * day by day, with the team's mood under it on its own scale.
 *
 * Days count from 0, like `SprintDay.day`: Day 0 is the sprint's start
 * date, as Burndown numbers them, so one date has one day number in both
 * tools. A card's `day` is a whole number from 0 to RETRO_CARD_DAY_MAX.
 *
 * Pure: no store, no React. The Retro page, its Markdown and Amr's verbs
 * share these rules.
 */

import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";
import {
  RETRO_CARD_DAY_MAX,
  type MoodEntry,
  type MoodPulse,
  type Sprint,
} from "@/lib/stores/workspace-types";
import { DEFAULT_SPRINT_DAYS, dayDate, sprintLengthDays } from "@/lib/sprints/series";
import { LOW_MOOD, dailyMood, realEntries, realPulses, teamLevelDays } from "@/lib/team/mood";

export const SEISMOGRAPH_FORMAT_ID = "seismograph";

/** The three bands, the format's column keys, high to low. */
export const SEISMOGRAPH_BANDS = ["highs", "steady", "lows"] as const;
export type SeismographBand = (typeof SEISMOGRAPH_BANDS)[number];

/** A band in a sentence or a table cell. */
export const BAND_LABEL: Record<SeismographBand, string> = {
  highs: "High",
  steady: "Steady",
  lows: "Low",
};

/** Each band's lane on the chart, low to high. */
export const BAND_LANE: Record<SeismographBand, number> = { lows: 1, steady: 2, highs: 3 };

/** A band's mark in the Markdown. */
export const BAND_MARK: Record<SeismographBand, string> = { highs: "▲", steady: "–", lows: "▼" };

const isBand = (key: string): key is SeismographBand =>
  (SEISMOGRAPH_BANDS as readonly string[]).includes(key);

/** Whether a board runs as an Emotional Seismograph: its format, with the three columns. */
export function isSeismograph(board: Pick<BoardState, "format"> | null | undefined): boolean {
  if (!board || board.format?.id !== SEISMOGRAPH_FORMAT_ID) return false;
  const keys = new Set((board.format.columns ?? []).map((c) => c.key));
  return SEISMOGRAPH_BANDS.every((k) => keys.has(k));
}

/** Whether `v` is a card's day: a whole number from 0 to RETRO_CARD_DAY_MAX. */
export function isCardDay(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= RETRO_CARD_DAY_MAX;
}

export interface SeismographDay {
  day: number;
  /** Its date (YYYY-MM-DD), when the board has a sprint with a start date. */
  date: string | null;
  /** "Day 3 · Wed 12 Nov", or "Day 3" with no date. */
  label: string;
}

/** "Wed 12 Nov" for a YYYY-MM-DD date, read as that calendar day wherever the reader is. */
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * The days the board draws: with a sprint, Day 0 to its last day (at most
 * RETRO_CARD_DAY_MAX), each with its date; with none, Day 0 to
 * DEFAULT_SPRINT_DAYS − 1, without dates.
 */
export function seismographDays(
  sprint?: Pick<Sprint, "startDate" | "endDate"> | null
): SeismographDay[] {
  const last = sprint
    ? Math.min(sprintLengthDays(sprint), RETRO_CARD_DAY_MAX)
    : DEFAULT_SPRINT_DAYS - 1;
  return Array.from({ length: last + 1 }, (_, day) => {
    const date = sprint ? dayDate(sprint, day) : null;
    return { day, date, label: date ? `Day ${day} · ${shortDate(date)}` : `Day ${day}` };
  });
}

/** One moment the chart draws: a card the team wrote at this retro, with its group. */
export interface Moment {
  /**
   * The card that stands for its group: its top card, or, when the top card
   * doesn't chart (an action, a card sent from another tool), the group's
   * first card in board order that does.
   */
  id: string;
  text: string;
  band: SeismographBand;
  /** That card's day, as stored (it may be past the board's last day). */
  day?: number;
  /** Its own votes and those of the cards that chart with it. */
  votes: number;
  /** The other cards of its group that chart with it. */
  groupIds: string[];
  /** Where it sits on the board. */
  index: number;
}

/** A card that charts: not an action, not carried over, not from another tool, with words. */
function isMomentCard(c: RetroCard): boolean {
  return (
    !c.isActionItem && !c.carriedFrom && !c.sourceRef && isBand(c.columnKey) && !!c.text.trim()
  );
}

/** The top card of `card`'s group, following `groupedWith` up (a loop stops it). */
function topOf(card: RetroCard, byId: ReadonlyMap<string, RetroCard>): RetroCard {
  let at = card;
  const seen = new Set<string>([card.id]);
  while (at.groupedWith) {
    const up = byId.get(at.groupedWith);
    if (!up || seen.has(up.id)) break;
    seen.add(up.id);
    at = up;
  }
  return at;
}

/**
 * The moments the chart draws: the cards the team wrote at this retro, one
 * per group. Action items, carried-over actions and cards from another tool
 * (a hand-off's action, a kudos, a retro topic) are left out: on this board
 * a concern sent from Root Cause would land in Lows and chart as a low. A
 * grouped card charts with the top card of its group, its votes added in.
 * When the top card doesn't chart (the team grouped its lows under a sent
 * action), the group's first card that does stands for it, with the votes
 * of the group's other cards that chart, so no team card drops off.
 */
export function momentCards(cards: readonly RetroCard[]): Moment[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const groupOf = new Map(cards.map((c) => [c.id, topOf(c, byId).id]));
  /** Each group's cards in board order, by its top card's id. */
  const groups = new Map<string, RetroCard[]>();
  for (const c of cards) {
    const top = groupOf.get(c.id) as string;
    groups.set(top, [...(groups.get(top) ?? []), c]);
  }
  /** The card that charts for each group, by its top card's id. */
  const lead = new Map<string, string>();
  for (const [top, members] of groups) {
    const own = members.find((m) => m.id === top && isMomentCard(m));
    const first = own ?? members.find(isMomentCard);
    if (first) lead.set(top, first.id);
  }
  const out: Moment[] = [];
  cards.forEach((c, index) => {
    const top = groupOf.get(c.id) as string;
    if (lead.get(top) !== c.id) return;
    // Under a top card that charts, every card of the group counts, as before.
    const others = (groups.get(top) ?? []).filter(
      (m) => m.id !== c.id && (top === c.id || isMomentCard(m))
    );
    const votes =
      Math.max(0, c.votes || 0) + others.reduce((s, m) => s + Math.max(0, m.votes || 0), 0);
    out.push({
      id: c.id,
      text: c.text,
      band: c.columnKey as SeismographBand,
      ...(isCardDay(c.day) ? { day: c.day } : {}),
      votes,
      groupIds: others.map((m) => m.id),
      index,
    });
  });
  return out;
}

export interface PlacedMoment extends Moment {
  day: number;
  /** Its place among the moments on the same day and band, from 0. */
  stack: number;
}

export interface Placement {
  /** By day, then band (high to low), then the board's order. */
  placed: PlacedMoment[];
  /** No day, or a day past the board's last one (kept as it is). */
  unplaced: Moment[];
}

/** The moments by day and band, and the ones not on a day the board draws. */
export function placedCards(
  moments: readonly Moment[],
  days: readonly SeismographDay[]
): Placement {
  const last = days.length > 0 ? days[days.length - 1].day : -1;
  const placed: PlacedMoment[] = [];
  const unplaced: Moment[] = [];
  const stacks = new Map<string, number>();
  const ordered = [...moments].sort(
    (a, b) =>
      (a.day ?? 0) - (b.day ?? 0) ||
      SEISMOGRAPH_BANDS.indexOf(a.band) - SEISMOGRAPH_BANDS.indexOf(b.band) ||
      a.index - b.index
  );
  for (const m of ordered) {
    if (m.day === undefined || m.day > last) {
      unplaced.push(m);
      continue;
    }
    const key = `${m.day}:${m.band}`;
    const stack = stacks.get(key) ?? 0;
    stacks.set(key, stack + 1);
    placed.push({ ...m, day: m.day, stack });
  }
  unplaced.sort((a, b) => a.index - b.index);
  return { placed, unplaced };
}

/** The team's mood on one day it may show. */
export interface MoodPoint {
  day: number;
  date: string;
  /** Mean of the day's check-ins, 1–5. */
  average: number;
  /** Check-ins that day. */
  n: number;
}

/**
 * The team's mood on the board's days: named check-ins and anonymous pulse
 * answers alike, example and placeholder rows left out. Only days with at
 * least MIN_SAMPLE.anonymous (3) check-ins show, and never a name. Nothing
 * without a sprint (there are no dates).
 */
export function teamMoodLine(
  entries: readonly MoodEntry[] | undefined | null,
  pulses: readonly MoodPulse[] | undefined | null,
  sprint: Pick<Sprint, "startDate" | "endDate"> | null | undefined
): MoodPoint[] {
  if (!sprint) return [];
  const days = seismographDays(sprint).filter((d) => d.date);
  if (days.length === 0) return [];
  const dayOf = new Map(days.map((d) => [d.date as string, d.day]));
  const daily = dailyMood(
    realEntries(entries),
    realPulses(pulses),
    days.map((d) => d.date as string)
  );
  return teamLevelDays(daily).flatMap((d) => {
    const day = dayOf.get(d.date);
    return day === undefined || d.average === null
      ? []
      : [{ day, date: d.date, average: d.average, n: d.n }];
  });
}

/** The days the read lines name: "day 7", "days 7–9". */
function dayRange(from: number, to: number): string {
  return from === to ? `day ${from}` : `days ${from}–${to}`;
}

/** "day 4", "days 4 and 6", "days 2, 4 and 6". */
function dayList(days: readonly number[], capital = false): string {
  const word = days.length === 1 ? "day" : "days";
  const list =
    days.length <= 1
      ? String(days[0] ?? "")
      : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
  return `${capital ? word.charAt(0).toUpperCase() + word.slice(1) : word} ${list}`;
}

/** Moments of one band bunched on up to three days in a row, when more than half of them are. */
function bunched(
  placed: readonly PlacedMoment[],
  band: SeismographBand,
  word: string
): string | null {
  const days = placed.filter((m) => m.band === band).map((m) => m.day);
  if (days.length < 3) return null;
  let best: { count: number; from: number; to: number } | null = null;
  for (const start of Array.from(new Set(days)).sort((a, b) => a - b)) {
    const inside = days.filter((d) => d >= start && d <= start + 2);
    if (!best || inside.length > best.count) {
      best = { count: inside.length, from: Math.min(...inside), to: Math.max(...inside) };
    }
  }
  if (!best || best.count * 2 <= days.length) return null;
  return `${best.count} of ${days.length} ${word} came on ${dayRange(best.from, best.to)}.`;
}

/** Read lines at most. */
export const SEISMOGRAPH_READ_MAX = 3;

/**
 * Up to three plain lines on the chart, with no AI: where the lows bunch
 * ("3 of 5 lows came on days 7–9."), the days with both a high and a low,
 * a day the team's mood dipped under LOW_MOOD that no card explains, and
 * where the highs bunch.
 */
export function seismographRead(placement: Placement, mood: readonly MoodPoint[] = []): string[] {
  const { placed } = placement;
  const lines: string[] = [];
  const lows = bunched(placed, "lows", "lows");
  if (lows) lines.push(lows);
  const mixed = Array.from(new Set(placed.map((m) => m.day)))
    .sort((a, b) => a - b)
    .filter(
      (d) =>
        placed.some((m) => m.day === d && m.band === "highs") &&
        placed.some((m) => m.day === d && m.band === "lows")
    );
  if (mixed.length > 0) lines.push(`${dayList(mixed, true)} had both a high and a low.`);
  const quiet = mood
    .filter((p) => p.average < LOW_MOOD && !placed.some((m) => m.day === p.day))
    .map((p) => p.day);
  if (quiet.length > 0) {
    lines.push(`The team's mood dipped on ${dayList(quiet)} and no card says why: ask about it.`);
  }
  const highs = bunched(placed, "highs", "highs");
  if (highs) lines.push(highs);
  return lines.slice(0, SEISMOGRAPH_READ_MAX);
}

/** One line of text, for the Markdown. */
const oneLine = (v: unknown) =>
  String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();

/** "Ship the fix (2 votes)"; no count before anyone has voted. */
const withVotes = (m: Moment) =>
  m.votes > 0
    ? `${oneLine(m.text)} (${m.votes} ${m.votes === 1 ? "vote" : "votes"})`
    : oneLine(m.text);

/**
 * The "## Seismograph" section: one line per day with a card or the team's
 * mood ("Day 3 (Wed 12 Nov): ▲ … (2 votes); ▼ …; team mood 3.4"), the
 * read, then the cards with no day.
 */
export function seismographMarkdown(
  placement: Placement,
  days: readonly SeismographDay[],
  mood: readonly MoodPoint[] = []
): string[] {
  const lines = ["", "## Seismograph", ""];
  const moodOn = new Map(mood.map((p) => [p.day, p]));
  let any = false;
  for (const d of days) {
    const here = placement.placed.filter((m) => m.day === d.day);
    const m = moodOn.get(d.day);
    if (here.length === 0 && !m) continue;
    any = true;
    const parts = here.map((x) => `${BAND_MARK[x.band]} ${withVotes(x)}`);
    if (m) parts.push(`team mood ${m.average.toFixed(1)}`);
    const name = d.date ? `Day ${d.day} (${shortDate(d.date)})` : `Day ${d.day}`;
    lines.push(`- ${name}: ${parts.join("; ")}`);
  }
  if (!any) lines.push("No card has a day yet.");
  const read = seismographRead(placement, mood);
  if (read.length > 0) lines.push("", ...read.map((r) => `> ${r}`));
  if (placement.unplaced.length > 0) {
    lines.push(
      "",
      `No day: ${placement.unplaced.map((m) => `${BAND_MARK[m.band]} ${withVotes(m)}`).join("; ")}`
    );
  }
  return lines;
}
