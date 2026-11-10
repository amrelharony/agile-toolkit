/**
 * The shared easing and duration tokens (DNA-SPEC section 8). globals.css
 * MOTION FOUNDATIONS mirrors every string here as --ease-* and --dur-*, and
 * test/motion/tokens.test.ts holds the two equal.
 *
 * settle and pop are real damped springs sampled into CSS linear() lists, so a
 * landing has a spring's shape wherever it runs. Browsers without linear()
 * (Safari 17.0-17.1) get a cubic-bezier with one overshoot of about the same
 * height. lib/motion/spring.ts runs the settle spring live, from the hand's speed.
 */

export interface SpringConfig {
  /** Pull toward the target per unit of distance. */
  readonly stiffness: number;
  /** Drag per unit of speed. */
  readonly damping: number;
  readonly mass: number;
}

/** About 8% past (damping ratio 0.625), at rest by DUR.settle. */
export const SETTLE_SPRING: SpringConfig = { stiffness: 1024, damping: 40, mass: 1 };
/** About 16% past (damping ratio 0.5), with a small second swing. */
export const POP_SPRING: SpringConfig = { stiffness: 1296, damping: 36, mass: 1 };

/** Damping ratio: below 1 the spring passes its target, at 1 or above it never does from rest. */
export function dampingRatio(config: SpringConfig): number {
  return config.damping / (2 * Math.sqrt(config.stiffness * config.mass));
}

/**
 * The damped spring, solved exactly: given a displacement `d0` from the target
 * and a velocity `v0` (units per second), where it is and how fast it moves `t`
 * seconds later. Exact for any `t`, so a dropped frame changes nothing.
 */
export function dampedSpring(
  config: SpringConfig,
  d0: number,
  v0: number,
  t: number
): { d: number; v: number } {
  const w0 = Math.sqrt(config.stiffness / config.mass);
  const zeta = dampingRatio(config);
  if (Math.abs(zeta - 1) < 1e-9) {
    const b = v0 + w0 * d0;
    const e = Math.exp(-w0 * t);
    return { d: (d0 + b * t) * e, v: (v0 - w0 * b * t) * e };
  }
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-zeta * w0 * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return {
      d: e * (d0 * cos + ((v0 + zeta * w0 * d0) / wd) * sin),
      v: e * (v0 * cos - ((w0 * w0 * d0 + zeta * w0 * v0) / wd) * sin),
    };
  }
  const root = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + root;
  const r2 = -zeta * w0 - root;
  const c2 = (v0 - r1 * d0) / (r2 - r1);
  const c1 = d0 - c2;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return { d: c1 * e1 + c2 * e2, v: r1 * c1 * e1 + r2 * c2 * e2 };
}

/** Three decimals, without trailing zeros: 0.5, 1, 1.081. */
function num(n: number): string {
  const v = Number(n.toFixed(3));
  return Object.is(v, -0) ? "0" : String(v);
}

/** Intervals in each linear() list: under 1.5% from the true curve at any point. */
export const SPRING_STEPS = 32;

/**
 * A spring released from rest at 0 toward 1, sampled evenly over `windowMs`
 * into a CSS linear() list. The last point is 1 exactly, so an animation ends
 * on its value; at the end of the window the spring is within 0.5% of it.
 */
export function springEase(config: SpringConfig, windowMs: number, steps = SPRING_STEPS): string {
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    if (i === 0) points.push("0");
    else if (i === steps) points.push("1");
    else points.push(num(1 + dampedSpring(config, -1, 0, ((windowMs / 1000) * i) / steps).d));
  }
  return `linear(${points.join(", ")})`;
}

/** Durations in milliseconds; MOTION FOUNDATIONS writes each as --dur-<name>. */
export const DUR = {
  press: 90,
  settle: 320,
  data: 450,
  "surface-in": 220,
  "surface-out": 140,
  "sheet-in": 280,
  "sheet-out": 200,
  page: 240,
  travel: 360,
} as const;

export type DurationName = keyof typeof DUR;

/**
 * The easings; MOTION FOUNDATIONS writes each as --ease-<name>. Both springs
 * are sampled over the settle duration; a longer animation stretches the
 * same shape, so its overshoot stays the same height.
 */
export const EASE = {
  /** Eases out and stops on its value. Data, progress, presenting. */
  calm: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** For things that travel far: about 1% past, never more than 3%. */
  glide: "cubic-bezier(0.2, 1.2, 0.4, 1)",
  settle: springEase(SETTLE_SPRING, DUR.settle),
  pop: springEase(POP_SPRING, DUR.settle),
} as const;

export type EaseName = keyof typeof EASE;

/** One-overshoot curves for browsers without linear(), declared before it. */
export const EASE_FALLBACK = {
  settle: "cubic-bezier(0.42, 1.52, 0.1, 1)",
  pop: "cubic-bezier(0.38, 1.76, 0.1, 1)",
} as const;

/** The @supports test MOTION FOUNDATIONS puts the linear() values behind. */
export const LINEAR_SUPPORTS = "(transition-timing-function: linear(0, 1))";
