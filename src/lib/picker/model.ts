/**
 * Picker's model: what the tool keeps (saved name lists, weights, the
 * everyone-once progress, the role rotation and its fairness history, recent
 * picks, a name shortlist) and the rules that pick from it.
 *
 * Pure and server-safe: no React, no store, no browser globals. The page, the
 * agent actions (browser and MCP) and the live room's frame builder all read
 * the same rules from here, so a spin Amr runs lands the way the page's would.
 *
 * People are matched by name (`nameKey`: trimmed, case-insensitive), the way
 * every tool matches the roster; a saved list holds names, not member ids,
 * because it may hold anything (topics, teams, places).
 */

import { nameKey } from "@/lib/team/names";
import { todayLocalISO } from "@/lib/utils/formatters";
import { weightedPick, type Rng } from "@/lib/utils/random";
import { PEOPLE_MAX, PERSON_NAME_MAX, rosterNames } from "./people";

// ── Limits ───────────────────────────────────────────────────────────

export const PICKER_LIMITS = {
  /** Names on one wheel or in one list: more and the slices are unreadable on a phone. */
  maxNames: PEOPLE_MAX,
  maxNameChars: PERSON_NAME_MAX,
  maxLists: 20,
  maxListNameChars: 60,
  minWeight: 1,
  maxWeight: 5,
  maxRoles: 8,
  maxRoleNameChars: 40,
  /** Role turns kept: years of weekly ceremonies for a few roles. */
  maxRoleTurns: 300,
  maxRecent: 30,
  maxResultChars: 120,
  maxDetailChars: 200,
  maxShortlist: 20,
  maxShortlistChars: 30,
} as const;

/** The wheel's source when it spins the team on the Team page. */
export const TEAM_SOURCE = "team";

// ── Types ────────────────────────────────────────────────────────────

/** One name on a wheel: a weight of 2 comes up twice as often as a weight of 1. */
export interface PickerEntry {
  name: string;
  weight: number;
}

export interface PickerList {
  id: string;
  name: string;
  entries: PickerEntry[];
  /** ISO time of the last change. */
  updatedAt: string;
}

/** A standing role that rotates (facilitator, scribe, timekeeper…). */
export interface PickerRole {
  id: string;
  name: string;
}

/** Someone took a role once: the fairness history is made of these. */
export interface PickerRoleTurn {
  id: string;
  roleId: string;
  /** The person's name as it was shown. */
  person: string;
  /** ISO time. */
  at: string;
  /**
   * The local day it was given on, YYYY-MM-DD, as the page saw it: who
   * already holds a role today. Read back from `at` when missing.
   */
  day: string;
}

export const PICK_KINDS = ["wheel", "dice", "coin", "yes-no", "number", "letter", "role"] as const;
export type PickKind = (typeof PICK_KINDS)[number];

export interface PickerRecent {
  id: string;
  kind: PickKind;
  /** What came up: "Sam", "Heads", "4 + 2 = 6". */
  result: string;
  /** What it was picked from: "Team (8 people)", "2d6". May be "". */
  detail: string;
  at: string;
}

/**
 * Where the wheel is for one source: who has come up this round (everyone
 * once) and who was taken off the wheel after being picked. Each source
 * keeps its own: switching the wheel to a list and back finds the team's
 * round where it was (the others wait in `PickerState.parked`).
 */
export interface PickerProgress {
  source: string;
  /** Name keys picked this round. */
  drawn: string[];
  /** Name keys taken off the wheel. */
  removed: string[];
  /** 1 for the first time through, then 2, 3… */
  round: number;
  /** The name key picked last, so a new round doesn't open with it. */
  last: string | null;
}

/** People skipped today ("away today"): forgotten the next day. */
export interface PickerAway {
  /** Local day, YYYY-MM-DD. "" when nobody is away. */
  day: string;
  keys: string[];
}

