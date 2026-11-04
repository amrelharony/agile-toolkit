"use client";

import { create } from "zustand";

/**
 * Imperative control surface for Amr, the site's mascot.
 *
 * The sprite (src/components/agent/mascot/mascot-sprite.tsx) subscribes to this
 * store and picks its pose from it; the chat layer, the tool bridge and his
 * senses (touch, page, phone motion, idle) push intent here — talking while
 * streaming, a mood from sentiment, a one-off reaction, a pose held while
 * something lasts — without prop-drilling into the component. Ported from the
 * vanilla mascot's global state (mascot-assistant.js) into a typed store.
 */

/**
 * One-shot reactions. Each maps to a pose or a clip (engine/sprite-poses.ts,
 * engine/clips.ts). The first twelve play rows of the live sheet; the rest play
 * the lazy packs drawn for the interactive pet (docs/mascot/AMR-ART-BRIEF.md) and
 * fall back to a live-sheet pose while their pack loads. `scene:<name>` plays a
 * context scene (docs/mascot/context-sheets.json).
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
  | "surprised"
  // Touch
  | "poke"
  | "tickle"
  | "patLeft"
  | "patRight"
  | "bashful"
  | "highFive"
  | "land"
  // Faces
  | "startle"
  | "happy"
  | "concerned"
  | "lookAround"
  // Balance
  | "dizzy"
  | "steady"
  // Page moments
  | "yes"
  | "clap"
  | "downcast"
  | "shrug"
  | "thumbsUp"
  // Pointing
  | "pointLeft"
  | "pointUpLeft"
  | "pointUp"
  | "pointUpRight"
  | "pointRight"
  | "pointDownLeft"
  | "pointDownRight"
  // Social
  | "cheer"
  | "bow"
  | "peekFound"
  // Rest
  | "yawn"
  | "stretch"
  | "wake"
  | "standUp"
  // Desktop stroll along the bottom of the screen
  | "stroll"
  // A context scene (engine/scenes.ts): weather, holidays, time of day, play.
  // Plays only once its sheet's pack has shipped; until then it's skipped.
  | `scene:${string}`;

/**
 * Poses held while something lasts: being carried, a long-press, fast
 * scrolling, the phone tilted, nobody around. Several can be on at once; the
 * sprite shows the most important (engine/sprite-poses.ts HOLD_ORDER).
 */
export type MascotHold =
  | "highFive"
  | "falling"
  | "flying"
  | "whoa"
  | "tipLeft"
  | "tipRight"
  | "wind"
  | "peekHide"
  | "watching"
  | "dozing"
  | "sitting";

/** Sentiment vector that drives playback speed + the drone (0..1 each). */
export interface MascotMood {
  /** negative ↔ positive */
  valence: number;
  /** calm ↔ excited */
  energy: number;
}

export const NEUTRAL_MOOD: MascotMood = { valence: 0.5, energy: 0.5 };

/** Being carried: how fast the pointer moves him sideways (px/s) and when it last moved. */
export interface MascotDrag {
  vx: number;
  at: number;
}

interface MascotState {
  /** True once the sprite sheet has loaded and Amr is on screen. */
  ready: boolean;
  /** True while the assistant is "speaking" (streaming). */
  talking: boolean;
  /** Bumped on every streamed chunk: the rhythm his mouth follows. */
  speechPulse: number;
  /** Current sentiment-derived mood. */
  mood: MascotMood;
  /** Set while he's being dragged, null when he isn't. */
  drag: MascotDrag | null;
  /** FIFO of one-shot reactions the sprite consumes. */
  reactionQueue: MascotReaction[];
  /** Bumped to cut the reaction that's playing short (see playNow). */
  interrupt: number;
  /** Poses held right now. */
  holds: MascotHold[];
  /** FIFO of micro-expression names (smirk/wideEyes/…) the sprite consumes. */
  microQueue: string[];
  /** Aura colour (hex), or null for none. */
  auraColor: string | null;
  /**
   * Whether he may feel the phone's tilt and shakes: the visitor's choice, or
   * null before they've made one (then it's on only where the browser doesn't
   * ask for permission; see engine/interactions/sensors.ts).
   */
  feelPhone: boolean | null;
}

