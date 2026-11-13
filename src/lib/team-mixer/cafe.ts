/**
 * World Café: a few tables, each with a host who stays all session, and
 * rounds in which everyone else moves to a new table. Each round is mixed
 * so people visit tables they haven't been to and sit with people they
 * haven't sat with yet, keeping the facilitator's rules and the balance
 * asked for; the plan says who goes where in every round, and names any
 * table someone visits twice and any rule it had to break, in plain words.
 *
 * Seeded through src/lib/utils/random.ts. Pure and server-safe.
 */

import { createRng, shuffle } from "@/lib/utils/random";
import {
  MIXER_LIMITS,
  groupLabel,
  groupSizes,
  listNames,
  nameKey,
  pairKey,
  plural,
  uniquePeople,
  type Balance,
  type MixIssue,
  type MixPerson,
  type MixRuleInput,
} from "./model";
import { MIX_TIME_LIMIT_MS, searchNote } from "./mix";
import { searchPartition } from "./search";
import {
  BALANCE_COST,
  RECENT_COST,
  REPEAT_COST,
  RULE_COST,
  noTraitsIssue,
  pairList,
  placeRules,
  sharedTraits,
  traitsOf,
} from "./weights";

/** A visit to a table already visited: as costly as meeting someone again. */
const REVISIT_COST = 2 * REPEAT_COST;

export interface CafeInput {
  people: readonly MixPerson[];
  tables: number;
  rounds: number;
  /** The host of each table, by name; blank or unknown: picked at random. */
  hosts?: readonly (string | null | undefined)[];
  balance?: Balance;
  rules?: readonly MixRuleInput[];
  seed: number;
  /** For the whole plan, shared out over the rounds. */
  timeLimitMs?: number;
  maxKicks?: number;
  now?: () => number;
}

/** One table in one round: its host, who stays, and the guests who come to it. */
export interface CafeTablePlan {
  host: string;
  guests: string[];
}

export interface CafeResult {
  /** The host of each table. */
  hosts: string[];
  /** Round by round, table by table. */
  rounds: CafeTablePlan[][];
  issues: MixIssue[];
  timedOut: boolean;
}

export type CafeOutcome = ({ ok: true } & CafeResult) | { ok: false; error: string };

/** Why these people can't sit a café like this, in plain words, or null. */
export function cafeProblem(people: number, tables: number, rounds: number): string | null {
  if (!Number.isInteger(tables) || tables < 2) return "A World Café needs at least 2 tables.";
  if (tables > MIXER_LIMITS.tables) {
    return `Team Mixer plans up to ${MIXER_LIMITS.tables} tables.`;
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MIXER_LIMITS.cafeRounds) {
    return `Plan between 1 and ${MIXER_LIMITS.cafeRounds} rounds.`;
  }
  if (people > MIXER_LIMITS.people) {
    return `Team Mixer mixes up to ${MIXER_LIMITS.people} people at a time.`;
  }
  if (people < tables * 2) {
    return `${tables} tables need at least ${tables * 2} people: a host and a guest at each.`;
  }
  return null;
}

/** Each person's table in every round, by name: "who goes where". */
export function cafeMoves(plan: Pick<CafeResult, "hosts" | "rounds">): Map<string, number[]> {
  const moves = new Map<string, number[]>();
  plan.hosts.forEach((host, t) =>
    moves.set(
      host,
      plan.rounds.map(() => t)
    )
  );
  plan.rounds.forEach((round, r) => {
    round.forEach((table, t) => {
      for (const guest of table.guests) {
        const row = moves.get(guest) ?? plan.rounds.map(() => -1);
        row[r] = t;
        moves.set(guest, row);
      }
    });
  });
  return moves;
}

