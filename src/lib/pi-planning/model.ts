/**
 * The PI board's state, as stored under `agile-toolkit:pi-planning` (a
 * usePersisted blob: localStorage plus cloud sync), and the one normaliser
 * every read goes through. Pure and server-safe: Amr's `tool.pi_planning`
 * verbs read the blob on either transport with it, and the page's
 * `"use client"` store (`src/app/(tools)/pi-planning/store.ts`) re-exports
 * it beside the hook.
 *
 * Old boards still load: boards saved before the dependency link carry a
 * velocity of 0 for "not set", points on every item and dependency items
 * with no link to the Dependency Map; boards saved before ROAM, the
 * confidence vote and predictability have none of those fields. Every new
 * field is optional and only added, never required, and a field that can't
 * be read is dropped rather than guessed. Unknown fields are kept, so a
 * newer build's additions survive an older tab.
 */

import { HANDOFF_ROUTE_IDS, type HandoffLink } from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";

export const PI_STORAGE_KEY = "agile-toolkit:pi-planning";

export type PiItemKind = "feature" | "dependency" | "risk";
export const PI_ITEM_KINDS: readonly PiItemKind[] = ["feature", "dependency", "risk"];

/**
 * ROAM, for a risk: Resolved (no longer a risk), Owned (someone takes it
 * on), Accepted (the train lives with it), Mitigated (a plan makes it
 * smaller). Unset means it's still to sort.
 */
export const ROAM_STATUSES = ["resolved", "owned", "accepted", "mitigated"] as const;
export type RoamStatus = (typeof ROAM_STATUSES)[number];

/* ── Caps ── */

export const MAX_ITERATIONS = 10;
export const PI_NAME_MAX = 80;
export const ROAM_OWNER_MAX = 120;
export const ROAM_NOTE_MAX = 1000;
/** A team's name on a vote or a closed PI (the team form's own cap). */
export const PI_TEAM_NAME_MAX = 120;
/** Actual business value, per objective: 0–10 (business value itself is 1–10). */
export const ACTUAL_BV_MAX = 10;
/** Confidence votes kept on the board, the latest first to stay. */
export const CONFIDENCE_MAX = 20;
/** Closed PIs kept, the latest first to stay. */
export const HISTORY_MAX = 12;
/** Teams one closed PI keeps. */
export const RECORD_TEAMS_MAX = 50;
/** The confidence scale: fist of five, 1 to 5. */
export const CONFIDENCE_POINTS = 5;
/** The predictability band's highest value, in percent. */
export const BAND_MAX = 200;
/** The band a PI is read against until the train sets its own: a common aim. */
export const DEFAULT_BAND: PiBand = { low: 80, high: 100 };

/* ── Types ── */

export interface PiTeam {
  id: string;
  name: string;
  description?: string;
  /** Points the team delivers per iteration; unset (or a legacy 0) means no capacity yet. */
  velocity?: number;
}

export interface PiItem {
  id: string;
  title: string;
  description?: string;
  teamId: string;
  /** 0-based iteration. */
  iteration: number;
  /** Unset means not sized yet (never a silent 0). Only features count toward load. */
  points?: number;
  kind: PiItemKind;
  /** A dependency's other side: the team (or deliverable) it waits on. */
  dependsOn?: string;
  /** The Dependency Map edge this dependency shows (status, owner and due date live there). */
  edgeId?: string;
  /** A risk's ROAM status; unset while it's still to sort. */
  roam?: RoamStatus;
  /** Who chases a risk (an Owned one, mostly). At most ROAM_OWNER_MAX characters. */
  roamOwner?: string;
  /** What's being done about it, or why it's accepted. At most ROAM_NOTE_MAX characters. */
  roamNote?: string;
  /** Where the risk was sent (the Risk Register), one link per route. */
  sentTo?: HandoffLink[];
}

/** A PI objective: what the team commits to, with the business value its owners give it. */
export interface PiObjective {
  id: string;
  teamId: string;
  title: string;
  /** 1–10, set by the business owners; unset until they score it. */
  businessValue?: number;
  /** Uncommitted objectives are stretch goals: planned for, not promised. */
  committed: boolean;
  /** 0–10, the value the business owners say it delivered; unset until they score it. */
  actualBusinessValue?: number;
}

/** The predictability band, in percent of planned business value. */
export interface PiBand {
  low: number;
  high: number;
}

/**
 * A confidence vote's totals (never anyone's answer): how many people
 * gave each point of the 1–5 scale, for the whole train or one team.
 */
export interface PiConfidenceVote {
  id: string;
  /** When the round closed. */
  at: string;
  /** "train", or the id of the team that voted. */
  scope: string;
  /** What the vote was for when it was saved ("Whole train", or the team's name). */
  scopeName: string;
  /** Votes per point, 1 first: always CONFIDENCE_POINTS numbers. */
  counts: number[];
  ballots: number;
  /** "live": answered on phones in a room; "facilitator": counted by hand. */
  source: "live" | "facilitator";
}

