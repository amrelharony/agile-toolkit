/**
 * Team Mixer's changes, as pure functions from one state to the next: the
 * page and Amr's actions make the same mix the same way. Each takes the
 * state as `normalizeMixerState` gives it and returns a new one; nothing is
 * written here.
 *
 * Pure and server-safe (ids from nanoid, seeds from src/lib/utils/random.ts).
 */

import { nanoid } from "nanoid";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { findRosterMember } from "@/lib/team/names";
import { createRng } from "@/lib/utils/random";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { cafeProblem, planCafe } from "./cafe";
import { mixGroups, mixProblem, reportGroups } from "./mix";
import {
  MIXER_LIMITS,
  groupSizes,
  nameKey,
  pairKey,
  type MixPerson,
  type PastRound,
  type RuleKind,
  type SplitSpec,
} from "./model";
import {
  cleanLine,
  type MixerCafe,
  type MixerRound,
  type MixerRule,
  type MixerState,
} from "./state";

/** A fresh 32-bit seed. */
export function freshSeed(): number {
  return Math.floor(createRng()() * 4294967296) >>> 0;
}

/** People by name, with their role and skills from the roster when they're on it. */
export function withTraits(names: readonly string[], roster: readonly TeamMember[]): MixPerson[] {
  return names.map((name) => {
    const m = findRosterMember(roster, name);
    const role = m?.role?.trim();
    const skills = (m?.skills ?? []).map((s) => s.trim()).filter(Boolean);
    return {
      name,
      ...(role ? { role } : {}),
      ...(skills.length > 0 ? { skills } : {}),
    };
  });
}

/** The people in the mix, with their role and skills from the roster when they're on it. */
export function mixPeople(state: MixerState, roster: readonly TeamMember[]): MixPerson[] {
  return withTraits(
    state.people.map((p) => p.name),
    roster
  );
}

/** The current split. */
export function splitOf(state: MixerState): SplitSpec {
  return state.split === "count" ? { by: "count", n: state.count } : { by: "size", n: state.size };
}

/** The rounds as the mix reads them: who sat together, and who sat out. */
export function pastRounds(state: MixerState): PastRound[] {
  return state.rounds.map((r) => ({ groups: r.groups.map((g) => g.people), sitOut: r.sitOut }));
}

/** Why the current settings can't be mixed, in plain words, or null. */
export function settingsProblem(state: MixerState): string | null {
  const n = state.people.length;
  if (state.mode === "cafe") return cafeProblem(n, state.tables, state.cafeRounds);
  return mixProblem(n, state.mode, state.mode === "groups" ? splitOf(state) : undefined);
}

/** A plain line on the groups the settings will make: "3 groups: 4, 4 and 3 people." */
export function settingsPreview(state: MixerState): string | null {
  const n = state.people.length;
  if (n < 2) return null;
  if (state.mode === "pairs") {
    const pairs = Math.floor(n / 2);
    if (n % 2 === 0) return `${pairs} pairs.`;
    if (state.odd === "sit-out") {
      return `${pairs} ${pairs === 1 ? "pair" : "pairs"}, and 1 person sits out each round.`;
    }
    const twos = pairs - 1;
    return twos > 0
      ? `${twos} ${twos === 1 ? "pair" : "pairs"} and a group of 3.`
      : "A group of 3.";
  }
  if (state.mode === "cafe") {
    if (cafeProblem(n, state.tables, state.cafeRounds)) return null;
    const guests = n - state.tables;
    const sizes = groupSizes(guests, { by: "count", n: state.tables });
    const lo = Math.min(...sizes);
    const hi = Math.max(...sizes);
    return `${state.tables} tables, each with a host and ${lo === hi ? lo : `${lo} or ${hi}`} ${
      hi === 1 ? "guest" : "guests"
    }, over ${state.cafeRounds} ${state.cafeRounds === 1 ? "round" : "rounds"}.`;
  }
  const sizes = groupSizes(n, splitOf(state));
  const counts = Array.from(new Set(sizes)).sort((a, b) => b - a);
  return `${sizes.length} ${sizes.length === 1 ? "group" : "groups"} of ${counts.join(" or ")}.`;
}

/**
 * Pairs: what the rotation can promise with these people and rules, in one
 * line. Everyone meets everyone before anyone pairs twice with an even
 * number (or one sitting out each round) and no rule between two of them;
 * a group of 3, or a rule, means some meet again sooner.
 */
export function rotationNote(state: MixerState): string {
  const here = new Set(state.people.map((p) => nameKey(p.name)));
  const ruled = state.rules.some((r) => here.has(nameKey(r.a)) && here.has(nameKey(r.b)));
  const trio = state.people.length % 2 === 1 && state.odd === "trio";
  if (!ruled && !trio) {
    return "Each round pairs people who haven't paired yet: everyone meets everyone before anyone pairs twice.";
  }
  const why =
    trio && ruled ? "the group of 3 and the rules" : trio ? "the group of 3" : "the rules";
  return `Each round pairs people who haven't paired yet as far as it can, but with ${why}, some meet again sooner.`;
}

