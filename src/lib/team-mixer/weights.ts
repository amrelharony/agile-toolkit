/**
 * The costs a mix is searched against (search.ts), built from the people,
 * the rules, the balance asked for and who met before. The weights are far
 * apart, so they rank: the rules first, then fresh company, then balance.
 *
 * Pure and server-safe.
 */

import {
  listNames,
  nameKey,
  pairKey,
  plural,
  traitKey,
  type Balance,
  type MixIssue,
  type MixPerson,
  type MixRuleInput,
  type PastRound,
  type RuleKind,
} from "./model";

/** A broken keep-apart or keep-together rule. */
export const RULE_COST = 1e8;
/** Each earlier time two people shared a group. */
export const REPEAT_COST = 1e4;
/** On top, when that time was the round just before. */
export const RECENT_COST = 5e3;
/**
 * Pairs: the bonus (a negative cost) for two people the series' rotation
 * pairs this round. Far above what balance can gain by pulling a pair apart
 * (a person brings at most MAX_TRAITS traits), so balance never breaks the
 * rotation, and below a repeat, so a rotation pair who already met (when
 * the people changed mid-series) still gives way to fresh company.
 */
export const ROTATION_COST = 1e3;
/** Each shared role, or each shared skill, inside a group. */
export const BALANCE_COST = 1;
/** The most traits (skills) one person brings to the balance. */
export const MAX_TRAITS = 20;

/** A rule between two people of the mix, by their place in it. */
export interface PlacedRule {
  kind: RuleKind;
  i: number;
  j: number;
  a: string;
  b: string;
}

/**
 * The rules that apply to these people (both are in the mix), each pair
 * once (the first rule for a pair wins), and a "skipped" line for a rule
 * that names one person who is here and one who isn't.
 */
export function placeRules(
  people: readonly MixPerson[],
  rules: readonly MixRuleInput[]
): { placed: PlacedRule[]; skipped: MixIssue[] } {
  const at = new Map(people.map((p, i) => [nameKey(p.name), i] as const));
  const seen = new Set<string>();
  const placed: PlacedRule[] = [];
  const skipped: MixIssue[] = [];
  for (const r of rules) {
    const ka = nameKey(r.a);
    const kb = nameKey(r.b);
    if (!ka || !kb || ka === kb) continue;
    const key = pairKey(r.a, r.b);
    if (seen.has(key)) continue;
    seen.add(key);
    const i = at.get(ka);
    const j = at.get(kb);
    if (i === undefined || j === undefined) {
      if (i === undefined && j === undefined) continue;
      const missing = i === undefined ? r.a.trim() : r.b.trim();
      skipped.push({
        kind: "skipped",
        text: `${ruleText(r)} was left out: ${missing} isn't in the mix.`,
      });
      continue;
    }
    placed.push({ kind: r.kind, i, j, a: people[i].name, b: people[j].name });
  }
  return { placed, skipped };
}

/** "Keep Ana and Bo apart" / "Keep Ana and Bo together". */
export function ruleText(r: { kind: RuleKind; a: string; b: string }): string {
  return `Keep ${r.a.trim()} and ${r.b.trim()} ${r.kind === "apart" ? "apart" : "together"}`;
}

/** Who met whom in earlier rounds: how often, and who met in the round just before. */
export interface MetHistory {
  count: Map<string, number>;
  last: Set<string>;
  /** Sit-outs per person (by name key), and who sat out in the round just before. */
  satOut: Map<string, number>;
  satOutLast: Set<string>;
}

export function metHistory(rounds: readonly PastRound[]): MetHistory {
  const count = new Map<string, number>();
  const satOut = new Map<string, number>();
  let last = new Set<string>();
  let satOutLast = new Set<string>();
  rounds.forEach((round, r) => {
    const isLast = r === rounds.length - 1;
    const here = new Set<string>();
    for (const group of round.groups) {
      for (let x = 0; x < group.length; x++) {
        for (let y = x + 1; y < group.length; y++) {
          const key = pairKey(group[x], group[y]);
          if (here.has(key)) continue;
          here.add(key);
          count.set(key, (count.get(key) ?? 0) + 1);
        }
      }
    }
    const out = new Set((round.sitOut ?? []).map(nameKey).filter(Boolean));
    out.forEach((k) => satOut.set(k, (satOut.get(k) ?? 0) + 1));
    if (isLast) {
      last = here;
      satOutLast = out;
    }
  });
  return { count, last, satOut, satOutLast };
}

