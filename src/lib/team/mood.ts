/**
 * The team's mood, read from Mood Tracker check-ins: shared by the Mood
 * Tracker page and its agent actions, the retro's facts and Sprint
 * Comparison, so every one of them quotes the same average. Pure and
 * server-safe.
 *
 * A check-in is either a person's own (a `MoodEntry`: named, one per person
 * per day) or one answer in an anonymous pulse (a `MoodPulse`: how many
 * picked each face on a day, from a vote room or counted by hand, never
 * who). Both count the same: the average is the mean of every check-in.
 * Note-first placeholder rows from older builds and example rows are left
 * out everywhere.
 */

import type {
  HandoffLink,
  MoodEntry,
  MoodPulse,
  MoodTrackerDoc,
} from "@/lib/stores/workspace-types";
import { MOOD_TRACKER_ID } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { addDays, dayOf } from "@/lib/impediments/model";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import type { Questionnaire, VoteScale } from "@/lib/realtime/vote-room/protocol";

export { MOOD_TRACKER_ID };

export type MoodScore = 1 | 2 | 3 | 4 | 5;
export const MOOD_SCORES: readonly MoodScore[] = [1, 2, 3, 4, 5];

/** The faces, 1 to 5, as the page and the vote room name them. */
export const MOOD_LABELS: Readonly<Record<MoodScore, string>> = {
  1: "Rough",
  2: "Low",
  3: "Neutral",
  4: "Good",
  5: "Great",
};

/** A team average at or below this, on enough days in a row, is a low-mood streak. */
export const LOW_MOOD = 2.5;
/** Check-in days in a row it takes (the guide: "three in a row is worth a conversation"). */
export const LOW_MOOD_DAYS = 3;
/** The days the page and `list_state` look back over by default. */
export const MOOD_WINDOW_DAYS = 14;

export const MOOD_NOTE_MAX = 500;

export interface MoodWindow {
  /** Mean score (1–5) to one decimal; null below MIN_SAMPLE.average check-ins. */
  average: number | null;
  /** Check-ins in the window: named ones plus anonymous pulse answers. */
  checkIns: number;
  /** Different people who checked in by name. */
  people: number;
  /** Of `checkIns`, the anonymous pulse answers; present only when there are some. */
  anonymous?: number;
}

export function isMoodScore(v: unknown): v is MoodScore {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
}

/** The named check-ins that count: a real face picked, not an example. */
export function realEntries(entries: readonly MoodEntry[] | undefined | null): MoodEntry[] {
  return (Array.isArray(entries) ? entries : []).filter(
    (m) => m && !m.isPlaceholder && !isExampleId(m.id) && isMoodScore(m.score) && dayOf(m.date)
  );
}

const whole = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0);

/** How many answered a pulse. */
export function pulseTotal(p: Pick<MoodPulse, "counts"> | undefined | null): number {
  return p?.counts ? MOOD_SCORES.reduce((sum, s) => sum + whole(p.counts[s]), 0) : 0;
}

/** The pulses that count: answered by someone, not an example. */
export function realPulses(
  pulses: readonly MoodPulse[] | undefined | null,
  { includeExamples = false }: { includeExamples?: boolean } = {}
): MoodPulse[] {
  return (Array.isArray(pulses) ? pulses : []).filter(
    (p) =>
      p &&
      (includeExamples || !isExampleId(p.id)) &&
      typeof p.date === "string" &&
      dayOf(p.date) &&
      pulseTotal(p) > 0
  );
}

/** Sum and count of every check-in dated `start` to `end` (YYYY-MM-DD, both included). */
function tally(
  entries: readonly MoodEntry[],
  pulses: readonly MoodPulse[],
  start: string,
  end: string
) {
  let sum = 0;
  let named = 0;
  let anonymous = 0;
  const people = new Set<string>();
  const distribution: Record<MoodScore, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const m of entries) {
    const day = dayOf(m.date);
    if (!day || day < start || day > end) continue;
    sum += m.score;
    named++;
    distribution[m.score] += 1;
    people.add(m.memberId);
  }
  for (const p of pulses) {
    const day = dayOf(p.date);
    if (!day || day < start || day > end) continue;
    for (const s of MOOD_SCORES) {
      const n = whole(p.counts[s]);
      sum += s * n;
      anonymous += n;
      distribution[s] += n;
    }
  }
  return { sum, named, anonymous, n: named + anonymous, people: people.size, distribution };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Mood from the check-ins dated `start` to `end` (YYYY-MM-DD, both
 * included): named check-ins and, when given, anonymous pulse answers.
 */
