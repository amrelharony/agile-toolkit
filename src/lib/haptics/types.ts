/**
 * Haptics engine — ultra-advanced vibration feedback with iOS visual fallback,
 * battery/scroll/input gating, pattern palette, and per-category overrides.
 */

export type HapticPatternName =
  | "tick"
  | "double-tick"
  | "triple-tick"
  | "success"
  | "error"
  | "warning"
  | "impact-light"
  | "impact-medium"
  | "impact-heavy"
  | "soft-pulse"
  | "long-press-confirm"
  | "drag-pickup"
  | "drag-drop"
  | "card-flip"
  | "reveal"
  | "vote-cast"
  | "timer-tick"
  | "timer-end"
  | "milestone"
  | "achievement"
  | "undo"
  | "refresh"
  | "navigate"
  | "toggle-on"
  | "toggle-off"
  // Typing — high-frequency, low-amplitude. Designed to be felt while typing
  // on a touch keyboard without overwhelming the engine on fast typists.
  | "keystroke"
  | "keystroke-space"
  | "keystroke-backspace";

export interface HapticPatternSpec {
  /** ms pattern for navigator.vibrate([on,off,on,...]). */
  vibrate: number[];
  /** iOS / unsupported fallback — applied as a CSS micro-scale on the element. */
  ios?: { cssScale: number; durationMs: number };
  /** Flagged priority patterns bypass cooldown + rate-limit + scroll/input suppression. */
  priority?: boolean;
  /** Category for per-category override gating. */
  category: HapticCategory;
}

export type HapticCategory =
  | "ceremonies"
  | "voting"
  | "drag"
  | "toasts"
  | "ui"
  | "timer"
  | "error";

export type HapticsMode = "full" | "essential" | "off";

export interface PerCategoryOverrides {
  ceremonies: boolean;
  voting: boolean;
  drag: boolean;
  toasts: boolean;
  ui: boolean;
  timer: boolean;
  error: boolean;
}

export interface FireOptions {
  /** Scales pattern durations (0..1). Defaults to store intensity. */
  intensity?: number;
  /** Element to pulse on iOS fallback. */
  targetEl?: HTMLElement | null;
  /** Bypass gates (used for settings UI "test" buttons). */
  force?: boolean;
}

export type HapticSupport = "vibrate" | "visual-only" | "none";
