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
 * Non-hook emit.  Safe in any event handler or imperative context.
 * Reads the current prefs synchronously from the store and no-ops if gated off.
 *
 * `targetEl` is optional and, when provided, lets the haptics engine apply its
 * per-element cooldown + iOS visual-pulse fallback to the originating element.
 */
export function emit(toolId: string, eventName: string, targetEl?: HTMLElement | null) {
  if (typeof window === "undefined") return;

  // Amr marks a few of these (an OKR achieved, a hypothesis settled), sound or not.
  announceToolMoment(toolId, eventName);

  // Forward to gamification — lazy-imported to avoid circular module dep.
  // Gamification runs even when sonification is off.
  void forwardToGamification(toolId, eventName);

  // Forward to haptics — independent gating (runs even if sonification is off).
  void forwardToHaptics(toolId, eventName, targetEl ?? undefined);

  const prefs = useSonificationStore.getState();
  if (!prefs.enabled) return;
  if (prefs.respectReducedMotion && prefersReducedMotionSync()) return;
  if (!isAllowed(prefs.mode, toolId)) return;
  const entry = getEntry(toolId, eventName);
  if (!entry) return;
  play(toolId, entry);
}

let gamificationDispatch: ((name: string, meta?: Record<string, unknown>) => void) | null = null;
async function forwardToGamification(toolId: string, eventName: string) {
  try {
    if (!gamificationDispatch) {
      const mod = await import("@/lib/gamification/engine");
      gamificationDispatch = (name, meta) => mod.dispatch({ name, meta });
    }
    const canonical =
      toolId === "ui" || toolId === "rt" ? eventName : `tool:${toolId}:${eventName}`;
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

/** Convenience for UI surface events (`click-default`, `hover`, etc.) */
export function emitUiEvent(eventName: string) {
  emit("ui", eventName);
}

/** Convenience for realtime events (`sync-remote`, `member-join`, etc.) */
export function emitRtEvent(eventName: string) {
  emit("rt", eventName);
}