/** The cost of two people sharing a group again, from the history. */
export function repeatCost(history: MetHistory, a: string, b: string): number {
  const key = pairKey(a, b);
  const times = history.count.get(key) ?? 0;
  return times * REPEAT_COST + (history.last.has(key) ? RECENT_COST : 0);
}

/** Each person's balance traits as keys: their role, or their skills; none when not balancing. */
export function traitsOf(people: readonly MixPerson[], balance: Balance): string[][] {
  return people.map((p) => {
    if (balance === "role") {
      const role = traitKey(p.role);
      return role ? [role] : [];
    }
    if (balance === "skill") {
      return Array.from(new Set((p.skills ?? []).map(traitKey).filter(Boolean))).slice(
        0,
        MAX_TRAITS
      );
    }
    return [];
  });
}

/** How many traits two people share. */
export function sharedTraits(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let n = 0;
  for (const t of a) if (b.includes(t)) n++;
  return n;
}

/** A trait's display spelling: the first person's, as typed. */
export function traitNames(people: readonly MixPerson[], balance: Balance): Map<string, string> {
  const names = new Map<string, string>();
  for (const p of people) {
    const raw = balance === "role" ? (p.role ? [p.role] : []) : (p.skills ?? []);
    for (const t of raw) {
      const key = traitKey(t);
      if (key && !names.has(key)) names.set(key, t.trim());
    }
  }
  return names;
}

/** The note when balancing was asked for but nobody has the trait. */
export function noTraitsIssue(
  people: readonly MixPerson[],
  balance: Balance,
  traits: readonly (readonly string[])[]
): MixIssue | null {
  if (balance === "none" || people.length === 0) return null;
  if (traits.some((t) => t.length > 0)) return null;
  return {
    kind: "balance",
    text:
      balance === "role"
        ? "Nobody in the mix has a role on the Team page, so roles couldn't be balanced."
        : "Nobody in the mix has skills on the Team page, so skills couldn't be balanced.",
  };
}

/**
 * Lines for the groups that missed an even share: a role crowded into one
 * group, or a skill that enough people hold missing from a group.
 */
export function balanceIssues(
  people: readonly MixPerson[],
  balance: Balance,
  groups: readonly (readonly number[])[],
  label: (g: number) => string,
  max = 3
): MixIssue[] {
  if (balance === "none" || groups.length < 2) return [];
  const traits = traitsOf(people, balance);
  const names = traitNames(people, balance);
  const holders = new Map<string, number>();
  traits.forEach((ts) => ts.forEach((t) => holders.set(t, (holders.get(t) ?? 0) + 1)));
  const out: MixIssue[] = [];
  for (const [trait, total] of Array.from(holders.entries())) {
    if (out.length >= max) break;
    const name = names.get(trait) ?? trait;
    const per = groups.map((g) => g.filter((i) => traits[i].includes(trait)).length);
    if (balance === "role") {
      if (total < 2) continue;
      const fair = Math.ceil(total / groups.length);
      const crowded = per.findIndex((c) => c > fair);
      if (crowded >= 0) {
        out.push({
          kind: "balance",
          text: `${name} isn't spread evenly: ${label(crowded)} has ${per[crowded]} of the ${total}.`,
        });
      }
    } else if (total >= groups.length) {
      const missing = per.map((c, g) => (c === 0 ? g : -1)).filter((g) => g >= 0);
      if (missing.length > 0) {
        out.push({
          kind: "balance",
          text: `Nobody in ${listNames(missing.map(label))} has ${name}.`,
        });
      }
    }
  }
  return out;
}

/** "Ana with Bo", "Ana with Bo, Cy with Dee and 2 more pairs": up to `max` pairs by name. */
export function pairList(pairs: readonly (readonly [string, string])[], max = 3): string {
  const shown = pairs.slice(0, max).map(([a, b]) => `${a} with ${b}`);
  const more = pairs.length - shown.length;
  return more <= 0 ? listNames(shown) : `${shown.join(", ")} and ${plural(more, "more pair")}`;
}
