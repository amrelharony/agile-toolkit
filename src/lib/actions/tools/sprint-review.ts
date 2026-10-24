/**
 * Sprint Review — tool-local actions.
 *
 * Category: Ceremonies (squad S3 — sprint review / showcase)
 *
 * Agent surface: tool.sprint_review.*
 * Backing CRUD : workspace.sprint_review.* (auto-generated). Each sprint has
 *                its own review document (`sprint-review:sprint:<sprintId>`,
 *                lib/sprints/review-doc); `sprint-review:current` is the
 *                draft for when no sprint is chosen.
 *
 *   1. list_state   — demo-script size, feedback breakdown, checklist
 *                     progress and the typed velocity summary, plus, for a
 *                     sprint, what the page shows without typing: the goal
 *                     and whether it was met, the done stories and points.
 *   2. add_feedback — append one piece of stakeholder feedback (the verb a
 *                     feedback-collecting agent reaches for). Creates the
 *                     review if none exists yet.
 *
 * Entity kind is "workspace:sprintReview" (camelCase via kindFromToolId),
 * matching the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type {
  FeedbackCategory,
  FeedbackItem,
  Sprint,
  SprintGoal,
  SprintReview,
  Story,
} from "@/lib/stores/workspace-types";
import { blankReview, reviewDocId, reviewFacts } from "@/lib/sprints/review-doc";

const KIND_SR = "workspace:sprintReview";
const KIND_SPRINT = "workspace:sprint";
const KIND_STORY = "workspace:story";
const KIND_SG = "workspace:sprintGoal";

const ws = () => useWorkspaceStore.getState();

const SprintIdParam = z
  .string()
  .min(1)
  .optional()
  .describe("The sprint whose review to use. Omit for the draft (sprint-review:current).");

/** Where reads and writes go, in the browser or on the server. */
interface ReviewStore {
  getReview: (id: string) => Promise<SprintReview | null>;
  putReview: (doc: SprintReview) => Promise<void>;
  getSprint: (id: string) => Promise<Sprint | null>;
  listStories: () => Promise<Story[]>;
  listGoals: () => Promise<SprintGoal[]>;
}

const browserStore: ReviewStore = {
  getReview: async (id) => (ws().sprintReviews ?? []).find((r) => r.id === id) ?? null,
  putReview: async (doc) => ws().upsertSprintReview(doc),
  getSprint: async (id) => (ws().sprints ?? []).find((s) => s.id === id) ?? null,
  listStories: async () => ws().stories ?? [],
  listGoals: async () => ws().sprintGoals ?? [],
};

const serverStore = (userId: string): ReviewStore => ({
  getReview: (id) => serverGetEntity<SprintReview>(userId, KIND_SR, id),
  putReview: async (doc) => {
    await serverUpsertEntity<SprintReview>(userId, KIND_SR, doc);
  },
  getSprint: (id) => serverGetEntity<Sprint>(userId, KIND_SPRINT, id),
  listStories: () => serverListEntities<Story>(userId, KIND_STORY),
  listGoals: () => serverListEntities<SprintGoal>(userId, KIND_SG),
});

/** The typed part of a review. */
function summarizeDoc(r: SprintReview | null) {
  if (!r) {
    return {
      exists: false,
      features: 0,
      totalDemoMinutes: 0,
      feedback: { total: 0, positive: 0, concern: 0, suggestion: 0 },
      checklist: { done: 0, total: 0 },
      velocity: { committed: 0, completed: 0, completionPct: 0, totalBacklog: 0, backlogDone: 0 },
    };
  }
  const fb = r.feedbackItems ?? [];
  const cl = r.checklistItems ?? [];
  const byCat = (c: FeedbackCategory) => fb.filter((f) => f.category === c).length;
  const committed = r.committed ?? 0;
  const completed = r.completed ?? 0;
  return {
    exists: true,
    sprintName: r.sprintName,
    sprintNumber: r.sprintNumber,
    meetingDate: r.meetingDate,
    features: (r.features ?? []).length,
    totalDemoMinutes: (r.features ?? []).reduce((acc, f) => acc + (f.timeMinutes || 0), 0),
    feedback: {
      total: fb.length,
      positive: byCat("positive"),
      concern: byCat("concern"),
      suggestion: byCat("suggestion"),
    },
    checklist: { done: cl.filter((c) => c.checked).length, total: cl.length },
    velocity: {
      committed,
      completed,
      completionPct: committed > 0 ? Math.round((completed / committed) * 100) : 0,
      totalBacklog: r.totalBacklog ?? 0,
      backlogDone: r.backlogDone ?? 0,
    },
  };
}

