/**
 * Kudos Wall — tool-local actions.
 *
 * Category: Flow & Outcomes (squad S6) — squad-interactive recognition cards.
 * Tool:     A recognition wall. Live updates fan out over a realtime room;
 *           the owner's wall persists in the workspace store. As of this
 *           change kudos is ALSO a registered synced collection
 *           ("workspace:kudos"), so MCP reads/writes round-trip + cloud-sync.
 *
 * Agent surface: tool.kudos.*
 *   1. list_state         — the wall (newest first) + count.
 *   2. recognition_stats  — per-recipient / per-sender / theme / sentiment tally.
 *   3. post_kudos         — add a kudo (validated through canonical parseKudos).
 *   4. remove_kudos       — delete a kudo by id.
 *
 * post_kudos routes through parseKudos — the SAME validator the realtime wire
 * and the store's upsertKudos use — so an agent can't smuggle a malformed card
 * past a boundary. We deliberately do NOT add the generic
 * workspace.kudos.* CRUD (defineCrudActions) for kudos: generic create would
 * bypass that canonical validation + the v1→v2 upgrade stamp.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverListEntities,
  serverGetEntity,
  serverUpsertEntity,
  serverDeleteEntity,
} from "../server-store";
import { parseKudos } from "@/lib/kudos/parse";
import type { Kudos } from "@/lib/stores/workspace-types";

const KIND_K = "workspace:kudos";

const ws = () => useWorkspaceStore.getState();

function summarize(kudos: Kudos[]) {
  const sorted = [...kudos].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return { total: sorted.length, kudos: sorted };
}

function computeStats(kudos: Kudos[]) {
  const byRecipient: Record<string, number> = {};
  const bySender: Record<string, number> = {};
  const themeCounts: Record<string, number> = {};
  const sentimentCounts: Record<string, number> = {};
  for (const k of kudos) {
    byRecipient[k.toName] = (byRecipient[k.toName] ?? 0) + 1;
    bySender[k.fromName] = (bySender[k.fromName] ?? 0) + 1;
    const themeId = typeof k.theme === "string" ? k.theme : k.theme.id;
    themeCounts[themeId] = (themeCounts[themeId] ?? 0) + 1;
    if (k.sentiment)
      sentimentCounts[k.sentiment.label] = (sentimentCounts[k.sentiment.label] ?? 0) + 1;
  }
  const topRecipients = Object.entries(byRecipient)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return {
    total: kudos.length,
    byRecipient,
    bySender,
    themeCounts,
    sentimentCounts,
    topRecipients,
  };
}

/** Assemble the raw kudo for parseKudos (omits empty optionals it would reject). */
function buildKudo(params: {
  toName: string;
  message: string;
  fromName?: string;
  theme?: string;
  teamName?: string;
  toProfileId?: string;
  fromProfileId?: string;
}): unknown {
  const raw: Record<string, unknown> = {
    id: crypto.randomUUID(),
    theme: params.theme ?? "awesome",
    toName: params.toName,
    fromName: params.fromName ?? "AI Assistant",
    message: params.message,
    sentAt: new Date().toISOString(),
  };
  if (params.teamName) raw.teamName = params.teamName;
  if (params.toProfileId) raw.toProfileId = params.toProfileId;
  if (params.fromProfileId) raw.fromProfileId = params.fromProfileId;
  return raw;
}

// ──────── tool.kudos.list_state ────────
registry.register({
  id: "tool.kudos.list_state",
  toolId: "tool.kudos",
  name: "list_state",
  category: "read",
  description:
    "Read the kudos wall, newest first. Returns {total, kudos: {id, theme, toName, fromName, message, sentAt, ...}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(ws().kudos ?? []),
  mcpHandler: async (_params, ctx) =>
    summarize(await serverListEntities<Kudos>(ctx.userId, KIND_K)),
});

// ──────── tool.kudos.recognition_stats ────────
registry.register({
  id: "tool.kudos.recognition_stats",
  toolId: "tool.kudos",
  name: "recognition_stats",
  category: "read",
  description:
    "Recognition analytics over the wall. Returns {total, byRecipient (name -> count), bySender, themeCounts, sentimentCounts (positive/neutral/backhanded), topRecipients: {name, count}[] (desc)}. Compare byRecipient against the team roster to spot under-recognised members.",
  paramsSchema: z.object({}),
  handler: async () => computeStats(ws().kudos ?? []),
  mcpHandler: async (_params, ctx) =>
    computeStats(await serverListEntities<Kudos>(ctx.userId, KIND_K)),
});

// ──────── tool.kudos.post_kudos ────────
registry.register({
  id: "tool.kudos.post_kudos",
  toolId: "tool.kudos",
  name: "post_kudos",
  category: "write",
  requiresConfirmation: false,
  description:
    "Post a kudo to the wall. theme is a built-in id (awesome, thank-you, great-job, congratulations, very-happy, you-rock, well-done; default awesome). fromName defaults to 'AI Assistant'. Validated via parseKudos. Returns {posted: false, error} on a rejected shape, else {posted: true, id}.",
  paramsSchema: z.object({
    toName: z.string().min(1).max(80),
    message: z.string().min(1).max(2000),
    fromName: z.string().min(1).max(80).optional(),
    theme: z.string().max(64).optional(),
    teamName: z.string().min(1).max(80).optional(),
    toProfileId: z.string().min(1).max(64).optional(),
    fromProfileId: z.string().min(1).max(64).optional(),
  }),
  handler: async (params) => {
    const parsed = parseKudos(buildKudo(params));
    if (!parsed.ok) return { posted: false, error: parsed.error };
    ws().upsertKudos(parsed.kudos);
    return { posted: true, id: parsed.kudos.id };
  },
  mcpHandler: async (params, ctx) => {
    const parsed = parseKudos(buildKudo(params));
    if (!parsed.ok) return { posted: false, error: parsed.error };
    await serverUpsertEntity<Kudos>(ctx.userId, KIND_K, parsed.kudos);
    return { posted: true, id: parsed.kudos.id };
  },
});

// ──────── tool.kudos.remove_kudos ────────
registry.register({
  id: "tool.kudos.remove_kudos",
  toolId: "tool.kudos",
  name: "remove_kudos",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a kudo by id. Returns {removed: false} for an unknown id, else {removed: true}.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params) => {
    if (!(ws().kudos ?? []).some((k) => k.id === params.id)) return { removed: false };
    ws().removeKudos(params.id);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const existing = await serverGetEntity<Kudos>(ctx.userId, KIND_K, params.id);
    if (!existing) return { removed: false };
    await serverDeleteEntity(ctx.userId, KIND_K, params.id);
    return { removed: true };
  },
});
