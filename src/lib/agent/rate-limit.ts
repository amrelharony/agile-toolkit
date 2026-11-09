import { VISITOR_HEADERS } from "@/lib/visitor-ai/contract";
import type { RateLimitInfo, VisitorQuota } from "./store";

/**
 * Parse the stream route's `X-RateLimit-*` response headers into a usage
 * snapshot for the agent store. Returns null when the headers are absent
 * (BYOK mode, a continuation round, or rate limiting disabled) so the caller
 * leaves the existing usage bar untouched.
 *
 * `limited` is passed in by the caller (true on a 429) rather than inferred,
 * since the headers themselves look identical at and below the cap.
 */
export function parseRateLimitHeaders(headers: Headers, limited = false): RateLimitInfo | null {
  // The daily pair is the cheapest presence probe — if it's missing, the
  // route didn't meter this response.
  if (headers.get("x-ratelimit-daily") == null || headers.get("x-ratelimit-daily-max") == null) {
    return null;
  }
  const num = (key: string): number => {
    const raw = headers.get(key);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    dailyUsed: num("x-ratelimit-daily"),
    dailyMax: num("x-ratelimit-daily-max"),
    weeklyUsed: num("x-ratelimit-weekly"),
    weeklyMax: num("x-ratelimit-weekly-max"),
    monthlyUsed: num("x-ratelimit-monthly"),
    monthlyMax: num("x-ratelimit-monthly-max"),
    limited,
  };
}

/**
 * Parse the visitor route's x-visitor-ai-* headers into the visitor's
 * allowance. Returns null when the daily pair is missing or unreadable (a
 * refusal that came before the meter, such as a 403 or 413), so the caller
 * keeps the quota it last showed. The per-window limit is kept whenever the
 * route sends it (it always does), so a note outside the window can name the
 * configured number; what's left in the window and when it ends only while
 * the route says the window is on. `now` stamps when the answer came.
 */
export function parseVisitorQuota(headers: Headers, now: number = Date.now()): VisitorQuota | null {
  const count = (key: string): number | null => {
    const raw = headers.get(key);
    if (raw == null || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  };
  const remaining = count(VISITOR_HEADERS.remaining);
  const limit = count(VISITOR_HEADERS.limit);
  if (remaining === null || limit === null) return null;
  const peak = headers.get(VISITOR_HEADERS.peak) === "1";
  const endsRaw = peak ? headers.get(VISITOR_HEADERS.peakEnds) : null;
  const endsAt = endsRaw && Number.isFinite(Date.parse(endsRaw)) ? endsRaw : null;
  return {
    remaining,
    limit,
    peak,
    peakRemaining: peak ? count(VISITOR_HEADERS.peakRemaining) : null,
    peakLimit: count(VISITOR_HEADERS.peakLimit),
    peakEndsAt: endsAt,
    receivedAt: now,
  };
}
