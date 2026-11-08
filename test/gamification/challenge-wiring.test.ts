import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch, awardXp } from "@/lib/gamification/engine";
import { recordOutcome } from "@/lib/gamification/ledger";
import { findDaily, findWeekly, todaySeedKey, weekSeedKey } from "@/lib/gamification/challenges";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import type { ChallengeProgress } from "@/lib/gamification/types";

/**
 * Challenges move on finished work: `outcome:<id>` events from the ledger,
 * the synthetic `outcome` trigger (with the outcome's tool), and a few
 * engine triggers (xp-earned, daily-active, achievement-unlocked, weekly
 * tool visits). End to end through the real engine and ledger. The clock is
 * a Date subclass whose "now" each test can move.
 */

const RealDate = Date;
let NOW = new RealDate(2026, 5, 15, 12, 0, 0).getTime(); // Mon 15 Jun 2026
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(NOW);
    else super(...(args as [number]));
  }
  static now() {
    return NOW;
  }
}

beforeAll(async () => {
  vi.stubGlobal("Date", ShiftedDate);
  // The engine and the ledger do nothing until the profile is read from storage.
  await useVDnaStore.persist.rehydrate();
});
afterAll(() => vi.unstubAllGlobals());

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
    xpDay: { date: "", total: 0, byKey: {} },
    claims: {},
    onceKeys: [],
  });
}

function daily(id: string): ChallengeProgress {
  const def = findDaily(id);
  if (!def) throw new Error(`no daily ${id}`);
  return {
    id,
    kind: "daily",
    progress: 0,
    goal: def.goal,
    xp: def.xp,
    completed: false,
    seedDate: todaySeedKey(),
  };
}
function weekly(id: string): ChallengeProgress {
  const def = findWeekly(id);
  if (!def) throw new Error(`no weekly ${id}`);
  return {
    id,
    kind: "weekly",
    progress: 0,
    goal: def.goal,
    xp: def.xp,
    completed: false,
    seedDate: weekSeedKey(),
  };
}
const dailyById = (id: string) => useVDnaStore.getState().dailyChallenges.find((c) => c.id === id);
const weeklyById = (id: string) =>
  useVDnaStore.getState().weeklyChallenges.find((c) => c.id === id);
const setDaily = (...ids: string[]) =>
  useVDnaStore.getState().setDailyChallenges(ids.map((id) => daily(id)));
const setWeekly = (...ids: string[]) =>
  useVDnaStore.getState().setWeeklyChallenges(ids.map((id) => weekly(id)));

beforeEach(() => {
  NOW = new RealDate(2026, 5, 15, 12, 0, 0).getTime();
  resetVDna();
});

