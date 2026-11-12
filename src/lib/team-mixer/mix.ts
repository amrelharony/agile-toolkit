/**
 * Mix people into groups or pairs: the facilitator's rules first, then
 * fresh company (nobody pairs again while a new partner is left), then the
 * balance asked for (each role, or each skill, spread across the groups).
 * The result names every rule it had to break, every pair that meets again
 * and anyone who sits out, in plain words.
 *
 * Pairs start from a round-robin rotation (the circle method), with the
 * people in an order fixed by the series' seed, so a team that keeps the
 * same people gets n - 1 rounds of new pairs before any repeats; the search
 * then fits the rules and the balance around it.
 *
 * Seeded through src/lib/utils/random.ts: the same seed, people, rules and
 * history give the same mix (when the time limit doesn't cut the search).
 * Pure and server-safe.
 */

import { createRng, shuffle } from "@/lib/utils/random";
import {
  MIXER_LIMITS,
  groupLabel,
  groupSizes,
  listNames,
  nameKey,
  ordinal,
  pairKey,
  pairSizes,
  plural,
  uniquePeople,
  type Balance,
  type MixIssue,
  type MixPerson,
  type MixRuleInput,
  type OddPolicy,
  type PastRound,
  type SplitSpec,
} from "./model";
import { searchPartition } from "./search";
import {
  BALANCE_COST,
  RECENT_COST,
  REPEAT_COST,
  RULE_COST,
  balanceIssues,
  metHistory,
  noTraitsIssue,
  pairList,
  placeRules,
  repeatCost,
  sharedTraits,
  traitsOf,
  type PlacedRule,
} from "./weights";

/** The default time the search may take, in milliseconds. */
export const MIX_TIME_LIMIT_MS = 250;

export interface MixInput {
  people: readonly MixPerson[];
  mode: "groups" | "pairs";
  /** Groups: the size or the count. Default groups of 4. */
  split?: SplitSpec;
  /** Pairs with an odd number of people. Default a trio. */
  odd?: OddPolicy;
  balance?: Balance;
  rules?: readonly MixRuleInput[];
  /** Earlier rounds, oldest first. */
  history?: readonly PastRound[];
  /** The mix's own seed. */
  seed: number;
  /** Pairs: the seed that fixes the rotation's order for the series. Default: `seed`. */
  rotationSeed?: number;
  timeLimitMs?: number;
  maxKicks?: number;
  now?: () => number;
}

export interface MixResult {
  /** The groups, each its people's names in the order they were given. */
  groups: string[][];
  /** Pairs: who sits out this round (an odd number with the sit-out choice). */
  sitOut: string[];
  /** The report, in plain words: broken rules first. */
  issues: MixIssue[];
  /** Pairs of people sharing a group again. */
  repeats: number;
  /** Rules that couldn't be kept. */
  broken: number;
  timedOut: boolean;
}

export type MixOutcome = ({ ok: true } & MixResult) | { ok: false; error: string };

/** Why these people can't be mixed this way, in plain words, or null. */
export function mixProblem(
  people: number,
  mode: "groups" | "pairs",
  split?: SplitSpec
): string | null {
  if (people < 2) return "Add at least 2 people to mix.";
  if (people > MIXER_LIMITS.people) {
    return `Team Mixer mixes up to ${MIXER_LIMITS.people} people at a time.`;
  }
  if (mode === "groups" && split && groupSizes(people, split).length < 2) {
    return split.by === "count"
      ? "Ask for at least 2 groups."
      : `With ${people} people, groups of ${split.n} make only one group. Try a smaller size.`;
  }
  return null;
}

/** Union-find roots of the keep-together rules: the clusters that should share a group. */
function togetherClusters(n: number, rules: readonly PlacedRule[]): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const r of rules) if (r.kind === "together") parent[find(r.i)] = find(r.j);
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), i]);
  }
  return Array.from(byRoot.values()).filter((c) => c.length > 1);
}

/**
 * The round-robin start for pair round `round` (0-based): the circle method
 * over the people in the series' order, mapped onto the seats (a trio's
 * extra person joins pair 0; with a sit-out seat, the one with the bye sits
 * out). Null when the seats don't fit pairs.
 */
