import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SAME_ACTION_MERGE_MS,
  __resetCelebrationsForTests,
  achievementRarity,
  challengeRarity,
  flushCelebrations,
  handleEffect,
  handleOutcome,
  installCelebrations,
  levelRarity,
  seedCarriedOver,
  subscribeCelebrations,
} from "@/lib/gamification/celebrations";
import { recordOutcome, type OutcomeRecord } from "@/lib/gamification/ledger";
import { useInboxStore } from "@/lib/notify/inbox-store";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { findDaily, DAILY_POOL, WEEKLY_POOL } from "@/lib/gamification/challenges";
import type { InboxItem } from "@/lib/notify/inbox";

/**
 * Celebrations become Activity rows: rarity, the 1.5 s same-action merge,
 * challenge rows per day, kudos rows per id, the daily-cap row and the
 * one-off "progress carried over" row. Only the merge window's setTimeout is
 * faked; nothing else here depends on the clock.
 */

function rows(): InboxItem[] {
  return useInboxStore.getState().items;
}

function outcome(over: Partial<OutcomeRecord>): OutcomeRecord {
  return {
    id: "kudos-received",
    awarded: true,
    xp: 10,
    reason: "awarded",
    at: new Date().toISOString(),
    capReached: false,
    ...over,
  } as OutcomeRecord;
}

beforeEach(async () => {
  localStorage.clear();
  __resetCelebrationsForTests();
  useInboxStore.setState({ items: [], seeded: false });
  await useInboxStore.persist.rehydrate();
});

afterEach(() => {
  vi.useRealTimers();
  __resetCelebrationsForTests();
});

describe("rarity", () => {
  it.each([
    [{ xp: 25, category: "delivery" as const }, "common"],
    [{ xp: 100, category: "delivery" as const }, "rare"],
    [{ xp: 300, category: "delivery" as const }, "epic"],
    [{ xp: 50, category: "secret" as const }, "epic"],
    [{ xp: 50, category: "delivery" as const, hidden: true }, "epic"],
  ])("achievement %o is %s", (ach, rarity) => {
    expect(achievementRarity(ach, ach.xp)).toBe(rarity);
  });

  it("levels are rare, every fifth epic; weekly challenges rarer than daily", () => {
    expect(levelRarity(8)).toBe("rare");
    expect(levelRarity(10)).toBe("epic");
    expect(challengeRarity("daily")).toBe("common");
    expect(challengeRarity("weekly")).toBe("rare");
  });
});

describe("same-action merge", () => {
  it("merges what one action reports within 1.5 s, the rarest leading", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    handleEffect({
      kind: "achievement",
      payload: { id: "retro-one", title: "Retro Regular", xp: 50 },
    });
    handleEffect({ kind: "level-up", payload: { level: 10 } });
    expect(rows()).toHaveLength(0);
    vi.advanceTimersByTime(SAME_ACTION_MERGE_MS);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      kind: "level-up",
      title: "Level 10",
      rarity: "epic",
      xp: 50,
      gamification: true,
    });
    expect(rows()[0].children).toEqual([
      expect.objectContaining({ title: "Retro Regular", xp: 50, kind: "achievement" }),
    ]);
  });

  it("keeps separate actions in separate rows", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    handleEffect({ kind: "level-up", payload: { level: 3 } });
    vi.advanceTimersByTime(SAME_ACTION_MERGE_MS);
    handleEffect({ kind: "level-up", payload: { level: 4 } });
    vi.advanceTimersByTime(SAME_ACTION_MERGE_MS);
    expect(rows().map((r) => r.title)).toEqual(["Level 4", "Level 3"]);
  });

  it("runs no timer while nothing waits", () => {
    const set = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const windowTimers = () =>
      set.mock.calls.filter(([, ms]) => ms === SAME_ACTION_MERGE_MS).length;
    flushCelebrations();
    expect(windowTimers()).toBe(0);
    handleEffect({ kind: "level-up", payload: { level: 3 } });
    handleEffect({ kind: "level-up", payload: { level: 3 } });
    expect(windowTimers()).toBe(1);
    flushCelebrations();
    expect(clear).toHaveBeenCalled();
    set.mockRestore();
    clear.mockRestore();
  });

  it("XP effects are not celebrations", () => {
    handleEffect({ kind: "xp", payload: { amount: 5 } });
    flushCelebrations();
    expect(rows()).toHaveLength(0);
  });

  it("an unknown badge id still gets a row", () => {
    handleEffect({ kind: "achievement", payload: { id: "from-the-future", xp: 40 } });
    flushCelebrations();
    expect(rows()[0]).toMatchObject({ title: "New badge", xp: 40, icon: "Award" });
  });

  it("prestige is legendary", () => {
    handleEffect({ kind: "prestige", payload: { prestige: 2 } });
    flushCelebrations();
    expect(rows()[0]).toMatchObject({ kind: "prestige", title: "Prestige 2", rarity: "legendary" });
  });
});

