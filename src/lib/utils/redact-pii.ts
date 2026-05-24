/**
 * Best-effort PII redactor used by tools that store + export user-
 * supplied prompts, responses, transcripts. NOT a substitute for a
 * proper DLP pipeline — catches common patterns (emails, phone
 * numbers, common API key prefixes, simple credit-card-ish 16-digit
 * sequences). Names are NOT redacted; the user must redact those
 * manually before paste.
 *
 * Used by:
 *   - `src/app/(tools)/rlhf-log/rlhf-log-client.tsx`        (BUG-T7-rlhf-log-1)
 *   - `src/app/(tools)/user-interviews/user-interviews-client.tsx` (BUG-T9-user-interviews-1)
 *   - `src/app/(tools)/hallucination-log/hallucination-log-client.tsx` (BUG-T3-hallucination-log-2)
 */

// Order matters: longest patterns first so they don't get partially
// consumed by a shorter one.
const PATTERNS: Array<{ re: RegExp; label: string }> = [
  // OpenAI / Anthropic / GitHub style prefixes — match the prefix +
  // a long base62 run.
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/g, label: "[redacted:anthropic-key]" },
  { re: /sk-(?:proj-|live-|test-)?[A-Za-z0-9]{16,}/g, label: "[redacted:openai-key]" },
  { re: /AKIA[0-9A-Z]{16}/g, label: "[redacted:aws-access-key-id]" },
  { re: /ghp_[A-Za-z0-9]{30,}/g, label: "[redacted:github-pat]" },
  { re: /github_pat_[A-Za-z0-9_]{50,}/g, label: "[redacted:github-pat]" },
  { re: /xox[abprs]-[A-Za-z0-9-]{10,}/g, label: "[redacted:slack-token]" },
  // Email addresses (RFC-light, good enough for log redaction).
  {
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    label: "[redacted:email]",
  },
  // International-ish phone numbers: optional + and country code, then
  // 7–14 digits possibly with spaces/dashes/parens. Anchored to word
  // boundaries to avoid eating digits inside identifiers.
  {
    re: /(?:(?<=\s)|^)\+?\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?=\s|$|[^\d])/g,
    label: "[redacted:phone]",
  },
  // 13–19 digit numbers that look like credit cards (with optional
  // dashes/spaces). Conservative — won't match plain UUIDs.
  {
    re: /\b(?:\d[ -]?){13,18}\d\b/g,
    label: "[redacted:cc]",
  },
];

/**
 * Apply redaction patterns to a string. Pure function; safe to call
 * on user-supplied text before persisting or exporting.
 */
export function redactPii(input: string): string {
  let out = input;
  for (const { re, label } of PATTERNS) {
    out = out.replace(re, label);
  }
  return out;
}

/** True when at least one PII pattern matches anywhere in the input.
 *  Useful for surfacing an inline "looks like PII" warning before save. */
export function looksLikePii(input: string): boolean {
  for (const { re } of PATTERNS) {
    // Need a fresh regex each time — global regexes carry lastIndex
    // state. Rebuild from source/flags.
    if (new RegExp(re.source, re.flags.replace("g", "")).test(input)) {
      return true;
    }
  }
  return false;
}