async function summarize(store: ReviewStore, sprintId?: string) {
  const doc = await store.getReview(reviewDocId(sprintId));
  const sprint = sprintId ? await store.getSprint(sprintId) : null;
  let facts = null;
  if (sprint) {
    const f = reviewFacts(sprint, await store.listStories(), await store.listGoals());
    facts = {
      goal: f.goal,
      goalOutcome: f.goalOutcome,
      doneStories: f.done.map((s) => ({ id: s.id, title: s.title, points: s.points ?? null })),
      notDoneCount: f.notDone.length,
      committed: f.committed,
      completed: f.completed,
      fromStories: f.fromStories,
      sayDoPct: f.sayDo?.pct ?? null,
    };
  }
  return { sprintId: sprintId ?? null, ...summarizeDoc(doc), facts };
}

async function addFeedback(
  store: ReviewStore,
  params: { sprintId?: string; stakeholder: string; feedback: string; category?: FeedbackCategory }
) {
  const id = reviewDocId(params.sprintId);
  let doc = await store.getReview(id);
  if (!doc) {
    const sprint = params.sprintId ? await store.getSprint(params.sprintId) : null;
    if (params.sprintId && !sprint) return { added: false, reason: "unknown_sprint" as const };
    doc = blankReview(sprint);
  }
  const item: FeedbackItem = {
    id: crypto.randomUUID(),
    stakeholder: params.stakeholder,
    feedback: params.feedback,
    category: params.category ?? "positive",
  };
  await store.putReview({ ...doc, feedbackItems: [...(doc.feedbackItems ?? []), item] });
  return { added: true, id: item.id };
}

// ──────── tool.sprint_review.list_state ────────
registry.register({
  id: "tool.sprint_review.list_state",
  toolId: "tool.sprint_review",
  name: "list_state",
  category: "read",
  description:
    "Summarise a sprint's review (or the draft without sprintId). Returns {sprintId, exists, sprintName, sprintNumber, meetingDate, features (count), totalDemoMinutes, feedback: {total, positive, concern, suggestion}, checklist: {done, total}, velocity (the typed numbers): {committed, completed, completionPct, totalBacklog, backlogDone}, facts: null | {goal, goalOutcome: {met: met|partly|not-met, note, decidedAt} | null, doneStories: {id, title, points}[], notDoneCount, committed, completed, fromStories (false: the sprint's typed points), sayDoPct}}.",
  paramsSchema: z.object({ sprintId: SprintIdParam }),
  handler: async ({ sprintId }) => summarize(browserStore, sprintId),
  mcpHandler: async ({ sprintId }, ctx) => summarize(serverStore(ctx.userId), sprintId),
});

// ──────── tool.sprint_review.add_feedback ────────
registry.register({
  id: "tool.sprint_review.add_feedback",
  toolId: "tool.sprint_review",
  name: "add_feedback",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append one piece of stakeholder feedback to a sprint's review (or the draft without sprintId); category: positive | concern | suggestion, default positive. Creates the review if none exists. Returns {added: true, id}, or {added: false, reason: 'unknown_sprint'}.",
  paramsSchema: z.object({
    sprintId: SprintIdParam,
    stakeholder: z.string().min(1).max(120),
    feedback: z.string().min(1),
    category: z.enum(["positive", "concern", "suggestion"]).optional(),
  }),
  handler: async (params) => addFeedback(browserStore, params),
  mcpHandler: async (params, ctx) => addFeedback(serverStore(ctx.userId), params),
});
