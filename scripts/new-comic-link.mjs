#!/usr/bin/env node
/**
 * Mint a new private link for the "Agile at Work" comic.
 *
 *   npm run comic:new-link
 *
 * Prints the link and the SHA-256 of its token, and writes nothing. Only
 * the hash goes into the repo (COMIC_LINK_TOKEN_SHA256 in
 * src/lib/comic/token.ts); the link itself is the secret — keep it out of
 * git, issues, chats and logs.
 *
 * Rotating replaces the hash, so every link (and QR code) printed for the
 * old token stops working once the new hash is deployed.
 */

import { createHash, randomBytes } from "node:crypto";

const SITE_URL = "https://agile.amrelharony.com";

// 24 random bytes → 32 base64url characters (192 bits): unguessable, and
// URL-safe without any escaping.
const token = randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(token, "utf8").digest("hex");

console.log(`
New private link for "Agile at Work" (this is the secret — do not commit it):

  ${SITE_URL}/comic/${token}

SHA-256 of its token (this is what goes in the repo):

  ${hash}

Next:
  1. Paste the hash into COMIC_LINK_TOKEN_SHA256 in src/lib/comic/token.ts,
     commit and deploy.
  2. Print the link above as a QR code / share it with your readers.

Heads-up: once the new hash is deployed, the previous link — and every QR
code already printed with it — stops working.
`);
