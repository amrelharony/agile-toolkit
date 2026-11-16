/**
 * Product Goal — tool-local actions.
 *
 * Category: Strategic Planning (tools plan, phase 1)
 *
 * Agent surface: tool.product_goal.*
 * Backing CRUD : workspace.product_goal.* (the A3 entity), the store the
 *                Product Goal page, Sprint Goal, Sprint Planning and the
 *                team charter read. At most one goal is active: these verbs
 *                close the active one before another becomes active, the way
 *                the page does (lib/product-goal/model).
 *
 *   1. list_state  — the active goal with its check list, the record of
 *                    earlier goals, and any extra active goal a sync left.
 *   2. set_goal    — make a new goal the active one, closing the current one
 *                    as achieved or abandoned (required when there is one).
 *   3. close_goal  — mark the active goal achieved or abandoned, with a note.
 *   4. check_goal  — read only: the check list for a goal text.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetUserStateBlob, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  PRODUCT_GOAL_KIND,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type ProductGoal,
} from "@/lib/stores/workspace-types";
import {
  GOAL_OUTCOMES,
  activationWrites,
  activeGoal,
  closedGoal,
  extraActiveGoals,
  goalChecks,
  goalHistory,
  isIsoDay,
  newGoal,
  type GoalOutcome,
} from "@/lib/product-goal/model";
import { PRODUCT_GOAL_STORE_KEY, VISION_MAX, visionFromBlob } from "@/lib/product-goal/prefs";

const ws = () => useWorkspaceStore.getState();

/** Where reads and writes go, in the browser or on the server. */
interface GoalStore {
  all: () => Promise<ProductGoal[]>;
  put: (goals: ProductGoal[]) => Promise<void>;
  /** The product vision the page saved ("" when none). */
  vision: () => Promise<string>;
}

