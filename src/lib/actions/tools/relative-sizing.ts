/**
 * Relative Sizing — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (tools plan, phase 2)
 *
 * Agent surface: tool.relative_sizing.*
 * Backing store: the tool store `agile-toolkit:relative-sizing` (boards,
 *                the open board, saved rounds), read and written through
 *                lib/relative-sizing/state's normaliser. On the server the
 *                store is the user's synced row, patched with
 *                serverPatchUserStateBlob (the key is on
 *                SERVER_WRITABLE_BLOB_KEYS).
 *
 *   1. list_state  — every board: its buckets, its stories (bucket, moves,
 *                    to talk about, the last live round's totals) and counts.
 *   2. create_board — a board from titles, or from the backlog's unsized
 *                    stories, with a set of buckets.
 *   3. place       — a story into a bucket by its label (null: not placed),
 *                    counting a move as the page does.
 *   4. apply_sizes — Save sizes: the buckets' points written to the
 *                    workspace stories, with what was skipped and why.
 *
 * The board writes run the planners the page runs (lib/relative-sizing/
 * model). There is no room verb: a live round starts only from the page.
 * The page logs history, not these verbs. Every verb is the visitor's own
 * data, so none is kept from visitors.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverGetEntity,
  serverGetUserStateBlob,
  serverListEntities,
  serverPatchUserStateBlob,
  serverUpsertEntity,
} from "../server-store";
import type { Story } from "@/lib/stores/workspace-types";
import { stampStoryWrite } from "@/lib/sprints/story-status";
import { cleanStoryFields } from "@/lib/stories/fields";
import {
  BOARD_ID_PREFIX,
  ITEM_ID_PREFIX,
  SKIP_TEXT,
  boardCounts,
  bucketOf,
  bucketsFor,
  planApplied,
  planCreateBoard,
  planPlace,
  sizesToWrite,
  unsizedItems,
  type NewItem,
} from "@/lib/relative-sizing/model";
import {
  BUCKET_SETS,
  RELATIVE_SIZING_STORE_KEY,
  SIZING_LIMITS,
  normalizeRelativeSizingState,
  type RelativeSizingState,
} from "@/lib/relative-sizing/state";
import {
  hydrateRelativeSizing,
  relativeSizingState,
  updateRelativeSizing,
} from "@/lib/relative-sizing/store";

const ws = () => useWorkspaceStore.getState();
const nowIso = () => new Date().toISOString();
const KIND_STORY = "workspace:story";

/** What every write verb's description says about an open page (BUG-S14). */
const DIRTY_TAB =
  "Over MCP it writes the user's synced data; a page open with a change not yet saved keeps its own copy.";

/** Where the verbs read and write the board data and the stories. */
interface Store {
  state: () => Promise<RelativeSizingState>;
  /**
   * Run a planner on the stored data and write what it returns (null:
   * nothing). Returns false when nothing could be written.
   */
  write: (plan: (state: RelativeSizingState) => RelativeSizingState | null) => Promise<boolean>;
  stories: () => Promise<Story[]>;
  putPoints: (storyId: string, points: number) => Promise<boolean>;
}

const browserStore: Store = {
  state: async () => {
    await hydrateRelativeSizing();
    return relativeSizingState();
  },
  write: async (plan) => {
    await hydrateRelativeSizing();
    return updateRelativeSizing(plan);
  },
  stories: async () => ws().stories ?? [],
  putPoints: async (storyId, points) => {
    const story = (ws().stories ?? []).find((s) => s.id === storyId);
    if (!story) return false;
    // The store stamps and cleans every story write itself.
    ws().upsertStory({ ...story, points });
    return true;
  },
};

const serverStore = (userId: string): Store => ({
  state: async () =>
    normalizeRelativeSizingState(await serverGetUserStateBlob(userId, RELATIVE_SIZING_STORE_KEY)),
  write: async (plan) => {
    const r = await serverPatchUserStateBlob(userId, RELATIVE_SIZING_STORE_KEY, (current) => {
      const next = plan(normalizeRelativeSizingState(current));
      return next ? normalizeRelativeSizingState(next) : null;
    });
    return r.written;
  },
  stories: () => serverListEntities<Story>(userId, KIND_STORY),
  putPoints: async (storyId, points) => {
    const current = await serverGetEntity<Story>(userId, KIND_STORY, storyId);
    if (!current) return false;
    // Stamped and cleaned as workspace.story.* does on the server.
    await serverUpsertEntity<Story>(
      userId,
      KIND_STORY,
      stampStoryWrite(cleanStoryFields({ ...current, points }), current)
    );
    return true;
  },
});

