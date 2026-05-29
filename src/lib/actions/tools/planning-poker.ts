/**
 * Planning Poker — tool-local actions.
 *
 * Category: Sprint Planning (squad S1)
 * Tool:     Realtime estimation game. The LIVE session is realtime-only (no
 *           server persistence — it lives in browser memory + Supabase
 *           broadcast), so the agent surface is:
 *             - a persisted estimation LOG of committed final estimates, and
 *             - stateless compute helpers (consensus math + scale reference).
 *
 * Agent surface: tool.planning_poker.*
 * Backing CRUD : workspace.poker_estimation_log.* (auto-generated). Singleton:
 *                one PokerEstimationLog document (estimates[]) under a fixed id.
 *
 *   1. list_state        — the estimate log + per-scale tally.
 *   2. record_estimate   — append a committed estimate.
 *   3. remove_estimate   — drop a logged estimate by id.
 *   4. compute_consensus — PURE: average/median/mode/spread + consensus band
 *                          for a set of votes (mirrors session-screen.tsx).
 *   5. list_scales       — PURE: the fibonacci / t-shirt scale reference.
 *
 * The log is agent-managed: the realtime client deliberately does NOT write to
 * it (session-screen renders for guests/promoted-hosts too, whose workspace
 * store must not be polluted). The entity is a standard synced singleton under
 * PE_ID, so its writes persist + cloud-sync like every other collection; an
 * owner-only client auto-record could be added later via a callback.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { PokerEstimationLog, PokerEstimate } from "@/lib/stores/workspace-types";

const KIND_PE = "workspace:pokerEstimationLog";
// MUST match PE_ID in planning-poker-client.tsx.
const PE_ID = "pokerEstimationLog:current";

// Mirrors types.ts SCALES/SCALE_LABELS (kept local so this server action stays
// self-contained — the tool's types.ts is a client-tree module).
const SCALES: Record<string, string[]> = {
  fibonacci: ["1", "2", "3", "5", "8", "13", "21", "?", "∞"],
  tshirt: ["XS", "S", "M", "L", "XL", "XXL", "?"],
  custom: [],
};
const SCALE_LABELS: Record<string, string> = {
  fibonacci: "Fibonacci",
  tshirt: "T-Shirt",
  custom: "Custom",
};

const ws = () => useWorkspaceStore.getState();
const now = () => new Date().toISOString();

function emptyDoc(): PokerEstimationLog {
  return { id: PE_ID, estimates: [] };
}

function browserDoc(): PokerEstimationLog | null {
  return (ws().pokerEstimationLogs ?? []).find((d) => d.id === PE_ID) ?? null;
}

function summarize(doc: PokerEstimationLog | null) {
  const estimates = doc?.estimates ?? [];
  const byScale: Record<string, number> = {};
  for (const e of estimates) byScale[e.scaleType] = (byScale[e.scaleType] ?? 0) + 1;
  return { exists: doc !== null, totalEstimates: estimates.length, byScale, estimates };
}

function newEstimate(params: {
  storyTitle: string;
  finalEstimate: string;
  scaleType?: string;
  votes?: string[];
}): PokerEstimate {
  return {
    id: crypto.randomUUID(),
    storyTitle: params.storyTitle,
    finalEstimate: params.finalEstimate,
    scaleType: params.scaleType ?? "custom",
    votes: params.votes,
    decidedAt: now(),
  };
}

/* ---- consensus math (mirrors session-screen.tsx calcStats/consensusLevel) -- */

function isNumericVote(v: string): boolean {
  if (v === "?" || v === "∞" || v.trim() === "") return false;
  if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return false;
  return !isNaN(Number(v));
}

