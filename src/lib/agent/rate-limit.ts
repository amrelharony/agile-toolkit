import type { RateLimitInfo } from "./store";

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
