/**
 * Flow Insights — tool-local actions.
 *
 * Category: Track delivery (tools plan, phase 2)
 *
 * Agent surface: tool.flow_insights.*
 * Backing data : no entity of its own. It reads the stories, sprints, the
 *                Flow board, capacity plans and the workflow definition live
 *                (lib/flow/distribution and stability, as the page does), and
 *                writes a story's or a card's `workType` / `demand` and the
 *                target mix (`withTargetSplit` on workspace.workflow_definition,
 *                shared with Kanban's Definition of Workflow).
 *
 *   1. list_state       — the mix per period with its gaps to the target, the
 *                         repeat-work trend, team stability and the verdict.
 *   2. list_unsorted    — finished items with no type set, each with its guess.
 *   3. set_work_type    — set or clear a story's or a card's type (and demand).
 *   4. set_target_split — set the target mix, or clear it.
 *
 * All four act on the person's own workspace and reach no room, so they keep
 * the default `visitor` flag. The page logs history, not these verbs.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  KANBAN_BOARD_ID,
  WORK_DEMANDS,
  WORK_TYPES,
  WORKFLOW_DEFINITION_ID,
  WORKFLOW_DEFINITION_KIND,
  type CapacityPlan,
  type KanbanBoard,
  type KanbanCard,
  type Sprint,
  type Story,
  type WorkDemand,
  type WorkType,
  type WorkflowDefinition,
} from "@/lib/stores/workspace-types";
import { stampStoryWrite } from "@/lib/sprints/story-status";
import { cleanStoryFields } from "@/lib/stories/fields";
import { cleanCardFlowFields, stampBoardBlocks } from "@/lib/flow/block-stamps";
import {
  defaultBoard,
  flowInsights,
  guessWorkType,
  keywordWorkType,
  mixByPeriod,
  unsortedItems,
  type FlowBoard,
} from "@/lib/flow/distribution";
import { validateTargetSplit, withTargetSplit, type TargetSplit } from "@/lib/flow/work-types";
import { todayIso } from "@/lib/sprints/series";
import { isExampleId } from "@/lib/utils/example-id";

const KIND_STORY = "workspace:story";
const KIND_SPRINT = "workspace:sprint";
const KIND_KANBAN = "workspace:kanbanBoard";
const KIND_CAPACITY = "workspace:capacityPlan";

const ws = () => useWorkspaceStore.getState();

/** Server-side "today" (UTC): an MCP agent has no locale. */
const todayUTC = () => new Date().toISOString().slice(0, 10);

interface FlowData {
  stories: Story[];
  sprints: Sprint[];
  board: KanbanBoard | null;
  plans: CapacityPlan[];
  workflow: WorkflowDefinition | null;
  today: string;
}

interface FlowStore {
  read: () => Promise<FlowData>;
  getStory: (id: string) => Promise<Story | null>;
  putStory: (next: Story, current: Story) => Promise<void>;
  getBoard: () => Promise<KanbanBoard | null>;
  putBoard: (next: KanbanBoard, current: KanbanBoard) => Promise<void>;
  getWorkflow: () => Promise<WorkflowDefinition | null>;
  putWorkflow: (next: WorkflowDefinition) => Promise<void>;
}

const boardOf = (boards: readonly KanbanBoard[] | undefined) =>
  (boards ?? []).find((b) => b.id === KANBAN_BOARD_ID) ?? null;
const workflowOf = (defs: readonly WorkflowDefinition[] | undefined) =>
  (defs ?? []).find((d) => d.id === WORKFLOW_DEFINITION_ID) ?? null;

const browserStore: FlowStore = {
  read: async () => ({
    stories: ws().stories ?? [],
    sprints: ws().sprints ?? [],
    board: boardOf(ws().kanbanBoards),
    plans: ws().capacityPlans ?? [],
    workflow: workflowOf(ws().workflowDefinitions),
    today: todayIso(),
  }),
  getStory: async (id) => (ws().stories ?? []).find((s) => s.id === id) ?? null,
  // The store cleans and stamps every story and board write itself.
  putStory: async (next) => ws().upsertStory(next),
  getBoard: async () => boardOf(ws().kanbanBoards),
  putBoard: async (next) => ws().upsertKanbanBoard(next),
  getWorkflow: async () => workflowOf(ws().workflowDefinitions),
  putWorkflow: async (next) => ws().upsertWorkflowDefinition(next),
};