export interface PickerState {
  lists: PickerList[];
  /** What the wheel spins: TEAM_SOURCE or a saved list's id. */
  source: string;
  /** Weights for the team's people, by name key (absent: 1). */
  teamWeights: Record<string, number>;
  /** Everyone comes up once before anyone comes up again. */
  everyoneOnce: boolean;
  /** A name leaves the wheel once it is picked, until it is put back. */
  removePicked: boolean;
  /** The wheel's progress for `source`. */
  progress: PickerProgress;
  /** The other sources' progress, kept for when the wheel goes back to them. */
  parked: PickerProgress[];
  roles: PickerRole[];
  /**
   * Who takes the roles: TEAM_SOURCE (the Team page) or a saved list's id
   * chosen on the Roles tab. It never follows the wheel, which may be
   * spinning topics or name ideas.
   */
  roleSource: string;
  roleTurns: PickerRoleTurn[];
  away: PickerAway;
  recent: PickerRecent[];
  /** Team or sprint name ideas the team liked. */
  shortlist: string[];
  /**
   * The browser's offset from UTC in minutes when the page last saved, or
   * null. Over MCP the server works out the user's "today" from it.
   */
  utcOffset: number | null;
}

export const DEFAULT_ROLES: readonly PickerRole[] = [
  { id: "role-facilitator", name: "Facilitator" },
  { id: "role-scribe", name: "Scribe" },
  { id: "role-timekeeper", name: "Timekeeper" },
];

export const freshProgress = (source: string): PickerProgress => ({
  source,
  drawn: [],
  removed: [],
  round: 1,
  last: null,
});

export const PICKER_INITIAL: PickerState = {
  lists: [],
  source: TEAM_SOURCE,
  teamWeights: {},
  everyoneOnce: true,
  removePicked: false,
  progress: freshProgress(TEAM_SOURCE),
  parked: [],
  roles: DEFAULT_ROLES.map((r) => ({ ...r })),
  roleSource: TEAM_SOURCE,
  roleTurns: [],
  away: { day: "", keys: [] },
  recent: [],
  shortlist: [],
  utcOffset: null,
};

// ── Text ─────────────────────────────────────────────────────────────

/** One line, trimmed, cut to `max`; "" for anything that isn't text. */
export function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
}

/** A weight from 1 to 5, whole; anything else reads as 1. */
export function clampWeight(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.min(PICKER_LIMITS.maxWeight, Math.max(PICKER_LIMITS.minWeight, Math.round(raw)));
}

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 80 && /^[\w:-]+$/.test(v);

// ── Normalising what was saved ───────────────────────────────────────

/** Entries with clean names, each name once, weights 1–5, at most 40. */
export function normalizeEntries(raw: unknown): PickerEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PickerEntry[] = [];
  for (const row of raw) {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
    const name = cleanLine(typeof row === "string" ? row : r?.name, PICKER_LIMITS.maxNameChars);
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, weight: clampWeight(r?.weight) });
    if (out.length >= PICKER_LIMITS.maxNames) break;
  }
  return out;
}

function normalizeList(raw: unknown): PickerList | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || !isId(r.id)) return null;
  const name = cleanLine(r.name, PICKER_LIMITS.maxListNameChars);
  if (!name) return null;
  return {
    id: r.id,
    name,
    entries: normalizeEntries(r.entries),
    updatedAt: isIso(r.updatedAt) ? r.updatedAt : new Date(0).toISOString(),
  };
}

export function normalizeLists(raw: unknown): PickerList[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PickerList[] = [];
  for (const row of raw) {
    const list = normalizeList(row);
    if (!list || seen.has(list.id)) continue;
    seen.add(list.id);
    out.push(list);
    if (out.length >= PICKER_LIMITS.maxLists) break;
  }
  return out;
}

function normalizeKeys(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw) {
    const key = nameKey(typeof v === "string" ? cleanLine(v, PICKER_LIMITS.maxNameChars) : "");
    if (key) out.add(key);
    if (out.size >= max) break;
  }
  return Array.from(out);
}

