/**
 * Mix people into groups or pairs: the facilitator's rules first, then
 * fresh company (nobody pairs again while a new partner is left), then the
 * balance asked for (each role, or each skill, spread across the groups).
 * The result names every rule it had to break, every pair that meets again
 * and anyone who sits out, in plain words.
 *
 * Pairs follow a round-robin rotation (the circle method), with the people
 * in an order fixed by the series' seed (tuned so the first rounds are the
 * balanced ones), so a team that keeps the same people gets n - 1 rounds of
 * new pairs before any repeats (n with one sitting out each round). The
 * search keeps the rotation's pairs unless a rule says otherwise: balance
 * never pulls them apart, since it would cost new company later on.
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
  ROTATION_COST,
  RULE_COST,
  balanceIssues,
  metHistory,
  noTraitsIssue,
  pairList,
  placeRules,
  repeatCost,
  sharedTraits,
  traitsOf,
  type MetHistory,
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
  /**
   * This round's place in the series, from 0 (the rounds mixed before it,
   * which can be more than the history keeps). Default: the history's length.
   */
  round?: number;
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

/** The empty seat that makes an odd number even in the circle method. */
const BYE = -1;
/** How many of a series' first rounds the rotation's order is tuned for. */
const TUNED_ROUNDS = 8;

/**
 * Who sits at seat `i` (from 0) of the circle in round `round`: the first
 * place stays, and the others turn one seat each round.
 */
function circleSeat(order: readonly number[], round: number, i: number): number {
  if (i === 0) return order[0];
  const turns = order.length - 1;
  return order[1 + ((((i - 1 - round) % turns) + turns) % turns)];
}

/** The circle method's pairs in round `round` (from 0), by place in `order`; BYE is the empty seat. */
function circlePairs(order: readonly number[], round: number): [number, number][] {
  const total = order.length;
  const pairs: [number, number][] = [];
  for (let i = 0; i < total / 2; i++) {
    pairs.push([circleSeat(order, round, i), circleSeat(order, round, total - 1 - i)]);
  }
  return pairs;
}

/**
 * The series' order for the circle method: the people shuffled by the
 * series' seed (with a BYE seat for an odd number). When pairs cost
 * something (a shared role or skill, a keep-apart rule), the order is then
 * tuned by swapping places, so the first rounds pair people who differ: a
 * whole rotation pairs everyone once whatever the order, so only which
 * rounds come first can change. The same people, traits, rules and seed
 * always give the same order, so the rotation holds round after round.
 */
