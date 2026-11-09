/**
 * Amr's inner state: a few slow drives that what happens to him pushes around,
 * and the temperament they add up to. Before this he had none: every poke got
 * the same giggle and nothing built up. Now a visitor who plays with him finds
 * him playful, one who pats him finds him fond, one who keeps prodding finds him
 * fed up for a minute, and late at night he's sleepy.
 *
 * The temperament only ever colours what he already does: which of a reaction's
 * variants he picks (choose.ts), how soon he tires (idle.ts), how often he does
 * something unprompted (director.ts), and the mood the sprite plays at
 * (store.mood). Nothing here is stored or sent; lib/agent/mascot/memory.ts
 * remembers the little that outlives a visit.
 *
 * Pure apart from the clock, which is injected.
 */

import type { MascotMood } from "@/lib/agent/mascot/store";

/** What can happen to him. */
export type BrainEvent =
  | "poke"
  | "pat"
  | "tickle"
  | "highFive"
  | "carried"
  | "thrown"
  | "shaken"
  | "startled"
  | "played" // a game or a scene of his own
  | "thanked"
  | "chatted"
  | "finished" // the visitor finished something in a tool
  | "greeted";

export type Temperament = "sleepy" | "calm" | "playful" | "affectionate" | "shy" | "grumpy";

/** Each 0..1. */
export interface Drives {
  /** Rested (1) or worn out (0). */
  energy: number;
  /** How fond of this visitor he is right now. */
  affection: number;
  /** How much he feels like playing. */
  playfulness: number;
  /** A jolt: high just after a shake, a throw or a fright. */
  arousal: number;
  /** How fed up he is with being prodded. */
  annoyance: number;
}

/** What each event does to him: added to the drive, which stays within 0..1. */
const EFFECTS: Record<BrainEvent, Partial<Drives>> = {
  poke: { playfulness: 0.06, annoyance: 0.12, arousal: 0.1 },
  pat: { affection: 0.14, annoyance: -0.1 },
  tickle: { playfulness: 0.16, annoyance: 0.08, arousal: 0.2 },
  highFive: { affection: 0.16, playfulness: 0.1, annoyance: -0.2 },
  carried: { arousal: 0.2, playfulness: 0.05 },
  thrown: { arousal: 0.5, playfulness: 0.12, annoyance: 0.1 },
  shaken: { arousal: 0.6, annoyance: 0.22, energy: -0.05 },
  startled: { arousal: 0.35 },
  played: { playfulness: 0.08, energy: -0.03 },
  thanked: { affection: 0.22, annoyance: -0.3 },
  chatted: { affection: 0.05 },
  finished: { affection: 0.04, playfulness: 0.05 },
  greeted: { affection: 0.08 },
};

/** Where each drive rests, and how long it takes to get about two thirds of the way back (s). */
const REST: Record<keyof Drives, { at: number; s: number }> = {
  energy: { at: 0.7, s: 600 },
  affection: { at: 0.4, s: 420 },
  playfulness: { at: 0.35, s: 240 },
  arousal: { at: 0, s: 12 },
  annoyance: { at: 0, s: 45 },
};

export const START: Drives = {
  energy: 0.7,
  affection: 0.4,
  playfulness: 0.35,
  arousal: 0,
  annoyance: 0,
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Late at night he runs low; mid-morning he's at his best. */
export function energyAt(hour: number): number {
  if (hour >= 23 || hour < 5) return 0.25;
  if (hour < 7) return 0.45;
  if (hour < 12) return 0.8;
  if (hour < 15) return 0.65; // after lunch
  if (hour < 20) return 0.7;
  return 0.5;
}

/** The temperament a set of drives adds up to. The strongest feeling wins. */
export function temperamentOf(d: Drives): Temperament {
  if (d.annoyance >= 0.6) return "grumpy";
  if (d.energy <= 0.32) return "sleepy";
  if (d.playfulness >= 0.6 && d.playfulness >= d.affection) return "playful";
  if (d.affection >= 0.62) return "affectionate";
  if (d.arousal >= 0.55 && d.affection < 0.45) return "shy";
  return "calm";
}

/**
 * The mood the sprite plays at (its speed and the drone): valence and energy,
 * 0..1 each. The hour alone doesn't move it out of neutral: a sleepy Amr tires
 * sooner (idle.ts), he doesn't go into slow motion every night.
 */
export function moodOf(d: Drives): MascotMood {
  return {
    valence: clamp01(
      0.5 + 0.45 * (d.affection - 0.4) + 0.25 * (d.playfulness - 0.35) - 0.5 * d.annoyance
    ),
    energy: clamp01(
      0.5 + 0.25 * (d.energy - 0.7) + 0.35 * (d.playfulness - 0.35) + 0.4 * d.arousal
    ),
  };
}

/** The shared gap between unprompted reactions (director.ts), by temperament (ms). */
export const GAP_MS: Record<Temperament, number> = {
  playful: 12_000,
  affectionate: 16_000,
  calm: 20_000,
  shy: 26_000,
  sleepy: 30_000,
  grumpy: 30_000,
};
/** While the visitor is typing or reading he keeps to himself. */
export const BUSY_GAP_MS = 60_000;

/** How soon he tires (idle.ts), by temperament: under 1 is sooner. */
export const PACE: Record<Temperament, number> = {
  sleepy: 0.7,
  grumpy: 0.9,
  calm: 1,
  shy: 1,
  affectionate: 1.1,
  playful: 1.3,
};

export interface BrainOptions {
  now?: () => number;
  hour?: () => number;
  /** Where to start from (a returning visitor starts a little fonder). */
  start?: Partial<Drives>;
}

export interface Brain {
  /** Something happened to him. */
  note(event: BrainEvent): void;
  /** Let time pass; call about once a second. */
  tick(): void;
  drives(): Drives;
  temperament(): Temperament;
  mood(): MascotMood;
  /** The gap he leaves between unprompted reactions now. */
  gapMs(busy: boolean): number;
  /** How soon he tires now. */
  pace(): number;
}

export function createBrain(opts: BrainOptions = {}): Brain {
  const now = opts.now ?? (() => Date.now());
  const hour = opts.hour ?? (() => new Date().getHours());
  const d: Drives = { ...START, energy: energyAt(hour()), ...opts.start };
  let last = now();

  const tick = () => {
    const t = now();
    const dt = Math.min(Math.max((t - last) / 1000, 0), 120);
    last = t;
    if (dt === 0) return;
    const rest: Record<keyof Drives, number> = {
      energy: energyAt(hour()),
      affection: REST.affection.at,
      playfulness: REST.playfulness.at,
      arousal: REST.arousal.at,
      annoyance: REST.annoyance.at,
    };
    for (const key of Object.keys(REST) as (keyof Drives)[]) {
      d[key] += (rest[key] - d[key]) * (1 - Math.exp(-dt / REST[key].s));
    }
  };

  return {
    note(event) {
      tick();
      const effect = EFFECTS[event];
      for (const key of Object.keys(effect) as (keyof Drives)[]) {
        d[key] = clamp01(d[key] + (effect[key] ?? 0));
      }
    },
    tick,
    drives: () => ({ ...d }),
    temperament: () => temperamentOf(d),
    mood: () => moodOf(d),
    gapMs: (busy) => (busy ? BUSY_GAP_MS : GAP_MS[temperamentOf(d)]),
    pace: () => PACE[temperamentOf(d)],
  };
}
