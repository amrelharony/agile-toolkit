import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  __resetLegacySilentModeForTests,
  clearLegacySilentMode,
  hadLegacySilentMode,
  useVDnaStore,
  VDNA_PERSIST_VERSION,
} from "@/lib/stores/vdna-store";
import { HAPTICS_PERSIST_VERSION, useHapticsStore } from "@/lib/stores/haptics-store";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { passThroughMigrate } from "@/lib/stores/persist-migrate";
import {
  ensureVDnaShape,
  isRetiredCounter,
  migrateVDna,
  ONCE_KEYS_CAP,
  SECRET_ONCE_KEYS,
} from "@/lib/gamification/vdna-migrate";
import { collectBackup, parseBackup, restoreBackup, serializeBackup } from "@/lib/data/backup";

/**
 * Rollback safety for the persisted gamification and haptics stores.
 *
 * zustand discards a stored payload whose version differs from the store's
 * unless a `migrate` is given. These stores carry an explicit version plus a
 * migrate, so data written by an older build (v0) or by a newer one (say v7,
 * after a revert) loads without losing anything. vdna is at v2: its migrate
 * brings v0 payloads up to the XP-ledger shape (v1), then drops `silentMode`
 * and the input-only counters (v2) (lib/gamification/vdna-migrate.ts).
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

/** What v0 → v2 changes in `savedVDna`; every other field stays as stored. */
const { silentMode: _silentMode, ...savedWithoutSilentMode } = savedVDna;
void _silentMode;
const savedAsV2 = {
  ...savedWithoutSilentMode,
  // 4,321 XP at prestige 1 is level 8 on the curve; the stored 9 was stale.
  level: 8,
  // v2 strips the input-only counters; the rest stay as stored.
  counters: { "tool:retro:vote": 12 },
  xpDay: { date: "", total: 0, byKey: {} },
  claims: {},
  onceKeys: [],
};

/** v2 leaves no trace of the dropped fields. */
function expectNoV2Leftovers(state: Record<string, unknown>) {
  expect("silentMode" in state).toBe(false);
  expect(Object.keys(state.counters as object)).not.toContain("click");
}

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
  // zustand merges a loaded payload into the CURRENT state, so reset the
  // in-memory stores to their defaults first; setState writes through to
  // storage, hence the clear afterwards.
  useVDnaStore.setState(useVDnaStore.getInitialState(), true);
  useHapticsStore.setState(useHapticsStore.getInitialState(), true);
  localStorage.clear();
  __resetLegacySilentModeForTests();
});

describe("vdna store persistence", () => {
  it("declares version 2 explicitly", () => {
    expect(VDNA_PERSIST_VERSION).toBe(2);
    expect(useVDnaStore.persist.getOptions().version).toBe(2);
    expect(typeof useVDnaStore.persist.getOptions().migrate).toBe("function");
  });

  it("loads a v0 payload without loss, migrated to v2", async () => {
    store(VDNA_KEY, savedVDna, 0);
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject(savedAsV2);
    expect(stored(VDNA_KEY)).toMatchObject({ state: savedAsV2, version: 2 });
    expectNoV2Leftovers(stored(VDNA_KEY).state);
    expectNoV2Leftovers(useVDnaStore.getState() as unknown as Record<string, unknown>);
  });

  it("loads a legacy payload with no version stamp", async () => {
    store(VDNA_KEY, savedVDna);
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject(savedAsV2);
    expectNoV2Leftovers(useVDnaStore.getState() as unknown as Record<string, unknown>);
  });

  it("loads a v1 payload, dropping silentMode and the input-only counters", async () => {
    store(
      VDNA_KEY,
      { ...savedAsV2, ...futureFields, silentMode: false, counters: { click: 3 } },
      1
    );
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject({ ...futureFields, counters: {}, level: 8 });
    expectNoV2Leftovers(stored(VDNA_KEY).state);
    expect(stored(VDNA_KEY).version).toBe(2);
  });

  it.each([
    ["v0", 0],
    ["v1", 1],
    ["unstamped", undefined],
  ])("notes a %s payload's silent mode before dropping it", async (_n, version) => {
    store(VDNA_KEY, { ...savedVDna, silentMode: true }, version);
    await useVDnaStore.persist.rehydrate();
    expect(hadLegacySilentMode()).toBe(true);
    expectNoV2Leftovers(useVDnaStore.getState() as unknown as Record<string, unknown>);
  });

  it("keeps the note across a reload until it has been adopted", async () => {
    store(VDNA_KEY, { ...savedVDna, silentMode: true }, 1);
    await useVDnaStore.persist.rehydrate();
    // The migrated payload is written back without silentMode ...
    expectNoV2Leftovers(stored(VDNA_KEY).state);
    // ... so the note is kept in a storage flag a fresh page still sees,
    // until the provider adopts it.
    expect(localStorage.getItem("agile-toolkit:legacy-silent")).toBe("1");
    await useVDnaStore.persist.rehydrate();
    expect(hadLegacySilentMode()).toBe(true);
    clearLegacySilentMode();
    expect(hadLegacySilentMode()).toBe(false);
    await useVDnaStore.persist.rehydrate();
    expect(hadLegacySilentMode()).toBe(false);
  });

  it("notes nothing when silent mode was off or absent", async () => {
    store(VDNA_KEY, { ...savedVDna, silentMode: false }, 1);
    await useVDnaStore.persist.rehydrate();
    store(VDNA_KEY, savedAsV2, 2);
    await useVDnaStore.persist.rehydrate();
    expect(hadLegacySilentMode()).toBe(false);
  });

  it("loads a v7 payload from a newer build without loss, unknown fields included", async () => {
    store(VDNA_KEY, { ...savedVDna, ...futureFields }, 7);
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject({ ...savedVDna, ...futureFields });

    // Written back with the newer fields intact, so rolling forward again
    // finds them where it left them...
    const back = stored(VDNA_KEY);
    expect(back.state).toMatchObject({ ...savedVDna, ...futureFields });
    // ...but stamped with THIS build's version: the marker drops to 2, so a
    // newer build's migrations must detect shape, not trust the version.
    expect(back.version).toBe(2);
  });

  it.each([
    ["newer", 7],
    ["same-version", 0],
  ])("falls back to defaults for a corrupted %s payload", async (_n, version) => {
    // Something real in memory first, so a merge over it would show.
    store(VDNA_KEY, savedVDna, 0);
    await useVDnaStore.persist.rehydrate();
    useVDnaStore.setState(useVDnaStore.getInitialState(), true);

    store(VDNA_KEY, "garbage", version);
    await useVDnaStore.persist.rehydrate();
    const s = useVDnaStore.getState() as unknown as Record<string, unknown>;
    expect(s.lifetimeXp).toBe(0);
    expect(s.unlocked).toEqual([]);
    expect(s.displayName).not.toBe("Sam");
    expect(s["0"]).toBeUndefined();
    // The rehydrate hook still seeds a fresh visitor id.
    expect(s.visitorId).not.toBe("pending");
    expect(s.visitorId).not.toBe("visitor-abc");
  });
});

