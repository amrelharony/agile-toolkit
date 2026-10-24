/**
 * Story Mapper — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.story_mapper.*
 * Backing CRUD : workspace.story_map.* (auto-generated). Singleton: one
 *                StoryMap document (steps × slices grid) under a fixed id.
 *
 *   1. list_state — steps, slices, total cards, and a per-slice card count.
 *   2. add_card   — add a card to a (slice, step) cell.
 *
 * Entity kind "workspace:storyMap" (camelCase via kindFromToolId) matches the
 * browser sync engine so MCP-written cards round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { StoryMap, StoryMapCard } from "@/lib/stores/workspace-types";
import { STORY_MAP_ID } from "@/lib/stores/workspace-types";

const KIND_SM = "workspace:storyMap";
// MUST match SM_ID in story-mapper-client.tsx.
const SM_ID = STORY_MAP_ID;

const ws = () => useWorkspaceStore.getState();

function browserMap(): StoryMap | null {
  return (ws().storyMaps ?? []).find((m) => m.id === SM_ID) ?? null;
}

function totalCards(map: StoryMap): number {
  return map.slices.reduce(
    (acc, sl) => acc + Object.values(sl.cards).reduce((a, list) => a + list.length, 0),
    0
  );
}

function summarize(map: StoryMap | null) {
  if (!map) {
    return { exists: false, stepCount: 0, sliceCount: 0, totalCards: 0, steps: [], slices: [] };
  }
  return {
    exists: true,
    stepCount: map.steps.length,
    sliceCount: map.slices.length,
    totalCards: totalCards(map),
    steps: map.steps.map((s) => ({ id: s.id, name: s.name })),
    slices: map.slices.map((sl) => ({
      id: sl.id,
      name: sl.name,
      cardCount: Object.values(sl.cards).reduce((a, list) => a + list.length, 0),
    })),
  };
}

// ──────── tool.story_mapper.list_state ────────
registry.register({
  id: "tool.story_mapper.list_state",
  toolId: "tool.story_mapper",
  name: "list_state",
  category: "read",
  description:
    "Summarise the story map. Returns {exists, stepCount, sliceCount, totalCards, steps: {id, name}[], slices: {id, name, cardCount}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserMap()),
  mcpHandler: async (_params, ctx) => {
    const map = await serverGetEntity<StoryMap>(ctx.userId, KIND_SM, SM_ID);
    return summarize(map ?? null);
  },
});

// ──────── tool.story_mapper.add_card ────────
registry.register({
  id: "tool.story_mapper.add_card",
  toolId: "tool.story_mapper",
  name: "add_card",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a card to a (slice, step) cell of the story map. Use list_state to get valid slice/step ids. Returns {added: false} when no map exists or the slice/step id is unknown; {added: true, id} on success.",
  paramsSchema: z.object({
    sliceId: z.string(),
    stepId: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    color: z.string().optional(),
  }),
  handler: async (params) => {
    const map = browserMap();
    if (!map) return { added: false };
    const result = withCard(map, params);
    if (!result) return { added: false };
    ws().upsertStoryMap(result.map);
    return { added: true, id: result.id };
  },
  mcpHandler: async (params, ctx) => {
    const map = await serverGetEntity<StoryMap>(ctx.userId, KIND_SM, SM_ID);
    if (!map) return { added: false };
    const result = withCard(map, params);
    if (!result) return { added: false };
    await serverUpsertEntity<StoryMap>(ctx.userId, KIND_SM, result.map);
    return { added: true, id: result.id };
  },
});

/** Append a card to the (sliceId, stepId) cell. Returns the updated map +
 *  new card id, or null if the slice or step id doesn't exist. */
function withCard(
  map: StoryMap,
  params: { sliceId: string; stepId: string; title: string; description?: string; color?: string }
): { map: StoryMap; id: string } | null {
  const slice = map.slices.find((sl) => sl.id === params.sliceId);
  const stepExists = map.steps.some((s) => s.id === params.stepId);
  if (!slice || !stepExists) return null;
  const card: StoryMapCard = {
    id: crypto.randomUUID(),
    title: params.title,
    description: params.description ?? "",
    color: params.color ?? "#00f0ff",
  };
  const slices = map.slices.map((sl) =>
    sl.id === params.sliceId
      ? {
          ...sl,
          cards: { ...sl.cards, [params.stepId]: [...(sl.cards[params.stepId] ?? []), card] },
        }
      : sl
  );
  return { map: { ...map, slices }, id: card.id };
}
