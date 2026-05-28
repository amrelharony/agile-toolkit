/**
 * Retrospective — tool-local actions.
 *
 * Category: Ceremonies (squad S3 — team retrospective board)
 *
 * Agent surface: tool.retro.*
 * Backing CRUD : workspace.retro_board.* (auto-generated). The tool is a
 *                singleton: one RetroBoard document under a fixed id.
 *
 *   1. list_state — board phase, per-column counts, vote totals, action
 *                   items, and the top-voted cards in one read.
 *   2. add_card   — append a card to a column (the verb an agent uses to
 *                   seed a board). No-op {added:false} when no retro is
 *                   active (a format must be chosen first, in-app).
 *
 * Entity kind is "workspace:retroBoard" (camelCase via kindFromToolId),
 * matching the browser sync engine so MCP-written cards round-trip.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";

const KIND_RETRO = "workspace:retroBoard";
// MUST match RB_ID in retro-client.tsx so agent writes land on the row the
// browser reads.
const RB_ID = "retro:current";

const ws = () => useWorkspaceStore.getState();

function browserBoard(): RetroBoard | null {
  return (ws().retroBoards ?? []).find((b) => b.id === RB_ID) ?? null;
}

/** Build the board summary. Shared by browser + MCP paths. */
function summarize(board: RetroBoard | null) {
  if (!board) {
    return {
      exists: false,
      phase: null,
      totalCards: 0,
      totalVotes: 0,
      actionItems: 0,
      byColumn: [] as { columnKey: string; count: number }[],
      topVoted: [] as { id: string; text: string; votes: number; columnKey: string }[],
    };
  }
  const cards = board.cards ?? [];
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.columnKey, (counts.get(c.columnKey) ?? 0) + 1);
  return {
    exists: true,
    formatName: board.format?.name,
    phase: board.phase,
    totalCards: cards.length,
    totalVotes: cards.reduce((acc, c) => acc + (c.votes || 0), 0),
    actionItems: cards.filter((c) => c.isActionItem).length,
    byColumn: Array.from(counts.entries()).map(([columnKey, count]) => ({ columnKey, count })),
    topVoted: [...cards]
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 5)
      .map((c) => ({ id: c.id, text: c.text, votes: c.votes, columnKey: c.columnKey })),
  };
}

// ──────── tool.retro.list_state ────────
registry.register({
  id: "tool.retro.list_state",
  toolId: "tool.retro",
  name: "list_state",
  category: "read",
  description:
    "Summarise the current retro board. Returns {exists, formatName, phase, totalCards, totalVotes, actionItems, byColumn: {columnKey, count}[], topVoted: {id, text, votes, columnKey}[] (≤5)}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserBoard()),
  mcpHandler: async (_params, ctx) => {
    const board = await serverGetEntity<RetroBoard>(ctx.userId, KIND_RETRO, RB_ID);
    return summarize(board ?? null);
  },
});

// ──────── tool.retro.add_card ────────
registry.register({
  id: "tool.retro.add_card",
  toolId: "tool.retro",
  name: "add_card",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append a card to a column of the active retro board. Returns {added: false} when no retro is active (a format must be chosen in-app first). Returns {added: true, id} on success.",
  paramsSchema: z.object({
    columnKey: z
      .string()
      .min(1)
      .describe("Target column key (see list_state byColumn / the format)."),
    text: z.string().min(1),
  }),
  handler: async (params) => {
    const board = browserBoard();
    if (!board) return { added: false };
    const card = newCard(params.columnKey, params.text);
    ws().upsertRetroBoard({ ...board, cards: [...board.cards, card] });
    return { added: true, id: card.id };
  },
  mcpHandler: async (params, ctx) => {
    const board = await serverGetEntity<RetroBoard>(ctx.userId, KIND_RETRO, RB_ID);
    if (!board) return { added: false };
    const card = newCard(params.columnKey, params.text);
    await serverUpsertEntity<RetroBoard>(ctx.userId, KIND_RETRO, {
      ...board,
      cards: [...board.cards, card],
    });
    return { added: true, id: card.id };
  },
});

function newCard(columnKey: string, text: string): RetroCard {
  return {
    id: crypto.randomUUID(),
    columnKey,
    text,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
  };
}
