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
 *                     review if none exists yet. The category is required:
 *                     the page has no default either.
 *   3. add_done_stories_to_demo — put a sprint's done stories in its demo
 *                     script, as the page's "Add to demo" does.
 *   4. send_feedback_to_backlog — turn a piece of feedback into a backlog
 *                     story, linked both ways, as the page's Send to does.
 *
 * The old page's untouched starter draft ("Sprint Alpha") reads as no
 * draft, as on the page (isStarterDraft).
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
  HandoffLink,
  Sprint,
  SprintGoal,
  SprintReview,
  Story,
} from "@/lib/stores/workspace-types";
import {
  blankReview,
  demoIdFor,
  feedbackStoryTitle,
  isStarterDraft,
  reviewDocId,
  reviewFacts,
  reviewNumbers,
  withStoriesInDemo,
} from "@/lib/sprints/review-doc";
import { buildBacklogStory } from "@/lib/handoffs/targets/backlog-story";

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
  putStory: (story: Story) => Promise<void>;
  listGoals: () => Promise<SprintGoal[]>;
}

const browserStore: ReviewStore = {
  getReview: async (id) => (ws().sprintReviews ?? []).find((r) => r.id === id) ?? null,
  putReview: async (doc) => ws().upsertSprintReview(doc),
  getSprint: async (id) => (ws().sprints ?? []).find((s) => s.id === id) ?? null,
  listStories: async () => ws().stories ?? [],
  putStory: async (story) => ws().upsertStory(story),
  listGoals: async () => ws().sprintGoals ?? [],
};

const serverStore = (userId: string): ReviewStore => ({
  getReview: (id) => serverGetEntity<SprintReview>(userId, KIND_SR, id),
  putReview: async (doc) => {
    await serverUpsertEntity<SprintReview>(userId, KIND_SR, doc);
  },
  getSprint: (id) => serverGetEntity<Sprint>(userId, KIND_SPRINT, id),
  listStories: () => serverListEntities<Story>(userId, KIND_STORY),
  putStory: async (story) => {
    await serverUpsertEntity<Story>(userId, KIND_STORY, story);
  },
  listGoals: () => serverListEntities<SprintGoal>(userId, KIND_SG),
});

/** The stored review, with the untouched starter draft read as none. */
async function loadReview(store: ReviewStore, sprintId?: string): Promise<SprintReview | null> {
  const doc = await store.getReview(reviewDocId(sprintId));
  return doc && !isStarterDraft(doc) ? doc : null;
}

/** The review to write to: the stored one, or a new one for the sprint (null: unknown sprint). */
async function writableReview(
  store: ReviewStore,
  sprintId?: string
): Promise<{ doc: SprintReview; sprint: Sprint | null } | null> {
  const sprint = sprintId ? await store.getSprint(sprintId) : null;
  if (sprintId && !sprint) return null;
  return { doc: (await loadReview(store, sprintId)) ?? blankReview(sprint), sprint };
}

/** The backlog-story link a feedback item has whose story still exists. */
function liveStoryLink(item: FeedbackItem, stories: readonly Story[]): HandoffLink | undefined {
  return (item.sentTo ?? []).find(
    (l) => l.route === "backlog-story" && stories.some((s) => s.id === l.targetId)
  );
}

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
  const doc = await loadReview(store, sprintId);
  const sprint = sprintId ? await store.getSprint(sprintId) : null;
  const stories = await store.listStories();
  const f = sprint ? reviewFacts(sprint, stories, await store.listGoals()) : null;
  const inDemo = new Set((doc?.features ?? []).map((x) => x.id));
  const facts = f && {
    goal: f.goal,
    goalOutcome: f.goalOutcome,
    doneStories: f.done.map((s) => ({
      id: s.id,
      title: s.title,
      points: s.points ?? null,
      inDemo: inDemo.has(demoIdFor(s.id)),
    })),
    notDoneCount: f.notDone.length,
    committed: f.committed,
    completed: f.completed,
    fromStories: f.fromStories,
    sayDoPct: f.sayDo?.pct ?? null,
  };
  // The page's numbers: the stories, else the review's typed numbers, else the sprint's own.
  const n = reviewNumbers(doc ?? blankReview(sprint), f, sprint ?? undefined);
  const notOnBacklog = (doc?.feedbackItems ?? []).filter(
    (x) =>
      (x.category === "concern" || x.category === "suggestion") &&
      x.feedback.trim() &&
      !liveStoryLink(x, stories)
  ).length;
  const summary = summarizeDoc(doc);
  return {
    sprintId: sprintId ?? null,
    ...summary,
    feedback: { ...summary.feedback, notOnBacklog },
    numbers: {
      source: n.source,
      committed: n.committed,
      completed: n.completed,
      sayDoPct: n.sayDo?.pct ?? null,
    },
    facts,
  };
}

const CATEGORIES: readonly FeedbackCategory[] = ["positive", "concern", "suggestion"];

async function addFeedback(
  store: ReviewStore,
  params: { sprintId?: string; stakeholder: string; feedback: string; category?: FeedbackCategory }
) {
  // No default: a concern filed as praise would drop out of the follow-ups.
  if (!params.category || !CATEGORIES.includes(params.category)) {
    return { added: false, reason: "category_required" as const };
  }
  const target = await writableReview(store, params.sprintId);
  if (!target) return { added: false, reason: "unknown_sprint" as const };
  const { doc } = target;
  const item: FeedbackItem = {
    id: crypto.randomUUID(),
    stakeholder: params.stakeholder,
    feedback: params.feedback,
    category: params.category,
  };
  await store.putReview({ ...doc, feedbackItems: [...(doc.feedbackItems ?? []), item] });
  return { added: true, id: item.id };
}

