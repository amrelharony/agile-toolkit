/**
 * The cast puppets' one vocabulary of moves, as data. The idle breathe and
 * blink run as CSS in components/cast/cast-figure.module.css (a test holds the
 * two equal); life.ts plays everything else with the Web Animations API,
 * added over the idle (composite "add").
 *
 * Every clip starts and ends at rest, so a cut-short clip never leaves a part
 * turned. Code turns joints only a little (LIMITS, turnLimit), counted at the
 * peak, where the settle or pop spring carries a part past its key: a big
 * gesture is a drawn whole-arm choice, swapped in at the shoulder, never a limb
 * bent into place (docs/cast/CAST-BUILD.md, BOOK-ANATOMY-001).
 *
 * The guess reactions answer the reader's pick the way the guess itself is
 * written (lib/comics/guess.ts): there is no wrong answer, so nothing is sad
 * or mocking. Matched is glad, differed is a friendly surprise, skipped is an
 * open shrug.
 *
 * Type-only imports and no "@/" alias, so Node's type stripping can load it.
 */

import type { SocketId, SwapKey } from "./rig-types";

export const LIMITS = {
  headDeg: 10,
  lookDeg: 8,
  shoulderDeg: 15,
  hipDeg: 10,
  tailDeg: 15,
  earDeg: 12,
  leanDeg: 4,
  risePx: 12,
  maxMs: 900,
  awakePhone: 3,
  awakeWide: 6,
  guessDelayMs: 250,
  staggerMs: 80,
} as const;

/** How life paces itself (life.ts). */
export const PACE = {
  /** A figure starts no new move this soon after its last one. */
  cooldownMs: 900,
  /** This many taps on one figure within tapWindowMs, and taps are ignored for tapIgnoreMs. */
  tapBurst: 3,
  tapWindowMs: 2000,
  tapIgnoreMs: 2000,
  /** Awake only while at least this share of the figure is on screen. */
  awakeRatio: 0.6,
  /** Under this viewport width, LIMITS.awakePhone; from it, LIMITS.awakeWide. */
  narrowPx: 640,
  /** A touch is looked at for this long. */
  lookHoldMs: 1500,
  /** The body leans this far toward what it looks at. */
  lookLeanDeg: 2,
  /** A pointer this many figure heights away turns the head all the way. */
  lookReach: 2.5,
} as const;

const OTHER_DEG: Partial<Record<SocketId, number>> = {
  body: LIMITS.leanDeg,
  head: LIMITS.headDeg,
  "arm-r": LIMITS.shoulderDeg,
  "arm-l": LIMITS.shoulderDeg,
  "leg-r": LIMITS.hipDeg,
  "leg-l": LIMITS.hipDeg,
  tail: LIMITS.tailDeg,
  "ear-r": LIMITS.earDeg,
  "ear-l": LIMITS.earDeg,
  tie: 8,
  cord: 6,
  flap: 20,
};

/** The most a clip turns a socket, in degrees either way. */
export function turnLimit(socket: SocketId): number {
  if (socket.startsWith("limb-")) return 12;
  return OTHER_DEG[socket] ?? 10;
}

/** settle and pop are the springs in lib/motion/tokens.ts; calm eases out; sine is the idle loop. */
export type Ease = "settle" | "pop" | "calm" | "sine";

/**
 * One moment of a track, `t` from 0 to 1 of the clip. Values are offsets
 * from rest: degrees, px (for "pupils", a share of the rig's travel, -1 to 1)
 * and scale factors. A value left out is at rest.
 */
export interface Key {
  readonly t: number;
  readonly rotate?: number;
  readonly x?: number;
  readonly y?: number;
  readonly sx?: number;
  readonly sy?: number;
}

export interface Track {
  readonly socket: SocketId | "pupils";
  readonly keys: readonly Key[];
  readonly ease: Ease;
}

/** A choice shown from `from` to `to` (shares of the clip); the slot's rest choice comes back after. */
export interface Swap {
  readonly key: SwapKey;
  readonly from: number;
  readonly to: number;
}

export interface Layer {
  readonly tracks: readonly Track[];
  readonly swaps?: readonly Swap[];
}

export const SIG_NAMES = [
  "prop",
  "tail",
  "ears",
  "hop",
  "stomp",
  "nod",
  "wave",
  "point",
  "chin",
  "open",
  "swivel",
  "snap",
  "quills",
  "retreat",
  "fan",
  "load",
  "ripple",
  "float",
  "flap",
  "eyes",
] as const;

