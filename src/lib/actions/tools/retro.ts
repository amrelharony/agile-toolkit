/**
 * Retrospective — tool-local actions.
 *
 * Category: Ceremonies (squad S3 — team retrospective board)
 *
 * Agent surface: tool.retro.*
 * Backing CRUD : workspace.retro_board.* (auto-generated). The current
 *                board is one RetroBoard under a fixed id (retro:current);
 *                past retros are archived copies (retro:<time>).
 *
 *   1. list_state — board phase, per-column counts, vote totals, action
 *                   items, and the top-voted cards in one read; the sprint
 *                   the board looks back on and, for it, the facts the page
 *                   opens with (lib/retro/facts); plus the previous retro's
 *                   action items (previousActions), with whether each was
 *                   carried over, done, and where it was sent.
 *   2. start      — start the current board in a format, looking back on a
 *                   sprint (the one whose retro window holds today when not
 *                   given), as the page's format picker does.
 *   3. set_sprint — say which sprint the current board looks back on.
 *   4. add_card   — append a card to a column (the verb an agent uses to
 *                   seed a board).
 *
 * Entity kind is "workspace:retroBoard" (camelCase via kindFromToolId),
 * matching the browser sync engine so MCP-written cards round-trip.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type {
  HandoffLink,
  Impediment,
  KanbanBoard,
  Kudos,
  MoodEntry,
  MoodPulse,
  RetroBoard,
  RetroCard,
  Sprint,
  SprintGoal,
  Story,
} from "@/lib/stores/workspace-types";
import { MOOD_PULSE_KIND } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { todayIso } from "@/lib/sprints/series";
import {
  RETRO_CARD_MAX,
  RETRO_CURRENT_ID,
  blankRetroBoard,
  boardSprintId,
  newestArchivedRetro,
  retroSprintFor,
} from "@/lib/retro/board";
import { retroFacts } from "@/lib/retro/facts";
import { targetDoneIn } from "@/lib/retro/actions";

const KIND_RETRO = "workspace:retroBoard";

const ws = () => useWorkspaceStore.getState();

/** What the retro actions read and write, in the browser or on the server. */
interface RetroStore {
  getBoard: (id: string) => Promise<RetroBoard | null>;
  listBoards: () => Promise<RetroBoard[]>;
  putBoard: (board: RetroBoard) => Promise<void>;
  listSprints: () => Promise<Sprint[]>;
  /** The rest of what the facts read. */
  factsInput: () => Promise<{
    stories: Story[];
    goals: SprintGoal[];
    impediments: Impediment[];
    moodEntries: MoodEntry[];
    moodPulses: MoodPulse[];
    kudos: Kudos[];
    /** Read only to tell whether a retro action sent to the Flow board is done. */
    kanbanBoards: KanbanBoard[];
  }>;
}

const browserStore: RetroStore = {
  getBoard: async (id) => (ws().retroBoards ?? []).find((b) => b.id === id) ?? null,
  listBoards: async () => ws().retroBoards ?? [],
  putBoard: async (board) => ws().upsertRetroBoard(board),
  listSprints: async () => ws().sprints ?? [],
  factsInput: async () => {
    const s = ws();
    return {
      stories: s.stories ?? [],
      goals: s.sprintGoals ?? [],
      impediments: s.impediments ?? [],
      moodEntries: s.moodEntries ?? [],
      moodPulses: s.moodPulses ?? [],
      kudos: s.kudos ?? [],
      kanbanBoards: s.kanbanBoards ?? [],
    };
  },
};

const serverStore = (userId: string): RetroStore => ({
  getBoard: (id) => serverGetEntity<RetroBoard>(userId, KIND_RETRO, id),
  listBoards: () => serverListEntities<RetroBoard>(userId, KIND_RETRO),
  putBoard: async (board) => {
    await serverUpsertEntity<RetroBoard>(userId, KIND_RETRO, board);
  },
  listSprints: () => serverListEntities<Sprint>(userId, "workspace:sprint"),
  factsInput: async () => {
    const [stories, goals, impediments, moodEntries, moodPulses, kudos, kanbanBoards] =
      await Promise.all([
        serverListEntities<Story>(userId, "workspace:story"),
        serverListEntities<SprintGoal>(userId, "workspace:sprintGoal"),
        serverListEntities<Impediment>(userId, "workspace:impediment"),
        serverListEntities<MoodEntry>(userId, "workspace:moodEntry"),
        serverListEntities<MoodPulse>(userId, MOOD_PULSE_KIND),
        serverListEntities<Kudos>(userId, "workspace:kudos"),
        serverListEntities<KanbanBoard>(userId, "workspace:kanbanBoard"),
      ]);
    return { stories, goals, impediments, moodEntries, moodPulses, kudos, kanbanBoards };
  },
});

