/**
 * Relative Sizing's stored data (`agile-toolkit:relative-sizing`, a tool
 * store synced like the others): the boards (each a set of buckets and the
 * stories being sized into them), which board is open, and the live rounds
 * saved from them (totals only, never who answered).
 *
 * Every field is rebuilt on the way out (`normalizeRelativeSizingState`),
 * because a synced, hand-edited or agent-written value can hold anything.
 * Pure and server-safe: Amr's actions read and write the user's stored row
 * through it on the server too (serverPatchUserStateBlob).
 */

import { HANDOFF_ROUTE_IDS, type HandoffLink } from "@/lib/stores/workspace-types";
import type { ConsensusLevel } from "@/lib/estimation/consensus";

export const RELATIVE_SIZING_STORE = "relative-sizing";
/** Where the store lives: the browser's key, and the synced row's store_key. */
export const RELATIVE_SIZING_STORE_KEY = `agile-toolkit:${RELATIVE_SIZING_STORE}`;

export const SIZING_LIMITS = {
  /** Boards kept. */
  boards: 20,
  /** Saved live rounds kept (the newest). */
  rounds: 50,
  /** Stories on one board (SIZING_ITEMS_MAX). */
  items: 100,
  /** A board's title. */
  title: 120,
  /** A story's title (a backlog story's cap). */
  itemTitle: 200,
  /** A bucket's label: a card's worth ("13", "XL"). */
  bucketLabel: 8,
  bucketsMin: 2,
  /** One answer character per bucket in a live round. */
  bucketsMax: 11,
  /** Moves before a card goes to Talk about it. */
  moveLimitMin: 2,
  moveLimitMax: 9,
  moveLimitDefault: 3,
  movesMax: 99,
  /** A name a card is dealt to. */
  name: 40,
  /** People counted on one bucket in a round. */
  countMax: 999,
  /** The points a bucket can stand for. */
  pointsMax: 1000,
  /** Ids the page and agents mint. */
  id: 64,
} as const;

export const SIZING_ITEMS_MAX = SIZING_LIMITS.items;

export const SIZING_MODES = ["silent", "buckets"] as const;
export type SizingMode = (typeof SIZING_MODES)[number];

export const BUCKET_SETS = ["fibonacci", "tshirt", "powers", "linear", "wide", "custom"] as const;
export type BucketSet = (typeof BUCKET_SETS)[number];

export interface SizingBucket {
  id: string;
  /** At most 8 characters, unique on its board. */
  label: string;
  /** What the bucket writes as a story's points (a T-shirt bucket has none until mapped). */
  points?: number;
}

/** The last live round's totals for one story: never who answered. */
export interface SizingRoomTotals {
  /** People per bucket, in the board's bucket order. */
  counts: number[];
  responses: number;
  level: ConsensusLevel | null;
}

export interface SizingItem {
  id: string;
  title: string;
  /** The workspace story it sizes; a pasted title has none until it goes to the backlog. */
  storyId?: string;
  /** Its bucket; null while it is not placed. */
  bucketId: string | null;
  /** Times it left a bucket. */
  moves: number;
  /** Who places it, when the cards were dealt. */
  dealtTo?: string;
  /** Moved too often, or put apart by the room: talk about it. */
  contested?: boolean;
  /** The backlog story "Add to backlog" made from a pasted title. */
  sentTo?: HandoffLink[];
  room?: SizingRoomTotals;
}

export interface SizingBoard {
  id: string;
  title: string;
  mode: SizingMode;
  bucketSet: BucketSet;
  buckets: SizingBucket[];
  items: SizingItem[];
  moveLimit: number;
  /** The known story placed first, that the others are compared with. */
  anchorItemId?: string;
  createdAt: string;
  updatedAt: string;
  /** When Save sizes last wrote its points to the stories. */
  appliedAt?: string;
}

