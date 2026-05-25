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
 *   * Line/paragraph separators ( ,  )
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
