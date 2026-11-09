"use client";

import { announceToolMoment } from "@/lib/agent/mascot/tool-moments";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import { getEngine } from "./engine";
import { getEntry } from "./palette";
import { chordFreqs, stepToFreq, octaveShift } from "./scales";
import { getCurrentRoot } from "./use-scroll-filter";
import type { PaletteEntry, SonificationMode } from "./types";

function prefersReducedMotionSync(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function isAllowed(mode: SonificationMode, toolId: string): boolean {
  if (mode === "full") return true;
  if (mode === "minimal") return toolId === "ui" || toolId === "rt";
  if (mode === "ambient") return false;
  return true;
}

function play(toolId: string, entry: PaletteEntry) {
  const engine = getEngine();
  const root = getCurrentRoot();
  const targetOctave = entry.octave ?? 5;
  const shift = targetOctave - 4;
  const opts = {
    velocity: entry.velocity,
    duration: entry.duration,
    filter: entry.filter,
    jitterCents: entry.jitterCents,
  };

  if (entry.steps && entry.steps.length > 0) {
    const freqs = chordFreqs(entry.steps, root).map((f) => octaveShift(f, shift));
    engine.playChord(entry.voice, freqs, opts);
    return;
  }
  if (entry.step !== undefined) {
    const freq = octaveShift(stepToFreq(entry.step, root), shift);
    engine.playVoice(entry.voice, freq, opts);
  }
}

/**
 * Realtime events the gamification engine still listens to. `sync-first`
 * unlocks on the first remote sync; every other `rt` event (member join and
 * leave, connection state) is feedback only. Party-of-four has its own direct
 * signal from use-room.ts, so it doesn't need `rt` forwarding.
 */
const GAMIFIED_RT_EVENTS: ReadonlySet<string> = new Set(["sync-remote"]);

/**
 * Surfaces whose events are feedback only. `ui` covers clicks, hovers,
 * keystrokes, toasts and dialog state; `mascot` covers taps, reactions and
 * mood changes on the always-visible mascot. Input, not outcomes.
 */
const FEEDBACK_SURFACES: ReadonlySet<string> = new Set(["ui", "mascot"]);

/**
 * Whether an emit reaches the gamification engine. Tool events always do (the
 * ledger decides whether they pay); feedback surfaces (`ui`, `mascot`) never
 * do; `rt` events only when the engine has a rule for them.
 */
export function shouldForwardToGamification(toolId: string, eventName: string): boolean {
  if (FEEDBACK_SURFACES.has(toolId)) return false;
  if (toolId === "rt") return GAMIFIED_RT_EVENTS.has(eventName);
  return true;
}

/**
 * Sound and haptics only — never the gamification engine. Toasts and other
 * feedback-only surfaces use this, so a toast can't earn XP or move a badge.
 *
 * `targetEl` is optional and, when provided, lets the haptics engine apply its
 * per-element cooldown + iOS visual-pulse fallback to the originating element.
 *
 * `opts` lets the notification policy pick each half on its own: a success
 * toast plays its chord (only in Full sound mode) but no vibration, a warning
 * vibrates but an info toast does neither. Both default to on.
 */
export interface FeedbackOptions {
  /** Play the sound (still gated by the sound prefs). Default true. */
  sound?: boolean;
  /** Fire the haptic (still gated by the haptics prefs). Default true. */
  haptics?: boolean;
  /** Play the sound only in Full sound mode, not Minimal. Default false. */
  soundFullModeOnly?: boolean;
}

export function emitFeedback(
  toolId: string,
  eventName: string,
  targetEl?: HTMLElement | null,
  opts: FeedbackOptions = {}
) {
  if (typeof window === "undefined") return;

  // Forward to haptics — independent gating (runs even if sonification is off).
  if (opts.haptics !== false) void forwardToHaptics(toolId, eventName, targetEl ?? undefined);

  if (opts.sound === false) return;
  const prefs = useSonificationStore.getState();
  if (!prefs.enabled) return;
  if (prefs.respectReducedMotion && prefersReducedMotionSync()) return;
  if (opts.soundFullModeOnly && prefs.mode !== "full") return;
  if (!isAllowed(prefs.mode, toolId)) return;
  const entry = getEntry(toolId, eventName);
  if (!entry) return;
  play(toolId, entry);
}

/**
 * Non-hook emit.  Safe in any event handler or imperative context.
 * Plays feedback (sound + haptics, each gated by its own prefs) and hands
 * tool events to the gamification engine (see shouldForwardToGamification).
 */
export function emit(toolId: string, eventName: string, targetEl?: HTMLElement | null) {
  if (typeof window === "undefined") return;

  // Amr marks a few of these (an OKR achieved, a hypothesis settled), sound or not.
  announceToolMoment(toolId, eventName);

  // Forward to gamification — lazy-imported to avoid circular module dep.
  // Gamification runs even when sonification is off.
  if (shouldForwardToGamification(toolId, eventName)) {
    void forwardToGamification(toolId, eventName);
  }

  emitFeedback(toolId, eventName, targetEl);
}

let gamificationDispatch: ((name: string, meta?: Record<string, unknown>) => void) | null = null;
async function forwardToGamification(toolId: string, eventName: string) {
  try {
    if (!gamificationDispatch) {
      // The ledger hands the event to the engine and records it when it is
      // an outcome (lib/gamification/outcomes.ts); nothing else pays XP.
      const mod = await import("@/lib/gamification/ledger");
      gamificationDispatch = (name, meta) => mod.ingestEvent(name, meta);
    }
    // rt events reach the engine under their bare name (`sync-remote`).
    const canonical = toolId === "rt" ? eventName : `tool:${toolId}:${eventName}`;
    gamificationDispatch(canonical, { toolId, eventName });
  } catch {
    /* engine not loadable — ignore */
  }
}

let hapticsDispatch: ((toolId: string, eventName: string, targetEl?: HTMLElement) => void) | null =
  null;
async function forwardToHaptics(toolId: string, eventName: string, targetEl?: HTMLElement) {
  try {
    if (!hapticsDispatch) {
      const mod = await import("@/lib/haptics/engine");
      hapticsDispatch = (t, e, el) => mod.fireFromEvent(t, e, el ?? null);
    }
    hapticsDispatch(toolId, eventName, targetEl);
  } catch {
    /* engine not loadable — ignore */
  }
}

/** Convenience for UI surface events (`click-default`, `hover`, etc.). Feedback only. */
export function emitUiEvent(eventName: string) {
  emit("ui", eventName);
}

/** Convenience for realtime events (`sync-remote`, `member-join`, etc.) */
export function emitRtEvent(eventName: string) {
  emit("rt", eventName);
}