describe("vdna v0 → v1 → v2", () => {
  it("seeds onceKeys from secrets already unlocked", async () => {
    store(VDNA_KEY, { ...savedVDna, unlocked: ["konami", "logo-whisperer", "retro-one"] }, 0);
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState().onceKeys.sort()).toEqual(["logo-whispered", "secret:konami"]);
    expect(useVDnaStore.getState().unlocked).toEqual(["konami", "logo-whisperer", "retro-one"]);
  });

  it("maps every secret achievement to a once key", () => {
    expect(Object.keys(SECRET_ONCE_KEYS).sort()).toEqual([
      "footer-click",
      "konami",
      "logo-whisperer",
      "triple-tap",
      "type-agile",
      "type-scrum",
    ]);
  });

  it("strips the input-only counters and keeps every other one", () => {
    const counters = {
      click: 1,
      hover: 95,
      "logo-hover": 3,
      "session-minutes": 29,
      "session-minutes-silent": 5,
      "audio-modes-used": 2,
      "audio-mode:full": 1,
      "tool:retro:card-add": 7,
      "week-tool:2026-45:kanban": 1,
      "retro-formats-used": 2,
      "export-png": 1,
    };
    const kept = {
      "tool:retro:card-add": 7,
      "week-tool:2026-45:kanban": 1,
      "retro-formats-used": 2,
      "export-png": 1,
    };
    for (const v of [0, 1]) {
      const out = migrateVDna<{ counters: Record<string, number> }>({ counters }, v);
      expect(out.counters).toEqual(kept);
    }
    expect(Object.keys(counters).filter(isRetiredCounter)).toEqual([
      "click",
      "hover",
      "logo-hover",
      "session-minutes",
      "session-minutes-silent",
      "audio-modes-used",
      "audio-mode:full",
    ]);
  });

  it("drops silentMode whatever its value", () => {
    for (const silentMode of [true, false, "yes"]) {
      const out = migrateVDna<Record<string, unknown>>({ xp: 0, silentMode }, 1);
      expect("silentMode" in out).toBe(false);
    }
  });

  it("recomputes level from xp and prestige", () => {
    expect(migrateVDna<{ level: number }>({ xp: 100, prestige: 0, level: 5 }, 0).level).toBe(2);
    expect(migrateVDna<{ level: number }>({ xp: 0, level: 7 }, 0).level).toBe(1);
    expect(migrateVDna<{ level: number }>({ xp: 10_000_000, level: 3 }, 0).level).toBe(20);
    // No usable xp: the stored level is left alone.
    expect(migrateVDna<{ level: number }>({ level: 4 }, 0).level).toBe(4);
  });

  it("keeps ledger fields already present and fixes malformed ones", () => {
    const kept = migrateVDna<Record<string, unknown>>({ ...savedVDna, ...futureFields }, 0);
    expect(kept).toMatchObject(futureFields);

    const fixed = migrateVDna<Record<string, unknown>>(
      {
        unlocked: ["type-agile"],
        xpDay: { date: 5, total: "lots", byKey: { a: 10, b: "x" } },
        claims: { "risk:r1": 20_000, bad: "no" },
        onceKeys: ["secret:konami", 7, ""],
      },
      0
    );
    expect(fixed.xpDay).toEqual({ date: "", total: 0, byKey: { a: 10 } });
    expect(fixed.claims).toEqual({ "risk:r1": 20_000 });
    expect(fixed.onceKeys).toEqual(["secret:konami", "secret:typed-agile"]);
  });

  it("caps onceKeys, keeping the newest", () => {
    const many = Array.from({ length: ONCE_KEYS_CAP + 10 }, (_, i) => `k${i}`);
    const out = migrateVDna<{ onceKeys: string[] }>({ onceKeys: many }, 0);
    expect(out.onceKeys).toHaveLength(ONCE_KEYS_CAP);
    expect(out.onceKeys[0]).toBe("k10");
  });

  it("is idempotent", () => {
    const once = migrateVDna<Record<string, unknown>>(
      { ...savedVDna, unlocked: ["konami"], extra: { kept: true } },
      0
    );
    expect(migrateVDna(once, 0)).toEqual(once);
    expect(migrateVDna(once, 1)).toEqual(once);
    expect(ensureVDnaShape(once)).toBe(once);
    expect(once.extra).toEqual({ kept: true });
  });

  it("upgrades by shape when migrate is skipped (unstamped or same-version)", () => {
    const legacy = { ...savedVDna };
    expect(ensureVDnaShape(legacy)).toMatchObject(savedAsV2);
    expectNoV2Leftovers(ensureVDnaShape(legacy) as Record<string, unknown>);
    // Ledger fields present: it went through migrate already, or it's a
    // current or newer payload, so it's left alone.
    const v1 = { ...savedVDna, ...futureFields };
    expect(ensureVDnaShape(v1)).toBe(v1);
    expect(ensureVDnaShape("garbage")).toBe("garbage");
  });

  it("passes a newer payload through untouched", () => {
    const newer = { ...savedVDna, counters: { click: 900 }, level: 9, futureFlag: 1 };
    expect(migrateVDna(newer, 3)).toEqual(newer);
  });

  it("survives a round trip through a v1 build (PR B to J) without losing data", async () => {
    const v2 = { ...savedAsV2, ...futureFields };
    // A v1 build passes a newer payload through whole and writes it back
    // stamped 1; this build then re-runs its idempotent steps.
    store(VDNA_KEY, passThroughMigrate<Record<string, unknown>>(v2), 1);
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject(v2);
  });

  it("survives a round trip through a pre-v1 build (PR A) without losing ledger data", async () => {
    const v1 = { ...savedAsV2, ...futureFields };
    // A PR-A build loads v1 data with its pass-through migrate and writes it
    // back stamped v0 (simulated with the same helper and storage format).
    const asWrittenByPrA = passThroughMigrate<Record<string, unknown>>(v1);
    store(VDNA_KEY, asWrittenByPrA, 0);
    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject(v1);
  });

  it("prestige keeps the ledger fields", () => {
    useVDnaStore.setState({
      xpDay: futureFields.xpDay,
      claims: futureFields.claims,
      onceKeys: futureFields.onceKeys,
    });
    useVDnaStore.getState().prestigeReset();
    expect(useVDnaStore.getState()).toMatchObject(futureFields);
  });

  it("fresh profiles start with empty ledger fields", () => {
    expect(useVDnaStore.getState()).toMatchObject({
      xpDay: { date: "", total: 0, byKey: {} },
      claims: {},
      onceKeys: [],
    });
  });
});

describe("backup restore", () => {
  it("restores a v0 profile that migrates on the next load, and leaves the inbox out", async () => {
    // The backed-up browser: a v0 profile plus an Activity inbox.
    store(VDNA_KEY, savedVDna, 0);
    localStorage.setItem("agile-toolkit:activity", JSON.stringify({ state: { items: [1] } }));
    const file = serializeBackup(collectBackup(localStorage));
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.backup.keys)).toContain(VDNA_KEY);
    expect(Object.keys(parsed.backup.keys)).not.toContain("agile-toolkit:activity");

    // A different browser with its own inbox restores the file.
    localStorage.clear();
    localStorage.setItem("agile-toolkit:activity", "mine");
    restoreBackup(parsed.backup, localStorage);
    expect(localStorage.getItem("agile-toolkit:activity")).toBe("mine");

    await useVDnaStore.persist.rehydrate();
    expect(useVDnaStore.getState()).toMatchObject(savedAsV2);
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

  it("declares version 1 (PR F: Essential defaults) explicitly", () => {
    expect(HAPTICS_PERSIST_VERSION).toBe(1);
    expect(useHapticsStore.persist.getOptions().version).toBe(1);
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
