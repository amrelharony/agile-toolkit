/**
 * Who may read the colour edition of "Agile at Work".
 *
 * The printed book carries a QR code for /agile-at-work/color/<key>. Opening
 * it stores the key in an httpOnly cookie scoped to the colour edition, and
 * the colour page and its PDF route check that cookie on every request. The
 * link itself is the credential: anyone holding the book (or a photo of its
 * QR code) can read the colour edition, which is the intended trade-off for
 * a printed code that can never change.
 *
 * Only SHA-256 hashes of the keys live in the repo, so the source never holds
 * a working link. Keys are random (60 bits), so a hash can't be reversed by
 * guessing. Uses Web Crypto: safe on the Node and edge runtimes alike.
 */

export const COLOR_EDITION_COOKIE = "agile-toolkit:comic-color";
/** Sent only to the colour page and its PDF, never to the rest of the site. */
export const COLOR_EDITION_COOKIE_PATH = "/agile-at-work/color";
/** 400 days: the longest a browser keeps a cookie (Chrome caps it there). */
export const COLOR_EDITION_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/**
 * One hash per printed QR code. To add a print run, hash a new random key
 * (`node -e "…createHash('sha256').update(key).digest('hex')"`) and append it.
 * Removing a hash locks out every copy of the book that carries its code.
 */
export const COLOR_EDITION_KEY_HASHES: readonly string[] = [
  // First print run (2026-10).
  "b615511e5c66a4f12840c122b408eee5010387c5a5c14ca5de06b6143c3f0bd1",
];

/** Generous for a typed-in key; anything longer is not one of ours. */
const MAX_KEY_LENGTH = 64;

/** Keys are lowercase; tolerate case and stray spaces from a typed-in link. */
export function normalizeColorEditionKey(raw: string | null | undefined): string | null {
  const key = raw?.trim().toLowerCase();
  return key && key.length <= MAX_KEY_LENGTH ? key : null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * True when `raw` is a key whose hash is listed. A plain comparison is fine:
 * timing could at most leak a prefix of a hash, which says nothing about the
 * key behind it.
 */
export async function isColorEditionKey(
  raw: string | null | undefined,
  hashes: readonly string[] = COLOR_EDITION_KEY_HASHES
): Promise<boolean> {
  const key = normalizeColorEditionKey(raw);
  if (!key) return false;
  return hashes.includes(await sha256Hex(key));
}
