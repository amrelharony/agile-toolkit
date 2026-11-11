/**
 * The motion tokens that are plain values: the durations and the two
 * cubic-bezier easings (DNA-SPEC section 8). tokens.ts re-exports them beside
 * the springs, and globals.css MOTION FOUNDATIONS mirrors them
 * (test/motion/tokens.test.ts holds the three equal).
 *
 * They live apart so that client code needing only these, like the header
 * grow on every tool page, does not ship the spring solver tokens.ts runs when
 * it loads. Keep this file free of imports.
 */

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

/** The easings that are fixed curves; MOTION FOUNDATIONS writes each as --ease-<name>. */
export const CURVE = {
  /** Eases out and stops on its value. Data, progress, presenting. */
  calm: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** For things that travel far: about 1% past, never more than 3%. */
  glide: "cubic-bezier(0.2, 1.2, 0.4, 1)",
} as const;
