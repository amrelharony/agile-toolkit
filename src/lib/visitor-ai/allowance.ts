/**
 * A visitor's allowance with Amr's AI, in words, for the visitor's chat
 * (components/agent/mascot/visitor-agent-panel):
 *
 *   allowanceLine  the status row's one line, never live: the day's messages,
 *                  the busy-hours note while busy hours are on, what Amr does
 *                  before a change (not in a live room, where he has no tools)
 *                  and that the chat is not saved
 *   messagesLeft   the messages left now: the day's, or fewer in busy hours;
 *                  unknown again once the Cairo day the route answered in is
 *                  over (dayOver), so the next message asks it
 *   dayOver        the Cairo day the route last answered in is over, its count
 *                  with it (the meter counts by Cairo's day)
 *   lowOnMessages  so few left (LOW_LEFT or fewer) that the line stands out;
 *                  it is never announced (the log is not live either)
 *   peakNote       the busy-hours note ("Busy hours until 12:00: 25 messages
 *                  in this window")
 *   retryCost      what Try again says it spends
 *
 * Plain strings and Intl only (lib/visitor-ai/peak): no React and no agent
 * runtime, so the visitor's chat chunk carries it light, and the tool finder's
 * chunk already holds what it imports. The owner's chat never imports it.
 */

import type { VisitorQuota } from "@/lib/agent/store";
import { VISITOR_AI_DAILY_MESSAGES } from "@/lib/site/disclosures";
import { formatPeakTime, peakWindow } from "./peak";

/** The per-window allowance the busy-hours note names before the route reports one. */
export const PEAK_MESSAGES = 25;

/** This many messages left, or fewer (but some), and the allowance line stands out. */
export const LOW_LEFT = 3;

/** Between the line's parts. */
const DOT = " · ";

let cairoFormat: Intl.DateTimeFormat | null = null;

/** The calendar date in Cairo, the day the route's meter counts by (migration 0037). */
const cairoDate = (d: Date): string =>
  (cairoFormat ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })).format(d);

/**
 * The Cairo day the route last answered in is over by `now`, so the day's
 * count it gave (none left, say) no longer holds: a new day's allowance waits
 * for the next message to ask for it. An allowance with no time on it counts
 * as just now.
 */
export function dayOver(quota: VisitorQuota | null, now: Date): boolean {
  return (
    !!quota &&
    quota.receivedAt !== undefined &&
    cairoDate(new Date(quota.receivedAt)) !== cairoDate(now)
  );
}

/** The busy-hours window the route last reported is over by `now` (its smaller allowance no longer applies). */
export function peakOver(quota: VisitorQuota | null, now: Date): boolean {
  return !!quota?.peak && !!quota.peakEndsAt && new Date(quota.peakEndsAt) <= now;
}

/**
 * A visitor's messages left at `now`: today's, or fewer in busy hours while
 * the window the route reported lasts. Null before the route has said, and
 * again once its Cairo day is over (dayOver): not known until it says again.
 */
export function messagesLeft(quota: VisitorQuota | null, now: Date = new Date()): number | null {
  if (!quota || dayOver(quota, now)) return null;
  return quota.peak && quota.peakRemaining !== null && !peakOver(quota, now)
    ? Math.min(quota.remaining, quota.peakRemaining)
    : quota.remaining;
}

/** So few messages left that the allowance line stands out (none left is the read-only footer's to say). */
export const lowOnMessages = (left: number | null): boolean =>
  left !== null && left > 0 && left <= LOW_LEFT;

/**
 * The busy-hours note, in the visitor's own time ("Busy hours until 12:00: 25
 * messages in this window"), or null outside Z.AI's peak window.
 *
 * The route's word wins once it has answered, either way: busy hours it
 * reports run until the end it gave; and "not busy hours" from it, given
 * during the window the clock expects, means the owner moved or emptied the
 * window (visitor_ai_config), so no note until the route says otherwise.
 * Before the route has answered in the current window, the clock (the default
 * window in lib/visitor-ai/peak) decides, naming the route's per-window limit
 * when it has sent one.
 */
export function peakNote(quota: VisitorQuota | null, now: Date): string | null {
  const reported = quota?.peak && quota.peakEndsAt ? new Date(quota.peakEndsAt) : null;
  if (quota && reported && reported > now) {
    const allowance =
      quota.peakRemaining != null && quota.peakLimit != null
        ? `${quota.peakRemaining} of ${quota.peakLimit} messages left in this window`
        : `${quota.peakLimit ?? PEAK_MESSAGES} messages in this window`;
    return `Busy hours until ${formatPeakTime(reported)}: ${allowance}`;
  }
  const win = peakWindow(now);
  if (!win.on || !win.endsAt) return null;
  if (quota && !quota.peak) {
    const then = peakWindow(quota.receivedAt === undefined ? now : new Date(quota.receivedAt));
    // Answered inside this same window: the route knows better than the clock.
    if (then.on && then.endsAt?.getTime() === win.endsAt.getTime()) return null;
  }
  return `Busy hours until ${formatPeakTime(win.endsAt)}: ${quota?.peakLimit ?? PEAK_MESSAGES} messages in this window`;
}

/**
 * The visitor chat's status line, one line in place of the rows it used to
 * stack: "62 of 100 left today · Busy hours until 12:00: 18 of 25 messages
 * left in this window · Amr asks before changing anything · Not saved". In a
 * live room Amr gets no tools, so the line makes no promise about changes.
 */
export function allowanceLine(quota: VisitorQuota | null, now: Date, liveRoom: boolean): string {
  return [
    // A count from a Cairo day that is over says nothing about today.
    quota && !dayOver(quota, now)
      ? `${quota.remaining} of ${quota.limit} left today`
      : `${VISITOR_AI_DAILY_MESSAGES} AI uses a day`,
    peakNote(quota, now),
    liveRoom ? null : "Amr asks before changing anything",
    "Not saved",
  ]
    .filter(Boolean)
    .join(DOT);
}

/** What Try again costs a visitor with `left` messages (null: not known yet), on its button. */
export const retryCost = (left: number | null): string =>
  left === null
    ? "uses 1 message"
    : left === 1
      ? "uses your last message"
      : `uses 1 of your ${left} left`;
