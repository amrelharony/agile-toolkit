import { describe, expect, it } from "vitest";
import { legacyCelebrationAllowed } from "@/lib/gamification/celebrations";
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from "@/lib/notify/prefs";

/**
 * NEXT_PUBLIC_CELEBRATIONS=legacy (kill switch until PR K): the old toasts
 * still follow Settings › Notifications. The gate is pure, so it's checked
 * as a table at fixed local times (no clock is faked). The provider wiring
 * is in provider-gating.test.tsx.
 */

const NOON = new Date(2026, 10, 8, 12, 0).getTime();
const NIGHT = new Date(2026, 10, 8, 23, 0).getTime();

function allowed(
  over: Partial<NotificationPrefs> = {},
  opts: { silentMode?: boolean; now?: number; pathname?: string; presenting?: boolean } = {}
): boolean {
  return legacyCelebrationAllowed({
    silentMode: opts.silentMode ?? false,
    prefs: { ...DEFAULT_NOTIFICATION_PREFS, silentModeAdopted: true, ...over },
    pathname: opts.pathname ?? "/",
    dom: { dataset: opts.presenting ? { presenting: "true" } : {} },
    now: opts.now ?? NOON,
  });
}

describe("legacyCelebrationAllowed", () => {
  it("shows at Balanced and Lively on a calm page", () => {
    expect(allowed()).toBe(true);
    expect(allowed({ celebrationLevel: "lively" })).toBe(true);
  });

  it("the Quiet level silences it", () => {
    expect(allowed({ celebrationLevel: "quiet" })).toBe(false);
  });

  it("an unknown stored level reads as the default", () => {
    expect(allowed({ celebrationLevel: "newer-build-level" })).toBe(true);
  });

  it("Pause celebrations silences it until it ends", () => {
    expect(allowed({ celebrationsPausedUntil: NOON + 1 })).toBe(false);
    expect(allowed({ celebrationsPausedUntil: NOON })).toBe(true);
  });

  it("Focus silences it", () => {
    expect(allowed({ focusUntil: NOON + 60_000 })).toBe(false);
  });

  it("quiet hours silence it inside the range only", () => {
    const quietHours = { enabled: true, start: "22:00", end: "07:00" };
    expect(allowed({ quietHours }, { now: NIGHT })).toBe(false);
    expect(allowed({ quietHours }, { now: NOON })).toBe(true);
  });

  it("presenting and ceremony routes silence it", () => {
    expect(allowed({}, { presenting: true })).toBe(false);
    expect(allowed({}, { pathname: "/retro/abc" })).toBe(false);
  });

  it("silent mode counts only until it has been mapped onto the level", () => {
    expect(allowed({ silentModeAdopted: false }, { silentMode: true })).toBe(false);
    // Once mapped, the level decides: turning it back up shows toasts again.
    expect(allowed({ silentModeAdopted: true }, { silentMode: true })).toBe(true);
  });
});