export type SigName = (typeof SIG_NAMES)[number];
export type GuessKind = "matched" | "differed" | "skipped";
export type ClipId = "idle.breathe" | "idle.blink" | `guess.${GuessKind}` | `sig.${SigName}`;

export interface Clip extends Layer {
  readonly id: ClipId;
  readonly ms: number;
  /** Added for the story's first speaker (guess.matched). */
  readonly first?: Layer;
  /** Added for a rig with no arm slots, whose arm swaps cannot show. */
  readonly armless?: Layer;
}

const rest = { t: 0 } as const;
const end = { t: 1 } as const;

function track(socket: Track["socket"], ease: Ease, ...keys: Key[]): Track {
  return { socket, ease, keys: [rest, ...keys, end] };
}

/** Tentacles or legs sway in turn, each a little after the one before. */
function ripple(): Track[] {
  const out: Track[] = [];
  for (let i = 0; i < 8; i++) {
    const lag = Math.round(i * 3.5) / 100;
    out.push(
      track(
        `limb-${i + 1}`,
        "settle",
        { t: 0.15 + lag, rotate: 10 },
        { t: 0.45 + lag, rotate: -10 },
        { t: 0.85 }
      )
    );
  }
  return out;
}

const both = (pose: string, from: number, to: number): Swap[] => [
  { key: `arm-r.${pose}`, from, to },
  { key: `arm-l.${pose}`, from, to },
];

