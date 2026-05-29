/**
 * Squad Health Check — tool-local actions.
 *
 * Category: Team Health & Maturity (squad S4)
 * Tool:     Spotify-model health check — 8 dimensions rated with traffic lights
 *           + trend, an in-progress "current" check, and saved history.
 *
 * Agent surface: tool.health_check.*
 * Backing CRUD : workspace.health_check.* (auto-generated). Singleton: one
 *                HealthCheck document ({current, history[]}) under a fixed id.
 *
 *   1. list_state      — current check + health %, history with per-check health.
 *   2. set_sprint_name — name the in-progress check.
 *   3. set_dimension   — set a dimension's light and/or trend; refuses unknown.
 *   4. save_check      — snapshot current into history, then reset current.
 *   5. reset           — clear current + history.
 *
 * Entity kind "workspace:healthCheck" + the fixed HC_ID match
 * health-check-client.tsx, so MCP writes round-trip into the UI. Dimensions +
 * types come from workspace-types (single source shared with the client).
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  HEALTH_CHECK_DIMENSIONS,
  type HealthCheck,
  type HealthCheckSnapshot,
  type HealthDimension,
  type HealthDimensionScore,
} from "@/lib/stores/workspace-types";

const KIND_HC = "workspace:healthCheck";
// MUST match HEALTH_CHECK_ID in health-check-client.tsx.
const HC_ID = "healthCheck:current";

// Set<string> (not Set<HealthDimension>) so .has(arbitraryString) typechecks.
const KNOWN_DIMENSIONS = new Set<string>(HEALTH_CHECK_DIMENSIONS);

const ws = () => useWorkspaceStore.getState();

function defaultScores(): Record<HealthDimension, HealthDimensionScore> {
  return Object.fromEntries(
    HEALTH_CHECK_DIMENSIONS.map((d) => [d, { light: "green", trend: "same" }])
  ) as Record<HealthDimension, HealthDimensionScore>;
}

function emptySnapshot(): HealthCheckSnapshot {
  return { sprintName: "", scores: defaultScores() };
}

function emptyDoc(): HealthCheck {
  return { id: HC_ID, current: emptySnapshot(), history: [] };
}

function browserDoc(): HealthCheck | null {
  return (ws().healthChecks ?? []).find((d) => d.id === HC_ID) ?? null;
}

/** Health % = share of dimensions rated green, rounded. */
function healthPct(scores: Record<HealthDimension, HealthDimensionScore>): number {
  const green = HEALTH_CHECK_DIMENSIONS.filter((d) => scores[d]?.light === "green").length;
  return Math.round((green / HEALTH_CHECK_DIMENSIONS.length) * 100);
}

function summarize(doc: HealthCheck | null) {
  const current = doc?.current ?? emptySnapshot();
  const history = doc?.history ?? [];
  return {
    exists: doc !== null,
    current,
    currentHealth: healthPct(current.scores),
    checkCount: history.length,
    history: history.map((h) => ({
      id: h.id,
      sprintName: h.sprintName,
      date: h.date,
      scores: h.scores,
      health: healthPct(h.scores),
    })),
  };
}

