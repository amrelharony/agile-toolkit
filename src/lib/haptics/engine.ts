"use client";

import { useHapticsStore } from "@/lib/stores/haptics-store";
import { getPattern, downgradePattern } from "./patterns";
import { getHapticEntry } from "./palette";
import { shouldFire, recordFire, registerSuppressionListeners } from "./gate";
import type {
  HapticPatternName,
  HapticPatternSpec,
  FireOptions,
  HapticSupport,
} from "./types";

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

let cachedSupport: HapticSupport | null = null;

export function detectSupport(): HapticSupport {
  if (cachedSupport) return cachedSupport;
  if (typeof navigator === "undefined") return (cachedSupport = "none");
  // Narrow-typed vibrate check — iOS Safari lacks it entirely; some Android
  // versions expose it as webkitVibrate.
  const hasVibrate = typeof (navigator as Navigator).vibrate === "function";
  cachedSupport = hasVibrate ? "vibrate" : "visual-only";
  return cachedSupport;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Battery snapshot — refreshed on chargingchange / levelchange
// ---------------------------------------------------------------------------

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
}

let batterySnapshot: { level: number; charging: boolean } | null = null;
let batteryInit = false;

async function initBattery() {
  if (batteryInit) return;
  batteryInit = true;
  if (typeof navigator === "undefined") return;
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery;
  if (!getBattery) return;
  try {
    const b = await getBattery.call(navigator);
    const snap = () => {
      batterySnapshot = { level: b.level, charging: b.charging };
    };
    snap();
    b.addEventListener?.("chargingchange", snap);
    b.addEventListener?.("levelchange", snap);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Scaling + dispatch
// ---------------------------------------------------------------------------

function scalePattern(pattern: number[], intensity: number): number[] {
  const i = Math.max(0, Math.min(1, intensity));
  return pattern.map((ms) => Math.max(3, Math.round(ms * i)));
}

// Track in-flight pulse timers per-element so overlapping pulses clear cleanly
// and detached elements don't accumulate stale attributes.
const pulseTimers = new WeakMap<HTMLElement, number>();

function runVisualPulse(el: HTMLElement, spec: HapticPatternSpec) {
  if (!spec.ios) return;
  const prev = pulseTimers.get(el);
  if (prev) window.clearTimeout(prev);
  el.style.setProperty("--haptic-scale", String(spec.ios.cssScale));
  el.setAttribute("data-haptic-pulse", "true");
  const id = window.setTimeout(() => {
    pulseTimers.delete(el);
    // Element may have been removed from the DOM mid-pulse — bail silently.
    if (!el.isConnected) return;
    el.removeAttribute("data-haptic-pulse");
    el.style.removeProperty("--haptic-scale");
  }, spec.ios.durationMs);
  pulseTimers.set(el, id);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function fire(name: HapticPatternName, opts: FireOptions = {}): boolean {
  if (typeof window === "undefined") return false;
  registerSuppressionListeners();
  void initBattery();

  const store = useHapticsStore.getState();
  const pattern = getPattern(name);
  if (!pattern) return false;

  const now = performance.now();
  const decision = shouldFire({
    enabled: store.enabled,
    mode: store.mode,
    respectReducedMotion: store.respectReducedMotion,
    perCategory: store.perCategory,
    batteryGuardEnabled: store.batteryGuardEnabled,
    reducedMotion: prefersReducedMotion(),
    batterySnapshot,
    now,
    patternName: name,
    pattern,
    targetEl: opts.targetEl,
    force: opts.force,
  });

  if (decision === "suppress") return false;

  let effectiveName: HapticPatternName = name;
  let effectiveSpec: HapticPatternSpec = pattern;
  if (decision === "downgrade") {
    effectiveName = downgradePattern(name);
    effectiveSpec = getPattern(effectiveName) ?? pattern;
  }

  const intensity = opts.intensity ?? store.intensity;
  const support = detectSupport();

  if (support === "vibrate") {
    const scaled = scalePattern(effectiveSpec.vibrate, intensity);
    let ok = false;
    try {
      // navigator.vibrate returns false when the device is in silent/DND mode,
      // when the user has vibration disabled, or when the call is rate-limited
      // by the browser.  Fall back to the visual pulse so users still get
      // feedback on a tap even if the hardware stays quiet.
      ok = (navigator as Navigator).vibrate(scaled) === true;
    } catch {
      ok = false;
    }
    if (!ok && opts.targetEl) runVisualPulse(opts.targetEl, effectiveSpec);
  } else if (support === "visual-only" && opts.targetEl) {
    runVisualPulse(opts.targetEl, effectiveSpec);
  }

  recordFire(now, opts.targetEl);
  // Silence lint if we want to know which pattern actually ran
  void effectiveName;
  return true;
}

/** Imperative helper used by the sonification emit.ts graft. */
export function fireFromEvent(
  toolId: string,
  eventName: string,
  targetEl?: HTMLElement | null,
) {
  const name = getHapticEntry(toolId, eventName);
  if (!name) return;
  fire(name, { targetEl });
}

/** Read by the event-router when a click lands on an element with data-haptic. */
export function fireFromAttribute(value: string, targetEl?: HTMLElement | null) {
  if (!value) return;
  const pattern = getPattern(value);
  if (!pattern) return;
  fire(value as HapticPatternName, { targetEl });
}

/** Raw pattern firing — bypasses the palette. */
export function fireRaw(vibrate: number[]) {
  if (typeof navigator === "undefined") return;
  if (detectSupport() !== "vibrate") return;
  try {
    (navigator as Navigator).vibrate(vibrate);
  } catch {
    /* ignore */
  }
}

export { detectSupport as isHapticsSupported };
