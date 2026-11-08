"use client";

import type {
  HapticPatternSpec,
  PerCategoryOverrides,
  HapticsMode,
  HapticCategory,
  HapticPatternName,
} from "./types";
import { isEssential } from "./patterns";
import { installAttention, msSinceEdit, msSinceScroll } from "@/lib/notify/attention";

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
const perElementLast = new WeakMap<Element, number>();
const rollingWindow: number[] = []; // timestamps within the last 1000ms
const ROLLING_WINDOW_MS = 1000;
const ROLLING_MAX = 8;
const GLOBAL_COOLDOWN = 40;
const PER_ELEMENT_COOLDOWN = 50;
/** No haptics for this long after a scroll. */
const SCROLL_SUPPRESS_MS = 250;
/** No non-keystroke haptics for this long after an input event. */
const TYPING_SUPPRESS_MS = 150;

/**
 * Scroll and input suppression read the shared passive timestamps in
 * lib/notify/attention.ts, which owns the only global listeners. Haptics
 * holds one ref-counted lease on them. Safe to call multiple times.
 */
let attentionLease: (() => void) | null = null;

export function registerSuppressionListeners() {
  if (typeof window === "undefined" || attentionLease) return;
  attentionLease = installAttention();
}

// Callable detach API so the haptics provider can clean up on unmount.
// Releases only haptics' own lease; another owner keeps attention running.
export function unregisterSuppressionListeners() {
  if (!attentionLease) return;
  attentionLease();
  attentionLease = null;
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
    if (msSinceScroll(now) < SCROLL_SUPPRESS_MS) return "suppress";
    // Typing suppression: applies to non-keystroke patterns only.
    if (!isKeystroke && msSinceEdit(now) < TYPING_SUPPRESS_MS) return "suppress";
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
  // Prune before appending. shouldFire() only prunes inside its non-keystroke
  // branch, so a keystroke-only fire stream (a user typing into a haptic field,
  // which bypasses the rate limit) would otherwise push to rollingWindow on
  // every keystroke and never shift — an unbounded leak for the page's life.
  while (rollingWindow.length && now - rollingWindow[0] > ROLLING_WINDOW_MS) {
    rollingWindow.shift();
  }
  rollingWindow.push(now);
}