export interface SavedSizingRound {
  roundId: string;
  boardId: string;
  closedAt: string;
  source: "live" | "facilitator";
  ballots: number;
  minN: number;
  /** Per story: people per bucket (null: withheld, fewer than minN placed it). */
  stories: { itemId: string; title: string; counts: number[] | null; responses: number }[];
}

export interface RelativeSizingState {
  boards: SizingBoard[];
  activeBoardId: string | null;
  rounds: SavedSizingRound[];
}

export const RELATIVE_SIZING_INITIAL: RelativeSizingState = {
  boards: [],
  activeBoardId: null,
  rounds: [],
};

/* ── Reading ─────────────────────────────────────────────────────────── */

const cut = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/** One line, trimmed and capped (an ellipsis marks a cut). */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return cut(value.replace(/\s+/g, " ").trim(), max);
}

const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= SIZING_LIMITS.id;

const isTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

const whole = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

const LEVELS: readonly ConsensusLevel[] = ["agree", "close", "spread"];

function readLinks(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HandoffLink[] = [];
  for (const l of raw) {
    const o = l as Record<string, unknown> | null;
    if (!o || typeof o !== "object") continue;
    if (!oneOf(HANDOFF_ROUTE_IDS, o.route) || typeof o.targetId !== "string" || !o.targetId)
      continue;
    if (typeof o.at !== "string") continue;
    const link = { route: o.route, targetId: o.targetId, at: o.at };
    const at = out.findIndex((x) => x.route === link.route);
    if (at >= 0) out[at] = link;
    else out.push(link);
  }
  return out.length > 0 ? out : undefined;
}

/** A bucket's points: a whole or decimal number from 0 to 1,000, or none. */
export function cleanPoints(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= SIZING_LIMITS.pointsMax
    ? v
    : undefined;
}

function readBuckets(raw: unknown): SizingBucket[] {
  const out: SizingBucket[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= SIZING_LIMITS.bucketsMax) break;
    const o = x as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isId(o.id) || ids.has(o.id)) continue;
    const label = cleanLine(o.label, SIZING_LIMITS.bucketLabel);
    if (!label || labels.has(label.toLowerCase())) continue;
    const bucket: SizingBucket = { id: o.id, label };
    const points = cleanPoints(o.points);
    if (points !== undefined) bucket.points = points;
    out.push(bucket);
    ids.add(o.id);
    labels.add(label.toLowerCase());
  }
  return out;
}

function readTotals(raw: unknown, buckets: number): SizingRoomTotals | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.counts) || o.counts.length !== buckets) return undefined;
  const counts = o.counts.map((c) => whole(c, 0, SIZING_LIMITS.countMax));
  if (counts.some((c) => c === null)) return undefined;
  const responses = whole(o.responses, 0, SIZING_LIMITS.countMax) ?? 0;
  return {
    counts: counts as number[],
    responses,
    level: oneOf(LEVELS, o.level) ? o.level : null,
  };
}

function readItems(raw: unknown, buckets: readonly SizingBucket[]): SizingItem[] {
  const bucketIds = new Set(buckets.map((b) => b.id));
  const out: SizingItem[] = [];
  const ids = new Set<string>();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= SIZING_LIMITS.items) break;
    const o = x as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isId(o.id) || ids.has(o.id)) continue;
    const title = cleanLine(o.title, SIZING_LIMITS.itemTitle);
    if (!title) continue;
    const item: SizingItem = {
      id: o.id,
      title,
      bucketId: isId(o.bucketId) && bucketIds.has(o.bucketId) ? o.bucketId : null,
      moves: whole(o.moves, 0, SIZING_LIMITS.movesMax) ?? 0,
    };
    if (isId(o.storyId)) item.storyId = o.storyId;
    const dealtTo = cleanLine(o.dealtTo, SIZING_LIMITS.name);
    if (dealtTo) item.dealtTo = dealtTo;
    if (o.contested === true) item.contested = true;
    const sentTo = readLinks(o.sentTo);
    if (sentTo) item.sentTo = sentTo;
    const room = readTotals(o.room, buckets.length);
    if (room) item.room = room;
    out.push(item);
    ids.add(o.id);
  }
  return out;
}