// ──────── tool.health_check.list_state ────────
registry.register({
  id: "tool.health_check.list_state",
  toolId: "tool.health_check",
  name: "list_state",
  category: "read",
  description:
    "Summarise the squad health check. Returns {exists, current: {sprintName, scores (dimension -> {light, trend})}, currentHealth (% green), checkCount, history: {id, sprintName, date, scores, health}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<HealthCheck>(ctx.userId, KIND_HC, HC_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.health_check.set_sprint_name ────────
registry.register({
  id: "tool.health_check.set_sprint_name",
  toolId: "tool.health_check",
  name: "set_sprint_name",
  category: "write",
  requiresConfirmation: false,
  description:
    "Name the in-progress check (used when it is saved to history). Creates the check if absent. Returns {set: true}.",
  paramsSchema: z.object({ sprintName: z.string().max(200) }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    ws().upsertHealthCheck({
      ...base,
      id: HC_ID,
      current: { ...base.current, sprintName: params.sprintName },
    });
    return { set: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<HealthCheck>(ctx.userId, KIND_HC, HC_ID)) ?? emptyDoc();
    await serverUpsertEntity<HealthCheck>(ctx.userId, KIND_HC, {
      ...base,
      id: HC_ID,
      current: { ...base.current, sprintName: params.sprintName },
    });
    return { set: true };
  },
});

// ──────── tool.health_check.set_dimension ────────
const setDimensionParams = z.object({
  dimension: z.string().describe("One of the 8 health dimensions, e.g. 'Fun', 'Teamwork'."),
  light: z.enum(["green", "yellow", "red"]).optional(),
  trend: z.enum(["up", "same", "down"]).optional(),
});

function applyDimension(
  base: HealthCheck,
  params: z.infer<typeof setDimensionParams>
): HealthCheck {
  const dim = params.dimension as HealthDimension;
  const prev = base.current.scores[dim] ?? { light: "green", trend: "same" };
  const nextScore: HealthDimensionScore = {
    light: params.light ?? prev.light,
    trend: params.trend ?? prev.trend,
  };
  return {
    ...base,
    id: HC_ID,
    current: { ...base.current, scores: { ...base.current.scores, [dim]: nextScore } },
  };
}

registry.register({
  id: "tool.health_check.set_dimension",
  toolId: "tool.health_check",
  name: "set_dimension",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a dimension's traffic light (green/yellow/red) and/or trend (up/same/down) on the current check. Pass at least one of light/trend. Returns {set: false} for an unknown dimension, else {set: true}.",
  paramsSchema: setDimensionParams,
  handler: async (params) => {
    if (!KNOWN_DIMENSIONS.has(params.dimension)) return { set: false };
    ws().upsertHealthCheck(applyDimension(browserDoc() ?? emptyDoc(), params));
    return { set: true };
  },
  mcpHandler: async (params, ctx) => {
    if (!KNOWN_DIMENSIONS.has(params.dimension)) return { set: false };
    const base = (await serverGetEntity<HealthCheck>(ctx.userId, KIND_HC, HC_ID)) ?? emptyDoc();
    await serverUpsertEntity<HealthCheck>(ctx.userId, KIND_HC, applyDimension(base, params));
    return { set: true };
  },
});

// ──────── tool.health_check.save_check ────────
function saveCheck(base: HealthCheck): { next: HealthCheck; id: string; checkCount: number } {
  const id = crypto.randomUUID();
  const entry = {
    id,
    sprintName: base.current.sprintName || `Check ${base.history.length + 1}`,
    date: todayLocalISO(),
    scores: { ...base.current.scores },
  };
  const next: HealthCheck = {
    ...base,
    id: HC_ID,
    history: [...base.history, entry],
    current: emptySnapshot(),
  };
  return { next, id, checkCount: next.history.length };
}

registry.register({
  id: "tool.health_check.save_check",
  toolId: "tool.health_check",
  name: "save_check",
  category: "write",
  requiresConfirmation: false,
  description:
    "Snapshot the current check into history (sprint name defaults to 'Check N') and reset the current check to all-green. Returns {saved: true, id, checkCount}.",
  paramsSchema: z.object({}),
  handler: async () => {
    const { next, id, checkCount } = saveCheck(browserDoc() ?? emptyDoc());
    ws().upsertHealthCheck(next);
    return { saved: true, id, checkCount };
  },
  mcpHandler: async (_params, ctx) => {
    const base = (await serverGetEntity<HealthCheck>(ctx.userId, KIND_HC, HC_ID)) ?? emptyDoc();
    const { next, id, checkCount } = saveCheck(base);
    await serverUpsertEntity<HealthCheck>(ctx.userId, KIND_HC, next);
    return { saved: true, id, checkCount };
  },
});

// ──────── tool.health_check.reset ────────
registry.register({
  id: "tool.health_check.reset",
  toolId: "tool.health_check",
  name: "reset",
  category: "write",
  requiresConfirmation: false,
  description: "Clear the current check and all saved history. Returns {reset: true}.",
  paramsSchema: z.object({}),
  handler: async () => {
    ws().upsertHealthCheck(emptyDoc());
    return { reset: true };
  },
  mcpHandler: async (_params, ctx) => {
    await serverUpsertEntity<HealthCheck>(ctx.userId, KIND_HC, emptyDoc());
    return { reset: true };
  },
});