export function moodDuring(
  entries: readonly MoodEntry[] | undefined,
  start: string,
  end: string,
  pulses?: readonly MoodPulse[]
): MoodWindow {
  const t = tally(realEntries(entries), realPulses(pulses), start, end);
  return {
    average: t.n >= MIN_SAMPLE.average ? round1(t.sum / t.n) : null,
    checkIns: t.n,
    people: t.people,
    ...(t.anonymous > 0 ? { anonymous: t.anonymous } : {}),
  };
}

export interface MoodSummary extends MoodWindow {
  /** How many check-ins picked each face. */
  distribution: Record<MoodScore, number>;
  /** Days in the window with at least one check-in. */
  days: number;
}

export interface MoodReadOptions {
  /** Count example rows too (the page's example preview does). */
  includeExamples?: boolean;
}

/**
 * The Mood Tracker headline (the page and `tool.mood_tracker.list_state`):
 * the window's average, from MIN_SAMPLE.average check-ins, the same number
 * `moodDuring` gives the retro and Sprint Comparison, plus the faces picked
 * and how many days had check-ins.
 */
export function moodSummary(
  entries: readonly MoodEntry[] | undefined,
  pulses: readonly MoodPulse[] | undefined,
  start: string,
  end: string,
  { includeExamples = false }: MoodReadOptions = {}
): MoodSummary {
  const named = includeExamples
    ? (entries ?? []).filter((m) => m && !m.isPlaceholder && isMoodScore(m.score))
    : realEntries(entries);
  const anon = realPulses(pulses, { includeExamples });
  const t = tally(named, anon, start, end);
  const daily = dailyMood(named, anon, windowDays(start, end));
  return {
    average: t.n >= MIN_SAMPLE.average ? round1(t.sum / t.n) : null,
    checkIns: t.n,
    people: t.people,
    ...(t.anonymous > 0 ? { anonymous: t.anonymous } : {}),
    distribution: t.distribution,
    days: daily.filter((d) => d.n > 0).length,
  };
}

/** Every day from `start` to `end`, oldest first (at most a year, so a typo can't hang a page). */
export function windowDays(start: string, end: string): string[] {
  const out: string[] = [];
  let day = start;
  while (day <= end && out.length < 366) {
    out.push(day);
    day = addDays(day, 1);
  }
  return out;
}

/** The `n` days ending `today`, oldest first. */
export function lastDays(today: string, n: number): string[] {
  return windowDays(addDays(today, -(Math.max(1, n) - 1)), today);
}

export interface DailyMood {
  date: string;
  /** Mean of the day's check-ins; null with none. */
  average: number | null;
  /** Check-ins that day. */
  n: number;
}

/** The team's mean mood per day (named and anonymous check-ins alike). */
export function dailyMood(
  entries: readonly MoodEntry[] | undefined,
  pulses: readonly MoodPulse[] | undefined,
  days: readonly string[]
): DailyMood[] {
  const named = Array.isArray(entries) ? entries : [];
  const anon = Array.isArray(pulses) ? pulses : [];
  return days.map((date) => {
    const t = tally(named, anon, date, date);
    return { date, average: t.n > 0 ? t.sum / t.n : null, n: t.n };
  });
}

export interface LowMoodStreak {
  /** First and last check-in day of the run. */
  start: string;
  end: string;
  /** Check-in days in the run. */
  days: number;
  /** Mean of the run's check-ins, to one decimal. */
  average: number;
  checkIns: number;
}

