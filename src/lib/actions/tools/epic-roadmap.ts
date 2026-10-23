/**
 * Epic Roadmap — tool-local actions.
 *
 * Category: Portfolio & Scaling (squad S5)
 * Tool:     Timeline of epics across quarters, with progress rolled up from
 *           the stories linked to each epic (Story.epicId).
 *
 * Agent surface: tool.epic_roadmap.*
 * Backing CRUD : workspace.epic_roadmap.* (auto-generated). Singleton: one
 *                EpicRoadmap document (epics[]) under a fixed id.
 *
 *   1. list_state    — epics with their rolled-up progress (lib/roadmap/rollup,
 *                      the page's numbers), total and average progress.
 *   2. add_epic      — add an epic; quarters are normalised to "YYYY Qn".
 *   3. set_progress  — set an epic's typed progress (used while no stories
 *                      are linked to it).
 *   4. link_story / unlink_story — set or clear a story's epicId.
 *
 * Entity kind "workspace:epicRoadmap" + the fixed ER_ID match
 * epic-roadmap-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type { EpicRoadmap, Epic, Story } from "@/lib/stores/workspace-types";
import { epicRollup, linkedStories } from "@/lib/roadmap/rollup";
import { normalizeQuarter, quarterIndex } from "@/lib/roadmap/quarters";
import { EPIC_COLORS, isEpicColorKey } from "@/lib/roadmap/palette";

const KIND_ER = "workspace:epicRoadmap";
const KIND_STORY = "workspace:story";
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

function summarize(doc: EpicRoadmap | null, stories: readonly Story[]) {
  const epics = (doc?.epics ?? []).map((e) => {
    const r = epicRollup(e, linkedStories(e.id, stories));
    return {
      ...e,
      rollup: {
        pct: r.pct,
        source: r.source,
        basis: r.basis,
        done: r.done,
        stories: r.count,
        doneStories: r.doneCount,
        points: r.points,
        donePoints: r.donePoints,
        unestimated: r.unestimated,
      },
    };
  });
  const avgProgress = epics.length
    ? round2(epics.reduce((a, e) => a + e.rollup.pct, 0) / epics.length)
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
    "Summarise the epic roadmap as the page shows it. Each epic's rollup.pct comes from its linked stories (done points over points, or done stories over stories while any is unestimated); with no stories linked it is the typed progress (rollup.source 'typed'). Returns {exists, total, avgProgress (mean of rollup.pct), epics: {id, title, startQuarter, endQuarter, progress (typed), owner, color, rollup: {pct, source, basis, done, stories, doneStories, points, donePoints, unestimated}}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc(), ws().stories ?? []),
  mcpHandler: async (_params, ctx) => {
    const [doc, stories] = await Promise.all([
      serverGetEntity<EpicRoadmap>(ctx.userId, KIND_ER, ER_ID),
      serverListEntities<Story>(ctx.userId, KIND_STORY),
    ]);
    return summarize(doc ?? null, stories);
  },
});

// ──────── tool.epic_roadmap.add_epic ────────

const AddEpicParams = z
  .object({
    title: z.string().min(1).max(300),
    startQuarter: z
      .string()
      .min(1)
      .max(50)
      .refine((q) => quarterIndex(q) > 0, "Use a quarter like '2026 Q1'."),
    endQuarter: z
      .string()
      .min(1)
      .max(50)
      .refine((q) => quarterIndex(q) > 0, "Use a quarter like '2026 Q1'."),
    progress: z.number().min(0).max(100).optional(),
    owner: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    color: z
      .string()
      .optional()
      .describe(`A theme colour key: ${EPIC_COLORS.map((c) => c.key).join(", ")}.`),
  })
  .refine((p) => quarterIndex(p.endQuarter) >= quarterIndex(p.startQuarter), {
    message: "endQuarter can't be before startQuarter.",
    path: ["endQuarter"],
  });

registry.register({
  id: "tool.epic_roadmap.add_epic",
  toolId: "tool.epic_roadmap",
  name: "add_epic",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an epic. Quarters like '2026 Q1' (normalised; end can't be before start); progress 0..100 (defaults to 0) is only shown until stories are linked; color is a theme key. Creates the roadmap if absent. Returns {added: true, id}.",
  paramsSchema: AddEpicParams,
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
    "Set an epic's typed progress (0..100) by id; it shows only while no stories are linked to the epic. Returns {updated: false} when the roadmap or epic id is unknown.",
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

// ──────── tool.epic_roadmap.link_story / unlink_story ────────
const LinkParams = z.object({ storyId: z.string(), epicId: z.string() });

/** The story with `epicId` set (link) or cleared (unlink), or null when nothing changes. */
function linked(
  story: Story | null,
  doc: EpicRoadmap | null,
  epicId: string,
  link: boolean
): Story | null {
  if (!story) return null;
  if (link) {
    if (!doc?.epics.some((e) => e.id === epicId) || story.epicId === epicId) return null;
    return { ...story, epicId };
  }
  if (story.epicId !== epicId) return null;
  const next = { ...story };
  delete next.epicId;
  return next;
}

for (const link of [true, false]) {
  const name = link ? "link_story" : "unlink_story";
  registry.register({
    id: `tool.epic_roadmap.${name}`,
    toolId: "tool.epic_roadmap",
    name,
    category: "write",
    requiresConfirmation: false,
    description: link
      ? "Link a workspace story to an epic (sets Story.epicId), so the epic's progress rolls up from it. Returns {changed} (false for an unknown story or epic, or when already linked)."
      : "Unlink a story from an epic (clears Story.epicId). Returns {changed} (false when it wasn't linked to that epic).",
    paramsSchema: LinkParams,
    handler: async ({ storyId, epicId }) => {
      const story = (ws().stories ?? []).find((s) => s.id === storyId) ?? null;
      const next = linked(story, browserDoc(), epicId, link);
      if (!next) return { changed: false };
      ws().upsertStory(next);
      return { changed: true };
    },
    mcpHandler: async ({ storyId, epicId }, ctx) => {
      const [story, doc] = await Promise.all([
        serverGetEntity<Story>(ctx.userId, KIND_STORY, storyId),
        serverGetEntity<EpicRoadmap>(ctx.userId, KIND_ER, ER_ID),
      ]);
      const next = linked(story, doc, epicId, link);
      if (!next) return { changed: false };
      await serverUpsertEntity<Story>(ctx.userId, KIND_STORY, next);
      return { changed: true };
    },
  });
}

function newEpic(params: z.infer<typeof AddEpicParams>): Epic {
  return {
    id: crypto.randomUUID(),
    title: params.title,
    startQuarter: normalizeQuarter(params.startQuarter),
    endQuarter: normalizeQuarter(params.endQuarter),
    progress: params.progress ?? 0,
    ...(params.owner ? { owner: params.owner } : {}),
    ...(params.description ? { description: params.description } : {}),
    ...(isEpicColorKey(params.color) ? { color: params.color } : {}),
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
