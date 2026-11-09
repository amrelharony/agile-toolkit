/**
 * Amr feels the phone (docs/mascot/AMR-ART-BRIEF.md, Appendix A).
 *
 * All the time, gently: he leans against a tilt to stay upright, skids a little
 * toward the low side, looks where the phone tips, and the rain around him falls
 * the way gravity points. The sprite reads the phone's pose from one small
 * object (MotionFrame) in its own tick, so a reading never touches the store.
 *
 * And at moments: tilt it far and he tips that way, past 35° he windmills, level
 * again he steadies himself; shake it and he's dizzy; turn it to landscape and he
 * looks around; lay it face down and he's glad to see you when it comes back;
 * toss it and he flails, then lands; turn it upside down and he hangs on; twist
 * it like a wheel and he spins; knock it and he jumps; leave it flat on the table
 * and he dozes sooner, till it's picked up.
 *
 * Readings never leave the device and nothing is stored but the visitor's
 * choice (store.feelPhone). iOS only sends motion after
 * DeviceOrientationEvent.requestPermission() from a tap, so there it waits for
 * the visitor's yes (the bubble beside him, or the panel's switch); elsewhere
 * it's on until switched off. Off under reduced motion, and on devices without a
 * touch screen.
 *
 * The maths is pure and exported for tests; installMotionSenses wires it up.
 */

import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";

const DEG = 180 / Math.PI;

/**
 * "Up" (against gravity) in the screen's own frame, from the deviceorientation
 * angles and the screen's rotation: x across the screen (to its right), y up it,
 * z out of it toward the viewer. A unit vector.
 */
export function screenUp(
  beta: number,
  gamma: number,
  screenAngle = 0
): { x: number; y: number; z: number } {
  const b = beta / DEG;
  const g = gamma / DEG;
  // In the device's frame.
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  // Into the screen's frame.
  const a = screenAngle / DEG;
  return {
    x: ux * Math.cos(a) - uy * Math.sin(a),
    y: ux * Math.sin(a) + uy * Math.cos(a),
    z: uz,
  };
}

/**
 * Sideways tilt of the screen in degrees, positive when its right side is down,
 * from the deviceorientation angles and the screen's rotation. Works however the
 * phone is held: it's the angle gravity makes with the screen's vertical plane.
 */
export function screenTilt(beta: number, gamma: number, screenAngle = 0): number {
  const up = screenUp(beta, gamma, screenAngle);
  return -Math.atan2(up.x, Math.hypot(up.y, up.z)) * DEG;
}

/**
 * How far the screen leans back, in degrees: 0 held upright, 90 flat on a table
 * facing up, past 90 tipping over backwards, negative facing the floor.
 */
