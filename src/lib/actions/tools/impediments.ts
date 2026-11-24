/**
 * Impediments — tool-local actions.
 *
 * Category: Ceremonies (squad S3 — run the sprint)
 *
 * Agent surface: tool.impediments.*
 * Backing CRUD : workspace.impediment.* (auto-generated), the one store the
 *                Impediments page, the cockpit and hand-offs use. Status is
 *                derived from `resolvedAt` / `escalatedAt`
 *                (lib/impediments/model), so changing it goes through
 *                set_status rather than a hand-written date.
 *
 *   1. list_state — counts by status, overdue and critical ones, average
 *                   days to resolve, and the list in the page's order with
 *                   each one's status, age and due date.
 *   2. set_status — open | escalated | resolved, on a day (default today):
 *                   escalate, resolve, or reopen.
 *   3. list_blockers — where the blocked time goes (lib/impediments/blockers):
 *                   clusters ranked by blocked days (or impediments raised),
 *                   inside against outside, how blocked time hit finished
 *                   work, and what isn't clustered yet.
 *   4. set_cluster — put an impediment, or a blocked spell on a story or a
 *                   Flow-board card, in a cluster (or clear it).
 *   5. raise_cluster — raise a whole cluster as one impediment.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  BLOCK_SIDES,
  BLOCKER_CLUSTER_MAX,
  KANBAN_BOARD_ID,
  type BlockSide,
  type KanbanBoard,
  type KanbanCard,
  type Story,
} from "@/lib/stores/workspace-types";
import type { Impediment } from "@/lib/stores/workspace-types";
import { cleanCardFlowFields, stampBoardBlocks, withSpellNote } from "@/lib/flow/block-stamps";
import { stampStoryWrite } from "@/lib/sprints/story-status";
import { cleanStoryFields } from "@/lib/stories/fields";
import { isExampleId } from "@/lib/utils/example-id";
import {
  cleanClusterName,
  clusterImpediment,
  lastDays,
  openImpedimentFor,
  readBlockers,
  withImpedimentCluster,
} from "@/lib/impediments/blockers";
import { defaultClusterSide } from "@/lib/impediments/clusters";
import {
  daysOverdue,
  impedimentAgeDays,
  impedimentDueDate,
  impedimentStatus,
  impedimentSummary,
  sortImpediments,
  withImpedimentStatus,
} from "@/lib/impediments/model";

const KIND_IMP = "workspace:impediment";

const ws = () => useWorkspaceStore.getState();

/** Server-side "today" (UTC): an MCP agent has no locale. */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function listState(list: Impediment[], today: string) {
  return {
    today,
    ...impedimentSummary(list, today),
    impediments: sortImpediments(list, today).map((i) => ({
      ...i,
      status: impedimentStatus(i),
      ageDays: impedimentAgeDays(i, today),
      due: impedimentDueDate(i),
      daysOverdue: daysOverdue(i, today),
    })),
  };
}

const DateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("YYYY-MM-DD. Defaults to today (UTC).");

// ──────── tool.impediments.list_state ────────
registry.register({
  id: "tool.impediments.list_state",
  toolId: "tool.impediments",
  name: "list_state",
  category: "read",
  description:
    "Summarise the team's impediments as the Impediments page does. Returns {today, total, open, escalated, resolved, overdue (unresolved past due), critical (unresolved), avgResolutionDays | null, oldestOpenDays | null, impediments: (Impediment & {status: open|escalated|resolved, ageDays, due: YYYY-MM-DD | null, daysOverdue})[]} with escalated first, then open (overdue, most severe, oldest first), then resolved (latest first).",
  paramsSchema: z.object({ today: DateParam }),
  handler: async ({ today }) => listState(ws().impediments ?? [], today ?? todayUTC()),
  mcpHandler: async ({ today }, ctx) =>
    listState(await serverListEntities<Impediment>(ctx.userId, KIND_IMP), today ?? todayUTC()),
});

