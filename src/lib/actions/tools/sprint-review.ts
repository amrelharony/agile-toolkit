/**
 * Sprint Review — tool-local actions.
 *
 * Category: Ceremonies (squad S3 — sprint review / showcase)
 *
 * Agent surface: tool.sprint_review.*
 * Backing CRUD : workspace.sprint_review.* (auto-generated). The tool is a
 *                singleton: one SprintReview document under a fixed id.
 *
 *   1. list_state   — demo-script size, feedback breakdown, checklist
 *                     progress, and the velocity summary in one read.
 *   2. add_feedback — append one piece of stakeholder feedback (the verb a
 *                     feedback-collecting agent reaches for). Creates the
 *                     singleton review if none exists yet.
 *
 * Entity kind is "workspace:sprintReview" (camelCase via kindFromToolId),
 * matching the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { SprintReview, FeedbackItem, FeedbackCategory } from "@/lib/stores/workspace-types";

const KIND_SR = "workspace:sprintReview";
// MUST match SR_ID in sprint-review-client.tsx so agent writes land on the
// same row the browser reads.
const SR_ID = "sprint-review:current";

const ws = () => useWorkspaceStore.getState();

/** The singleton review from the browser store, if present. */
function browserDoc(): SprintReview | null {
  return (ws().sprintReviews ?? []).find((r) => r.id === SR_ID) ?? null;
}

/** A blank review used when the agent acts before one exists. */
function emptyReview(): SprintReview {
  return {
    id: SR_ID,
    sprintName: "",
    sprintNumber: "",
    features: [],
    meetingDate: "",
    feedbackItems: [],
    checklistItems: [],
    committed: 0,
    completed: 0,
    totalBacklog: 0,
    backlogDone: 0,
  };
}

/** Build the review summary. Shared by browser + MCP paths. */
function summarize(r: SprintReview | null) {
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

// ──────── tool.sprint_review.list_state ────────
registry.register({
  id: "tool.sprint_review.list_state",
  toolId: "tool.sprint_review",
  name: "list_state",
  category: "read",
  description:
    "Summarise the current sprint review. Returns {exists, sprintName, sprintNumber, meetingDate, features (count), totalDemoMinutes, feedback: {total, positive, concern, suggestion}, checklist: {done, total}, velocity: {committed, completed, completionPct, totalBacklog, backlogDone}}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<SprintReview>(ctx.userId, KIND_SR, SR_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.sprint_review.add_feedback ────────
registry.register({
  id: "tool.sprint_review.add_feedback",
  toolId: "tool.sprint_review",
  name: "add_feedback",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append one piece of stakeholder feedback to the sprint review (category: positive | concern | suggestion, default positive). Creates the review if none exists. Returns {added: true, id}.",
  paramsSchema: z.object({
    stakeholder: z.string().min(1).max(120),
    feedback: z.string().min(1),
    category: z.enum(["positive", "concern", "suggestion"]).optional(),
  }),
  handler: async (params) => {
    const doc = browserDoc() ?? emptyReview();
    const item: FeedbackItem = {
      id: crypto.randomUUID(),
      stakeholder: params.stakeholder,
      feedback: params.feedback,
      category: params.category ?? "positive",
    };
    ws().upsertSprintReview({ ...doc, feedbackItems: [...doc.feedbackItems, item] });
    return { added: true, id: item.id };
  },
  mcpHandler: async (params, ctx) => {
    const doc = (await serverGetEntity<SprintReview>(ctx.userId, KIND_SR, SR_ID)) ?? emptyReview();
    const item: FeedbackItem = {
      id: crypto.randomUUID(),
      stakeholder: params.stakeholder,
      feedback: params.feedback,
      category: params.category ?? "positive",
    };
    await serverUpsertEntity<SprintReview>(ctx.userId, KIND_SR, {
      ...doc,
      feedbackItems: [...doc.feedbackItems, item],
    });
    return { added: true, id: item.id };
  },
});