const serverStore = (userId: string): FlowStore => ({
  read: async () => {
    const [stories, sprints, board, plans, workflow] = await Promise.all([
      serverListEntities<Story>(userId, KIND_STORY),
      serverListEntities<Sprint>(userId, KIND_SPRINT),
      serverGetEntity<KanbanBoard>(userId, KIND_KANBAN, KANBAN_BOARD_ID),
      serverListEntities<CapacityPlan>(userId, KIND_CAPACITY),
      serverGetEntity<WorkflowDefinition>(userId, WORKFLOW_DEFINITION_KIND, WORKFLOW_DEFINITION_ID),
    ]);
    return { stories, sprints, board, plans, workflow, today: todayUTC() };
  },
  getStory: (id) => serverGetEntity<Story>(userId, KIND_STORY, id),
  // Cleaned and stamped as workspace.story.* does on the server.
  putStory: (next, current) =>
    serverUpsertEntity<Story>(userId, KIND_STORY, stampStoryWrite(cleanStoryFields(next), current)),
  getBoard: () => serverGetEntity<KanbanBoard>(userId, KIND_KANBAN, KANBAN_BOARD_ID),
  // Cleaned and stamped as workspace.kanban_board.* does on the server.
  putBoard: (next, current) =>
    serverUpsertEntity<KanbanBoard>(
      userId,
      KIND_KANBAN,
      stampBoardBlocks({ ...next, cards: next.cards.map(cleanCardFlowFields) }, current)
    ),
  getWorkflow: () =>
    serverGetEntity<WorkflowDefinition>(userId, WORKFLOW_DEFINITION_KIND, WORKFLOW_DEFINITION_ID),
  putWorkflow: (next) =>
    serverUpsertEntity<WorkflowDefinition>(userId, WORKFLOW_DEFINITION_KIND, next),
});

const cardsOf = (board: KanbanBoard | null): KanbanCard[] =>
  board && Array.isArray(board.cards) ? board.cards : [];

const BoardParam = z
  .enum(["sprint", "flow"])
  .optional()
  .describe(
    "sprint: per finished sprint, from the stories; flow: per ISO week, from the Flow board's cards. Default: the Sprint board once a sprint has finished, else the Flow board."
  );

// ──────── tool.flow_insights.list_state ────────
const ListParams = z.object({
  board: BoardParam,
  periods: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe("How many of the latest sprints or weeks to read. Default 6 sprints or 12 weeks."),
});

async function listState(store: FlowStore, p: z.infer<typeof ListParams>) {
  const data = await store.read();
  const cards = cardsOf(data.board);
  // The board first, so its default window is the page's (6 sprints, 12 weeks).
  const board: FlowBoard =
    p.board ?? defaultBoard({ sprints: data.sprints, cards, includeExamples: false });
  const x = flowInsights({
    board,
    stories: data.stories,
    sprints: data.sprints,
    cards,
    plans: data.plans,
    workflow: data.workflow,
    periods: p.periods ?? (board === "flow" ? 12 : 6),
    today: data.today,
    now: Date.now(),
  });
  return {
    today: data.today,
    board: x.board,
    verdict: x.verdict,
    periods: x.periods.map((q) => ({
      id: q.id,
      label: q.label,
      end: q.end,
      finished: q.finished,
      ...q.counts,
      unsorted: q.unsorted,
      guessed: q.guessed,
      failure: q.failure,
      failurePct: q.failurePct,
    })),
    totals: { ...x.totals, ...x.totals.counts },
    target: x.target,
    gaps: x.gaps,
    failureTrend: x.trend,
    cycleP85: x.cycleP85,
    blockedPct: x.blocked.pct,
    stability: x.stability.rows.map((r) => ({
      sprintId: r.sprintId,
      name: r.name,
      people: r.people,
      stayed: r.stayed,
      joined: r.joined,
      left: r.left,
      pct: r.pct,
      source: r.source,
      pointsCompleted: r.pointsCompleted,
    })),
  };
}

