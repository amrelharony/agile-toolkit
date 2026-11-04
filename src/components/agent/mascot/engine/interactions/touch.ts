/**
 * Touching Amr without tapping (docs/mascot/AMR-ART-BRIEF.md, S04 and S09):
 *
 *   • a long-press (500 ms, barely moving) offers a high five, given on release;
 *   • a mouse resting on him for 1.2 s makes him bashful (fine pointers only);
 *   • a mouse stroking sideways across his head pats it, toward the stroke.
 *
 * Taps are clicks.ts, dragging is the host's. Pure apart from timers; the host
 * feeds it pointer positions within his figure's box.
 */

import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";
import type { Zone } from "./clicks";

export interface TouchHooks {
  playNow(r: MascotReaction): void;
  hold(h: MascotHold, on: boolean): void;
  sound(): void;
  now?: () => number;
}

export interface TouchPoint {
  x: number;
  y: number;
  /** His figure's box on screen. */
  box: { left: number; top: number; width: number; height: number };
  pointerType: string;
}

export const LONG_PRESS_MS = 500;
const PRESS_SLOP = 8;
export const DWELL_MS = 1200;
const DWELL_SLOP = 6;
const BASHFUL_COOLDOWN_MS = 20_000;
const STROKE_MS = 500;
/** A stroke covers this much of his head's width. */
const STROKE_SPAN = 0.55;
const PAT_COOLDOWN_MS = 1500;
/** The head is the top third of his figure's box. */
const HEAD_SHARE = 0.34;

/** Which part of him a point is on. */
export function zoneAt(p: Pick<TouchPoint, "y" | "box">): Zone {
  return p.y - p.box.top < p.box.height * HEAD_SHARE ? "head" : "body";
}

export interface TouchInteraction {
  down(p: TouchPoint): void;
  /** The pointer moved over him, pressed or not. */
  move(p: TouchPoint, pressed: boolean): void;
  leave(): void;
  /** Released. True when that was a long-press: swallow the click that follows. */
  up(): boolean;
  /** The press became a drag. */
  dragStart(): void;
  dispose(): void;
}

export function createTouchInteraction(hooks: TouchHooks): TouchInteraction {
  const now = hooks.now ?? (() => Date.now());

  let pressAt: { x: number; y: number } | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let offering = false;

  let dwellAt: { x: number; y: number } | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | undefined;
  let dwelled = false;
  let lastBashful = -Infinity;

  let stroke: { x: number; t: number }[] = [];
  let lastPat = -Infinity;

  const stopPress = () => {
    clearTimeout(pressTimer);
    pressTimer = undefined;
    pressAt = null;
  };
  const stopOffer = () => {
    if (!offering) return;
    offering = false;
    hooks.hold("highFive", false);
  };
  const stopDwell = () => {
    clearTimeout(dwellTimer);
    dwellTimer = undefined;
    dwellAt = null;
  };

  function down(p: TouchPoint): void {
    stopDwell();
    stopPress();
    pressAt = { x: p.x, y: p.y };
    pressTimer = setTimeout(() => {
      pressTimer = undefined;
      if (!pressAt) return;
      offering = true;
      hooks.hold("highFive", true);
      hooks.sound();
    }, LONG_PRESS_MS);
  }

  function hover(p: TouchPoint): void {
    if (p.pointerType !== "mouse") return;
    // Resting on him.
    if (!dwellAt || Math.hypot(p.x - dwellAt.x, p.y - dwellAt.y) > DWELL_SLOP) {
      clearTimeout(dwellTimer);
      dwellAt = { x: p.x, y: p.y };
      if (!dwelled) {
        dwellTimer = setTimeout(() => {
          dwellTimer = undefined;
          if (now() - lastBashful < BASHFUL_COOLDOWN_MS) return;
          dwelled = true;
          lastBashful = now();
          hooks.playNow("bashful");
        }, DWELL_MS);
      }
    }
    // Stroking across his head.
    if (zoneAt(p) !== "head") {
      stroke = [];
      return;
    }
    const t = now();
    stroke.push({ x: p.x, t });
    stroke = stroke.filter((s) => t - s.t <= STROKE_MS);
    const dx = stroke[stroke.length - 1].x - stroke[0].x;
    const monotone = stroke.every(
      (s, i) => i === 0 || Math.sign(s.x - stroke[i - 1].x) !== -Math.sign(dx)
    );
    if (monotone && Math.abs(dx) > p.box.width * STROKE_SPAN && t - lastPat > PAT_COOLDOWN_MS) {
      lastPat = t;
      stroke = [];
      hooks.playNow(dx < 0 ? "patLeft" : "patRight");
    }
  }

  function move(p: TouchPoint, pressed: boolean): void {
    if (pressed) {
      if (pressAt && Math.hypot(p.x - pressAt.x, p.y - pressAt.y) > PRESS_SLOP) stopPress();
      return;
    }
    hover(p);
  }

  function leave(): void {
    stopDwell();
    dwelled = false;
    stroke = [];
  }

  function up(): boolean {
    stopPress();
    if (!offering) return false;
    stopOffer();
    hooks.playNow("highFive");
    return true;
  }

  function dragStart(): void {
    stopPress();
    stopOffer();
    stopDwell();
  }

  function dispose(): void {
    stopPress();
    stopOffer();
    stopDwell();
  }

  return { down, move, leave, up, dragStart, dispose };
}
