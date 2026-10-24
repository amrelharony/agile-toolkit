/**
 * Liberating Structures Picker — tool-local actions.
 *
 * Category: Workshops & Facilitation (squad S11)
 * Tool:     Filterable catalog of LS micro-structures (lib/liberating-
 *           structures/catalog, shared with the page). The user's
 *           favourites are the saved part.
 *
 * Agent surface: tool.liberating_structures.*
 * Backing CRUD : workspace.liberating_structures.* (auto-generated). Singleton:
 *                one favorites document under a fixed id (LS_DOC_ID).
 *
 *   1. list_state       — favorited structures (each once) + count.
 *   2. toggle_favorite  — favorite/unfavorite a catalog structure by id.
 *   3. find             — structures that fit a group: people, purpose,
 *                         Scrum event, time — the page's filters.
 *
 * Entity kind "workspace:liberatingStructures" + LS_DOC_ID match the page,
 * so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { LiberatingStructures } from "@/lib/stores/workspace-types";
import { CEREMONY_KINDS, type CeremonyKind } from "@/lib/sprints/cadence";
import { LS_DOC_ID } from "@/lib/liberating-structures/doc";
import {
  LS_CATALOG,
  LS_PURPOSES,
  fitsGroup,
  isLsStructureId,
  type LsPurpose,
} from "@/lib/liberating-structures/catalog";

const KIND_LS = "workspace:liberatingStructures";

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): LiberatingStructures {
  return { id: LS_DOC_ID, favorites: [] };
}

function browserDoc(): LiberatingStructures | null {
  return (ws().liberatingStructures ?? []).find((d) => d.id === LS_DOC_ID) ?? null;
}

function summarize(doc: LiberatingStructures | null) {
  const favorites = doc?.favorites ?? [];
  // Each catalog structure once, as the page shows them.
  const ids = Array.from(new Set(favorites.map((f) => f.structureId))).filter(isLsStructureId);
  return {
    exists: doc !== null,
    favoriteCount: ids.length,
    favoriteStructureIds: ids,
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
    "List favorited liberating structures. Returns {exists, favoriteCount (catalog structures, each once), favoriteStructureIds, favorites: {id, structureId, ts}[]}. Use find for the catalog itself.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<LiberatingStructures>(ctx.userId, KIND_LS, LS_DOC_ID);
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
  description: `Toggle a catalog structure's favorite status by structureId (${LS_CATALOG.map(
    (s) => s.id
  ).join(
    ", "
  )}). Returns {favorited: true} if it was added, {favorited: false} if it was removed. Creates the doc if absent.`,
  paramsSchema: z.object({
    structureId: z
      .string()
      .min(1)
      .refine((id) => isLsStructureId(id), "Not a structure in the catalog (see find)."),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const { next, favorited } = toggle(base, params.structureId);
    ws().upsertLiberatingStructures(next);
    return { favorited };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<LiberatingStructures>(ctx.userId, KIND_LS, LS_DOC_ID)) ?? emptyDoc();
    const { next, favorited } = toggle(base, params.structureId);
    await serverUpsertEntity<LiberatingStructures>(ctx.userId, KIND_LS, next);
    return { favorited };
  },
});

// ──────── tool.liberating_structures.find ────────
registry.register({
  id: "tool.liberating_structures.find",
  toolId: "tool.liberating_structures",
  name: "find",
  category: "read",
  description: `Find liberating structures that fit, with the page's filters: people (group size), purpose (${LS_PURPOSES.join(
    " | "
  )}), ceremony (${CEREMONY_KINDS.join(" | ")}) and maxMinutes. Returns {structures: {id, name, purpose, purposes, ceremonies, minPeople, maxPeople | null, timingMinutes, steps: {id, label, minutes}[] | null, ceremonyTimerAgenda?}[]}.`,
  paramsSchema: z.object({
    people: z.number().int().min(1).max(10000).optional(),
    purpose: z.enum(LS_PURPOSES as unknown as [LsPurpose, ...LsPurpose[]]).optional(),
    ceremony: z.enum(CEREMONY_KINDS as unknown as [CeremonyKind, ...CeremonyKind[]]).optional(),
    maxMinutes: z.number().positive().optional(),
  }),
  handler: async (params) => ({
    structures: LS_CATALOG.filter(
      (s) =>
        (params.people === undefined || fitsGroup(s, params.people)) &&
        (!params.purpose || s.purposes.includes(params.purpose)) &&
        (!params.ceremony || s.ceremonies.includes(params.ceremony)) &&
        (params.maxMinutes === undefined || s.timingMinutes <= params.maxMinutes)
    ).map((s) => ({
      id: s.id,
      name: s.name,
      purpose: s.purpose,
      purposes: s.purposes,
      ceremonies: s.ceremonies,
      minPeople: s.minPeople,
      maxPeople: s.maxPeople,
      timingMinutes: s.timingMinutes,
      steps: s.steps
        ? s.steps.map((st) => ({ id: st.id, label: st.label, minutes: st.minutes }))
        : null,
      ...(s.ceremonyTimerAgenda ? { ceremonyTimerAgenda: s.ceremonyTimerAgenda } : {}),
    })),
  }),
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
        id: LS_DOC_ID,
        favorites: base.favorites.filter((f) => f.structureId !== structureId),
      },
      favorited: false,
    };
  }
  const fav = { id: crypto.randomUUID(), structureId, ts: new Date().toISOString() };
  return {
    next: { ...base, id: LS_DOC_ID, favorites: [...base.favorites, fav] },
    favorited: true,
  };
}
