/**
 * Tiny retry-with-backoff wrapper for LLM adapter calls.
 *
 * Why this module exists: adapters throw `LlmRateLimitError` synchronously
 * on HTTP 429 — without retry, the user sees a hard failure for what is
 * usually a transient quota blip. Wrapping the call in `withRetry` lets us
 * absorb a couple of bumps without the caller having to plumb the retry
 * loop through every UI surface.
 *
 * Scope: this is intentionally lightweight — it only retries
 * `LlmRateLimitError`. Auth errors, CORS, network failures, and aborts
 * fail immediately because retrying them would just rack up the same
 * error N times (and in the abort case, would defeat the user's Stop
 * click). If we discover providers ever return 5xx as transient, those
 * branches can be added here.
 *
 * Backoff: prefers the server-provided `retryAfterSeconds` (parsed from
 * the `Retry-After` header by `parseRetryAfter` in openai-compatible.ts).
 * Falls back to 1s / 2s / 4s exponential when no header is provided.
 *
 * Default N=2 retries (so up to 3 total attempts). This is deliberately
 * small — the caller is a UI that the user is actively watching; an open
 * Stop button is preferable to a 30s sleep loop.
 */

import { LlmRateLimitError, isLlmError } from "./types";

export interface WithRetryOptions {
  /** Max retry attempts AFTER the initial call. Default 2 (so 3 attempts total). */
  maxRetries?: number;
  /** Absolute cap (seconds) on a single sleep — provider can ask for 60s+
   *  Retry-After; we cap so the UI doesn't appear hung. Default 30. */
  maxBackoffSec?: number;
  /** Abort signal — if the user hits Stop mid-backoff we exit immediately. */
  signal?: AbortSignal;
}

/**
 * Sleep that resolves early when `signal` aborts. Resolves (does NOT
 * reject) on abort — the caller then re-checks `signal.aborted` and
 * decides whether to bail. Keeping abort handling at the caller keeps
 * the typed-error contract clean.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wrap a Promise-returning function with rate-limit retry. The fn is
 * invoked on each attempt — it MUST be re-runnable (idempotent for our
 * purposes, since adapter calls don't mutate state on the server).
 *
 * Returns the fn's result on success. Re-throws the last error on
 * exhausted retries or on any non-retryable error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const maxBackoffSec = options.maxBackoffSec ?? 30;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      // Surface whatever error we had (if any) — otherwise let the
      // underlying fn throw its own LlmAbortError on first call.
      if (lastErr) throw lastErr;
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Only retry rate-limit errors. Everything else (auth, cors,
      // network, abort, unknown) bubbles up immediately.
      if (!isLlmError(err) || err.code !== "rate_limit") throw err;
      if (attempt === maxRetries) throw err;
      // Prefer server-provided retry-after; clamp to maxBackoffSec.
      // Fall back to 1s, 2s, 4s exponential when the header is absent.
      const rl = err as LlmRateLimitError;
      const backoffSec = rl.retryAfterSeconds ?? Math.min(maxBackoffSec, 2 ** attempt);
      const sleepMs = Math.min(maxBackoffSec, backoffSec) * 1000;
      await sleep(sleepMs, options.signal);
      // If abort fired during the sleep, bail with the rate-limit error
      // rather than retrying — the user is no longer watching.
      if (options.signal?.aborted) throw err;
    }
  }
  // Unreachable — the loop either returns, throws inside, or throws on
  // the last attempt. TypeScript can't prove that, hence the throw below.
  throw lastErr;
}
