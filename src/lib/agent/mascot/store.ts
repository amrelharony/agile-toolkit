"use client";

import { create } from "zustand";

/**
 * Imperative control surface for Amr, the site's mascot.
 *
 * The sprite (src/components/agent/mascot/mascot-sprite.tsx) subscribes to this
 * store and picks its pose from it; the chat layer and the tool bridge push
 * intent here (talking while streaming, a mood from sentiment, a one-off reaction
 * on a finished action) without prop-drilling into the component. Ported from the
 * vanilla mascot's global state (mascot-assistant.js) into a typed store.
 */

/**
 * One-shot reactions (source runReaction). Each maps to a pose
 * (engine/sprite-poses.ts). `dance`/`confused`/`surprised` are toolkit extras kept
 * for the chat bridge.
 */
export type MascotReaction =
  | "thinking"
  | "listening"
  | "talking"
  | "excited"
  | "nod"
  | "headShake"
  | "wave"
  | "spin"
  | "wiggle"
  | "dance"
  | "confused"
  | "surprised";

/** Sentiment vector that drives playback speed + the drone (0..1 each). */
export interface MascotMood {
  /** negative ↔ positive */
  valence: number;
  /** calm ↔ excited */
  energy: number;
}

export const NEUTRAL_MOOD: MascotMood = { valence: 0.5, energy: 0.5 };

interface MascotState {
  /** True once the sprite sheet has loaded and Amr is on screen. */
  ready: boolean;
  /** True while the assistant is "speaking" (streaming). */
  talking: boolean;
  /** Current sentiment-derived mood. */
  mood: MascotMood;
  /** Which way the figure is being dragged, or null when it isn't. */
  dragDirection: "left" | "right" | null;
  /** FIFO of one-shot reactions the sprite consumes. */
  reactionQueue: MascotReaction[];
  /** FIFO of micro-expression names (smirk/wideEyes/…) the sprite consumes. */
  microQueue: string[];
  /** Aura colour (hex), or null for none. */
  auraColor: string | null;
}

interface MascotActions {
  setReady(v: boolean): void;
  setTalking(v: boolean): void;
  setMood(m: MascotMood): void;
  setDragDirection(d: "left" | "right" | null): void;
  /** Enqueue a one-shot reaction (the sprite plays + dequeues it). */
  queueReaction(r: MascotReaction): void;
  /** Pop the next queued reaction, or undefined. Called by the sprite. */
  dequeueReaction(): MascotReaction | undefined;
  /** Enqueue a micro-expression (smirk/wideEyes/…). */
  queueMicroExpression(name: string): void;
  /** Pop the next queued micro-expression, or undefined. */
  dequeueMicroExpression(): string | undefined;
  /** Set the aura colour (hex, or null for none); persisted. */
  setAuraColor(hex: string | null): void;
  /** Load the persisted aura from localStorage. */
  hydrateAppearance(): void;
  reset(): void;
}

const INITIAL: MascotState = {
  ready: false,
  talking: false,
  mood: NEUTRAL_MOOD,
  dragDirection: null,
  reactionQueue: [],
  microQueue: [],
  auraColor: null,
};

const APPEARANCE_KEY = "mascot_appearance";

function saveAppearance(auraColor: string | null): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ auraColor }));
  } catch {
    /* storage unavailable — ignore */
  }
}

export const useMascotStore = create<MascotState & MascotActions>()((set, get) => ({
  ...INITIAL,

  setReady: (v) => set({ ready: v }),
  setTalking: (v) => set({ talking: v }),
  setMood: (mood) =>
    set({
      mood: {
        valence: clamp01(mood.valence),
        energy: clamp01(mood.energy),
      },
    }),
  setDragDirection: (d) => set({ dragDirection: d }),
  queueReaction: (r) => set((s) => ({ reactionQueue: [...s.reactionQueue, r] })),
  dequeueReaction: () => {
    const [next, ...rest] = get().reactionQueue;
    if (next === undefined) return undefined;
    set({ reactionQueue: rest });
    return next;
  },
  queueMicroExpression: (name) => set((s) => ({ microQueue: [...s.microQueue, name] })),
  dequeueMicroExpression: () => {
    const [next, ...rest] = get().microQueue;
    if (next === undefined) return undefined;
    set({ microQueue: rest });
    return next;
  },
  setAuraColor: (hex) => {
    set({ auraColor: hex });
    saveAppearance(hex);
  },
  hydrateAppearance: () => {
    try {
      const raw = localStorage.getItem(APPEARANCE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { auraColor?: string | null };
      set({ auraColor: data.auraColor ?? null });
    } catch {
      /* ignore */
    }
  },
  reset: () => set({ ...INITIAL }),
}));

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
