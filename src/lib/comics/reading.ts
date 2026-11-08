/**
 * What this browser has read of the comic, and where each story's question was
 * sent. One record under the `agile-toolkit:` prefix, so a backup carries it to
 * another device and "Clear data on this browser" removes it
 * (lib/utils/clear-local-data). Nothing here leaves the browser: it only decides
 * whether this browser's view, finish or love is a first, for the anonymous
 * counts (lib/comics/stats), and feeds "Your reading".
 *
 * A story counts as read once, the first time its end is reached
 * (components/story-actions), which is what the reading trophies count.
 */

import type { HandoffLink } from "@/lib/handoffs/types";

export const READING_KEY = "agile-toolkit:comics:reading";

interface Reading {
  /** Story number → when it was first read (ISO). */
  read: Record<string, string>;
  /** Story number → its question's hand-off links (the retro topic). */
  sent: Record<string, HandoffLink[]>;
  /** Story number → when its question first went to a retro (ISO): the trophy's count. */
  asked: Record<string, string>;
  /** Story number → the option guessed, or SKIPPED for "Just show me". */
  guessed: Record<string, number>;
  /** Story number → "Seen this at work?": 0 yes, 1 not yet. */
  seen: Record<string, number>;
  /** Story number → when this browser first opened it (ISO). */
  viewed: Record<string, string>;
  /** Story number → when it was loved (ISO). Taking the love back removes it. */
  loved: Record<string, string>;
  /** Story number → seconds of active reading, all visits added up. */
  seconds: Record<string, number>;
}

/** "Just show me": the last panel is out, and no guess was counted. */
export const SKIPPED = -1;

const empty = (): Reading => ({
  read: {},
  sent: {},
  asked: {},
  guessed: {},
  seen: {},
  viewed: {},
  loved: {},
  seconds: {},
});

/** Ten minutes a visit, so even years of weekly reading stays a sane number. */
const MAX_STORED_SECONDS = 1_000_000;

const isLink = (v: unknown): v is HandoffLink =>
  isRecord(v) && typeof v.route === "string" && typeof v.targetId === "string";

const choices = (v: unknown, min: number) =>
  Object.fromEntries(
    Object.entries(isRecord(v) ? v : {}).filter(
      (e): e is [string, number] =>
        Number.isInteger(e[1]) && (e[1] as number) >= min && (e[1] as number) <= 3
    )
  );

const dates = (v: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string")
  );

const durations = (v: unknown) =>
  Object.fromEntries(
    Object.entries(isRecord(v) ? v : {}).filter(
      (e): e is [string, number] =>
        typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] >= 0 && e[1] <= MAX_STORED_SECONDS
    )
  );

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Storage can throw in a private window or with site data blocked. */
function load(): Reading {
  try {
    const raw = localStorage.getItem(READING_KEY);
    if (!raw) return empty();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return empty();
    const sent = isRecord(parsed.sent) ? parsed.sent : {};
    return {
      read: dates(isRecord(parsed.read) ? parsed.read : {}),
      // A damaged or hand-restored entry is dropped, never handed to the hand-off code.
      sent: Object.fromEntries(
        Object.entries(sent).flatMap(([ep, links]) =>
          Array.isArray(links) ? [[ep, links.filter(isLink)]] : []
        )
      ),
      asked: dates(isRecord(parsed.asked) ? parsed.asked : {}),
      guessed: choices(parsed.guessed, SKIPPED),
      seen: choices(parsed.seen, 0),
      viewed: dates(isRecord(parsed.viewed) ? parsed.viewed : {}),
      loved: dates(isRecord(parsed.loved) ? parsed.loved : {}),
      seconds: durations(parsed.seconds),
    };
  } catch {
    return empty();
  }
}

function save(reading: Reading): boolean {
  try {
    localStorage.setItem(READING_KEY, JSON.stringify(reading));
    return true;
  } catch {
    return false;
  }
}

/**
 * Weeks run Sunday to Saturday in UTC, like the releases (Sundays at 07:00 UTC),
 * so each week holds one story. Day 0 of the epoch was a Thursday, hence the 4.
 */
export function weekNumber(at: Date): number {
  return Math.floor((Math.floor(at.getTime() / 86_400_000) + 4) / 7);
}

/** How many weeks in a row, up to `now`'s, have at least one story read. */
export function weekStreak(readAt: readonly string[], now: Date): number {
  const weeks = new Set(readAt.map((iso) => weekNumber(new Date(iso))));
  let week = weekNumber(now);
  let streak = 0;
  while (weeks.has(week)) {
    streak += 1;
    week -= 1;
  }
  return streak;
}

