/**
 * DORA Scorecard — tool-local actions.
 *
 * Category: Engineering Excellence (squad S7)
 * Tool:     Manual-input dashboard for the 4 DORA keys with quarterly trend.
 *
 * Agent surface: tool.dora_scorecard.*
 * Backing CRUD : workspace.dora_scorecard.* (auto-generated). Singleton: one
 *                DoraScorecard document (samples[]) under a fixed id.
 *
 *   1. list_state  — samples + latest snapshot + averages across the 4 keys.
 *   2. add_sample  — record a quarterly DORA sample.
 *
 * Entity kind "workspace:doraScorecard" + the fixed DS_ID match
 * dora-scorecard-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { DoraScorecard, DoraSample } from "@/lib/stores/workspace-types";

const KIND_DORA = "workspace:doraScorecard";
// MUST match DS_ID in dora-scorecard-client.tsx.
const DS_ID = "doraScorecard:current";

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyDoc(): DoraScorecard {
  return { id: DS_ID, samples: [] };
}

function browserDoc(): DoraScorecard | null {
  return (ws().doraScorecards ?? []).find((d) => d.id === DS_ID) ?? null;
}

function summarize(doc: DoraScorecard | null) {
  const samples = doc?.samples ?? [];
  const avg = (sel: (s: DoraSample) => number) =>
    samples.length ? round2(samples.reduce((a, s) => a + sel(s), 0) / samples.length) : 0;
  return {
    exists: doc !== null,
    total: samples.length,
    // The most recently recorded sample (last appended).
    latest: samples.length ? samples[samples.length - 1] : null,
    averages: {
      deployFreqPerWeek: avg((s) => s.deployFreqPerWeek),
      leadTimeHours: avg((s) => s.leadTimeHours),
      changeFailRate: avg((s) => s.changeFailRate),
      mttrHours: avg((s) => s.mttrHours),
    },
    samples,
  };
}

// ──────── tool.dora_scorecard.list_state ────────
registry.register({
  id: "tool.dora_scorecard.list_state",
  toolId: "tool.dora_scorecard",
  name: "list_state",
  category: "read",
  description:
    "Summarise the DORA scorecard. Returns {exists, total, latest (most recent sample | null), averages: {deployFreqPerWeek, leadTimeHours, changeFailRate (0..1), mttrHours}, samples}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<DoraScorecard>(ctx.userId, KIND_DORA, DS_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.dora_scorecard.add_sample ────────
registry.register({
  id: "tool.dora_scorecard.add_sample",
  toolId: "tool.dora_scorecard",
  name: "add_sample",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a quarterly DORA sample. deployFreqPerWeek = deployments/week; leadTimeHours = commit→prod; changeFailRate = 0..1; mttrHours = mean time to restore. Creates the doc if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    quarter: z.string().min(1).max(50),
    deployFreqPerWeek: z.number().min(0),
    leadTimeHours: z.number().min(0),
    changeFailRate: z.number().min(0).max(1),
    mttrHours: z.number().min(0),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const sample: DoraSample = { id: crypto.randomUUID(), ...params };
    ws().upsertDoraScorecard({ ...base, id: DS_ID, samples: [...base.samples, sample] });
    return { added: true, id: sample.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<DoraScorecard>(ctx.userId, KIND_DORA, DS_ID)) ?? emptyDoc();
    const sample: DoraSample = { id: crypto.randomUUID(), ...params };
    await serverUpsertEntity<DoraScorecard>(ctx.userId, KIND_DORA, {
      ...base,
      id: DS_ID,
      samples: [...base.samples, sample],
    });
    return { added: true, id: sample.id };
  },
});
