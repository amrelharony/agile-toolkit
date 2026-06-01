/**
 * Parsing of the stream route's X-RateLimit-* headers into the usage snapshot
 * the mascot panel's bar renders. Pure; no network.
 */

import { describe, it, expect } from "vitest";
import { parseRateLimitHeaders } from "@/lib/agent/rate-limit";

function hdrs(entries: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) h.set(k, v);
  return h;
}

describe("parseRateLimitHeaders", () => {
  it("returns null when the headers are absent (BYOK / continuation round)", () => {
    expect(parseRateLimitHeaders(hdrs({}))).toBeNull();
    expect(parseRateLimitHeaders(hdrs({ "content-type": "text/event-stream" }))).toBeNull();
  });

  it("parses a full usage snapshot", () => {
    const r = parseRateLimitHeaders(
      hdrs({
        "x-ratelimit-daily": "12",
        "x-ratelimit-daily-max": "200",
        "x-ratelimit-weekly": "40",
        "x-ratelimit-weekly-max": "1000",
        "x-ratelimit-monthly": "120",
        "x-ratelimit-monthly-max": "4000",
      })
    );
    expect(r).toEqual({
      dailyUsed: 12,
      dailyMax: 200,
      weeklyUsed: 40,
      weeklyMax: 1000,
      monthlyUsed: 120,
      monthlyMax: 4000,
      limited: false,
    });
  });

  it("flags limited when told (429)", () => {
    const r = parseRateLimitHeaders(
      hdrs({ "x-ratelimit-daily": "200", "x-ratelimit-daily-max": "200" }),
      true
    );
    expect(r?.limited).toBe(true);
  });

  it("coerces missing/garbage secondary values to 0", () => {
    const r = parseRateLimitHeaders(
      hdrs({ "x-ratelimit-daily": "1", "x-ratelimit-daily-max": "200", "x-ratelimit-weekly": "x" })
    );
    expect(r?.weeklyUsed).toBe(0);
    expect(r?.monthlyMax).toBe(0);
  });
});