export interface MixOptions {
  seed?: number;
  /** When the mix happens. Default now. */
  now?: Date;
  timeLimitMs?: number;
  maxKicks?: number;
  /** The id of the new round or plan. Default a new one. */
  id?: string;
  clock?: () => number;
}

export type MixStep =
  | { ok: true; state: MixerState; round: MixerRound; cafe?: undefined }
  | { ok: true; state: MixerState; cafe: MixerCafe; round?: undefined }
  | { ok: false; error: string };

/**
 * Mix with the current settings: a new round of groups or pairs (it avoids
 * the pairings of the rounds before), or a new World Café plan.
 */
export function mixNow(
  state: MixerState,
  roster: readonly TeamMember[],
  opts: MixOptions = {}
): MixStep {
  const problem = settingsProblem(state);
  if (problem) return { ok: false, error: problem };
  const seed = opts.seed ?? freshSeed();
  const at = (opts.now ?? new Date()).toISOString();
  const people = mixPeople(state, roster);
  const title = state.title || undefined;

  if (state.mode === "cafe") {
    const plan = planCafe({
      people,
      tables: state.tables,
      rounds: state.cafeRounds,
      hosts: state.hosts,
      balance: state.balance,
      rules: state.rules,
      seed,
      timeLimitMs: opts.timeLimitMs,
      maxKicks: opts.maxKicks,
      now: opts.clock,
    });
    if (!plan.ok) return { ok: false, error: plan.error };
    const cafe: MixerCafe = {
      id: opts.id ?? `cafe_${nanoid(10)}`,
      at,
      ...(title ? { title } : {}),
      seed,
      balance: state.balance,
      rounds: plan.rounds.map((round) => round.map((t) => ({ host: t.host, guests: t.guests }))),
      issues: plan.issues,
      current: 0,
    };
    return { ok: true, state: { ...state, cafe }, cafe };
  }

  const seriesSeed = state.seriesSeed || seed;
  const number = state.seriesRound + 1;
  const mixed = mixGroups({
    people,
    mode: state.mode,
    split: splitOf(state),
    odd: state.odd,
    balance: state.balance,
    rules: state.rules,
    history: pastRounds(state),
    round: state.seriesRound,
    seed,
    rotationSeed: seriesSeed,
    timeLimitMs: opts.timeLimitMs,
    maxKicks: opts.maxKicks,
    now: opts.clock,
  });
  if (!mixed.ok) return { ok: false, error: mixed.error };
  const round: MixerRound = {
    id: opts.id ?? `round_${nanoid(10)}`,
    number,
    at,
    mode: state.mode,
    ...(title ? { title } : {}),
    seed,
    balance: state.balance,
    groups: mixed.groups.map((people) => ({ people })),
    sitOut: mixed.sitOut,
    issues: mixed.issues,
  };
  return {
    ok: true,
    state: {
      ...state,
      seriesSeed,
      seriesRound: number,
      rounds: [...state.rounds, round].slice(-MIXER_LIMITS.rounds),
    },
    round,
  };
}

/** The café plan on screen at round `index` (from 0), within the plan. */
export function showCafeRound(state: MixerState, index: number): MixerState {
  if (!state.cafe) return state;
  const current = Math.max(0, Math.min(state.cafe.rounds.length - 1, Math.floor(index)));
  return { ...state, cafe: { ...state.cafe, current } };
}

/** Add people by name (each once, roster spelling first), up to the limit. */
export function addPeople(
  state: MixerState,
  names: readonly string[],
  roster: readonly TeamMember[] = [],
  newId: () => string = () => `person_${nanoid(10)}`
): { state: MixerState; added: string[]; full: boolean } {
  const have = new Set(state.people.map((p) => nameKey(p.name)));
  const people = state.people.slice();
  const added: string[] = [];
  let full = false;
  for (const raw of names) {
    const typed = cleanLine(raw, MIXER_LIMITS.name);
    const name = findRosterMember(roster, typed)?.name.trim() || typed;
    const key = nameKey(name);
    if (!key || have.has(key)) continue;
    if (people.length >= MIXER_LIMITS.people) {
      full = true;
      break;
    }
    have.add(key);
    people.push({ id: newId(), name: cleanLine(name, MIXER_LIMITS.name) });
    added.push(name);
  }
  return { state: { ...state, people }, added, full };
}

/** Names from pasted text: one per line, or separated by commas or semicolons. */
export function parseNames(text: string): string[] {
  return text
    .split(/[\n\r,;]+/)
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter(Boolean);
}

/** The people again, without `ids`. */
export function removePeople(state: MixerState, ids: readonly string[]): MixerState {
  const drop = new Set(ids);
  return { ...state, people: state.people.filter((p) => !drop.has(p.id)) };
}

export interface RuleDraft {
  kind: RuleKind;
  a: string;
  b: string;
}

export const EMPTY_RULE: RuleDraft = { kind: "apart", a: "", b: "" };