/**
 * The team's current low-mood run: the latest check-in days, counting back
 * from the newest, whose team average was at most `threshold`, when there
 * are at least `minDays` of them in a row. Days nobody checked in are
 * skipped, not a break. Team level only: a day counts only with
 * `minPerDay` check-ins (MIN_SAMPLE.anonymous), so a "team" streak is never
 * one person's mood. Null when the newest counted day isn't low.
 */
export function lowMoodStreak(
  entries: readonly MoodEntry[] | undefined,
  pulses: readonly MoodPulse[] | undefined,
  today: string,
  {
    threshold = LOW_MOOD,
    minDays = LOW_MOOD_DAYS,
    windowDays: span = MOOD_WINDOW_DAYS,
    minPerDay = MIN_SAMPLE.anonymous,
    includeExamples = false,
  }: {
    threshold?: number;
    minDays?: number;
    windowDays?: number;
    minPerDay?: number;
    includeExamples?: boolean;
  } = {}
): LowMoodStreak | null {
  const named = includeExamples
    ? (entries ?? []).filter((m) => m && !m.isPlaceholder && isMoodScore(m.score))
    : realEntries(entries);
  const anon = realPulses(pulses, { includeExamples });
  const days = dailyMood(named, anon, lastDays(today, span)).filter((d) => d.n >= minPerDay);
  const run: DailyMood[] = [];
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.average === null || d.average > threshold) break;
    run.unshift(d);
  }
  if (run.length < minDays) return null;
  const checkIns = run.reduce((sum, d) => sum + d.n, 0);
  const sum = run.reduce((s, d) => s + (d.average as number) * d.n, 0);
  return {
    start: run[0].date,
    end: run[run.length - 1].date,
    days: run.length,
    average: round1(sum / checkIns),
    checkIns,
  };
}

/* ── Settings ─────────────────────────────────────────────────────────── */

export type MoodMode = MoodTrackerDoc["mode"];

/**
 * How the team checks in. With no settings saved the tracker works as it
 * always has, by name; switching to anonymous is a choice the team makes.
 */
export function moodMode(doc: MoodTrackerDoc | undefined | null): MoodMode {
  return doc?.mode === "anonymous" ? "anonymous" : "named";
}

export function moodTrackerDoc(doc: MoodTrackerDoc | undefined | null): MoodTrackerDoc {
  return {
    id: MOOD_TRACKER_ID,
    mode: moodMode(doc),
    ...(doc?.streaks ? { streaks: doc.streaks } : {}),
  };
}

/** The settings with the links of the streak starting `start` changed. */
export function withStreakLinks(
  doc: MoodTrackerDoc | undefined | null,
  streak: Pick<LowMoodStreak, "start" | "end">,
  update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
): MoodTrackerDoc {
  const base = moodTrackerDoc(doc);
  const streaks = base.streaks ?? [];
  const at = streaks.findIndex((s) => s.start === streak.start);
  const prev = at >= 0 ? streaks[at] : { start: streak.start, end: streak.end };
  const sentTo = update(prev.sentTo);
  const next = { ...prev, end: streak.end, sentTo };
  return {
    ...base,
    streaks: at >= 0 ? streaks.map((s, i) => (i === at ? next : s)) : [...streaks, next],
  };
}

/** The saved links for the streak starting `start`. */
export function streakLinks(
  doc: MoodTrackerDoc | undefined | null,
  start: string
): HandoffLink[] | undefined {
  return doc?.streaks?.find((s) => s.start === start)?.sentTo;
}

/* ── Check-ins ────────────────────────────────────────────────────────── */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Why `day` can't date a check-in, or null: not a real day, or after `today`. */
export function moodDateProblem(day: string | undefined | null, today: string): string | null {
  if (typeof day !== "string" || !DAY_RE.test(day) || dayOf(day) !== day) return "Pick a day.";
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
    return "Pick a day.";
  }
  if (day > today) return "A check-in can't be for a day that hasn't happened yet.";
  return null;
}

/**
 * Entries with `memberId`'s check-in for `date` set: one per person per day,
 * so a second check-in replaces the first (keeping its id). A note-first
 * placeholder from an older build becomes the real check-in. `loggedAt` is
 * stamped when the day is filled in afterwards.
 */