export function normalizeProgress(raw: unknown, source: string): PickerProgress {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || r.source !== source) return freshProgress(source);
  const round =
    typeof r.round === "number" && Number.isSafeInteger(r.round) && r.round >= 1 ? r.round : 1;
  const last = typeof r.last === "string" && nameKey(r.last) ? nameKey(r.last) : null;
  return {
    source,
    drawn: normalizeKeys(r.drawn, PICKER_LIMITS.maxNames),
    removed: normalizeKeys(r.removed, PICKER_LIMITS.maxNames),
    round,
    last,
  };
}

export function normalizeRoles(raw: unknown): PickerRole[] {
  if (!Array.isArray(raw)) return DEFAULT_ROLES.map((r) => ({ ...r }));
  const seenId = new Set<string>();
  const seenName = new Set<string>();
  const out: PickerRole[] = [];
  for (const row of raw) {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
    if (!r || !isId(r.id) || seenId.has(r.id)) continue;
    const name = cleanLine(r.name, PICKER_LIMITS.maxRoleNameChars);
    if (!name || seenName.has(nameKey(name))) continue;
    seenId.add(r.id);
    seenName.add(nameKey(name));
    out.push({ id: r.id, name });
    if (out.length >= PICKER_LIMITS.maxRoles) break;
  }
  return out;
}

export function normalizeRoleTurns(raw: unknown, roles: readonly PickerRole[]): PickerRoleTurn[] {
  if (!Array.isArray(raw)) return [];
  const roleIds = new Set(roles.map((r) => r.id));
  const seen = new Set<string>();
  const out: PickerRoleTurn[] = [];
  for (const row of raw) {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
    if (!r || !isId(r.id) || seen.has(r.id) || !isId(r.roleId) || !roleIds.has(r.roleId)) continue;
    const person = cleanLine(r.person, PICKER_LIMITS.maxNameChars);
    if (!person || !isIso(r.at)) continue;
    seen.add(r.id);
    const day = isDay(r.day) ? r.day : todayLocalISO(new Date(r.at));
    out.push({ id: r.id, roleId: r.roleId, person, at: r.at, day });
  }
  // Newest last, so the history reads in order; the oldest go first past the cap.
  out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return out.slice(-PICKER_LIMITS.maxRoleTurns);
}

export function normalizeRecent(raw: unknown): PickerRecent[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PickerRecent[] = [];
  for (const row of raw) {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
    if (!r || !isId(r.id) || seen.has(r.id)) continue;
    if (!(PICK_KINDS as readonly unknown[]).includes(r.kind) || !isIso(r.at)) continue;
    const result = cleanLine(r.result, PICKER_LIMITS.maxResultChars);
    if (!result) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      kind: r.kind as PickKind,
      result,
      detail: cleanLine(r.detail, PICKER_LIMITS.maxDetailChars),
      at: r.at,
    });
  }
  // Newest first.
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out.slice(0, PICKER_LIMITS.maxRecent);
}

export function normalizeShortlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const name = cleanLine(v, PICKER_LIMITS.maxShortlistChars);
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= PICKER_LIMITS.maxShortlist) break;
  }
  return out;
}

function normalizeWeights(raw: unknown): Record<string, number> {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    const key = nameKey(cleanLine(k, PICKER_LIMITS.maxNameChars));
    if (!key || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const weight = clampWeight(v);
    // Only weights other than 1 are worth keeping.
    if (weight !== 1) out[key] = weight;
    if (++n >= 200) break;
  }
  return out;
}

function normalizeAway(raw: unknown): PickerAway {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const day = isDay(r?.day) ? r.day : "";
  return { day, keys: day ? normalizeKeys(r?.keys, PICKER_LIMITS.maxNames) : [] };
}

