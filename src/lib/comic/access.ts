/**
 * Who may read the "Agile at Work" comic: whoever holds the private link
 * https://agile.amrelharony.com/comic/<token> (printed as a QR code in the
 * book). Nothing on the site lists or links to it.
 *
 * The token's format and hash live in token.ts, which the middleware uses
 * to route the link. This is the reader page's own check of the same token
 * against the same hash, with node:crypto — defence in depth, should a
 * request ever reach the page without passing the middleware.
 */

import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { COMIC_LINK_TOKEN_SHA256, isComicTokenFormat } from "./token";

export { COMIC_LINK_TOKEN_SHA256 };

/**
 * True when `token` hashes to one of `hashes` (hex SHA-256). Every hash is
 * compared in constant time, with no early exit, so response timing says
 * nothing about how close a guess was. The token is never logged.
 */
export function isValidComicToken(
  token: unknown,
  hashes: readonly string[] = [COMIC_LINK_TOKEN_SHA256]
): boolean {
  if (!isComicTokenFormat(token)) return false;
  const digest = createHash("sha256").update(token, "utf8").digest();
  let valid = false;
  for (const hex of hashes) {
    const expected = Buffer.from(hex, "hex");
    // A malformed hash decodes short, and timingSafeEqual throws on
    // buffers of different lengths.
    if (expected.length !== digest.length) continue;
    if (timingSafeEqual(digest, expected)) valid = true;
  }
  return valid;
}
