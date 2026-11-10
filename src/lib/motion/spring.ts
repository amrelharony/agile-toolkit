/**
 * A live spring for motion that starts from the hand's speed: a dragged board
 * card's tilt, a released reader panel. It uses settle's constants
 * (lib/motion/tokens.ts), so a fling lands like every other settle. While
 * presenting it is critically damped and stops at its target rather than pass
 * it: critical damping alone can still pass the target from a fast fling.
 *
 * stepSpring is pure and exact for any frame length, so tests drive it
 * directly. runSpring is the thin requestAnimationFrame loop around it.
 * Callers skip the spring entirely under reduced motion.
 */
import { SETTLE_SPRING, dampedSpring, type SpringConfig } from "./tokens";

export interface SpringState {
  /** Position, in the caller's units (px, degrees). */
  readonly x: number;
  /** Velocity, in those units per second. */
  readonly v: number;
}

export interface Rest {
  /** Closer than this to the target counts as there. */
  readonly delta: number;
  /** Slower than this counts as still. */
  readonly speed: number;
}

/** Suits px and degrees: a hundredth of either is invisible. */
export const DEFAULT_REST: Rest = { delta: 0.01, speed: 0.05 };

/** The same stiffness and mass with just enough damping never to swing back. */
export function criticalSpring(config: SpringConfig = SETTLE_SPRING): SpringConfig {
  return { ...config, damping: 2 * Math.sqrt(config.stiffness * config.mass) };
}

/** Settle's spring, or its critically damped twin while presenting. */
export function springFor(presenting: boolean): SpringConfig {
  return presenting ? criticalSpring(SETTLE_SPRING) : SETTLE_SPRING;
}

/**
 * Advance `state` by `dt` seconds toward `target`. With `noOvershoot`, a step
 * that would carry it past the target ends on the target, at rest.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  dt: number,
  config: SpringConfig = SETTLE_SPRING,
  noOvershoot = false
): SpringState {
  if (!(dt > 0)) return state;
  const d0 = state.x - target;
  const { d, v } = dampedSpring(config, d0, state.v, dt);
  if (noOvershoot && d0 !== 0 && d !== 0 && Math.sign(d) !== Math.sign(d0)) {
    return { x: target, v: 0 };
  }
  return { x: target + d, v };
}

export function isAtRest(state: SpringState, target: number, rest: Rest = DEFAULT_REST): boolean {
  return Math.abs(state.x - target) <= rest.delta && Math.abs(state.v) <= rest.speed;
}

export interface RunSpringOptions {
  from: number;
  to: number;
  /** Start velocity in units per second, such as the finger's at release. */
  velocity?: number;
  /** Critically damped, and never past the target. */
  presenting?: boolean;
  rest?: Rest;
  /** Called every frame, and once with the target and 0 when it comes to rest. */
  onUpdate: (x: number, v: number) => void;
  onRest?: () => void;
}

/**
 * Run the spring on requestAnimationFrame until it comes to rest. Returns a
 * cancel function; after cancel or rest no further callbacks run.
 */
export function runSpring(options: RunSpringOptions): () => void {
  const { from, to, presenting = false, rest = DEFAULT_REST, onUpdate, onRest } = options;
  const config = springFor(presenting);
  let state: SpringState = { x: from, v: options.velocity ?? 0 };
  let last = performance.now();
  let frame = 0;
  let stopped = false;

  const tick = (now: number) => {
    if (stopped) return;
    state = stepSpring(state, to, Math.max(0, now - last) / 1000, config, presenting);
    last = now;
    if (isAtRest(state, to, rest)) {
      stopped = true;
      onUpdate(to, 0);
      onRest?.();
      return;
    }
    onUpdate(state.x, state.v);
    frame = requestAnimationFrame(tick);
  };

  frame = requestAnimationFrame(tick);
  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
  };
}