/** Every story this browser has read and when, oldest first. */
export function readStories(): { ep: number; at: string }[] {
  return Object.entries(load().read)
    .map(([ep, at]) => ({ ep: Number(ep), at }))
    .filter((r) => Number.isInteger(r.ep) && !Number.isNaN(Date.parse(r.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.ep - b.ep);
}

/** Sent on window after a story first counts as read, so the page's streak can update. */
export const READ_EVENT = "agile-toolkit:comics:read";

export function hasRead(ep: number): boolean {
  return Object.prototype.hasOwnProperty.call(load().read, String(ep));
}

export interface FirstRead {
  /** Stories read so far, this one included. */
  total: number;
  /** Weeks in a row with a story read, this one included. */
  weekStreak: number;
}

/**
 * Note that story `ep` has been read. Returns null if it already was, or if the
 * note couldn't be kept: a story is only ever counted once.
 */
export function markRead(ep: number, now = new Date()): FirstRead | null {
  const reading = load();
  const key = String(ep);
  if (Object.prototype.hasOwnProperty.call(reading.read, key)) return null;
  reading.read[key] = now.toISOString();
  if (!save(reading)) return null;
  const dates = Object.values(reading.read);
  return { total: dates.length, weekStreak: weekStreak(dates, now) };
}

/**
 * Note that story `ep`'s question has gone to a retro. True the first time only:
 * a send, Undo and send again is still one question.
 */
export function markAsked(ep: number, now = new Date()): boolean {
  const reading = load();
  const key = String(ep);
  if (Object.prototype.hasOwnProperty.call(reading.asked, key)) return false;
  reading.asked[key] = now.toISOString();
  return save(reading);
}

/** What this browser guessed for story `ep`: an option, SKIPPED, or null if nothing yet. */
export function guessFor(ep: number): number | null {
  return load().guessed[String(ep)] ?? null;
}

/**
 * Note the guess (or SKIPPED). True the first time only, so a reload or a second
 * tab can't count the same reader twice. False too when it couldn't be kept.
 */
export function markGuessed(ep: number, choice: number): boolean {
  const reading = load();
  const key = String(ep);
  if (Object.prototype.hasOwnProperty.call(reading.guessed, key)) return false;
  reading.guessed[key] = choice;
  return save(reading);
}

/** This browser's "Seen this at work?" answer for story `ep`, or null. */
export function seenFor(ep: number): number | null {
  return load().seen[String(ep)] ?? null;
}

/** Note the answer. True the first time only, like markGuessed. */
export function markSeen(ep: number, choice: number): boolean {
  const reading = load();
  const key = String(ep);
  if (Object.prototype.hasOwnProperty.call(reading.seen, key)) return false;
  reading.seen[key] = choice;
  return save(reading);
}

/** Where story `ep`'s question has been sent. */
export function sentLinks(ep: number): HandoffLink[] {
  return load().sent[String(ep)] ?? [];
}

export function setSentLinks(
  ep: number,
  update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
): void {
  const reading = load();
  const key = String(ep);
  const next = update(reading.sent[key]);
  if (next.length > 0) reading.sent[key] = next;
  else delete reading.sent[key];
  save(reading);
}

/**
 * Note that this browser has opened story `ep`. True the first time only, which
 * is what the anonymous "visitor" count adds up.
 */
export function markViewed(ep: number, now = new Date()): boolean {
  const reading = load();
  const key = String(ep);
  if (Object.prototype.hasOwnProperty.call(reading.viewed, key)) return false;
  reading.viewed[key] = now.toISOString();
  return save(reading);
}

export function isLoved(ep: number): boolean {
  return Object.prototype.hasOwnProperty.call(load().loved, String(ep));
}

/**
 * Love story `ep`, or take the love back: "changed" when it did and was kept,
 * "unchanged" when it already was so (another tab got there first), and
 * "unavailable" when this browser can't keep it (storage blocked or full).
 */
export function setLoved(
  ep: number,
  on: boolean,
  now = new Date()
): "changed" | "unchanged" | "unavailable" {
  const reading = load();
  const key = String(ep);
  const was = Object.prototype.hasOwnProperty.call(reading.loved, key);
  if (was === on) return "unchanged";
  if (on) reading.loved[key] = now.toISOString();
  else delete reading.loved[key];
  return save(reading) ? "changed" : "unavailable";
}

/**
 * Which loves the server counted from this device: story number → when (ISO).
 * Kept apart from the reading record, and out of backups (lib/data/backup):
 * only a love the server holds is ever taken back from its count, so a love it
 * never counted (the owner's, one that failed to send) can't cancel another
 * reader's, and a love restored onto a second device can't be taken back twice.
 */
export const COUNTED_KEY = "agile-toolkit:comics:counted";

function loadCounted(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COUNTED_KEY) ?? "{}");
    return isRecord(parsed) ? dates(parsed) : {};
  } catch {
    return {};
  }
}

/** Whether the server counted this device's love for story `ep`. */
export function isLoveCounted(ep: number): boolean {
  return Object.prototype.hasOwnProperty.call(loadCounted(), String(ep));
}

/** Note that the server now holds (or no longer holds) this device's love. */
export function setLoveCounted(ep: number, on: boolean, now = new Date()): boolean {
  const counted = loadCounted();
  const key = String(ep);
  if (on) counted[key] = now.toISOString();
  else delete counted[key];
  try {
    localStorage.setItem(COUNTED_KEY, JSON.stringify(counted));
    return true;
  } catch {
    return false;
  }
}

/** Every story this browser loves, most recent first. */
export function lovedStories(): { ep: number; at: string }[] {
  return Object.entries(load().loved)
    .map(([ep, at]) => ({ ep: Number(ep), at }))
    .filter((r) => Number.isInteger(r.ep) && !Number.isNaN(Date.parse(r.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.ep - a.ep);
}

/** Add one visit's active reading time to story `ep`. */
export function addSeconds(ep: number, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const reading = load();
  const key = String(ep);
  reading.seconds[key] = Math.min(
    MAX_STORED_SECONDS,
    Math.round((reading.seconds[key] ?? 0) + seconds)
  );
  save(reading);
}

/** This browser's active reading time, every story added up, in seconds. */
export function totalSeconds(): number {
  return Object.values(load().seconds).reduce((sum, s) => sum + s, 0);
}
