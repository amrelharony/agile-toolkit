/**
 * Team Mixer: the words, shapes and limits every part shares (the mixing
 * search, the World Café plan, the saved state, the page and Amr's actions).
 *
 * People are matched by name everywhere (trimmed, case-insensitive, the
 * same rule the roster uses), so a rule or an earlier round still applies
 * when the same person comes from the Team page one week and a pasted list
 * the next.
 *
 * Pure and server-safe: no React, no browser globals.
 */

import { nameKey } from "@/lib/team/names";

export const MIX_MODES = ["groups", "pairs", "cafe"] as const;
/** Groups of a size or a count; pairs (coffee chats, pair rotation); World Café tables. */
export type MixMode = (typeof MIX_MODES)[number];

export const BALANCES = ["none", "role", "skill"] as const;
/** Spread each role (or each skill) across the groups, or don't. */
export type Balance = (typeof BALANCES)[number];

export const SPLITS = ["size", "count"] as const;
/** Split by group size ("groups of 4") or by number of groups ("5 groups"). */
export type Split = (typeof SPLITS)[number];

export const ODD_POLICIES = ["trio", "sit-out"] as const;
/** Pairs with an odd number of people: one group of three, or one person sits out. */
export type OddPolicy = (typeof ODD_POLICIES)[number];

export const RULE_KINDS = ["apart", "together"] as const;
/** Keep two people in different groups, or in the same one. */
export type RuleKind = (typeof RULE_KINDS)[number];

export const MIXER_LIMITS = {
  /** People in one mix. */
  people: 120,
  /** A person's name. */
  name: 60,
  /** What the groups are for. */
  title: 120,
  /** A group's fun name. */
  groupName: 32,
  /** Keep-apart and keep-together rules. */
  rules: 60,
  /** Saved rounds: the oldest go first. */
  rounds: 40,
  /** Largest group size, and most groups. */
  groupSize: 60,
  groups: 60,
  /** World Café. */
  tables: 20,
  cafeRounds: 8,
  /** Lines in one mix's report. */
  issues: 30,
} as const;

/** A person as the mixer sees them: a name, and from the roster a role and skills. */
export interface MixPerson {
  name: string;
  role?: string;
  skills?: readonly string[];
}

/** A rule between two people, by name. */
export interface MixRuleInput {
  kind: RuleKind;
  a: string;
  b: string;
}

export const ISSUE_KINDS = [
  "apart",
  "together",
  "repeat",
  "revisit",
  "balance",
  "skipped",
  "sit-out",
  "search",
] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

/** One line of a mix's report, in plain words: a broken rule, a repeat, a note. */
export interface MixIssue {
  kind: IssueKind;
  text: string;
}

/** Issue kinds that mean a rule the facilitator set was broken. */
export const BROKEN_KINDS: ReadonlySet<IssueKind> = new Set<IssueKind>(["apart", "together"]);

/** An earlier round: who sat together (by name), and who sat out. */
export interface PastRound {
  groups: readonly (readonly string[])[];
  sitOut?: readonly string[];
}

export { nameKey };

/** The key for a pair of people, the same whichever comes first. */
export function pairKey(a: string, b: string): string {
  const x = nameKey(a);
  const y = nameKey(b);
  return x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`;
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "1 pair", "3 pairs". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "1st", "2nd", "3rd", "4th", … */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** People by name, each once (the first spelling wins), blank names dropped, at most `max`. */
export function uniquePeople<T extends { name: string }>(
  people: readonly T[],
  max: number = MIXER_LIMITS.people
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of people) {
    const key = nameKey(p.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

export interface SplitSpec {
  by: Split;
  /** The group size, or the number of groups. */
  n: number;
}

/**
 * How many people sit in each group, biggest first, the sizes never more
 * than one apart. By count: that many groups (never more than there are
 * people). By size: as near that size as the people allow, without leaving
 * someone in a group of one when the size asked for is 2 or more (11 people
 * in groups of 3 is 3, 3, 3 and 2; 10 is 4, 3 and 3).
 */
export function groupSizes(people: number, split: SplitSpec): number[] {
  const total = Math.max(0, Math.floor(people));
  if (total === 0) return [];
  const n = Math.max(1, Math.floor(Number.isFinite(split.n) ? split.n : 1));
  let count: number;
  if (split.by === "count") {
    count = n;
  } else {
    count = Math.max(1, Math.round(total / n));
    if (n >= 2 && count > 1 && Math.floor(total / count) < 2) {
      count = Math.max(1, Math.floor(total / n));
    }
  }
  count = Math.max(1, Math.min(count, total, MIXER_LIMITS.groups));
  const base = Math.floor(total / count);
  const extra = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Pairs for `people`: twos, and with an odd number one group of three (a
 * trio) or one person out (`sitOut` is then 1). One person alone is a group
 * of one.
 */
export function pairSizes(people: number, odd: OddPolicy): { sizes: number[]; sitOut: number } {
  const total = Math.max(0, Math.floor(people));
  if (total === 0) return { sizes: [], sitOut: 0 };
  if (total < 2) return { sizes: [total], sitOut: 0 };
  const pairs = Math.min(Math.floor(total / 2), MIXER_LIMITS.groups);
  const left = total - pairs * 2;
  if (left === 0) return { sizes: Array.from({ length: pairs }, () => 2), sitOut: 0 };
  if (odd === "sit-out" && left === 1) {
    return { sizes: Array.from({ length: pairs }, () => 2), sitOut: 1 };
  }
  // A trio (or, past the group cap, the rest spread over the pairs).
  const sizes = Array.from({ length: pairs }, () => 2);
  for (let i = 0; i < left; i++) sizes[i % pairs] += 1;
  return { sizes, sitOut: 0 };
}

/** "Group 3", "Pair 3", "Table 3": a group's label by its place, counting from 1. */
export function groupLabel(mode: MixMode, index: number): string {
  const word = mode === "pairs" ? "Pair" : mode === "cafe" ? "Table" : "Group";
  return `${word} ${index + 1}`;
}

/** A role or skill as a key: trimmed, case-insensitive; "" for none. */
export function traitKey(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase();
}
