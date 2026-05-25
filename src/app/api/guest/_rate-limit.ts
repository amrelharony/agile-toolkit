/**
 * Per-guest in-memory rate limiter for `/api/guest/*` mutating routes.
 *
 * Mirrors the MCP route's token bucket (see `src/app/api/mcp/route.ts`).
 * Instance-local; effective ceiling on multi-instance deploys is
 * `LIMIT × instances`. The threat is a runaway/hostile guest fanning
 * out service-role queries; strict global enforcement isn't worth the
 * dependency for the current single-user toolkit.
 *
 * Read-only routes (`/api/guest/me` GET) are NOT covered here.
 */

import "server-only";

const RATE_LIMIT_PER_MIN = 60;
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

export function consumeGuestRateToken(key: string): boolean {
  const now = Date.now();
  pruneBucket(now);
  const entry = bucket.get(key);
  if (!entry) {
    bucket.set(key, { tokens: RATE_LIMIT_PER_MIN - 1, updated: now });
    return true;
  }
  const elapsed = now - entry.updated;
  if (elapsed >= REFILL_INTERVAL_MS) {
    bucket.set(key, { tokens: RATE_LIMIT_PER_MIN - 1, updated: now });
    return true;
  }
  const refill = Math.floor((elapsed / REFILL_INTERVAL_MS) * RATE_LIMIT_PER_MIN);
  const tokens = Math.min(RATE_LIMIT_PER_MIN, entry.tokens + refill);
  if (tokens <= 0) return false;
  bucket.set(key, { tokens: tokens - 1, updated: now });
  return true;
}

export const GUEST_RATE_LIMIT_PER_MIN = RATE_LIMIT_PER_MIN;

// ──────────────────────────────────────────────────────────────────────
// Redemption rate limit — separate, stricter bucket for /api/guest/redeem.
//
// The squad code is a bearer credential that, once leaked, lets anyone
// brute-mint guest profiles under the owner's squad. The general
// token-bucket above is sized for in-session activity (cursor moves,
// log writes); redemption is a once-per-guest event, so we cap it at
// REDEEM_LIMIT per IP+code over REDEEM_WINDOW_MS to make storage-
// exhaustion and impersonation-spam infeasible while leaving normal
// re-entry flows alone (a real guest might retry 2-3 times across the
// "name taken" / color picker prompts).
// ──────────────────────────────────────────────────────────────────────
const REDEEM_LIMIT = 10;
const REDEEM_WINDOW_MS = 60 * 60_000; // 1 hour
const MAX_REDEEM_ENTRIES = 1000;
const redeemBucket = new Map<string, { count: number; windowStart: number }>();

function pruneRedeemBucket(now: number): void {
  if (redeemBucket.size <= MAX_REDEEM_ENTRIES) return;
  redeemBucket.forEach((v, k) => {
    if (now - v.windowStart >= REDEEM_WINDOW_MS) redeemBucket.delete(k);
  });
}

/**
 * Sliding-fixed-window check for the redemption endpoint. Returns
 * `true` when the request is within the per-(IP,code) budget for the
 * current hour-long window, `false` once exhausted. Best-effort,
 * instance-local; on multi-instance deploys the effective ceiling
 * is `REDEEM_LIMIT × instances`.
 */
export function consumeRedeemAttempt(key: string): boolean {
  const now = Date.now();
  pruneRedeemBucket(now);
  const entry = redeemBucket.get(key);
  if (!entry || now - entry.windowStart >= REDEEM_WINDOW_MS) {
    redeemBucket.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= REDEEM_LIMIT) return false;
  entry.count += 1;
  return true;
}

export const GUEST_REDEEM_LIMIT = REDEEM_LIMIT;
export const GUEST_REDEEM_WINDOW_MS = REDEEM_WINDOW_MS;