function rotationOrder(
  people: readonly MixPerson[],
  rotationSeed: number,
  cost: ((i: number, j: number) => number) | null
): number[] {
  const keys = people.map((p) => nameKey(p.name));
  const byKey = new Map(keys.map((k, i) => [k, i] as const));
  const order: number[] = shuffle(keys.slice().sort(), createRng(rotationSeed)).map(
    (k) => byKey.get(k)!
  );
  if (order.length % 2 === 1) order.push(BYE);
  if (!cost || order.length < 4) return order;

  const rounds = Math.min(order.length - 1, TUNED_ROUNDS);
  const score = (o: readonly number[]) => {
    let s = 0;
    for (let k = 0; k < rounds; k++) {
      const w = 2 ** -k;
      for (const [a, b] of circlePairs(o, k)) if (a !== BYE && b !== BYE) s += w * cost(a, b);
    }
    return s;
  };
  let best = score(order);
  const rng = createRng(`${rotationSeed}:rotation`);
  const steps = Math.min(4000, 60 * order.length);
  for (let s = 0; s < steps && best > 0; s++) {
    const i = Math.floor(rng() * order.length);
    const j = Math.floor(rng() * order.length);
    if (i === j) continue;
    [order[i], order[j]] = [order[j], order[i]];
    const next = score(order);
    // Level moves too, so the climb can cross a flat stretch.
    if (next <= best) best = next;
    else [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * The rotation for pair round `round` (0-based): the circle method over
 * the series' order, mapped onto the seats (a trio's extra person joins
 * pair 0; with a sit-out seat, the one with the bye sits out). `pairs` are
 * the twos the rotation makes, which the mix keeps unless a rule or a
 * repeat says otherwise. Null when the seats don't fit pairs.
 */
function rotationStart(
  people: readonly MixPerson[],
  sizes: readonly number[],
  sitOutGroup: number | null,
  round: number,
  rotationSeed: number,
  cost: ((i: number, j: number) => number) | null
): { assign: number[]; pairs: [number, number][] } | null {
  const n = people.length;
  if (n < 2) return null;
  const order = rotationOrder(people, rotationSeed, cost);
  const pairs: [number, number][] = [];
  let lone = -1;
  for (const [a, b] of circlePairs(order, round)) {
    if (a === BYE) lone = b;
    else if (b === BYE) lone = a;
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
  return { assign, pairs };
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
  const pastRounds = Math.max(0, Math.floor(input.round ?? input.history?.length ?? 0));
  // Pairs follow the series' rotation: its order is tuned (once, the same
  // way every round) so the first rounds pair people of different roles or
  // skills and keep a keep-apart pair for late, and each rotation pair gets
  // a bonus that balance can't outweigh, so the series keeps its new pairs.
  let start: number[] | null = null;
  if (mode === "pairs") {
    const apart = new Set(placed.filter((r) => r.kind === "apart").map((r) => r.i * n + r.j));
    const orderCost =
      balance !== "none" || apart.size > 0
        ? (i: number, j: number) =>
            BALANCE_COST * sharedTraits(traits[i], traits[j]) +
            (apart.has(i * n + j) || apart.has(j * n + i) ? RULE_COST : 0)
        : null;
    const rotation = rotationStart(
      people,
      sizes,
      sitOutGroup,
      pastRounds,
      input.rotationSeed ?? input.seed,
      orderCost
    );
    if (rotation) {
      start = rotation.assign;
      for (const [a, b] of rotation.pairs) {
        pair[a * n + b] -= ROTATION_COST;
        pair[b * n + a] -= ROTATION_COST;
      }
    }
  }
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

  const report = reportOn({
    people,
    mode,
    groupSeats,
    outSeats,
    placed,
    skipped,
    history,
    balance,
    traits,
    thisRound: pastRounds + 1,
  });
  const issues = report.issues;
  if (found.timedOut && (report.broken > 0 || report.repeats > 0)) {
    issues.push({ kind: "search", text: searchNote(input.timeLimitMs ?? MIX_TIME_LIMIT_MS) });
  }

  return {
    ok: true,
    groups: groupSeats.map((g) => g.map((i) => people[i].name)),
    sitOut: outSeats.map((i) => people[i].name),
    issues: issues.slice(0, MIXER_LIMITS.issues),
    repeats: report.repeats,
    broken: report.broken,
    timedOut: found.timedOut,
  };
}

/** What a mix's report is worked out from: the groups as places in `people`. */
interface ReportParts {
  people: readonly MixPerson[];
  mode: "groups" | "pairs";
  groupSeats: readonly (readonly number[])[];
  outSeats: readonly number[];
  placed: readonly PlacedRule[];
  skipped: readonly MixIssue[];
  history: MetHistory;
  balance: Balance;
  traits: readonly (readonly string[])[];
  /** This round's place in the series, from 1. */
  thisRound: number;
}

export interface MixReport {
  /** Broken rules first, then repeats, sit-outs, balance and skipped rules. */
  issues: MixIssue[];
  repeats: number;
  broken: number;
}

/** The plain-words report on groups as they stand (see the file header). */
function reportOn(p: ReportParts): MixReport {
  const { people, mode, groupSeats, outSeats, placed, history, balance, traits } = p;
  const n = people.length;
  const groupOf = new Map<number, number>();
  groupSeats.forEach((g, gi) => g.forEach((i) => groupOf.set(i, gi)));
  const label = (g: number) => groupLabel(mode, g);

  const issues: MixIssue[] = [];
  let broken = 0;
  const maxSize = Math.max(0, ...groupSeats.map((g) => g.length));
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
    const thisRound = p.thisRound;
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
  issues.push(...p.skipped);
  return { issues, repeats: again.length, broken };
}

export interface ReportInput {
  /** Everyone in the round, with their role and skills. */
  people: readonly MixPerson[];
  mode: "groups" | "pairs";
  /** The groups, by name. */
  groups: readonly (readonly string[])[];
  sitOut?: readonly string[];
  balance?: Balance;
  rules?: readonly MixRuleInput[];
  /** The rounds before this one, oldest first. */
  history?: readonly PastRound[];
  /** This round's place in the series, from 0. Default: how many rounds the history holds. */
  round?: number;
}

/**
 * The report on groups as they now stand, after the facilitator moved
 * someone: the same lines a mix gives (broken rules, pairs who meet again,
 * who sits out, balance, rules left out), worked out afresh, so none of
 * them describes the groups as they were.
 */
export function reportGroups(input: ReportInput): MixReport {
  const named = [...input.groups.flat(), ...(input.sitOut ?? [])].map((name) => ({ name }));
  const people = uniquePeople([...input.people, ...named], Number.MAX_SAFE_INTEGER);
  const at = new Map(people.map((p, i) => [nameKey(p.name), i] as const));
  const seatsOf = (names: readonly string[]) =>
    names.map((name) => at.get(nameKey(name))).filter((i): i is number => i !== undefined);
  const balance = input.balance ?? "none";
  const { placed, skipped } = placeRules(people, input.rules ?? []);
  const report = reportOn({
    people,
    mode: input.mode,
    groupSeats: input.groups.map(seatsOf).filter((g) => g.length > 0),
    outSeats: seatsOf(input.sitOut ?? []),
    placed,
    skipped,
    history: metHistory(input.history ?? []),
    balance,
    traits: traitsOf(people, balance),
    thisRound: (input.round ?? input.history?.length ?? 0) + 1,
  });
  return { ...report, issues: report.issues.slice(0, MIXER_LIMITS.issues) };
}

/** The note when the time limit cut the search short. */
export function searchNote(limitMs: number): string {
  const seconds = Math.max(0.1, Math.round(limitMs / 100) / 10);
  return `Team Mixer stopped looking after ${seconds} seconds and kept the best mix it found.`;
}
