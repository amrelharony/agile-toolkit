/**
 * Team Mixer's saved state (the `team-mixer` tool store): who is in the mix,
 * how to mix them, the rules, the rounds mixed so far (their pairings are
 * what the next round avoids) and the World Café plan.
 *
 * Everything read back (from this browser, the cloud copy, an import or an
 * agent) goes through `normalizeMixerState`, field by field, so a damaged or
 * hand-edited copy can't break the page.
 *
 * Pure and server-safe: the MCP actions read the cloud copy with it.
 */

import { isExampleId } from "@/lib/utils/example-id";
import {
  BALANCES,
  ISSUE_KINDS,
  MIXER_LIMITS,
  MIX_MODES,
  ODD_POLICIES,
  RULE_KINDS,
  SPLITS,
  nameKey,
  type Balance,
  type IssueKind,
  type MixIssue,
  type MixMode,
  type OddPolicy,
  type RuleKind,
  type Split,
} from "./model";

export interface MixerPersonRow {
  id: string;
  name: string;
}

export interface MixerRule {
  id: string;
  kind: RuleKind;
  a: string;
  b: string;
}

export interface MixerGroup {
  /** A fun name, when the group got one. */
  name?: string;
  people: string[];
}

/** One mix of groups or pairs. */
export interface MixerRound {
  id: string;
  /** When it was mixed, ISO. */
  at: string;
  mode: "groups" | "pairs";
  /** What the groups were for. */
  title?: string;
  seed: number;
  balance: Balance;
  groups: MixerGroup[];
  sitOut: string[];
  issues: MixIssue[];
}

export interface MixerCafeTable {
  name?: string;
  host: string;
  guests: string[];
}

/** A World Café plan: every round's tables. */
export interface MixerCafe {
  id: string;
  at: string;
  title?: string;
  seed: number;
  balance: Balance;
  /** Round by round, table by table. */
  rounds: MixerCafeTable[][];
  issues: MixIssue[];
  /** The round on screen, from 0. */
  current: number;
}

export interface MixerState {
  people: MixerPersonRow[];
  mode: MixMode;
  split: Split;
  /** Group size, when splitting by size. */
  size: number;
  /** Number of groups, when splitting by count. */
  count: number;
  balance: Balance;
  odd: OddPolicy;
  tables: number;
  cafeRounds: number;
  /** World Café hosts by table; "" for one picked at random. */
  hosts: string[];
  /** What the groups are for (shown on the room screen and in the export). */
  title: string;
  rules: MixerRule[];
  /** Oldest first, the newest MIXER_LIMITS.rounds kept. */
  rounds: MixerRound[];
  cafe: MixerCafe | null;
  /** Fixes the pair rotation's order; 0 until the first pairs round. */
  seriesSeed: number;
}

export const MIXER_INITIAL: MixerState = {
  people: [],
  mode: "groups",
  split: "size",
  size: 4,
  count: 3,
  balance: "none",
  odd: "trio",
  tables: 4,
  cafeRounds: 3,
  hosts: [],
  title: "",
  rules: [],
  rounds: [],
  cafe: null,
  seriesSeed: 0,
};

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** One line of text: whitespace collapsed, trimmed, cut to `max`; "" for anything else. */
export function cleanLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;

const whole = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

const seedOf = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : 0;

const idOf = (v: unknown): string => cleanLine(v, 80);

const isoOf = (v: unknown): string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : new Date(0).toISOString();

