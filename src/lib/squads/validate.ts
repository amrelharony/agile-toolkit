/**
 * Pure validation helpers — no server-only dependencies, safe to import
 * from client components for inline form feedback.
 */

/**
 * Display-name allowlist: 1-60 chars, strip RTL-overrides and other
 * non-printing characters, NFC-normalize.
 *
 * Covers:
 *   * C0 controls (\x00-\x1f), DEL (\x7f)
 *   * Soft hyphen (­) — renders invisible, splits words on copy
 *   * Arabic letter mark (؜) — bidi-affecting
 *   * Zero-width family (​ ZWSP, ‌ ZWNJ, ‍ ZWJ) —
 *     enables homograph spoofing: 'Alice' vs 'Alice​' compare
 *     unequal but render identically
 *   * Bidi controls (‎ LRM, ‏ RLM, ‪-‮ LRE/RLE/PDF/
 *     LRO/RLO, ⁦-⁩ LRI/RLI/FSI/PDI)
 *   * Line/paragraph separators ( ,  )
 *   * BOM / zero-width no-break space (﻿)
 *
 * Enumerated by unicode escape so the regex is grep-able and the file
 * doesn't depend on what your editor happens to render for invisibles.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BIDI = new RegExp(
  "[" +
    "\\x00-\\x1f" +
    "\\x7f" +
    "\\u00ad" +
    "\\u061c" +
    "\\u200b-\\u200f" +
    "\\u202a-\\u202e" +
    "\\u2028\\u2029" +
    "\\u2066-\\u2069" +
    "\\ufeff" +
    "]",
  "g"
);

export function sanitizeDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.normalize("NFC").replace(CONTROL_OR_BIDI, "").trim();
  if (cleaned.length < 1 || cleaned.length > 60) return null;
  return cleaned;
}

/**
 * Same defenses as sanitizeDisplayName but sized for squad names
 * (1-80 chars). Owners can use spaces / punctuation freely; we just
 * block the bidi/zero-width/control-char family that survives
 * storage and re-renders to attack a viewer (the squad name is
 * echoed to guests in the redeem response).
 */
export function sanitizeSquadName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.normalize("NFC").replace(CONTROL_OR_BIDI, "").trim();
  if (cleaned.length < 1 || cleaned.length > 80) return null;
  return cleaned;
}

/**
 * Validate a path segment used in `/guest/[tool]/[entityId]` and
 * sibling routes. Next.js URL segments accept up to ~2 KB each; the
 * downstream log endpoint caps entity_id at 200 chars, so accepting
 * larger values at the page layer just confuses the user with a
 * page that loads then refuses every action. Reject anything > 200
 * chars or containing control characters.
 *
 * Returns the input unchanged on success, or null when the input
 * fails validation — callers use the null return to render a 404.
 */
// eslint-disable-next-line no-control-regex
const SEGMENT_CONTROL = /[\x00-\x1f\x7f]/;
export function isValidGuestPathSegment(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (raw.length < 1 || raw.length > 200) return false;
  if (SEGMENT_CONTROL.test(raw)) return false;
  return true;
}
