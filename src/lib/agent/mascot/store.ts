"use client";

import { create } from "zustand";

/**
 * Imperative control surface for the 3D mascot.
 *
 * The mascot component (src/components/agent/mascot/mascot-3d.tsx) subscribes to
 * this store and drives Three.js from it; the chat layer pushes intent here
 * (talking while streaming, a mood from sentiment, a one-off reaction on a tool
 * result) without prop-drilling into the WebGL component. Ported from the
 * vanilla mascot's global state (mascot-assistant.js) into a typed store.
 */

/**
 * One-shot reactions (source runReaction). Most map to a skeletal clip;
 * `spin` + `wiggle` are procedural Y-rotations. `dance`/`confused`/`surprised`
 * are toolkit extras kept for the chat bridge.
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

/** Sentiment vector that drives expression + lighting (0..1 each). */
export interface MascotMood {
  /** negative ↔ positive */
  valence: number;
  /** calm ↔ excited */
  energy: number;
}

export const NEUTRAL_MOOD: MascotMood = { valence: 0.5, energy: 0.5 };

interface MascotState {
  /** True once the GLB has loaded and the scene is rendering. */
  ready: boolean;
  /** True while the assistant is "speaking" (streaming) — drives the jaw. */
  talking: boolean;
  /** Current sentiment-derived mood. */
  mood: MascotMood;
  /** Ambient particle speed multiplier (1 idle … ~2.5 while streaming). */
  particleSpeed: number;
  /** FIFO of one-shot reactions the render loop consumes. */
  reactionQueue: MascotReaction[];
  /** FIFO of micro-expression names (smirk/wideEyes/…) the render loop consumes. */
  microQueue: string[];
}

interface MascotActions {
  setReady(v: boolean): void;
  setTalking(v: boolean): void;
  setMood(m: MascotMood): void;
  setParticleSpeed(n: number): void;
  /** Enqueue a one-shot reaction (the render loop plays + dequeues it). */
  queueReaction(r: MascotReaction): void;
  /** Pop the next queued reaction, or undefined. Called by the render loop. */
  dequeueReaction(): MascotReaction | undefined;
  /** Enqueue a micro-expression (smirk/wideEyes/…). */
  queueMicroExpression(name: string): void;
  /** Pop the next queued micro-expression, or undefined. */
  dequeueMicroExpression(): string | undefined;
  reset(): void;
}

const INITIAL: MascotState = {
  ready: false,
  talking: false,
  mood: NEUTRAL_MOOD,
  particleSpeed: 1,
  reactionQueue: [],
  microQueue: [],
};

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
  setParticleSpeed: (n) => set({ particleSpeed: Math.max(0.25, Math.min(4, n)) }),
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
  reset: () => set({ ...INITIAL }),
}));

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