/** A rule as typed, checked: two different people, a pair with no rule yet, room for it. */
export function validateRule(
  draft: RuleDraft,
  rules: readonly MixerRule[]
): Validation<RuleDraft, "a" | "b"> {
  const a = cleanLine(draft.a, MIXER_LIMITS.name);
  const b = cleanLine(draft.b, MIXER_LIMITS.name);
  const errors: FormErrors<"a" | "b"> = {};
  if (!a) errors.a = "Name the first person.";
  if (!b) errors.b = "Name the second person.";
  if (a && b && nameKey(a) === nameKey(b)) errors.b = "Pick two different people.";
  if (a && b && !errors.b) {
    const key = pairKey(a, b);
    const existing = rules.find((r) => pairKey(r.a, r.b) === key);
    if (existing) {
      errors.b = `There's already a rule for ${existing.a} and ${existing.b}.`;
    } else if (rules.length >= MIXER_LIMITS.rules) {
      errors.b = `Team Mixer keeps up to ${MIXER_LIMITS.rules} rules. Remove one first.`;
    }
  }
  if (errors.a || errors.b) return { ok: false, errors };
  return { ok: true, values: { kind: draft.kind === "together" ? "together" : "apart", a, b } };
}

/** The state with `rule` added (checked by validateRule first). */
export function addRule(
  state: MixerState,
  rule: RuleDraft,
  id: string = `rule_${nanoid(10)}`
): { ok: true; state: MixerState; rule: MixerRule } | { ok: false; error: string } {
  const checked = validateRule(rule, state.rules);
  if (!checked.ok) {
    return { ok: false, error: checked.errors.a ?? checked.errors.b ?? "Check the rule." };
  }
  const added: MixerRule = { id, ...checked.values };
  return { ok: true, state: { ...state, rules: [...state.rules, added] }, rule: added };
}

/**
 * Move a person to another group of a saved round (the facilitator's own
 * swap after a mix). Unchanged when the round, the person or the group
 * isn't there, or the person is already in it; a group left empty goes.
 * The round's report is worked out again for the groups as they now stand
 * (the rules, the rounds before it, who sits out and the balance, with
 * roles and skills from `roster`), so it never describes the old groups.
 */
export function movePerson(
  state: MixerState,
  roundId: string,
  name: string,
  toGroup: number,
  roster: readonly TeamMember[] = []
): MixerState {
  const at = state.rounds.findIndex((r) => r.id === roundId);
  if (at < 0) return state;
  const round = state.rounds[at];
  const key = nameKey(name);
  const from = round.groups.findIndex((g) => g.people.some((p) => nameKey(p) === key));
  const inSitOut = round.sitOut.some((p) => nameKey(p) === key);
  if ((from < 0 && !inSitOut) || toGroup < 0 || toGroup >= round.groups.length) return state;
  if (from === toGroup) return state;
  const person =
    from >= 0
      ? round.groups[from].people.find((p) => nameKey(p) === key)!
      : round.sitOut.find((p) => nameKey(p) === key)!;
  const groups = round.groups.map((g, i) => ({
    ...g,
    people: i === toGroup ? [...g.people, person] : g.people.filter((p) => nameKey(p) !== key),
  }));
  const kept = groups.filter((g) => g.people.length > 0);
  const sitOut = round.sitOut.filter((p) => nameKey(p) !== key);
  const everyone = [...kept.flatMap((g) => g.people), ...sitOut];
  const report = reportGroups({
    people: withTraits(everyone, roster),
    mode: round.mode,
    groups: kept.map((g) => g.people),
    sitOut,
    balance: round.balance,
    rules: state.rules,
    history: pastRounds({ ...state, rounds: state.rounds.slice(0, at) }),
    round: round.number - 1,
  });
  const next: MixerRound = { ...round, groups: kept, sitOut, issues: report.issues };
  const rounds = state.rounds.slice();
  rounds[at] = next;
  return { ...state, rounds };
}

/**
 * Give a saved round's groups names, by place: a blank name clears one, and
 * null (or a place past the list) leaves one as it is.
 */
export function nameGroups(
  state: MixerState,
  roundId: string,
  names: readonly (string | null)[]
): MixerState {
  const at = state.rounds.findIndex((r) => r.id === roundId);
  if (at < 0) return state;
  const round = state.rounds[at];
  const groups = round.groups.map((g, i) => {
    const typed = names[i];
    if (typed === null || typed === undefined) return g;
    const name = cleanLine(typed, MIXER_LIMITS.groupName);
    return name ? { name, people: g.people } : { people: g.people };
  });
  const rounds = state.rounds.slice();
  rounds[at] = { ...round, groups };
  return { ...state, rounds };
}

/** The newest round, or null. */
export function latestRound(state: MixerState): MixerRound | null {
  return state.rounds[state.rounds.length - 1] ?? null;
}

/** How many different pairs of people have shared a group, over the saved rounds. */
export function pairingCount(state: MixerState): number {
  const seen = new Set<string>();
  for (const r of state.rounds) {
    for (const g of r.groups) {
      for (let x = 0; x < g.people.length; x++) {
        for (let y = x + 1; y < g.people.length; y++) seen.add(pairKey(g.people[x], g.people[y]));
      }
    }
  }
  return seen.size;
}
