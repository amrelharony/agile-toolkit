/**
 * The Standup page's pure pieces, shared by both of its modes (/standup is
 * the live Daily Scrum, /async-standup the written one): the entry form's
 * draft and checks, how a post or an edit becomes a stored entry, the open
 * blockers and their age, the speaking order and who is out today.
 *
 * The entity helpers every reader shares (the agent actions included) live
 * in lib/standup/entries; this file only adds what the page needs.
 */

import type { StandupEntry, StandupMode } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { addDays, dayOf, daysBetween } from "@/lib/impediments/model";
import { hasBlocker } from "@/lib/standup/entries";

/** Matches people across entries and the roster: trimmed, case-insensitive. */
export const personKey = (name: string | null | undefined) => (name ?? "").trim().toLowerCase();

/** What the agent actions accept per field; the form holds to the same. */
export const ENTRY_TEXT_MAX = 4000;

/* -------------------------------------------------------------------------- */
/*  The entry form                                                            */
/* -------------------------------------------------------------------------- */

export interface EntryDraft {
  member: string;
  /** "YYYY-MM-DD": today unless backdated. */
  date: string;
  yesterday: string;
  today: string;
  blockers: string;
  /** Anything else (stored as the entry's `description`). */
  notes: string;
}

export type EntryField = keyof EntryDraft;

/** A checked draft: trimmed, with a real day. */
export type EntryValues = EntryDraft;

export function emptyDraft(date: string, member = ""): EntryDraft {
  return { member, date, yesterday: "", today: "", blockers: "", notes: "" };
}

/** An existing entry as a draft, for editing it in place. */
export function draftFrom(e: StandupEntry): EntryDraft {
  return {
    member: e.member,
    date: e.date,
    yesterday: e.yesterday ?? "",
    today: e.today ?? "",
    blockers: e.blockers ?? "",
    notes: e.description ?? "",
  };
}

const TOO_LONG = `Keep it under ${ENTRY_TEXT_MAX} characters.`;

/**
 * Check a draft. Who it is and what they're doing today are required; an
 * update with only "yesterday" used to post and then read as a person with
 * no plan. The day can be backdated (a missed standup filled in later) but
 * never set in the future.
 */
export function validateEntry(d: EntryDraft, today: string): Validation<EntryValues, EntryField> {
  const errors: Partial<Record<EntryField, string>> = {};
  const member = d.member.trim();
  if (!member) errors.member = "Pick a team member or type a name.";
  const date = dayOf(d.date);
  if (!date) errors.date = "Pick the day this update is for.";
  else if (date > today) errors.date = "Pick today or an earlier day.";
  if (!d.today.trim()) errors.today = "Say what's planned for today.";
  for (const key of ["yesterday", "today", "blockers", "notes"] as const) {
    if (!errors[key] && d[key].trim().length > ENTRY_TEXT_MAX) errors[key] = TOO_LONG;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      member,
      date: date as string,
      yesterday: d.yesterday.trim(),
      today: d.today.trim(),
      blockers: d.blockers.trim(),
      notes: d.notes.trim(),
    },
  };
}

/** Same blocker text, ignoring surrounding whitespace. */
const sameBlocker = (a: string | undefined, b: string | undefined) =>
  (a ?? "").trim() === (b ?? "").trim();

/**
 * What a blocker's follow-up state carries over to a new version of the
 * entry: whether it was resolved and where it was sent, but only while the
 * blocker text is unchanged. A re-post reporting a NEW blocker must not be
 * born resolved (it would vanish from Open blockers) or look already sent.
 */
function carriedBlockerState(
  prev: StandupEntry | undefined,
  blockers: string
): Pick<StandupEntry, "blockerResolved" | "sentTo"> {
  if (!prev || !sameBlocker(prev.blockers, blockers)) return {};
  return {
    ...(prev.blockerResolved ? { blockerResolved: true } : {}),
    ...(prev.sentTo ? { sentTo: prev.sentTo } : {}),
  };
}

/**
 * The entry a post writes. One entry per person per day across both modes:
 * replacing `existing` keeps its id and first timestamp (blocker ages count
 * from when it was first raised), takes the new post's mode, and keeps the
 * blocker's state only when the blocker is unchanged.
 */
export function postedEntry(
  values: EntryValues,
  mode: StandupMode,
  existing: StandupEntry | undefined,
  now: number,
  newId: () => string = () => crypto.randomUUID()
): StandupEntry {
  return {
    id: existing?.id ?? newId(),
    member: values.member,
    date: values.date,
    yesterday: values.yesterday,
    today: values.today,
    blockers: values.blockers,
    timestamp: existing?.timestamp ?? now,
    mode,
    ...(values.notes ? { description: values.notes } : {}),
    ...carriedBlockerState(existing, values.blockers),
  };
}

/**
 * `entry` edited in place: same id, person, day, mode and timestamp. An old
 * async update comes in as an async entry (lib/standup/entries), so saving
 * it writes a StandupEntry under its id, which replaces it from then on.
 */
