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
 *   4. compute_consensus — PURE: how close a round is, counted in card
 *                          positions on the deck (lib/estimation/consensus,
 *                          the same verdict the session screen shows), plus
 *                          the numeric average/median/mode/spread.
 *   5. list_scales       — PURE: the decks (lib/estimation/decks).
 *   6. three_point       — PURE: a best, likely and worst case weighed into an
 *                          expected size, its spread and the card it rounds
 *                          up to (lib/estimation/three-point), as the host's
 *                          Three-point check shows after Reveal.
 *   7. similar_stories   — READ: finished stories like a story being sized,
 *                          with their points, and the Estimation Guide's
 *                          reference stories (lib/estimation/similar). Words
 *                          only: an action runs no AI task.
 *   8. list_async        — READ: rounds without a meeting, counts only, and
 *                          each story's verdict and agreed card after Reveal.
 *   9. create_async_round — a round of typed titles; returns the link path
 *                          for the person to send (lib/estimation/async-pack).
 *  10. reveal_async_round — reveal a round: the same counts and verdicts.
 *
 *  Replies hold other people's names, cards and notes, and Amr is a model:
 *  no verb returns a name, a note or anyone's card, and none adds a reply
 *  (a pasted code would carry other people's data into the model).
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
import {
  serverGetEntity,
  serverGetUserStateBlob,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import {
  ENTITY_ROW_MAX_BYTES,
  POKER_ASYNC_MAX,
  POKER_ASYNC_ROUND_KIND,
  type PokerAsyncRound,
  type PokerEstimationLog,
  type PokerEstimate,
  type PokerRound,
  type Story,
} from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { todayIso } from "@/lib/sprints/series";
import {
  asyncDeckFor,
  asyncRoundProblem,
  asyncRoundSummary,
  encodePack,
  estimateLink,
  newAsyncRound,
  newAsyncRoundId,
  packFor,
  readAsyncRound,
  revealAndFlag,
} from "@/lib/estimation/async-pack";
import { SCALES, SCALE_LABELS, type ScaleType } from "@/lib/estimation/decks";
import {
  consensusLabel,
  consensusOf,
  consensusVerdict,
  estimateCards,
  isEstimateCard,
} from "@/lib/estimation/consensus";
import {
  THREE_POINT_MAX,
  cardAtOrAbove,
  isAboveDeck,
  threePoint,
  threePointNote,
  validateThreePoint,
} from "@/lib/estimation/three-point";
import { SIMILAR_LIMIT, medianPoints, similarStories } from "@/lib/estimation/similar";
import { scales } from "@/lib/constants/scales";
import { pinnedIds, resolveReferenceStories } from "@/app/(tools)/estimation-guide/references";
import { useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";

const KIND_PE = "workspace:pokerEstimationLog";
// MUST match PE_ID in planning-poker-client.tsx.
const PE_ID = "pokerEstimationLog:current";
const KIND_PR = "workspace:pokerRound";
const PR_ID = "pokerRound:current";

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

/* ---- consensus -------------------------------------------------------- */

/**
 * The deck a round was played on: an explicit deck, else a named scale,
 * else the built-in deck that holds every estimate played (Fibonacci, then
 * T-shirt), else the votes' own distinct estimate cards in numeric order.
 */
export function deckFor(votes: readonly string[], scale?: ScaleType, deck?: readonly string[]) {
  if (deck && deck.length > 0) return [...deck];
  if (scale && SCALES[scale].length > 0) return SCALES[scale];
  const played = votes.map((v) => v.trim()).filter(isEstimateCard);
  for (const known of [SCALES.fibonacci, SCALES.tshirt]) {
    if (played.every((v) => known.includes(v))) return known;
  }
  const own = estimateCards(played);
  return own.every(isNumericVote) ? own.sort((a, b) => Number(a) - Number(b)) : own;
}

function isNumericVote(v: string): boolean {
  if (v === "?" || v === "∞" || v.trim() === "") return false;
  if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return false;
  return !isNaN(Number(v));
}

function computeConsensus(votes: string[], scale?: ScaleType, deck?: string[]) {
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

  const c = consensusOf(votes, deckFor(votes, scale, deck));
  const positions = {
    // Agreement by card position, as the session screen shows it: the same
    // card is agree, neighbouring cards are close, further apart is spread.
    consensus: c.level ?? "agree",
    level: c.level,
    label: consensusLabel(c)?.label ?? null,
    verdict: consensusVerdict(c),
    low: c.low,
    high: c.high,
    cardsApart: c.estimates > 0 ? c.apart : null,
    abstained: c.abstained,
    suggestion: c.suggested ?? mode,
  };
  if (nums.length === 0) {
    return { average: null, median: null, mode, spread: null, ...positions };
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const average = nums.reduce((a, b) => a + b, 0) / nums.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const spread = sorted[sorted.length - 1] - sorted[0];
  return { average, median, mode, spread, ...positions };
}

// ──────── tool.planning_poker.list_state ────────
registry.register({
  id: "tool.planning_poker.list_state",
  toolId: "tool.planning_poker",
  name: "list_state",
  category: "read",
  description:
    "Summarise the committed estimate log (the live realtime session is not persisted). Returns {exists, totalEstimates, byScale: {scaleType -> count}, estimates: {id, storyTitle, finalEstimate, scaleType, votes?, decidedAt, sourceRef?, sessionStoryId?}[], queue: {id, title, description?, sourceRef: {tool, id, doc?}, queuedAt, sessionStoryId?}[] (stories sent from other tools, waiting to be estimated)}.",
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
    "Compute estimation consensus for a set of votes, counted in card positions on the deck as the session screen does: the same card is 'agree', neighbouring cards 'close', further apart 'spread' (works for T-shirt decks too). Give the deck as scale (fibonacci | tshirt) or deck (the cards in order); otherwise it is inferred from the votes. '?', '∞' and coffee cards count as abstained. Returns {consensus, level (null when nobody estimated), label, verdict (one sentence), low, high, cardsApart, abstained, suggestion (the middle card), average, median, mode, spread (numeric votes only)}. Pure — no session state.",
  paramsSchema: z.object({
    votes: z.array(z.string().max(32)).max(100),
    scale: z.enum(["fibonacci", "tshirt", "custom"]).optional(),
    deck: z.array(z.string().max(32)).max(100).optional().describe("The cards in deck order."),
  }),
  handler: async (params) => computeConsensus(params.votes, params.scale, params.deck),
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

/* ---- three-point check and similar stories ---------------------------- */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Most matches `similar_stories` returns. */
const SIMILAR_STORIES_MAX = 5;
/** MUST match registerCollection("story", …) in workspace-store.ts. */
const KIND_STORY = "workspace:story";
/** The Estimation Guide's store key (createPersistedStore("estimation-guide")). */
const GUIDE_STORE_KEY = "agile-toolkit:estimation-guide";

function threePointCheck(p: {
  optimistic: number;
  likely: number;
  pessimistic: number;
  scale?: ScaleType;
  deck?: string[];
}) {
  const r = threePoint(p);
  if (!r) {
    const checked = validateThreePoint({
      optimistic: String(p.optimistic),
      likely: String(p.likely),
      pessimistic: String(p.pessimistic),
    });
    const problem =
      (checked.ok ? undefined : Object.values(checked.errors).find(Boolean)) ??
      "Give a best, likely and worst case with best <= likely <= worst.";
    return { computed: false as const, problem };
  }
  const deck = deckFor([], p.scale, p.deck);
  return {
    computed: true as const,
    expected: round2(r.expected),
    sd: round2(r.sd),
    low: round2(r.low),
    high: round2(r.high),
    // Null on a deck that isn't points (T-shirt sizes).
    card: cardAtOrAbove(deck, r.expected),
    // Past the largest card: `card` is only the top one, and the story
    // wants splitting.
    aboveDeck: isAboveDeck(deck, r.expected),
    note: threePointNote(r),
  };
}

/**
 * The guide's pinned reference stories on its chosen scale (a numeric one;
 * a T-shirt pick reads Fibonacci's pins), the team's stories only: the
 * guide's example pins aren't the team's work.
 */
function guideReferences(guide: unknown, stories: readonly Story[]) {
  const g = (guide && typeof guide === "object" ? guide : {}) as Record<string, unknown>;
  const numeric = (name: string) =>
    scales.some((s) => s.name === name && s.values.every((v) => typeof v === "number"));
  const chosen = typeof g.selectedScale === "string" ? g.selectedScale : "";
  const scale = numeric(chosen) ? chosen : "Fibonacci";
  const values = scales.find((s) => s.name === scale)?.values ?? [];
  const items: { card: string; id: string; title: string; points: number | null }[] = [];
  for (const value of values) {
    const ids = pinnedIds(g.referenceStoryIds, scale, value);
    for (const story of resolveReferenceStories(ids, stories)) {
      if (story.example) continue;
      items.push({
        card: String(value),
        id: story.id,
        title: story.title,
        points: story.points ?? null,
      });
    }
  }
  return { scale, stories: items };
}

function similarResult(
  params: { title: string; notes?: string; limit?: number },
  stories: readonly Story[],
  guide: unknown
) {
  const matches = similarStories({ title: params.title, notes: params.notes }, stories, {
    limit: params.limit ?? SIMILAR_LIMIT,
  });
  return {
    matches: matches.map((m) => ({
      id: m.story.id,
      title: m.story.title,
      points: m.story.points ?? null,
      shared: m.shared,
      score: round2(m.score),
      doneAt: m.story.doneAt ?? null,
    })),
    medianPoints: medianPoints(matches.map((m) => m.story.points ?? 0)),
    references: guideReferences(guide, stories),
  };
}

/** The guide as this browser holds it (its store waits to be asked, as Poker's panel does). */
async function browserGuide(): Promise<unknown> {
  const persist = useEstimationGuideStore.persist;
  if (!persist.hasHydrated()) await persist.rehydrate();
  return useEstimationGuideStore.getState();
}

// ──────── tool.planning_poker.three_point (pure) ────────
registry.register({
  id: "tool.planning_poker.three_point",
  toolId: "tool.planning_poker",
  name: "three_point",
  category: "read",
  description:
    "Three-point check for one story, as the host's check after Reveal and the Estimation Guide show it: a best (optimistic), likely and worst (pessimistic) case in points, 0 to 1000, with best <= likely <= worst. Returns {computed: true, expected: (O + 4M + P) / 6, sd: (P - O) / 6, low and high (expected -/+ sd), card (the smallest card on the deck at or above expected, else the top card; null on a T-shirt deck), aboveDeck (true when expected is past the deck's largest card: card is then only the top card, so say the story is bigger than any card and should be split), note (narrow, some uncertainty or wide)}, or {computed: false, problem}. Give the deck as scale (fibonacci | tshirt) or deck (the cards in order); Fibonacci otherwise. Pure: it changes no estimate, the team still picks the card.",
  paramsSchema: z.object({
    optimistic: z.number().min(0).max(THREE_POINT_MAX),
    likely: z.number().min(0).max(THREE_POINT_MAX),
    pessimistic: z.number().min(0).max(THREE_POINT_MAX),
    scale: z.enum(["fibonacci", "tshirt", "custom"]).optional(),
    deck: z.array(z.string().max(32)).max(32).optional().describe("The cards in deck order."),
  }),
  handler: async (params) => threePointCheck(params),
});

// ──────── tool.planning_poker.similar_stories ────────
registry.register({
  id: "tool.planning_poker.similar_stories",
  toolId: "tool.planning_poker",
  name: "similar_stories",
  category: "read",
  description:
    "Finished stories that read like a story being sized, with the points they took, so the team can compare (Planning Poker shows the same list to the host after Reveal, Refinement beside an unsized story). Matching is by shared title words (notes count less); done stories with points only, never the example's. Returns {matches: {id, title, points, shared (words both mention), score 0-1, doneAt}[] best first, medianPoints (null with no match), references: {scale, stories: {card, id, title, points}[]} (the Estimation Guide's pinned reference stories, to fall back on when nothing matches)}. Read only.",
  paramsSchema: z.object({
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(1000).optional(),
    limit: z.number().int().min(1).max(SIMILAR_STORIES_MAX).optional(),
  }),
  handler: async (params) => similarResult(params, ws().stories ?? [], await browserGuide()),
  mcpHandler: async (params, ctx) => {
    const [stories, guide] = await Promise.all([
      serverListEntities<Story>(ctx.userId, KIND_STORY),
      serverGetUserStateBlob(ctx.userId, GUIDE_STORE_KEY),
    ]);
    return similarResult(params, stories, guide);
  },
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

/* ======================================================================== *
 *  Estimate without a meeting (workspace PokerAsyncRound, no CRUD)
 *
 *  People estimate from a link and send a reply code back to the host, who
 *  pastes it on the Poker page. Amr can list rounds, make one from typed
 *  titles and reveal one, and sees counts and verdicts only: never a name,
 *  a note or anyone's card. There is no verb to add a reply.
 * ======================================================================== */

const asyncRoundsIn = (rounds: readonly PokerAsyncRound[] | undefined) =>
  (rounds ?? [])
    .map((r) => readAsyncRound(r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

function asyncList(rounds: readonly PokerAsyncRound[] | undefined) {
  const all = asyncRoundsIn(rounds);
  return { total: all.length, rounds: all.map(asyncRoundSummary) };
}

const CreateAsyncParams = z.object({
  title: z.string().trim().min(1).max(POKER_ASYNC_MAX.title),
  scale: z.enum(["fibonacci", "tshirt", "custom"]).default("fibonacci"),
  deck: z
    .array(z.string().trim().min(1).max(32))
    .min(2)
    .max(POKER_ASYNC_MAX.deck)
    .optional()
    .describe("The cards in order, lowest first; only for scale 'custom'."),
  stories: z
    .array(z.string().trim().min(1).max(POKER_ASYNC_MAX.storyTitle))
    .min(1)
    .max(POKER_ASYNC_MAX.stories),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("The day replies are due, YYYY-MM-DD, from today to 90 days ahead."),
  expected: z
    .array(z.string().trim().min(1).max(POKER_ASYNC_MAX.name))
    .max(POKER_ASYNC_MAX.expected)
    .optional(),
  host: z
    .string()
    .trim()
    .min(1)
    .max(POKER_ASYNC_MAX.name)
    .optional()
    .describe("The facilitator's name the estimators see."),
});

type CreateAsync =
  | { created: false; problem: string }
  | { created: true; id: string; path: string; chars: number; round: PokerAsyncRound };

/** A new round from the params, or why not; the write is the caller's. */
function planAsyncRound(p: z.infer<typeof CreateAsyncParams>): CreateAsync {
  const input = {
    title: p.title,
    scaleType: p.scale,
    deck: p.scale === "custom" ? (p.deck ?? []) : asyncDeckFor(p.scale),
    stories: p.stories.map((title) => ({ id: crypto.randomUUID(), title })),
    expected: p.expected,
    dueDate: p.dueDate,
  };
  const problem = asyncRoundProblem(input, todayIso());
  if (problem) return { created: false, problem };
  const round = newAsyncRound(input, newAsyncRoundId(), now());
  const packed = encodePack(packFor(round, { host: p.host }));
  if (!packed.ok) return { created: false, problem: packed.problem };
  if (jsonBytes(round) > ENTITY_ROW_MAX_BYTES) {
    return { created: false, problem: "This round is too big to save." };
  }
  return {
    created: true,
    id: round.id,
    path: estimateLink(packed.code),
    chars: packed.chars,
    round,
  };
}

const createdView = (c: CreateAsync) =>
  c.created ? { created: true, id: c.id, path: c.path, chars: c.chars } : c;

type RevealAsync =
  | { revealed: false; reason: "not_found" | "not_open" | "no_replies" }
  | { revealed: true; round: PokerAsyncRound };

function planAsyncReveal(stored: PokerAsyncRound | null | undefined): RevealAsync {
  if (!stored) return { revealed: false, reason: "not_found" };
  const round = readAsyncRound(stored);
  if (round.status !== "open") return { revealed: false, reason: "not_open" };
  if (round.replies.length === 0) return { revealed: false, reason: "no_replies" };
  return { revealed: true, round: revealAndFlag(round, now()) };
}

const revealedView = (r: RevealAsync) =>
  r.revealed ? { revealed: true, ...asyncRoundSummary(r.round) } : r;

// ──────── tool.planning_poker.list_async ────────
registry.register({
  id: "tool.planning_poker.list_async",
  toolId: "tool.planning_poker",
  name: "list_async",
  category: "read",
  description:
    "List Planning Poker's rounds without a meeting (people estimate from a link and send the host a reply code), newest first. Returns {total, rounds: {id, title, status ('open' | 'revealed' | 'closed'), scaleType, dueDate, replyCount, expectedCount, storyCount, stories (null until revealed, then per story {title, label, verdict, suggested, agreed, voteCount})}[]}. Never a name, a note or anyone's card: those stay on the host's page. A round is closed, with its names and notes dropped, 14 days after its due day.",
  paramsSchema: z.object({}),
  handler: async () => asyncList(ws().pokerAsyncRounds),
  mcpHandler: async (_params, ctx) =>
    asyncList(await serverListEntities<PokerAsyncRound>(ctx.userId, POKER_ASYNC_ROUND_KIND)),
});

// ──────── tool.planning_poker.create_async_round ────────
registry.register({
  id: "tool.planning_poker.create_async_round",
  toolId: "tool.planning_poker",
  name: "create_async_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Make a round without a meeting from typed story titles (1 to 20, up to 120 characters each; stories queued from other tools are picked on the page). scale is fibonacci (default), tshirt, or custom with deck (2 to 16 cards, lowest first). Optional dueDate (YYYY-MM-DD, from today to 90 days ahead), expected (the names of who should reply, up to 20) and host (the facilitator's name shown to estimators). Returns {created: true, id, path, chars}: path is the estimator's link, /planning-poker/estimate#estimate=…, for the person to send themselves; or {created: false, problem} (for example a round too long for one link: split it). Replies come back to the Poker page as codes the host pastes in.",
  paramsSchema: CreateAsyncParams,
  handler: async (params) => {
    const plan = planAsyncRound(params);
    if (plan.created) ws().upsertPokerAsyncRound(plan.round);
    return createdView(plan);
  },
  mcpHandler: async (params, ctx) => {
    const plan = planAsyncRound(params);
    if (plan.created) {
      await serverUpsertEntity<PokerAsyncRound>(ctx.userId, POKER_ASYNC_ROUND_KIND, plan.round);
    }
    return createdView(plan);
  },
});

// ──────── tool.planning_poker.reveal_async_round ────────
registry.register({
  id: "tool.planning_poker.reveal_async_round",
  toolId: "tool.planning_poker",
  name: "reveal_async_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Reveal an open round without a meeting that has at least one reply, so the host's page shows everyone's cards and the stories far apart are ticked to talk about live. Returns {revealed: true, id, title, status, scaleType, dueDate, replyCount, expectedCount, storyCount, stories: {title, label, verdict, suggested, agreed, voteCount}[]}, or {revealed: false, reason: 'not_found' | 'not_open' | 'no_replies'}. Counts and verdicts only: never a name, a note or anyone's card. The host agrees each estimate on the page.",
  paramsSchema: z.object({ id: z.string().min(1).max(64) }),
  handler: async (params) => {
    const found = (ws().pokerAsyncRounds ?? []).find((r) => r.id === params.id);
    const plan = planAsyncReveal(found);
    if (plan.revealed) ws().upsertPokerAsyncRound(plan.round);
    return revealedView(plan);
  },
  mcpHandler: async (params, ctx) => {
    const found = await serverGetEntity<PokerAsyncRound>(
      ctx.userId,
      POKER_ASYNC_ROUND_KIND,
      params.id
    );
    const plan = planAsyncReveal(found);
    if (plan.revealed) {
      await serverUpsertEntity<PokerAsyncRound>(ctx.userId, POKER_ASYNC_ROUND_KIND, plan.round);
    }
    return revealedView(plan);
  },
});
