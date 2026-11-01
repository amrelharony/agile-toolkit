/**
 * Amr's poses: where each one sits on the sprite sheet, which pose answers each
 * store reaction, and which single shot the sprite should show right now. Pure,
 * so it stays free of React and the DOM; mascot-sprite.tsx renders the result.
 *
 * The sheet comes from the pack's pet_request.json: 8 columns × 11 rows of
 * 192×208 cells. Rows 9 and 10 hold 16 look directions, clockwise from up.
 */

import type { MascotReaction } from "@/lib/agent/mascot/store";

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

/** Where look pose 0–15 sits on the sheet. */
export function lookCell(index: number): { row: number; col: number } {
  return { row: LOOK_ROW + Math.floor(index / 8), col: index % 8 };
}

type ReactionDef =
  | { pose: SpritePose; loops: number }
  | { pose: "idle"; anim: "spin" | "wiggle"; seconds: number };

/** Each store reaction as a pose. Spin turns through the look rows; wiggle shakes idle. */
const REACTIONS: Record<MascotReaction, ReactionDef> = {
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

/** How long a reaction holds the stage. `speed` is the mood's playback rate. */
export function reactionSeconds(reaction: MascotReaction, speed = 1): number {
  const def = REACTIONS[reaction];
  if ("seconds" in def) return def.seconds;
  return def.loops * loopSeconds(def.pose, speed);
}

export interface ShotInput {
  drag: "left" | "right" | null;
  reaction: MascotReaction | null;
  micro: SpritePose | null;
  talking: boolean;
  look: number | null;
  reducedMotion: boolean;
  /** The mood's playback rate. */
  speed: number;
}

export interface Shot {
  /** Identifies what's on screen; a new key means a new shot. */
  key: string;
  row: number;
  col: number;
  anim: "none" | "frames" | "idle" | "spin" | "wiggle";
  frames: number;
  /** Length of one loop. */
  seconds: number;
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

/** What Amr shows now. Being dragged beats a reaction, which beats everything else. */
export function chooseShot(input: ShotInput): Shot {
  const { drag, reaction, micro, talking, look, reducedMotion, speed } = input;
  if (drag)
    return poseShot(drag === "left" ? "running-left" : "running-right", reducedMotion, speed);
  if (reaction) {
    const def = REACTIONS[reaction];
    if ("anim" in def && !reducedMotion) {
      const seconds = def.seconds;
      return { key: def.anim, row: POSES.idle.row, col: 0, anim: def.anim, frames: 1, seconds };
    }
    return poseShot(def.pose, reducedMotion, speed);
  }
  if (micro) return poseShot(micro, reducedMotion, speed);
  if (talking) return poseShot("review", reducedMotion, speed);
  if (look !== null && !reducedMotion) {
    return { key: `look-${look}`, ...lookCell(look), anim: "none", frames: 1, seconds: 0 };
  }
  return poseShot("idle", reducedMotion, speed);
}