export function screenPitch(beta: number, gamma: number, screenAngle = 0): number {
  const up = screenUp(beta, gamma, screenAngle);
  return Math.atan2(up.z, up.y) * DEG;
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

/** The phone's pose as the sprite reads it, tick by tick. */
export interface MotionFrame {
  /** Readings are arriving. */
  live: boolean;
  /** Sideways tilt against how the phone is usually held (degrees, right side down is +). */
  roll: number;
  /** Leaning back further than usual (+) or brought more upright (−), degrees. */
  pitch: number;
  /** When the last reading came (the sensors' clock, ms). */
  at: number;
}

export function restingFrame(): MotionFrame {
  return { live: false, roll: 0, pitch: 0, at: 0 };
}

/** The pose is smoothed over about this long, so a shaky hand isn't a shaky Amr (s). */
const SMOOTH_S = 0.09;

/**
 * Roll and pitch against how the phone is usually held, smoothed. Like
 * createTilt, a slow average is "level": he looks where the phone *tips*, not
 * where it happens to rest.
 */
export function createPose() {
  let base: { roll: number; pitch: number } | null = null;
  let roll = 0;
  let pitch = 0;
  let lastT = 0;
  return {
    update(rollNow: number, pitchNow: number, t: number): { roll: number; pitch: number } {
      if (base === null) {
        base = { roll: rollNow, pitch: pitchNow };
        lastT = t;
      }
      const dt = Math.min(Math.max((t - lastT) / 1000, 0), 1);
      lastT = t;
      const settle = 1 - Math.exp(-dt / SETTLE_S);
      base.roll += (rollNow - base.roll) * settle;
      base.pitch += (pitchNow - base.pitch) * settle;
      const smooth = 1 - Math.exp(-dt / SMOOTH_S);
      roll += (rollNow - base.roll - roll) * smooth;
      pitch += (pitchNow - base.pitch - pitch) * smooth;
      return { roll, pitch };
    },
  };
}

/** He leans back by this share of the tilt, up to LEAN_MAX degrees. */
const LEAN_GAIN = 0.5;
export const LEAN_MAX = 10;

/**
 * How far he leans to stay upright as the ground tips, in degrees clockwise on
 * screen: against the tilt, part of the way.
 */
export function leanFor(roll: number): number {
  return Math.max(-LEAN_MAX, Math.min(LEAN_MAX, -roll * LEAN_GAIN)) + 0;
}

/** He starts to skid at this tilt, and has slid all he will at SKID_FULL (degrees). */
const SKID_FROM = 8;
const SKID_FULL = 30;
/** The furthest he skids, as a share of his box's width. */
export const SKID_MAX = 0.3;

/** How far he skids toward the low side, as a share of his box's width (right is +). */
export function skidFor(roll: number): number {
  const mag = Math.abs(roll);
  if (mag <= SKID_FROM) return 0;
  return Math.sign(roll) * Math.min(1, (mag - SKID_FROM) / (SKID_FULL - SKID_FROM)) * SKID_MAX;
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

/** A knock: one jolt this hard (m/s², gravity left out)... */
const BUMP = 18;
/** ...with nothing after it for this long (a second jolt makes it a shake). */
const BUMP_QUIET_MS = 450;

/** One hard knock that stands alone: the phone set down with a bang, a tap on its back. */
export function createBump() {
  let at: number | null = null;
  let spoiled = false;
  return {
    /** Feed every reading. True once, a moment after a knock that nothing followed. */
    sample(magnitude: number, t: number): boolean {
      if (magnitude >= BUMP) {
        if (at === null) {
          at = t;
          spoiled = false;
        } else if (t - at > SPIKE_GAP_MS) {
          spoiled = true;
        }
      }
      if (at !== null && t - at >= BUMP_QUIET_MS) {
        const alone = !spoiled;
        at = null;
        return alone;
      }
      return false;
    },
  };
}

/** In free fall the phone feels almost no gravity (m/s²)... */
const FALL_G = 3;
/** ...for at least this long: a toss, not a wobble. */
const FALL_MS = 120;
/** Caught, or landed: gravity is back. */
const LAND_G = 7;
/** A fall with no landing reading ends on its own. */
const FALL_MAX_MS = 2000;

/** The phone tossed and caught, from the acceleration that includes gravity. */
export function createFreeFall() {
  let since: number | null = null;
  let falling = false;
  return {
    sample(gravityMagnitude: number, t: number): "fall" | "land" | null {
      if (falling) {
        if (gravityMagnitude > LAND_G || (since !== null && t - since > FALL_MAX_MS)) {
          falling = false;
          since = null;
          return "land";
        }
        return null;
      }
      if (gravityMagnitude >= FALL_G) {
        since = null;
        return null;
      }
      if (since === null) since = t;
      if (t - since < FALL_MS) return null;
      falling = true;
      return "fall";
    },
  };
}

/** Turned like a steering wheel this fast (degrees a second)... */
const TWIST_RATE = 300;
/** ...for this long, one way. */
const TWIST_MS = 150;
const TWIST_OVER = 120;

/** A quick turn of the wrist, from the rotation rate about the screen's normal. */
export function createTwist() {
  let since: number | null = null;
  let way = 0;
  let fired = false;
  return {
    sample(rate: number, t: number): boolean {
      const mag = Math.abs(rate);
      if (mag < TWIST_OVER) {
        since = null;
        fired = false;
        return false;
      }
      if (mag < TWIST_RATE) return false;
      const dir = Math.sign(rate);
      if (since === null || dir !== way) {
        since = t;
        way = dir;
        return false;
      }
      if (fired || t - since < TWIST_MS) return false;
      fired = true;
      return true;
    },
  };
}

/**
 * Something that's so once it has held for `ms`, and over as soon as `leave`
 * says: the phone face down, or upside down. Returns "in" and "out" as it flips.
 */
export function createLatch(
  enter: (v: number) => boolean,
  leave: (v: number) => boolean,
  ms: number
) {
  let since: number | null = null;
  let on = false;
  return {
    update(v: number, t: number): "in" | "out" | null {
      if (on) {
        if (!leave(v)) return null;
        on = false;
        since = null;
        return "out";
      }
      if (!enter(v)) {
        since = null;
        return null;
      }
      if (since === null) since = t;
      if (t - since < ms) return null;
      on = true;
      return "in";
    },
    isOn: () => on,
  };
}

/** Flat on its back within about 23° of level... */
const FLAT_Z = 0.92;
/** ...and not moved by more than this (degrees)... */
const STILL_DEG = 3;
/** ...for this long: it's been put down. */
export const REST_MS = 12_000;
/** Moved this much (degrees), or no longer flat: it's been picked up. */
const PICKUP_DEG = 6;

/** The phone laid flat and left alone, then picked up again. */
export function createRest() {
  let ref: { roll: number; pitch: number; t: number } | null = null;
  let resting = false;
  return {
    update(roll: number, pitch: number, z: number, t: number): "rest" | "pickup" | null {
      const flat = z > FLAT_Z;
      if (resting) {
        const moved =
          !ref ||
          Math.abs(roll - ref.roll) > PICKUP_DEG ||
          Math.abs(pitch - ref.pitch) > PICKUP_DEG;
        if (flat && !moved) return null;
        resting = false;
        ref = null;
        return "pickup";
      }
      if (!flat) {
        ref = null;
        return null;
      }
      if (
        !ref ||
        Math.abs(roll - ref.roll) > STILL_DEG ||
        Math.abs(pitch - ref.pitch) > STILL_DEG
      ) {
        ref = { roll, pitch, t };
        return null;
      }
      if (t - ref.t < REST_MS) return null;
      resting = true;
      return "rest";
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
  /** The phone's pose, kept current for whoever draws him. */
  frame?: MotionFrame;
  /** The phone was laid flat and left alone (true), or picked up again (false). */
  rest?(resting: boolean): void;
  now?: () => number;
}

export function installMotionSenses(hooks: MotionHooks): () => void {
  const now = hooks.now ?? (() => Date.now());
  const tilt = createTilt();
  const pose = createPose();
  const shake = createShake();
  const bump = createBump();
  const fall = createFreeFall();
  const twist = createTwist();
  const rest = createRest();
  const faceDown = createLatch(
    (z) => z < -0.75,
    (z) => z > -0.3,
    500
  );
  const upsideDown = createLatch(
    (y) => y < -0.75,
    (y) => y > -0.3,
    400
  );
  let shown: TiltState = "level";
  let lastSteady = -Infinity;
  let lastDizzy = -Infinity;
  let lastJolt = -Infinity; // a landing or a shake: the knock in it isn't a bump
  const last: Record<string, number> = {};
  /** At most once every `ms`. */
  const every = (name: string, ms: number): boolean => {
    const t = now();
    if (t - (last[name] ?? -Infinity) < ms) return false;
    last[name] = t;
    return true;
  };
  let flying = false;
  let hanging = false;
  let resting = false;

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
    const t = now();
    const angle = screenAngle();
    const up = screenUp(e.beta, e.gamma, angle);
    const roll = screenTilt(e.beta, e.gamma, angle);
    const pitch = screenPitch(e.beta, e.gamma, angle);

    // Upside down he hangs on; the tips and windmills wait till he's the right way up.
    const over = upsideDown.update(up.y, t);
    if (over === "in") {
      hanging = true;
      show("level");
      hooks.hold("falling", true);
    } else if (over === "out") {
      hanging = false;
      hooks.hold("falling", false);
      if (every("steady", 4000)) hooks.act("steady");
    }
    if (!hanging) show(tilt.update(roll, t));

    // Face down he can't be seen; turned back over, there you are.
    if (faceDown.update(up.z, t) === "out" && every("peek", 8000)) hooks.playNow("peekFound");

    // Laid flat and left alone he rests sooner; picked up, he looks about.
    const lying = rest.update(roll, pitch, up.z, t);
    if (lying === "rest") {
      resting = true;
      hooks.rest?.(true);
    } else if (lying === "pickup") {
      resting = false;
      hooks.rest?.(false);
      if (every("pickup", 10_000)) hooks.act("lookAround");
    }

    if (hooks.frame) {
      const p = pose.update(roll, pitch, t);
      hooks.frame.live = true;
      hooks.frame.roll = hanging ? 0 : p.roll;
      hooks.frame.pitch = hanging ? 0 : p.pitch;
      hooks.frame.at = t;
    }
  };
  const onMotion = (e: DeviceMotionEvent) => {
    const t = now();
    const g = e.accelerationIncludingGravity;
    const withGravity =
      g && g.x !== null && g.y !== null && g.z !== null ? Math.hypot(g.x, g.y, g.z) : null;

    // Tossed: he flails till it's caught, then lands.
    if (withGravity !== null) {
      const f = fall.sample(withGravity, t);
      if (f === "fall" && !flying) {
        flying = true;
        hooks.hold("flying", true);
      } else if (f === "land" && flying) {
        flying = false;
        lastJolt = t;
        hooks.hold("flying", false);
        hooks.playNow("land");
      }
    }

    // Gravity left out; where a phone only reports it in, take it back off.
    let mag: number | null = null;
    const a = e.acceleration;
    if (a && a.x !== null && a.y !== null && a.z !== null) mag = Math.hypot(a.x, a.y, a.z);
    else if (withGravity !== null) mag = Math.abs(withGravity - GRAVITY);
    if (mag !== null && !flying) {
      if (shake.sample(mag, t) && t - lastDizzy > 6000) {
        lastDizzy = t;
        lastJolt = t;
        hooks.playNow("dizzy");
      }
      if (bump.sample(mag, t) && t - lastJolt > 1500 && every("bump", 6000)) {
        hooks.playNow("startle");
      }
    }

    // Twisted like a wheel: round he goes.
    const spin = e.rotationRate?.alpha;
    if (typeof spin === "number" && twist.sample(spin, t) && !flying && every("spin", 5000)) {
      hooks.playNow("spin");
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
    if (flying) hooks.hold("flying", false);
    if (hanging) hooks.hold("falling", false);
    if (resting) hooks.rest?.(false);
    if (hooks.frame) Object.assign(hooks.frame, restingFrame());
  };
}
