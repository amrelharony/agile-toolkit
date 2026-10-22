/**
 * JTBD Mapper — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.jtbd_mapper.*
 * Backing CRUD : workspace.job_story.* (auto-generated).
 *
 *   1. list_state — all job stories + root/leaf counts of the hierarchy.
 *   2. add_job    — add a "When <situation>, I want to <motivation>, so I can
 *                   <outcome>" job story (optionally under a parent).
 *
 * Entity kind "workspace:jobStory" (camelCase via kindFromToolId) matches the
 * browser sync engine so MCP-written stories round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type { JobStory } from "@/lib/stores/workspace-types";

const KIND_JOB = "workspace:jobStory";

const ws = () => useWorkspaceStore.getState();

/**
 * {total, rootCount, leafCount, jobs} — shared by browser + MCP paths. A job
 * whose parent no longer exists counts as a root, as the page shows it.
 */
function summarize(jobs: JobStory[]) {
  const parentIds = new Set(jobs.map((j) => j.parentJobId).filter(Boolean));
  const ids = new Set(jobs.map((j) => j.id));
  return {
    total: jobs.length,
    rootCount: jobs.filter((j) => !j.parentJobId || !ids.has(j.parentJobId)).length,
    leafCount: jobs.filter((j) => !parentIds.has(j.id)).length,
    jobs,
  };
}

// ──────── tool.jtbd_mapper.list_state ────────
registry.register({
  id: "tool.jtbd_mapper.list_state",
  toolId: "tool.jtbd_mapper",
  name: "list_state",
  category: "read",
  description:
    "List all Jobs-to-be-Done job stories with hierarchy counts. Returns {total, rootCount (no parent, or its parent no longer exists), leafCount (no children), jobs: JobStory[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(ws().jobStories ?? []),
  mcpHandler: async (_params, ctx) => {
    const jobs = await serverListEntities<JobStory>(ctx.userId, KIND_JOB);
    return summarize(jobs);
  },
});

// ──────── tool.jtbd_mapper.add_job ────────
registry.register({
  id: "tool.jtbd_mapper.add_job",
  toolId: "tool.jtbd_mapper",
  name: "add_job",
  category: "write",
  requiresConfirmation: false,
  description:
    'Add a job story ("When <situation>, I want to <motivation>, so I can <outcome>"). Pass parentJobId to nest it under an existing job. Returns {added: true, id}.',
  paramsSchema: z.object({
    situation: z.string().min(1),
    motivation: z.string().min(1),
    outcome: z.string().min(1),
    parentJobId: z.string().optional(),
    description: z.string().optional(),
  }),
  handler: async (params) => {
    const job: JobStory = { id: crypto.randomUUID(), ...params };
    ws().upsertJobStory(job);
    return { added: true, id: job.id };
  },
  mcpHandler: async (params, ctx) => {
    const job: JobStory = { id: crypto.randomUUID(), ...params };
    await serverUpsertEntity<JobStory>(ctx.userId, KIND_JOB, job);
    return { added: true, id: job.id };
  },
});