function rotationStart(
  people: readonly MixPerson[],
  sizes: readonly number[],
  sitOutGroup: number | null,
  round: number,
  rotationSeed: number
): number[] | null {
  const n = people.length;
  if (n < 2) return null;
  const keys = people.map((p) => nameKey(p.name));
  const byKey = new Map(keys.map((k, i) => [k, i] as const));
  const order: number[] = shuffle(keys.slice().sort(), createRng(rotationSeed)).map(
    (k) => byKey.get(k)!
  );
  const bye = -1;
  if (order.length % 2 === 1) order.push(bye);
  const total = order.length;
  const turns = total - 1;
  const r = ((round % turns) + turns) % turns;
  const rest = order.slice(1);
  const rotated = [order[0], ...rest.slice(rest.length - r), ...rest.slice(0, rest.length - r)];
  const pairs: [number, number][] = [];
  let lone = -1;
  for (let i = 0; i < total / 2; i++) {
    const a = rotated[i];
    const b = rotated[total - 1 - i];
    if (a === bye) lone = b;
    else if (b === bye) lone = a;
    else pairs.push([a, b]);
  }
  const groups = sitOutGroup === null ? sizes.length : sizes.length - 1;
  if (pairs.length !== groups) return null;
  const assign = new Array<number>(n).fill(0);
  pairs.forEach(([a, b], g) => {
    assign[a] = g;
    assign[b] = g;
  });
  if (lone >= 0) assign[lone] = sitOutGroup ?? 0;
  return assign;
}

/** The seats for a mix: each group's size, and which one (if any) is the sit-out seat. */
function seatsFor(
  n: number,
  mode: "groups" | "pairs",
  split: SplitSpec,
  odd: OddPolicy
): { sizes: number[]; sitOutGroup: number | null } {
  if (mode === "groups") return { sizes: groupSizes(n, split), sitOutGroup: null };
  const { sizes, sitOut } = pairSizes(n, odd);
  return sitOut > 0
    ? { sizes: [...sizes, sitOut], sitOutGroup: sizes.length }
    : { sizes, sitOutGroup: null };
}

