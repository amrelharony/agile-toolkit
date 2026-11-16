/**
 * Fair randomness for the facilitation tools: spin a wheel, draw names so
 * everyone goes once, shuffle a speaking order, mix groups, roll a die.
 *
 * Every function is pure apart from the random numbers it draws, and takes an
 * optional `rng` (a function returning a number in [0, 1)), so a test or a
 * shared live spin can pass a seeded one from `createRng` and get the same
 * result every time. Without one, `Math.random` is used. Inputs are never
 * changed: a shuffle returns a new array, a draw a new bag.
 *
 * The analytics and ink code keep their own small seeded generators; this is
 * the shared one for anything a person sees picked.
 */

/** A source of random numbers in [0, 1), like `Math.random`. */
export type Rng = () => number;

const defaultRng: Rng = () => Math.random();

/** A 32-bit seed from a string (FNV-1a, then mixed so close strings land far apart). */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A fresh seed: from the browser's crypto when it has one, else from Math.random. */
function freshSeed(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === "function") {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

/**
 * A seeded random number generator (mulberry32): the same seed always gives
 * the same sequence, so a host and every phone in a live room can replay one
 * spin from its seed. A string seed is hashed first ("sprint 42" works). No
 * seed: a fresh one, so each call starts a new sequence.
 */
export function createRng(seed?: number | string): Rng {
  let a = seed === undefined ? freshSeed() : typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from `min` to `max`, both included. Throws for a range with no whole number in it. */
export function randomInt(min: number, max: number, rng: Rng = defaultRng): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
    throw new RangeError(`randomInt: no whole number from ${min} to ${max}`);
  }
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** A new array with the items in random order (Fisher–Yates: every order equally likely). */
export function shuffle<T>(items: readonly T[], rng: Rng = defaultRng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

export interface PickOptions<T> {
  rng?: Rng;
  /**
   * Items never to pick: a list (compared with `Object.is`, so strings and
   * ids work as you'd expect) or a test. An item excluded is skipped, never
   * re-rolled into.
   */
  exclude?: readonly T[] | ((item: T) => boolean);
}

/** One item at random, each equally likely; undefined when nothing is left to pick. */
export function pick<T>(items: readonly T[], options: PickOptions<T> = {}): T | undefined {
  const { rng = defaultRng, exclude } = options;
  const skip =
    exclude === undefined
      ? undefined
      : typeof exclude === "function"
        ? exclude
        : (item: T) => exclude.some((x) => Object.is(x, item));
  const pool = skip ? items.filter((item) => !skip(item)) : items;
  if (pool.length === 0) return undefined;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * One item at random, in proportion to its weight: a weight of 2 comes up
 * twice as often as a weight of 1. Weights are a list in step with `items`
 * or a function of the item. A weight that is zero, negative or not a number
 * never comes up; undefined when no item has a weight above zero.
 */
export function weightedPick<T>(
  items: readonly T[],
  weights: readonly number[] | ((item: T, index: number) => number),
  rng: Rng = defaultRng
): T | undefined {
  const w = items.map((item, i) => {
    const v = typeof weights === "function" ? weights(item, i) : weights[i];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  });
  const total = w.reduce((n, v) => n + v, 0);
  if (total <= 0) return undefined;
  let at = rng() * total;
  for (let i = 0; i < items.length; i++) {
    if (w[i] === 0) continue;
    at -= w[i];
    if (at < 0) return items[i];
  }
  // Rounding left a sliver at the end: the last item with any weight.
  for (let i = items.length - 1; i >= 0; i--) if (w[i] > 0) return items[i];
  return undefined;
}

/**
 * An everyone-once bag: each item comes out once per round, in random order,
 * and the bag refills when it's empty. Plain JSON (the items, the indexes
 * still in, the round and the last index drawn), so it can be kept in a
 * persisted store or sent to a live room and drawn from on another device.
 */
export interface Bag<T> {
  /** Every item, in the order the bag was made with. */
  items: T[];
  /** Indexes into `items` not yet drawn this round. */
  remaining: number[];
  /** 1 for the first time through the items, then 2, 3… */
  round: number;
  /** The index drawn last, so a new round doesn't start with the item that ended the last one. */
  last?: number;
}

/** A full bag of `items`, at round 1. */
export function createBag<T>(items: readonly T[]): Bag<T> {
  return { items: items.slice(), remaining: items.map((_, i) => i), round: 1 };
}

/** The items still in the bag this round, in the bag's order. */
export function bagRemaining<T>(bag: Bag<T>): T[] {
  return bag.remaining.map((i) => bag.items[i]);
}

/**
 * Draw one item: `item` is undefined only for an empty bag. Returns the new
 * bag and leaves the one passed in as it was. When the round is over the bag
 * refills first, and the item drawn last isn't the first one out again
 * (unless it's the only item).
 */
export function drawFromBag<T>(
  bag: Bag<T>,
  rng: Rng = defaultRng
): { item: T | undefined; bag: Bag<T> } {
  if (bag.items.length === 0) return { item: undefined, bag };
  const valid = bag.remaining.filter((i) => Number.isInteger(i) && i >= 0 && i < bag.items.length);
  let remaining = valid;
  let round = bag.round;
  if (remaining.length === 0) {
    remaining = bag.items.map((_, i) => i);
    round += 1;
  }
  const choices =
    remaining.length > 1 && bag.last !== undefined && valid.length === 0
      ? remaining.filter((i) => i !== bag.last)
      : remaining;
  const index = choices[Math.floor(rng() * choices.length)];
  return {
    item: bag.items[index],
    bag: { items: bag.items, remaining: remaining.filter((i) => i !== index), round, last: index },
  };
}

/** A die roll from 1 to `sides` (6 by default). Throws for fewer than 2 sides or a fraction. */
export function rollDie(sides = 6, rng: Rng = defaultRng): number {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new RangeError(`rollDie: a die needs a whole number of sides, 2 or more (got ${sides})`);
  }
  return randomInt(1, sides, rng);
}

/** Heads or tails, each half the time. */
export function flipCoin(rng: Rng = defaultRng): "heads" | "tails" {
  return rng() < 0.5 ? "heads" : "tails";
}
