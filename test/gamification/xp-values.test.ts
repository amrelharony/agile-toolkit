import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dispatch } from "@/lib/gamification/engine";
import { useVDnaStore } from "@/lib/stores/vdna-store";

// Own file: the engine keeps combo state at module level.
describe("XP for raw input", () => {
  // Midday: "night owl" and "early bird" unlock on any event after
  // midnight and would add their XP to the count.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 16, 13, 0, 0));
  });
  afterAll(() => vi.useRealTimers());

  it("awards no XP and no combo achievements for clicks, hovers or keys", () => {
    useVDnaStore.setState({
      unlocked: ["first-click"],
      counters: {},
      xp: 0,
      lifetimeXp: 0,
      level: 1,
      prestige: 0,
      dailyChallenges: [],
      weeklyChallenges: [],
      recentEvents: [],
    });
    for (let i = 0; i < 20; i++) {
      dispatch({ name: "click" });
      dispatch({ name: "hover" });
      dispatch({ name: "key" });
    }
    const { xp, unlocked } = useVDnaStore.getState();
    expect(xp).toBe(0);
    expect(unlocked).not.toContain("combo-3");
    expect(unlocked).not.toContain("combo-5");
  });

  it("still rewards work in the tools", () => {
    dispatch({ name: "tool:retro:card-added" });
    expect(useVDnaStore.getState().xp).toBeGreaterThan(0);
  });
});
