import { describe, expect, it } from "vitest";
import { CELEBRATION_TOAST_GAP_MS, isQuietRoute, mayCelebrate } from "@/lib/gamification/quiet";

describe("gamification quiet rules", () => {
  it("treats live-ceremony tools as quiet", () => {
    expect(isQuietRoute("/retro")).toBe(true);
    expect(isQuietRoute("/planning-poker")).toBe(true);
    expect(isQuietRoute("/standup")).toBe(true);
    expect(isQuietRoute("/retro-something-else")).toBe(false);
    expect(isQuietRoute("/okrs")).toBe(false);
    expect(isQuietRoute(null)).toBe(false);
  });

  it("never celebrates on a quiet route", () => {
    expect(mayCelebrate("/retro", 1_000_000, 0)).toBe(false);
  });

  it("allows the first celebration elsewhere, then throttles", () => {
    const t0 = 1_000_000;
    expect(mayCelebrate("/okrs", t0, 0)).toBe(true);
    expect(mayCelebrate("/okrs", t0 + 1000, t0)).toBe(false);
    expect(mayCelebrate("/okrs", t0 + CELEBRATION_TOAST_GAP_MS, t0)).toBe(true);
  });
});