export const CLIPS: Readonly<Record<ClipId, Clip>> = {
  "idle.breathe": {
    id: "idle.breathe",
    ms: 4000,
    tracks: [track("body", "sine", { t: 0.5, sy: 1.012 })],
  },
  "idle.blink": {
    id: "idle.blink",
    ms: 5400,
    tracks: [],
    swaps: [{ key: "eyes.closed", from: 0.9815, to: 1 }],
  },
  "guess.matched": {
    id: "guess.matched",
    ms: 900,
    tracks: [
      track(
        "head",
        "settle",
        { t: 0.17, rotate: 6, y: 2 },
        { t: 0.34 },
        { t: 0.51, rotate: 6, y: 2 },
        { t: 0.68 }
      ),
    ],
    swaps: [
      { key: "eyes.happy", from: 0, to: 0.85 },
      { key: "mouth.smile", from: 0, to: 0.85 },
    ],
    first: {
      tracks: [track("body", "pop", { t: 0.3, y: -10 }, { t: 0.6 })],
      swaps: both("up", 0.05, 0.8),
    },
  },
  "guess.differed": {
    id: "guess.differed",
    ms: 700,
    tracks: [track("body", "settle", { t: 0.3, rotate: -3 })],
    swaps: [
      { key: "eyes.wide", from: 0, to: 0.8 },
      { key: "mouth.o", from: 0, to: 0.8 },
    ],
  },
  "guess.skipped": {
    id: "guess.skipped",
    ms: 700,
    tracks: [track("body", "settle", { t: 0.35, sy: 1.02 })],
    swaps: both("open", 0.05, 0.85),
    armless: { tracks: [track("head", "settle", { t: 0.35, rotate: 6 })] },
  },
  "sig.prop": {
    id: "sig.prop",
    ms: 900,
    tracks: [track("arm-l", "settle", { t: 0.2, rotate: -5 }, { t: 0.75, rotate: -5 })],
    swaps: [{ key: "arm-l.sig", from: 0.1, to: 0.7667 }],
  },
  "sig.tail": {
    id: "sig.tail",
    ms: 800,
    tracks: [
      track("tail", "pop", { t: 0.2, rotate: 10 }, { t: 0.45, rotate: -10 }, { t: 0.7, rotate: 6 }),
    ],
  },
  "sig.ears": {
    id: "sig.ears",
    ms: 600,
    tracks: [
      track("ear-r", "pop", { t: 0.25, rotate: -10 }, { t: 0.5 }, { t: 0.7, rotate: -6 }),
      track("ear-l", "pop", { t: 0.25, rotate: 10 }, { t: 0.5 }, { t: 0.7, rotate: 6 }),
    ],
  },
  "sig.hop": {
    id: "sig.hop",
    ms: 600,
    tracks: [
      track("body", "pop", { t: 0.15, sy: 0.97 }, { t: 0.45, y: -10 }, { t: 0.8, sy: 0.98 }),
    ],
  },
  "sig.stomp": {
    id: "sig.stomp",
    ms: 600,
    tracks: [
      track("leg-r", "settle", { t: 0.3, rotate: -9 }, { t: 0.55 }),
      track("body", "settle", { t: 0.55, y: 2 }, { t: 0.7 }),
    ],
  },
  "sig.nod": {
    id: "sig.nod",
    ms: 700,
    tracks: [
      track(
        "head",
        "settle",
        { t: 0.25, rotate: 6, y: 2 },
        { t: 0.5 },
        { t: 0.75, rotate: 4, y: 1 }
      ),
    ],
  },
  "sig.wave": {
    id: "sig.wave",
    ms: 900,
    tracks: [
      track(
        "arm-r",
        "settle",
        { t: 0.25, rotate: -8 },
        { t: 0.45, rotate: 8 },
        { t: 0.65, rotate: -8 },
        { t: 0.85 }
      ),
    ],
    swaps: [{ key: "arm-r.wave", from: 0.05, to: 0.9 }],
  },
  "sig.point": {
    id: "sig.point",
    ms: 800,
    tracks: [track("head", "settle", { t: 0.3, rotate: -5 }, { t: 0.85, rotate: -5 })],
    swaps: [{ key: "arm-r.point", from: 0.05, to: 0.85 }],
  },
  "sig.chin": {
    id: "sig.chin",
    ms: 900,
    tracks: [track("head", "settle", { t: 0.3, rotate: 5 }, { t: 0.85, rotate: 5 })],
    swaps: [{ key: "arm-l.chin", from: 0.05, to: 0.9 }],
  },
  "sig.open": {
    id: "sig.open",
    ms: 700,
    tracks: [track("body", "settle", { t: 0.35, sy: 1.015 })],
    swaps: both("open", 0.05, 0.85),
  },
  "sig.swivel": {
    id: "sig.swivel",
    ms: 900,
    tracks: [track("head", "settle", { t: 0.25, rotate: 8 }, { t: 0.6, rotate: -8 })],
  },
  "sig.snap": {
    id: "sig.snap",
    ms: 500,
    tracks: [track("head", "pop", { t: 0.2, rotate: -8 })],
  },
  "sig.quills": {
    id: "sig.quills",
    ms: 600,
    tracks: [track("quills", "pop", { t: 0.3, sx: 1.08, sy: 1.08 })],
  },
  "sig.retreat": {
    id: "sig.retreat",
    ms: 900,
    tracks: [track("head", "settle", { t: 0.3, y: 6 }, { t: 0.75, y: 6 })],
  },
  // A fan rests open: the move folds it and spreads it again.
  "sig.fan": {
    id: "sig.fan",
    ms: 900,
    tracks: [track("body", "settle", { t: 0.2, sy: 1.01 })],
    swaps: [{ key: "fan.closed", from: 0.1, to: 0.55 }],
  },
  "sig.load": {
    id: "sig.load",
    ms: 800,
    tracks: [
      track(
        "load",
        "settle",
        { t: 0.25, rotate: 6 },
        { t: 0.55, rotate: -5 },
        { t: 0.8, rotate: 2 }
      ),
      track("head", "settle", { t: 0.3, rotate: 3 }),
    ],
  },
  "sig.ripple": {
    id: "sig.ripple",
    ms: 900,
    tracks: ripple(),
  },
  "sig.float": {
    id: "sig.float",
    ms: 900,
    tracks: [track("body", "calm", { t: 0.45, y: -8 })],
  },
  "sig.flap": {
    id: "sig.flap",
    ms: 700,
    tracks: [track("flap", "pop", { t: 0.3, rotate: -16 }, { t: 0.6, rotate: 4 })],
  },
  "sig.eyes": {
    id: "sig.eyes",
    ms: 900,
    tracks: [track("pupils", "settle", { t: 0.25, x: -0.85 }, { t: 0.6, x: 0.85 })],
  },
};

/** The clip a tap or the reader's guess plays, or null for an id that isn't one. */
export function clipFor(id: string): Clip | null {
  return Object.prototype.hasOwnProperty.call(CLIPS, id) ? CLIPS[id as ClipId] : null;
}
