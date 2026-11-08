import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Haptics v1 (notification redesign, PR F):
 * - the store moves untouched defaults to Essential with toast and UI haptics
 *   off; anyone who changed a setting keeps it; a marked payload is never
 *   moved again; newer payloads pass through
 * - `success` is no longer essential
 * - priority patterns bypass the cooldowns only, not the suppression windows
 * - under reduced motion, quiet hours or Focus only `timer-end` vibrates
 */

import {
  HAPTICS_PERSIST_VERSION,
  HAPTICS_V0_DEFAULTS,
  migrateHaptics,
  useHapticsStore,
} from "@/lib/stores/haptics-store";
import { isEssential, PATTERNS } from "@/lib/haptics/patterns";
import {
  recordFire,
  registerSuppressionListeners,
  shouldFire,
  unregisterSuppressionListeners,
  type GateContext,
} from "@/lib/haptics/gate";
import { __resetAttentionForTests } from "@/lib/notify/attention";
import type { HapticPatternName } from "@/lib/haptics/types";

const KEY = "agile-toolkit:haptics";

function store(state: unknown, version: number) {
  localStorage.setItem(KEY, JSON.stringify({ state, version }));
}
function stored(): { state: Record<string, unknown>; version: number } {
  return JSON.parse(localStorage.getItem(KEY) ?? "null");
}

const untouchedV0 = {
  ...HAPTICS_V0_DEFAULTS,
  intensity: 0.6,
  respectReducedMotion: true,
  batteryGuardEnabled: true,
  welcomeToastShown: false,
};

describe("haptics store v1 migrate", () => {
  beforeEach(() => {
    useHapticsStore.setState(useHapticsStore.getInitialState(), true);
    localStorage.clear();
  });

  it("new users start on Essential with toast and UI haptics off", () => {
    const s = useHapticsStore.getInitialState();
    expect(s.mode).toBe("essential");
    expect(s.perCategory).toMatchObject({ toasts: false, ui: false, error: true, timer: true });
    expect(s.defaultsVersion).toBe(1);
  });

  it("moves an untouched v0 payload to the new defaults", async () => {
    store(untouchedV0, 0);
    await useHapticsStore.persist.rehydrate();
    const s = useHapticsStore.getState();
    expect(s.mode).toBe("essential");
    expect(s.perCategory).toMatchObject({ toasts: false, ui: false, voting: true });
    expect(s.enabled).toBe(true);
    expect(stored()).toMatchObject({
      version: HAPTICS_PERSIST_VERSION,
      state: { defaultsVersion: 1 },
    });
  });

  it.each([
    ["chose Essential", { mode: "essential" }],
    ["turned haptics off", { enabled: false }],
    ["turned voting off", { perCategory: { ...HAPTICS_V0_DEFAULTS.perCategory, voting: false } }],
  ])("keeps the choice of someone who %s", async (_n, patch) => {
    const payload = { ...untouchedV0, ...patch };
    store(payload, 0);
    await useHapticsStore.persist.rehydrate();
    expect(useHapticsStore.getState()).toMatchObject({ ...payload, defaultsVersion: 1 });
  });

  it("is idempotent and never moves a marked payload again", () => {
    const once = migrateHaptics(untouchedV0, 0);
    expect(migrateHaptics(once, 0)).toEqual(once);
    // A user later picked Full with every category on; a rolled-back build
    // re-stamped the payload v0 but kept the marker.
    const chosenFull = { ...untouchedV0, defaultsVersion: 1 };
    expect(migrateHaptics(chosenFull, 0)).toMatchObject({
      mode: "full",
      perCategory: { ui: true },
    });
  });

  it("keeps unknown fields and passes newer payloads through", async () => {
    expect(migrateHaptics({ ...untouchedV0, futureFlag: "x" }, 0)).toMatchObject({
      futureFlag: "x",
    });
    const newer = { ...untouchedV0, futureFlag: "kept" };
    expect(migrateHaptics(newer, 7)).toBe(newer);
    store(newer, 7);
    await useHapticsStore.persist.rehydrate();
    expect(useHapticsStore.getState()).toMatchObject({ mode: "full", futureFlag: "kept" });
  });

  it("a corrupted payload falls back to the defaults", async () => {
    store("garbage", 0);
    await useHapticsStore.persist.rehydrate();
    expect(useHapticsStore.getState().mode).toBe("essential");
  });
});

describe("essential patterns", () => {
  it("success is no longer essential; errors, timer end and milestones are", () => {
    expect(isEssential("success")).toBe(false);
    expect(isEssential("error")).toBe(true);
    expect(isEssential("timer-end")).toBe(true);
    expect(isEssential("achievement")).toBe(true);
  });
});

describe("gate", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    unregisterSuppressionListeners();
    __resetAttentionForTests();
    clock += 100_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    unregisterSuppressionListeners();
    __resetAttentionForTests();
    vi.restoreAllMocks();
  });

  function ctx(name: HapticPatternName, patch: Partial<GateContext> = {}): GateContext {
    return {
      enabled: true,
      mode: "full",
      respectReducedMotion: true,
      perCategory: {
        ceremonies: true,
        voting: true,
        drag: true,
        toasts: true,
        ui: true,
        timer: true,
        error: true,
      },
      batteryGuardEnabled: false,
      reducedMotion: false,
      batterySnapshot: null,
      now: clock,
      patternName: name,
      pattern: PATTERNS[name],
      ...patch,
    };
  }

  it.each([
    ["reduced motion", { reducedMotion: true }],
    ["quiet hours or Focus", { quiet: true }],
  ] as const)("under %s only timer-end passes; error does not vibrate", (_n, patch) => {
    expect(shouldFire(ctx("timer-end", patch))).toBe("fire");
    expect(shouldFire(ctx("error", patch))).toBe("suppress");
    expect(shouldFire(ctx("achievement", patch))).toBe("suppress");
    expect(shouldFire(ctx("tick", patch))).toBe("suppress");
  });

  it("reduced motion is ignored when the user opted out of respecting it", () => {
    expect(shouldFire(ctx("error", { reducedMotion: true, respectReducedMotion: false }))).toBe(
      "fire"
    );
  });

  it("essential mode drops success", () => {
    expect(shouldFire(ctx("success", { mode: "essential" }))).toBe("suppress");
    expect(shouldFire(ctx("error", { mode: "essential" }))).toBe("fire");
  });

  it("priority bypasses the cooldowns", () => {
    recordFire(clock);
    clock += 10;
    expect(shouldFire(ctx("tick", { now: clock }))).toBe("suppress");
    expect(shouldFire(ctx("error", { now: clock }))).toBe("fire");
  });

  it("priority does not bypass the scroll window; timer-end does", () => {
    registerSuppressionListeners();
    window.dispatchEvent(new Event("scroll"));
    clock += 50;
    expect(shouldFire(ctx("error", { now: clock }))).toBe("suppress");
    expect(shouldFire(ctx("achievement", { now: clock }))).toBe("suppress");
    expect(shouldFire(ctx("timer-end", { now: clock }))).toBe("fire");
  });
});
