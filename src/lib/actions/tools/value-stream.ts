/**
 * Value Stream Map — tool-local actions.
 *
 * Category: Flow & Delivery (squad S6)
 * Agent surface: tool.value_stream.*
 * Backing CRUD : workspace.value_stream_stage.* (auto-generated).
 *
 *   1. list_state         — the current map's totals (process, lead, wait,
 *      flow efficiency, rolled %C/A), its bottleneck, the future map and
 *      the comparison, the stages of both maps in order, and the page's
 *      verdict.
 *   2. add_stage          — add a stage at the end of a map (current by default).
 *   3. move_stage         — move a stage to a position in its map.
 *   4. start_future_state — copy the current map into an empty future map.
 *
 * Every number comes from lib/value-stream/summary, the page's own: times
 * are read at 0 or more, %C/A from 0 to 100, flow efficiency capped at
 * 100, and a map's order is its stages' `order` (stages saved before
 * reordering keep their stored position, after the numbered ones).
 *
 * Entity kind "workspace:valueStreamStage" (camelCase via kindFromToolId)
 * matches the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type { ValueStreamStage } from "@/lib/stores/workspace-types";
import {
  accuracyOf,
  appendStage,
  bottleneck,
  changedStages,
  compareStates,
  comparisonVerdict,
  copyToFuture,
  leadOf,
  moveStage,
  orderedStages,
  processOf,
  stageState,
  vsmSummary,
  vsmVerdict,
  waitOf,
} from "@/lib/value-stream/summary";

const KIND_VS = "workspace:valueStreamStage";

const ws = () => useWorkspaceStore.getState();

const round1 = (n: number) => Math.round(n * 10) / 10;
const round0 = (n: number | null) => (n === null ? null : Math.round(n));

/** A page example's stage (an `example-` id) never counts; the page keeps them in memory anyway. */
const real = (stages: readonly ValueStreamStage[]) =>
  stages.filter((s) => typeof s?.id === "string" && !s.id.startsWith("example-"));

/** Where the stages live: the browser's workspace, or the user's rows on the server. */
interface StageStore {
  list(): Promise<ValueStreamStage[]>;
  put(stage: ValueStreamStage): Promise<void>;
}

const browserStore: StageStore = {
  list: async () => real(ws().valueStreamStages ?? []),
  put: async (stage) => ws().upsertValueStreamStage(stage),
};

function serverStore(userId: string): StageStore {
  return {
    list: async () => real(await serverListEntities<ValueStreamStage>(userId, KIND_VS)),
    put: async (stage) => {
      await serverUpsertEntity<ValueStreamStage>(userId, KIND_VS, stage);
    },
  };
}

/** Write the stages `next` changed against `before`; returns how many. */
async function writeChanges(
  store: StageStore,
  before: readonly ValueStreamStage[],
  next: readonly ValueStreamStage[]
): Promise<number> {
  const changed = changedStages(before, next);
  for (const s of changed) await store.put(s);
  return changed.length;
}

/**
 * One map's totals, in the shape list_state has always returned. With no
 * stages (or no lead time) the percentages are 0, as before; the page
 * shows "—" for those.
 */
function totals(stages: readonly ValueStreamStage[]) {
  const s = vsmSummary(stages);
  return {
    stageCount: s.stageCount,
    totalProcessTime: round1(s.totalProcess),
    totalLeadTime: round1(s.totalLead),
    totalWaitTime: round1(s.totalWait),
    flowEfficiencyPct: Math.round(s.flowEfficiency ?? 0),
    rolledCompleteAccuratePct: Math.round(s.rolledCA ?? 0),
  };
}

function stageRow(s: ValueStreamStage, index: number) {
  return {
    id: s.id,
    name: s.name,
    state: stageState(s),
    order: index,
    processTime: round1(processOf(s)),
    leadTime: round1(leadOf(s)),
    waitTime: round1(waitOf(s)),
    completeAccurate: round1(accuracyOf(s)),
    ...(s.description ? { description: s.description } : {}),
  };
}

function summarize(all: readonly ValueStreamStage[]) {
  const current = orderedStages(all, "current");
  const future = orderedStages(all, "future");
  const neck = bottleneck(current);
  const futureNeck = bottleneck(future);
  const comparison = compareStates(current, future);
  return {
    ...totals(current),
    verdict: vsmVerdict(current),
    bottleneck: neck
      ? {
          id: neck.stage.id,
          name: neck.stage.name,
          waitDays: round1(neck.waitDays),
          sharePct: Math.round(neck.sharePct),
        }
      : null,
    future:
      future.length > 0
        ? {
            ...totals(future),
            bottleneck: futureNeck
              ? {
                  id: futureNeck.stage.id,
                  name: futureNeck.stage.name,
                  waitDays: round1(futureNeck.waitDays),
                  sharePct: Math.round(futureNeck.sharePct),
                }
              : null,
          }
        : null,
    comparison: comparison
      ? {
          leadDeltaDays: round1(comparison.leadDelta),
          processDeltaDays: round1(comparison.processDelta),
          waitDeltaDays: round1(comparison.waitDelta),
          flowEfficiencyDeltaPts: round0(comparison.flowEfficiencyDelta),
          rolledCompleteAccurateDeltaPts: round0(comparison.rolledCADelta),
          verdict: comparisonVerdict(comparison),
        }
      : null,
    stages: [...current.map(stageRow), ...future.map(stageRow)],
  };
}

