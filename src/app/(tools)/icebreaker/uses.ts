import type { Validation } from "@/lib/utils/form";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * The day an icebreaker was used, as the "Mark as used" and "Change date"
 * forms take it. A use can be backdated (the warm-up ran on Monday and is
 * logged on Wednesday), never put in the future.
 */

/** The local calendar day of a use: "2026-10-22". */
export function dayOfUse(usedAt: string): string {
  return todayLocalISO(new Date(usedAt));
}

/**
 * A day as a use's timestamp: local noon, so the day stays the same in
 * every time zone the team syncs to and a backdated use sorts by its day.
 */
export function usedAtFor(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDay(day: string): boolean {
  const m = DAY_RE.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

export interface UseDraft {
  day: string;
}

/** A use's day: required, a real date, today at the latest. */
export function validateUseDay(
  draft: UseDraft,
  today: string
): Validation<{ usedAt: string }, "day"> {
  const day = draft.day.trim();
  if (!day) return { ok: false, errors: { day: "Enter the day it was used." } };
  if (!isRealDay(day)) return { ok: false, errors: { day: "Enter a real date." } };
  if (day > today) return { ok: false, errors: { day: "A use can't be in the future." } };
  return { ok: true, values: { usedAt: usedAtFor(day) } };
}