registry.register({
  id: "tool.flow_insights.list_state",
  toolId: "tool.flow_insights",
  name: "list_state",
  category: "read",
  description:
    "Read Flow Insights as the page shows it. Returns {today, board: sprint|flow, verdict, periods: {id, label, end, finished, feature, defect, debt, risk, unsorted, guessed, failure, failurePct | null}[] (oldest first, the window only), totals, target: {feature, defect, debt, risk} | null (the target mix from the workflow definition), gaps: {type, target, delivered | null, gap | null}[], failureTrend: {n, trend: up|down|none, pValue, significant, sentence} | null (over every period, from 10), cycleP85 | null, blockedPct | null, stability: {sprintId, name, people, stayed, joined: names, left: names, pct | null, source: capacity|owners, pointsCompleted | null}[]}. A type counts when set on the item or guessed from its story kind, tags or the tool it came from; 'unsorted' have neither. Example rows are left out.",
  paramsSchema: ListParams,
  handler: async (p) => listState(browserStore, p),
  mcpHandler: async (p, ctx) => listState(serverStore(ctx.userId), p),
});

// ──────── tool.flow_insights.list_unsorted ────────
const UnsortedParams = z.object({
  board: z.enum(["sprint", "flow"]).optional().describe("Only this board's items. Default: both."),
  limit: z.number().int().min(1).max(50).optional().describe("At most this many. Default 50."),
});

async function listUnsorted(store: FlowStore, p: z.infer<typeof UnsortedParams>) {
  const data = await store.read();
  const cards = cardsOf(data.board);
  const boards: FlowBoard[] = p.board ? [p.board] : ["sprint", "flow"];
  const storyById = new Map(data.stories.map((s) => [s.id, s]));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const all = boards
    .flatMap((b) =>
      unsortedItems(
        mixByPeriod({
          board: b,
          stories: data.stories,
          sprints: data.sprints,
          cards,
          today: data.today,
        })
      )
    )
    .sort((a, b) => b.doneOn.localeCompare(a.doneOn));
  const items = all.slice(0, p.limit ?? 50);
  return {
    // Every unsorted item, not only those returned.
    total: all.length,
    items: items.map((it) => {
      const row = it.kind === "story" ? storyById.get(it.id) : cardById.get(it.id);
      const rule = row ? guessWorkType(row) : null;
      const text =
        row && "description" in row && typeof row.description === "string" ? row.description : "";
      return {
        kind: it.kind,
        id: it.id,
        title: it.title,
        doneOn: it.doneOn,
        guess: rule?.type ?? keywordWorkType(it.title, text),
        guessedBy: rule?.by ?? "keywords",
        failure: it.failure,
        reopened: it.reopened,
      };
    }),
  };
}

registry.register({
  id: "tool.flow_insights.list_unsorted",
  toolId: "tool.flow_insights",
  name: "list_unsorted",
  category: "read",
  description:
    "The finished items with no type set on them, newest first: {total (how many are unsorted, `limit` aside), items (at most `limit`): {kind: story|card, id, title, doneOn, guess: feature|defect|debt|risk, guessedBy: kind|tag|source|keywords, failure, reopened}[]}. Sort them with set_work_type. Stories count per finished sprint, cards per week; example rows are left out.",
  paramsSchema: UnsortedParams,
  handler: async (p) => listUnsorted(browserStore, p),
  mcpHandler: async (p, ctx) => listUnsorted(serverStore(ctx.userId), p),
});

// ──────── tool.flow_insights.set_work_type ────────
const TypeParams = z.object({
  kind: z.enum(["story", "card"]).describe("A story (Sprint board) or a Flow-board card."),
  id: z.string().min(1),
  type: z
    .enum(WORK_TYPES)
    .nullable()
    .describe("feature, defect, debt or risk; null clears it (the item then reads as a guess)."),
  demand: z
    .enum(WORK_DEMANDS)
    .nullable()
    .optional()
    .describe(
      "value, or failure for repeat work caused by an earlier failure; null clears it; left out, unchanged."
    ),
});

