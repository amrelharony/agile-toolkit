/**
 * Test Pyramid Analyzer — tool-local actions.
 *
 * Category: Quality Engineering (squad S10)
 * Tool:     The unit / integration / e2e split, the shape it makes (pyramid,
 *           ice-cream cone, hourglass, diamond, even), its run cost, and
 *           dated snapshots of the counts.
 *
 * Agent surface: tool.test_pyramid.*
 * Backing CRUD : workspace.test_pyramid.* (auto-generated). Singleton: one
 *                TestPyramid document (counts) under a fixed id.
 *
 *   1. list_state       — counts, shares, shape and verdict, run cost,
 *                         snapshots and the shape over time.
 *   2. set_counts       — set the counts, runtimes and weighting (merge).
 *   3. take_snapshot    — keep today's (or a past day's) counts as a snapshot.
 *   4. remove_snapshot  — delete a snapshot.
 *
 * The shape rules live in lib/quality/pyramid, which the page reads too,
 * and TEST_PYRAMID_KIND + TEST_PYRAMID_ID match the page, so MCP writes
 * round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { TestLayerRuntime, TestPyramid } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";
import {
  PYRAMID_NOTE_MAX,
  PYRAMID_SNAPSHOT_MAX,
  TEST_LAYERS,
  TEST_PYRAMID_ID,
  TEST_PYRAMID_KIND,
  classifyShape,
  hasAllRuntimes,
  layerShares,
  newSnapshotId,
  runCost,
  shapeHistory,
  shapeVerdict,
  snapshotDayError,
  snapshotOf,
  snapshotsOf,
  weightingOf,
  withSnapshot,
  withoutSnapshot,
  type LayerShares,
} from "@/lib/quality/pyramid";

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Where the document lives: the browser's workspace, or the user's rows on the server. */
interface PyramidStore {
  getDoc(): Promise<TestPyramid | null>;
  putDoc(doc: TestPyramid): Promise<void>;
}

const browserStore: PyramidStore = {
  getDoc: async () => (ws().testPyramids ?? []).find((d) => d.id === TEST_PYRAMID_ID) ?? null,
  putDoc: async (doc) => ws().upsertTestPyramid(doc),
};

function serverStore(userId: string): PyramidStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<TestPyramid>(userId, TEST_PYRAMID_KIND, TEST_PYRAMID_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<TestPyramid>(userId, TEST_PYRAMID_KIND, doc);
    },
  };
}

const sharesOut = (s: LayerShares | null) =>
  s ? { unit: round4(s.unit), integration: round4(s.integration), e2e: round4(s.e2e) } : null;

/** The runtimes entered, or null with none. */
function runtimeOut(r: TestLayerRuntime | undefined) {
  if (!r) return null;
  const out: TestLayerRuntime = {};
  for (const l of TEST_LAYERS) if (typeof r[l] === "number") out[l] = r[l];
  return Object.keys(out).length > 0 ? out : null;
}

function summarize(doc: TestPyramid | null) {
  const unit = doc?.unit ?? 0;
  const integration = doc?.integration ?? 0;
  const e2e = doc?.e2e ?? 0;
  const total = unit + integration + e2e;
  const pct = (n: number) => (total ? round2((n / total) * 100) : 0);
  const weighting = weightingOf(doc);
  const shares = doc ? layerShares(doc, weighting, doc.runtime) : null;
  const shape = classifyShape(shares);
  const cost = doc ? runCost(doc, weighting, doc.runtime) : null;
  const snapshots = snapshotsOf(doc);
  const latest = snapshots[snapshots.length - 1] ?? null;
  return {
    exists: doc !== null,
    unit,
    integration,
    e2e,
    total,
    pctUnit: pct(unit),
    pctIntegration: pct(integration),
    pctE2e: pct(e2e),
    // Kept with their meaning for older agents: both read the counts.
    // healthy: the counts make a pyramid; inverted: more e2e than unit.
    healthy: doc !== null && classifyShape(layerShares(doc)) === "pyramid",
    inverted: e2e > unit,
    weighting,
    runtime: runtimeOut(doc?.runtime),
    shares: sharesOut(shares),
    shape,
    verdict: shapeVerdict(shape, shares, weighting),
    runCost: cost
      ? {
          basis: cost.basis,
          byLayer: cost.byLayer,
          total: round2(cost.total),
        }
      : null,
    description: doc?.description ?? null,
    updatedOn: doc?.updatedOn ?? null,
    snapshotCount: snapshots.length,
    latestSnapshot: latest
      ? {
          id: latest.id,
          takenOn: latest.takenOn,
          unit: latest.unit,
          integration: latest.integration,
          e2e: latest.e2e,
          runtime: runtimeOut(latest.runtime),
          note: latest.note ?? null,
        }
      : null,
    shapeHistory: shapeHistory(snapshots, weighting).map((p) => ({
      id: p.id,
      takenOn: p.takenOn,
      shape: p.shape,
      unitShare: p.unitShare === null ? null : round4(p.unitShare),
    })),
  };
}

