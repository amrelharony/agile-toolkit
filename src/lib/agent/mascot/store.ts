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
  | "sitting"
  // A companion scene held while something real lasts (engine/scenes.ts
  // HOLD_SCENES): its way in once, then its waiting frames until it's let go.
  | `scene:${string}`;

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

/** The corner Amr is parked in (he can be dragged to any of the four). */
export type MascotCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/**
 * Where his figure is drawn once the page has been laid out: the side of the
 * screen and the edge he stands against. Usually his corner's, but the other
 * side when he has stepped aside for one of the page's controls.
 */
export interface MascotPlacement {
  side: "left" | "right";
  edge: "top" | "bottom";
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
  /** What the last playNow played: a tap's reaction, or his own waking up. */
  playedNow: MascotReaction | null;
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
  /** He has offered to feel the phone once (the bubble beside him); he doesn't ask twice. */
  motionAsked: boolean;
  /**
   * The corner he was put in (by a drop, Move Amr or an arrow key). Things
   * shown beside him follow `placed` and `lift` instead, where he is drawn.
   */
  corner: MascotCorner;
  /**
   * Where he is actually drawn (see MascotPlacement). `corner` stays the corner
   * he was put in; things beside him (his bubble, the moment chip) follow this.
   */
  placed: MascotPlacement;
  /** How far (px) he has stepped up off his edge: his bubble and chips rise this much with him. */
  lift: number;
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
  /** Note that he has offered to feel the phone; persisted. */
  setMotionAsked(): void;
  /** Report the corner he's parked in (the assistant calls it). */
  setCorner(c: MascotCorner): void;
  /**
   * Report where he is drawn and how far he has stepped off his edge (the
   * assistant calls it whenever it places him and his panel). A lift that
   * isn't a positive number counts as 0. Unchanged values change nothing.
   */
  setPlacement(placed: MascotPlacement, lift: number): void;
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
  playedNow: null,
  holds: [],
  microQueue: [],
  auraColor: null,
  feelPhone: null,
  motionAsked: false,
  corner: "bottomRight",
  placed: { side: "right", edge: "bottom" },
  lift: 0,
};

const APPEARANCE_KEY = "mascot_appearance";

interface Appearance {
  auraColor: string | null;
  feelPhone: boolean | null;
  motionAsked: boolean;
}

function saveAppearance(data: Appearance): void {
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
  playNow: (r) => set((s) => ({ reactionQueue: [r], interrupt: s.interrupt + 1, playedNow: r })),
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
    saveAppearance(appearance(get()));
  },
  setFeelPhone: (on) => {
    set({ feelPhone: on });
    saveAppearance(appearance(get()));
  },
  setMotionAsked: () => {
    if (get().motionAsked) return;
    set({ motionAsked: true });
    saveAppearance(appearance(get()));
  },
  setCorner: (corner) => set((s) => (s.corner === corner ? s : { corner })),
  setPlacement: ({ side, edge }, lift) =>
    set((s) => {
      const up = Number.isFinite(lift) && lift > 0 ? lift : 0;
      if (s.placed.side === side && s.placed.edge === edge && s.lift === up) return s;
      return { placed: { side, edge }, lift: up };
    }),
  hydrateAppearance: () => {
    try {
      const raw = localStorage.getItem(APPEARANCE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<Appearance>;
      set({
        auraColor: data.auraColor ?? null,
        feelPhone: typeof data.feelPhone === "boolean" ? data.feelPhone : null,
        motionAsked: data.motionAsked === true,
      });
    } catch {
      /* ignore */
    }
  },
  reset: () => set({ ...INITIAL }),
}));

function appearance(s: MascotState): Appearance {
  return { auraColor: s.auraColor, feelPhone: s.feelPhone, motionAsked: s.motionAsked };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