// ──────── tool.value_stream.list_state ────────
registry.register({
  id: "tool.value_stream.list_state",
  toolId: "tool.value_stream",
  name: "list_state",
  category: "read",
  description:
    "Summarise the value stream map, as the page shows it. Returns the current map's totals {stageCount, totalProcessTime, totalLeadTime, totalWaitTime (days), flowEfficiencyPct (process ÷ lead, capped at 100; 0 without lead time), rolledCompleteAccuratePct (product of per-stage %C/A; 0 without stages)}, plus verdict (the page's one sentence), bottleneck {id, name, waitDays, sharePct (of the lead time)} | null (the longest wait, ties to the longer lead; null with < 2 stages or no waiting), future {the same totals, bottleneck} | null (null until a future map exists), comparison {leadDeltaDays, processDeltaDays, waitDeltaDays, flowEfficiencyDeltaPts, rolledCompleteAccurateDeltaPts, verdict} | null (future minus current), and stages: {id, name, state 'current' | 'future', order (0-based position in its map), processTime, leadTime, waitTime, completeAccurate, description?}[] in map order, current first. Times are clamped at 0 and %C/A to 0–100 as on the page.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.list()),
  mcpHandler: async (_params, ctx) => summarize(await serverStore(ctx.userId).list()),
});

// ──────── tool.value_stream.add_stage ────────
const AddStageParams = z.object({
  name: z.string().min(1),
  processTime: z.number().min(0).describe("Days of work on an item in the stage."),
  leadTime: z
    .number()
    .min(0)
    .describe("Days from arriving in the stage to leaving it, waiting included."),
  completeAccurate: z.number().min(0).max(100).describe("Percent complete and accurate, 0–100."),
  description: z.string().optional(),
  state: z
    .enum(["current", "future"])
    .optional()
    .describe("Which map to add it to; default current."),
});

async function addStage(store: StageStore, params: z.infer<typeof AddStageParams>) {
  const before = await store.list();
  const { state = "current", ...fields } = params;
  const stage: ValueStreamStage = { id: `vsstage_${nanoid(8)}`, ...fields, state };
  const next = appendStage(before, stage);
  await writeChanges(store, before, next);
  const order = orderedStages(next, state).findIndex((s) => s.id === stage.id);
  return { added: true, id: stage.id, state, order };
}

registry.register({
  id: "tool.value_stream.add_stage",
  toolId: "tool.value_stream",
  name: "add_stage",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a stage at the end of a map, as the page's Add stage does. Params: name, processTime and leadTime in days (process is part of lead, so keep it no longer), completeAccurate (%C/A, 0–100), description?, state? ('current' default, or 'future'). Stages already in that map that had no saved order get theirs written, so every device shows the same order. Returns {added: true, id, state, order (0-based position)}.",
  paramsSchema: AddStageParams,
  handler: async (params) => addStage(browserStore, params),
  mcpHandler: async (params, ctx) => addStage(serverStore(ctx.userId), params),
});

// ──────── tool.value_stream.move_stage ────────
const MoveStageParams = z.object({
  id: z.string().min(1).describe("The stage to move."),
  toIndex: z
    .number()
    .int()
    .min(0)
    .describe("Its new 0-based position in its own map; past the end means last."),
});

async function moveStageAction(store: StageStore, params: z.infer<typeof MoveStageParams>) {
  const before = await store.list();
  const stage = before.find((s) => s.id === params.id);
  if (!stage) return { moved: false, reason: "not_found" as const };
  const next = moveStage(before, params.id, params.toIndex);
  const written = await writeChanges(store, before, next);
  const state = stageState(stage);
  const ordered = orderedStages(next, state);
  return {
    moved: written > 0,
    id: params.id,
    state,
    index: ordered.findIndex((s) => s.id === params.id),
    order: ordered.map((s) => s.id),
  };
}

registry.register({
  id: "tool.value_stream.move_stage",
  toolId: "tool.value_stream",
  name: "move_stage",
  category: "write",
  requiresConfirmation: false,
  description:
    "Move a stage to a position in its map (current or future), as the page's Move earlier / later does; the whole map is renumbered so every device shows the same order. Params: id, toIndex (0-based; clamped to the map). Returns {moved (false when it was already there), id, state, index (its position now), order (the map's stage ids in order)} or {moved: false, reason: 'not_found'}.",
  paramsSchema: MoveStageParams,
  handler: async (params) => moveStageAction(browserStore, params),
  mcpHandler: async (params, ctx) => moveStageAction(serverStore(ctx.userId), params),
});

// ──────── tool.value_stream.start_future_state ────────
async function startFuture(store: StageStore) {
  const before = await store.list();
  if (orderedStages(before, "future").length > 0) {
    return { created: 0, reason: "future_exists" as const, ids: [] as string[] };
  }
  if (orderedStages(before, "current").length === 0) {
    return { created: 0, reason: "no_current_stages" as const, ids: [] as string[] };
  }
  const copies = copyToFuture(before, () => `vsstage_${nanoid(8)}`);
  for (const s of copies) await store.put(s);
  return { created: copies.length, ids: copies.map((s) => s.id) };
}

registry.register({
  id: "tool.value_stream.start_future_state",
  toolId: "tool.value_stream",
  name: "start_future_state",
  category: "write",
  requiresConfirmation: false,
  description:
    "Start the future-state map from the current one, as the page's button does: copies the current stages, in order, into the future map with new ids, to edit into the flow the team wants. Only when the future map is empty. No params. Returns {created, ids} or {created: 0, reason: 'future_exists' | 'no_current_stages', ids: []}.",
  paramsSchema: z.object({}),
  handler: async () => startFuture(browserStore),
  mcpHandler: async (_params, ctx) => startFuture(serverStore(ctx.userId)),
});
