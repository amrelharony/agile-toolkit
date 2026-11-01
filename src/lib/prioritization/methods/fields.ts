/**
 * Reading, writing and checking a method's inputs: the small pieces every
 * method module shares. Pure and server-safe.
 */

import { isIsoDate } from "@/lib/sprints/calendar";
import type { FormErrors, Validation } from "@/lib/utils/form";
import type { ChoiceOption, MethodInput, MethodScore, RowFields, ScaleStep, Values } from "./types";

/** A finite number from a stored field (numbers or numeric strings), else undefined. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** The option id `v` names, else undefined (an unknown value is not set, never a default). */
export function toChoice<T extends string>(options: readonly T[], v: unknown): T | undefined {
  return typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** A real "YYYY-MM-DD" day (anything after the date ignored), else undefined. */
export function toDay(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const day = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && isIsoDate(day) ? day : undefined;
}

/** A trimmed non-empty string, else undefined. */
export function toText(v: unknown, max = 200): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/\s+/g, " ").slice(0, max);
  return t || undefined;
}

/** True when `v` is one of the scale's values. */
export function onScale(steps: readonly ScaleStep[], v: number | undefined): boolean {
  return v !== undefined && steps.some((s) => s.value === v);
}

/** The ids of a choice input's options. */
export const optionIds = (options: readonly ChoiceOption[]): string[] => options.map((o) => o.id);

/**
 * `fields` with `key` set to `v`, or removed when `v` is undefined. Returns
 * the same bag it was given (callers pass a copy).
 */
export function put(out: RowFields, key: string, v: number | string | undefined): RowFields {
  if (v === undefined) delete out[key];
  else out[key] = v;
  return out;
}

/** Only the keys whose value is set. */
export function defined<T extends Record<string, unknown>>(
  o: T
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

/** A number within a range, for messages: "1 to 10", "0.5 or more". */
function rangeText(min: number, max: number | undefined): string {
  return max === undefined ? `${min} or more` : `${min} to ${max}`;
}

/**
 * The errors for a draft by the inputs' own rules: a blank required input
 * gets its `missing` message; a number outside its range, a choice that
 * isn't an option and a day that doesn't exist get theirs. Methods add
 * their own rules (RICE's effort minimum, a fixed date's date) on top.
 */
export function inputErrors(inputs: readonly MethodInput[], draft: Values): FormErrors<string> {
  const errors: FormErrors<string> = {};
  for (const input of inputs) {
    const raw = draft[input.key];
    if (raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
      if (!input.optional) errors[input.key] = input.missing;
      continue;
    }
    switch (input.kind) {
      case "number": {
        const n = toNumber(raw);
        if (n === undefined) errors[input.key] = `${input.label} is a number.`;
        else if (n < input.min || (input.max !== undefined && n > input.max)) {
          errors[input.key] = `${input.label} runs ${rangeText(input.min, input.max)}.`;
        }
        break;
      }
      case "scale": {
        if (toNumber(raw) === undefined) errors[input.key] = input.missing;
        break;
      }
      case "choice": {
        if (toChoice(optionIds(input.options), raw) === undefined)
          errors[input.key] = input.missing;
        break;
      }
      case "date": {
        if (toDay(raw) === undefined) errors[input.key] = `${input.label} is a date (YYYY-MM-DD).`;
        break;
      }
      case "person": {
        if (toText(raw) === undefined) errors[input.key] = input.missing;
        break;
      }
    }
  }
  return errors;
}

/** The draft as a validation result: the errors, or the values with every blank dropped. */
export function toValidation(
  draft: Values,
  errors: FormErrors<string>
): Validation<Values, string> {
  if (Object.values(errors).some(Boolean)) return { ok: false, errors };
  return { ok: true, values: defined(draft) as Values };
}

/** "Not scored": what a method returns while `missing` inputs aren't set. */
export function notScored(missing: string[], warnings: string[] = []): MethodScore {
  return { score: null, bucket: null, sortKey: null, missing, warnings };
}

/** The input keys of `inputs` that are required and not set in `v`. */
export function missingKeys(inputs: readonly MethodInput[], v: Values): string[] {
  return inputs.filter((i) => !i.optional && v[i.key] === undefined).map((i) => i.key);
}

/** A number for display, up to `digits` decimal places, grouped ("12,345.5"). */
export function formatNumber(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return (Object.is(r, -0) ? 0 : r).toLocaleString("en-US", { maximumFractionDigits: digits });
}