// ──────── tool.impediments.set_status ────────
registry.register({
  id: "tool.impediments.set_status",
  toolId: "tool.impediments",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Escalate, resolve or reopen an impediment: status open | escalated | resolved, on `date` (default today, UTC). Resolving keeps the escalation date; reopening clears both. Returns {updated: true, status} or {updated: false} for an unknown id.",
  paramsSchema: z.object({
    id: z.string().min(1),
    status: z.enum(["open", "escalated", "resolved"]),
    date: DateParam,
  }),
  handler: async ({ id, status, date }) => {
    const current = (ws().impediments ?? []).find((i) => i.id === id);
    if (!current) return { updated: false };
    const next = withImpedimentStatus(current, status, date ?? todayUTC());
    if (next !== current) ws().upsertImpediment(next);
    return { updated: true, status: impedimentStatus(next) };
  },
  mcpHandler: async ({ id, status, date }, ctx) => {
    const current = await serverGetEntity<Impediment>(ctx.userId, KIND_IMP, id);
    if (!current) return { updated: false };
    const next = withImpedimentStatus(current, status, date ?? todayUTC());
    if (next !== current) await serverUpsertEntity<Impediment>(ctx.userId, KIND_IMP, next);
    return { updated: true, status: impedimentStatus(next) };
  },
});

/* ── Blockers: clusters, blocked time (tools plan, phase 2) ─────────── */

const KIND_STORY = "workspace:story";
const KIND_KANBAN = "workspace:kanbanBoard";

/** Browser "today": the person's local day, as the page reads it. */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface BlockerStore {
  stories: () => Promise<Story[]>;
  board: () => Promise<KanbanBoard | null>;
  impediments: () => Promise<Impediment[]>;
  getImpediment: (id: string) => Promise<Impediment | null>;
  putImpediment: (next: Impediment) => Promise<void>;
  getStory: (id: string) => Promise<Story | null>;
  putStory: (next: Story, current: Story) => Promise<void>;
  putBoard: (next: KanbanBoard, current: KanbanBoard) => Promise<void>;
  today: () => string;
}

const boardOf = (boards: readonly KanbanBoard[] | undefined) =>
  (boards ?? []).find((b) => b.id === KANBAN_BOARD_ID) ?? null;

const browserBlockers: BlockerStore = {
  stories: async () => ws().stories ?? [],
  board: async () => boardOf(ws().kanbanBoards),
  impediments: async () => ws().impediments ?? [],
  getImpediment: async (id) => (ws().impediments ?? []).find((i) => i.id === id) ?? null,
  putImpediment: async (next) => ws().upsertImpediment(next),
  getStory: async (id) => (ws().stories ?? []).find((s) => s.id === id) ?? null,
  // The store cleans and stamps every story and board write itself.
  putStory: async (next) => ws().upsertStory(next),
  putBoard: async (next) => ws().upsertKanbanBoard(next),
  today: todayLocal,
};

const serverBlockers = (userId: string): BlockerStore => ({
  stories: () => serverListEntities<Story>(userId, KIND_STORY),
  board: () => serverGetEntity<KanbanBoard>(userId, KIND_KANBAN, KANBAN_BOARD_ID),
  impediments: () => serverListEntities<Impediment>(userId, KIND_IMP),
  getImpediment: (id) => serverGetEntity<Impediment>(userId, KIND_IMP, id),
  putImpediment: (next) => serverUpsertEntity<Impediment>(userId, KIND_IMP, next),
  getStory: (id) => serverGetEntity<Story>(userId, KIND_STORY, id),
  // Cleaned and stamped as workspace.story.* does on the server.
  putStory: (next, current) =>
    serverUpsertEntity<Story>(userId, KIND_STORY, stampStoryWrite(cleanStoryFields(next), current)),
  // Cleaned and stamped as workspace.kanban_board.* does on the server.
  putBoard: (next, current) =>
    serverUpsertEntity<KanbanBoard>(
      userId,
      KIND_KANBAN,
      stampBoardBlocks({ ...next, cards: next.cards.map(cleanCardFlowFields) }, current)
    ),
  today: todayUTC,
});

const cardsOf = (board: KanbanBoard | null): KanbanCard[] =>
  board && Array.isArray(board.cards) ? board.cards : [];