/** Nothing worth keeping: nobody drawn or taken off, still the first round. */
const isFresh = (p: PickerProgress) =>
  p.drawn.length === 0 && p.removed.length === 0 && p.round === 1 && p.last === null;

/**
 * Each source's progress, from the current one and the parked ones (the
 * first one for a source wins), for sources that still exist.
 */
function progressBySource(
  current: unknown,
  parked: unknown,
  known: (source: string) => boolean
): Map<string, PickerProgress> {
  const rows = Array.isArray(parked) ? parked.slice(0, PICKER_LIMITS.maxLists + 1) : [];
  const out = new Map<string, PickerProgress>();
  for (const row of [current, ...rows]) {
    const source =
      row && typeof row === "object" ? (row as Record<string, unknown>).source : undefined;
    if (typeof source !== "string" || !known(source) || out.has(source)) continue;
    out.set(source, normalizeProgress(row, source));
  }
  return out;
}

/** Minutes from UTC, as `-getTimezoneOffset()` gives them; null for anything else. */
function normalizeOffset(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && Math.abs(raw) <= 14 * 60 ? raw : null;
}

/**
 * The saved state as the page reads it: every field rebuilt and capped, so a
 * synced, imported or hand-edited value can't break the page. A source whose
 * list is gone falls back to the team, for the wheel and for the roles.
 *
 * A write that switches the wheel (`{ ...s, source }`) leaves the old
 * source's progress as the current one: it is parked here, not lost, and
 * the new source's own progress comes back.
 */
export function normalizePickerState(raw: unknown): PickerState {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lists = normalizeLists(r.lists);
  const known = (id: unknown): id is string =>
    id === TEAM_SOURCE || (typeof id === "string" && lists.some((l) => l.id === id));
  const source = known(r.source) ? r.source : TEAM_SOURCE;
  const roles = normalizeRoles(r.roles);
  const progress = progressBySource(r.progress, r.parked, known);
  return {
    lists,
    source,
    teamWeights: normalizeWeights(r.teamWeights),
    everyoneOnce: r.everyoneOnce === undefined ? true : r.everyoneOnce === true,
    removePicked: r.removePicked === true,
    progress: progress.get(source) ?? freshProgress(source),
    parked: Array.from(progress.values()).filter((p) => p.source !== source && !isFresh(p)),
    roles,
    roleSource: known(r.roleSource) ? r.roleSource : TEAM_SOURCE,
    roleTurns: normalizeRoleTurns(r.roleTurns, roles),
    away: normalizeAway(r.away),
    recent: normalizeRecent(r.recent),
    shortlist: normalizeShortlist(r.shortlist),
    utcOffset: normalizeOffset(r.utcOffset),
  };
}

/**
 * The state with `progress` saved for its own source: as the wheel's when
 * the wheel spins that source, else parked until the wheel goes back to it.
 * Run the result through `normalizePickerState` (updatePicker does).
 */
export function withProgress(state: PickerState, progress: PickerProgress): PickerState {
  return { ...state, progress, parked: [state.progress, ...state.parked] };
}

/** The progress kept for `source`: the wheel's, a parked one, or a fresh one. */
export function progressFor(state: PickerState, source: string): PickerProgress {
  if (state.progress.source === source) return state.progress;
  return state.parked.find((p) => p.source === source) ?? freshProgress(source);
}

/**
 * The user's local day, YYYY-MM-DD: at the UTC offset the page last saved
 * (over MCP, where the server's clock isn't the user's), else this machine's.
 */
export function localDay(utcOffset: number | null, now: Date = new Date()): string {
  if (utcOffset === null) return todayLocalISO(now);
  return new Date(now.getTime() + utcOffset * 60_000).toISOString().slice(0, 10);
}

// ── The wheel's names ────────────────────────────────────────────────