describe("challenges", () => {
  it("group into one row per day, titled by the challenge", () => {
    const [a, b] = DAILY_POOL;
    const weekly = WEEKLY_POOL[0];
    handleEffect({ kind: "challenge-complete", payload: { id: a.id, kind: "daily", xp: a.xp } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].title).toBe(`Challenge done: ${findDaily(a.id)!.title}`);
    handleEffect({ kind: "challenge-complete", payload: { id: b.id, kind: "daily", xp: b.xp } });
    handleEffect({
      kind: "challenge-complete",
      payload: { id: weekly.id, kind: "weekly", xp: weekly.xp },
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      title: "3 challenges done today",
      xp: a.xp + b.xp + weekly.xp,
      rarity: "rare",
    });
    expect(rows()[0].children).toHaveLength(3);
  });
});

describe("ledger outcomes", () => {
  it("a received kudos gets its own row, keyed by kudos id", () => {
    handleOutcome(outcome({ key: "kudos-in:k1" }));
    handleOutcome(outcome({ key: "kudos-in:k2" }));
    expect(rows()).toHaveLength(2);
    expect(rows()[1]).toMatchObject({
      kind: "kudos",
      mergeKey: "kudos:k1",
      href: "/kudos",
      xp: 10,
    });
  });

  it("'Today's XP is full' appears once a day when the cap is reached", () => {
    const at = new Date(2026, 10, 8, 12).toISOString();
    handleOutcome(outcome({ id: "risk-closed", key: "risk:1", capReached: true, at }));
    handleOutcome(outcome({ id: "risk-closed", key: "risk:2", capReached: true, at }));
    const cap = rows().filter((r) => r.kind === "xp-cap");
    expect(cap).toHaveLength(1);
    expect(cap[0]).toMatchObject({ title: "Today's XP is full", mergeKey: "xp-cap:2026-11-08" });
    expect(cap[0].body).toMatch(/still count/);
  });

  it("other outcomes add nothing", () => {
    handleOutcome(outcome({ id: "risk-closed", key: "risk:3" }));
    expect(rows()).toHaveLength(0);
  });
});

describe("listeners and install", () => {
  it("tells subscribers about every row it adds", () => {
    const seen: string[] = [];
    const off = subscribeCelebrations((i) => seen.push(i.title));
    handleEffect({ kind: "level-up", payload: { level: 6 } });
    flushCelebrations();
    off();
    handleEffect({ kind: "level-up", payload: { level: 7 } });
    flushCelebrations();
    expect(seen).toEqual(["Level 6"]);
  });

  it("routes real ledger outcomes into the inbox, and detaching flushes the window", async () => {
    await useVDnaStore.persist.rehydrate();
    const detach = installCelebrations();
    const result = recordOutcome("kudos-received", { key: "kudos-in:live-1" });
    expect(result.reason).not.toBe("not-ready");
    expect(rows().some((r) => r.mergeKey === "kudos:live-1")).toBe(true);
    handleEffect({ kind: "level-up", payload: { level: 2 } });
    detach();
    expect(rows().some((r) => r.title === "Level 2")).toBe(true);
  });

  it("writes the pending window when the page is hidden or unloads", () => {
    const detach = installCelebrations();
    handleEffect({ kind: "level-up", payload: { level: 3 } });
    expect(rows().some((r) => r.title === "Level 3")).toBe(false);
    window.dispatchEvent(new Event("pagehide"));
    expect(rows().some((r) => r.title === "Level 3")).toBe(true);
    const stored = localStorage.getItem("agile-toolkit:activity") ?? "";
    expect(stored).toContain("Level 3");

    handleEffect({ kind: "level-up", payload: { level: 4 } });
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vis.mockRestore();
    expect(rows().some((r) => r.title === "Level 4")).toBe(true);

    detach();
    handleEffect({ kind: "level-up", payload: { level: 5 } });
    window.dispatchEvent(new Event("pagehide"));
    expect(rows().some((r) => r.title === "Level 5")).toBe(false);
    flushCelebrations();
  });
});

describe("progress carried over", () => {
  afterEach(() => {
    useVDnaStore.setState({ xp: 0, level: 1, unlocked: [] });
  });

  it("adds one row for an existing profile, then never again", () => {
    useVDnaStore.setState({ xp: 1200, level: 5, unlocked: ["retro-one"] });
    seedCarriedOver();
    seedCarriedOver();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      kind: "carried-over",
      title: "Your progress carried over",
      body: "Level 5, 1 badge",
    });
    expect(useInboxStore.getState().seeded).toBe(true);
  });

  it("adds nothing for a new profile but still marks it done", () => {
    useVDnaStore.setState({ xp: 0, level: 1, unlocked: [] });
    seedCarriedOver();
    expect(rows()).toHaveLength(0);
    expect(useInboxStore.getState().seeded).toBe(true);
  });
});
