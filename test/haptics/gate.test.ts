import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The haptics gate reads scroll and input suppression from the shared
 * attention timestamps instead of owning its own listeners. Registering is
 * idempotent and only releases haptics' own lease.
 */

import {
  registerSuppressionListeners,
  shouldFire,
  unregisterSuppressionListeners,
  type GateContext,
} from "@/lib/haptics/gate";
import {
  __resetAttentionForTests,
  installAttention,
  isAttentionInstalled,
} from "@/lib/notify/attention";
import type { HapticPatternName, HapticPatternSpec } from "@/lib/haptics/types";

let clock = 50_000;

beforeEach(() => {
  unregisterSuppressionListeners();
  __resetAttentionForTests();
  clock = 50_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  unregisterSuppressionListeners();
  __resetAttentionForTests();
  vi.restoreAllMocks();
});

const pattern = { category: "ui", vibrate: [10] } as unknown as HapticPatternSpec;

function ctx(patternName: HapticPatternName, patch: Partial<GateContext> = {}): GateContext {
  return {
    enabled: true,
    mode: "full",
    respectReducedMotion: true,
    perCategory: {},
    batteryGuardEnabled: false,
    reducedMotion: false,
    batterySnapshot: null,
    // Far from any earlier fire so the global cooldown never interferes.
    now: clock,
    patternName,
    pattern,
    ...patch,
  } as GateContext;
}

describe("suppression listeners", () => {
  it("register installs attention once; unregister releases it", () => {
    registerSuppressionListeners();
    registerSuppressionListeners();
    expect(isAttentionInstalled()).toBe(true);
    unregisterSuppressionListeners();
    expect(isAttentionInstalled()).toBe(false);
  });

  it("unregister keeps another owner's attention running", () => {
    const other = installAttention();
    registerSuppressionListeners();
    unregisterSuppressionListeners();
    expect(isAttentionInstalled()).toBe(true);
    other();
  });

  it("adds no scroll or input listeners of its own", () => {
    __resetAttentionForTests();
    const add = vi.spyOn(window, "addEventListener");
    registerSuppressionListeners();
    // Only attention's four listeners, added once.
    expect(add.mock.calls.filter((c) => c[0] === "scroll")).toHaveLength(1);
    expect(add.mock.calls.filter((c) => c[0] === "input")).toHaveLength(1);
  });
});

describe("shouldFire with attention", () => {
  it("suppresses for 250 ms after a scroll", () => {
    registerSuppressionListeners();
    clock += 10_000;
    window.dispatchEvent(new Event("scroll"));
    clock += 100;
    expect(shouldFire(ctx("soft-pulse", { now: clock }))).toBe("suppress");
    clock += 200;
    expect(shouldFire(ctx("soft-pulse", { now: clock }))).toBe("fire");
  });

  it("suppresses non-keystroke haptics for 150 ms after input; keystrokes pass", () => {
    registerSuppressionListeners();
    clock += 20_000;
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    clock += 60;
    expect(shouldFire(ctx("soft-pulse", { now: clock }))).toBe("suppress");
    expect(shouldFire(ctx("keystroke", { now: clock }))).toBe("fire");
    clock += 200;
    expect(shouldFire(ctx("soft-pulse", { now: clock }))).toBe("fire");
    input.remove();
  });

  it("priority patterns ignore the suppression windows", () => {
    registerSuppressionListeners();
    clock += 30_000;
    window.dispatchEvent(new Event("scroll"));
    const priority = { ...pattern, priority: true } as HapticPatternSpec;
    expect(shouldFire(ctx("timer-end", { now: clock, pattern: priority }))).toBe("fire");
  });
});
