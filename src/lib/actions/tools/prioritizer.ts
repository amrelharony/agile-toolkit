/**
 * Prioritizer — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.prioritizer.*
 * Backing CRUD : workspace.backlog_item.* (auto-generated).
 *
 *   1. list_state — backlog items with computed WSJF + RICE scores, plus a
 *                   WSJF-descending ranking and the MoSCoW breakdown. Each
 *                   item also carries `frameworkScores`: every method's
 *                   score, the same as the Prioritizer's "All methods" tab.
 *   2. add_item   — add a backlog item (sensible scoring defaults).
 *
 * The WSJF / RICE formulas come from src/lib/prioritization/scores.ts, which
 * the Prioritizer UI uses too, so the agent's numbers match the screen.
 * Entity kind "workspace:backlogItem" (camelCase via kindFromToolId) matches
 * the browser sync engine so writes round-trip.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { backlogRice, backlogWsjf, frameworkScores } from "@/lib/prioritization/scores";
import { createBacklogItem } from "@/lib/prioritization/frameworks";

const KIND_BACKLOG = "workspace:backlogItem";
const KIND_PRIORITIZATION = "workspace:prioritization";

const ws = () => useWorkspaceStore.getState();

/** `rows` are the method tools' rows; the ones linked to an item feed its ICE, Kano and Cost of Delay. */
function summarize(items: BacklogItem[], rows: PrioritizationItem[] = []) {
  const byMoscow: Record<BacklogItem["moscow"], number> = { must: 0, should: 0, could: 0, wont: 0 };
  for (const i of items) if (i.moscow in byMoscow) byMoscow[i.moscow] += 1;
  const scored = items.map((i) => ({
    id: i.id,
    name: i.name,
    moscow: i.moscow,
    wsjf: backlogWsjf(i),
    rice: backlogRice(i),
    frameworkScores: frameworkScores(i, rows),
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
    "List backlog items with computed scores. Returns {total, byMoscow: {must, should, could, wont}, items: {id, name, moscow, wsjf, rice, frameworkScores}[], rankedByWsjf: same[] sorted by WSJF descending}. frameworkScores is every method's score for the item: {moscow, wsjf, rice, valueEffort: {value, effort, quadrant}} from the item's own inputs, plus {ice, kano, costOfDelay} from the latest row in those tools linked to it (null when none).",
  paramsSchema: z.object({}),
  handler: async () => summarize(ws().backlogItems ?? [], ws().prioritizations ?? []),
  mcpHandler: async (_params, ctx) => {
    const [items, rows] = await Promise.all([
      serverListEntities<BacklogItem>(ctx.userId, KIND_BACKLOG),
      serverListEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION),
    ]);
    return summarize(items, rows);
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
  // Same defaults and value coupling as a row added in the Prioritizer
  // (createBacklogItem): business value also sets the matrix value (clamped
  // to 1–10). RICE effort is person-months and stays out of the 1–10 matrix
  // effort, which keeps its default.
  const { name, ...inputs } = p;
  const patch: Partial<BacklogItem> = {};
  for (const [key, v] of Object.entries(inputs)) {
    if (v !== undefined) (patch as Record<string, unknown>)[key] = v;
  }
  return createBacklogItem(name, patch);
}