/** Every name on the wheel's source, removed ones included, with their weights. */
export function sourceEntries(
  state: PickerState,
  roster: readonly { name: string }[] | null | undefined
): PickerEntry[] {
  if (state.source !== TEAM_SOURCE) {
    const list = state.lists.find((l) => l.id === state.source);
    if (list) return list.entries;
  }
  return rosterNames(roster).map((name) => ({
    name,
    weight: clampWeight(state.teamWeights[nameKey(name)] ?? 1),
  }));
}

/** "Team" or the saved list's name. */
export function sourceLabel(state: PickerState): string {
  if (state.source === TEAM_SOURCE) return "Team";
  return state.lists.find((l) => l.id === state.source)?.name ?? "Team";
}

/**
 * Who takes the roles: the team on the Team page, or the saved list chosen
 * for roles. Never the wheel's source, which may be topics or name ideas.
 */
export function rolePeople(
  state: PickerState,
  roster: readonly { name: string }[] | null | undefined
): string[] {
  if (state.roleSource !== TEAM_SOURCE) {
    const list = state.lists.find((l) => l.id === state.roleSource);
    if (list) return list.entries.map((e) => e.name);
  }
  return rosterNames(roster);
}

/** "Team" or the name of the list the roles rotate among. */
export function roleSourceLabel(state: PickerState): string {
  if (state.roleSource === TEAM_SOURCE) return "Team";
  return state.lists.find((l) => l.id === state.roleSource)?.name ?? "Team";
}

export interface WheelView {
  /** The names on the wheel (removed ones are off it), in order. */
  shown: PickerEntry[];
  /** Indexes into `shown` that can come up on the next spin. */
  eligible: number[];
  /** Names taken off the wheel, as shown before they left. */
  removed: string[];
  /** The next spin starts a new round (everyone has had a turn). */
  roundOver: boolean;
  /** Names still to come up this round (everyone once), else all eligible. */
  left: number;
  round: number;
}

/**
 * What the wheel shows and who can come up next. With everyone once, names
 * already picked this round stay on the wheel but can't come up until the
 * round is over; then everyone is back in. Removed names are off the wheel.
 */
export function wheelView(
  entries: readonly PickerEntry[],
  progress: PickerProgress,
  everyoneOnce: boolean
): WheelView {
  const removedKeys = new Set(progress.removed);
  const shown = entries.filter((e) => !removedKeys.has(nameKey(e.name)));
  const removed = entries.filter((e) => removedKeys.has(nameKey(e.name))).map((e) => e.name);
  const all = shown.map((_, i) => i);
  if (!everyoneOnce) {
    return { shown, eligible: all, removed, roundOver: false, left: all.length, round: 1 };
  }
  const drawn = new Set(progress.drawn);
  const left = all.filter((i) => !drawn.has(nameKey(shown[i].name)));
  const roundOver = left.length === 0 && shown.length > 0;
  return {
    shown,
    eligible: roundOver ? all : left,
    removed,
    roundOver,
    left: roundOver ? 0 : left.length,
    round: progress.round,
  };
}

export interface SpinOutcome {
  /** The names on the wheel for this spin. */
  shown: PickerEntry[];
  /** Index into `shown`. */
  winner: number;
  entry: PickerEntry;
  progress: PickerProgress;
  /** This spin started a new round. */
  newRound: boolean;
  /** With everyone once: this pick was the last of the round. */
  roundDone: boolean;
}

/**
 * Spin: one eligible name, in proportion to its weight. Returns the new
 * progress (the pick counted this round, taken off the wheel if names leave
 * once picked) and leaves the one passed in as it was. Null when nothing
 * can come up.
 */
