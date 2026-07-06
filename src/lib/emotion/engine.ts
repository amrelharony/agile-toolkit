"use client";

import type {
  Mood,
  MoodListener,
  MoodProfile,
  MoodResolution,
  MoodSignal,
  MoodSource,
} from "./types";
import { getMoodProfile, moodCssVars } from "./profiles";
import { useEmotionStore } from "@/lib/stores/emotion-store";

/**
 * Emotion engine singleton — holds the active mood state, accepts signals from
 * multiple sources, resolves them via priority/TTL, and fans out the result
 * to React subscribers via `onMoodChange`.
 *
 * Resolution order (highest wins):
 *   1. user override (store.userOverride, if enabled)
 *   2. webcam signal (fresh, high confidence)
 *   3. weather signal (fresh)
 *   4. time signal (fresh)
 *   5. activity signal (fresh)
 *   6. default → "Neutral"
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000;

type SignalMap = Partial<Record<MoodSource, MoodSignal>>;

const signals: SignalMap = {};
let current: MoodResolution = {
  active: "Neutral",
  source: "default",
  profile: getMoodProfile("Neutral"),
  signals: [],
};
const listeners = new Set<MoodListener>();

const SOURCE_PRIORITY: MoodSource[] = ["user", "webcam", "weather", "time", "activity", "default"];

function prefersReducedMotionSync(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function isSignalFresh(s: MoodSignal, now: number): boolean {
  return now - s.at <= (s.ttlMs ?? DEFAULT_TTL_MS);
}

function resolve(): MoodResolution {
  const store = useEmotionStore.getState();

  // Globally disabled → lock to Neutral so animations collapse to their
  // neutral curves without any live re-profiling.
  if (!store.enabled) {
    return {
      active: "Neutral",
      source: "default",
      profile: getMoodProfile("Neutral"),
      signals: [],
    };
  }

  // prefers-reduced-motion override: collapse to a Focused profile with
  // trimmed durations; disables elastic overshoot that can nauseate.
  if (store.respectReducedMotion && prefersReducedMotionSync()) {
    return {
      active: "Focused",
      source: "default",
      profile: getMoodProfile("Focused"),
      signals: [],
    };
  }

  // Explicit user override beats every signal
  if (store.userOverride) {
    return {
      active: store.userOverride,
      source: "user",
      profile: getMoodProfile(store.userOverride),
      signals: [],
    };
  }

  const now = Date.now();
  const fresh: MoodSignal[] = [];
  for (const src of SOURCE_PRIORITY) {
    const s = signals[src];
    if (!s) continue;
    if (!isSignalFresh(s, now)) continue;
    // Respect per-source opt-out toggles
    if (src === "weather" && !store.useWeatherFallback) continue;
    if (src === "time" && !store.useTimeSignal) continue;
    fresh.push(s);
  }

  if (fresh.length === 0) {
    return {
      active: "Neutral",
      source: "default",
      profile: getMoodProfile("Neutral"),
      signals: [],
    };
  }

  // Priority order already matches SOURCE_PRIORITY, so the first fresh wins
  const winner = fresh[0];
  return {
    active: winner.mood,
    source: winner.source,
    profile: getMoodProfile(winner.mood),
    signals: fresh,
  };
}

// First fanout after module load should always apply CSS vars so `[data-mood]`
// selectors light up on first paint, even when the resolved mood matches the
// initial default (Neutral → Neutral).
let hasAppliedCssVars = false;

function fanout() {
  const next = resolve();
  const changed =
    next.active !== current.active ||
    next.source !== current.source ||
    next.signals.length !== current.signals.length;
  current = next;

  // Always ensure CSS vars are applied at least once so `[data-mood]` CSS
  // hooks work from first paint.  After that, only re-apply on actual change.
  if (!hasAppliedCssVars || changed) {
    applyCssVars(next.active);
    hasAppliedCssVars = true;
  }

  if (changed) {
    for (const l of Array.from(listeners)) {
      try {
        l(next);
      } catch {
        /* listener error — don't let one bad consumer break the rest */
      }
    }
  }
}

function applyCssVars(mood: Mood) {
  if (typeof document === "undefined") return;
  const vars = moodCssVars(mood);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.setAttribute("data-mood", mood);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Signals otherwise expire lazily — `isSignalFresh` is only consulted
// inside resolve(), which only runs on fanout(). Without a scheduled
// re-resolve, a short-TTL signal (e.g. the kudos receive-bridge's 30 s
// "Playful" lift) kept governing the active mood until some unrelated
// event happened to fire. One timer per source, replaced on re-push,
// cleared when the source is dropped.
const expiryTimers: Partial<Record<MoodSource, ReturnType<typeof setTimeout>>> = {};

function scheduleExpiryReresolve(source: MoodSource, ttlMs: number | undefined) {
  const prev = expiryTimers[source];
  if (prev !== undefined) clearTimeout(prev);
  expiryTimers[source] = setTimeout(
    () => {
      delete expiryTimers[source];
      fanout();
    },
    (ttlMs ?? DEFAULT_TTL_MS) + 50
  );
}

/**
 * Push a mood signal from a source.  The engine keeps one slot per source
 * and re-resolves the active mood.  Stale signals automatically fall out.
 */
export function pushMoodSignal(
  source: MoodSource,
  mood: Mood,
  opts: { confidence?: number; ttlMs?: number } = {}
) {
  signals[source] = {
    mood,
    source,
    confidence: opts.confidence ?? 0.6,
    ttlMs: opts.ttlMs,
    at: Date.now(),
  };
  scheduleExpiryReresolve(source, opts.ttlMs);
  fanout();
}

/** Drop a signal from a given source — useful when a sensor disconnects. */
export function clearMoodSignal(source: MoodSource) {
  delete signals[source];
  const timer = expiryTimers[source];
  if (timer !== undefined) {
    clearTimeout(timer);
    delete expiryTimers[source];
  }
  fanout();
}

/** Subscribe to mood transitions.  Fires immediately with current state. */
export function onMoodChange(listener: MoodListener): () => void {
  listeners.add(listener);
  // Fire with current state so subscribers don't need a separate read.
  try {
    listener(current);
  } catch {
    /* swallow */
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Synchronous read of the current resolution. */
export function getCurrentMood(): MoodResolution {
  return current;
}

/** Convenience read of just the profile (used by GSAP helpers). */
export function getCurrentProfile(): MoodProfile {
  return current.profile;
}

/**
 * Weather widget's entry point — the spec names this explicitly.  Kept as
 * a thin wrapper around pushMoodSignal so the hidden-logic requirement
 * ("window._setWeatherMood") lines up with a discoverable API.
 */
export function setWeatherMood(mood: Mood, confidence = 0.55) {
  pushMoodSignal("weather", mood, { confidence, ttlMs: 90 * 60 * 1000 });
}

/**
 * Attach to window for the secret console namespace — mirrors the pattern
 * used by gamification's VDna bridge.  Callable as `_setWeatherMood("Playful")`.
 */
export function installWindowBridge() {
  if (typeof window === "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)._setWeatherMood = (mood: Mood) => setWeatherMood(mood);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)._setMood = (mood: Mood, source: MoodSource = "user") =>
    pushMoodSignal(source, mood, { confidence: 1 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)._getMood = () => current;
}

/**
 * Kick off a re-resolution after the store hydrates so persisted user
 * overrides take effect on page load without waiting for a real signal.
 */
export function bootFromStore() {
  fanout();
}

/** Exposed so the engine can force a re-resolve when the store changes. */
export function reresolve() {
  fanout();
}
