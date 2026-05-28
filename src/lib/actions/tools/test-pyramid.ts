/**
 * Test Pyramid Analyzer — tool-local actions.
 *
 * Category: Quality Engineering (squad S10)
 * Tool:     Visualise the unit/integration/e2e split and flag inverted shapes.
 *
 * Agent surface: tool.test_pyramid.*
 * Backing CRUD : workspace.test_pyramid.* (auto-generated). Singleton: one
 *                TestPyramid document (counts) under a fixed id.
 *
 *   1. list_state  — counts + percentages + shape analysis (healthy pyramid
 *                    vs inverted "ice-cream cone").
 *   2. set_counts  — set unit/integration/e2e counts (merge).
 *
 * Entity kind "workspace:testPyramid" + the fixed TP_ID match
 * test-pyramid-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { TestPyramid } from "@/lib/stores/workspace-types";

const KIND_PYRAMID = "workspace:testPyramid";
// MUST match TP_ID in test-pyramid-client.tsx.
const TP_ID = "testPyramid:current";

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyDoc(): TestPyramid {
  return { id: TP_ID, unit: 0, integration: 0, e2e: 0 };
}

function browserDoc(): TestPyramid | null {
  return (ws().testPyramids ?? []).find((d) => d.id === TP_ID) ?? null;
}

function summarize(doc: TestPyramid | null) {
  const unit = doc?.unit ?? 0;
  const integration = doc?.integration ?? 0;
  const e2e = doc?.e2e ?? 0;
  const total = unit + integration + e2e;
  const pct = (n: number) => (total ? round2((n / total) * 100) : 0);
  return {
    exists: doc !== null,
    unit,
    integration,
    e2e,
    total,
    pctUnit: pct(unit),
    pctIntegration: pct(integration),
    pctE2e: pct(e2e),
    // Healthy pyramid: each layer ≥ the one above it. Inverted ("ice-cream
    // cone"): more e2e than unit tests — the anti-pattern the tool flags.
    healthy: total > 0 && unit >= integration && integration >= e2e,
    inverted: e2e > unit,
  };
}

// ──────── tool.test_pyramid.list_state ────────
registry.register({
  id: "tool.test_pyramid.list_state",
  toolId: "tool.test_pyramid",
  name: "list_state",
  category: "read",
  description:
    "Summarise the test pyramid. Returns {exists, unit, integration, e2e, total, pctUnit, pctIntegration, pctE2e, healthy (each layer ≥ the one above), inverted (more e2e than unit — the anti-pattern)}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<TestPyramid>(ctx.userId, KIND_PYRAMID, TP_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.test_pyramid.set_counts ────────
registry.register({
  id: "tool.test_pyramid.set_counts",
  toolId: "tool.test_pyramid",
  name: "set_counts",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the test counts (merge — omitted layers untouched). Creates the doc if absent. Returns {updated: true}.",
  paramsSchema: z.object({
    unit: z.number().int().min(0).optional(),
    integration: z.number().int().min(0).optional(),
    e2e: z.number().int().min(0).optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    ws().upsertTestPyramid({ ...base, ...params, id: TP_ID });
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<TestPyramid>(ctx.userId, KIND_PYRAMID, TP_ID)) ?? emptyDoc();
    await serverUpsertEntity<TestPyramid>(ctx.userId, KIND_PYRAMID, {
      ...base,
      ...params,
      id: TP_ID,
    });
    return { updated: true };
  },
});