async function readFor(store: BlockerStore, days: number) {
  const [stories, board, impediments] = await Promise.all([
    store.stories(),
    store.board(),
    store.impediments(),
  ]);
  const today = store.today();
  return {
    stories,
    board,
    impediments,
    today,
    read: readBlockers(stories, cardsOf(board), impediments, lastDays(days, today, Date.now())),
  };
}

// ──────── tool.impediments.list_blockers ────────
const BlockersParams = z.object({
  days: z
    .union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)])
    .optional()
    .describe("The window: the last 30, 90, 180 or 365 days. Default 90."),
});

const UNCLUSTERED_SHOWN = 50;

async function listBlockers(store: BlockerStore, p: z.infer<typeof BlockersParams>) {
  const days = p.days ?? 90;
  const { read } = await readFor(store, days);
  return {
    from: read.window.from,
    to: read.window.to,
    measure: read.pareto.measure,
    sentence: read.pareto.sentence,
    clusters: read.pareto.clusters,
    inside: read.split.internal,
    outside: read.split.external,
    outsidePct: read.split.externalPct,
    blockedWork: read.blockedWork,
    untracked: read.untracked,
    trackingSince: read.trackingSince,
    unclusteredTotal: read.unclustered.length,
    unclustered: read.unclustered.slice(0, UNCLUSTERED_SHOWN).map((r) => ({
      kind: r.kind,
      id: r.id,
      ...(r.spellFrom ? { spellFrom: r.spellFrom } : {}),
      title: r.title,
      ...(r.cause ? { cause: r.cause } : {}),
      side: r.side,
    })),
    verdict: read.verdict,
  };
}

registry.register({
  id: "tool.impediments.list_blockers",
  toolId: "tool.impediments",
  name: "list_blockers",
  category: "read",
  description:
    "Where the blocked time goes, as the Impediments page's Blockers section shows it: every blocked spell on a story or a Flow-board card and every impediment raised in the window, by cluster. Returns {from, to, measure: blocked_days | impediments (clusters rank by item-blocked days, or by impediments raised while there are none), sentence | null, clusters: {cluster, side: internal|external, blockers, items, blockedDays, impediments, daysOpen, share, cumulative, vital}[], inside, outside: {blockedDays, impediments}, outsidePct | null, blockedWork: {finished, blocked, median, p85, sharePct} | null (work finished in the window that started after tracking began, from 5 items), untracked (still blocked since before tracking), trackingSince, unclusteredTotal, unclustered: {kind: impediment|story|card, id, spellFrom?, title, cause?, side}[] (newest first, the first 50), verdict}. Example rows are left out.",
  paramsSchema: BlockersParams,
  handler: async (p) => listBlockers(browserBlockers, p),
  mcpHandler: async (p, ctx) => listBlockers(serverBlockers(ctx.userId), p),
});

// ──────── tool.impediments.set_cluster ────────
const ClusterParams = z.object({
  kind: z
    .enum(["impediment", "story", "card"])
    .describe("An impediment, or a blocked spell on a story or a Flow-board card."),
  id: z.string().min(1),
  spellFrom: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Stories and cards: the start (`from`) of the spell to cluster, as list_blockers gives it. Default: the open spell."
    ),
  cluster: z
    .string()
    .trim()
    .min(1)
    .max(BLOCKER_CLUSTER_MAX)
    .nullable()
    .describe('Such as "Waiting for a review" or "Another team"; null clears it (and its side).'),
  side: z
    .enum(BLOCK_SIDES)
    .optional()
    .describe(
      "internal: the team can remove it itself; external: it needs someone outside. Default: a default cluster's own side, else the side already stored (on the impediment or the spell alike)."
    ),
});

const EXAMPLE_ERROR = {
  ok: false as const,
  error: "example_item",
  hint: "That is an example from Load example; cluster the team's own blockers instead.",
};

