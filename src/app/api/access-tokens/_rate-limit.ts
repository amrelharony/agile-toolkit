/**
 * Per-user in-memory rate limiter for PAT minting (`POST /api/access-tokens`).
 *
 * Mirrors the guest limiter (`src/app/api/guest/_rate-limit.ts`) and the MCP
 * route's token bucket. Instance-local; effective ceiling on a multi-instance
 * deploy is `LIMIT × instances`. The endpoint is already owner-only
 * (requireAuthorizedUser), so the threat is narrow — a buggy/looping client
 * minting tokens without bound, exhausting the access_tokens table. A modest
 * per-user ceiling caps that without getting in the way of legitimate use
 * (minting is a rare, deliberate action).
 *
 * Only the mutating POST is metered; the GET list is read-only and cheap.
 */

import "server-only";

const MINT_LIMIT_PER_MIN = 30;
const REFILL_INTERVAL_MS = 60_000;
const MAX_BUCKET_ENTRIES = 1000;
const bucket = new Map<string, { tokens: number; updated: number }>();

function pruneBucket(now: number): void {
  if (bucket.size <= MAX_BUCKET_ENTRIES) return;
  const cutoff = now - 5 * REFILL_INTERVAL_MS;
  bucket.forEach((v, k) => {
    if (v.updated < cutoff) bucket.delete(k);
  });
}

/** Consume one mint token for `userId`. Returns false when the per-minute
 *  budget is exhausted. `now` is injectable for deterministic tests. */
export function consumeMintToken(userId: string, now: number = Date.now()): boolean {
  pruneBucket(now);
  const entry = bucket.get(userId);
  if (!entry) {
    bucket.set(userId, { tokens: MINT_LIMIT_PER_MIN - 1, updated: now });
    return true;
  }
  const elapsed = now - entry.updated;
  if (elapsed >= REFILL_INTERVAL_MS) {
    bucket.set(userId, { tokens: MINT_LIMIT_PER_MIN - 1, updated: now });
    return true;
  }
  const refill = Math.floor((elapsed / REFILL_INTERVAL_MS) * MINT_LIMIT_PER_MIN);
  const tokens = Math.min(MINT_LIMIT_PER_MIN, entry.tokens + refill);
  if (tokens <= 0) return false;
  bucket.set(userId, { tokens: tokens - 1, updated: now });
  return true;
}

/** Test-only: clear the bucket so cases don't bleed into each other. */
export function __resetMintRateLimit(): void {
  bucket.clear();
}

export const MINT_RATE_LIMIT_PER_MIN = MINT_LIMIT_PER_MIN;
