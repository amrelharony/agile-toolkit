/**
 * Per-token, per-category rate limiting for the MCP transport.
 *
 * The flat 120/min limit didn't distinguish cheap reads from expensive
 * writes/intents. A multi-tool agent run does far more reads (list_state,
 * compute_*) than writes, and intents fan out to several entity writes, so
 * we split the ceiling by category:
 *
 *   read   600/min  — list_state, compute_*, get_* (cheap, frequent)
 *   write  120/min  — create/update/delete + tool write verbs
 *   intent  30/min  — intent.* compositions (each fans out to many writes)
 *
 * In-memory token bucket, instance-local — the effective ceiling on a
 * multi-instance deploy is `LIMIT × instances`. That's fine for the threat
 * we care about (a runaway agent burning Supabase quota / LLM tokens);
 * strict global enforcement would need Redis and isn't worth it for a
 * single-user toolkit. Buckets refill lazily on each call (no setInterval,
 * no dangling timers). `now` is injectable so the logic is deterministically
 * testable.
 */

export type RateCategory = "read" | "write" | "intent";

export const RATE_LIMITS: Record<RateCategory, number> = {
  read: 600,
  write: 120,
  intent: 30,
};

const REFILL_INTERVAL_MS = 60_000;
const MAX_BUCKET_ENTRIES = 3000; // ~1000 tokens × 3 categories

interface BucketEntry {
  /** Available tokens, stored as a FLOAT. Fractional refill earned between
   *  consumes is banked here rather than truncated — see availableTokens. */
  tokens: number;
  updated: number;
}

// Keyed by `${tokenId}:${category}`.
const bucket = new Map<string, BucketEntry>();

/** Test-only: clear all buckets so cases don't bleed into each other. */
export function __resetRateLimit(): void {
  bucket.clear();
}

/** Drop entries older than 5× the refill window once the map grows past the
 *  cap — defensive against unbounded growth from many distinct PATs. */
function pruneBucket(now: number): void {
  if (bucket.size <= MAX_BUCKET_ENTRIES) return;
  const cutoff = now - 5 * REFILL_INTERVAL_MS;
  bucket.forEach((v, k) => {
    if (v.updated < cutoff) bucket.delete(k);
  });
}

/** Tokens currently available for (tokenId, category) after lazy refill,
 *  WITHOUT mutating the bucket. */
function availableTokens(tokenId: string, category: RateCategory, now: number): number {
  const max = RATE_LIMITS[category];
  const entry = bucket.get(`${tokenId}:${category}`);
  if (!entry) return max;
  const elapsed = Math.max(0, now - entry.updated);
  if (elapsed >= REFILL_INTERVAL_MS) return max;
  // Continuous (FRACTIONAL) refill proportional to elapsed time. The earlier
  // version floored this, which — because `tryConsume` resets `updated` to
  // `now` on every consume — permanently discarded any sub-token refill. Under
  // a tight burst (inter-arrival < interval/max: <100ms for reads, <2s for
  // intents) that meant ZERO refill was ever credited, so the limiter blocked
  // far earlier than its advertised "X/min". Keeping the fraction (and banking
  // it into `tokens`) credits refill at exactly the intended rate without
  // letting a client exceed `max` in any window (Math.min caps the ceiling).
  const refill = (elapsed / REFILL_INTERVAL_MS) * max;
  return Math.min(max, entry.tokens + refill);
}

/**
 * Atomically consume tokens for a set of category counts (a single request
 * or a whole batch). Two-phase: verify every category has capacity, then
 * commit — so a batch is never partially charged before being rejected.
 * Single-threaded JS guarantees no interleaving between the phases.
 *
 * Returns `{ ok: true }` if all categories had capacity (and were charged),
 * or `{ ok: false, category, limit }` naming the first category that was
 * over its limit (nothing is charged in that case).
 */
export function tryConsume(
  tokenId: string,
  counts: Partial<Record<RateCategory, number>>,
  now: number = Date.now()
): { ok: true } | { ok: false; category: RateCategory; limit: number } {
  pruneBucket(now);

  // Phase 1 — verify capacity for every requested category. Collect the
  // post-deduction token counts (array, not a Map — the tsconfig target
  // disallows Map-iterator downlevelling).
  const commits: Array<{ category: RateCategory; remaining: number }> = [];
  for (const cat of Object.keys(counts) as RateCategory[]) {
    const need = counts[cat] ?? 0;
    if (need <= 0) continue;
    const have = availableTokens(tokenId, cat, now);
    if (have < need) return { ok: false, category: cat, limit: RATE_LIMITS[cat] };
    commits.push({ category: cat, remaining: have - need });
  }

  // Phase 2 — commit deductions.
  for (const c of commits) {
    bucket.set(`${tokenId}:${c.category}`, { tokens: c.remaining, updated: now });
  }
  return { ok: true };
}

/** Map an action to its rate-limit category. Intents (`intent.*`) are the
 *  most expensive (each fans out to several writes); otherwise fall back to
 *  the action's read/write category. */
export function rateCategoryForAction(action: {
  id?: string;
  toolId?: string;
  category?: string;
}): RateCategory {
  if (action.id?.startsWith("intent.") || action.toolId?.startsWith("intent")) {
    return "intent";
  }
  return action.category === "write" ? "write" : "read";
}
