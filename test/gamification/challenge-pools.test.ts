import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CHALLENGES_PER_PERIOD,
  DAILY_POOL,
  WEEKLY_POOL,
  pickDailies,
  pickWeeklies,
  sanitizeChallenges,
  todaySeedKey,
  weekSeedKey,
} from "@/lib/gamification/challenges";
import { OUTCOMES } from "@/lib/gamification/outcomes";
import { dispatch } from "@/lib/gamification/engine";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import type { ChallengeKind, ChallengeProgress } from "@/lib/gamification/types";
import { scanEmissions } from "./emit-scan";

/**
 * The challenge pools ask for finished work, every trigger can actually
 * fire, and a stored list from an older pool is sanitised at runtime (no
 * store version bump).
 */

const ALL = [...DAILY_POOL, ...WEEKLY_POOL];

const CUT = [
  "d-click-10",
  "d-hover-50",
  "d-scroll",
  "d-combo-3",
  "d-theme-flip",
  "d-audio",
  "d-prompt",
  "d-story",
  "d-secret",
  "w-click-500",
  "w-combos-10",
  "w-workspace-push",
];

/** Triggers the engine fires itself (engine.ts). */
const ENGINE_TRIGGERS = new Set([
  "outcome",
  "xp-earned",
  "daily-active",
  "achievement-unlocked",
  "tool-visit-week-unique",
  "export",
  "tool:mood-tracker:logged",
]);

/** Raw input and settings: never a challenge trigger again. */
const INPUT_TRIGGERS = [
  "click",
  "hover",
  "key",
  "scroll-floor",
  "session-minute",
  "combo-reached-3",
  "theme-toggle",
  "sonification-on",
  "prompt-copied",
  "drag-drop",
  "workspace-push",
  "secret-found",
];

describe("challenge pools", () => {
  it("drops the input, preference and combo challenges", () => {
    const ids = ALL.map((c) => c.id);
    for (const id of CUT) expect(ids).not.toContain(id);
  });

  it("has the new outcome challenges", () => {
    const daily = DAILY_POOL.map((c) => c.id);
    const weekly = WEEKLY_POOL.map((c) => c.id);
    expect(daily).toEqual(
      expect.arrayContaining(["d-kudos", "d-resolve", "d-retro-finish", "d-comic", "d-tools-2"])
    );
    expect(weekly).toEqual(
      expect.arrayContaining(["w-kudos-5", "w-risks-3", "w-retro-finish-2", "w-tools-5"])
    );
    expect(WEEKLY_POOL.find((c) => c.id === "w-xp-600")?.goal).toBe(600);
    expect(weekly).not.toContain("w-xp-2000");
  });

  it("retargets poker, ceremony, kanban and standup to outcomes", () => {
    const trigger = (id: string) => DAILY_POOL.find((c) => c.id === id)?.trigger;
    expect(trigger("d-poker")).toBe("outcome:estimate-committed");
    expect(trigger("d-ceremony-run")).toBe("outcome:ceremony-finished");
    expect(trigger("d-kanban-move")).toBe("outcome:card-done");
    expect(trigger("d-standup-entry")).toBe("outcome:daily-log");
  });

  it("has unique ids and enough challenges to pick 3 a period", () => {
    expect(new Set(ALL.map((c) => c.id)).size).toBe(ALL.length);
    expect(DAILY_POOL.length).toBeGreaterThanOrEqual(CHALLENGES_PER_PERIOD * 3);
    expect(WEEKLY_POOL.length).toBeGreaterThanOrEqual(CHALLENGES_PER_PERIOD * 3);
    for (const c of ALL) {
      expect(c.id.startsWith(DAILY_POOL.includes(c) ? "d-" : "w-")).toBe(true);
      expect(c.goal).toBeGreaterThan(0);
      expect(c.xp).toBeGreaterThan(0);
    }
  });

  it("never listens to raw input", () => {
    for (const c of ALL) expect(INPUT_TRIGGERS, c.id).not.toContain(c.trigger);
  });

  it("only uses triggers that something fires", () => {
    const outcomeIds = new Set(OUTCOMES.map((o) => o.id));
    const emitted = new Set(scanEmissions().map((e) => e.name));
    const dead = ALL.filter((c) => {
      if (ENGINE_TRIGGERS.has(c.trigger)) return false;
      if (c.trigger.startsWith("outcome:")) {
        return !outcomeIds.has(c.trigger.slice("outcome:".length) as never);
      }
      return !emitted.has(c.trigger);
    }).map((c) => `${c.id} → ${c.trigger}`);
    expect(dead).toEqual([]);
    // Reads every source file: slow on a loaded runner.
  }, 30_000);

  it("gives a distinct-count challenge a goal above 1", () => {
    for (const c of ALL.filter((x) => x.distinctBy)) expect(c.goal).toBeGreaterThan(1);
  });
});