/** Names, each once, blank ones dropped, at most `max`. */
export function cleanNames(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    const name = cleanLine(raw, MIXER_LIMITS.name);
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeIssues(v: unknown): MixIssue[] {
  if (!Array.isArray(v)) return [];
  const out: MixIssue[] = [];
  for (const raw of v) {
    const r = rec(raw);
    const text = cleanLine(r?.text, 400);
    if (!r || !text) continue;
    out.push({ kind: oneOf<IssueKind>(ISSUE_KINDS, r.kind, "search"), text });
    if (out.length >= MIXER_LIMITS.issues) break;
  }
  return out;
}

export function normalizePeople(v: unknown): MixerPersonRow[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  const out: MixerPersonRow[] = [];
  for (const raw of v) {
    const r = rec(raw);
    const id = idOf(r?.id);
    const name = cleanLine(r?.name, MIXER_LIMITS.name);
    const key = nameKey(name);
    if (!id || !key || seen.has(key) || ids.has(id)) continue;
    seen.add(key);
    ids.add(id);
    out.push({ id, name });
    if (out.length >= MIXER_LIMITS.people) break;
  }
  return out;
}

export function normalizeRules(v: unknown): MixerRule[] {
  if (!Array.isArray(v)) return [];
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const out: MixerRule[] = [];
  for (const raw of v) {
    const r = rec(raw);
    const id = idOf(r?.id);
    const a = cleanLine(r?.a, MIXER_LIMITS.name);
    const b = cleanLine(r?.b, MIXER_LIMITS.name);
    const ka = nameKey(a);
    const kb = nameKey(b);
    if (!r || !id || ids.has(id) || !ka || !kb || ka === kb) continue;
    const pair = ka < kb ? `${ka}\u0000${kb}` : `${kb}\u0000${ka}`;
    if (pairs.has(pair)) continue;
    ids.add(id);
    pairs.add(pair);
    out.push({ id, kind: oneOf<RuleKind>(RULE_KINDS, r.kind, "apart"), a, b });
    if (out.length >= MIXER_LIMITS.rules) break;
  }
  return out;
}

function normalizeGroups(v: unknown): MixerGroup[] {
  if (!Array.isArray(v)) return [];
  const out: MixerGroup[] = [];
  for (const raw of v) {
    const r = rec(raw);
    if (!r) continue;
    const people = cleanNames(r.people, MIXER_LIMITS.groupSize);
    if (people.length === 0) continue;
    const name = cleanLine(r.name, MIXER_LIMITS.groupName);
    out.push(name ? { name, people } : { people });
    if (out.length >= MIXER_LIMITS.groups) break;
  }
  return out;
}

function normalizeRound(raw: unknown): MixerRound | null {
  const r = rec(raw);
  const id = idOf(r?.id);
  if (!r || !id) return null;
  const groups = normalizeGroups(r.groups);
  if (groups.length === 0) return null;
  const title = cleanLine(r.title, MIXER_LIMITS.title);
  return {
    id,
    at: isoOf(r.at),
    mode: r.mode === "pairs" ? "pairs" : "groups",
    ...(title ? { title } : {}),
    seed: seedOf(r.seed),
    balance: oneOf<Balance>(BALANCES, r.balance, "none"),
    groups,
    sitOut: cleanNames(r.sitOut, MIXER_LIMITS.people),
    issues: normalizeIssues(r.issues),
  };
}

export function normalizeRounds(v: unknown): MixerRound[] {
  if (!Array.isArray(v)) return [];
  const ids = new Set<string>();
  const out: MixerRound[] = [];
  for (const raw of v) {
    const round = normalizeRound(raw);
    if (!round || ids.has(round.id)) continue;
    ids.add(round.id);
    out.push(round);
  }
  out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return out.slice(-MIXER_LIMITS.rounds);
}

export function normalizeCafe(v: unknown): MixerCafe | null {
  const r = rec(v);
  const id = idOf(r?.id);
  if (!r || !id || !Array.isArray(r.rounds)) return null;
  const rounds: MixerCafeTable[][] = [];
  for (const rawRound of r.rounds.slice(0, MIXER_LIMITS.cafeRounds)) {
    if (!Array.isArray(rawRound)) return null;
    const tables: MixerCafeTable[] = [];
    for (const rawTable of rawRound.slice(0, MIXER_LIMITS.tables)) {
      const t = rec(rawTable);
      const host = cleanLine(t?.host, MIXER_LIMITS.name);
      if (!t || !host) return null;
      const name = cleanLine(t.name, MIXER_LIMITS.groupName);
      tables.push({
        ...(name ? { name } : {}),
        host,
        guests: cleanNames(t.guests, MIXER_LIMITS.people),
      });
    }
    if (tables.length < 2) return null;
    rounds.push(tables);
  }
  if (rounds.length === 0) return null;
  const title = cleanLine(r.title, MIXER_LIMITS.title);
  return {
    id,
    at: isoOf(r.at),
    ...(title ? { title } : {}),
    seed: seedOf(r.seed),
    balance: oneOf<Balance>(BALANCES, r.balance, "none"),
    rounds,
    issues: normalizeIssues(r.issues),
    current: whole(r.current, 0, rounds.length - 1, 0),
  };
}

/** The state as it may be used: every field checked, anything unknown dropped. */
export function normalizeMixerState(raw: unknown): MixerState {
  const r = rec(raw) ?? {};
  const tables = whole(r.tables, 2, MIXER_LIMITS.tables, MIXER_INITIAL.tables);
  return {
    people: normalizePeople(r.people),
    mode: oneOf<MixMode>(MIX_MODES, r.mode, MIXER_INITIAL.mode),
    split: oneOf<Split>(SPLITS, r.split, MIXER_INITIAL.split),
    size: whole(r.size, 2, MIXER_LIMITS.groupSize, MIXER_INITIAL.size),
    count: whole(r.count, 2, MIXER_LIMITS.groups, MIXER_INITIAL.count),
    balance: oneOf<Balance>(BALANCES, r.balance, MIXER_INITIAL.balance),
    odd: oneOf<OddPolicy>(ODD_POLICIES, r.odd, MIXER_INITIAL.odd),
    tables,
    cafeRounds: whole(r.cafeRounds, 1, MIXER_LIMITS.cafeRounds, MIXER_INITIAL.cafeRounds),
    hosts: Array.isArray(r.hosts)
      ? r.hosts.slice(0, tables).map((h) => cleanLine(h, MIXER_LIMITS.name))
      : [],
    title: cleanLine(r.title, MIXER_LIMITS.title),
    rules: normalizeRules(r.rules),
    rounds: normalizeRounds(r.rounds),
    cafe: normalizeCafe(r.cafe),
    seriesSeed: seedOf(r.seriesSeed),
  };
}

/** Whether anything in the state came from the example. */
export function hasExampleRows(s: MixerState): boolean {
  return (
    s.people.some((p) => isExampleId(p.id)) ||
    s.rules.some((r) => isExampleId(r.id)) ||
    s.rounds.some((r) => isExampleId(r.id)) ||
    (s.cafe !== null && isExampleId(s.cafe.id))
  );
}

/** The state without the example's rows (the person's own rows stay). */
export function withoutExample(s: MixerState): MixerState {
  return {
    ...s,
    people: s.people.filter((p) => !isExampleId(p.id)),
    rules: s.rules.filter((r) => !isExampleId(r.id)),
    rounds: s.rounds.filter((r) => !isExampleId(r.id)),
    cafe: s.cafe && isExampleId(s.cafe.id) ? null : s.cafe,
  };
}
