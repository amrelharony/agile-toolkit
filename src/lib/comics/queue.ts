/**
 * The weekly queue's rules: release dates, how long the queue lasts, and which
 * numbers a reorder may touch. Pure, so the route and the portal agree.
 */

import { everReleased, publishProblems, unreviewedPanels, type OwnerStory } from "./story-input";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const RELEASE_HOUR_UTC = 7;
const MONDAY = 1;

/** Episodes that go out together on launch day. */
export const LAUNCH_EPS = [27, 28, 29, 30] as const;
/** Under this many weeks of stories, the portal warns. */
export const QUEUE_WARNING_WEEKS = 4;

const LAUNCH_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 07:00 UTC on a yyyy-mm-dd date, or null if there's no such day. */
export function releaseSlot(date: string): Date | null {
  const match = LAUNCH_DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const slot = new Date(Date.UTC(year, month - 1, day, RELEASE_HOUR_UTC));
  return slot.getUTCMonth() === month - 1 && slot.getUTCDate() === day ? slot : null;
}

/** The first Monday 07:00 UTC strictly after `after`. */
export function nextMondaySlot(after: Date): Date {
  const slot = new Date(
    Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), RELEASE_HOUR_UTC)
  );
  const toMonday = (MONDAY - slot.getUTCDay() + 7) % 7;
  slot.setUTCDate(slot.getUTCDate() + toMonday);
  if (slot.getTime() <= after.getTime()) slot.setUTCDate(slot.getUTCDate() + 7);
  return slot;
}

export interface ScheduledRelease {
  ep: number;
  releaseAt: string;
}

/**
 * Launch-day episodes get that date, then one per Monday in number order. Null
 * if the date isn't a real one. Numbers are sorted here, so the caller's order
 * can't put a later story ahead of an earlier one.
 */
export function scheduleQueue(
  eps: readonly number[],
  launchDate: string
): ScheduledRelease[] | null {
  const launch = releaseSlot(launchDate);
  if (!launch) return null;
  const sorted = Array.from(new Set(eps)).sort((a, b) => a - b);
  const plan: ScheduledRelease[] = [];
  let last = launch;
  for (const ep of sorted) {
    if ((LAUNCH_EPS as readonly number[]).includes(ep)) {
      plan.push({ ep, releaseAt: launch.toISOString() });
      continue;
    }
    last = nextMondaySlot(last);
    plan.push({ ep, releaseAt: last.toISOString() });
  }
  return plan;
}

type QueueStory = Pick<OwnerStory, "ep" | "collection" | "releaseAt" | "firstReleasedAt">;

/**
 * Weekly stories that have never been out, drafts included, in number order. A
 * story that was out and got unpublished isn't one: its number is fixed, and
 * sending it out again is a decision for its own page.
 */
export function unreleasedWeekly<T extends QueueStory>(stories: readonly T[], now: number): T[] {
  return stories
    .filter((s) => s.collection === "weekly" && !everReleased(s, now))
    .sort((a, b) => a.ep - b.ep);
}

/** Whole weeks until the last scheduled story goes out. 0 when nothing is scheduled. */
export function queueWeeksLeft(stories: readonly QueueStory[], now: number): number {
  const last = stories.reduce((latest, s) => {
    if (s.collection !== "weekly" || !s.releaseAt) return latest;
    return Math.max(latest, Date.parse(s.releaseAt));
  }, 0);
  return last > now ? Math.floor((last - now) / WEEK_MS) : 0;
}

export type ReorderCheck =
  | { ok: true; slots: number[]; order: number[] }
  | {
      ok: false;
      error: "invalid_order" | "not_in_queue" | "incomplete_story" | "needs_review";
      ep?: number;
    };

/**
 * Whether `order` is a legal new order for the numbers it names. Those numbers
 * are the slots: each keeps its release date and takes the next story in the
 * order, so moving a story up really does bring it out sooner. A story that has
 * ever been out can't be one of them, its number is fixed, and a story moving
 * into a dated slot has to be fit to publish, or a reorder would get round the
 * release check. That includes a draft with unreviewed panels; one that already
 * has a date was given a yes when it got it.
 */
export function checkReorder(
  stories: readonly OwnerStory[],
  order: unknown,
  now: number
): ReorderCheck {
  if (!Array.isArray(order) || order.length < 2 || order.length > 200) {
    return { ok: false, error: "invalid_order" };
  }
  if (!order.every((ep) => Number.isInteger(ep)) || new Set(order).size !== order.length) {
    return { ok: false, error: "invalid_order" };
  }
  const eps = order as number[];
  const byEp = new Map(stories.map((s) => [s.ep, s]));
  for (const ep of eps) {
    const story = byEp.get(ep);
    if (!story || story.collection !== "weekly" || everReleased(story, now)) {
      return { ok: false, error: "not_in_queue", ep };
    }
  }
  const slots = [...eps].sort((a, b) => a - b);
  for (let i = 0; i < slots.length; i += 1) {
    const slot = byEp.get(slots[i])!;
    const incoming = byEp.get(eps[i])!;
    if (slot.releaseAt && publishProblems(incoming).length > 0) {
      return { ok: false, error: "incomplete_story", ep: incoming.ep };
    }
    if (slot.releaseAt && !incoming.releaseAt && unreviewedPanels(incoming) > 0) {
      return { ok: false, error: "needs_review", ep: incoming.ep };
    }
  }
  return { ok: true, slots, order: eps };
}

/** The new order after swapping one queued story with its neighbour. */
export function swapInQueue(eps: readonly number[], ep: number, step: -1 | 1): number[] | null {
  const at = eps.indexOf(ep);
  const to = at + step;
  if (at < 0 || to < 0 || to >= eps.length) return null;
  const next = [...eps];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}
