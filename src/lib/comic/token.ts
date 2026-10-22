/**
 * The private comic link's token: its format and the hash it must match.
 *
 * Shared by the middleware, which routes /comic/<token> only for the right
 * token (isValidComicTokenEdge below), and by the reader page, which checks
 * again with node:crypto (access.ts). Edge-safe: Web Crypto only, with no
 * `node:` import and no server-only marker, so the middleware can load it.
 *
 * Only the token's SHA-256 lives in the repo, so neither the source nor a
 * build can reveal the link. Rotate it with `npm run comic:new-link`: paste
 * the new hash below and deploy — every link (and QR code) printed for the
 * old token then stops working.
 */

/** SHA-256 (hex) of the current link token. Never commit the token itself. */
export const COMIC_LINK_TOKEN_SHA256 =
  "60694f0d4139595b663cec0d8a57ece54a6dfe628b9da0cede40f9709bda6a25";

/**
 * base64url, as `npm run comic:new-link` mints it (32 chars). Anything else
 * is rejected before it is hashed, and the length cap keeps a junk path
 * segment from costing more than a short hash.
 */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{24,128}$/;

/** True when `token` is shaped like a link token (it may still be wrong). */
export function isComicTokenFormat(token: unknown): token is string {
  return typeof token === "string" && TOKEN_FORMAT.test(token);
}

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/** The 32 bytes of a hex SHA-256, or null for anything malformed. */
function sha256Bytes(hex: string): Uint8Array | null {
  if (!HEX_SHA256.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Byte-wise compare with no early exit. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * True when `token` hashes to one of `hashes` (hex SHA-256) — the same rule
 * as access.ts's isValidComicToken, for the edge runtime. Every hash is
 * compared in constant time, with no early exit, so response timing says
 * nothing about how close a guess was; a malformed hash is skipped. The
 * token is never logged.
 */
export async function isValidComicTokenEdge(
  token: unknown,
  hashes: readonly string[] = [COMIC_LINK_TOKEN_SHA256]
): Promise<boolean> {
  if (!isComicTokenFormat(token)) return false;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  );
  let valid = false;
  for (const hex of hashes) {
    const expected = sha256Bytes(hex);
    if (expected && sameBytes(digest, expected)) valid = true;
  }
  return valid;
}
