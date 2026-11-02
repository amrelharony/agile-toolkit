/**
 * What this browser has read of the comic, and where each story's question was
 * sent. One record under the `agile-toolkit:` prefix, so a backup carries it to
 * another device and "Clear data on this browser" removes it
 * (lib/utils/clear-local-data). Nothing here leaves the browser.
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
}

const empty = (): Reading => ({ read: {}, sent: {}, asked: {} });

const isLink = (v: unknown): v is HandoffLink =>
  isRecord(v) && typeof v.route === "string" && typeof v.targetId === "string";

const dates = (v: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string")
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
 * Weeks run Monday to Sunday in UTC, like the releases (Mondays at 07:00 UTC).
 * Day 0 of the epoch was a Thursday, hence the 3.
 */
export function weekNumber(at: Date): number {
  return Math.floor((Math.floor(at.getTime() / 86_400_000) + 3) / 7);
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