describe("engine triggers", () => {
  it("xp-earned advances w-xp-600 by the XP awarded (amount-based, not +1)", () => {
    setWeekly("w-xp-600");
    awardXp(100, "secret", {});
    expect(weeklyById("w-xp-600")?.progress).toBe(100);
  });

  it("w-sprint-cycle completes after the 3 target tools this week", () => {
    setWeekly("w-sprint-cycle");
    dispatch({ name: "tool-visit", meta: { toolId: "sprint-goal" } });
    dispatch({ name: "tool-visit", meta: { toolId: "kanban" } }); // not a target
    dispatch({ name: "tool-visit", meta: { toolId: "burndown" } });
    dispatch({ name: "tool-visit", meta: { toolId: "burndown" } }); // repeat
    expect(weeklyById("w-sprint-cycle")?.progress).toBe(2);
    dispatch({ name: "tool-visit", meta: { toolId: "retro" } });
    expect(weeklyById("w-sprint-cycle")?.completed).toBe(true);
  });

  it("w-sprint-cycle can be done again next week by someone who knows the tools", () => {
    useVDnaStore.setState({ toolsVisited: ["sprint-goal", "burndown", "retro"] });
    setWeekly("w-sprint-cycle");
    for (const toolId of ["sprint-goal", "burndown", "retro"]) {
      dispatch({ name: "tool-visit", meta: { toolId } });
    }
    expect(weeklyById("w-sprint-cycle")?.completed).toBe(true);
    // Last week's per-tool markers are pruned, not accumulated forever.
    NOW = new RealDate(2026, 5, 23, 12, 0, 0).getTime();
    setWeekly("w-sprint-cycle");
    dispatch({ name: "tool-visit", meta: { toolId: "retro" } });
    expect(weeklyById("w-sprint-cycle")?.progress).toBe(1);
    const stale = Object.keys(useVDnaStore.getState().counters).filter((k) =>
      k.startsWith("week-tool:2026-W25:")
    );
    expect(stale).toEqual([]);
  });

  it("daily-active ticks w-streak-7 once per local day", () => {
    setWeekly("w-streak-7");
    dispatch({ name: "tool-visit", meta: { toolId: "kanban" } });
    dispatch({ name: "tool-visit", meta: { toolId: "okrs" } }); // same day
    expect(weeklyById("w-streak-7")?.progress).toBe(1);
  });

  it("raw input no longer counts as activity for w-streak-7", () => {
    setWeekly("w-streak-7");
    dispatch({ name: "click" });
    dispatch({ name: "hover" });
    expect(weeklyById("w-streak-7")?.progress).toBe(0);
  });

  it("achievement-unlocked advances w-achievements-5 per unlock", () => {
    setWeekly("w-achievements-5");
    recordOutcome("card-done", { meta: { toolId: "kanban" } }); // First Win + Flow State
    expect(weeklyById("w-achievements-5")?.progress ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("outcome triggers", () => {
  it.each([
    ["d-poker", "estimate-committed", "estimate:s1"],
    ["d-retro-finish", "retro-finished", "retro:r1"],
    ["d-kanban-move", "card-done", undefined],
    ["d-ceremony-run", "ceremony-finished", undefined],
    ["d-kudos", "kudos-sent", "kudos:k1"],
    ["d-comic", "story-read", "story:1"],
  ])("%s completes on outcome:%s", (challenge, outcome, key) => {
    setDaily(challenge);
    recordOutcome(outcome, { key });
    expect(dailyById(challenge)?.completed).toBe(true);
  });

  it.each([
    ["w-retro-finish-2", "retro-finished", "retro"],
    ["w-impediments-5", "impediment-resolved", "impediment"],
    ["w-risks-3", "risk-closed", "risk"],
    ["w-debt-3", "debt-resolved", "debt"],
    ["w-ceremony-3", "ceremony-finished", ""],
    ["w-kudos-5", "kudos-sent", "kudos"],
  ])("%s moves on outcome:%s", (challenge, outcome, prefix) => {
    setWeekly(challenge);
    recordOutcome(outcome, prefix ? { key: `${prefix}:1` } : {});
    recordOutcome(outcome, prefix ? { key: `${prefix}:2` } : {});
    expect(weeklyById(challenge)?.progress).toBe(2);
  });

  it("the old input triggers no longer move the retargeted challenges", () => {
    setDaily("d-poker", "d-kanban-move", "d-ceremony-run");
    dispatch({ name: "tool:planning-poker:vote" });
    dispatch({ name: "tool:kanban:card-move" });
    dispatch({ name: "tool:ceremony-timer:start" });
    for (const id of ["d-poker", "d-kanban-move", "d-ceremony-run"]) {
      expect(dailyById(id)?.progress).toBe(0);
    }
  });

  it("a repeated outcome key doesn't move a challenge twice", () => {
    setWeekly("w-risks-3");
    recordOutcome("risk-closed", { key: "risk:1" });
    recordOutcome("risk-closed", { key: "risk:1" });
    expect(weeklyById("w-risks-3")?.progress).toBe(1);
  });

  it("an outcome past its daily XP cap still moves challenges", () => {
    for (let i = 0; i < 5; i++) recordOutcome("card-done", { meta: { toolId: "kanban" } });
    setDaily("d-kanban-move");
    const res = recordOutcome("card-done", { meta: { toolId: "kanban" } });
    expect(res.reason).toBe("outcome-cap");
    expect(dailyById("d-kanban-move")?.completed).toBe(true);
  });

  it("d-standup-entry completes on a standup's daily log, not a mood log", () => {
    setDaily("d-standup-entry");
    recordOutcome("daily-log", {
      key: "daily-log:mood-tracker:x",
      meta: { toolId: "mood-tracker" },
    });
    expect(dailyById("d-standup-entry")?.progress).toBe(0);
    recordOutcome("daily-log", { key: "daily-log:standup:x", meta: { toolId: "standup" } });
    expect(dailyById("d-standup-entry")?.completed).toBe(true);
  });

  it("d-resolve completes on anything resolved, not on other outcomes", () => {
    setDaily("d-resolve");
    recordOutcome("card-done", { meta: { toolId: "kanban" } });
    expect(dailyById("d-resolve")?.progress).toBe(0);
    recordOutcome("other-resolved", { key: "incident:1", meta: { toolId: "incident-commander" } });
    expect(dailyById("d-resolve")?.completed).toBe(true);
  });
});

describe("distinct-tool challenges", () => {
  it("d-tools-2 counts outcomes in DISTINCT tools", () => {
    setDaily("d-tools-2");
    recordOutcome("card-done", { meta: { toolId: "kanban" } });
    recordOutcome("card-done", { meta: { toolId: "kanban" } });
    expect(dailyById("d-tools-2")?.progress).toBe(1);
    expect(dailyById("d-tools-2")?.seen).toEqual(["kanban"]);
    recordOutcome("okr-achieved", { meta: { toolId: "okrs" } });
    expect(dailyById("d-tools-2")?.completed).toBe(true);
  });

  it("first tool visits and secrets are not finished work", () => {
    setDaily("d-tools-2");
    recordOutcome("first-tool", { key: "tool:velocity", meta: { toolId: "velocity" } });
    recordOutcome("first-tool", { key: "tool:okrs", meta: { toolId: "okrs" } });
    recordOutcome("secret", { key: "secret:konami" });
    expect(dailyById("d-tools-2")?.progress).toBe(0);
  });

  it("w-tools-5 takes the tool from a direct outcome's row (kudos, comics)", () => {
    setWeekly("w-tools-5");
    recordOutcome("kudos-sent", { key: "kudos:1" });
    recordOutcome("kudos-received", { key: "kudos-in:2" }); // kudos again
    recordOutcome("story-read", { key: "story:1" });
    expect(weeklyById("w-tools-5")?.seen).toEqual(["kudos", "comics"]);
  });
});