/** Plan a café (see the file header). */
export function planCafe(input: CafeInput): CafeOutcome {
  const people = uniquePeople(input.people);
  const tables = Math.floor(input.tables);
  const roundsWanted = Math.floor(input.rounds);
  const problem = cafeProblem(people.length, tables, roundsWanted);
  if (problem) return { ok: false, error: problem };
  const balance: Balance = input.balance ?? "none";
  const rng = createRng(input.seed);
  const issues: MixIssue[] = [];

  // ── Hosts: the ones named (once each, if they're here), the rest at random.
  const byKey = new Map(people.map((p, i) => [nameKey(p.name), i] as const));
  const hostOf: number[] = new Array<number>(tables).fill(-1);
  const taken = new Set<number>();
  (input.hosts ?? []).slice(0, tables).forEach((raw, t) => {
    const name = (raw ?? "").trim();
    if (!name) return;
    const i = byKey.get(nameKey(name));
    if (i === undefined) {
      issues.push({
        kind: "skipped",
        text: `${name} isn't in the mix, so ${groupLabel("cafe", t)} got a host at random.`,
      });
      return;
    }
    if (taken.has(i)) {
      issues.push({
        kind: "skipped",
        text: `${people[i].name} already hosts a table, so ${groupLabel("cafe", t)} got a host at random.`,
      });
      return;
    }
    hostOf[t] = i;
    taken.add(i);
  });
  const spare = shuffle(
    people.map((_, i) => i).filter((i) => !taken.has(i)),
    rng
  );
  for (let t = 0; t < tables; t++) {
    if (hostOf[t] === -1) {
      hostOf[t] = spare.shift()!;
      taken.add(hostOf[t]);
    }
  }
  const guests = people.map((_, i) => i).filter((i) => !taken.has(i));
  const g = guests.length;
  const guestAt = new Map(guests.map((i, x) => [i, x] as const));

  // ── Costs that stay the same every round.
  const { placed, skipped } = placeRules(people, input.rules ?? []);
  const traits = traitsOf(people, balance);
  const ruleCost = new Map<string, number>();
  for (const r of placed)
    ruleCost.set(`${r.i}:${r.j}`, r.kind === "apart" ? RULE_COST : -RULE_COST);
  const ruleBetween = (x: number, y: number) =>
    (ruleCost.get(`${x}:${y}`) ?? 0) + (ruleCost.get(`${y}:${x}`) ?? 0);
  const hostAt = new Map(hostOf.map((h, t) => [h, t] as const));
  for (const r of placed) {
    if (r.kind === "together" && hostAt.has(r.i) && hostAt.has(r.j)) {
      issues.push({
        kind: "together",
        text: `${r.a} and ${r.b} both host a table, so they can't sit together.`,
      });
    }
  }

  // ── Round by round.
  const met = new Map<string, number>();
  let lastMet = new Set<string>();
  const visited: number[][] = guests.map(() => new Array<number>(tables).fill(0));
  const plan: CafeTablePlan[][] = [];
  const perRound = Math.max(1, Math.floor((input.timeLimitMs ?? MIX_TIME_LIMIT_MS) / roundsWanted));
  let timedOut = false;
  const sizes = groupSizes(g, { by: "count", n: tables });

  for (let round = 0; round < roundsWanted; round++) {
    const pair = new Float64Array(g * g);
    for (let x = 0; x < g; x++) {
      for (let y = x + 1; y < g; y++) {
        const a = guests[x];
        const b = guests[y];
        const key = pairKey(people[a].name, people[b].name);
        const w =
          (met.get(key) ?? 0) * REPEAT_COST +
          (lastMet.has(key) ? RECENT_COST : 0) +
          BALANCE_COST * sharedTraits(traits[a], traits[b]) +
          ruleBetween(a, b);
        pair[x * g + y] = w;
        pair[y * g + x] = w;
      }
    }
    const unary = new Float64Array(g * tables);
    for (let x = 0; x < g; x++) {
      for (let t = 0; t < tables; t++) {
        const host = hostOf[t];
        unary[x * tables + t] =
          visited[x][t] * REVISIT_COST +
          BALANCE_COST * sharedTraits(traits[guests[x]], traits[host]) +
          ruleBetween(guests[x], host);
      }
    }
    const found = searchPartition(
      { n: g, sizes, pair, unary },
      { rng, timeLimitMs: perRound, maxKicks: input.maxKicks, now: input.now }
    );
    if (found.timedOut) timedOut = true;

    const seated: number[][] = hostOf.map(() => []);
    found.assign.forEach((t, x) => seated[t].push(guests[x]));
    plan.push(
      seated.map((list, t) => ({
        host: people[hostOf[t]].name,
        guests: list.map((i) => people[i].name),
      }))
    );

    // What this round leaves behind for the next.
    const here = new Set<string>();
    seated.forEach((list, t) => {
      list.forEach((i) => visited[guestAt.get(i)!][t]++);
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const key = pairKey(people[list[x]].name, people[list[y]].name);
          here.add(key);
          met.set(key, (met.get(key) ?? 0) + 1);
        }
      }
    });
    lastMet = here;

    // Rules, as this round seated them (hosts included).
    const tableOf = new Map<number, number>();
    seated.forEach((list, t) => {
      tableOf.set(hostOf[t], t);
      list.forEach((i) => tableOf.set(i, t));
    });
    const when = roundsWanted > 1 ? `In round ${round + 1}, ` : "";
    for (const r of placed) {
      const ti = tableOf.get(r.i);
      const tj = tableOf.get(r.j);
      if (r.kind === "apart" && ti === tj && ti !== undefined) {
        issues.push({
          kind: "apart",
          text: `${when}${r.a} and ${r.b} share ${groupLabel("cafe", ti)}, though they should be kept apart.`,
        });
      } else if (r.kind === "together" && ti !== tj && !(hostAt.has(r.i) && hostAt.has(r.j))) {
        issues.push({
          kind: "together",
          text: `${when}${r.a} and ${r.b} are at different tables, though they should be together.`,
        });
      }
    }
  }

  // ── Tables visited twice, and guests who sit together again.
  if (roundsWanted > tables) {
    issues.push({
      kind: "revisit",
      text: `With ${plural(tables, "table")} and ${plural(roundsWanted, "round")}, everyone visits a table more than once.`,
    });
  } else {
    const twice = guests
      .map((i, x) => ({ name: people[i].name, t: visited[x].findIndex((v) => v > 1) }))
      .filter((v) => v.t >= 0);
    if (twice.length > 0) {
      const shown = twice.slice(0, 3).map((v) => `${v.name} (${groupLabel("cafe", v.t)})`);
      const more = twice.length - shown.length;
      issues.push({
        kind: "revisit",
        text: `${more > 0 ? `${shown.join(", ")} and ${plural(more, "other")}` : listNames(shown)} ${
          twice.length === 1 ? "visits a table" : "visit a table"
        } twice.`,
      });
    }
  }
  const again: [string, string][] = [];
  met.forEach((times, key) => {
    if (times < 2) return;
    const [a, b] = key.split("\u0000");
    const na = people[byKey.get(a)!].name;
    const nb = people[byKey.get(b)!].name;
    again.push([na, nb]);
  });
  if (again.length > 0) {
    issues.push({
      kind: "repeat",
      text: `${plural(again.length, "pair")} of guests ${
        again.length === 1 ? "shares" : "share"
      } a table in more than one round: ${pairList(again)}.`,
    });
  }

  const noTraits = noTraitsIssue(people, balance, traits);
  if (noTraits) issues.push(noTraits);
  issues.push(...skipped);
  const broken = issues.some((i) => i.kind === "apart" || i.kind === "together");
  if (timedOut && (broken || again.length > 0)) {
    issues.push({ kind: "search", text: searchNote(input.timeLimitMs ?? MIX_TIME_LIMIT_MS) });
  }

  return {
    ok: true,
    hosts: hostOf.map((i) => people[i].name),
    rounds: plan,
    issues: issues.slice(0, MIXER_LIMITS.issues),
    timedOut,
  };
}
