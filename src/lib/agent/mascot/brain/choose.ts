/**
 * Picking among the ways Amr can answer something, so he doesn't repeat himself:
 * the one he's used least recently wins, with a little chance in it, and his
 * temperament can weigh some answers over others. Pure; randomness is injected.
 */

import type { MascotReaction } from "@/lib/agent/mascot/store";
import type { Temperament } from "./state";

/**
 * One of `options`, favouring those not in `recent` (most recent last). Each
 * option starts at its weight (1 when `weight` gives none) and loses most of it
 * for having been used lately: the last one played is out (unless it's the only
 * one), the one before keeps a fifth, and so on back to its full weight. Null
 * only when there are no options.
 */
export function pickFresh<T extends string>(
  options: readonly T[],
  recent: readonly string[],
  random: () => number = Math.random,
  weight?: (option: T) => number
): T | null {
  if (!options.length) return null;
  const weights = options.map((o) => {
    const base = Math.max(0, weight?.(o) ?? 1);
    const ago = recent.length - 1 - recent.lastIndexOf(o); // 0 = the last one played
    if (!recent.includes(o)) return base;
    return base * Math.min(1, 0.2 * ago);
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return options[0];
  let r = random() * total;
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r < 0) return options[i];
  }
  return options[options.length - 1];
}

/** `list` with `item` added at the end, keeping the newest `keep`. */
export function remember<T>(list: readonly T[], item: T, keep: number): T[] {
  return [...list, item].slice(-keep);
}

/** How he answers ordinary work in a tool (a card added, a note saved). */
export const WORK_REACTIONS: readonly MascotReaction[] = ["nod", "thumbsUp", "yes"];

/** Finishes this close together are a run worth a dance. */
export const RUN_WINDOW_MS = 5 * 60_000;
export const RUN_LENGTH = 3;

/**
 * Being poked wears thin. `pokes` is how many times he's been poked in the last
 * minute, this one included: a giggle at first, then he goes shy, then he
 * shrugs, and after that he hides his eyes until he's left alone a while. A
 * playful Amr has more patience, a grumpy one less.
 */
export type PokeAnswer = "poke" | "bashful" | "shrug" | "hide";

export function pokeAnswer(pokes: number, temperament: Temperament): PokeAnswer {
  const patience = temperament === "playful" ? 2 : temperament === "grumpy" ? -1 : 0;
  const n = pokes - patience;
  if (n <= 2) return "poke";
  if (n === 3) return "bashful";
  if (n === 4) return "shrug";
  return "hide";
}

/** Pokes further back than this are forgiven. */
export const POKE_MEMORY_MS = 60_000;
/** How long he hides his eyes when he's had enough. */
export const HIDE_MS = 2200;
