// @vitest-environment node
/**
 * The public comics routes' rate limit: a budget per route and address for a
 * window, with the address itself never held, not even in memory.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

import { withinRateLimit } from "@/app/api/comics/_guard";

const from = (ip: string) =>
  new NextRequest("https://agile.test/api/comics/stats", { headers: { "x-real-ip": ip } });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withinRateLimit", () => {
  it("gives each address its own budget per route, until the window ends", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T08:00:00Z"));
    const a = from("203.0.113.5");
    expect([1, 2, 3].map(() => withinRateLimit(a, "guard-test", 2, 60_000))).toEqual([
      true,
      true,
      false,
    ]);
    expect(withinRateLimit(from("203.0.113.6"), "guard-test", 2, 60_000)).toBe(true);
    expect(withinRateLimit(a, "guard-test-other", 2, 60_000)).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(withinRateLimit(a, "guard-test", 2, 60_000)).toBe(true);
  });

  it("never keeps the address, even as a key in memory", () => {
    const set = vi.spyOn(Map.prototype, "set");
    withinRateLimit(from("198.51.100.77"), "stats:57:love", 3, 3_600_000);
    const keys = set.mock.calls.map(([key]) => String(key)).filter((k) => k.startsWith("stats:"));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^stats:57:love:[\w-]{22}$/);
    expect(keys[0]).not.toContain("198.51.100.77");
  });
});
