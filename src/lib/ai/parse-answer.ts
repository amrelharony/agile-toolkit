/**
 * Read a model's answer as the task's output, tolerantly: models wrap JSON in
 * code fences, add a sentence before it, or get one list item wrong. Here the
 * JSON is found, parsed and checked against the output schema; a list keeps
 * its good items and drops the bad ones, and text over its cap is shortened
 * rather than thrown away.
 *
 * Pure, no server code: the route uses it, and so do the tests and the probe.
 */

import { z, type ZodType } from "zod";

/** The text inside the first ``` fence, or the whole text when there is none. */
export function stripFences(text: string): string {
  const fence = /```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/.exec(text);
  if (fence) return fence[1];
  // An opening fence the answer never closed (cut off, or sloppy).
  const open = /```[a-zA-Z0-9_-]*\s*\n?([\s\S]*)$/.exec(text);
  return open ? open[1] : text;
}

/**
 * The first balanced `{…}` (or `[…]`) in `text`, parsed, or undefined. Strings
 * and escapes are respected, so a brace inside a string never ends the value.
 * Tries up to five starting points, so a stray brace in a sentence before the
 * JSON doesn't hide it.
 */
export function extractJson(text: string, kind: "object" | "array" = "object"): unknown {
  const body = stripFences(text);
  const open = kind === "array" ? "[" : "{";
  const close = kind === "array" ? "]" : "}";
  let from = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const start = body.indexOf(open, from);
    if (start < 0) return undefined;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < body.length; i++) {
      const c = body[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          if (c === close) end = i;
          break;
        }
      }
    }
    if (end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        /* not JSON after all: try the next starting point */
      }
    }
    from = start + 1;
  }
  return undefined;
}

/** The schema inside optional / nullable / default wrappers. */
function unwrap(schema: ZodType): ZodType {
  let s: ZodType = schema;
  for (let i = 0; i < 8; i++) {
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) {
      s = (s as z.ZodOptional<z.ZodType>).unwrap() as ZodType;
    } else break;
  }
  return s;
}

/** Text cut to `max` characters, ending in "…" when it was longer. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Make `value` fit `schema` where it safely can, before the real check:
 *   - a list keeps only the items that pass (each salvaged first), up to its
 *     maximum count;
 *   - text over its maximum length is shortened, ending in "…";
 *   - an object's fields are salvaged one by one; unknown fields are left for
 *     the schema to judge.
 * Anything else is returned as it is. Never throws.
 */
export function salvageArrays(schema: ZodType, value: unknown): unknown {
  const s = unwrap(schema);
  if (s instanceof z.ZodString && typeof value === "string") {
    const max = s.maxLength;
    return typeof max === "number" ? shorten(value, max) : value;
  }
  if (s instanceof z.ZodArray && Array.isArray(value)) {
    const element = s.element as ZodType;
    const kept = value
      .map((item) => salvageArrays(element, item))
      .filter((item) => element.safeParse(item).success);
    const max = (s._zod.bag as { maximum?: number }).maximum;
    return typeof max === "number" ? kept.slice(0, max) : kept;
  }
  if (s instanceof z.ZodObject && value && typeof value === "object" && !Array.isArray(value)) {
    const shape = s.shape as Record<string, ZodType>;
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [key, child] of Object.entries(shape)) {
      if (key in out) out[key] = salvageArrays(child, out[key]);
    }
    return out;
  }
  return value;
}

export type ParsedAnswer<O> = { ok: true; data: O } | { ok: false };

/**
 * The model's text as the task's output: fences stripped, the first JSON value
 * found and parsed, salvaged, then checked with the schema. `{ ok: false }`
 * when there is no JSON or it still doesn't fit.
 */
export function parseAnswer<O>(text: string, schema: ZodType<O>): ParsedAnswer<O> {
  const kind = unwrap(schema) instanceof z.ZodArray ? "array" : "object";
  const raw = extractJson(text, kind);
  if (raw === undefined) return { ok: false };
  const result = schema.safeParse(salvageArrays(schema, raw));
  return result.success ? { ok: true, data: result.data } : { ok: false };
}
