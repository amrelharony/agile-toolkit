import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useVDnaStore, VDNA_PERSIST_VERSION } from "@/lib/stores/vdna-store";
import { HAPTICS_PERSIST_VERSION, useHapticsStore } from "@/lib/stores/haptics-store";
import { safeJSONStorage } from "@/lib/stores/safe-storage";

/**
 * Rollback safety for the persisted gamification and haptics stores.
 *
 * zustand discards a stored payload whose version differs from the store's
 * unless a `migrate` is given. These stores carry an explicit version plus a
 * pass-through migrate, so data written by an older build (v0) or by a newer
 * one (say v7, after a revert) loads without losing anything.
 */

const VDNA_KEY = "agile-toolkit:vdna";
const HAPTICS_KEY = "agile-toolkit:haptics";

const savedVDna = {
  visitorId: "visitor-abc",
  displayName: "Sam",
  lifetimeXp: 12_345,
  xp: 4_321,
  level: 9,
  prestige: 1,
  unlocked: ["first-click", "retro-one", "secret-konami"],
  toolsVisited: ["retro", "planning-poker", "kanban"],
  lastActiveDate: "2026-11-07",
  streak: 6,
  longestStreak: 14,
  dailyChallenges: [{ id: "d-click-10", progress: 4, target: 10, completed: false }],
  weeklyChallenges: [],
  recentEvents: [{ amount: 40, source: "tool:retro", at: "2026-11-07T10:00:00.000Z" }],
  shareOnLeaderboard: true,
  silentMode: true,
  counters: { click: 900, "tool:retro:vote": 12 },
};

/** Fields a future schema adds (the v1 ledger, for example). */
const futureFields = {
  xpDay: { date: "2026-11-07", total: 120, byKey: { "risk-closed": 30 } },
  claims: { "risk:r1": 20_000 },
  onceKeys: ["secret:konami"],
};

function store(key: string, state: unknown, version?: number) {
  const payload = version === undefined ? { state } : { state, version };
  localStorage.setItem(key, JSON.stringify(payload));
}

function stored(key: string): { state: Record<string, unknown>; version: number } {
  return JSON.parse(localStorage.getItem(key) ?? "null");
}

beforeEach(() => {
  localStorage.clear();
});

describe("vdna store persistence", () => {
  it("declares version 0 explicitly", () => {
    expect(VDNA_PERSIST_VERSION).toBe(0);
    expect(useVDnaStore.persist.getOptions().version).toBe(0);
    expect(typeof useVDnaStore.persist.getOptions().migrate).toBe("function");
  });

  it("loads a v0 payload without loss", async () => {
    store(VDNA_KEY, savedVDna, 0);
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject(savedVDna);
  });

  it("loads a legacy payload with no version stamp", async () => {
    store(VDNA_KEY, savedVDna);
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject(savedVDna);
  });

  it("loads a v7 payload from a newer build without loss, unknown fields included", async () => {
    store(VDNA_KEY, { ...savedVDna, ...futureFields }, 7);
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject({ ...savedVDna, ...futureFields });

    // Written back with the newer fields intact, so rolling forward again
    // finds them where it left them.
    const back = stored(VDNA_KEY);
    expect(back.state).toMatchObject({ ...savedVDna, ...futureFields });
  });

  it("falls back to defaults for a corrupted newer payload", async () => {
    store(VDNA_KEY, "garbage", 7);
    await useVDnaStore.persist.rehydrate();
    const s = useVDnaStore.getState();
    expect(typeof s.lifetimeXp).toBe("number");
    expect(Array.isArray(s.unlocked)).toBe(true);
    // The rehydrate hook still seeds a visitor id.
    expect(s.visitorId).not.toBe("pending");
  });
});

describe("haptics store persistence", () => {
  const savedHaptics = {
    enabled: false,
    intensity: 0.3,
    mode: "essential",
    respectReducedMotion: false,
    batteryGuardEnabled: false,
    perCategory: {
      ceremonies: true,
      voting: false,
      drag: true,
      toasts: false,
      ui: false,
      timer: true,
      error: true,
    },
    welcomeToastShown: true,
  };

  it("declares version 0 explicitly", () => {
    expect(HAPTICS_PERSIST_VERSION).toBe(0);
    expect(useHapticsStore.persist.getOptions().version).toBe(0);
  });

  it("loads a v0 payload without loss", async () => {
    store(HAPTICS_KEY, savedHaptics, 0);
    await useHapticsStore.persist.rehydrate();
    expect(useHapticsStore.getState()).toMatchObject(savedHaptics);
  });

  it("loads a v7 payload without loss", async () => {
    store(HAPTICS_KEY, { ...savedHaptics, futureFlag: "kept" }, 7);
    await useHapticsStore.persist.rehydrate();
    expect(useHapticsStore.getState()).toMatchObject({ ...savedHaptics, futureFlag: "kept" });
  });
});

describe("why the migrate matters", () => {
  it("a persisted store without migrate drops a newer payload", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const control = create<{ xp: number }>()(
      persist(() => ({ xp: 0 }), {
        name: "control",
        storage: safeJSONStorage("control"),
        skipHydration: true,
      })
    );
    store("control", { xp: 999 }, 1);
    await control.persist.rehydrate();
    expect(control.getState().xp).toBe(0);
    err.mockRestore();
  });
});
