/**
 * Team Mixer's show-room frames: frame kind → parser, plus the host's
 * builders for them. Their renderers are in `../renderers/team-mixer.tsx`.
 *
 *   "groups"  a round of groups or pairs: each group's name and people, and
 *             who sits out;
 *   "cafe"    one World Café round: each table's host and guests.
 *
 * A parser takes the payload as JSON gave it and returns exactly what may
 * be drawn, rebuilt field by field with every string run through
 * `cleanText` and cut to a cap, or null. The builders clean the host's own
 * text the same way (hidden characters stripped, not refused), so the host
 * never sends what a phone would refuse. The caps keep the biggest mix
 * (120 people) well inside `SHOW_LIMITS.maxPayloadChars`.
 *
 * Pure and server-safe: no React, no browser globals.
 */

import { cleanText, shareableText } from "../../sanitize";
import { obj } from "../../vote-room/wire";
import type { ShowFrameParsers } from "../frames";

export const TEAM_MIXER_FRAME_KINDS = { groups: "groups", cafe: "cafe" } as const;

export const TEAM_MIXER_FRAME_LIMITS = {
  maxTitleChars: 120,
  maxNameChars: 32,
  maxGroupNameChars: 32,
  maxGroups: 60,
  /** Everyone in one frame, across all its groups (or tables, hosts included). */
  maxPeople: 120,
  maxRound: 999,
} as const;

const L = TEAM_MIXER_FRAME_LIMITS;

/** One group on screen: its name ("" when it has none) and its people. */
export interface GroupsFrameGroup {
  name: string;
  people: string[];
}

/** A round of groups or pairs. */
export interface GroupsFrame {
  /** What the groups are for; may be "". */
  title: string;
  /** The round's number, from 1. */
  round: number;
  unit: "group" | "pair";
  groups: GroupsFrameGroup[];
  sitOut: string[];
}

export interface CafeFrameTable {
  name: string;
  host: string;
  guests: string[];
}

/** One World Café round. */
export interface CafeFrame {
  title: string;
  /** This round, from 1, and how many there are. */
  round: number;
  rounds: number;
  tables: CafeFrameTable[];
}

const isRound = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= L.maxRound;

/** Optional text: "" when absent or empty, null when present but not clean. */
function optionalText(v: unknown, max: number): string | null {
  if (v === undefined || v === "") return "";
  return cleanText(v, max);
}

/** A list of 0..max names, each clean, or null. */
function names(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: string[] = [];
  for (const raw of v) {
    const name = cleanText(raw, L.maxNameChars);
    if (!name) return null;
    out.push(name);
  }
  return out;
}

/** A groups frame, or null. */
export function parseGroupsFrame(raw: unknown): GroupsFrame | null {
  const m = obj(raw);
  if (!m || !isRound(m.round)) return null;
  if (m.unit !== "group" && m.unit !== "pair") return null;
  const title = optionalText(m.title, L.maxTitleChars);
  if (title === null) return null;
  if (!Array.isArray(m.groups) || m.groups.length === 0 || m.groups.length > L.maxGroups) {
    return null;
  }
  let total = 0;
  const groups: GroupsFrameGroup[] = [];
  for (const rawGroup of m.groups) {
    const g = obj(rawGroup);
    if (!g) return null;
    const name = optionalText(g.name, L.maxGroupNameChars);
    const people = names(g.people, L.maxPeople);
    if (name === null || !people || people.length === 0) return null;
    total += people.length;
    groups.push({ name, people });
  }
  const sitOut = m.sitOut === undefined ? [] : names(m.sitOut, L.maxPeople);
  if (!sitOut) return null;
  if (total + sitOut.length > L.maxPeople) return null;
  return { title, round: m.round, unit: m.unit, groups, sitOut };
}

/** A café frame, or null. */
export function parseCafeFrame(raw: unknown): CafeFrame | null {
  const m = obj(raw);
  if (!m || !isRound(m.round) || !isRound(m.rounds) || m.round > m.rounds) return null;
  const title = optionalText(m.title, L.maxTitleChars);
  if (title === null) return null;
  if (!Array.isArray(m.tables) || m.tables.length < 2 || m.tables.length > L.maxGroups) {
    return null;
  }
  let total = 0;
  const tables: CafeFrameTable[] = [];
  for (const rawTable of m.tables) {
    const t = obj(rawTable);
    if (!t) return null;
    const name = optionalText(t.name, L.maxGroupNameChars);
    const host = cleanText(t.host, L.maxNameChars);
    const guests = names(t.guests, L.maxPeople);
    if (name === null || !host || !guests) return null;
    total += 1 + guests.length;
    tables.push({ name, host, guests });
  }
  if (total > L.maxPeople) return null;
  return { title, round: m.round, rounds: m.rounds, tables };
}

export const TEAM_MIXER_FRAMES: ShowFrameParsers = {
  [TEAM_MIXER_FRAME_KINDS.groups]: parseGroupsFrame,
  [TEAM_MIXER_FRAME_KINDS.cafe]: parseCafeFrame,
};

// ── The host's builders ──────────────────────────────────────────────

const share = (text: string | undefined, max: number) => shareableText(text ?? "", max);
const shareNames = (list: readonly string[]) =>
  list.map((n) => share(n, L.maxNameChars)).filter(Boolean);

/**
 * A groups frame from the host's own mix: text cleaned and cut to the caps,
 * empty groups dropped. Null when nothing is left to show, or the mix is
 * bigger than a frame holds.
 */
export function groupsFrame(input: {
  title?: string;
  round: number;
  unit: "group" | "pair";
  groups: readonly { name?: string; people: readonly string[] }[];
  sitOut?: readonly string[];
}): GroupsFrame | null {
  const groups = input.groups
    .map((g) => ({ name: share(g.name, L.maxGroupNameChars), people: shareNames(g.people) }))
    .filter((g) => g.people.length > 0);
  const frame: GroupsFrame = {
    title: share(input.title, L.maxTitleChars),
    round: Math.min(L.maxRound, Math.max(1, Math.floor(input.round))),
    unit: input.unit,
    groups,
    sitOut: shareNames(input.sitOut ?? []),
  };
  return parseGroupsFrame(frame);
}

/** A café frame for round `round` (from 1) of the host's plan, or null. */
export function cafeFrame(input: {
  title?: string;
  round: number;
  rounds: number;
  tables: readonly { name?: string; host: string; guests: readonly string[] }[];
}): CafeFrame | null {
  const frame: CafeFrame = {
    title: share(input.title, L.maxTitleChars),
    round: Math.min(L.maxRound, Math.max(1, Math.floor(input.round))),
    rounds: Math.min(L.maxRound, Math.max(1, Math.floor(input.rounds))),
    tables: input.tables.map((t) => ({
      name: share(t.name, L.maxGroupNameChars),
      host: share(t.host, L.maxNameChars),
      guests: shareNames(t.guests),
    })),
  };
  return parseCafeFrame(frame);
}
