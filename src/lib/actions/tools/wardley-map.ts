/**
 * Wardley Map Canvas — tool-local actions.
 *
 * Category: Workshops & Facilitation (squad S11)
 * Tool:     Value chain × evolution canvas of components + dependency links.
 *
 * Agent surface: tool.wardley_map.*
 * Backing CRUD : workspace.wardley_map.* (auto-generated). Singleton: one
 *                WardleyMap document (components[] + links[]) under a fixed id.
 *
 *   1. list_state     — components + links + counts.
 *   2. add_component  — place a component (evolution 0..1, visibility 0..1).
 *   3. add_link       — link two existing components (refuses dangling ends,
 *                       self-links and duplicates).
 *
 * Entity kind "workspace:wardleyMap" + the fixed WM_ID match
 * wardley-map-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { WardleyMap, WardleyComponent, WardleyLink } from "@/lib/stores/workspace-types";

const KIND_WM = "workspace:wardleyMap";
// MUST match WM_ID in wardley-map-client.tsx.
const WM_ID = "wardleyMap:current";

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): WardleyMap {
  return { id: WM_ID, components: [], links: [] };
}

function browserDoc(): WardleyMap | null {
  return (ws().wardleyMaps ?? []).find((d) => d.id === WM_ID) ?? null;
}

function summarize(doc: WardleyMap | null) {
  return {
    exists: doc !== null,
    componentCount: doc?.components.length ?? 0,
    linkCount: doc?.links.length ?? 0,
    components: doc?.components ?? [],
    links: doc?.links ?? [],
  };
}

// ──────── tool.wardley_map.list_state ────────
registry.register({
  id: "tool.wardley_map.list_state",
  toolId: "tool.wardley_map",
  name: "list_state",
  category: "read",
  description:
    "Summarise the Wardley map. Returns {exists, componentCount, linkCount, components: {id, name, evolution, visibility}[], links: {id, fromId, toId}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<WardleyMap>(ctx.userId, KIND_WM, WM_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.wardley_map.add_component ────────
registry.register({
  id: "tool.wardley_map.add_component",
  toolId: "tool.wardley_map",
  name: "add_component",
  category: "write",
  requiresConfirmation: false,
  description:
    "Place a component. evolution is 0 (Genesis) … 1 (Commodity); visibility is 0 (invisible to user) … 1 (highly visible). Creates the map if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    name: z.string().min(1).max(200),
    evolution: z.number().min(0).max(1),
    visibility: z.number().min(0).max(1),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const c: WardleyComponent = { id: crypto.randomUUID(), ...params };
    ws().upsertWardleyMap({ ...base, id: WM_ID, components: [...base.components, c] });
    return { added: true, id: c.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<WardleyMap>(ctx.userId, KIND_WM, WM_ID)) ?? emptyDoc();
    const c: WardleyComponent = { id: crypto.randomUUID(), ...params };
    await serverUpsertEntity<WardleyMap>(ctx.userId, KIND_WM, {
      ...base,
      id: WM_ID,
      components: [...base.components, c],
    });
    return { added: true, id: c.id };
  },
});

// ──────── tool.wardley_map.add_link ────────
// Refuses dangling links — both endpoints must be existing components, else
// the link would render nowhere and skew the value chain — plus self-links and
// exact duplicates, which the UI refuses too. Additive → no confirm.
registry.register({
  id: "tool.wardley_map.add_link",
  toolId: "tool.wardley_map",
  name: "add_link",
  category: "write",
  requiresConfirmation: false,
  description:
    "Link two components (fromId → toId), both of which must already exist. Returns {added: false} when the map is missing, either endpoint is unknown, fromId equals toId, or the same link already exists; else {added: true, id}.",
  paramsSchema: z.object({ fromId: z.string(), toId: z.string() }),
  handler: async (params) => {
    const base = browserDoc();
    if (!base || !canLink(base, params)) return { added: false };
    const link: WardleyLink = { id: crypto.randomUUID(), fromId: params.fromId, toId: params.toId };
    ws().upsertWardleyMap({ ...base, id: WM_ID, links: [...base.links, link] });
    return { added: true, id: link.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<WardleyMap>(ctx.userId, KIND_WM, WM_ID);
    if (!base || !canLink(base, params)) return { added: false };
    const link: WardleyLink = { id: crypto.randomUUID(), fromId: params.fromId, toId: params.toId };
    await serverUpsertEntity<WardleyMap>(ctx.userId, KIND_WM, {
      ...base,
      id: WM_ID,
      links: [...base.links, link],
    });
    return { added: true, id: link.id };
  },
});

/** Both ends exist, it isn't a self-link, and it isn't an exact duplicate —
 *  the same rules the UI's Link button enforces. */
function canLink(map: WardleyMap, params: { fromId: string; toId: string }): boolean {
  if (params.fromId === params.toId) return false;
  if (map.links.some((l) => l.fromId === params.fromId && l.toId === params.toId)) return false;
  const ids = new Set(map.components.map((c) => c.id));
  return ids.has(params.fromId) && ids.has(params.toId);
}
