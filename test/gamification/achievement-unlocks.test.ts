import { beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "@/lib/gamification/engine";
import { useVDnaStore } from "@/lib/stores/vdna-store";

/**
 * Regression: several achievements could never unlock.
 *
 *  - combo-3 / combo-5 / kudos-combo-5 read `meta.comboDepth`, but the combo
 *    depth lives in the engine's module-level combo state and was never
 *    present on the raw event meta — so the rules saw `undefined` forever.
 *    dispatch() now injects the live combo depth into the eval meta.
 *  - combo-3 ("Chain a x3 combo") also gated on depth >= 2 (x2); corrected
 *    to depth >= 3 (x3).
 *  - logo-whisperer read counters["logo-hover"], which dispatch() never
 *    bumps; rewired to fire on the dedicated `logo-whispered` event.
 */
function resetVDna() {
  useVDnaStore.setState({
    unlocked: [],
    counters: {},
    xp: 0,
    lifetimeXp: 0,
    level: 1,
    prestige: 0,
    dailyChallenges: [],
    weeklyChallenges: [],
    recentEvents: [],
  });
}

describe("gamification achievement unlocks (regression)", () => {
  beforeEach(() => {
    resetVDna();
  });

  it("unlocks combo-3 and combo-5 from rapid combo events", () => {
    // Five rapid tool actions build the combo to its x5 cap (depth 4),
    // crossing both the x3 (depth 3) and x5 (depth 4) thresholds. (Raw
    // clicks no longer chain combos.)
    for (let i = 0; i < 5; i++) {
      dispatch({ name: "tool:retro:card-added" });
    }
    const unlocked = useVDnaStore.getState().unlocked;
    expect(unlocked).toContain("combo-3");
    expect(unlocked).toContain("combo-5");
  });

  it("unlocks kudos-combo-5 from rapid kudos sends", () => {
    for (let i = 0; i < 5; i++) {
      dispatch({ name: "tool:kudos:sent" });
    }
    expect(useVDnaStore.getState().unlocked).toContain("kudos-combo-5");
  });

  it("unlocks logo-whisperer on the logo-whispered event", () => {
    dispatch({ name: "logo-whispered" });
    expect(useVDnaStore.getState().unlocked).toContain("logo-whisperer");
  });

  it("unlocks hover-hundred after 100 hover events (counter key is 'hover', not 'hover-total')", () => {
    for (let i = 0; i < 99; i++) dispatch({ name: "hover" });
    expect(useVDnaStore.getState().unlocked).not.toContain("hover-hundred");
    dispatch({ name: "hover" }); // 100th
    expect(useVDnaStore.getState().unlocked).toContain("hover-hundred");
  });

  it("does not unlock logo-whisperer for an unrelated event", () => {
    dispatch({ name: "logo-hover", meta: { count: 3 } });
    expect(useVDnaStore.getState().unlocked).not.toContain("logo-whisperer");
  });

  describe("reading the comic", () => {
    const read = (ep: number, weekStreak = 1) =>
      dispatch({ name: "tool:comics:completed", meta: { ep, total: ep, weekStreak } });

    it("unlocks First Story on the first story read, and Regular Reader on the tenth", () => {
      read(1);
      expect(useVDnaStore.getState().unlocked).toContain("first-story");
      expect(useVDnaStore.getState().unlocked).not.toContain("ten-stories");
      for (let ep = 2; ep <= 10; ep++) read(ep);
      expect(useVDnaStore.getState().unlocked).toContain("ten-stories");
    });

    it("still gives Regular Reader at ten stories after a prestige reset cleared the counter", () => {
      useVDnaStore.setState({ counters: {} });
      read(10);
      expect(useVDnaStore.getState().unlocked).toContain("ten-stories");
    });

    it("unlocks Weekly Reader at four weeks in a row, not before", () => {
      read(1, 3);
      expect(useVDnaStore.getState().unlocked).not.toContain("weekly-reader");
      read(2, 4);
      expect(useVDnaStore.getState().unlocked).toContain("weekly-reader");
    });

    it("unlocks Over to the Team when a story's question goes to the retro", () => {
      dispatch({ name: "tool:comics:retro-question", meta: { ep: 1 } });
      expect(useVDnaStore.getState().unlocked).toContain("squad-question");
    });
  });
});