/** The row with its type (and demand) set or cleared; the same row when nothing changes. */
function withType<T extends { workType?: WorkType; demand?: WorkDemand }>(
  row: T,
  type: WorkType | null,
  demand: WorkDemand | null | undefined
): T {
  const next: T = { ...row };
  if (type === null) delete next.workType;
  else next.workType = type;
  if (demand === null) delete next.demand;
  else if (demand !== undefined) next.demand = demand;
  return next.workType === row.workType && next.demand === row.demand ? row : next;
}

const EXAMPLE_ERROR = {
  ok: false as const,
  error: "example_item",
  hint: "That is an example item from Load example; sort the team's own work instead.",
};

async function setWorkType(store: FlowStore, p: z.infer<typeof TypeParams>) {
  if (isExampleId(p.id)) return EXAMPLE_ERROR;
  if (p.kind === "story") {
    const current = await store.getStory(p.id);
    if (!current) {
      return {
        ok: false as const,
        error: "not_found",
        hint: "No story has that id. tool.flow_insights.list_unsorted lists the finished ones.",
      };
    }
    const next = withType(current, p.type, p.demand);
    if (next !== current) await store.putStory(next, current);
    return {
      ok: true as const,
      kind: p.kind,
      id: p.id,
      type: next.workType ?? null,
      demand: next.demand ?? null,
    };
  }
  const board = await store.getBoard();
  const card = cardsOf(board).find((c) => c.id === p.id);
  if (!board || !card) {
    return {
      ok: false as const,
      error: "not_found",
      hint: "No Flow-board card has that id. tool.flow_insights.list_unsorted lists the finished ones.",
    };
  }
  const nextCard = withType(card, p.type, p.demand);
  if (nextCard !== card) {
    await store.putBoard(
      { ...board, cards: board.cards.map((c) => (c.id === p.id ? nextCard : c)) },
      board
    );
  }
  return {
    ok: true as const,
    kind: p.kind,
    id: p.id,
    type: nextCard.workType ?? null,
    demand: nextCard.demand ?? null,
  };
}

registry.register({
  id: "tool.flow_insights.set_work_type",
  toolId: "tool.flow_insights",
  name: "set_work_type",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set or clear what kind of work a story or a Flow-board card is (feature, defect, debt, risk), and optionally whether it was repeat work (demand: failure) or new value. Returns {ok: true, kind, id, type | null, demand | null}, or {ok: false, error: not_found | example_item, hint}.",
  paramsSchema: TypeParams,
  handler: async (p) => setWorkType(browserStore, p),
  mcpHandler: async (p, ctx) => setWorkType(serverStore(ctx.userId), p),
});

// ──────── tool.flow_insights.set_target_split ────────
const Share = z.number().int().min(0).max(100).nullable();
const SplitParams = z.object({
  feature: Share,
  defect: Share,
  debt: Share,
  risk: Share,
});

async function setTargetSplit(store: FlowStore, p: z.infer<typeof SplitParams>) {
  const checked = validateTargetSplit({
    feature: p.feature,
    defect: p.defect,
    debt: p.debt,
    risk: p.risk,
  });
  if (!checked.ok) {
    return {
      ok: false as const,
      error: "invalid_split",
      hint: `${Object.values(checked.errors).join(" ")} Give four whole numbers that add up to 100, or all four null to clear the target.`,
    };
  }
  const split: TargetSplit | null = checked.values;
  const current = await store.getWorkflow();
  const next = withTargetSplit(current ?? undefined, split);
  if (next !== current) await store.putWorkflow(next);
  return { ok: true as const, target: split };
}

registry.register({
  id: "tool.flow_insights.set_target_split",
  toolId: "tool.flow_insights",
  name: "set_target_split",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the team's target mix of finished work: four whole-number percentages (feature, defect, debt, risk) that add up to 100, or all four null to clear it. It is the same target Kanban's Definition of Workflow shows, and applies to both boards. Returns {ok: true, target | null} or {ok: false, error: invalid_split, hint}.",
  paramsSchema: SplitParams,
  handler: async (p) => setTargetSplit(browserStore, p),
  mcpHandler: async (p, ctx) => setTargetSplit(serverStore(ctx.userId), p),
});