export function editedEntry(entry: StandupEntry, values: EntryValues): StandupEntry {
  const next: StandupEntry = {
    ...entry,
    yesterday: values.yesterday,
    today: values.today,
    blockers: values.blockers,
  };
  delete next.blockerResolved;
  delete next.sentTo;
  delete next.description;
  return {
    ...next,
    ...(values.notes ? { description: values.notes } : {}),
    ...carriedBlockerState(entry, values.blockers),
  };
}

/** Whether saving `values` over `entry` would change anything. */
export function sameEntryText(entry: StandupEntry, values: EntryValues): boolean {
  return (
    entry.yesterday.trim() === values.yesterday &&
    entry.today.trim() === values.today &&
    entry.blockers.trim() === values.blockers &&
    (entry.description ?? "").trim() === values.notes
  );
}

/* -------------------------------------------------------------------------- */
/*  Blockers                                                                  */
/* -------------------------------------------------------------------------- */

/** Whole days since the entry's day: 0 for a blocker raised today. */
export function blockerAgeDays(e: Pick<StandupEntry, "date">, today: string): number {
  return dayOf(e.date) ? Math.max(0, daysBetween(e.date, today)) : 0;
}

/** "today", "1 day", "4 days". */
export function ageLabel(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

export type AgeTone = "fresh" | "ageing" | "stale";

/** Raised today, one or two days ago, or three days and more. */
export function ageTone(days: number): AgeTone {
  if (days <= 0) return "fresh";
  return days < 3 ? "ageing" : "stale";
}

/** Blockers no one has resolved yet, oldest first. */
export function openBlockers(entries: readonly StandupEntry[]): StandupEntry[] {
  return entries
    .filter((e) => hasBlocker(e) && !e.blockerResolved)
    .sort((a, b) => a.date.localeCompare(b.date) || a.timestamp - b.timestamp);
}

export function resolvedBlockers(entries: readonly StandupEntry[]): StandupEntry[] {
  return entries
    .filter((e) => hasBlocker(e) && e.blockerResolved)
    .sort((a, b) => b.date.localeCompare(a.date) || b.timestamp - a.timestamp);
}

/* -------------------------------------------------------------------------- */
/*  People                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Who is out of a day's standup (on leave, at a workshop). Kept per day in
 * this browser: marking someone out removes nothing, and the next day
 * starts with everyone back in.
 */
export interface AwayDay {
  date: string;
  names: string[];
}

export const NO_ONE_AWAY: AwayDay = { date: "", names: [] };

/** The names out on `date`; an older day's list no longer counts. */
export function awayOn(state: AwayDay | null | undefined, date: string): string[] {
  return state && state.date === date && Array.isArray(state.names) ? state.names : [];
}

/** `name` marked out of (or back in) `date`'s standup. */
export function withAway(state: AwayDay, date: string, name: string, away: boolean): AwayDay {
  const key = personKey(name);
  const rest = awayOn(state, date).filter((n) => personKey(n) !== key);
  return { date, names: away && key ? [...rest, name.trim()] : rest };
}

const isAway = (away: readonly string[], name: string) =>
  away.some((n) => personKey(n) === personKey(name));

/**
 * Who speaks, in order: the team in roster order, then anyone else who
 * posted that day (a guest, or someone not on the team yet). People out
 * today are left out.
 */
export function speakingOrder(
  roster: readonly string[],
  entries: readonly StandupEntry[],
  date: string,
  away: readonly string[]
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const add = (name: string) => {
    const key = personKey(name);
    if (!key || seen.has(key) || isAway(away, name)) return;
    seen.add(key);
    order.push(name.trim());
  };
  roster.forEach(add);
  entries
    .filter((e) => e.date === date)
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach((e) => add(e.member));
  return order;
}

/* -------------------------------------------------------------------------- */
/*  Participation                                                             */
/* -------------------------------------------------------------------------- */

export interface DayCount {
  date: string;
  count: number;
}

/** Updates per day for the `days` days ending `today`, oldest first. */
export function participation(
  entries: readonly StandupEntry[],
  today: string,
  days = 14
): DayCount[] {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - (days - 1));
    return { date, count: counts.get(date) ?? 0 };
  });
}

/** "Fri 24": short enough for a 14-day strip on a phone. */
export function shortDay(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return date;
  return new Date(t).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Friday 24 October 2026", for headings. */
export function longDay(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return date;
  return new Date(t).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Every entry as CSV rows, newest first. */
export function csvRows(entries: readonly StandupEntry[]): (string | number)[][] {
  return [...entries]
    .sort((a, b) => b.date.localeCompare(a.date) || b.timestamp - a.timestamp)
    .map((e) => [
      e.date,
      e.member,
      e.mode === "async" ? "async" : "live",
      e.yesterday,
      e.today,
      e.blockers,
      hasBlocker(e) ? (e.blockerResolved ? "resolved" : "open") : "",
      e.description ?? "",
    ]);
}

export const CSV_HEADERS = [
  "Date",
  "Member",
  "Mode",
  "Yesterday",
  "Today",
  "Blockers",
  "Blocker",
  "Notes",
];
