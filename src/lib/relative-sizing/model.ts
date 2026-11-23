/**
 * Relative Sizing: the rules every reader shares (the page, Amr's verbs in
 * the browser and on the server). Pure: no store, no browser globals, no
 * "use client" module, no live-room code (that is ./live.ts, which only the
 * page loads).
 *
 * A board holds the stories being sized and its buckets. A card moved
 * between buckets counts a move; at the board's move limit it goes to "Talk
 * about it". The planners at the end (`planCreateBoard`, `planPlace`,
 * `planSizes`) are what the page's verbs and Amr's MCP handlers both run,
 * so a board an agent wrote is one the page would have written.
 */

import { cardsOf } from "@/lib/estimation/decks";
import { isEstimateCard } from "@/lib/estimation/consensus";
import type { Story } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import type { Validation } from "@/lib/utils/form";
import { createRng, shuffle } from "@/lib/utils/random";
import { unsizedBacklog } from "./unsized";
import {
  SIZING_LIMITS,
  cleanLine,
  cleanPoints,
  type BucketSet,
  type RelativeSizingState,
  type SizingBoard,
  type SizingBucket,
  type SizingItem,
  type SizingMode,
} from "./state";

export const RELATIVE_SIZING_TOOL = "relative-sizing";
export const RELATIVE_SIZING_PATH = "/relative-sizing";
export const BOARD_ID_PREFIX = "sizing_";
export const ITEM_ID_PREFIX = "card_";

export const BUCKET_SET_LABEL: Record<BucketSet, string> = {
  fibonacci: "Fibonacci",
  tshirt: "T-shirt sizes",
  powers: "Powers of 2",
  linear: "1 to 10",
  wide: "Wide (1 to 100)",
  custom: "Your own",
};

/** Our own wide set: small steps first, then big jumps for the epics. */
export const WIDE_SET = [1, 2, 3, 5, 8, 13, 20, 40, 100] as const;

/** The guide scale each set's points come from. */
const GUIDE: Partial<Record<BucketSet, string>> = {
  fibonacci: "Fibonacci",
  tshirt: "T-Shirt",
  powers: "Powers of 2",
  linear: "Linear",
};

/** The Planning Poker deck type whose Estimation Guide notes a set's cards read. */
export function guideScaleOf(set: BucketSet): "fibonacci" | "tshirt" | "custom" {
  return set === "fibonacci" || set === "tshirt" ? set : "custom";
}

const bucketId = (i: number) => `b${i + 1}`;

/** A set's buckets: its labels, and points where the label is a number. */
export function bucketsFor(set: BucketSet, custom: readonly string[] = []): SizingBucket[] {
  const labels =
    set === "custom"
      ? custom
      : set === "wide"
        ? WIDE_SET.map(String)
        : cardsOf(GUIDE[set] as string);
  return labels.slice(0, SIZING_LIMITS.bucketsMax).map((raw, i) => {
    const label = cleanLine(raw, SIZING_LIMITS.bucketLabel);
    const n = Number(label);
    const points = /^\d+(\.\d+)?$/.test(label) ? cleanPoints(n) : undefined;
    return { id: bucketId(i), label, ...(points !== undefined ? { points } : {}) };
  });
}

