import { describe, expect, it } from "vitest";
import * as quiet from "@/lib/gamification/quiet";
import { isQuietRoute } from "@/lib/gamification/quiet";

describe("gamification quiet rules", () => {
  it("treats live-ceremony tools as quiet", () => {
    expect(isQuietRoute("/retro")).toBe(true);
    expect(isQuietRoute("/retro/board-1")).toBe(true);
    expect(isQuietRoute("/planning-poker")).toBe(true);
    expect(isQuietRoute("/standup")).toBe(true);
    expect(isQuietRoute("/retro-something-else")).toBe(false);
    expect(isQuietRoute("/okrs")).toBe(false);
    expect(isQuietRoute(null)).toBe(false);
  });

  it("has no celebration throttle any more (celebrations go to the inbox, never dropped)", () => {
    expect("mayCelebrate" in quiet).toBe(false);
    expect("CELEBRATION_TOAST_GAP_MS" in quiet).toBe(false);
  });
});
