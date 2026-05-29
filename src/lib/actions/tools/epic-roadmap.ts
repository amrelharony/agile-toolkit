/**
 * Epic Roadmap — tool-local actions.
 *
 * Category: Portfolio & Scaling (squad S5)
 * Tool:     Timeline of epics across quarters with progress + milestones.
 *
 * Agent surface: tool.epic_roadmap.*
 * Backing CRUD : workspace.epic_roadmap.* (auto-generated). Singleton: one
 *                EpicRoadmap document (epics[]) under a fixed id.
 *
 *   1. list_state    — epics + total + average progress.
 *   2. add_epic      — add an epic (progress defaults to 0).
 *   3. set_progress  — update an epic's progress by id.
 *
 * Entity kind "workspace:epicRoadmap" + the fixed ER_ID match
 * epic-roadmap-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { EpicRoadmap, Epic } from "@/lib/stores/workspace-types";

const KIND_ER = "workspace:epicRoadmap";
// MUST match ER_ID in epic-roadmap-client.tsx.
const ER_ID = "epicRoadmap:current";

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyDoc(): EpicRoadmap {
  return { id: ER_ID, epics: [] };
}

function browserDoc(): EpicRoadmap | null {
  return (ws().epicRoadmaps ?? []).find((d) => d.id === ER_ID) ?? null;
}

function summarize(doc: EpicRoadmap | null) {
  const epics = doc?.epics ?? [];
  const avgProgress = epics.length
    ? round2(epics.reduce((a, e) => a + e.progress, 0) / epics.length)
    : 0;
  return { exists: doc !== null, total: epics.length, avgProgress, epics };
}

// ──────── tool.epic_roadmap.list_state ────────
registry.register({
  id: "tool.epic_roadmap.list_state",
  toolId: "tool.epic_roadmap",
  name: "list_state",
  category: "read",
  description:
    "Summarise the epic roadmap. Returns {exists, total, avgProgress (mean of epic progress), epics: {id, title, startQuarter, endQuarter, progress, owner}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<EpicRoadmap>(ctx.userId, KIND_ER, ER_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.epic_roadmap.add_epic ────────
registry.register({
  id: "tool.epic_roadmap.add_epic",
  toolId: "tool.epic_roadmap",
  name: "add_epic",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an epic. quarters are free-text like '2026 Q1'; progress is 0..100 (defaults to 0). Creates the roadmap if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    title: z.string().min(1).max(300),
    startQuarter: z.string().min(1).max(50),
    endQuarter: z.string().min(1).max(50),
    progress: z.number().min(0).max(100).optional(),
    owner: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const epic = newEpic(params);
    ws().upsertEpicRoadmap({ ...base, id: ER_ID, epics: [...base.epics, epic] });
    return { added: true, id: epic.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<EpicRoadmap>(ctx.userId, KIND_ER, ER_ID)) ?? emptyDoc();
    const epic = newEpic(params);
    await serverUpsertEntity<EpicRoadmap>(ctx.userId, KIND_ER, {
      ...base,
      id: ER_ID,
      epics: [...base.epics, epic],
    });
    return { added: true, id: epic.id };
  },
});

// ──────── tool.epic_roadmap.set_progress ────────
registry.register({
  id: "tool.epic_roadmap.set_progress",
  toolId: "tool.epic_roadmap",
  name: "set_progress",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set an epic's progress (0..100) by id. Returns {updated: false} when the roadmap or epic id is unknown.",
  paramsSchema: z.object({
    epicId: z.string(),
    progress: z.number().min(0).max(100),
  }),
  handler: async (params) => {
    const next = applyProgress(browserDoc(), params.epicId, params.progress);
    if (!next) return { updated: false };
    ws().upsertEpicRoadmap(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<EpicRoadmap>(ctx.userId, KIND_ER, ER_ID);
    const next = applyProgress(base ?? null, params.epicId, params.progress);
    if (!next) return { updated: false };
    await serverUpsertEntity<EpicRoadmap>(ctx.userId, KIND_ER, next);
    return { updated: true };
  },
});

function newEpic(params: {
  title: string;
  startQuarter: string;
  endQuarter: string;
  progress?: number;
  owner?: string;
  description?: string;
}): Epic {
  return {
    id: crypto.randomUUID(),
    title: params.title,
    startQuarter: params.startQuarter,
    endQuarter: params.endQuarter,
    progress: params.progress ?? 0,
    owner: params.owner,
    description: params.description,
  };
}

function applyProgress(
  doc: EpicRoadmap | null,
  epicId: string,
  progress: number
): EpicRoadmap | null {
  if (!doc || !doc.epics.some((e) => e.id === epicId)) return null;
  return { ...doc, epics: doc.epics.map((e) => (e.id === epicId ? { ...e, progress } : e)) };
}
