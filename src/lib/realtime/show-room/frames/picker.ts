/**
 * Picker's show-room frames: frame kind → parser. The renderers are in
 * `../renderers/picker.tsx`. Every tool also gets the generic "text" frame,
 * which Picker uses for dice, coins, numbers and role picks.
 *
 *   "wheel"  a spin: the names on the wheel (with their weights, and which
 *            ones already had their turn this round), the winner, and how
 *            the wheel moves (whole turns, where in the slice it stops).
 *            Every phone works out the same landing from these numbers
 *            (lib/picker/wheel), so everyone sees it stop on the same name.
 *
 * A parser takes the payload as JSON gave it and returns exactly what may
 * be drawn, rebuilt field by field with every string run through
 * `cleanText` (and cut to a cap), or null. The whole frame stays far under
 * `SHOW_LIMITS.maxPayloadChars`: 40 names of 40 characters is about 2,000.
 *
 * Pure and server-safe: no React, no browser globals.
 */

import { cleanText, shareableText } from "../../sanitize";
import { obj } from "../../vote-room/wire";
import type { ShowFrameParsers } from "../frames";

export const PICKER_WHEEL_KIND = "wheel";

export const WHEEL_FRAME_LIMITS = {
  maxNames: 40,
  maxNameChars: 40,
  maxTitleChars: 80,
  maxWeight: 5,
  minTurns: 1,
  maxTurns: 10,
} as const;

/** A spin, as every screen in the room draws it. */
export interface WheelFrame {
  /** What the spin is for ("Who facilitates?"); may be "". */
  title: string;
  /** The names on the wheel, in order: 1 to 40, each once. */
  names: string[];
  /** One whole weight from 1 to 5 per name: its slice's size. */
  weights: number[];
  /** Indexes of names that already had their turn this round (shown greyed). */
  out: number[];
  /** The index the wheel stops on; never one of `out`. */
  winner: number;
  /** Whole turns before it settles. */
  turns: number;
  /** Where in the winner's slice it stops, 0 to 1. */
  offset: number;
}

const isWhole = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** A clean one-line string exactly as sent, or null. */
function exact(raw: unknown, max: number): string | null {
  const text = cleanText(raw, max);
  return text !== null && text === raw ? text : null;
}

/** A wheel frame, or null: anything off (a name with hidden characters, a repeat, a bad index) refuses it all. */
export function parseWheelFrame(raw: unknown): WheelFrame | null {
  const m = obj(raw);
  if (!m) return null;
  let title = "";
  if (m.title !== "" && m.title !== undefined) {
    const t = exact(m.title, WHEEL_FRAME_LIMITS.maxTitleChars);
    if (t === null) return null;
    title = t;
  }
  if (!Array.isArray(m.names) || m.names.length < 1) return null;
  if (m.names.length > WHEEL_FRAME_LIMITS.maxNames) return null;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const n of m.names) {
    const name = exact(n, WHEEL_FRAME_LIMITS.maxNameChars);
    if (name === null) return null;
    const key = name.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    names.push(name);
  }
  if (!Array.isArray(m.weights) || m.weights.length !== names.length) return null;
  const weights: number[] = [];
  for (const w of m.weights) {
    if (!isWhole(w, 1, WHEEL_FRAME_LIMITS.maxWeight)) return null;
    weights.push(w);
  }
  const outRaw = m.out === undefined ? [] : m.out;
  if (!Array.isArray(outRaw) || outRaw.length >= names.length) return null;
  const out: number[] = [];
  for (const i of outRaw) {
    if (!isWhole(i, 0, names.length - 1) || out.includes(i)) return null;
    out.push(i);
  }
  out.sort((a, b) => a - b);
  if (!isWhole(m.winner, 0, names.length - 1) || out.includes(m.winner)) return null;
  if (!isWhole(m.turns, WHEEL_FRAME_LIMITS.minTurns, WHEEL_FRAME_LIMITS.maxTurns)) return null;
  if (typeof m.offset !== "number" || !Number.isFinite(m.offset)) return null;
  if (m.offset < 0 || m.offset > 1) return null;
  return { title, names, weights, out, winner: m.winner, turns: m.turns, offset: m.offset };
}

/**
 * A wheel frame from the host's own spin: names cleaned (hidden characters
 * stripped, cut to the caps) rather than refused, since it is the host's
 * text. Null when what's left doesn't make a valid frame (a repeat after
 * cleaning, a winner that's out).
 */
export function wheelFrame(input: {
  title?: string;
  names: readonly string[];
  weights: readonly number[];
  out?: readonly number[];
  winner: number;
  turns: number;
  offset: number;
}): WheelFrame | null {
  return parseWheelFrame({
    title: shareableText(input.title ?? "", WHEEL_FRAME_LIMITS.maxTitleChars),
    names: input.names.map((n) => shareableText(n, WHEEL_FRAME_LIMITS.maxNameChars)),
    weights: input.weights.map((w) =>
      Math.min(WHEEL_FRAME_LIMITS.maxWeight, Math.max(1, Math.round(w)))
    ),
    out: input.out ? [...input.out] : [],
    winner: input.winner,
    turns: Math.round(input.turns),
    offset: input.offset,
  });
}

export const PICKER_FRAMES: ShowFrameParsers = {
  [PICKER_WHEEL_KIND]: parseWheelFrame,
};