/** The page's persisted vision as this browser holds it, or null. */
function browserPrefsBlob(): unknown {
  try {
    const raw =
      typeof window === "undefined" ? null : window.localStorage.getItem(PRODUCT_GOAL_STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const browserStore: GoalStore = {
  all: async () => ws().productGoals ?? [],
  put: async (goals) => {
    for (const g of goals) ws().upsertProductGoal(g);
  },
  vision: async () => visionFromBlob(browserPrefsBlob()),
};

const serverStore = (userId: string): GoalStore => ({
  all: () => serverListEntities<ProductGoal>(userId, PRODUCT_GOAL_KIND),
  put: async (goals) => {
    for (const g of goals) await serverUpsertEntity<ProductGoal>(userId, PRODUCT_GOAL_KIND, g);
  },
  // The vision as the user's synced row holds it; none without one.
  vision: async () => {
    try {
      return visionFromBlob(await serverGetUserStateBlob(userId, PRODUCT_GOAL_STORE_KEY));
    } catch {
      return "";
    }
  },
});

const OutcomeEnum = z.enum(GOAL_OUTCOMES as unknown as [GoalOutcome, ...GoalOutcome[]]);

const ListParams = z.object({
  vision: z
    .string()
    .trim()
    .max(VISION_MAX)
    .optional()
    .describe("A product vision to check the goal against. Default: the one saved on the page."),
});

async function listState(store: GoalStore, p: z.infer<typeof ListParams>) {
  const goals = await store.all();
  const active = activeGoal(goals);
  const vision = p.vision ?? (await store.vision());
  return {
    active: active ? { ...active, checks: goalChecks(active, vision) } : null,
    vision,
    history: goalHistory(goals),
    extraActive: extraActiveGoals(goals).map((g) => ({ id: g.id, statement: g.statement })),
  };
}

// ──────── tool.product_goal.list_state ────────
registry.register({
  id: "tool.product_goal.list_state",
  toolId: "tool.product_goal",
  name: "list_state",
  category: "read",
  description:
    "Read the Product Goal as the page shows it. Returns {active: ProductGoal & {checks: {id: outcome|measurable|single|vision, label, hint, met: boolean | null (vision: null with no vision)}[]} | null, vision (what the goal was checked against: the page's saved vision unless given), history: ProductGoal[] (achieved or abandoned, newest closed first), extraActive: {id, statement}[] (another goal still active after a sync; close it)}. Example goals are left out.",
  paramsSchema: ListParams,
  handler: async (p) => listState(browserStore, p),
  mcpHandler: async (p, ctx) => listState(serverStore(ctx.userId), p),
});

// ──────── tool.product_goal.set_goal ────────
const SetGoalParams = z.object({
  statement: z
    .string()
    .trim()
    .min(1)
    .max(TOOL_TEXT_MAX.text)
    .describe("The goal: one sentence about the outcome, not a feature list."),
  why: z.string().trim().max(TOOL_TEXT_MAX.text).optional().describe("Why it matters."),
  measures: z
    .array(z.string().trim().min(1).max(TOOL_TEXT_MAX.short))
    .max(TOOL_LIST_MAX.measures)
    .optional()
    .describe("How progress is measured, one short line each."),
  targetDate: z
    .string()
    .refine(isIsoDay, { message: "targetDate must be a real day, YYYY-MM-DD" })
    .optional(),
  closeAs: OutcomeEnum.optional().describe(
    "How the current active goal ended, achieved or abandoned. Required when one is active."
  ),
  note: z
    .string()
    .trim()
    .max(TOOL_TEXT_MAX.text)
    .optional()
    .describe("A note on how the current goal ended, such as why it was abandoned."),
});

async function setGoal(store: GoalStore, p: z.infer<typeof SetGoalParams>) {
  const goals = await store.all();
  const current = activeGoal(goals, { withExamples: true });
  if (current && !p.closeAs) {
    throw new Error(
      `A Product Goal is active (“${current.statement}”, ${current.id}). Say how it ended: closeAs "achieved" or "abandoned". Nothing was saved.`
    );
  }
  const now = new Date().toISOString();
  const next = newGoal(
    `goal_${nanoid(8)}`,
    {
      statement: p.statement.replace(/\s+/g, " "),
      ...(p.why ? { why: p.why } : {}),
      measures: p.measures ?? [],
      ...(p.targetDate ? { targetDate: p.targetDate } : {}),
    },
    now
  );
  const writes = activationWrites(goals, next, p.closeAs ?? "achieved", now, p.note || undefined);
  await store.put(writes);
  return {
    id: next.id,
    closed: writes.filter((g) => g.id !== next.id).map((g) => ({ id: g.id, status: g.status })),
  };
}

registry.register({
  id: "tool.product_goal.set_goal",
  toolId: "tool.product_goal",
  name: "set_goal",
  category: "write",
  description:
    "Make a new Product Goal the active one. When a goal is already active it is closed first as closeAs (achieved | abandoned, required then) with the optional note, so one goal stays active. Returns {id, closed: {id, status}[]}.",
  paramsSchema: SetGoalParams,
  handler: async (p) => setGoal(browserStore, p),
  mcpHandler: async (p, ctx) => setGoal(serverStore(ctx.userId), p),
});

// ──────── tool.product_goal.close_goal ────────
const CloseParams = z.object({
  outcome: OutcomeEnum,
  note: z.string().trim().max(TOOL_TEXT_MAX.text).optional(),
});

async function closeGoal(store: GoalStore, p: z.infer<typeof CloseParams>) {
  const goals = await store.all();
  const current = activeGoal(goals);
  if (!current) return { closed: false as const };
  const closed = closedGoal(current, p.outcome, new Date().toISOString(), p.note || undefined);
  await store.put([closed]);
  return { closed: true as const, id: closed.id, status: closed.status };
}

registry.register({
  id: "tool.product_goal.close_goal",
  toolId: "tool.product_goal",
  name: "close_goal",
  category: "write",
  description:
    "Mark the active Product Goal achieved or abandoned, with an optional note on the outcome. Returns {closed: true, id, status} or {closed: false} when no goal is active.",
  paramsSchema: CloseParams,
  handler: async (p) => closeGoal(browserStore, p),
  mcpHandler: async (p, ctx) => closeGoal(serverStore(ctx.userId), p),
});

// ──────── tool.product_goal.check_goal ────────
registry.register({
  id: "tool.product_goal.check_goal",
  toolId: "tool.product_goal",
  name: "check_goal",
  category: "read",
  description:
    "Run the Product Goal check list on a goal text (nothing is saved): is it outcome-shaped, measurable, one goal, and does it share words with the product vision when one is given. Returns {checks: {id, label, hint, met: boolean | null}[]}. The readings are hints for a conversation, not a score.",
  paramsSchema: z.object({
    statement: z.string().trim().min(1).max(TOOL_TEXT_MAX.text),
    measures: z.array(z.string().max(TOOL_TEXT_MAX.short)).max(TOOL_LIST_MAX.measures).optional(),
    vision: z.string().max(2000).optional(),
  }),
  handler: async ({ statement, measures, vision }) => ({
    checks: goalChecks({ statement, measures: measures ?? [] }, vision ?? ""),
  }),
});