function computeConsensus(votes: string[]) {
  const nums = votes.filter(isNumericVote).map(Number);
  const freq: Record<string, number> = {};
  for (const v of votes) freq[v] = (freq[v] ?? 0) + 1;
  let topCount = 0;
  let mode: string | null = votes.length > 0 ? votes[0] : null;
  for (const val of Object.keys(freq)) {
    const count = freq[val];
    if (count > topCount) {
      topCount = count;
      mode = val;
      continue;
    }
    if (count === topCount && isNumericVote(val) && mode !== null && isNumericVote(mode)) {
      if (Number(val) < Number(mode)) mode = val;
    }
  }

  if (nums.length === 0) {
    return {
      average: null,
      median: null,
      mode,
      spread: null,
      consensus: "agree",
      suggestion: mode,
    };
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const average = nums.reduce((a, b) => a + b, 0) / nums.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const spread = sorted[sorted.length - 1] - sorted[0];
  // consensusLevel: <2 numeric votes => agree; spread 0 => agree; <=2 => close; else spread.
  const consensus = nums.length < 2 || spread === 0 ? "agree" : spread <= 2 ? "close" : "spread";
  return { average, median, mode, spread, consensus, suggestion: mode };
}

// ──────── tool.planning_poker.list_state ────────
registry.register({
  id: "tool.planning_poker.list_state",
  toolId: "tool.planning_poker",
  name: "list_state",
  category: "read",
  description:
    "Summarise the committed estimate log (the live realtime session is not persisted). Returns {exists, totalEstimates, byScale: {scaleType -> count}, estimates: {id, storyTitle, finalEstimate, scaleType, votes?, decidedAt}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<PokerEstimationLog>(ctx.userId, KIND_PE, PE_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.planning_poker.record_estimate ────────
registry.register({
  id: "tool.planning_poker.record_estimate",
  toolId: "tool.planning_poker",
  name: "record_estimate",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append a committed final estimate for a story. scaleType defaults to 'custom'; votes are the optional raw revealed votes. Creates the log if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    storyTitle: z.string().min(1).max(500),
    finalEstimate: z.string().min(1).max(32),
    scaleType: z.string().max(32).optional(),
    votes: z.array(z.string().max(32)).max(100).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const e = newEstimate(params);
    ws().upsertPokerEstimationLog({ ...base, id: PE_ID, estimates: [...base.estimates, e] });
    return { added: true, id: e.id };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<PokerEstimationLog>(ctx.userId, KIND_PE, PE_ID)) ?? emptyDoc();
    const e = newEstimate(params);
    await serverUpsertEntity<PokerEstimationLog>(ctx.userId, KIND_PE, {
      ...base,
      id: PE_ID,
      estimates: [...base.estimates, e],
    });
    return { added: true, id: e.id };
  },
});

// ──────── tool.planning_poker.remove_estimate ────────
registry.register({
  id: "tool.planning_poker.remove_estimate",
  toolId: "tool.planning_poker",
  name: "remove_estimate",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a logged estimate by id. Returns {removed: false} for an unknown id, else {removed: true}.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params) => {
    const doc = browserDoc();
    if (!doc || !doc.estimates.some((e) => e.id === params.id)) return { removed: false };
    ws().upsertPokerEstimationLog({
      ...doc,
      id: PE_ID,
      estimates: doc.estimates.filter((e) => e.id !== params.id),
    });
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const doc = await serverGetEntity<PokerEstimationLog>(ctx.userId, KIND_PE, PE_ID);
    if (!doc || !doc.estimates.some((e) => e.id === params.id)) return { removed: false };
    await serverUpsertEntity<PokerEstimationLog>(ctx.userId, KIND_PE, {
      ...doc,
      id: PE_ID,
      estimates: doc.estimates.filter((e) => e.id !== params.id),
    });
    return { removed: true };
  },
});

// ──────── tool.planning_poker.compute_consensus (pure) ────────
registry.register({
  id: "tool.planning_poker.compute_consensus",
  toolId: "tool.planning_poker",
  name: "compute_consensus",
  category: "read",
  description:
    "Compute estimation consensus for a set of votes (non-numeric cards like '?'/'∞' are ignored for the numeric stats). Returns {average, median, mode, spread, consensus ('agree'|'close'|'spread'), suggestion (the mode)}. Pure — no session state.",
  paramsSchema: z.object({ votes: z.array(z.string().max(32)).max(100) }),
  handler: async (params) => computeConsensus(params.votes),
});

// ──────── tool.planning_poker.list_scales (pure) ────────
registry.register({
  id: "tool.planning_poker.list_scales",
  toolId: "tool.planning_poker",
  name: "list_scales",
  category: "read",
  description:
    "List the built-in estimation scales. Returns {scales: {fibonacci, tshirt, custom}, labels}. Pure reference data.",
  paramsSchema: z.object({}),
  handler: async () => ({ scales: SCALES, labels: SCALE_LABELS }),
});