/** Custom labels typed in one line: "1, 2, 3" or "S M L". */
export function splitLabels(text: string): string[] {
  return text
    .split(/[,;\n]+|\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Why these buckets can't size a board, or null: 2 to 11 of them, each a
 * label of up to 8 characters that a vote counts as a size (not "?", "∞"
 * or a coffee) and that no other bucket has (case and spacing aside), and
 * points from 0 to 1,000 where set.
 */
export function bucketsProblem(
  buckets: readonly Pick<SizingBucket, "label" | "points">[]
): string | null {
  if (buckets.length < SIZING_LIMITS.bucketsMin) return "Give at least two buckets.";
  if (buckets.length > SIZING_LIMITS.bucketsMax) {
    return `A board holds ${SIZING_LIMITS.bucketsMax} buckets at most.`;
  }
  const seen = new Set<string>();
  for (const b of buckets) {
    const label = b.label.trim();
    if (!label) return "Every bucket needs a label.";
    if (label.length > SIZING_LIMITS.bucketLabel) {
      return `Keep “${label}” to ${SIZING_LIMITS.bucketLabel} characters.`;
    }
    if (!isEstimateCard(label))
      return `“${label}” isn't a size: use numbers or sizes like S, M, L.`;
    const key = label.toLowerCase();
    if (seen.has(key)) return `“${label}” is there twice: each bucket needs its own label.`;
    seen.add(key);
    if (b.points !== undefined && cleanPoints(b.points) === undefined) {
      return `Points for “${label}” go from 0 to ${SIZING_LIMITS.pointsMax}.`;
    }
  }
  return null;
}

export function validateBuckets(
  buckets: readonly Pick<SizingBucket, "label" | "points">[]
): Validation<SizingBucket[], "buckets"> {
  const problem = bucketsProblem(buckets);
  if (problem) return { ok: false, errors: { buckets: problem } };
  return {
    ok: true,
    values: buckets.map((b, i) => ({
      id: bucketId(i),
      label: b.label.trim(),
      ...(b.points !== undefined ? { points: b.points } : {}),
    })),
  };
}

/* ── A board ─────────────────────────────────────────────────────────── */

export interface NewItem {
  title: string;
  storyId?: string;
}

export interface NewBoard {
  title: string;
  bucketSet: BucketSet;
  buckets: SizingBucket[];
  items: readonly NewItem[];
  mode?: SizingMode;
  moveLimit?: number;
}

/** A board with every card not placed yet; titles capped, blanks and repeats of a story dropped. */
export function newBoard(
  input: NewBoard,
  id: string,
  now: string,
  itemId: (i: number) => string
): SizingBoard {
  const seen = new Set<string>();
  const items: SizingItem[] = [];
  for (const x of input.items) {
    if (items.length >= SIZING_LIMITS.items) break;
    const title = cleanLine(x.title, SIZING_LIMITS.itemTitle);
    if (!title || (x.storyId && seen.has(x.storyId))) continue;
    if (x.storyId) seen.add(x.storyId);
    items.push({
      id: itemId(items.length),
      title,
      bucketId: null,
      moves: 0,
      ...(x.storyId ? { storyId: x.storyId } : {}),
    });
  }
  const limit = input.moveLimit;
  return {
    id,
    title: cleanLine(input.title, SIZING_LIMITS.title) || "Untitled board",
    mode: input.mode ?? "silent",
    bucketSet: input.bucketSet,
    buckets: input.buckets,
    items,
    moveLimit:
      typeof limit === "number" &&
      Number.isInteger(limit) &&
      limit >= SIZING_LIMITS.moveLimitMin &&
      limit <= SIZING_LIMITS.moveLimitMax
        ? limit
        : SIZING_LIMITS.moveLimitDefault,
    createdAt: now,
    updatedAt: now,
  };
}

/** The workspace stories a board can be started from: the backlog's unsized ones. */
export function unsizedItems(stories: readonly Story[]): NewItem[] {
  return unsizedBacklog(stories)
    .filter((s) => s.title.trim())
    .map((s) => ({ title: s.title, storyId: s.id }));
}

const touched = (b: SizingBoard, patch: Partial<SizingBoard>, now: string): SizingBoard => ({
  ...b,
  ...patch,
  updatedAt: now,
});

const withItem = (b: SizingBoard, id: string, fn: (i: SizingItem) => SizingItem, now: string) =>
  touched(b, { items: b.items.map((i) => (i.id === id ? fn(i) : i)) }, now);

/** The lanes a card can be in: not placed, a bucket, or Talk about it. */
export type Lane = { kind: "unplaced" } | { kind: "bucket"; bucketId: string } | { kind: "talk" };

export const UNPLACED_LANE = "lane:unplaced";
export const TALK_LANE = "lane:talk";

/** A lane as an id (for drop targets): a bucket's own id, or one of the two lane ids. */
export function laneId(lane: Lane): string {
  return lane.kind === "bucket" ? lane.bucketId : lane.kind === "talk" ? TALK_LANE : UNPLACED_LANE;
}

export function laneOf(item: SizingItem): Lane {
  if (item.contested) return { kind: "talk" };
  return item.bucketId ? { kind: "bucket", bucketId: item.bucketId } : { kind: "unplaced" };
}

export function readLane(board: SizingBoard, id: string): Lane | null {
  if (id === UNPLACED_LANE) return { kind: "unplaced" };
  if (id === TALK_LANE) return { kind: "talk" };
  return board.buckets.some((b) => b.id === id) ? { kind: "bucket", bucketId: id } : null;
}

export interface MoveResult {
  board: SizingBoard;
  /** It changed lane. */
  moved: boolean;
  /** This move sent it to Talk about it (its move limit reached). */
  toTalk: boolean;
}

/**
 * A card moved to a lane. Leaving a bucket counts a move (a first
 * placement doesn't); at the board's move limit the card goes to Talk
 * about it, keeping the bucket it was put in last. Placing a card from
 * Talk about it settles it: the team agreed, so its moves start again.
 */
export function moveItem(board: SizingBoard, itemId: string, lane: Lane, now: string): MoveResult {
  const item = board.items.find((i) => i.id === itemId);
  const same = item ? laneId(laneOf(item)) === laneId(lane) : true;
  if (!item || same) return { board, moved: false, toTalk: false };
  let toTalk = false;
  const next = withItem(
    board,
    itemId,
    (i) => {
      if (lane.kind === "talk") return { ...i, contested: true };
      const out: SizingItem = { ...i };
      delete out.contested;
      if (i.contested) {
        out.moves = 0;
        out.bucketId = lane.kind === "bucket" ? lane.bucketId : null;
        return out;
      }
      if (i.bucketId) out.moves = Math.min(SIZING_LIMITS.movesMax, i.moves + 1);
      out.bucketId = lane.kind === "bucket" ? lane.bucketId : null;
      if (out.moves >= board.moveLimit && out.bucketId) {
        out.contested = true;
        toTalk = true;
      }
      return out;
    },
    now
  );
  return { board: next, moved: true, toTalk };
}

/** The bucket in the middle, where an anchor story usually goes. */
export function middleBucket(board: SizingBoard): SizingBucket {
  return board.buckets[Math.floor((board.buckets.length - 1) / 2)];
}

/** `itemId` as the anchor, placed in `bucketId` (no move counted); null clears the anchor. */
export function withAnchor(
  board: SizingBoard,
  itemId: string | null,
  bucketId: string,
  now: string
): SizingBoard {
  if (!itemId) {
    const next = touched(board, {}, now);
    delete next.anchorItemId;
    return next;
  }
  if (!board.items.some((i) => i.id === itemId)) return board;
  const placed = withItem(
    board,
    itemId,
    (i) => {
      const out: SizingItem = { ...i, bucketId, moves: 0 };
      delete out.contested;
      return out;
    },
    now
  );
  return { ...placed, anchorItemId: itemId };
}

/**
 * The cards dealt to `people`: the anchor left out, the rest shuffled with
 * `seed` (the same seed, the same deal) and handed round in turn. An empty
 * list takes the deal back.
 */
export function dealItems(
  board: SizingBoard,
  people: readonly string[],
  seed: string | number,
  now: string
): SizingBoard {
  const names = people.map((p) => cleanLine(p, SIZING_LIMITS.name)).filter(Boolean);
  const order = shuffle(
    board.items.filter((i) => i.id !== board.anchorItemId).map((i) => i.id),
    createRng(seed)
  );
  const to = new Map(order.map((id, i) => [id, names.length ? names[i % names.length] : ""]));
  return touched(
    board,
    {
      items: board.items.map((i) => {
        const out = { ...i };
        const who = to.get(i.id);
        if (who) out.dealtTo = who;
        else delete out.dealtTo;
        return out;
      }),
    },
    now
  );
}

/** Mode: silent sort or buckets. */
export function withMode(board: SizingBoard, mode: SizingMode, now: string): SizingBoard {
  return touched(board, { mode }, now);
}

/** New items at the end (an accepted split), unplaced, within the board's cap. */
export function withNewItems(
  board: SizingBoard,
  items: readonly NewItem[],
  now: string,
  itemId: (i: number) => string
): { board: SizingBoard; added: string[] } {
  const added: SizingItem[] = [];
  for (const x of items) {
    if (board.items.length + added.length >= SIZING_LIMITS.items) break;
    const title = cleanLine(x.title, SIZING_LIMITS.itemTitle);
    if (!title) continue;
    added.push({
      id: itemId(added.length),
      title,
      bucketId: null,
      moves: 0,
      ...(x.storyId ? { storyId: x.storyId } : {}),
    });
  }
  return {
    board: touched(board, { items: [...board.items, ...added] }, now),
    added: added.map((i) => i.id),
  };
}

export function withoutItems(board: SizingBoard, ids: readonly string[], now: string): SizingBoard {
  const drop = new Set(ids);
  const next = touched(board, { items: board.items.filter((i) => !drop.has(i.id)) }, now);
  if (next.anchorItemId && drop.has(next.anchorItemId)) delete next.anchorItemId;
  return next;
}

/* ── Reading a board ─────────────────────────────────────────────────── */

export interface BoardCounts {
  items: number;
  placed: number;
  unplaced: number;
  contested: number;
}

export function boardCounts(board: SizingBoard): BoardCounts {
  const contested = board.items.filter((i) => i.contested).length;
  const placed = board.items.filter((i) => !i.contested && i.bucketId).length;
  return {
    items: board.items.length,
    placed,
    unplaced: board.items.length - placed - contested,
    contested,
  };
}

export function itemsIn(board: SizingBoard, lane: Lane): SizingItem[] {
  const id = laneId(lane);
  return board.items.filter((i) => laneId(laneOf(i)) === id);
}

export function bucketOf(board: SizingBoard, item: SizingItem): SizingBucket | undefined {
  return item.bucketId ? board.buckets.find((b) => b.id === item.bucketId) : undefined;
}

/** "3 ×2, 8 ×3, 13 ×1": where the room put a story, buckets with nobody left out. */
export function roomLine(board: SizingBoard, counts: readonly number[]): string {
  return board.buckets
    .map((b, i) => ({ label: b.label, n: counts[i] ?? 0 }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.label} ×${x.n}`)
    .join(", ");
}

/* ── Save sizes ──────────────────────────────────────────────────────── */

export type SkipReason =
  | "example"
  | "not-in-backlog"
  | "story-gone"
  | "not-placed"
  | "to-talk-about"
  | "no-points"
  | "already";

export const SKIP_TEXT: Record<SkipReason, string> = {
  example: "an example story",
  "not-in-backlog": "not in the backlog yet",
  "story-gone": "its story is gone",
  "not-placed": "not placed",
  "to-talk-about": "still to talk about",
  "no-points": "its bucket has no points",
  already: "already has those points",
};

export interface SizeWrite {
  itemId: string;
  storyId: string;
  title: string;
  points: number;
  before: number | undefined;
}

export interface SizesPlan {
  writes: SizeWrite[];
  skipped: { itemId: string; title: string; why: SkipReason }[];
}

/**
 * What Save sizes would write: each card on a workspace story, placed in a
 * bucket with points, as that story's points. Never an example's story,
 * never a card still to talk about; a pasted title not in the backlog, a
 * T-shirt bucket with no points mapped, a card not placed and a story that
 * already has those points are skipped, each with why.
 */
export function sizesToWrite(board: SizingBoard, stories: readonly Story[]): SizesPlan {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const plan: SizesPlan = { writes: [], skipped: [] };
  for (const item of board.items) {
    const skip = (why: SkipReason) =>
      plan.skipped.push({ itemId: item.id, title: item.title, why });
    if (isExampleId(item.id) || isExampleId(item.storyId)) {
      skip("example");
      continue;
    }
    if (!item.storyId) {
      skip("not-in-backlog");
      continue;
    }
    const story = byId.get(item.storyId);
    if (!story) {
      skip("story-gone");
      continue;
    }
    if (item.contested) {
      skip("to-talk-about");
      continue;
    }
    const bucket = bucketOf(board, item);
    if (!bucket) {
      skip("not-placed");
      continue;
    }
    if (bucket.points === undefined) {
      skip("no-points");
      continue;
    }
    if (story.points === bucket.points) {
      skip("already");
      continue;
    }
    plan.writes.push({
      itemId: item.id,
      storyId: story.id,
      title: story.title,
      points: bucket.points,
      before: story.points,
    });
  }
  return plan;
}

/** "3 skipped: 2 not in the backlog yet, 1 still to talk about." */
export function skippedLine(plan: SizesPlan): string {
  if (plan.skipped.length === 0) return "";
  const by = new Map<SkipReason, number>();
  for (const s of plan.skipped) by.set(s.why, (by.get(s.why) ?? 0) + 1);
  const parts = Array.from(by.entries()).map(([why, n]) => `${n} ${SKIP_TEXT[why]}`);
  return `${plan.skipped.length} skipped: ${parts.join(", ")}.`;
}

/* ── The planners the page and Amr share ─────────────────────────────── */

export type Planned<T> =
  | ({ ok: true; state: RelativeSizingState } & T)
  | { ok: false; reason: string };

/** A new board at the front, opened. Refused with 20 boards, no buckets that work or no stories. */
export function planCreateBoard(
  state: RelativeSizingState,
  input: NewBoard,
  ids: { boardId: string; itemId: (i: number) => string },
  now: string
): Planned<{ board: SizingBoard }> {
  if (state.boards.length >= SIZING_LIMITS.boards) {
    return { ok: false, reason: `${SIZING_LIMITS.boards} boards at most: delete one first.` };
  }
  const problem = bucketsProblem(input.buckets);
  if (problem) return { ok: false, reason: problem };
  const board = newBoard(input, ids.boardId, now, ids.itemId);
  if (board.items.length === 0) return { ok: false, reason: "There are no stories to size." };
  return {
    ok: true,
    board,
    state: { ...state, boards: [board, ...state.boards], activeBoardId: board.id },
  };
}

/** A card moved to the bucket labelled `bucket` (null: not placed), as the page moves it. */
export function planPlace(
  state: RelativeSizingState,
  input: { boardId: string; itemId: string; bucket: string | null },
  now: string
): Planned<{ moved: boolean; toTalk: boolean; moves: number }> {
  const board = state.boards.find((b) => b.id === input.boardId);
  if (!board) return { ok: false, reason: "No board has that id." };
  if (!board.items.some((i) => i.id === input.itemId)) {
    return { ok: false, reason: "No card on that board has that id." };
  }
  let lane: Lane = { kind: "unplaced" };
  if (input.bucket !== null) {
    const key = input.bucket.trim().toLowerCase();
    const bucket = board.buckets.find((b) => b.label.toLowerCase() === key);
    if (!bucket) {
      return {
        ok: false,
        reason: `No bucket is labelled “${input.bucket}”: use ${board.buckets.map((b) => b.label).join(", ")}.`,
      };
    }
    lane = { kind: "bucket", bucketId: bucket.id };
  }
  const r = moveItem(board, input.itemId, lane, now);
  const moves = r.board.items.find((i) => i.id === input.itemId)?.moves ?? 0;
  return {
    ok: true,
    moved: r.moved,
    toTalk: r.toTalk,
    moves,
    state: { ...state, boards: state.boards.map((b) => (b.id === board.id ? r.board : b)) },
  };
}

/** The board marked as applied (Save sizes wrote its points), when it is still there. */
export function planApplied(
  state: RelativeSizingState,
  boardId: string,
  now: string
): RelativeSizingState | null {
  if (!state.boards.some((b) => b.id === boardId)) return null;
  return {
    ...state,
    boards: state.boards.map((b) =>
      b.id === boardId ? { ...b, appliedAt: now, updatedAt: now } : b
    ),
  };
}