describe("picking", () => {
  it("picks 3 distinct challenges, the same ones for the same day or week", () => {
    const day = new Date(2026, 10, 8, 9, 0, 0);
    const a = pickDailies(day);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((c) => c.id)).size).toBe(3);
    expect(pickDailies(new Date(2026, 10, 8, 23, 0, 0))).toEqual(a);
    expect(a.every((c) => c.seedDate === todaySeedKey(day) && c.kind === "daily")).toBe(true);
    const w = pickWeeklies(day);
    expect(w).toHaveLength(3);
    expect(w.every((c) => c.seedDate === weekSeedKey(day))).toBe(true);
  });
});

function progress(
  id: string,
  kind: ChallengeKind,
  over: Partial<ChallengeProgress> = {}
): ChallengeProgress {
  return {
    id,
    kind,
    progress: 0,
    goal: 1,
    xp: 50,
    completed: false,
    seedDate: kind === "daily" ? "2026-11-08" : "2026-W45",
    ...over,
  };
}

describe("sanitizeChallenges", () => {
  it("returns the same array when everything is still in the pool", () => {
    const list = pickDailies(new Date(2026, 10, 8));
    expect(sanitizeChallenges(list, "daily")).toBe(list);
    expect(sanitizeChallenges([], "daily")).toEqual([]);
  });

  it("drops an unfinished challenge that left the pool and tops up from the same seed", () => {
    const fresh = pickDailies(new Date(2026, 10, 8));
    const list = [progress("d-click-10", "daily", { goal: 10, progress: 4 }), fresh[0], fresh[1]];
    const out = sanitizeChallenges(list, "daily");
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.id)).not.toContain("d-click-10");
    expect(out.slice(0, 2)).toEqual([fresh[0], fresh[1]]);
    expect(new Set(out.map((c) => c.id)).size).toBe(3);
    expect(out[2]).toMatchObject({ progress: 0, completed: false, seedDate: "2026-11-08" });
    // Deterministic: the same stored list sanitises the same way.
    expect(sanitizeChallenges(list, "daily")).toEqual(out);
  });

  it("keeps a completed challenge that left the pool", () => {
    const done = progress("w-click-500", "weekly", {
      goal: 500,
      progress: 500,
      completed: true,
      completedAt: "2026-11-03T10:00:00.000Z",
    });
    const out = sanitizeChallenges(
      [done, progress("w-combos-10", "weekly", { goal: 10 }), progress("w-streak-7", "weekly")],
      "weekly"
    );
    expect(out[0]).toBe(done);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.id)).not.toContain("w-combos-10");
    expect(out.map((c) => c.id)).toContain("w-streak-7");
  });

  it("takes a changed goal and reward, keeping progress short of the new goal", () => {
    const out = sanitizeChallenges(
      [progress("w-tools-5", "weekly", { goal: 10, xp: 400, progress: 7 })],
      "weekly"
    );
    expect(out[0]).toMatchObject({ id: "w-tools-5", goal: 5, xp: 400, progress: 4 });
  });

  it("leaves a completed challenge's goal and reward alone", () => {
    const done = progress("w-tools-5", "weekly", { goal: 10, progress: 10, completed: true });
    const list = [done];
    expect(sanitizeChallenges(list, "weekly")).toBe(list);
  });
});

describe("a stored list from the old pool", () => {
  beforeAll(async () => {
    await useVDnaStore.persist.rehydrate();
  });
  beforeEach(() => {
    useVDnaStore.setState({
      unlocked: [],
      counters: {},
      dailyChallenges: [],
      weeklyChallenges: [],
      xpDay: { date: "", total: 0, byKey: {} },
      claims: {},
      onceKeys: [],
    });
  });

  it("swaps d-click-10 out on the next relevant event, and a click changes nothing", () => {
    const today = todaySeedKey();
    // Already active today: the click doesn't even tick the day streak.
    useVDnaStore.setState({ lastActiveDate: today });
    const stored = [
      { ...progress("d-click-10", "daily", { goal: 10, progress: 6 }), seedDate: today },
      { ...progress("d-poker", "daily", { goal: 1, xp: 60 }), seedDate: today },
      { ...progress("d-mood", "daily", { goal: 1, xp: 50 }), seedDate: today },
    ];
    useVDnaStore.getState().setDailyChallenges(stored);
    dispatch({ name: "click" });
    expect(useVDnaStore.getState().dailyChallenges).toBe(stored);

    dispatch({ name: "tool-visit", meta: { toolId: "kanban" } });
    const ids = useVDnaStore.getState().dailyChallenges.map((c) => c.id);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain("d-click-10");
    expect(ids.slice(0, 2)).toEqual(["d-poker", "d-mood"]);
  });
});
