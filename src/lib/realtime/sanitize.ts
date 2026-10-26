/**
 * Text checks for anything a realtime peer sends us.
 *
 * Shared by owner/guest presence (`use-presence.ts`), Planning Poker's
 * player names and the visitor live rooms. Pure, with no browser globals,
 * so server code and tests can import it too.
 */

/** `isValidSession`'s cap on a participant name. */
export const MAX_NAME_LENGTH = 80;

/**
 * C0 control characters plus the Unicode bidi formatting characters and
 * directional marks. Built from a string of `\u` escapes so the source
 * stays pure ASCII: the raw characters are invisible in most editors and
 * get mangled by normalisation passes and git filters.
 *
 *   U+0000-U+001F, U+007F  C0 controls and DEL
 *   U+061C                 ALM  Arabic Letter Mark
 *   U+200E, U+200F         LRM, RLM
 *   U+202A-U+202E          LRE, RLE, PDF, LRO, RLO (embeddings, overrides)
 *   U+2066-U+2069          LRI, RLI, FSI, PDI (isolates)
 *
 * A peer could use these to flip how a name renders ("Alice" reading as
 * someone else's) or to mangle nameplates and devtools readouts.
 *
 * One shared instance: keep it without the `g` flag, or `.test()` would
 * carry `lastIndex` between calls.
 */
export const CONTROL_OR_BIDI_RE = new RegExp(
  "[\\u0000-\\u001F\\u007F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]"
);

/** True when `s` contains a control, bidi formatting or directional-mark character. */
export function hasControlOrBidi(s: string): boolean {
  return CONTROL_OR_BIDI_RE.test(s);
}

/**
 * A name as it's stored: one line, single spaces, within the validator's
 * cap. Never rejects; use `cleanName` for text from a peer or a visitor.
 */
export function cleanPlayerName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH).trim();
}

/**
 * `cleanPlayerName`, but for untrusted input: null for a non-string, a
 * name that is blank once cleaned, or one with control or bidi characters
 * (whitespace such as tabs and newlines is collapsed first, so those pass).
 */
export function cleanName(raw: unknown, max: number = MAX_NAME_LENGTH): string | null {
  if (typeof raw !== "string") return null;
  const name = clip(raw.trim().replace(/\s+/g, " "), max);
  if (name.length === 0 || hasControlOrBidi(name)) return null;
  return name;
}

/**
 * One line of user text (a retro card, a story title) from an untrusted
 * source: whitespace collapsed to single spaces, trimmed, cut to `max`
 * characters. Null for a non-string, empty text, or text with control or
 * bidi characters. Rendered only as React text, never as HTML.
 */
export function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string" || max <= 0) return null;
  const text = clip(raw.replace(/\s+/g, " ").trim(), max);
  if (text.length === 0 || hasControlOrBidi(text)) return null;
  return text;
}

const CONTROL_OR_BIDI_GLOBAL = new RegExp(CONTROL_OR_BIDI_RE.source, "g");

/**
 * The host's own text made safe to share with a room: one line, hidden
 * characters stripped (not refused: it's the host's text, typed or pasted
 * in its own tool), cut to `max`. "" when nothing is left. Peers still
 * check what they receive with `cleanText`; this keeps the host from
 * sending something they would refuse.
 */
export function shareableText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").replace(CONTROL_OR_BIDI_GLOBAL, "");
  return cleanText(flat, max) ?? "";
}

/**
 * Whether `value` serialises to at most `maxChars` JSON characters. False
 * for anything that can't be serialised. Use on inbound broadcasts before
 * doing any real work on them.
 */
export function isWithinJsonSize(value: unknown, maxChars: number): boolean {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" && json.length <= maxChars;
  } catch {
    return false;
  }
}

/** `s` cut to `max` UTF-16 units without leaving half a surrogate pair, then re-trimmed. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return s.slice(0, end).trim();
}