/** One team in a closed PI: what it planned and what it delivered, in business value. */
export interface PiRecordTeam {
  teamId: string;
  name: string;
  plannedBv: number;
  actualBv: number;
}

/** A closed PI's predictability, kept after the board moves on. */
export interface PiRecord {
  id: string;
  name: string;
  closedAt: string;
  teams: PiRecordTeam[];
}

export interface PiState {
  teams: PiTeam[];
  items: PiItem[];
  iterations: number;
  objectives?: PiObjective[];
  /** The PI's name ("PI 2026.4"), for its closed record. */
  name?: string;
  /** The predictability band; DEFAULT_BAND while unset. */
  band?: PiBand;
  confidence?: PiConfidenceVote[];
  history?: PiRecord[];
}

export const DEFAULT_PI_STATE: PiState = { teams: [], items: [], iterations: 5, objectives: [] };

/* ── Reading values ── */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const count = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const wholeCount = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

/** Text trimmed and cut to `max` without splitting a character, or undefined when blank. */
export function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const out = cutText(v.trim(), max).trim();
  return out === "" ? undefined : out;
}

/** A score on 0..max: a finite number in range, rounded, or undefined. */
function scoreIn(v: unknown, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) return undefined;
  return Math.round(v);
}

export const isRoamStatus = (v: unknown): v is RoamStatus =>
  typeof v === "string" && (ROAM_STATUSES as readonly string[]).includes(v);

const isDay = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

function isHandoffLink(v: unknown): v is HandoffLink {
  return (
    isObj(v) &&
    typeof v.route === "string" &&
    (HANDOFF_ROUTE_IDS as readonly string[]).includes(v.route) &&
    typeof v.targetId === "string" &&
    v.targetId !== "" &&
    typeof v.at === "string"
  );
}

/** The valid hand-off links in `raw`, the first one per route; undefined when there are none. */
export function cleanSentTo(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: HandoffLink[] = [];
  for (const link of raw) {
    if (!isHandoffLink(link) || seen.has(link.route)) continue;
    seen.add(link.route);
    out.push({ route: link.route, targetId: link.targetId, at: link.at });
  }
  return out.length ? out : undefined;
}

/** `obj` with `key` set to `value`, or without it when the value is undefined. */
function setOrDrop<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined) {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
}

/** A band the train set, as far as it can be read: both ends on 0..BAND_MAX, low first. */
export function cleanBand(raw: unknown): PiBand | undefined {
  if (!isObj(raw)) return undefined;
  const low = scoreIn(raw.low, BAND_MAX);
  const high = scoreIn(raw.high, BAND_MAX);
  if (low === undefined || high === undefined || low > high) return undefined;
  return { low, high };
}

function cleanVote(raw: unknown): PiConfidenceVote | null {
  if (!isObj(raw) || !str(raw.id) || !isDay(raw.at) || !str(raw.scope)) return null;
  if (!Array.isArray(raw.counts) || raw.counts.length !== CONFIDENCE_POINTS) return null;
  const counts = raw.counts.map(wholeCount);
  if (counts.some((c) => c === undefined)) return null;
  const total = (counts as number[]).reduce((a, c) => a + c, 0);
  if (total === 0) return null;
  const ballots = wholeCount(raw.ballots);
  return {
    id: raw.id as string,
    at: raw.at,
    scope: raw.scope as string,
    scopeName: cleanText(raw.scopeName, PI_TEAM_NAME_MAX) ?? "",
    counts: counts as number[],
    // The answers counted can't be more than the ballots cast.
    ballots: ballots !== undefined && ballots >= total ? ballots : total,
    source: raw.source === "live" ? "live" : "facilitator",
  };
}

function cleanRecord(raw: unknown): PiRecord | null {
  if (!isObj(raw) || !str(raw.id) || !isDay(raw.closedAt)) return null;
  const teams = (Array.isArray(raw.teams) ? raw.teams : [])
    .flatMap((t): PiRecordTeam[] => {
      if (!isObj(t) || !str(t.teamId)) return [];
      const plannedBv = count(t.plannedBv);
      const actualBv = count(t.actualBv);
      if (plannedBv === undefined || actualBv === undefined) return [];
      return [
        {
          teamId: t.teamId as string,
          name: cleanText(t.name, PI_TEAM_NAME_MAX) ?? "",
          plannedBv,
          actualBv,
        },
      ];
    })
    .slice(0, RECORD_TEAMS_MAX);
  return {
    id: raw.id as string,
    name: cleanText(raw.name, PI_NAME_MAX) ?? "",
    closedAt: raw.closedAt,
    teams,
  };
}

