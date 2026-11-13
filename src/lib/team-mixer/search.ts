/**
 * The search behind every mix: put n people into groups of fixed sizes so
 * the total cost is as low as it can find. A cost is set per pair of people
 * who share a group (a broken keep-apart rule, a pair who met before, two
 * people with the same role) and per person in a group (a table already
 * visited, sitting out again). A keep-together rule is a negative cost.
 *
 * It starts from the given assignments and from random ones, improves each
 * by swapping two people (or moving one between groups whose sizes allow
 * it) while that lowers the cost, then shakes the best one found and tries
 * again: an iterated local search. It stops at a time limit, after a number
 * of shakes, or when shaking stops finding anything better, and returns the
 * best assignment found, never a partial one.
 *
 * Seeded: every random choice comes from the `rng` it is given (through
 * src/lib/utils/random.ts), so the same seed and limits give the same mix.
 * Pure: no React, no browser globals.
 */

import { shuffle, type Rng } from "@/lib/utils/random";

export interface PartitionProblem {
  /** People, numbered 0 to n - 1. */
  n: number;
  /** Seats in each group; they add up to n. */
  sizes: readonly number[];
  /**
   * Groups of the same class may trade a person by a move (from a group one
   * bigger to one smaller), which keeps the sizes the same overall. A class
   * of its own (a sit-out seat) only ever trades by swaps. Default: all 0.
   */
  classes?: readonly number[];
  /** The cost of i and j sharing a group, row by row (n × n), symmetric, 0 on the diagonal. */
  pair: Float64Array;
  /** The cost of person i in group g, row by row (n × groups), or none. */
  unary?: Float64Array | null;
}

export interface SearchOptions {
  rng: Rng;
  /** Stop after this long, in milliseconds, keeping the best found. */
  timeLimitMs: number;
  /** Most shakes of the best assignment. Default 400. */
  maxKicks?: number;
  /** Stop after this many shakes in a row found nothing better. Default 80. */
  stall?: number;
  /** Assignments (the group of each person) to try first; one that doesn't fit the sizes is skipped. */
  starts?: readonly (readonly number[])[];
  /** The clock, for tests. Default Date.now. */
  now?: () => number;
}

export interface SearchResult {
  /** The group of each person. */
  assign: number[];
  cost: number;
  /** Shakes tried. */
  kicks: number;
  /** True when the time limit stopped it. */
  timedOut: boolean;
}

const EPS = 1e-9;

/** The total cost of an assignment. */
export function assignmentCost(p: PartitionProblem, assign: readonly number[]): number {
  const { n, pair, unary } = p;
  const m = p.sizes.length;
  let cost = 0;
  for (let i = 0; i < n; i++) {
    if (unary) cost += unary[i * m + assign[i]];
    for (let j = i + 1; j < n; j++) if (assign[i] === assign[j]) cost += pair[i * n + j];
  }
  return cost;
}

/** Whether `assign` puts exactly `sizes[g]` people in each group g. */
function fitsSizes(p: PartitionProblem, assign: readonly number[]): boolean {
  const m = p.sizes.length;
  if (assign.length !== p.n) return false;
  const count = new Array<number>(m).fill(0);
  for (const g of assign) {
    if (!Number.isInteger(g) || g < 0 || g >= m) return false;
    count[g]++;
  }
  return count.every((c, g) => c === p.sizes[g]);
}

/** A random assignment that fills each group to its size. */
function randomAssignment(p: PartitionProblem, rng: Rng): number[] {
  const order = shuffle(
    Array.from({ length: p.n }, (_, i) => i),
    rng
  );
  const assign = new Array<number>(p.n).fill(0);
  let at = 0;
  p.sizes.forEach((size, g) => {
    for (let k = 0; k < size; k++) assign[order[at++]] = g;
  });
  return assign;
}

/** An assignment being improved, with each person's cost to every group kept up to date. */
class Work {
  readonly assign: number[];
  readonly count: number[];
  /** toGroup[i * m + g]: the summed pair cost between i and everyone in group g. */
  readonly toGroup: Float64Array;
  cost: number;

