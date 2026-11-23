/**
 * Text cut to a length without splitting a character.
 *
 * `String.slice` counts UTF-16 units, so a cut through an emoji (or any
 * other character outside the basic plane, two units long) keeps half of
 * it: a lone high surrogate. JSON.stringify writes that as "\ud83d", and
 * Postgres jsonb refuses it ("Unicode low surrogate must follow a high
 * surrogate"), so one such story fails the whole stories push on sync.
 *
 * Pure; server-safe.
 */

/** `text` cut to at most `max` UTF-16 units, one shorter when the cut would split a character. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max));
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
