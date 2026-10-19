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
 *   1. list_state        — the estimate log + per-scale tally, and the queue
 *                          of stories other tools sent for estimation.
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
import type { PokerEstimationLog, PokerEstimate, PokerRound } from "@/lib/stores/workspace-types";

const KIND_PE = "workspace:pokerEstimationLog";
// MUST match PE_ID in planning-poker-client.tsx.
const PE_ID = "pokerEstimationLog:current";
const KIND_PR = "workspace:pokerRound";
const PR_ID = "pokerRound:current";

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
  // Stories other tools sent for estimation (Story Mapper's "Estimate in
  // Planning Poker"), waiting for the host to pull them into a session.
  const queue = doc?.queue ?? [];
  return { exists: doc !== null, totalEstimates: estimates.length, byScale, estimates, queue };
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
    "Summarise the committed estimate log (the live realtime session is not persisted). Returns {exists, totalEstimates, byScale: {scaleType -> count}, estimates: {id, storyTitle, finalEstimate, scaleType, votes?, decidedAt, sourceRef?}[], queue: {id, title, description?, sourceRef: {tool, id, doc?}, queuedAt, sessionStoryId?}[] (stories sent from other tools, waiting to be estimated)}.",
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

/* ======================================================================== *
 *  Server-side estimation ROUND (synced PokerRound singleton)
 *
 *  Parallel to the realtime human session: an agent can run a complete blind
 *  estimation round end-to-end and the result persists.
 *    start_round → cast_vote* → reveal → commit_round (→ appends to the log)
 *  Votes stay hidden until reveal, mirroring the human UI's blind voting.
 *  Each transition is a pure function over the current doc; the client + MCP
 *  handlers only differ in where they read/write the doc (store vs server).
 * ======================================================================== */

function emptyRound(): PokerRound {
  return {
    id: PR_ID,
    storyTitle: null,
    scaleType: "custom",
    votes: [],
    revealed: false,
    startedAt: null,
  };
}

function isActive(r: PokerRound | null): boolean {
  return !!r && r.storyTitle !== null;
}

function browserRound(): PokerRound | null {
  return (ws().pokerRounds ?? []).find((d) => d.id === PR_ID) ?? null;
}

/** get_round response — cards hidden until reveal (blind estimation). */
function roundView(r: PokerRound | null) {
  if (!isActive(r)) {
    return {
      active: false,
      storyTitle: null,
      scaleType: r?.scaleType ?? "custom",
      revealed: false,
      voteCount: 0,
      participants: [] as string[],
      votes: null,
      consensus: null,
    };
  }
  const round = r as PokerRound;
  const cards = round.votes.map((v) => v.card);
  return {
    active: true,
    storyTitle: round.storyTitle,
    scaleType: round.scaleType,
    revealed: round.revealed,
    voteCount: round.votes.length,
    participants: round.votes.map((v) => v.participant),
    votes: round.revealed
      ? round.votes.map(({ participant, card }) => ({ participant, card }))
      : null,
    consensus: round.revealed ? computeConsensus(cards) : null,
  };
}

interface RoundTx {
  next?: PokerRound;
  logAppend?: PokerEstimate;
  result: unknown;
}

function txStart(
  cur: PokerRound | null,
  p: { storyTitle: string; scaleType?: string; force?: boolean }
): RoundTx {
  if (isActive(cur) && !p.force) {
    return { result: { started: false, reason: "active_round_exists" } };
  }
  const next: PokerRound = {
    id: PR_ID,
    storyTitle: p.storyTitle,
    scaleType: p.scaleType ?? "custom",
    votes: [],
    revealed: false,
    startedAt: now(),
  };
  return { next, result: { started: true, storyTitle: p.storyTitle } };
}

function txVote(cur: PokerRound | null, p: { participant: string; card: string }): RoundTx {
  if (!isActive(cur)) return { result: { voted: false, reason: "no_active_round" } };
  const round = cur as PokerRound;
  if (round.revealed) return { result: { voted: false, reason: "revealed" } };
  const votes = [
    ...round.votes.filter((v) => v.participant !== p.participant),
    { participant: p.participant, card: p.card, at: now() },
  ];
  return {
    next: { ...round, votes },
    result: { voted: true, participant: p.participant, voteCount: votes.length },
  };
}

function txReveal(cur: PokerRound | null): RoundTx {
  if (!isActive(cur)) return { result: { revealed: false, reason: "no_active_round" } };
  const round = cur as PokerRound;
  const next: PokerRound = { ...round, revealed: true };
  return {
    next,
    result: {
      revealed: true,
      votes: next.votes.map(({ participant, card }) => ({ participant, card })),
      consensus: computeConsensus(next.votes.map((v) => v.card)),
    },
  };
}

function txCommit(cur: PokerRound | null, p: { finalEstimate?: string }): RoundTx {
  if (!isActive(cur)) return { result: { committed: false, reason: "no_active_round" } };
  const round = cur as PokerRound;
  const cards = round.votes.map((v) => v.card);
  const suggestion = round.revealed ? computeConsensus(cards).suggestion : null;
  const finalEstimate = p.finalEstimate ?? suggestion ?? null;
  if (!finalEstimate) {
    return {
      result: {
        committed: false,
        reason: round.revealed ? "no_consensus_pass_finalEstimate" : "not_revealed",
      },
    };
  }
  const estimate = newEstimate({
    storyTitle: round.storyTitle as string,
    finalEstimate,
    scaleType: round.scaleType,
    votes: cards.length ? cards : undefined,
  });
  return {
    next: emptyRound(),
    logAppend: estimate,
    result: { committed: true, estimateId: estimate.id, finalEstimate },
  };
}

