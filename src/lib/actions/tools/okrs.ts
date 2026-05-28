/**
 * OKR Tracker — tool-local actions.
 *
 * Category: Outcomes & Pulse (squad S6)
 * Agent surface: tool.okrs.*
 * Backing CRUD : workspace.okr.* (already synced — this is a WIRE, not a
 *                migration). create/list/update/delete exist generically;
 *                this file adds the OKR-domain verbs an agent reaches for:
 *
 *   1. list_state          — every OKR with computed progress % (mean of
 *                            key-result attainment), plus overall progress.
 *   2. update_key_result   — set one key result's `current` value (the
 *                            single most-common OKR operation) without the
 *                            agent marshalling a full keyResults patch.
 *
 * Entity kind "workspace:okr" (single word — no snake/camel transform). Both
 * browser + MCP paths agree, so agent writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type { Okr } from "@/lib/stores/workspace-types";

const KIND_OKR = "workspace:okr";

const ws = () => useWorkspaceStore.getState();

/** Attainment of one key result, 0..1 (clamped). target<=0 → 0. */
function krAttainment(target: number, current: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}

/** Mean key-result attainment for an OKR, as a 0..100 percent. */
function okrProgressPct(okr: Okr): number {
  const krs = okr.keyResults ?? [];
  if (krs.length === 0) return 0;
  const sum = krs.reduce((a, kr) => a + krAttainment(kr.target, kr.current), 0);
  return Math.round((sum / krs.length) * 100);
}

function summarize(okrs: Okr[]) {
  const items = okrs.map((o) => ({
    id: o.id,
    objective: o.objective,
    quarter: o.quarter,
    owner: o.owner,
    progressPct: okrProgressPct(o),
    keyResults: o.keyResults ?? [],
  }));
  const overallProgressPct =
    items.length === 0
      ? 0
      : Math.round(items.reduce((a, i) => a + i.progressPct, 0) / items.length);
  return { total: items.length, overallProgressPct, items };
}

// ──────── tool.okrs.list_state ────────
registry.register({
  id: "tool.okrs.list_state",
  toolId: "tool.okrs",
  name: "list_state",
  category: "read",
  description:
    "List all OKRs with computed progress. Returns {total, overallProgressPct, items: {id, objective, quarter, owner, progressPct (mean key-result attainment), keyResults}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(ws().okrs ?? []),
  mcpHandler: async (_params, ctx) => {
    const okrs = await serverListEntities<Okr>(ctx.userId, KIND_OKR);
    return summarize(okrs);
  },
});

// ──────── tool.okrs.update_key_result ────────
registry.register({
  id: "tool.okrs.update_key_result",
  toolId: "tool.okrs",
  name: "update_key_result",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the `current` value of one key result on an OKR. Returns {updated: true, progressPct} on success, or {updated: false} when the OKR or key result id is unknown.",
  paramsSchema: z.object({
    okrId: z.string(),
    keyResultId: z.string(),
    current: z.number(),
  }),
  handler: async (params) => {
    const okr = (ws().okrs ?? []).find((o) => o.id === params.okrId);
    if (!okr) return { updated: false };
    if (!okr.keyResults?.some((kr) => kr.id === params.keyResultId)) return { updated: false };
    const next: Okr = {
      ...okr,
      keyResults: okr.keyResults.map((kr) =>
        kr.id === params.keyResultId ? { ...kr, current: params.current } : kr
      ),
    };
    ws().upsertOkr(next);
    return { updated: true, progressPct: okrProgressPct(next) };
  },
  mcpHandler: async (params, ctx) => {
    const okr = await serverGetEntity<Okr>(ctx.userId, KIND_OKR, params.okrId);
    if (!okr) return { updated: false };
    if (!okr.keyResults?.some((kr) => kr.id === params.keyResultId)) return { updated: false };
    const next: Okr = {
      ...okr,
      keyResults: okr.keyResults.map((kr) =>
        kr.id === params.keyResultId ? { ...kr, current: params.current } : kr
      ),
    };
    await serverUpsertEntity<Okr>(ctx.userId, KIND_OKR, next);
    return { updated: true, progressPct: okrProgressPct(next) };
  },
});
