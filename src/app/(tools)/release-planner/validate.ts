/**
 * The checks on the Release Planner's number fields. A field saves only a
 * value that passes; anything else shows its message under the field and
 * the last good value stays (it used to be clamped or dropped silently, so
 * "-5" became 1 without a word). A blank field is valid and means "not
 * set": the scope isn't typed, no scope change, the cadence's length.
 */

import { parseNumber, type Validation } from "@/lib/utils/form";

export type NumberCheck = (raw: string) => Validation<number | null, "value">;

const fail = (message: string): Validation<number | null, "value"> => ({
  ok: false,
  errors: { value: message },
});

/** Typed scope: more than 0 points, at most 100,000 (a typo guard). */
export const validateScopePoints: NumberCheck = (raw) => {
  const n = parseNumber(raw);
  if (n === undefined) return { ok: true, values: null };
  if (!Number.isFinite(n)) return fail("Enter the points left, such as 120.");
  if (n <= 0) return fail("The scope must be more than 0 points.");
  if (n > 100_000) return fail("That's more than 100,000 points. Check the number.");
  return { ok: true, values: n };
};

/**
 * The start of a number, not yet one: "-", "+", "−", ".", "-,". The field
 * waits for the next keystroke instead of flagging it (typing "-5" used to
 * raise an alert on the "-").
 */
export function isPartialNumber(raw: string): boolean {
  return /^\s*[-+−]?\s*[.,]?\s*$/.test(raw) && raw.trim() !== "";
}

/**
 * A percentage as typed: a comma decimal ("12,5") and the minus sign the
 * page prints ("−5") read as 12.5 and -5. A comma before three digits
 * ("1,000") stays a thousands separator, so it is flagged rather than
 * read as 1%.
 */
function percentText(raw: string): string {
  return raw
    .trim()
    .replace(/^[−–]/, "-")
    .replace(/^([-+]?\d*),(\d{1,2})$/, "$1.$2");
}

/** Expected scope change: −90% to +300%. */
export const validateScopeChange: NumberCheck = (raw) => {
  const n = parseNumber(percentText(raw));
  if (n === undefined) return { ok: true, values: null };
  if (!Number.isFinite(n)) return fail("Enter a percentage, such as 10 or -5.");
  if (n < -90 || n > 300) return fail("Use a change from −90% to +300%.");
  return { ok: true, values: n };
};

/** Items left (the "count items" mode): a whole number from 1 to 100,000. */
export const validateItemCount: NumberCheck = (raw) => {
  const n = parseNumber(raw);
  if (n === undefined) return { ok: true, values: null };
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return fail("Use a whole number of items, such as 40.");
  }
  if (n > 100_000) return fail("That's more than 100,000 items. Check the number.");
  return { ok: true, values: n };
};

/** Sprint length: a whole number of days, 1 to 90. */
export const validateSprintLength: NumberCheck = (raw) => {
  const n = parseNumber(raw);
  if (n === undefined) return { ok: true, values: null };
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 90) {
    return fail("Use a whole number of days from 1 to 90.");
  }
  return { ok: true, values: n };
};