async function addDoneStoriesToDemo(
  store: ReviewStore,
  params: { sprintId: string; storyIds?: string[] }
) {
  const target = await writableReview(store, params.sprintId);
  if (!target?.sprint) return { added: 0, reason: "unknown_sprint" as const };
  const wanted = params.storyIds ? new Set(params.storyIds) : null;
  const done = (await store.listStories()).filter(
    (s) => s.sprintId === params.sprintId && s.status === "done" && (!wanted || wanted.has(s.id))
  );
  const next = withStoriesInDemo(target.doc, done);
  const added = next.features.length - target.doc.features.length;
  if (added > 0) await store.putReview(next);
  return {
    added,
    alreadyInDemo: done.length - added,
    notDone: wanted ? wanted.size - done.length : 0,
  };
}

async function sendFeedbackToBacklog(
  store: ReviewStore,
  params: { sprintId?: string; feedbackId: string }
) {
  const doc = await loadReview(store, params.sprintId);
  const item = doc?.feedbackItems.find((f) => f.id === params.feedbackId);
  if (!doc || !item) return { sent: false, reason: "unknown_feedback" as const };
  if (!item.feedback.trim()) return { sent: false, reason: "empty_feedback" as const };
  const live = liveStoryLink(item, await store.listStories());
  if (live) return { sent: false, reason: "already_sent" as const, storyId: live.targetId };
  const story = buildBacklogStory({
    title: feedbackStoryTitle(item.feedback),
    sourceRef: { tool: "sprint-review", id: item.id, doc: doc.id },
  });
  await store.putStory(story);
  const link: HandoffLink = {
    route: "backlog-story",
    targetId: story.id,
    at: new Date().toISOString(),
  };
  await store.putReview({
    ...doc,
    feedbackItems: doc.feedbackItems.map((f) =>
      f.id === item.id
        ? { ...f, sentTo: [...(f.sentTo ?? []).filter((l) => l.route !== "backlog-story"), link] }
        : f
    ),
  });
  return { sent: true, storyId: story.id };
}

// ──────── tool.sprint_review.list_state ────────
registry.register({
  id: "tool.sprint_review.list_state",
  toolId: "tool.sprint_review",
  name: "list_state",
  category: "read",
  description:
    "Summarise a sprint's review (or the draft without sprintId; the old untouched starter draft reads as none). Returns {sprintId, exists, sprintName, sprintNumber, meetingDate, features (count), totalDemoMinutes, feedback: {total, positive, concern, suggestion, notOnBacklog (concerns and suggestions with no backlog story)}, checklist: {done, total}, velocity (the typed numbers): {committed, completed, completionPct, totalBacklog, backlogDone}, numbers (what the page shows): {source: stories | typed | sprint | none, committed, completed | null, sayDoPct | null}, facts: null | {goal, goalOutcome: {met: met|partly|not-met, note, decidedAt} | null, doneStories: {id, title, points, inDemo}[], notDoneCount, committed, completed, fromStories (false: the sprint's typed points), sayDoPct}}.",
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
    "Append one piece of stakeholder feedback to a sprint's review (or the draft without sprintId); category (required, no default): positive | concern | suggestion. Creates the review if none exists. Returns {added: true, id}, or {added: false, reason: 'unknown_sprint' | 'category_required'}.",
  paramsSchema: z.object({
    sprintId: SprintIdParam,
    stakeholder: z.string().min(1).max(120),
    feedback: z.string().min(1),
    category: z.enum(["positive", "concern", "suggestion"]),
  }),
  handler: async (params) => addFeedback(browserStore, params),
  mcpHandler: async (params, ctx) => addFeedback(serverStore(ctx.userId), params),
});

// ──────── tool.sprint_review.add_done_stories_to_demo ────────
registry.register({
  id: "tool.sprint_review.add_done_stories_to_demo",
  toolId: "tool.sprint_review",
  name: "add_done_stories_to_demo",
  category: "write",
  requiresConfirmation: false,
  description:
    "Put a sprint's done stories in its review's demo script (all of them, or only storyIds), each as a demo item named after the story (id story-<storyId>, not timed yet). Stories already in the demo and stories not done are skipped. Creates the review if none exists. Returns {added, alreadyInDemo, notDone}, or {added: 0, reason: 'unknown_sprint'}.",
  paramsSchema: z.object({
    sprintId: z.string().min(1),
    storyIds: z.array(z.string().min(1)).optional(),
  }),
  handler: async (params) => addDoneStoriesToDemo(browserStore, params),
  mcpHandler: async (params, ctx) => addDoneStoriesToDemo(serverStore(ctx.userId), params),
});

// ──────── tool.sprint_review.send_feedback_to_backlog ────────
registry.register({
  id: "tool.sprint_review.send_feedback_to_backlog",
  toolId: "tool.sprint_review",
  name: "send_feedback_to_backlog",
  category: "write",
  requiresConfirmation: false,
  description:
    "Turn one piece of review feedback into a backlog story (title from the feedback, linked back to it) and record the link on the feedback, as the page's Send to does. A second send while that story exists is refused. Returns {sent: true, storyId}, or {sent: false, reason: 'unknown_feedback' | 'empty_feedback' | 'already_sent', storyId?}.",
  paramsSchema: z.object({ sprintId: SprintIdParam, feedbackId: z.string().min(1) }),
  handler: async (params) => sendFeedbackToBacklog(browserStore, params),
  mcpHandler: async (params, ctx) => sendFeedbackToBacklog(serverStore(ctx.userId), params),
});