export function upsertCheckIn(
  entries: readonly MoodEntry[],
  input: { memberId: string; date: string; score: MoodScore; note?: string },
  { id, today, now }: { id: string; today: string; now: string }
): { entries: MoodEntry[]; entry: MoodEntry; replaced: MoodEntry | null } {
  const at = entries.findIndex(
    (e) => e.memberId === input.memberId && dayOf(e.date) === input.date
  );
  const note = input.note?.trim().slice(0, MOOD_NOTE_MAX) || undefined;
  const prev = at >= 0 ? entries[at] : null;
  const entry: MoodEntry = {
    id: prev?.id ?? id,
    memberId: input.memberId,
    date: input.date,
    score: input.score,
    ...(note ? { note } : {}),
    ...(input.date < today ? { loggedAt: now } : {}),
  };
  const next = entries.slice();
  if (at >= 0) next[at] = entry;
  else next.push(entry);
  return { entries: next, entry, replaced: prev };
}

/** The entry for `memberId` on `date`, if any (placeholders included, so they can be cleared). */
export function checkInFor(
  entries: readonly MoodEntry[] | undefined,
  memberId: string,
  date: string
): MoodEntry | undefined {
  return (entries ?? []).find((e) => e.memberId === memberId && dayOf(e.date) === date);
}

/* ── The vote room ────────────────────────────────────────────────────── */

export const MOOD_VOTE_SCALE: VoteScale = {
  id: "mood-faces",
  points: MOOD_SCORES.map((s) => ({ value: s, label: MOOD_LABELS[s] })),
};

/** One question, the five faces; anonymous, so the room saves a pulse, never a person's mood. */
export function moodQuestionnaire(): Questionnaire {
  return {
    id: "mood-tracker",
    title: "Team mood",
    scale: MOOD_VOTE_SCALE,
    questions: [{ id: "mood", text: "How are you today?" }],
  };
}

export function emptyPulseCounts(): Record<MoodScore, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

/**
 * A saved round's counts per face, by each point's value. Null when the
 * question was withheld (fewer than minN answers): no pulse, rather than a
 * pulse of zeros.
 */
export function pulseCountsFromResult(
  result: Pick<VoteRoundResult, "questions" | "scale">
): Record<MoodScore, number> | null {
  const q = result.questions[0];
  if (!q?.distribution) return null;
  const counts = emptyPulseCounts();
  result.scale.points.forEach((p, i) => {
    if (isMoodScore(p.value)) counts[p.value] += whole(q.distribution?.[i]);
  });
  return MOOD_SCORES.some((s) => counts[s] > 0) ? counts : null;
}

/**
 * Pulse counts typed in by an agent, checked as the page's count entry
 * checks them: whole numbers, 0 or more, and at least MIN_SAMPLE.anonymous
 * answers in all (fewer would show what one or two people feel).
 */
export function checkPulseCounts(
  counts: Partial<Record<string, number>> | undefined
): { ok: true; counts: Record<MoodScore, number>; total: number } | { ok: false; reason: string } {
  const out = emptyPulseCounts();
  for (const s of MOOD_SCORES) {
    const n = counts?.[String(s)] ?? 0;
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, reason: `counts.${s} is a whole number, 0 or more.` };
    }
    out[s] = n;
  }
  const total = MOOD_SCORES.reduce((sum, s) => sum + out[s], 0);
  if (total < MIN_SAMPLE.anonymous) {
    return {
      ok: false,
      reason: `A pulse needs at least ${MIN_SAMPLE.anonymous} answers, so no one's mood can be singled out; this has ${total}.`,
    };
  }
  if (total > 999) return { ok: false, reason: "At most 999 answers in one pulse." };
  return { ok: true, counts: out, total };
}

/** A pulse's mean face, or null with no answers. */
export function pulseAverage(p: Pick<MoodPulse, "counts">): number | null {
  const n = pulseTotal(p);
  if (n === 0) return null;
  return MOOD_SCORES.reduce((sum, s) => sum + s * whole(p.counts[s]), 0) / n;
}