// ──────── tool.test_pyramid.list_state ────────
registry.register({
  id: "tool.test_pyramid.list_state",
  toolId: "tool.test_pyramid",
  name: "list_state",
  category: "read",
  description:
    "Summarise the test pyramid. Returns {exists, unit, integration, e2e, total, pctUnit, pctIntegration, pctE2e (0-100 of the counts), healthy (the counts make a pyramid), inverted (more e2e than unit tests), weighting ('count' | 'runtime'), runtime ({unit?, integration?, e2e?} minutes, or null), shares (0..1 per layer by the weighting, or null), shape ('pyramid' | 'ice-cream-cone' | 'hourglass' | 'diamond' | 'even' | 'empty'; layers within 5 points count as level), verdict (one sentence), runCost ({basis: 'count' = the relative 1/5/25 index | 'runtime' = minutes, byLayer, total} or null), description, updatedOn, snapshotCount, latestSnapshot, shapeHistory: {id, takenOn, shape (null when weighing by runtime and that snapshot has no minutes), unitShare}[] oldest first}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.getDoc()),
  mcpHandler: async (_params, ctx) => summarize(await serverStore(ctx.userId).getDoc()),
});

// ──────── tool.test_pyramid.set_counts ────────

const Minutes = z.number().finite().min(0);

const SetCountsParams = z.object({
  unit: z.number().int().min(0).optional(),
  integration: z.number().int().min(0).optional(),
  e2e: z.number().int().min(0).optional(),
  description: z.string().max(2000).nullable().optional().describe("null or blank clears it."),
  runtime: z
    .object({
      unit: Minutes.nullable().optional(),
      integration: Minutes.nullable().optional(),
      e2e: Minutes.nullable().optional(),
    })
    .nullable()
    .optional()
    .describe(
      "Minutes of CI wall-clock per layer (merge: a layer left out is kept, null clears it); null clears all."
    ),
  weighting: z
    .enum(["count", "runtime"])
    .optional()
    .describe("'runtime' works the shares out from the minutes and needs all three."),
});

async function setCounts(store: PyramidStore, params: z.infer<typeof SetCountsParams>) {
  const base = await store.getDoc();
  if (
    !base &&
    (params.unit === undefined || params.integration === undefined || params.e2e === undefined)
  ) {
    return {
      updated: false,
      reason: "missing_counts" as const,
      message: "A new pyramid needs all three counts: unit, integration and e2e.",
    };
  }
  const runtime: TestLayerRuntime = params.runtime === null ? {} : { ...(base?.runtime ?? {}) };
  if (params.runtime) {
    for (const l of TEST_LAYERS) {
      const v = params.runtime[l];
      if (v === null) delete runtime[l];
      else if (v !== undefined) runtime[l] = v;
    }
  }
  const weighting = params.weighting ?? weightingOf(base);
  if (weighting === "runtime" && !hasAllRuntimes(runtime)) {
    return {
      updated: false,
      reason: "runtime_needed" as const,
      message:
        "Weighting by runtime needs the minutes of all three layers; set them, or set weighting to 'count'.",
    };
  }
  const description =
    params.description === undefined ? base?.description : params.description?.trim() || undefined;
  const next: TestPyramid = {
    ...(base ?? {}),
    id: TEST_PYRAMID_ID,
    unit: params.unit ?? (base as TestPyramid).unit,
    integration: params.integration ?? (base as TestPyramid).integration,
    e2e: params.e2e ?? (base as TestPyramid).e2e,
    updatedOn: todayLocalISO(),
  };
  if (description) next.description = description;
  else delete next.description;
  if (Object.keys(runtime).length > 0) next.runtime = runtime;
  else delete next.runtime;
  if (weighting === "runtime") next.weighting = "runtime";
  else if (params.weighting === "count" || next.weighting !== undefined) next.weighting = "count";
  await store.putDoc(next);
  return {
    updated: true,
    shape: classifyShape(layerShares(next, weighting, next.runtime)),
  };
}