export function spinWheel(
  entries: readonly PickerEntry[],
  progress: PickerProgress,
  options: { everyoneOnce: boolean; removePicked: boolean },
  rng?: Rng
): SpinOutcome | null {
  const view = wheelView(entries, progress, options.everyoneOnce);
  let pool = view.eligible;
  if (pool.length === 0) return null;
  // A new round doesn't open with the name that closed the last one.
  if (view.roundOver && pool.length > 1 && progress.last) {
    pool = pool.filter((i) => nameKey(view.shown[i].name) !== progress.last);
  }
  const winner = weightedPick(pool, (i) => view.shown[i].weight, rng);
  if (winner === undefined) return null;
  const entry = view.shown[winner];
  const key = nameKey(entry.name);
  const drawn = options.everyoneOnce
    ? view.roundOver
      ? [key]
      : Array.from(new Set([...progress.drawn, key]))
    : progress.drawn;
  const removed = options.removePicked
    ? Array.from(new Set([...progress.removed, key]))
    : progress.removed;
  const next: PickerProgress = {
    source: progress.source,
    drawn,
    removed,
    round: view.roundOver ? progress.round + 1 : progress.round,
    last: key,
  };
  const after = wheelView(entries, next, options.everyoneOnce);
  return {
    shown: view.shown,
    winner,
    entry,
    progress: next,
    newRound: view.roundOver,
    roundDone: options.everyoneOnce && after.left === 0,
  };
}

// ── Roles ────────────────────────────────────────────────────────────

export interface RoleStanding {
  name: string;
  key: string;
  /** Times they have had this role. */
  turns: number;
  /** ISO time of their last turn, or null for never. */
  lastAt: string | null;
  away: boolean;
  /** The id of another role they already hold today, or null. */
  busyWith: string | null;
}

export interface RoleOptions {
  /** Name keys of people away today. */
  away?: readonly string[];
  /**
   * The local day, YYYY-MM-DD. Someone who already took another role on
   * it is passed over, so nobody holds two roles at once, unless nobody
   * else is free.
   */
  today?: string;
}

/**
 * Who is due for a role, fairest first: the fewest turns, then the longest
 * since their last (never first), then the order of the people given.
 * People who hold another role today come after everyone free, and people
 * away today sort last and are never "next".
 */
export function roleStandings(
  people: readonly string[],
  turns: readonly PickerRoleTurn[],
  roleId: string,
  { away: awayKeys = [], today }: RoleOptions = {}
): RoleStanding[] {
  const away = new Set(awayKeys);
  const stats = new Map<string, { turns: number; lastAt: string | null }>();
  const busy = new Map<string, { roleId: string; at: number }>();
  for (const t of turns) {
    const key = nameKey(t.person);
    if (t.roleId !== roleId) {
      if (today && t.day === today) {
        const at = Date.parse(t.at);
        const held = busy.get(key);
        if (!held || at > held.at) busy.set(key, { roleId: t.roleId, at });
      }
      continue;
    }
    const s = stats.get(key) ?? { turns: 0, lastAt: null };
    s.turns += 1;
    if (!s.lastAt || Date.parse(t.at) > Date.parse(s.lastAt)) s.lastAt = t.at;
    stats.set(key, s);
  }
  const seen = new Set<string>();
  const rows: (RoleStanding & { order: number })[] = [];
  people.forEach((name, order) => {
    const key = nameKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const s = stats.get(key);
    rows.push({
      name,
      key,
      turns: s?.turns ?? 0,
      lastAt: s?.lastAt ?? null,
      away: away.has(key),
      busyWith: busy.get(key)?.roleId ?? null,
      order,
    });
  });
  const time = (iso: string | null) => (iso ? Date.parse(iso) : -Infinity);
  rows.sort(
    (a, b) =>
      Number(a.away) - Number(b.away) ||
      Number(a.busyWith !== null) - Number(b.busyWith !== null) ||
      a.turns - b.turns ||
      time(a.lastAt) - time(b.lastAt) ||
      a.order - b.order
  );
  return rows.map((r) => ({
    name: r.name,
    key: r.key,
    turns: r.turns,
    lastAt: r.lastAt,
    away: r.away,
    busyWith: r.busyWith,
  }));
}

