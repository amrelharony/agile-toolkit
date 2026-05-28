/**
 * Code Review Metrics — tool-local actions.
 *
 * Category: Quality Engineering (squad S10)
 * Tool:     PR cycle time, review depth, and ping-pong rate from manual /
 *           pasted samples.
 *
 * Agent surface: tool.code_review_metrics.*
 * Backing CRUD : workspace.code_review_log.* (auto-generated). Singleton: one
 *                CodeReviewLog document (samples[]) under a fixed id.
 *
 *   1. list_state  — counts + average cycle time (open→merge), reviewers,
 *                    comments, and lines changed.
 *   2. add_sample  — record a PR sample.
 *
 * Entity kind "workspace:codeReviewLog" + the fixed CR_ID match
 * code-review-metrics-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { CodeReviewLog, PrSample } from "@/lib/stores/workspace-types";

const KIND_CR = "workspace:codeReviewLog";
// MUST match CR_ID in code-review-metrics-client.tsx.
const CR_ID = "codeReviewLog:current";

const HOUR_MS = 3_600_000;

const ws = () => useWorkspaceStore.getState();

const round1 = (n: number) => Math.round(n * 10) / 10;

function emptyDoc(): CodeReviewLog {
  return { id: CR_ID, samples: [] };
}

function browserDoc(): CodeReviewLog | null {
  return (ws().codeReviewLogs ?? []).find((d) => d.id === CR_ID) ?? null;
}

/** Mean of `values`, or null when empty (avoids a misleading 0). */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

function summarize(doc: CodeReviewLog | null) {
  const samples = doc?.samples ?? [];
  // Cycle time only for merged PRs with both timestamps parseable.
  const cycleHours: number[] = [];
  let mergedCount = 0;
  for (const s of samples) {
    if (!s.mergedAt) continue;
    const opened = Date.parse(s.openedAt);
    const merged = Date.parse(s.mergedAt);
    if (Number.isNaN(opened) || Number.isNaN(merged) || merged < opened) continue;
    mergedCount += 1;
    cycleHours.push((merged - opened) / HOUR_MS);
  }
  return {
    exists: doc !== null,
    total: samples.length,
    mergedCount,
    avgCycleTimeHours: mean(cycleHours),
    avgReviewers: mean(samples.map((s) => s.reviewerCount)),
    avgComments: mean(samples.map((s) => s.commentCount)),
    avgLinesChanged: mean(samples.map((s) => s.linesChanged)),
    samples,
  };
}

// ──────── tool.code_review_metrics.list_state ────────
registry.register({
  id: "tool.code_review_metrics.list_state",
  toolId: "tool.code_review_metrics",
  name: "list_state",
  category: "read",
  description:
    "Summarise code-review metrics. Returns {exists, total, mergedCount, avgCycleTimeHours (open→merge over merged PRs, or null), avgReviewers, avgComments, avgLinesChanged (each null when no samples), samples}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<CodeReviewLog>(ctx.userId, KIND_CR, CR_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.code_review_metrics.add_sample ────────
registry.register({
  id: "tool.code_review_metrics.add_sample",
  toolId: "tool.code_review_metrics",
  name: "add_sample",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a PR sample. openedAt is an ISO date/datetime; mergedAt (optional) enables cycle-time. commentCount is the review ping-pong signal. Creates the log if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    author: z.string().min(1).max(200),
    openedAt: z.string(),
    reviewerCount: z.number().int().min(0),
    commentCount: z.number().int().min(0),
    linesChanged: z.number().int().min(0),
    prNumber: z.string().max(50).optional(),
    mergedAt: z.string().optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const sample: PrSample = { id: crypto.randomUUID(), ...params };
    ws().upsertCodeReviewLog({ ...base, id: CR_ID, samples: [...base.samples, sample] });
    return { added: true, id: sample.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<CodeReviewLog>(ctx.userId, KIND_CR, CR_ID)) ?? emptyDoc();
    const sample: PrSample = { id: crypto.randomUUID(), ...params };
    await serverUpsertEntity<CodeReviewLog>(ctx.userId, KIND_CR, {
      ...base,
      id: CR_ID,
      samples: [...base.samples, sample],
    });
    return { added: true, id: sample.id };
  },
});
