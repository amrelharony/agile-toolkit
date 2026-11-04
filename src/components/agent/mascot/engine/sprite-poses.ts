/**
 * Amr's poses: where each one sits on the sprite sheet, which pose answers each
 * store reaction, and which single shot the sprite should show right now. Pure,
 * so it stays free of React and the DOM; mascot-sprite.tsx renders the result.
 *
 * The sheet comes from the pack's pet_request.json: 8 columns × 11 rows of
 * 192×208 cells. Rows 9 and 10 hold 16 look directions, clockwise from up.
 * The interactive pet's reactions and held poses play clips from the lazy packs
 * (engine/clips.ts); until a clip's pack has loaded, a pose of this sheet stands in.
 */

import type { MascotDrag, MascotHold, MascotReaction } from "@/lib/agent/mascot/store";
import { FRAMES, type PackId } from "../mascot-packs";
import {
  ACT_CLIPS,
  HOLD_CLIPS,
  LIFTED_CLIP,
  TALK_CLIP,
  clipFrames,
  clipMs,
  type Clip,
} from "./clips";
import { SCENES } from "./scenes";

export const SHEET = { columns: 8, rows: 11, cellW: 192, cellH: 208 } as const;
/** Rows of the cell Amr's figure stands in (below is empty, above is headroom). */
export const FIGURE_TOP = 25;
export const FIGURE_BOTTOM = 202;

export type SpritePose =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

interface PoseDef {
  row: number;
  frames: number;
  fps: number;
  /** The column shown when reduced motion freezes this pose. */
  still: number;
}

/** Idle plays at its own pace: long breaths and one quick blink (see the CSS). */
const IDLE_LOOP_S = 4;

export const POSES: Record<SpritePose, PoseDef> = {
  idle: { row: 0, frames: 6, fps: 6 / IDLE_LOOP_S, still: 0 },
  "running-right": { row: 1, frames: 8, fps: 12, still: 1 },
  "running-left": { row: 2, frames: 8, fps: 12, still: 1 },
  waving: { row: 3, frames: 4, fps: 6, still: 1 },
  jumping: { row: 4, frames: 5, fps: 8, still: 2 },
  failed: { row: 5, frames: 8, fps: 6, still: 3 },
  waiting: { row: 6, frames: 6, fps: 6, still: 3 },
  running: { row: 7, frames: 6, fps: 6, still: 2 },
  review: { row: 8, frames: 6, fps: 5, still: 4 },
};

/** The first of the two look rows. */
const LOOK_ROW = 9;
/** A 16th of a turn. */
const LOOK_STEP_DEG = 22.5;
/** Closer than this (px from his face) he faces the viewer, not the cursor. */
const LOOK_DEAD_ZONE = 48;

/**
 * Which look pose faces a cursor at this offset from his head (screen px, +y is
 * down), or null when the cursor is on top of him.
 */
export function lookIndex(dx: number, dy: number): number | null {
  if (Math.hypot(dx, dy) < LOOK_DEAD_ZONE) return null;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.round((deg + 360) / LOOK_STEP_DEG) % 16;
}

type Pointing =
  | "pointUp"
  | "pointUpRight"
  | "pointRight"
  | "pointDownRight"
  | "pointDownLeft"
  | "pointLeft"
  | "pointUpLeft";

/**
 * The pointing pose aimed at something this far from him (screen px, +y is
 * down). Seven directions (S03); straight down splits between the two diagonals.
 */
export function pointToward(dx: number, dy: number): Pointing {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const a = Math.abs(deg);
  const right = deg >= 0;
  if (a <= 22.5) return "pointUp";
  if (a <= 67.5) return right ? "pointUpRight" : "pointUpLeft";
  if (a <= 112.5) return right ? "pointRight" : "pointLeft";
  return right ? "pointDownRight" : "pointDownLeft";
}

/** Where look pose 0–15 sits on the sheet. */
export function lookCell(index: number): { row: number; col: number } {
  return { row: LOOK_ROW + Math.floor(index / 8), col: index % 8 };
}

type ReactionDef =
  | { pose: SpritePose; loops: number }
  | { pose: "idle"; anim: "spin" | "wiggle"; seconds: number };

type SceneReaction = `scene:${string}`;
type BaseReaction = Exclude<MascotReaction, keyof typeof ACT_CLIPS | SceneReaction>;

/** Each live-sheet reaction as a pose. Spin turns through the look rows; wiggle shakes idle. */
const REACTIONS: Record<BaseReaction, ReactionDef> = {
  wave: { pose: "waving", loops: 3 },
  excited: { pose: "jumping", loops: 3 },
  dance: { pose: "jumping", loops: 4 },
  surprised: { pose: "jumping", loops: 2 },
  confused: { pose: "failed", loops: 1 },
  headShake: { pose: "failed", loops: 1 },
  listening: { pose: "waiting", loops: 3 },
  thinking: { pose: "running", loops: 4 },
  talking: { pose: "review", loops: 2 },
  nod: { pose: "review", loops: 1 },
  spin: { pose: "idle", anim: "spin", seconds: 0.8 },
  wiggle: { pose: "idle", anim: "wiggle", seconds: 0.5 },
};

function loopSeconds(pose: SpritePose, speed: number): number {
  const { frames, fps } = POSES[pose];
  return frames / fps / speed;
}

const isScene = (r: MascotReaction): r is SceneReaction => r.startsWith("scene:");

/** Whether every frame of a clip is in the manifest: its sheets have shipped. */
export function clipShipped(c: Clip): boolean {
  return clipFrames(c).every((f) => f.startsWith("base:") || f in FRAMES);
}

/** A context scene by name, once its sheet has shipped (engine/scenes.ts). */
export function shippedScene(name: string): Clip | undefined {
  const c = SCENES[name];
  return c && clipShipped(c) ? c : undefined;
}