/** A stored board made safe to read, or null when it isn't one (or has under 2 buckets). */
export function normalizeBoard(raw: unknown): SizingBoard | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isId(r.id)) return null;
  const buckets = readBuckets(r.buckets);
  if (buckets.length < SIZING_LIMITS.bucketsMin) return null;
  const items = readItems(r.items, buckets);
  const updatedAt = isTime(r.updatedAt) ? r.updatedAt : new Date(0).toISOString();
  const board: SizingBoard = {
    id: r.id,
    title: cleanLine(r.title, SIZING_LIMITS.title) || "Untitled board",
    mode: oneOf(SIZING_MODES, r.mode) ? r.mode : "silent",
    bucketSet: oneOf(BUCKET_SETS, r.bucketSet) ? r.bucketSet : "custom",
    buckets,
    items,
    moveLimit:
      whole(r.moveLimit, SIZING_LIMITS.moveLimitMin, SIZING_LIMITS.moveLimitMax) ??
      SIZING_LIMITS.moveLimitDefault,
    createdAt: isTime(r.createdAt) ? r.createdAt : updatedAt,
    updatedAt,
  };
  if (isId(r.anchorItemId) && items.some((i) => i.id === r.anchorItemId)) {
    board.anchorItemId = r.anchorItemId;
  }
  if (isTime(r.appliedAt)) board.appliedAt = r.appliedAt;
  return board;
}

function normalizeRound(raw: unknown): SavedSizingRound | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isId(r.roundId) || !isId(r.boardId) || !isTime(r.closedAt)) return null;
  const stories: SavedSizingRound["stories"] = [];
  for (const x of Array.isArray(r.stories) ? r.stories : []) {
    if (stories.length >= SIZING_LIMITS.items) break;
    const o = x as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isId(o.itemId)) continue;
    let counts: number[] | null = null;
    if (Array.isArray(o.counts) && o.counts.length <= SIZING_LIMITS.bucketsMax) {
      const c = o.counts.map((n) => whole(n, 0, SIZING_LIMITS.countMax));
      if (c.every((n) => n !== null)) counts = c as number[];
    }
    stories.push({
      itemId: o.itemId,
      title: cleanLine(o.title, SIZING_LIMITS.itemTitle),
      counts,
      responses: whole(o.responses, 0, SIZING_LIMITS.countMax) ?? 0,
    });
  }
  return {
    roundId: r.roundId,
    boardId: r.boardId,
    closedAt: r.closedAt,
    source: r.source === "facilitator" ? "facilitator" : "live",
    ballots: whole(r.ballots, 0, SIZING_LIMITS.countMax) ?? 0,
    minN: whole(r.minN, 1, SIZING_LIMITS.countMax) ?? 3,
    stories,
  };
}

/** Boards read back: valid ones, each id once, in the order saved, capped. */
export function normalizeBoards(raw: unknown): SizingBoard[] {
  const out: SizingBoard[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= SIZING_LIMITS.boards) break;
    const b = normalizeBoard(x);
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

/** The whole store read back, with every key of the initial state. */
export function normalizeRelativeSizingState(raw: unknown): RelativeSizingState {
  const r =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const boards = normalizeBoards(r.boards);
  const rounds: SavedSizingRound[] = [];
  for (const x of Array.isArray(r.rounds) ? r.rounds : []) {
    const round = normalizeRound(x);
    if (round) rounds.push(round);
  }
  const active =
    isId(r.activeBoardId) && boards.some((b) => b.id === r.activeBoardId) ? r.activeBoardId : null;
  return { boards, activeBoardId: active, rounds: rounds.slice(-SIZING_LIMITS.rounds) };
}