registry.register({
  id: "tool.test_pyramid.set_counts",
  toolId: "tool.test_pyramid",
  name: "set_counts",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the test counts, the minutes per layer and the weighting (merge — a field left out is kept). A new pyramid needs all three counts. Stamps updatedOn. Returns {updated: true, shape}, or {updated: false, reason: 'missing_counts' | 'runtime_needed', message}.",
  paramsSchema: SetCountsParams,
  handler: async (params) => setCounts(browserStore, params),
  mcpHandler: async (params, ctx) => setCounts(serverStore(ctx.userId), params),
});

// ──────── tool.test_pyramid.take_snapshot ────────

const TakeSnapshotParams = z.object({
  takenOn: z
    .string()
    .optional()
    .describe(
      "YYYY-MM-DD the counts are for, the user's local day; defaults to today; never after today: over MCP the default is the server's day, which may be a day behind theirs, so the day after it is taken too."
    ),
  note: z.string().max(PYRAMID_NOTE_MAX).optional(),
});

/**
 * The latest day a snapshot can be for. In the browser, today; on the
 * server, whose day (UTC on a typical deploy) isn't the person's, the day
 * after it, so a person ahead of UTC can snapshot on their own today, as
 * the page does with the browser's day (decision-log's latestDay).
 */
const latestDay = (today: string, onServer: boolean) => (onServer ? addDays(today, 1) : today);

async function takeSnapshot(
  store: PyramidStore,
  params: z.infer<typeof TakeSnapshotParams>,
  onServer: boolean
) {
  const doc = await store.getDoc();
  if (!doc) {
    return {
      taken: false,
      reason: "no_counts" as const,
      message: "Set the counts first (set_counts).",
    };
  }
  const today = todayLocalISO();
  const takenOn = params.takenOn?.trim() || today;
  const error = snapshotDayError(takenOn, latestDay(today, onServer));
  if (error) return { taken: false, reason: "invalid_date" as const, message: `takenOn: ${error}` };
  if ((doc.snapshots ?? []).length >= PYRAMID_SNAPSHOT_MAX) {
    return {
      taken: false,
      reason: "too_many" as const,
      message: `A pyramid keeps at most ${PYRAMID_SNAPSHOT_MAX} snapshots; remove one first.`,
    };
  }
  const snapshot = snapshotOf(doc, takenOn, newSnapshotId(), params.note);
  await store.putDoc(withSnapshot(doc, snapshot));
  return { taken: true, id: snapshot.id, takenOn };
}

registry.register({
  id: "tool.test_pyramid.take_snapshot",
  toolId: "tool.test_pyramid",
  name: "take_snapshot",
  category: "write",
  requiresConfirmation: false,
  description:
    "Keep the current counts (and the minutes, when entered) as a dated snapshot, for the shape over time. takenOn (the user's local day) may be backdated, never after today; over MCP the day after the server's is taken too. Returns {taken: true, id, takenOn}, or {taken: false, reason: 'no_counts' | 'invalid_date' | 'too_many', message}.",
  paramsSchema: TakeSnapshotParams,
  handler: async (params) => takeSnapshot(browserStore, params, false),
  mcpHandler: async (params, ctx) => takeSnapshot(serverStore(ctx.userId), params, true),
});

// ──────── tool.test_pyramid.remove_snapshot ────────

const RemoveSnapshotParams = z.object({ snapshotId: z.string().min(1) });

async function removeSnapshot(store: PyramidStore, params: z.infer<typeof RemoveSnapshotParams>) {
  const doc = await store.getDoc();
  const next = doc ? withoutSnapshot(doc, params.snapshotId) : null;
  if (!next) return { removed: false, reason: "not_found" as const };
  await store.putDoc(next);
  return { removed: true };
}

registry.register({
  id: "tool.test_pyramid.remove_snapshot",
  toolId: "tool.test_pyramid",
  name: "remove_snapshot",
  category: "write",
  requiresConfirmation: false,
  description:
    "Delete a snapshot by id (from list_state latestSnapshot or shapeHistory). Returns {removed: true}, or {removed: false, reason: 'not_found'}.",
  paramsSchema: RemoveSnapshotParams,
  handler: async (params) => removeSnapshot(browserStore, params),
  mcpHandler: async (params, ctx) => removeSnapshot(serverStore(ctx.userId), params),
});