/**
 * The clip a reaction plays, or undefined when it plays a live-sheet row. A
 * scene whose sheet hasn't shipped has neither, and plays nothing.
 */
export function actClip(reaction: MascotReaction): Clip | undefined {
  if (isScene(reaction)) return shippedScene(reaction.slice("scene:".length));
  return ACT_CLIPS[reaction as keyof typeof ACT_CLIPS];
}

/** How long a reaction holds the stage. `speed` is the mood's playback rate. */
export function reactionSeconds(reaction: MascotReaction, speed = 1): number {
  const c = actClip(reaction);
  if (c) return clipMs(c) / 1000;
  if (isScene(reaction)) return 0;
  const def = REACTIONS[reaction as BaseReaction];
  if ("seconds" in def) return def.seconds;
  return def.loops * loopSeconds(def.pose, speed);
}

/** The packs a clip needs before it can play. */
export function clipPacks(c: Clip): PackId[] {
  if (c.driven === "talk") return ["faces", "talk"];
  const packs: PackId[] = [];
  for (const f of clipFrames(c)) {
    if (f.startsWith("base:")) continue;
    const frame = FRAMES[f as keyof typeof FRAMES];
    if (!frame) continue; // not shipped: actClip never hands such a clip out
    const pack = frame[0];
    if (!packs.includes(pack)) packs.push(pack);
  }
  return packs;
}

/**
 * Held poses, most important first. Being let go (flying, falling) and a
 * long-press beat a reaction; the rest give way to one.
 */
const HOLDS_OVER_REACTIONS: readonly MascotHold[] = ["flying", "falling", "highFive"];
const HOLDS_UNDER_REACTIONS: readonly MascotHold[] = [
  "whoa",
  "tipLeft",
  "tipRight",
  "wind",
  "peekHide",
  "watching",
  "dozing",
  "sitting",
];

export interface ShotInput {
  /** Set while he's carried. */
  drag: MascotDrag | null;
  /** Poses held right now. */
  holds?: readonly MascotHold[];
  reaction: MascotReaction | null;
  micro: SpritePose | null;
  talking: boolean;
  look: number | null;
  reducedMotion: boolean;
  /** The mood's playback rate. */
  speed: number;
  /** Which packs have loaded (none, when left out). */
  ready?: (pack: PackId) => boolean;
  /** The stroll's clip for where he's parked (engine/clips.ts STROLL_FROM_*). */
  stroll?: Clip;
}

export interface Shot {
  /** Identifies what's on screen; a new key means a new shot. */
  key: string;
  row: number;
  col: number;
  anim: "none" | "frames" | "idle" | "spin" | "wiggle" | "clip";
  frames: number;
  /** Length of one loop. */
  seconds: number;
  /** For a clip: what plays (mascot-sprite.tsx steps its frames). */
  clip?: Clip;
  /** For a clip: show its still frame, nothing moves. */
  still?: boolean;
  /** Packs this shot is waiting for (a live-sheet pose stands in meanwhile). */
  needs?: PackId[];
}

function poseShot(pose: SpritePose, reducedMotion: boolean, speed: number): Shot {
  const def = POSES[pose];
  if (reducedMotion) {
    return { key: pose, row: def.row, col: def.still, anim: "none", frames: 1, seconds: 0 };
  }
  return {
    key: `${pose}@${speed}`,
    row: def.row,
    col: 0,
    anim: pose === "idle" ? "idle" : "frames",
    frames: def.frames,
    seconds: loopSeconds(pose, speed),
  };
}

/** A clip when its packs are in, else the live-sheet pose that stands in for it. */
function clipShot(c: Clip, input: ShotInput, fallback: SpritePose = c.fallback): Shot {
  const missing = clipPacks(c).filter((p) => !input.ready?.(p));
  if (missing.length) {
    return { ...poseShot(fallback, input.reducedMotion, input.speed), needs: missing };
  }
  return {
    key: `clip:${c.name}`,
    row: 0,
    col: 0,
    anim: "clip",
    frames: 1,
    seconds: clipMs(c) / 1000,
    clip: c,
    still: input.reducedMotion,
  };
}

/**
 * What Amr shows now. Being carried or let go beats a reaction, which beats a
 * held pose, which beats talking and the cursor.
 */
export function chooseShot(input: ShotInput): Shot {
  const { drag, reaction, micro, talking, look, reducedMotion, speed } = input;
  const holds = input.holds ?? [];
  if (drag) return clipShot(LIFTED_CLIP, input, drag.vx < 0 ? "running-left" : "running-right");
  const top = HOLDS_OVER_REACTIONS.find((h) => holds.includes(h));
  if (top) return clipShot(HOLD_CLIPS[top], input);
  if (reaction && !(isScene(reaction) && !actClip(reaction))) {
    const c = reaction === "stroll" && input.stroll ? input.stroll : actClip(reaction);
    if (c) return clipShot(c, input);
    const def = REACTIONS[reaction as BaseReaction];
    if ("anim" in def && !reducedMotion) {
      const seconds = def.seconds;
      return { key: def.anim, row: POSES.idle.row, col: 0, anim: def.anim, frames: 1, seconds };
    }
    return poseShot(def.pose, reducedMotion, speed);
  }
  const held = HOLDS_UNDER_REACTIONS.find((h) => holds.includes(h));
  if (held) return clipShot(HOLD_CLIPS[held], input);
  if (micro) return poseShot(micro, reducedMotion, speed);
  if (talking) return clipShot(TALK_CLIP, input);
  if (look !== null && !reducedMotion) {
    return { key: `look-${look}`, ...lookCell(look), anim: "none", frames: 1, seconds: 0 };
  }
  return poseShot("idle", reducedMotion, speed);
}