function txCancel(cur: PokerRound | null): RoundTx {
  if (!isActive(cur)) return { result: { cancelled: false } };
  return { next: emptyRound(), result: { cancelled: true } };
}

function clientApply(tx: RoundTx): unknown {
  if (tx.next) ws().upsertPokerRound(tx.next);
  if (tx.logAppend) {
    const base = browserDoc() ?? emptyDoc();
    ws().upsertPokerEstimationLog({
      ...base,
      id: PE_ID,
      estimates: [...base.estimates, tx.logAppend],
    });
  }
  return tx.result;
}

async function serverApply(userId: string, tx: RoundTx): Promise<unknown> {
  if (tx.next) await serverUpsertEntity<PokerRound>(userId, KIND_PR, tx.next);
  if (tx.logAppend) {
    const base = (await serverGetEntity<PokerEstimationLog>(userId, KIND_PE, PE_ID)) ?? emptyDoc();
    await serverUpsertEntity<PokerEstimationLog>(userId, KIND_PE, {
      ...base,
      id: PE_ID,
      estimates: [...base.estimates, tx.logAppend],
    });
  }
  return tx.result;
}

const serverRound = async (userId: string): Promise<PokerRound | null> =>
  (await serverGetEntity<PokerRound>(userId, KIND_PR, PR_ID)) ?? null;

// ──────── tool.planning_poker.get_round ────────
registry.register({
  id: "tool.planning_poker.get_round",
  toolId: "tool.planning_poker",
  name: "get_round",
  category: "read",
  description:
    "Inspect the current agent-driven estimation round. Cards stay hidden until reveal. Returns {active, storyTitle, scaleType, revealed, voteCount, participants[], votes (null until revealed), consensus (null until revealed)}.",
  paramsSchema: z.object({}),
  handler: async () => roundView(browserRound()),
  mcpHandler: async (_params, ctx) => roundView(await serverRound(ctx.userId)),
});

// ──────── tool.planning_poker.start_round ────────
registry.register({
  id: "tool.planning_poker.start_round",
  toolId: "tool.planning_poker",
  name: "start_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Open a new estimation round for a story (resets votes, revealed=false). Refuses with {started:false, reason:'active_round_exists'} if a round is already open unless force=true. scaleType defaults to 'custom'. Returns {started:true, storyTitle}.",
  paramsSchema: z.object({
    storyTitle: z.string().min(1).max(500),
    scaleType: z.string().max(32).optional(),
    force: z.boolean().optional(),
  }),
  handler: async (params) => clientApply(txStart(browserRound(), params)),
  mcpHandler: async (params, ctx) =>
    serverApply(ctx.userId, txStart(await serverRound(ctx.userId), params)),
});

// ──────── tool.planning_poker.cast_vote ────────
registry.register({
  id: "tool.planning_poker.cast_vote",
  toolId: "tool.planning_poker",
  name: "cast_vote",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a participant's blind vote in the active round (re-voting the same participant replaces their card). Refuses with {voted:false, reason} when no round is active ('no_active_round') or after reveal ('revealed'). Returns {voted:true, participant, voteCount}.",
  paramsSchema: z.object({
    participant: z.string().min(1).max(120),
    card: z.string().min(1).max(32),
  }),
  handler: async (params) => clientApply(txVote(browserRound(), params)),
  mcpHandler: async (params, ctx) =>
    serverApply(ctx.userId, txVote(await serverRound(ctx.userId), params)),
});

// ──────── tool.planning_poker.reveal ────────
registry.register({
  id: "tool.planning_poker.reveal",
  toolId: "tool.planning_poker",
  name: "reveal",
  category: "write",
  requiresConfirmation: false,
  description:
    "Reveal the active round's votes and compute consensus. Refuses with {revealed:false, reason:'no_active_round'} when idle. Returns {revealed:true, votes:{participant,card}[], consensus}.",
  paramsSchema: z.object({}),
  handler: async () => clientApply(txReveal(browserRound())),
  mcpHandler: async (_params, ctx) =>
    serverApply(ctx.userId, txReveal(await serverRound(ctx.userId))),
});

// ──────── tool.planning_poker.commit_round ────────
registry.register({
  id: "tool.planning_poker.commit_round",
  toolId: "tool.planning_poker",
  name: "commit_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Commit the active round's final estimate to the estimate log and return the board to idle. finalEstimate defaults to the revealed consensus suggestion (the mode); pass it explicitly to override or to commit a non-revealed round. Refuses with {committed:false, reason} for 'no_active_round' or 'not_revealed' (when no finalEstimate is given). Returns {committed:true, estimateId, finalEstimate}.",
  paramsSchema: z.object({ finalEstimate: z.string().min(1).max(32).optional() }),
  handler: async (params) => clientApply(txCommit(browserRound(), params)),
  mcpHandler: async (params, ctx) =>
    serverApply(ctx.userId, txCommit(await serverRound(ctx.userId), params)),
});

// ──────── tool.planning_poker.cancel_round ────────
registry.register({
  id: "tool.planning_poker.cancel_round",
  toolId: "tool.planning_poker",
  name: "cancel_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Discard the active round without committing (returns the board to idle). Returns {cancelled:true}, or {cancelled:false} when no round is active.",
  paramsSchema: z.object({}),
  handler: async () => clientApply(txCancel(browserRound())),
  mcpHandler: async (_params, ctx) =>
    serverApply(ctx.userId, txCancel(await serverRound(ctx.userId))),
});