async function setCluster(store: BlockerStore, p: z.infer<typeof ClusterParams>) {
  if (isExampleId(p.id)) return EXAMPLE_ERROR;
  const cluster = p.cluster === null ? null : cleanClusterName(p.cluster);
  const side: BlockSide | undefined =
    p.side ?? (cluster ? (defaultClusterSide(cluster) ?? undefined) : undefined);
  const done = {
    ok: true as const,
    kind: p.kind,
    id: p.id,
    cluster,
    side: cluster ? (side ?? null) : null,
  };
  if (p.kind === "impediment") {
    const current = await store.getImpediment(p.id);
    if (!current) {
      return {
        ok: false as const,
        error: "not_found",
        hint: "No impediment has that id. tool.impediments.list_state lists them.",
      };
    }
    // The side the spell branch writes too: the one given, else the default cluster's.
    const next = withImpedimentCluster(current, cluster, side);
    if (next !== current) await store.putImpediment(next);
    return { ...done, side: cluster ? (next.blockSide ?? null) : null };
  }
  const note =
    cluster === null ? { cluster: "", side: null } : { cluster, ...(side ? { side } : {}) };
  const opts = p.spellFrom ? { spellFrom: p.spellFrom } : {};
  const noSpell = {
    ok: false as const,
    error: "no_spell",
    hint: "That item has no blocked spell to cluster there. tool.impediments.list_blockers lists the spells with their spellFrom.",
  };
  if (p.kind === "story") {
    const current = await store.getStory(p.id);
    if (!current) {
      return { ok: false as const, error: "not_found", hint: "No story has that id." };
    }
    const next = withSpellNote(current, note, opts);
    if (!next) return noSpell;
    if (next !== current) await store.putStory(next, current);
    return done;
  }
  const board = await store.board();
  const card = cardsOf(board).find((c) => c.id === p.id);
  if (!board || !card) {
    return { ok: false as const, error: "not_found", hint: "No Flow-board card has that id." };
  }
  const nextCard = withSpellNote(card, note, opts);
  if (!nextCard) return noSpell;
  if (nextCard !== card) {
    await store.putBoard(
      { ...board, cards: board.cards.map((c) => (c.id === p.id ? nextCard : c)) },
      board
    );
  }
  return done;
}

registry.register({
  id: "tool.impediments.set_cluster",
  toolId: "tool.impediments",
  name: "set_cluster",
  category: "write",
  requiresConfirmation: false,
  description:
    "Put a blocker in a cluster, or clear it: an impediment (its cluster and blockSide), or a blocked spell on a story or a Flow-board card (by spellFrom, default the open one; a card or story blocked since before tracking gets a new spell for the note). Returns {ok: true, kind, id, cluster | null, side | null}, or {ok: false, error: not_found | no_spell | example_item, hint}.",
  paramsSchema: ClusterParams,
  handler: async (p) => setCluster(browserBlockers, p),
  mcpHandler: async (p, ctx) => setCluster(serverBlockers(ctx.userId), p),
});

// ──────── tool.impediments.raise_cluster ────────
const RaiseParams = z.object({
  cluster: z.string().trim().min(1).max(BLOCKER_CLUSTER_MAX),
});

async function raiseCluster(store: BlockerStore, p: z.infer<typeof RaiseParams>) {
  const { impediments, read, today } = await readFor(store, 90);
  const open = openImpedimentFor(impediments, p.cluster);
  if (open) {
    return {
      ok: false as const,
      error: "already_raised",
      hint: `“${open.title}” is already open for this cluster: work on it, or resolve it first.`,
      impedimentId: open.id,
    };
  }
  const item = clusterImpediment(read.rows, p.cluster, {
    id: crypto.randomUUID(),
    today,
    from: read.window.from,
  });
  await store.putImpediment(item);
  return { ok: true as const, impediment: item };
}

registry.register({
  id: "tool.impediments.raise_cluster",
  toolId: "tool.impediments",
  name: "raise_cluster",
  category: "write",
  requiresConfirmation: false,
  description:
    'Raise a whole blocker cluster as one impediment ("Keeps blocking us: <cluster>"): medium severity, category external for an outside cluster or process for an inside one, the cluster and side set, and a description with the last 90 days\' counts and up to 5 causes. Returns {ok: true, impediment}, or {ok: false, error: "already_raised", hint, impedimentId} when an open impediment already has that cluster.',
  paramsSchema: RaiseParams,
  handler: async (p) => raiseCluster(browserBlockers, p),
  mcpHandler: async (p, ctx) => raiseCluster(serverBlockers(ctx.userId), p),
});