/** A list's readable entries, the latest `max` kept (lists are kept oldest first). */
function cleanList<T>(raw: unknown, clean: (x: unknown) => T | null, max: number): T[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((x) => clean(x) ?? []).slice(-max);
}

/**
 * Any stored value as a usable board. Unknown fields are kept (a newer
 * build's additions survive an older tab), broken rows are dropped, and an
 * item pinned past the last iteration stays (the board just doesn't show it
 * until the iteration count grows back). The ROAM, confidence and
 * predictability fields are cleaned when present and never added when
 * absent, so an old board reads back as it was saved.
 */
export function normalizePiState(raw: unknown): PiState {
  if (!isObj(raw)) return DEFAULT_PI_STATE;
  const iterations =
    typeof raw.iterations === "number" && Number.isInteger(raw.iterations)
      ? Math.min(MAX_ITERATIONS, Math.max(1, raw.iterations))
      : DEFAULT_PI_STATE.iterations;

  const teams: PiTeam[] = (Array.isArray(raw.teams) ? raw.teams : []).flatMap((t) => {
    if (!isObj(t) || !str(t.id)) return [];
    const velocity = count(t.velocity);
    const team: PiTeam = { ...(t as object), id: t.id as string, name: str(t.name) ?? "" };
    if (velocity && velocity > 0) team.velocity = velocity;
    else delete team.velocity;
    return [team];
  });

  const items: PiItem[] = (Array.isArray(raw.items) ? raw.items : []).flatMap((i) => {
    if (!isObj(i) || !str(i.id) || !str(i.teamId)) return [];
    const iteration =
      typeof i.iteration === "number" && Number.isInteger(i.iteration) && i.iteration >= 0
        ? i.iteration
        : 0;
    const kind = PI_ITEM_KINDS.includes(i.kind as PiItemKind) ? (i.kind as PiItemKind) : "feature";
    const item: PiItem = {
      ...(i as object),
      id: i.id as string,
      teamId: i.teamId as string,
      title: str(i.title) ?? "",
      iteration,
      kind,
    };
    const points = count(i.points);
    if (points === undefined) delete item.points;
    else item.points = points;
    if ("roam" in i) setOrDrop(item, "roam", isRoamStatus(i.roam) ? i.roam : undefined);
    if ("roamOwner" in i) setOrDrop(item, "roamOwner", cleanText(i.roamOwner, ROAM_OWNER_MAX));
    if ("roamNote" in i) setOrDrop(item, "roamNote", cleanText(i.roamNote, ROAM_NOTE_MAX));
    if ("sentTo" in i) setOrDrop(item, "sentTo", cleanSentTo(i.sentTo));
    return [item];
  });

  const objectives: PiObjective[] = (Array.isArray(raw.objectives) ? raw.objectives : []).flatMap(
    (o) => {
      if (!isObj(o) || !str(o.id) || !str(o.teamId)) return [];
      const bv = count(o.businessValue);
      const objective: PiObjective = {
        ...(o as object),
        id: o.id as string,
        teamId: o.teamId as string,
        title: str(o.title) ?? "",
        committed: o.committed !== false,
      };
      if (bv === undefined) delete objective.businessValue;
      else objective.businessValue = bv;
      if ("actualBusinessValue" in o) {
        setOrDrop(objective, "actualBusinessValue", scoreIn(o.actualBusinessValue, ACTUAL_BV_MAX));
      }
      return [objective];
    }
  );

  const state: PiState = { ...(raw as object), teams, items, iterations, objectives };
  if ("name" in raw) setOrDrop(state, "name", cleanText(raw.name, PI_NAME_MAX));
  if ("band" in raw) setOrDrop(state, "band", cleanBand(raw.band));
  if ("confidence" in raw) {
    setOrDrop(
      state,
      "confidence",
      cleanList(raw.confidence, cleanVote, CONFIDENCE_MAX) ?? undefined
    );
  }
  if ("history" in raw) {
    setOrDrop(state, "history", cleanList(raw.history, cleanRecord, HISTORY_MAX) ?? undefined);
  }
  return state;
}

/** The PI board's team names, for other tools' team pickers (Scrum of Scrums). */
export const piTeamNames = (state: PiState): string[] =>
  state.teams.map((t) => t.name).filter((n) => n.trim());

/**
 * The local day (YYYY-MM-DD) a stored time falls on: a plain day as it is
 * (it has no time zone), a timestamp in this browser's zone. The text as it
 * is when it can't be read.
 */
export function localDayOf(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** A team's name by its id, or undefined once the team is gone. */
export const teamName = (state: Pick<PiState, "teams">, id: string): string | undefined =>
  state.teams.find((t) => t.id === id)?.name;
