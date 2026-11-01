/**
 * VIP access for readers of the printed book.
 *
 * The book carries a link (and QR code) for /vip/<key>. Opening it stores the
 * key in an httpOnly cookie on this device, and anything VIP-only checks that
 * cookie on the server. The link itself is the credential: anyone holding the
 * book (or a photo of the page) gets in, which is the intended trade-off for
 * a printed code that can never change.
 *
 * Only SHA-256 hashes of the keys live in the repo, so the source never holds
 * a working link. Keys are random (~60 bits), so a hash can't be reversed by
 * guessing. Uses Web Crypto: safe on the Node and edge runtimes alike.
 */

export const VIP_COOKIE = "agile-toolkit:vip";
/**
 * The whole site: VIP features can live on any tool page, not just /vip.
 * httpOnly, so only the server ever reads it.
 */
export const VIP_COOKIE_PATH = "/";
/** 400 days: the longest a browser keeps a cookie (Chrome caps it there). */
export const VIP_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/**
 * One hash per printed link. To add a print run, hash a new random key
 * (`node -e "…createHash('sha256').update(key).digest('hex')"`) and append it.
 * Removing a hash locks out every copy of the book that carries its link.
 */
export const VIP_KEY_HASHES: readonly string[] = [
  // First print run (2026-10).
  "bf290885bba8cbfe94bad4b631d7b2db858c2c35c9ac16c73bb352b6c1db60c6",
];

/** Generous for a typed-in key; anything longer is not one of ours. */
const MAX_KEY_LENGTH = 64;

/** Keys are lowercase; tolerate case and stray spaces from a typed-in link. */
export function normalizeVipKey(raw: string | null | undefined): string | null {
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
export async function isVipKey(
  raw: string | null | undefined,
  hashes: readonly string[] = VIP_KEY_HASHES
): Promise<boolean> {
  const key = normalizeVipKey(raw);
  if (!key) return false;
  return hashes.includes(await sha256Hex(key));
}