interface MascotActions {
  setReady(v: boolean): void;
  setTalking(v: boolean): void;
  pulseSpeech(): void;
  setMood(m: MascotMood): void;
  /** Report the drag's sideways speed, or null when it ends. */
  setDrag(vx: number | null): void;
  /** Enqueue a one-shot reaction (the sprite plays + dequeues it). */
  queueReaction(r: MascotReaction): void;
  /** Drop anything queued, cut the current reaction short, and play this one now. */
  playNow(r: MascotReaction): void;
  /** Pop the next queued reaction, or undefined. Called by the sprite. */
  dequeueReaction(): MascotReaction | undefined;
  /** Turn a held pose on or off. */
  setHold(h: MascotHold, on: boolean): void;
  /** Enqueue a micro-expression (smirk/wideEyes/…). */
  queueMicroExpression(name: string): void;
  /** Pop the next queued micro-expression, or undefined. */
  dequeueMicroExpression(): string | undefined;
  /** Set the aura colour (hex, or null for none); persisted. */
  setAuraColor(hex: string | null): void;
  /** Let him feel the phone's motion, or stop; persisted. */
  setFeelPhone(on: boolean): void;
  /** Load the persisted aura and motion choice from localStorage. */
  hydrateAppearance(): void;
  reset(): void;
}

const INITIAL: MascotState = {
  ready: false,
  talking: false,
  speechPulse: 0,
  mood: NEUTRAL_MOOD,
  drag: null,
  reactionQueue: [],
  interrupt: 0,
  holds: [],
  microQueue: [],
  auraColor: null,
  feelPhone: null,
};

const APPEARANCE_KEY = "mascot_appearance";

function saveAppearance(data: { auraColor: string | null; feelPhone: boolean | null }): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Stop the queue from backing up behind a burst of events. */
const MAX_QUEUE = 4;

export const useMascotStore = create<MascotState & MascotActions>()((set, get) => ({
  ...INITIAL,

  setReady: (v) => set({ ready: v }),
  setTalking: (v) => set({ talking: v }),
  pulseSpeech: () => set((s) => ({ speechPulse: s.speechPulse + 1 })),
  setMood: (mood) =>
    set({
      mood: {
        valence: clamp01(mood.valence),
        energy: clamp01(mood.energy),
      },
    }),
  setDrag: (vx) =>
    set({ drag: vx === null ? null : { vx: Number.isFinite(vx) ? vx : 0, at: Date.now() } }),
  queueReaction: (r) => set((s) => ({ reactionQueue: [...s.reactionQueue, r].slice(-MAX_QUEUE) })),
  playNow: (r) => set((s) => ({ reactionQueue: [r], interrupt: s.interrupt + 1 })),
  dequeueReaction: () => {
    const [next, ...rest] = get().reactionQueue;
    if (next === undefined) return undefined;
    set({ reactionQueue: rest });
    return next;
  },
  setHold: (h, on) =>
    set((s) => {
      const has = s.holds.includes(h);
      if (has === on) return s;
      return { holds: on ? [...s.holds, h] : s.holds.filter((x) => x !== h) };
    }),
  queueMicroExpression: (name) => set((s) => ({ microQueue: [...s.microQueue, name] })),
  dequeueMicroExpression: () => {
    const [next, ...rest] = get().microQueue;
    if (next === undefined) return undefined;
    set({ microQueue: rest });
    return next;
  },
  setAuraColor: (hex) => {
    set({ auraColor: hex });
    saveAppearance({ auraColor: hex, feelPhone: get().feelPhone });
  },
  setFeelPhone: (on) => {
    set({ feelPhone: on });
    saveAppearance({ auraColor: get().auraColor, feelPhone: on });
  },
  hydrateAppearance: () => {
    try {
      const raw = localStorage.getItem(APPEARANCE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { auraColor?: string | null; feelPhone?: boolean | null };
      set({
        auraColor: data.auraColor ?? null,
        feelPhone: typeof data.feelPhone === "boolean" ? data.feelPhone : null,
      });
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
