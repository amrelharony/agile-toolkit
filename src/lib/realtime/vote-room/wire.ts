/**
 * The vote rooms' shared wire checks: id and key shapes, and the small
 * readers every kind of round uses (scale questions, pairs, allocations).
 *
 * Internal to the kit: `index.ts` doesn't re-export it. Pure and
 * server-safe, like the rest of the protocol.
 */

import { cleanText } from "../sanitize";

/** Questionnaire, sheet, scale, question and item ids: up to `VOTE_LIMITS.maxIdChars`. */
export const ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;
/** Round and ballot ids: nanoid(12). */
export const ROUND_ID_RE = /^[A-Za-z0-9_-]{12}$/;
/** A raw P-256 public key (65 bytes), unpadded base64url. */
export const KEY_RE = /^[A-Za-z0-9_-]{87}$/;
/** A 12-byte AES-GCM nonce, unpadded base64url. */
export const IV_RE = /^[A-Za-z0-9_-]{16}$/;
export const B64URL_RE = /^[A-Za-z0-9_-]+$/;

/** What an id must look like, for the host's "can't be shared live" sentences. */
export const ID_RULE = "use up to 64 letters, digits, ':', '_' or '-'";

/** A plain object (not null, not an array), or null. */
export const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A whole number from 0 to `max`. */
export const isCount = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** Text a participant will render: exactly what `cleanText` makes of it (never empty). */
export const isCleanText = (v: unknown, max: number): v is string =>
  typeof v === "string" && cleanText(v, max) === v;

/** One Markdown table cell: one line, pipes escaped. */
export function mdCell(text: string): string {
  return text
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** Unpadded base64url length of `bytes` bytes. */
export function b64urlChars(bytes: number): number {
  return Math.floor(bytes / 3) * 4 + (bytes % 3 === 0 ? 0 : (bytes % 3) + 1);
}
