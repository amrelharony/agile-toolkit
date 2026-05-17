"use client";

import type { HapticPatternSpec, PerCategoryOverrides, HapticsMode, HapticCategory, HapticPatternName } from "./types";
import { isEssential } from "./patterns";

/**
 * All the gating logic for firing a haptic: enable toggles, mode, reduced-motion,
 * battery, scroll/input suppression windows, per-element + global cooldowns,
 * rolling rate-limit. Priority patterns bypass cooldown/rate-limit/suppression.
 */

export interface GateContext {
  enabled: boolean;
  mode: HapticsMode;
  respectReducedMotion: boolean;
  perCategory: PerCategoryOverrides;
  batteryGuardEnabled: boolean;
  reducedMotion: boolean;
  batterySnapshot: { level: number; charging: boolean } | null;
  now: number;
  patternName: HapticPatternName;
  pattern: HapticPatternSpec;
  targetEl?: HTMLElement | null;
  force?: boolean;
}

export type GateDecision = "fire" | "suppress" | "downgrade";

// Module-scope state — kept outside the store for fast, synchronous reads
let lastFireAt = 0;
let scrollingUntil = 0;
let typingUntil = 0;
const perElementLast = new WeakMap<Element, number>();
const rollingWindow: number[] = []; // timestamps within the last 1000ms
const ROLLING_WINDOW_MS = 1000;
const ROLLING_MAX = 8;
const GLOBAL_COOLDOWN = 40;
const PER_ELEMENT_COOLDOWN = 50;

/**
 * Register global scroll + input listeners so subsequent haptics can suppress
 * themselves. Safe to call multiple times (idempotent via a flag).
 */
// R9: hold the handler refs so they can be removed. Previously the
// listeners were inline arrow functions → impossible to removeEventListener
// → leak forever on HMR / SPA navigation.
let listenersRegistered = false;
const onScroll = () => { scrollingUntil = performance.now() + 250; };
const onInput = () => { typingUntil = performance.now() + 150; };

export function registerSuppressionListeners() {
  if (typeof window === "undefined" || listenersRegistered) return;
  listenersRegistered = true;
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("input", onInput, { passive: true, capture: true });
}

// R9: callable detach API so the haptics provider can clean up on
// unmount. Without this every HMR cycle in dev (and every cold-load
// after a sign-out/sign-in in prod) doubled-up the global listeners.
export function unregisterSuppressionListeners() {
  if (typeof window === "undefined" || !listenersRegistered) return;
  listenersRegistered = false;
  window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
  window.removeEventListener("input", onInput, { capture: true } as EventListenerOptions);
}

export function shouldFire(ctx: GateContext): GateDecision {
  const { pattern, patternName, now, targetEl } = ctx;

  if (ctx.force) return "fire";

  if (!ctx.enabled) return "suppress";
  if (ctx.mode === "off") return "suppress";

  // Essential mode drops everything except high-signal patterns
  if (ctx.mode === "essential" && !isEssential(patternName)) return "suppress";

  // Reduced-motion: suppress unless pattern is error or timer-end (critical signals)
  if (ctx.respectReducedMotion && ctx.reducedMotion) {
    if (!(patternName === "error" || patternName === "timer-end")) return "suppress";
  }

  // Per-category override
  const cat = pattern.category as HapticCategory;
  if (cat && ctx.perCategory[cat] === false) return "suppress";

  // Battery: downgrade instead of suppress so the signal still fires
  let downgrade = false;
  if (ctx.batteryGuardEnabled && ctx.batterySnapshot) {
    const { level, charging } = ctx.batterySnapshot;
    if (level < 0.15 && !charging) downgrade = true;
  }

  const isPriority = pattern.priority === true;
  // Keystroke haptics are the user *deliberately* asking for typing feedback,
  // so they must bypass the typing-suppression window (which exists to stop
  // *other* haptics from interrupting typing) and the rolling rate cap (a
  // fast typist can fire well past the 8/sec ceiling). Cooldowns still apply
  // — they protect the OS vibrate queue from a stuck-key flood.
  const isKeystroke =
    patternName === "keystroke" ||
    patternName === "keystroke-space" ||
    patternName === "keystroke-backspace";

  if (!isPriority) {
    // Global cooldown
    if (now - lastFireAt < GLOBAL_COOLDOWN) return "suppress";
    // Per-element cooldown
    if (targetEl) {
      const last = perElementLast.get(targetEl) ?? 0;
      if (now - last < PER_ELEMENT_COOLDOWN) return "suppress";
    }
    // Scroll suppression always applies — keystrokes shouldn't fire mid-scroll.
    if (now < scrollingUntil) return "suppress";
    // Typing suppression: applies to non-keystroke patterns only.
    if (!isKeystroke && now < typingUntil) return "suppress";
    // Rolling rate limit: bypassed for keystrokes (cooldowns above are enough).
    if (!isKeystroke) {
      while (rollingWindow.length && now - rollingWindow[0] > ROLLING_WINDOW_MS) {
        rollingWindow.shift();
      }
      if (rollingWindow.length >= ROLLING_MAX) return "suppress";
    }
  }

  return downgrade ? "downgrade" : "fire";
}

/** Record a fire — updates cooldown trackers. Call only when a haptic actually runs. */
export function recordFire(now: number, targetEl?: HTMLElement | null) {
  lastFireAt = now;
  if (targetEl) perElementLast.set(targetEl, now);
  rollingWindow.push(now);
}
