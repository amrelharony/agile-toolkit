import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  awardXp,
  dispatch,
  subscribe,
  type GamificationSideEffect,
} from "@/lib/gamification/engine";
import { ingestEvent, ingestToolVisit, recordOutcome } from "@/lib/gamification/ledger";
import { isGamificationEnabled } from "@/lib/gamification/enabled";
import { todaySeedKey } from "@/lib/gamification/challenges";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";

/**
 * Settings › Notifications › "XP, levels and badges" off: the engine and
 * the ledger pause. No XP, no badge, no challenge, no counter and no claim
 * is written, so the same outcome still pays once it's back on. The day
 * streak keeps going and every total is kept. Real engine and ledger; the
 * clock is a shifted Date subclass.
 */

const RealDate = Date;
let nowMs = new RealDate(2026, 10, 8, 13, 0).getTime();
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(nowMs);
    else super(...(args as [number]));
  }
  static now() {
    return nowMs;
  }
}

beforeAll(async () => {
  vi.stubGlobal("Date", ShiftedDate);
  await useVDnaStore.persist.rehydrate();
});
afterAll(() => vi.unstubAllGlobals());

const yesterdayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todaySeedKey(d);
};

let effects: GamificationSideEffect[] = [];
let unsubscribe: () => void = () => {};

beforeEach(() => {
  nowMs = new RealDate(2026, 10, 8, 13, 0).getTime();
  unsubscribe();
  effects = [];
  unsubscribe = subscribe((e) => effects.push(e));
  useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
  useVDnaStore.setState({
    unlocked: [],
    counters: {},
    xp: 1234,
    lifetimeXp: 5000,
    level: 5,
    prestige: 0,
    toolsVisited: [],
    dailyChallenges: [],
    weeklyChallenges: [],
    recentEvents: [],
    xpDay: { date: "", total: 0, byKey: {} },
    claims: {},
    onceKeys: [],
    streak: 4,
    longestStreak: 9,
    lastActiveDate: yesterdayKey(),
  });
});

const pause = () => useNotificationPrefsStore.getState().setGamificationEnabled(false);
const resume = () => useNotificationPrefsStore.getState().setGamificationEnabled(true);

describe("gamification off", () => {
  it("reads the prefs switch (on by default)", () => {
    expect(isGamificationEnabled()).toBe(true);
    pause();
    expect(isGamificationEnabled()).toBe(false);
  });

  it("an outcome pays nothing, claims nothing and dispatches nothing", () => {
    pause();
    const result = recordOutcome("risk-closed", { key: "risk:1" });
    expect(result).toEqual({ awarded: false, xp: 0, reason: "paused" });
    const s = useVDnaStore.getState();
    expect(s.xp).toBe(1234);
    expect(s.lifetimeXp).toBe(5000);
    expect(s.onceKeys).toEqual([]);
    expect(s.claims).toEqual({});
    expect(s.xpDay.total).toBe(0);
    expect(s.unlocked).toEqual([]);
    expect(s.counters["outcome:risk-closed"]).toBeUndefined();
    expect(effects).toEqual([]);
  });

  it("tool events, tool visits and secrets move no counter, badge or challenge", () => {
    pause();
    ingestEvent("tool:kanban:card-done");
    ingestToolVisit("kanban");
    dispatch({ name: "secret:konami" });
    dispatch({ name: "room-joined" });
    const s = useVDnaStore.getState();
    expect(s.counters).toEqual({});
    expect(s.toolsVisited).toEqual([]);
    expect(s.unlocked).toEqual([]);
    expect(s.xp).toBe(1234);
    expect(effects).toEqual([]);
  });

  it("awardXp is a no-op (achievement and challenge rewards too)", () => {
    pause();
    awardXp(500, "achievement", { achievementId: "x" });
    expect(useVDnaStore.getState().xp).toBe(1234);
    expect(useVDnaStore.getState().recentEvents).toEqual([]);
  });

  it("keeps the day streak alive", () => {
    pause();
    dispatch({ name: "app-active" });
    let s = useVDnaStore.getState();
    expect(s.streak).toBe(5);
    expect(s.lastActiveDate).toBe(todaySeedKey());
    expect(s.longestStreak).toBe(9);

    // A relevant event on the next day counts as activity too.
    nowMs += 24 * 60 * 60_000;
    ingestEvent("tool:kanban:card-done");
    s = useVDnaStore.getState();
    expect(s.streak).toBe(6);
    expect(s.counters).toEqual({});
  });

  it("switching back on pays the same outcome then, once", () => {
    pause();
    recordOutcome("risk-closed", { key: "risk:1" });
    resume();
    const result = recordOutcome("risk-closed", { key: "risk:1" });
    expect(result.reason).toBe("awarded");
    expect(result.xp).toBe(30);
    const s = useVDnaStore.getState();
    expect(s.xp).toBeGreaterThanOrEqual(1234 + 30);
    expect(s.onceKeys).toContain("risk:1");
    expect(s.unlocked).toContain("first-win");
    expect(recordOutcome("risk-closed", { key: "risk:1" }).reason).toBe("duplicate");
  });
});
