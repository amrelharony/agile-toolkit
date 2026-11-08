import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * zustand's persist writes the whole store on every setState, hydrated or
 * not, and the vdna store skips hydration until a GamificationProvider reads
 * it. A bare /guest route mounts no provider, so an outcome recorded there
 * would save the empty in-memory profile over the stored one. These tests use
 * the real store, engine and ledger with a fresh (unhydrated) module graph.
 */

vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/emotion/engine", () => ({ pushMoodSignal: () => {} }));

const KEY = "agile-toolkit:vdna";

const savedProfile = {
  xp: 1234,
  level: 6,
  unlocked: ["konami"],
  counters: { "tool:kudos:received": 3 },
  xpDay: { date: "", total: 0, byKey: {} },
  claims: {},
  onceKeys: ["secret:konami"],
};

function seed() {
  localStorage.setItem(KEY, JSON.stringify({ state: savedProfile, version: 1 }));
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(KEY) ?? "{}").state ?? {};
}

const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  seed();
});

describe("before the profile is read from storage", () => {
  it("recordOutcome changes nothing and leaves the stored profile alone", async () => {
    const { recordOutcome } = await import("@/lib/gamification/ledger");
    const { useVDnaStore } = await import("@/lib/stores/vdna-store");
    const before = localStorage.getItem(KEY);

    expect(recordOutcome("kudos-received", { key: "kudos-in:k1" })).toEqual({
      awarded: false,
      xp: 0,
      reason: "not-ready",
    });
    expect(localStorage.getItem(KEY)).toBe(before);
    expect(useVDnaStore.getState().claims).toEqual({});
  });

  it("dispatch changes nothing and leaves the stored profile alone", async () => {
    const { dispatch } = await import("@/lib/gamification/engine");
    const before = localStorage.getItem(KEY);
    dispatch({ name: "tool:kudos:received" });
    dispatch({ name: "tool-visit", meta: { toolId: "kudos" } });
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it("a guest room's received kudos reads the profile first, then pays once into it", async () => {
    const { onKudosReceived } = await import("@/lib/kudos/receive-bridge");
    const { useVDnaStore } = await import("@/lib/stores/vdna-store");
    expect(useVDnaStore.persist.hasHydrated()).toBe(false);

    expect(onKudosReceived("k1")).toBe(true);
    expect(onKudosReceived("k1")).toBe(false);
    await flush();

    const state = useVDnaStore.getState();
    expect(state.xp).toBe(1244);
    expect(state.unlocked).toContain("konami");
    expect(state.onceKeys).toContain("secret:konami");
    expect(Object.keys(state.claims)).toEqual(["kudos-in:k1"]);
    expect(stored()).toMatchObject({ xp: 1244, unlocked: ["konami"] });
  });
});

describe("once the profile is read", () => {
  // persist still re-saves on any setState; returning the same state saves
  // every subscriber a render.
  it("returns the same state for a repeat, so no subscriber is notified", async () => {
    const { recordOutcome } = await import("@/lib/gamification/ledger");
    const { useVDnaStore } = await import("@/lib/stores/vdna-store");
    await useVDnaStore.persist.rehydrate();

    expect(recordOutcome("secret", { key: "secret:konami" }).reason).toBe("duplicate");
    const listener = vi.fn();
    const unsub = useVDnaStore.subscribe(listener);
    try {
      expect(recordOutcome("secret", { key: "secret:konami" }).reason).toBe("duplicate");
      expect(recordOutcome("not-an-outcome").reason).toBe("unknown");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsub();
    }
  });
});
