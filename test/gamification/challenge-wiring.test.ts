import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch, awardXp } from "@/lib/gamification/engine";
import { todaySeedKey, weekSeedKey } from "@/lib/gamification/challenges";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import type { ChallengeKind, ChallengeProgress } from "@/lib/gamification/types";

// The engine and the ledger do nothing until the profile is read from storage.
beforeAll(async () => {
  await useVDnaStore.persist.rehydrate();
});

/**
 * Regression: six daily/weekly challenges keyed on synthetic trigger names
 * (`combo-reached-3`, `daily-active`, `tool-visit-unique`, `achievement-unlocked`,
 * `secret-found`, `xp-earned`) could never progress because nothing ever
 * dispatched those event names. The engine now bridges its own activity to
 * them via side-effect-free advanceChallenges() calls.
 */

function resetVDna() {
  useVDnaStore.setState({
    unlocked: [],
    counters: {},
    xp: 0,
    lifetimeXp: 0,
    level: 1,
    prestige: 0,
    toolsVisited: [],
    lastActiveDate: "",
    streak: 0,
    longestStreak: 0,
    dailyChallenges: [],
    weeklyChallenges: [],
    recentEvents: [],
  });
}

function daily(id: string, goal: number): ChallengeProgress {
  return {
    id,
    kind: "daily" as ChallengeKind,
    progress: 0,
    goal,
    xp: 100,
    completed: false,
    seedDate: todaySeedKey(),
  };
}
function weekly(id: string, goal: number): ChallengeProgress {
  return {
    id,
    kind: "weekly" as ChallengeKind,
    progress: 0,
    goal,
    xp: 100,
    completed: false,
    seedDate: weekSeedKey(),
  };
}
const dailyById = (id: string) => useVDnaStore.getState().dailyChallenges.find((c) => c.id === id);
const weeklyById = (id: string) =>
  useVDnaStore.getState().weeklyChallenges.find((c) => c.id === id);

describe("gamification challenge wiring (regression: previously-dead triggers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    resetVDna();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("xp-earned advances w-xp-2000 by the XP awarded (amount-based, not +1)", () => {
    useVDnaStore.getState().setWeeklyChallenges([weekly("w-xp-2000", 2000)]);
    awardXp(100, "secret", {}); // stale combo → multiplier 1 → effectiveAmount 100
    expect(weeklyById("w-xp-2000")?.progress).toBe(100);
  });

  it("tool-visit-unique completes w-sprint-cycle after the 3 target tools", () => {
    useVDnaStore.getState().setWeeklyChallenges([weekly("w-sprint-cycle", 3)]);
    dispatch({ name: "tool-visit", meta: { toolId: "sprint-goal" } });
    dispatch({ name: "tool-visit", meta: { toolId: "burndown" } });
    dispatch({ name: "tool-visit", meta: { toolId: "retro" } });
    expect(weeklyById("w-sprint-cycle")?.completed).toBe(true);
  });

  it("tool-visit-unique only counts the matching tools", () => {
    useVDnaStore.getState().setWeeklyChallenges([weekly("w-sprint-cycle", 3)]);
    dispatch({ name: "tool-visit", meta: { toolId: "kanban" } });
    dispatch({ name: "tool-visit", meta: { toolId: "okrs" } });
    expect(weeklyById("w-sprint-cycle")?.progress).toBe(0);
  });

  it("daily-active ticks w-streak-7 once per local day", () => {
    useVDnaStore.getState().setWeeklyChallenges([weekly("w-streak-7", 7)]);
    dispatch({ name: "click" });
    dispatch({ name: "click" }); // same day → must NOT double-count
    expect(weeklyById("w-streak-7")?.progress).toBe(1);
  });

  it("secret-found completes d-secret on any secret event", () => {
    useVDnaStore.getState().setDailyChallenges([daily("d-secret", 1)]);
    dispatch({ name: "secret:konami" });
    expect(dailyById("d-secret")?.completed).toBe(true);
  });

  it("achievement-unlocked advances w-achievements-5 per unlock", () => {
    useVDnaStore.getState().setWeeklyChallenges([weekly("w-achievements-5", 5)]);
    dispatch({ name: "click" }); // unlocks first-click → one achievement
    expect(weeklyById("w-achievements-5")?.progress ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("d-tool-3 counts DISTINCT tools, not pathname bounces", () => {
    useVDnaStore.getState().setDailyChallenges([daily("d-tool-3", 3)]);
    // /velocity → /kanban → /velocity → /kanban: two distinct tools, four
    // raw `tool-visit` events. Must NOT complete a "3 different tools" goal.
    dispatch({ name: "tool-visit", meta: { toolId: "velocity" } });
    dispatch({ name: "tool-visit", meta: { toolId: "kanban" } });
    dispatch({ name: "tool-visit", meta: { toolId: "velocity" } });
    dispatch({ name: "tool-visit", meta: { toolId: "kanban" } });
    expect(dailyById("d-tool-3")?.progress).toBe(2);
    dispatch({ name: "tool-visit", meta: { toolId: "retro" } });
    expect(dailyById("d-tool-3")?.completed).toBe(true);
  });

  it("w-explore-10 counts one tick per tool per week, and re-counts next week", () => {
    useVDnaStore.getState().setWeeklyChallenges([weekly("w-explore-10", 10)]);
    dispatch({ name: "tool-visit", meta: { toolId: "velocity" } });
    dispatch({ name: "tool-visit", meta: { toolId: "velocity" } });
    dispatch({ name: "tool-visit", meta: { toolId: "kanban" } });
    expect(weeklyById("w-explore-10")?.progress).toBe(2);
    // Next week the same tools count again (unlike `tool-visit-unique`,
    // which is first-ever-only and would leave this uncompletable).
    vi.setSystemTime(new Date("2026-06-23T12:00:00Z"));
    useVDnaStore.getState().setWeeklyChallenges([weekly("w-explore-10", 10)]);
    dispatch({ name: "tool-visit", meta: { toolId: "velocity" } });
    expect(weeklyById("w-explore-10")?.progress).toBe(1);
    // Last week's per-tool markers are pruned, not accumulated forever.
    const stale = Object.keys(useVDnaStore.getState().counters).filter((k) =>
      k.startsWith("week-tool:2026-W25:")
    );
    expect(stale).toEqual([]);
  });

  it("combo-reached-3 fires once when a fresh chain reaches x3", () => {
    // Warm up, then jump >3s so the next chain starts fresh (combo depth → 1).
    dispatch({ name: "tool:retro:card-added" });
    useVDnaStore.getState().setDailyChallenges([daily("d-combo-3", 1)]);
    useVDnaStore.getState().setWeeklyChallenges([weekly("w-combos-10", 10)]);
    vi.setSystemTime(new Date("2026-06-15T12:00:10Z"));
    dispatch({ name: "tool:retro:card-added" }); // depth 1
    dispatch({ name: "tool:retro:card-added" }); // depth 2
    dispatch({ name: "tool:retro:card-added" }); // depth 3 → combo-reached-3 fires exactly once
    expect(dailyById("d-combo-3")?.completed).toBe(true);
    expect(weeklyById("w-combos-10")?.progress).toBe(1);
  });
});