/** Build the board summary. Shared by browser + MCP paths. */
function summarize(board: RetroBoard | null) {
  if (!board) {
    return {
      exists: false,
      phase: null,
      sprintId: null,
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
    sprintId: boardSprintId(board) ?? null,
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

/** One of the previous retro's action items, as list_state reports it. */
interface PreviousAction {
  id: string;
  text: string;
  assignee: string;
  /** The retro it came from (an archived board id). */
  retroId: string;
  /** Copied onto the current board as an action item. */
  carriedOver: boolean;
  /** Marked done on the card. */
  done: boolean;
  /** Where it was sent (an impediment, a Kanban card). */
  sentTo: HandoffLink[];
}

/** The retro the current board follows (previousRetroId), else the newest archive. */
function previousRetro(boards: readonly RetroBoard[], previousRetroId?: string): RetroBoard | null {
  const found = previousRetroId ? boards.find((b) => b.id === previousRetroId) : undefined;
  return (found?.archivedAt ? found : newestArchivedRetro(boards)) ?? null;
}

function previousActions(board: RetroBoard | null, previous: RetroBoard | null): PreviousAction[] {
  if (!previous) return [];
  const carried = new Set((board?.cards ?? []).map((c) => c.carriedFrom).filter(Boolean));
  return (previous.cards ?? [])
    .filter((c) => c.isActionItem)
    .map((c) => ({
      id: c.id,
      text: c.text,
      assignee: c.assignee,
      retroId: previous.id,
      carriedOver: carried.has(c.id),
      done: c.done === true,
      sentTo: c.sentTo ?? [],
    }));
}

async function listState(store: RetroStore, params: { sprintId?: string }) {
  const boards = await store.listBoards();
  const board = boards.find((b) => b.id === RETRO_CURRENT_ID && !b.archivedAt) ?? null;
  const previous = previousRetro(boards, board?.previousRetroId);
  const sprintId = params.sprintId ?? (board ? boardSprintId(board) : undefined);
  let facts = null;
  if (sprintId) {
    const sprints = await store.listSprints();
    const sprint = sprints.find((s) => s.id === sprintId);
    if (sprint) {
      const { kanbanBoards, ...input } = await store.factsInput();
      facts = retroFacts({
        sprint,
        sprints,
        retroBoards: boards,
        today: todayIso(),
        ...input,
        // An action counts as done once its impediment, Flow card or story
        // is finished, as the Retro page's facts count it.
        targetDone: targetDoneIn({
          impediments: input.impediments,
          kanbanBoards,
          stories: input.stories,
        }),
      });
    }
  }
  return { ...summarize(board), previousActions: previousActions(board, previous), facts };
}

async function start(store: RetroStore, params: { formatId?: string; sprintId?: string }) {
  const current = await store.getBoard(RETRO_CURRENT_ID);
  if (current && !current.archivedAt) {
    return { started: false, reason: "already_started" as const, id: RETRO_CURRENT_ID };
  }
  const format = params.formatId
    ? retroFormats.find((f) => f.id === params.formatId)
    : retroFormats[0];
  if (!format) {
    return {
      started: false,
      reason: "unknown_format" as const,
      formats: retroFormats.map((f) => f.id),
    };
  }
  const sprints = await store.listSprints();
  if (params.sprintId && !sprints.some((s) => s.id === params.sprintId)) {
    return { started: false, reason: "unknown_sprint" as const };
  }
  const sprintId = params.sprintId ?? retroSprintFor(todayIso(), sprints)?.id;
  const previous = newestArchivedRetro(await store.listBoards());
  await store.putBoard(
    blankRetroBoard(format, {
      ...(previous ? { previousRetroId: previous.id } : {}),
      ...(sprintId ? { sprintId } : {}),
    })
  );
  return { started: true, id: RETRO_CURRENT_ID, sprintId: sprintId ?? null };
}

async function setSprint(store: RetroStore, params: { sprintId: string | null }) {
  const board = await store.getBoard(RETRO_CURRENT_ID);
  if (!board || board.archivedAt) return { updated: false, reason: "no_retro" as const };
  if (params.sprintId === null) {
    const { sprintId, ...rest } = board;
    void sprintId;
    await store.putBoard(rest);
    return { updated: true };
  }
  const sprints = await store.listSprints();
  if (!sprints.some((s) => s.id === params.sprintId)) {
    return { updated: false, reason: "unknown_sprint" as const };
  }
  await store.putBoard({ ...board, sprintId: params.sprintId });
  return { updated: true };
}

async function addCard(store: RetroStore, params: { columnKey: string; text: string }) {
  const board = await store.getBoard(RETRO_CURRENT_ID);
  if (!board || board.archivedAt) return { added: false, reason: "no_retro" as const };
  const columns = (board.format?.columns ?? []).map((c) => c.key);
  if (columns.length > 0 && !columns.includes(params.columnKey)) {
    return { added: false, reason: "unknown_column" as const, columns };
  }
  const text = params.text.trim().slice(0, RETRO_CARD_MAX);
  if (!text) return { added: false, reason: "empty_text" as const };
  const card = newCard(params.columnKey, text);
  await store.putBoard({ ...board, cards: [...board.cards, card] });
  return { added: true, id: card.id };
}

const SprintIdParam = z.string().min(1).describe("The sprint (Sprint.id) the retro looks back on.");

// ──────── tool.retro.list_state ────────
registry.register({
  id: "tool.retro.list_state",
  toolId: "tool.retro",
  name: "list_state",
  category: "read",
  description:
    "Summarise the current retro board. Returns {exists, formatName, phase, sprintId (the sprint it looks back on) | null, totalCards, totalVotes, actionItems, byColumn: {columnKey, count}[], topVoted: {id, text, votes, columnKey}[] (≤5), previousActions: {id, text, assignee, retroId, carriedOver, done, sentTo: {route, targetId, at}[]}[] (the previous retro's action items), facts: null | {sprintName, goal, goalOutcome, committed, completed, sayDo, burndown: {shape: none|steady|late, lateShare, sentence} | null, impediments: {raised, resolvedInSprint, stillOpen, escalated}, mood: {average | null, checkIns (named check-ins plus anonymous pulse answers), people, anonymous? (pulse answers, when there are some)}, followThrough (the previous retro's actions: agreed, done (ticked, or the impediment, Kanban card or story it was sent to is finished), carried, open, rate) | null, kudos: {toName, fromName, message, sentAt}[]}} — facts for the board's sprint, or for sprintId when given.",
  paramsSchema: z.object({ sprintId: SprintIdParam.optional() }),
  handler: async (params) => listState(browserStore, params),
  mcpHandler: async (params, ctx) => listState(serverStore(ctx.userId), params),
});

// ──────── tool.retro.start ────────
registry.register({
  id: "tool.retro.start",
  toolId: "tool.retro",
  name: "start",
  category: "write",
  requiresConfirmation: false,
  description: `Start the current retro board, as the page's format picker does: format ${retroFormats
    .map((f) => f.id)
    .join(
      " | "
    )} (default the first), looking back on sprintId (default: the sprint whose retro window holds today), following the newest archived retro. Returns {started: true, id, sprintId | null}, or {started: false, reason: 'already_started' | 'unknown_format' | 'unknown_sprint'}.`,
  paramsSchema: z.object({
    formatId: z.string().min(1).optional(),
    sprintId: SprintIdParam.optional(),
  }),
  handler: async (params) => start(browserStore, params),
  mcpHandler: async (params, ctx) => start(serverStore(ctx.userId), params),
});

// ──────── tool.retro.set_sprint ────────
registry.register({
  id: "tool.retro.set_sprint",
  toolId: "tool.retro",
  name: "set_sprint",
  category: "write",
  requiresConfirmation: false,
  description:
    "Say which sprint the current retro board looks back on (the cockpit and the facts then use it), or unlink it with sprintId: null (it is then placed by date). Returns {updated: true}, or {updated: false, reason: 'no_retro' | 'unknown_sprint'}.",
  paramsSchema: z.object({ sprintId: SprintIdParam.nullable() }),
  handler: async (params) => setSprint(browserStore, params),
  mcpHandler: async (params, ctx) => setSprint(serverStore(ctx.userId), params),
});

// ──────── tool.retro.add_card ────────
registry.register({
  id: "tool.retro.add_card",
  toolId: "tool.retro",
  name: "add_card",
  category: "write",
  requiresConfirmation: false,
  description: `Append a card to a column of the current retro board (text trimmed, at most ${RETRO_CARD_MAX} characters). Returns {added: true, id}, or {added: false, reason: 'no_retro' (start one with tool.retro.start) | 'unknown_column' (with the board's columns) | 'empty_text'}.`,
  paramsSchema: z.object({
    columnKey: z
      .string()
      .min(1)
      .describe("Target column key (see list_state byColumn / the format)."),
    text: z.string().min(1),
  }),
  handler: async (params) => addCard(browserStore, params),
  mcpHandler: async (params, ctx) => addCard(serverStore(ctx.userId), params),
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
