/**
 * Liberating Structures Picker — tool-local actions.
 *
 * Category: Workshops & Facilitation (squad S11)
 * Tool:     Filterable catalog of LS micro-structures. The catalog itself is
 *           static reference data in the client; only the user's FAVORITES are
 *           persisted, so that's what the agent surface exposes.
 *
 * Agent surface: tool.liberating_structures.*
 * Backing CRUD : workspace.liberating_structures.* (auto-generated). Singleton:
 *                one favorites document under a fixed id.
 *
 *   1. list_state       — favorited structure ids + count.
 *   2. toggle_favorite  — favorite/unfavorite a structure by id.
 *
 * Entity kind "workspace:liberatingStructures" + the fixed LS_ID match
 * liberating-structures-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { LiberatingStructures } from "@/lib/stores/workspace-types";

const KIND_LS = "workspace:liberatingStructures";
// MUST match LS_ID in liberating-structures-client.tsx.
const LS_ID = "liberatingStructures:current";

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): LiberatingStructures {
  return { id: LS_ID, favorites: [] };
}

function browserDoc(): LiberatingStructures | null {
  return (ws().liberatingStructures ?? []).find((d) => d.id === LS_ID) ?? null;
}

function summarize(doc: LiberatingStructures | null) {
  const favorites = doc?.favorites ?? [];
  return {
    exists: doc !== null,
    favoriteCount: favorites.length,
    favoriteStructureIds: favorites.map((f) => f.structureId),
    favorites,
  };
}

// ──────── tool.liberating_structures.list_state ────────
registry.register({
  id: "tool.liberating_structures.list_state",
  toolId: "tool.liberating_structures",
  name: "list_state",
  category: "read",
  description:
    "List favorited liberating structures. Returns {exists, favoriteCount, favoriteStructureIds, favorites: {id, structureId, ts}[]}. (The structure catalog is static client reference data.)",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<LiberatingStructures>(ctx.userId, KIND_LS, LS_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.liberating_structures.toggle_favorite ────────
// Favorite if absent, unfavorite if present. Returns the resulting state so
// the agent knows which way it flipped. Additive → no confirmation.
registry.register({
  id: "tool.liberating_structures.toggle_favorite",
  toolId: "tool.liberating_structures",
  name: "toggle_favorite",
  category: "write",
  requiresConfirmation: false,
  description:
    "Toggle a structure's favorite status by structureId. Returns {favorited: true} if it was added, {favorited: false} if it was removed. Creates the doc if absent.",
  paramsSchema: z.object({ structureId: z.string().min(1) }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const { next, favorited } = toggle(base, params.structureId);
    ws().upsertLiberatingStructures(next);
    return { favorited };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<LiberatingStructures>(ctx.userId, KIND_LS, LS_ID)) ?? emptyDoc();
    const { next, favorited } = toggle(base, params.structureId);
    await serverUpsertEntity<LiberatingStructures>(ctx.userId, KIND_LS, next);
    return { favorited };
  },
});

function toggle(
  base: LiberatingStructures,
  structureId: string
): { next: LiberatingStructures; favorited: boolean } {
  const existing = base.favorites.find((f) => f.structureId === structureId);
  if (existing) {
    return {
      next: {
        ...base,
        id: LS_ID,
        favorites: base.favorites.filter((f) => f.structureId !== structureId),
      },
      favorited: false,
    };
  }
  const fav = { id: crypto.randomUUID(), structureId, ts: new Date().toISOString() };
  return { next: { ...base, id: LS_ID, favorites: [...base.favorites, fav] }, favorited: true };
}