/* ── list_state ──────────────────────────────────────────────────────── */

function summarize(state: RelativeSizingState) {
  return {
    activeBoardId: state.activeBoardId,
    savedRounds: state.rounds.length,
    boards: state.boards.map((b) => ({
      id: b.id,
      title: b.title,
      mode: b.mode,
      bucketSet: b.bucketSet,
      moveLimit: b.moveLimit,
      buckets: b.buckets.map((x) => ({ label: x.label, points: x.points ?? null })),
      counts: boardCounts(b),
      anchorItemId: b.anchorItemId ?? null,
      appliedAt: b.appliedAt ?? null,
      items: b.items.map((i) => ({
        id: i.id,
        title: i.title,
        storyId: i.storyId ?? null,
        bucket: bucketOf(b, i)?.label ?? null,
        moves: i.moves,
        toTalkAbout: i.contested === true,
        roomCounts: i.room?.counts ?? null,
      })),
      updatedAt: b.updatedAt,
    })),
  };
}

registry.register({
  id: "tool.relative_sizing.list_state",
  toolId: "tool.relative_sizing",
  name: "list_state",
  category: "read",
  description:
    "Summarise the Relative Sizing boards. Returns {activeBoardId, savedRounds, boards:{id, title, mode ('silent'|'buckets'), bucketSet, moveLimit, buckets:{label, points|null}[] (smallest first), counts:{items, placed, unplaced, contested}, anchorItemId|null, appliedAt|null (when Save sizes last wrote points), items:{id, title, storyId|null (the workspace story it sizes), bucket|null (its bucket's label), moves, toTalkAbout, roomCounts|null (people per bucket in the last live round, totals only)}[], updatedAt}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.state()),
  mcpHandler: async (_p, ctx) => summarize(await serverStore(ctx.userId).state()),
});

/* ── create_board ────────────────────────────────────────────────────── */

const CreateParams = z
  .object({
    title: z.string().trim().min(1).max(SIZING_LIMITS.title).describe("The board's name."),
    bucketSet: z
      .enum(BUCKET_SETS)
      .describe(
        "fibonacci (1–21), tshirt (XS–XXL, no points until mapped), powers (1–32), linear (1–10), wide (1–100), or custom with `buckets`."
      ),
    buckets: z
      .array(z.string().trim().min(1).max(SIZING_LIMITS.bucketLabel))
      .min(SIZING_LIMITS.bucketsMin)
      .max(SIZING_LIMITS.bucketsMax)
      .optional()
      .describe("custom only: the bucket labels, smallest first; numbers become points."),
    titles: z
      .array(z.string().trim().min(1).max(SIZING_LIMITS.itemTitle))
      .max(SIZING_LIMITS.items)
      .optional()
      .describe("Story titles to size (not yet in the backlog)."),
    fromUnsizedBacklog: z
      .boolean()
      .optional()
      .describe("true: size the backlog's unsized stories (in the backlog, no points, no sprint)."),
  })
  .refine((p) => (p.titles?.length ?? 0) > 0 || p.fromUnsizedBacklog === true, {
    message: "Give titles, or fromUnsizedBacklog: true.",
  })
  .refine((p) => p.bucketSet !== "custom" || (p.buckets?.length ?? 0) >= 2, {
    message: "A custom set needs its bucket labels.",
  });

async function createBoard(store: Store, p: z.infer<typeof CreateParams>) {
  const fromBacklog: NewItem[] = p.fromUnsizedBacklog ? unsizedItems(await store.stories()) : [];
  const typed: NewItem[] = (p.titles ?? []).map((title) => ({ title }));
  const buckets = bucketsFor(p.bucketSet, p.bucketSet === "custom" ? (p.buckets ?? []) : []);
  // Ids made once, outside the planner, so a write that re-runs makes the same board.
  const boardId = `${BOARD_ID_PREFIX}${nanoid(8)}`;
  const itemPrefix = `${ITEM_ID_PREFIX}${nanoid(6)}_`;
  const now = nowIso();
  let answer: ReturnType<typeof planCreateBoard> | null = null;
  const written = await store.write((state) => {
    answer = planCreateBoard(
      state,
      { title: p.title, bucketSet: p.bucketSet, buckets, items: [...fromBacklog, ...typed] },
      { boardId, itemId: (i) => `${itemPrefix}${i}` },
      now
    );
    return answer.ok ? answer.state : null;
  });
  const a = answer as ReturnType<typeof planCreateBoard> | null;
  if (!a) return { created: false as const, reason: "The board data couldn't be read." };
  if (!a.ok) return { created: false as const, reason: a.reason };
  if (!written)
    return { created: false as const, reason: "The board couldn't be saved: it may be too big." };
  return {
    created: true as const,
    boardId,
    items: a.board.items.length,
    buckets: a.board.buckets.map((b) => b.label),
  };
}