/**
 * The person due for the role: the fairest one who is here and holds no
 * other role today; if everyone here already has one, the fairest of them.
 * Null when everyone is away (or nobody is listed).
 */
export function nextForRole(
  people: readonly string[],
  turns: readonly PickerRoleTurn[],
  roleId: string,
  options: RoleOptions = {}
): string | null {
  const first = roleStandings(people, turns, roleId, options)[0];
  return first && !first.away ? first.name : null;
}

/** A role that hasn't been given today, and who would get it. */
export interface RolePlanRow {
  role: PickerRole;
  /** Null when everyone is away. */
  person: string | null;
}

/**
 * Give out every role nobody has had today, in the roles' order, each to
 * the person due for it with the earlier ones counted as taken: on a fresh
 * team, three roles go to three different people. The same as giving each
 * role in turn from its own card.
 */
export function planRoles(
  roles: readonly PickerRole[],
  people: readonly string[],
  turns: readonly PickerRoleTurn[],
  options: RoleOptions & { today: string }
): RolePlanRow[] {
  const given = new Set(turns.filter((t) => t.day === options.today).map((t) => t.roleId));
  const planned: PickerRoleTurn[] = [];
  const out: RolePlanRow[] = [];
  for (const role of roles) {
    if (given.has(role.id)) continue;
    const person = nextForRole(people, [...turns, ...planned], role.id, options);
    out.push({ role, person });
    if (person) {
      planned.push({
        id: `plan-${role.id}`,
        roleId: role.id,
        person,
        at: new Date(0).toISOString(),
        day: options.today,
      });
    }
  }
  return out;
}

/** Who is away today: the saved keys when they were saved today, else nobody. */
export function awayToday(away: PickerAway, today: string): string[] {
  return away.day === today ? away.keys : [];
}

/** The role turns with one more, newest last, capped. */
export function withRoleTurn(
  turns: readonly PickerRoleTurn[],
  turn: PickerRoleTurn
): PickerRoleTurn[] {
  return [...turns.filter((t) => t.id !== turn.id), turn].slice(-PICKER_LIMITS.maxRoleTurns);
}

// ── Recent picks ─────────────────────────────────────────────────────

/** The recent picks with one more on top, capped. */
export function withRecent(recent: readonly PickerRecent[], pick: PickerRecent): PickerRecent[] {
  return [pick, ...recent.filter((r) => r.id !== pick.id)].slice(0, PICKER_LIMITS.maxRecent);
}

// ── Lists ────────────────────────────────────────────────────────────

/**
 * `names` added to `entries`: clean, each once (a name already there is
 * skipped), weight 1, up to 40 in all. Says how many were added, and how
 * many were skipped as repeats or for the cap.
 */
export function addEntries(
  entries: readonly PickerEntry[],
  names: readonly string[]
): { entries: PickerEntry[]; added: number; skipped: number } {
  const out = entries.slice();
  const seen = new Set(out.map((e) => nameKey(e.name)));
  let added = 0;
  let skipped = 0;
  for (const raw of names) {
    const name = cleanLine(raw, PICKER_LIMITS.maxNameChars);
    const key = nameKey(name);
    if (!key) continue;
    if (seen.has(key) || out.length >= PICKER_LIMITS.maxNames) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    out.push({ name, weight: 1 });
    added += 1;
  }
  return { entries: out, added, skipped };
}

/** A list by id, or by name (case-insensitive). */
export function findList(lists: readonly PickerList[], idOrName: string): PickerList | undefined {
  return (
    lists.find((l) => l.id === idOrName) ?? lists.find((l) => nameKey(l.name) === nameKey(idOrName))
  );
}

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago": how long since `iso`. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} ${min === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** "Team (8 people)", "Retro topics (5 names)". */
export function poolLabel(label: string, size: number, team: boolean): string {
  const unit = team ? (size === 1 ? "person" : "people") : size === 1 ? "name" : "names";
  return `${label} (${size} ${unit})`;
}
