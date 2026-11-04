/**
 * Amr feels the phone (docs/mascot/AMR-ART-BRIEF.md, Appendix A): tilt it and he
 * tips that way, past 35° he windmills, level again he steadies himself; shake
 * it and he's dizzy; turn it to landscape and he looks around, surprised.
 *
 * Readings never leave the device and nothing is stored but the visitor's
 * choice (store.feelPhone). iOS only sends motion after
 * DeviceOrientationEvent.requestPermission() from a tap, so there it waits for
 * the "Let Amr feel your phone" switch; elsewhere it's on until switched off.
 * Off under reduced motion, and on devices without a touch screen.
 *
 * The maths is pure and exported for tests; installMotionSenses wires it up.
 */

import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";

const DEG = 180 / Math.PI;

/**
 * Sideways tilt of the screen in degrees, positive when its right side is down,
 * from the deviceorientation angles and the screen's rotation. Works however the
 * phone is held: it's the angle gravity makes with the screen's vertical plane.
 */
export function screenTilt(beta: number, gamma: number, screenAngle = 0): number {
  const b = beta / DEG;
  const g = gamma / DEG;
  // "Up" (against gravity) in the device's frame.
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  // Into the screen's frame.
  const a = screenAngle / DEG;
  const sx = ux * Math.cos(a) - uy * Math.sin(a);
  const sy = ux * Math.sin(a) + uy * Math.cos(a);
  return -Math.atan2(sx, Math.hypot(sy, uz)) * DEG;
}

export type TiltState = "level" | "left" | "right" | "whoa";

const TIP_DEG = 15;
const WHOA_DEG = 35;
const LEVEL_DEG = 8;
/** How fast he gets used to the way the phone is held (s). */
const SETTLE_S = 5;

/**
 * Tilt relative to how the phone is usually held: a slow average stands in for
 * "level", so holding it at an angle in bed isn't a crisis, but tipping it is.
 */
export function createTilt() {
  let base: number | null = null;
  let state: TiltState = "level";
  let lastT = 0;
  return {
    update(angle: number, t: number): TiltState {
      if (base === null) {
        base = angle;
        lastT = t;
      }
      const dt = Math.min(Math.max((t - lastT) / 1000, 0), 1);
      lastT = t;
      base += (angle - base) * (1 - Math.exp(-dt / SETTLE_S));
      const rel = angle - base;
      const mag = Math.abs(rel);
      const side: TiltState = rel < 0 ? "left" : "right";
      if (mag > WHOA_DEG) state = "whoa";
      else if (mag < LEVEL_DEG) state = "level";
      else if (state === "level" ? mag > TIP_DEG : true) state = side;
      return state;
    },
  };
}

const SPIKE = 14; // m/s², gravity left out
const GRAVITY = 9.81;
const SPIKES = 3;
const WINDOW_MS = 1000;
const SPIKE_GAP_MS = 120;

/** Three sharp jolts within a second is a shake. */
export function createShake() {
  const spikes: number[] = [];
  return {
    sample(magnitude: number, t: number): boolean {
      if (magnitude < SPIKE) return false;
      if (spikes.length && t - spikes[spikes.length - 1] < SPIKE_GAP_MS) return false;
      spikes.push(t);
      while (spikes.length && t - spikes[0] > WINDOW_MS) spikes.shift();
      if (spikes.length >= SPIKES) {
        spikes.length = 0;
        return true;
      }
      return false;
    },
  };
}

type PermissionFn = () => Promise<"granted" | "denied">;
type WithPermission = { requestPermission?: PermissionFn };

/** iOS asks before it sends motion; elsewhere it just works. */
export function motionNeedsPermission(): boolean {
  if (typeof window === "undefined") return false;
  const DOE = (window as unknown as { DeviceOrientationEvent?: WithPermission })
    .DeviceOrientationEvent;
  return typeof DOE?.requestPermission === "function";
}

/** A touch device that can report orientation at all. */
export function canFeelPhone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "DeviceOrientationEvent" in window && window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

/** Ask iOS for motion (call from a tap). True when granted. */
export async function requestMotionPermission(): Promise<boolean> {
  const w = window as unknown as {
    DeviceOrientationEvent?: WithPermission;
    DeviceMotionEvent?: WithPermission;
  };
  try {
    const asks = [w.DeviceOrientationEvent, w.DeviceMotionEvent]
      .map((E) => E?.requestPermission)
      .filter((f): f is PermissionFn => typeof f === "function");
    const answers = await Promise.all(asks.map((f) => f()));
    return answers.every((a) => a === "granted");
  } catch {
    return false;
  }
}

/** Whether he may feel the phone, given the visitor's choice (null: not made yet). */
export function feelsPhone(choice: boolean | null): boolean {
  if (choice !== null) return choice;
  return !motionNeedsPermission();
}

export interface MotionHooks {
  hold(h: MascotHold, on: boolean): void;
  act(r: MascotReaction): void;
  /** Cut in now: a shake shouldn't wait behind a queued reaction. */
  playNow(r: MascotReaction): void;
  now?: () => number;
}

export function installMotionSenses(hooks: MotionHooks): () => void {
  const now = hooks.now ?? (() => Date.now());
  const tilt = createTilt();
  const shake = createShake();
  let shown: TiltState = "level";
  let lastSteady = -Infinity;
  let lastDizzy = -Infinity;

  const show = (next: TiltState) => {
    if (next === shown) return;
    const was = shown;
    shown = next;
    hooks.hold("tipLeft", next === "left");
    hooks.hold("tipRight", next === "right");
    hooks.hold("whoa", next === "whoa");
    if (next === "level" && was !== "level" && now() - lastSteady > 4000) {
      lastSteady = now();
      hooks.act("steady");
    }
  };

  const screenAngle = () =>
    (typeof screen !== "undefined" && screen.orientation?.angle) ||
    (window as unknown as { orientation?: number }).orientation ||
    0;

  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    show(tilt.update(screenTilt(e.beta, e.gamma, screenAngle()), now()));
  };
  const onMotion = (e: DeviceMotionEvent) => {
    // Gravity left out; where a phone only reports it in, take it back off.
    let mag: number | null = null;
    const a = e.acceleration;
    if (a && a.x !== null && a.y !== null && a.z !== null) mag = Math.hypot(a.x, a.y, a.z);
    else {
      const g = e.accelerationIncludingGravity;
      if (g && g.x !== null && g.y !== null && g.z !== null) {
        mag = Math.abs(Math.hypot(g.x, g.y, g.z) - GRAVITY);
      }
    }
    if (mag === null) return;
    const t = now();
    if (shake.sample(mag, t) && t - lastDizzy > 6000) {
      lastDizzy = t;
      hooks.playNow("dizzy");
    }
  };
  let lastTurn = -Infinity;
  const onTurn = () => {
    if (now() - lastTurn < 5000) return;
    lastTurn = now();
    hooks.act("lookAround");
  };

  window.addEventListener("deviceorientation", onOrientation);
  window.addEventListener("devicemotion", onMotion);
  const so = typeof screen !== "undefined" ? screen.orientation : undefined;
  if (so?.addEventListener) so.addEventListener("change", onTurn);
  else window.addEventListener("orientationchange", onTurn);

  return () => {
    window.removeEventListener("deviceorientation", onOrientation);
    window.removeEventListener("devicemotion", onMotion);
    if (so?.removeEventListener) so.removeEventListener("change", onTurn);
    else window.removeEventListener("orientationchange", onTurn);
    hooks.hold("tipLeft", false);
    hooks.hold("tipRight", false);
    hooks.hold("whoa", false);
  };
}