registry.register({
  id: "tool.relative_sizing.create_board",
  toolId: "tool.relative_sizing",
  name: "create_board",
  category: "write",
  requiresConfirmation: false,
  description: `Start a Relative Sizing board: titles to size (up to 100), or the backlog's unsized stories (fromUnsizedBacklog), and a set of buckets. Every card starts not placed, and the board opens on the page. Returns {created: true, boardId, items, buckets} or {created: false, reason} (20 boards at most). ${DIRTY_TAB}`,
  paramsSchema: CreateParams,
  handler: (p) => createBoard(browserStore, p),
  mcpHandler: (p, ctx) => createBoard(serverStore(ctx.userId), p),
});

/* ── place ───────────────────────────────────────────────────────────── */

const PlaceParams = z.object({
  boardId: z.string().min(1).describe("The board's id (see list_state)."),
  itemId: z.string().min(1).describe("The story card's id on that board (see list_state)."),
  bucket: z
    .string()
    .trim()
    .min(1)
    .max(SIZING_LIMITS.bucketLabel)
    .nullable()
    .describe('The bucket\'s label ("5", "M"); null takes it out of every bucket.'),
});

async function place(store: Store, p: z.infer<typeof PlaceParams>) {
  const now = nowIso();
  let answer: ReturnType<typeof planPlace> | null = null;
  const written = await store.write((state) => {
    answer = planPlace(state, p, now);
    return answer.ok && answer.moved ? answer.state : null;
  });
  const a = answer as ReturnType<typeof planPlace> | null;
  if (!a) return { placed: false as const, reason: "The board data couldn't be read." };
  if (!a.ok) return { placed: false as const, reason: a.reason };
  if (a.moved && !written)
    return { placed: false as const, reason: "The board couldn't be saved." };
  return { placed: true as const, moved: a.moved, moves: a.moves, toTalkAbout: a.toTalk };
}

registry.register({
  id: "tool.relative_sizing.place",
  toolId: "tool.relative_sizing",
  name: "place",
  category: "write",
  requiresConfirmation: false,
  description: `Put a story card in a bucket by the bucket's label, or take it out (null). Leaving a bucket counts a move; at the board's move limit the card goes to Talk about it. Returns {placed: true, moved, moves, toTalkAbout} or {placed: false, reason}. ${DIRTY_TAB}`,
  paramsSchema: PlaceParams,
  handler: (p) => place(browserStore, p),
  mcpHandler: (p, ctx) => place(serverStore(ctx.userId), p),
});

/* ── apply_sizes ─────────────────────────────────────────────────────── */

const ApplyParams = z.object({
  boardId: z.string().min(1).describe("The board's id (see list_state)."),
});

async function applySizes(store: Store, p: z.infer<typeof ApplyParams>) {
  const state = await store.state();
  const board = state.boards.find((b) => b.id === p.boardId);
  if (!board) return { written: 0, skipped: [], reason: "No board has that id." };
  const plan = sizesToWrite(board, await store.stories());
  const skipped = plan.skipped.map((s) => ({ title: s.title, why: SKIP_TEXT[s.why] }));
  let written = 0;
  for (const w of plan.writes) {
    if (await store.putPoints(w.storyId, w.points)) written += 1;
    else skipped.push({ title: w.title, why: SKIP_TEXT["story-gone"] });
  }
  if (written > 0) {
    const now = nowIso();
    await store.write((s) => planApplied(s, board.id, now));
  }
  return { written, skipped };
}

registry.register({
  id: "tool.relative_sizing.apply_sizes",
  toolId: "tool.relative_sizing",
  name: "apply_sizes",
  category: "write",
  requiresConfirmation: false,
  description: `Save sizes: write each placed card's bucket points to its workspace story. Skipped, with why: example stories, titles not in the backlog yet, cards not placed or still to talk about, buckets with no points (T-shirt sizes not mapped), stories that already have those points. Returns {written, skipped:{title, why}[]}. ${DIRTY_TAB}`,
  paramsSchema: ApplyParams,
  handler: (p) => applySizes(browserStore, p),
  mcpHandler: (p, ctx) => applySizes(serverStore(ctx.userId), p),
});
