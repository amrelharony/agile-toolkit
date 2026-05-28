/**
 * Prioritizer — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.prioritizer.*
 * Backing CRUD : workspace.backlog_item.* (auto-generated).
 *
 *   1. list_state — backlog items with computed WSJF + RICE scores, plus a
 *                   WSJF-descending ranking and the MoSCoW breakdown.
 *   2. add_item   — add a backlog item (sensible scoring defaults).
 *
 * The WSJF / RICE formulas mirror prioritizer-client.tsx so the agent's
 * numbers match the UI. Entity kind "workspace:backlogItem" (camelCase via
 * kindFromToolId) matches the browser sync engine so writes round-trip.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type { BacklogItem } from "@/lib/stores/workspace-types";

const KIND_BACKLOG = "workspace:backlogItem";

const ws = () => useWorkspaceStore.getState();

/** WSJF = (businessValue + timeCriticality + riskReduction) / jobSize.
 *  Mirrors wsjfScore in prioritizer-client.tsx. */
function wsjf(item: BacklogItem): number {
  const cod = item.businessValue + item.timeCriticality + item.riskReduction;
  return parseFloat((cod / Math.max(1, item.jobSize)).toFixed(2));
}

/** RICE = reach * impact * (confidence/100) / effort. Mirrors riceScore in
 *  prioritizer-client.tsx, including the legacy-row guards. */
function rice(item: BacklogItem): number {
  const reach = Number.isFinite(item.reach) ? item.reach : 0;
  const impact = Number.isFinite(item.impact) ? item.impact : 0;
  const confidence = Number.isFinite(item.confidence) ? item.confidence : 0;
  const effort = Number.isFinite(item.effort) ? item.effort : 1;
  return parseFloat(((reach * impact * (confidence / 100)) / Math.max(0.1, effort)).toFixed(1));
}

function summarize(items: BacklogItem[]) {
  const byMoscow: Record<BacklogItem["moscow"], number> = { must: 0, should: 0, could: 0, wont: 0 };
  for (const i of items) if (i.moscow in byMoscow) byMoscow[i.moscow] += 1;
  const scored = items.map((i) => ({
    id: i.id,
    name: i.name,
    moscow: i.moscow,
    wsjf: wsjf(i),
    rice: rice(i),
  }));
  const rankedByWsjf = [...scored].sort((a, b) => b.wsjf - a.wsjf);
  return { total: items.length, byMoscow, items: scored, rankedByWsjf };
}

// ──────── tool.prioritizer.list_state ────────
registry.register({
  id: "tool.prioritizer.list_state",
  toolId: "tool.prioritizer",
  name: "list_state",
  category: "read",
  description:
    "List backlog items with computed scores. Returns {total, byMoscow: {must, should, could, wont}, items: {id, name, moscow, wsjf, rice}[], rankedByWsjf: same[] sorted by WSJF descending}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(ws().backlogItems ?? []),
  mcpHandler: async (_params, ctx) => {
    const items = await serverListEntities<BacklogItem>(ctx.userId, KIND_BACKLOG);
    return summarize(items);
  },
});

// ──────── tool.prioritizer.add_item ────────
registry.register({
  id: "tool.prioritizer.add_item",
  toolId: "tool.prioritizer",
  name: "add_item",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a backlog item. MoSCoW defaults to 'should'; WSJF/RICE/matrix inputs default to mid values. Returns {added: true, id}.",
  paramsSchema: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    moscow: z.enum(["must", "should", "could", "wont"]).optional(),
    businessValue: z.number().optional(),
    timeCriticality: z.number().optional(),
    riskReduction: z.number().optional(),
    jobSize: z.number().optional(),
    reach: z.number().optional(),
    impact: z.number().optional(),
    confidence: z.number().optional(),
    effort: z.number().optional(),
  }),
  handler: async (params) => {
    const item = buildItem(params);
    ws().upsertBacklogItem(item);
    return { added: true, id: item.id };
  },
  mcpHandler: async (params, ctx) => {
    const item = buildItem(params);
    await serverUpsertEntity<BacklogItem>(ctx.userId, KIND_BACKLOG, item);
    return { added: true, id: item.id };
  },
});

function buildItem(p: {
  name: string;
  description?: string;
  moscow?: BacklogItem["moscow"];
  businessValue?: number;
  timeCriticality?: number;
  riskReduction?: number;
  jobSize?: number;
  reach?: number;
  impact?: number;
  confidence?: number;
  effort?: number;
}): BacklogItem {
  const impact = (p.impact ?? 1) as BacklogItem["impact"];
  return {
    id: crypto.randomUUID(),
    name: p.name,
    description: p.description,
    moscow: p.moscow ?? "should",
    businessValue: p.businessValue ?? 5,
    timeCriticality: p.timeCriticality ?? 5,
    riskReduction: p.riskReduction ?? 5,
    jobSize: p.jobSize ?? 5,
    reach: p.reach ?? 100,
    impact,
    confidence: p.confidence ?? 80,
    effort: p.effort ?? 1,
    value: p.businessValue ?? 5,
    matrixEffort: p.effort ?? 5,
  };
}