/** Mix `input.people` (see the file header). */
export function mixGroups(input: MixInput): MixOutcome {
  const people = uniquePeople(input.people);
  const n = people.length;
  const mode = input.mode;
  const split: SplitSpec = input.split ?? { by: "size", n: 4 };
  const odd: OddPolicy = input.odd ?? "trio";
  const balance: Balance = input.balance ?? "none";
  const problem = mixProblem(n, mode, mode === "groups" ? split : undefined);
  if (problem) return { ok: false, error: problem };

  const history = metHistory(input.history ?? []);
  const { placed, skipped } = placeRules(people, input.rules ?? []);
  const traits = traitsOf(people, balance);
  const { sizes, sitOutGroup } = seatsFor(n, mode, split, odd);
  const m = sizes.length;

  const pair = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w =
        repeatCost(history, people[i].name, people[j].name) +
        BALANCE_COST * sharedTraits(traits[i], traits[j]);
      pair[i * n + j] = w;
      pair[j * n + i] = w;
    }
  }
  for (const r of placed) {
    const w = r.kind === "apart" ? RULE_COST : -RULE_COST;
    pair[r.i * n + r.j] += w;
    pair[r.j * n + r.i] += w;
  }
  let unary: Float64Array | null = null;
  if (sitOutGroup !== null) {
    unary = new Float64Array(n * m);
    people.forEach((p, i) => {
      const key = nameKey(p.name);
      unary![i * m + sitOutGroup] =
        (history.satOut.get(key) ?? 0) * REPEAT_COST +
        (history.satOutLast.has(key) ? RECENT_COST : 0);
    });
  }

  const rng = createRng(input.seed);
  const pastRounds = input.history?.length ?? 0;
  const start =
    mode === "pairs"
      ? rotationStart(people, sizes, sitOutGroup, pastRounds, input.rotationSeed ?? input.seed)
      : null;
  const found = searchPartition(
    {
      n,
      sizes,
      classes: sizes.map((_, g) => (g === sitOutGroup ? 1 : 0)),
      pair,
      unary,
    },
    {
      rng,
      timeLimitMs: input.timeLimitMs ?? MIX_TIME_LIMIT_MS,
      maxKicks: input.maxKicks,
      starts: start ? [start] : [],
      now: input.now,
    }
  );

  // Groups in seat order, each with its people in the order they were given.
  const seats: number[][] = sizes.map(() => []);
  found.assign.forEach((g, i) => seats[g].push(i));
  const groupSeats = seats.filter((_, g) => g !== sitOutGroup && seats[g].length > 0);
  const outSeats = sitOutGroup === null ? [] : seats[sitOutGroup];
  const groupOf = new Map<number, number>();
  groupSeats.forEach((g, gi) => g.forEach((i) => groupOf.set(i, gi)));
  const label = (g: number) => groupLabel(mode, g);

  const issues: MixIssue[] = [];
  let broken = 0;
  const maxSize = Math.max(...groupSeats.map((g) => g.length));
  const tooBig = togetherClusters(n, placed).filter((c) => c.length > maxSize);
  const inTooBig = new Set(tooBig.flat());
  for (const c of tooBig) {
    broken++;
    issues.push({
      kind: "together",
      text: `${listNames(c.map((i) => people[i].name))} should all be together, but the ${
        mode === "pairs" ? "pairs hold" : "groups hold"
      } ${maxSize} people at most.`,
    });
  }
  for (const r of placed) {
    const gi = groupOf.get(r.i);
    const gj = groupOf.get(r.j);
    if (r.kind === "apart" && gi !== undefined && gi === gj) {
      broken++;
      issues.push({
        kind: "apart",
        text: `${r.a} and ${r.b} are both in ${label(gi)}, though they should be kept apart.`,
      });
    } else if (r.kind === "together" && (gi === undefined || gi !== gj)) {
      if (inTooBig.has(r.i) && inTooBig.has(r.j)) continue;
      broken++;
      // "Cy is in Group 1 and Dee in Group 3", "Cy sits out and Dee is in Pair 2".
      const place = (who: string, g: number | undefined, verb: boolean) =>
        g === undefined ? `${who} sits out` : `${who} ${verb ? "is in" : "in"} ${label(g)}`;
      issues.push({
        kind: "together",
        text: `${place(r.a, gi, true)} and ${place(r.b, gj, gi === undefined)}, though they should be together.`,
      });
    }
  }

  const again: [string, string][] = [];
  for (const g of groupSeats) {
    for (let x = 0; x < g.length; x++) {
      for (let y = x + 1; y < g.length; y++) {
        const a = people[g[x]].name;
        const b = people[g[y]].name;
        if ((history.count.get(pairKey(a, b)) ?? 0) > 0) again.push([a, b]);
      }
    }
  }
  if (again.length > 0) {
    const thisRound = pastRounds + 1;
    const fresh = n % 2 === 0 ? n - 1 : n;
    const names = pairList(again);
    issues.push({
      kind: "repeat",
      text:
        mode === "pairs" && thisRound > fresh
          ? `With ${n} people there ${fresh === 1 ? "is" : "are"} ${plural(fresh, "round")} of new pairs, and this is the ${ordinal(thisRound)} round, so some meet again: ${names}.`
          : `${plural(again.length, "pair")} ${again.length === 1 ? "has" : "have"} been together before: ${names}.`,
    });
  }

  for (const i of outSeats) {
    const times = history.satOut.get(nameKey(people[i].name)) ?? 0;
    issues.push({
      kind: "sit-out",
      text:
        times > 0
          ? `${people[i].name} sits out this round, for the ${ordinal(times + 1)} time.`
          : `${people[i].name} sits out this round.`,
    });
  }

  const noTraits = noTraitsIssue(people, balance, traits);
  if (noTraits) issues.push(noTraits);
  else issues.push(...balanceIssues(people, balance, groupSeats, label));
  issues.push(...skipped);

  if (found.timedOut && (broken > 0 || again.length > 0)) {
    issues.push({ kind: "search", text: searchNote(input.timeLimitMs ?? MIX_TIME_LIMIT_MS) });
  }

  return {
    ok: true,
    groups: groupSeats.map((g) => g.map((i) => people[i].name)),
    sitOut: outSeats.map((i) => people[i].name),
    issues: issues.slice(0, MIXER_LIMITS.issues),
    repeats: again.length,
    broken,
    timedOut: found.timedOut,
  };
}

/** The note when the time limit cut the search short. */
export function searchNote(limitMs: number): string {
  const seconds = Math.max(0.1, Math.round(limitMs / 100) / 10);
  return `Team Mixer stopped looking after ${seconds} seconds and kept the best mix it found.`;
}