  constructor(
    private readonly p: PartitionProblem,
    assign: readonly number[]
  ) {
    const { n, pair } = p;
    const m = p.sizes.length;
    this.assign = assign.slice();
    this.count = new Array<number>(m).fill(0);
    for (const g of this.assign) this.count[g]++;
    this.toGroup = new Float64Array(n * m);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) this.toGroup[i * m + this.assign[j]] += pair[i * n + j];
      }
    }
    this.cost = assignmentCost(p, this.assign);
  }

  private u(i: number, g: number): number {
    const { unary } = this.p;
    return unary ? unary[i * this.p.sizes.length + g] : 0;
  }

  swapDelta(i: number, j: number): number {
    const m = this.p.sizes.length;
    const a = this.assign[i];
    const b = this.assign[j];
    const w = this.p.pair[i * this.p.n + j];
    return (
      this.toGroup[i * m + b] -
      w -
      this.toGroup[i * m + a] +
      (this.toGroup[j * m + a] - w) -
      this.toGroup[j * m + b] +
      this.u(i, b) -
      this.u(i, a) +
      this.u(j, a) -
      this.u(j, b)
    );
  }

  moveDelta(i: number, g: number): number {
    const m = this.p.sizes.length;
    const a = this.assign[i];
    return this.toGroup[i * m + g] - this.toGroup[i * m + a] + this.u(i, g) - this.u(i, a);
  }

  swap(i: number, j: number): void {
    const { n, pair } = this.p;
    const m = this.p.sizes.length;
    this.cost += this.swapDelta(i, j);
    const a = this.assign[i];
    const b = this.assign[j];
    for (let x = 0; x < n; x++) {
      const d = pair[x * n + j] - pair[x * n + i];
      this.toGroup[x * m + a] += d;
      this.toGroup[x * m + b] -= d;
    }
    this.assign[i] = b;
    this.assign[j] = a;
  }

  move(i: number, g: number): void {
    const { n, pair } = this.p;
    const m = this.p.sizes.length;
    this.cost += this.moveDelta(i, g);
    const a = this.assign[i];
    for (let x = 0; x < n; x++) {
      const w = pair[x * n + i];
      this.toGroup[x * m + a] -= w;
      this.toGroup[x * m + g] += w;
    }
    this.count[a]--;
    this.count[g]++;
    this.assign[i] = g;
  }
}

/**
 * Improve `w` until no single swap or move lowers its cost. Returns false
 * when the deadline passed first (what it reached so far still stands).
 */
function descend(
  w: Work,
  p: PartitionProblem,
  rng: Rng,
  deadline: number,
  now: () => number
): boolean {
  const { n } = p;
  const m = p.sizes.length;
  const classes = p.classes;
  const people = Array.from({ length: n }, (_, i) => i);
  for (;;) {
    let improved = false;
    for (const i of shuffle(people, rng)) {
      const a = w.assign[i];
      let best = -EPS;
      let swapWith = -1;
      let moveTo = -1;
      for (let j = 0; j < n; j++) {
        if (w.assign[j] === a) continue;
        const d = w.swapDelta(i, j);
        if (d < best) {
          best = d;
          swapWith = j;
          moveTo = -1;
        }
      }
      for (let g = 0; g < m; g++) {
        if (g === a || w.count[g] !== w.count[a] - 1) continue;
        if ((classes?.[g] ?? 0) !== (classes?.[a] ?? 0)) continue;
        const d = w.moveDelta(i, g);
        if (d < best) {
          best = d;
          moveTo = g;
          swapWith = -1;
        }
      }
      if (swapWith >= 0) {
        w.swap(i, swapWith);
        improved = true;
      } else if (moveTo >= 0) {
        w.move(i, moveTo);
        improved = true;
      }
    }
    if (!improved) return true;
    if (now() > deadline) return false;
  }
}

/** Shake: a few random swaps between people in different groups. */
function kick(w: Work, p: PartitionProblem, rng: Rng): void {
  const swaps = Math.max(2, Math.ceil(p.n * 0.15));
  for (let k = 0; k < swaps; k++) {
    const i = Math.floor(rng() * p.n);
    const j = Math.floor(rng() * p.n);
    if (w.assign[i] !== w.assign[j]) w.swap(i, j);
  }
}

/** The best assignment the search finds within its limits (see the file header). */
export function searchPartition(p: PartitionProblem, opts: SearchOptions): SearchResult {
  const { rng } = opts;
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + Math.max(0, opts.timeLimitMs);
  const maxKicks = Math.max(0, Math.floor(opts.maxKicks ?? 400));
  const stall = Math.max(1, Math.floor(opts.stall ?? 80));
  const m = p.sizes.length;

  if (p.n === 0 || m === 0) return { assign: [], cost: 0, kicks: 0, timedOut: false };
  if (m === 1) {
    const assign = new Array<number>(p.n).fill(0);
    return { assign, cost: assignmentCost(p, assign), kicks: 0, timedOut: false };
  }

  let timedOut = false;
  const starts = (opts.starts ?? []).filter((s) => fitsSizes(p, s));
  let best = new Work(p, starts[0] ?? randomAssignment(p, rng));
  if (!descend(best, p, rng, deadline, now)) timedOut = true;
  // The other starts, then one random start beside them when any was given.
  const more = starts.length > 0 ? [...starts.slice(1), randomAssignment(p, rng)] : [];
  for (const start of more) {
    if (timedOut) break;
    const w = new Work(p, start);
    if (!descend(w, p, rng, deadline, now)) timedOut = true;
    if (w.cost < best.cost - EPS) best = w;
  }

  let kicks = 0;
  let quiet = 0;
  while (!timedOut && kicks < maxKicks && quiet < stall) {
    kicks++;
    // Mostly a shaken copy of the best; now and then a fresh start, so the
    // search doesn't circle one corner.
    const fresh = kicks % 10 === 0;
    const w = new Work(p, fresh ? randomAssignment(p, rng) : best.assign);
    if (!fresh) kick(w, p, rng);
    if (!descend(w, p, rng, deadline, now)) timedOut = true;
    if (w.cost < best.cost - EPS) {
      best = w;
      quiet = 0;
    } else {
      quiet++;
    }
    if (!timedOut && now() > deadline) timedOut = true;
  }

  const assign = best.assign.slice();
  return { assign, cost: assignmentCost(p, assign), kicks, timedOut };
}
