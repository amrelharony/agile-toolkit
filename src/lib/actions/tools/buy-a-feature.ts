/**
 * Buy-a-Feature — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     an innovation game: players get a budget of play money for
 *           priced features, and the pool (budget × players) is below the
 *           sum of the prices, so they have to choose.
 *
 * Agent surface: tool.buy_a_feature.*
 * Backing CRUD : workspace.prioritization.* (rows with framework
 *                "buy-feature": fields.price, fields.raised),
 *                workspace.buy_a_feature_game.* (the singleton game doc,
 *                BUY_A_FEATURE_ID) and workspace.allocation_round.* (saved
 *                rounds, totals only).
 *
 *   1. list_state       — features with price, raised, what's left and
 *                         whether funded; the pool; the budget check; the
 *                         next round; saved rounds; the verdict.
 *   2. add_feature      — a priced feature.
 *   3. set_game         — players, budget per player, unit.
 *   4. record_purchase  — a purchase at the table, capped like the page.
 *   5. refund           — one feature's money back to the pool.
 *   6. refund_unfunded  — every short feature's money back (end of game).
 *   7. record_round     — a round's totals typed in (paper splits counted
 *                         by hand): capped per feature, saved as a round.
 *
 * Every number comes from lib/buy-a-feature/game, the code the page uses:
 * purchases are capped at what a feature still needs and refused above
 * what's left in the pool, a legacy row over its price counts only its
 * price, and a price of 0 or a fraction reads as "Not priced". Rounds keep
 * per-feature totals only, never anyone's split.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverBulkUpsertEntities,
  serverGetEntity,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import {
  ALLOCATION_ROUND_KIND,
  BUY_A_FEATURE_ID,
  BUY_A_FEATURE_KIND,
  type AllocationRound,
  type BuyAFeatureGame,
  type PrioritizationItem,
  type Story,
} from "@/lib/stores/workspace-types";
import {
  emptyAllocationTally,
  foldAllocationTotals,
  revealAllocation,
  toAllocationResult,
} from "@/lib/realtime/vote-room/allocation";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import {
  allocationRoundFrom,
  roundDayProblem,
  spreadKnownOf,
  teamAverages,
} from "@/lib/hundred-dollar/allocation";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  FEATURE_TITLE_MAX,
  PLAYERS_MAX,
  PLAYERS_MIN,
  PRICE_MAX,
  UNIT_MAX,
  applyAllocationRound,
  budgetProblem,
  budgetText,
  buyAFeatureVerdict,
  featureLedger,
  featureRows,
  gameCheck,
  gameRounds,
  isFunded,
  newFeatureRow,
  nextRound,
  pool,
  purchaseProblem,
  recordPurchase,
  refundUnfunded,
  remaining,
  roundOutcomeText,
  roundPoolProblem,
  unitOf,
  withRaised,
  type FeatureLedger,
} from "@/lib/buy-a-feature/game";

const KIND_PRIORITIZATION = "workspace:prioritization";
const KIND_STORY = "workspace:story";

const ws = () => useWorkspaceStore.getState();

/** Where the game lives: the browser's workspace, or the user's rows on the server. */
interface GameStore {
  rows(): Promise<PrioritizationItem[]>;
  game(): Promise<BuyAFeatureGame | null>;
  rounds(): Promise<AllocationRound[]>;
  storyIds(): Promise<Set<string>>;
  putRows(rows: PrioritizationItem[]): Promise<void>;
  putGame(game: BuyAFeatureGame): Promise<void>;
  putRound(round: AllocationRound): Promise<void>;
}

const browserStore: GameStore = {
  rows: async () => featureRows(ws().prioritizations),
  game: async () => (ws().buyAFeatureGames ?? []).find((g) => g.id === BUY_A_FEATURE_ID) ?? null,
  rounds: async () => ws().allocationRounds ?? [],
  storyIds: async () => new Set((ws().stories ?? []).map((s) => s.id)),
  putRows: async (rows) => rows.forEach((r) => ws().upsertPrioritization(r)),
  putGame: async (game) => ws().upsertBuyAFeatureGame(game),
  putRound: async (round) => ws().upsertAllocationRound(round),
};

function serverStore(userId: string): GameStore {
  return {
    rows: async () =>
      featureRows(await serverListEntities<PrioritizationItem>(userId, KIND_PRIORITIZATION)),
    game: async () =>
      (await serverGetEntity<BuyAFeatureGame>(userId, BUY_A_FEATURE_KIND, BUY_A_FEATURE_ID)) ??
      null,
    rounds: () => serverListEntities<AllocationRound>(userId, ALLOCATION_ROUND_KIND),
    storyIds: async () =>
      new Set((await serverListEntities<Story>(userId, KIND_STORY)).map((s) => s.id)),
    putRows: async (rows) => {
      if (rows.length === 1) await serverUpsertEntity(userId, KIND_PRIORITIZATION, rows[0]);
      else if (rows.length > 1) await serverBulkUpsertEntities(userId, KIND_PRIORITIZATION, rows);
    },
    putGame: (game) => serverUpsertEntity(userId, BUY_A_FEATURE_KIND, game),
    putRound: (round) => serverUpsertEntity(userId, ALLOCATION_ROUND_KIND, round),
  };
}

/* ── list_state ─────────────────────────────────────────────────────── */

/** The story a funded feature was sent to, while it still exists. */
function storyOf(row: PrioritizationItem, stories: Set<string>): string | null {
  const link = (row.sentTo ?? []).find((l) => l.route === "backlog-story");
  return link && stories.has(link.targetId) ? link.targetId : null;
}

async function summarize(store: GameStore) {
  const [rows, game, allRounds, stories] = await Promise.all([
    store.rows(),
    store.game(),
    store.rounds(),
    store.storyIds(),
  ]);
  const features = rows.map(featureLedger);
  const unit = unitOf(game);
  const p = pool(game, features);
  const check = gameCheck(game, features);
  const rounds = gameRounds(allRounds);
  const next = nextRound(features, game, rounds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const featureOut = features.map((f) => {
    const storyId = storyOf(byId.get(f.id) as PrioritizationItem, stories);
    return {
      id: f.id,
      title: f.title,
      price: f.price,
      raised: f.raised,
      remaining: f.price === null ? null : remaining(f),
      funded: isFunded(f),
      pctFunded: f.price === null ? null : Math.round(Math.min(1, f.raised / f.price) * 100),
      inBacklog: storyId !== null,
      storyId,
    };
  });
  return {
    unit,
    game: {
      players: game?.players ?? null,
      budgetPerPlayer: game?.budgetPerPlayer ?? null,
      unit: game?.unit ?? null,
    },
    pool: p,
    budgetCheck:
      check && p
        ? {
            ok: check.ok,
            pool: check.pool,
            sumOfPrices: check.sumOfPrices,
            sharePct: check.share === null ? null : Math.round(check.share * 100),
            suggestedBudget: check.suggestedBudget,
            budgetBelow: check.budgetBelow,
            text: budgetText(check, p, unit),
            problem: budgetProblem(check, unit),
          }
        : null,
    nextRound: {
      number: next.number,
      budgetPerPlayer: next.budget,
      features: next.sheet?.items.map((x) => ({ id: x.id, cap: x.cap ?? null })) ?? [],
      blocked: next.blocked,
    },
    features: featureOut,
    counts: {
      features: features.length,
      priced: features.filter((f) => f.price !== null).length,
      funded: features.filter(isFunded).length,
      fundedNotInBacklog: featureOut.filter((f) => f.funded && !f.inBacklog).length,
    },
    rounds: rounds.map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      ballots: r.ballots,
      budget: r.budget,
      source: r.source,
      spreadKnown: spreadKnownOf(r),
      items: teamAverages(r).map((t) => ({
        featureId: t.itemId,
        text: t.text,
        cap: r.items.find((x) => x.itemId === t.itemId)?.cap ?? null,
        total: t.total,
        average: t.mean,
        backers: t.backers,
        middleHalf: t.middleHalf,
      })),
    })),
    verdict: buyAFeatureVerdict(features, game),
  };
}

registry.register({
  id: "tool.buy_a_feature.list_state",
  toolId: "tool.buy_a_feature",
  name: "list_state",
  category: "read",
  description:
    "Summarise the Buy-a-Feature game as the page shows it. Returns {unit ('$' unless set), game: {players|null, budgetPerPlayer|null, unit|null} (null = not set: never assume one), pool: {players, budgetPerPlayer, pool (players × budget), spent (raised across features, each capped at its price), left, overspent} | null (null until players and budget are set), budgetCheck: {ok (pool < sum of prices: nobody can buy everything), pool, sumOfPrices, sharePct, suggestedBudget|null (about half the prices per player), budgetBelow|null (each player's budget must stay below it), text, problem|null} | null, nextRound: {number, budgetPerPlayer|null (round 1: the budget; later: the pool's leftover split evenly), features: {id, cap}[] (features still to fund; cap = what each still needs, rounded up to a whole amount), blocked: string|null (why a round can't run)}, features: {id, title, price|null (null = Not priced: a legacy 0 or fraction), raised, remaining|null, funded, pctFunded|null, inBacklog, storyId|null}[], counts: {features, priced, funded, fundedNotInBacklog}, rounds: {id, title, date, ballots, budget, source: room|facilitator, spreadKnown, items: {featureId, text, cap|null, total (before capping), average, backers|null, middleHalf|null}[]}[] newest first, verdict}. Rounds hold totals only, never anyone's split.",
  paramsSchema: z.object({}),
  handler: () => summarize(browserStore),
  mcpHandler: (_params, ctx) => summarize(serverStore(ctx.userId)),
});

/* ── add_feature ────────────────────────────────────────────────────── */

const addFeatureParams = z.object({
  title: z.string().trim().min(1).max(FEATURE_TITLE_MAX),
  price: z
    .number()
    .int()
    .min(1)
    .max(PRICE_MAX)
    .describe("Whole number, e.g. the feature's cost in team-days."),
});

async function addFeature(store: GameStore, params: z.infer<typeof addFeatureParams>) {
  const row = newFeatureRow(
    `prio_${nanoid(8)}`,
    params.title,
    params.price,
    new Date().toISOString()
  );
  await store.putRows([row]);
  return { added: true, id: row.id, title: row.title, price: params.price };
}

registry.register({
  id: "tool.buy_a_feature.add_feature",
  toolId: "tool.buy_a_feature",
  name: "add_feature",
  category: "write",
  requiresConfirmation: false,
  description: `Add a priced feature to the game (nothing raised yet). Params: {title (≤${FEATURE_TITLE_MAX}), price (whole, 1..${PRICE_MAX.toLocaleString("en-US")})}. Returns {added: true, id, title, price}.`,
  paramsSchema: addFeatureParams,
  handler: (params) => addFeature(browserStore, params),
  mcpHandler: (params, ctx) => addFeature(serverStore(ctx.userId), params),
});

/* ── set_game ───────────────────────────────────────────────────────── */

const setGameParams = z.object({
  players: z.number().int().min(PLAYERS_MIN).max(PLAYERS_MAX).nullable().optional(),
  budgetPerPlayer: z.number().int().min(BUDGET_MIN).max(BUDGET_MAX).nullable().optional(),
  unit: z.string().trim().max(UNIT_MAX).nullable().optional(),
});

async function setGame(store: GameStore, params: z.infer<typeof setGameParams>) {
  const cur = await store.game();
  const next: BuyAFeatureGame = {
    ...(cur ?? { id: BUY_A_FEATURE_ID }),
    id: BUY_A_FEATURE_ID,
    updatedAt: new Date().toISOString(),
  };
  for (const key of ["players", "budgetPerPlayer", "unit"] as const) {
    const v = params[key];
    if (v === undefined) continue;
    if (v === null || v === "") delete next[key];
    else (next as unknown as Record<string, unknown>)[key] = v;
  }
  await store.putGame(next);
  const features = (await store.rows()).map(featureLedger);
  const check = gameCheck(next, features);
  return {
    set: true,
    game: {
      players: next.players ?? null,
      budgetPerPlayer: next.budgetPerPlayer ?? null,
      unit: next.unit ?? null,
    },
    pool: pool(next, features)?.pool ?? null,
    problem: check ? budgetProblem(check, unitOf(next)) : null,
  };
}

registry.register({
  id: "tool.buy_a_feature.set_game",
  toolId: "tool.buy_a_feature",
  name: "set_game",
  category: "write",
  requiresConfirmation: false,
  description: `Set the game: {players? (whole, ${PLAYERS_MIN}..${PLAYERS_MAX}), budgetPerPlayer? (whole, ${BUDGET_MIN}..${BUDGET_MAX.toLocaleString("en-US")}), unit? (≤${UNIT_MAX} chars, e.g. '$' or 'pts')}; null clears one, an omitted one stays. Ask the user for the players rather than assuming the team's size. The pool should stay below the sum of prices (about half is usual). Returns {set: true, game, pool|null, problem|null (set when the players could buy everything)}.`,
  paramsSchema: setGameParams,
  handler: (params) => setGame(browserStore, params),
  mcpHandler: (params, ctx) => setGame(serverStore(ctx.userId), params),
});

/* ── record_purchase ────────────────────────────────────────────────── */

async function load(store: GameStore) {
  const [rows, game] = await Promise.all([store.rows(), store.game()]);
  const features = rows.map(featureLedger);
  return { rows, game, features, unit: unitOf(game), pool: pool(game, features) };
}

async function recordPurchaseAction(store: GameStore, id: string, amount: number) {
  const { rows, features, unit, pool: p } = await load(store);
  const row = rows.find((r) => r.id === id);
  const f = features.find((x) => x.id === id);
  if (!row || !f) return { recorded: false, reason: `No feature with id "${id}".` };
  const problem = purchaseProblem(f, amount, p, unit);
  if (problem) return { recorded: false, reason: problem };
  const { raised, applied, refunded } = recordPurchase(f, amount);
  await store.putRows([withRaised(row, raised, new Date().toISOString())]);
  const after: FeatureLedger = { ...f, raised };
  return {
    recorded: true,
    applied,
    refunded,
    raised,
    remaining: remaining(after),
    funded: isFunded(after),
  };
}

registry.register({
  id: "tool.buy_a_feature.record_purchase",
  toolId: "tool.buy_a_feature",
  name: "record_purchase",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a purchase made at the table (pool level: no buyer is kept). Params: {id (a feature's), amount (whole, 1 or more)}. It is capped at what the feature still needs, and the rest goes back (`refunded`); it is refused above what's left in the pool, for a funded or unpriced feature, or before the players and budget are set. Returns {recorded: true, applied, refunded, raised, remaining, funded} or {recorded: false, reason}.",
  paramsSchema: z.object({
    id: z.string().min(1),
    amount: z.number().int().min(1).max(PRICE_MAX),
  }),
  handler: (params) => recordPurchaseAction(browserStore, params.id, params.amount),
  mcpHandler: (params, ctx) =>
    recordPurchaseAction(serverStore(ctx.userId), params.id, params.amount),
});

/* ── refund / refund_unfunded ───────────────────────────────────────── */

async function refundOne(store: GameStore, id: string) {
  const rows = await store.rows();
  const row = rows.find((r) => r.id === id);
  if (!row) return { refunded: false, reason: `No feature with id "${id}".` };
  const amount = featureLedger(row).raised;
  if (amount === 0) return { refunded: false, reason: "It has raised nothing." };
  await store.putRows([withRaised(row, 0, new Date().toISOString())]);
  return { refunded: true, amount };
}

registry.register({
  id: "tool.buy_a_feature.refund",
  toolId: "tool.buy_a_feature",
  name: "refund",
  category: "write",
  requiresConfirmation: false,
  description:
    "Give one feature's money back to the pool (raised → 0), funded or not. Params: {id}. The page offers Undo; an agent's refund is final, so confirm with the user first. Returns {refunded: true, amount} or {refunded: false, reason}.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: (params) => refundOne(browserStore, params.id),
  mcpHandler: (params, ctx) => refundOne(serverStore(ctx.userId), params.id),
});

async function refundShort(store: GameStore) {
  const rows = await store.rows();
  const refunds = refundUnfunded(rows.map(featureLedger));
  const now = new Date().toISOString();
  const changed = rows.filter((r) => refunds.has(r.id));
  const amount = changed.reduce((s, r) => s + featureLedger(r).raised, 0);
  await store.putRows(changed.map((r) => withRaised(r, 0, now)));
  return { refunded: changed.length, amount, ids: changed.map((r) => r.id) };
}

registry.register({
  id: "tool.buy_a_feature.refund_unfunded",
  toolId: "tool.buy_a_feature",
  name: "refund_unfunded",
  category: "write",
  requiresConfirmation: true,
  description:
    "End of the game: every feature that raised money but fell short of its price gives it back to the pool. Funded features keep theirs. Returns {refunded (features), amount, ids}.",
  paramsSchema: z.object({}),
  handler: () => refundShort(browserStore),
  mcpHandler: (_params, ctx) => refundShort(serverStore(ctx.userId)),
});

/* ── record_round ───────────────────────────────────────────────────── */

const recordRoundParams = z.object({
  totals: z
    .record(z.string(), z.number().int().min(0))
    .describe(
      "Feature id -> what the players gave it in all (whole). Only features in list_state's nextRound.features; a missing one is 0."
    ),
  players: z
    .number()
    .int()
    .min(MIN_SAMPLE.anonymous)
    .max(VOTE_LIMITS.maxTallyBallots)
    .describe(
      `How many people split their budget (at least ${MIN_SAMPLE.anonymous}, so no one's split shows).`
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "YYYY-MM-DD the round was held (backdate a paper round; not in the future, nor before the game's last round). Default today; pass the user's local date."
    ),
});

async function recordRound(
  store: GameStore,
  params: z.infer<typeof recordRoundParams>,
  onServer: boolean
) {
  const [rows, game, allRounds] = await Promise.all([store.rows(), store.game(), store.rounds()]);
  const features = rows.map(featureLedger);
  const unit = unitOf(game);
  const rounds = gameRounds(allRounds);
  const next = nextRound(features, game, rounds);
  if (!next.sheet || next.budget === null) {
    return { saved: false, reason: next.blocked ?? "The round can't run." };
  }
  // The page's rule: backdatable, never in the future, never before the
  // game's last round (rounds follow each other). The server's day (UTC on
  // a typical deploy) isn't the user's: allow the day after it.
  const today = todayLocalISO();
  const earliest = rounds[0]?.date ?? null;
  const date = params.date ?? (earliest && earliest > today ? earliest : today);
  const dayProblem = roundDayProblem(date, onServer ? addDays(today, 1) : today, earliest);
  if (dayProblem) return { saved: false, reason: dayProblem };
  const sheet = next.sheet;
  const offered = new Set(sheet.items.map((x) => x.id));
  const unknown = Object.keys(params.totals).filter((id) => !offered.has(id));
  if (unknown.length > 0) {
    return {
      saved: false,
      reason: `Not in this round (funded, unpriced or unknown): ${unknown.join(", ")}.`,
    };
  }
  const totals = sheet.items.map((x) => params.totals[x.id] ?? 0);
  const tally = foldAllocationTotals(
    emptyAllocationTally("agent", sheet),
    totals,
    params.players,
    sheet
  );
  if (!tally) {
    return {
      saved: false,
      reason: `These totals can't come from ${params.players} people with ${next.budget} each: each feature takes at most ${params.players} × what it still needs (or the budget), and the totals add up to at least ${params.players} and at most ${params.players} × ${next.budget}.`,
    };
  }
  const minN = MIN_SAMPLE.anonymous;
  const revealed = revealAllocation(tally, minN);
  const now = new Date().toISOString();
  const result = revealed
    ? toAllocationResult(sheet, revealed, {
        tool: "buy-a-feature",
        roundId: `tally-${Date.now().toString(36)}`,
        closedAt: now,
        minN,
        ballots: params.players,
        source: "facilitator",
        spreadKnown: false,
      })
    : null;
  if (!result) return { saved: false, reason: `Results need ${minN} people.` };
  const applied = applyAllocationRound(features, result);
  const problem = roundPoolProblem(applied, pool(game, features), unit);
  if (problem) return { saved: false, reason: problem };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const changed = Array.from(applied.next).flatMap(([id, raised]) => {
    const row = byId.get(id);
    return row ? [withRaised(row, raised, now)] : [];
  });
  await store.putRows(changed);
  const round = allocationRoundFrom(result, { id: `allocationRound_${nanoid(8)}`, date });
  await store.putRound(round);
  const title = new Map(features.map((f) => [f.id, f.title]));
  return {
    saved: true,
    id: round.id,
    round: next.number,
    date,
    budgetPerPlayer: next.budget,
    spent: applied.spends,
    refunded: applied.refunded,
    funded: applied.funded.map((id) => ({ id, title: title.get(id) ?? id })),
    short: applied.short.map((s) => ({ id: s.id, title: title.get(s.id) ?? s.id, by: s.by })),
    outcome: roundOutcomeText(applied, features, unit),
  };
}

registry.register({
  id: "tool.buy_a_feature.record_round",
  toolId: "tool.buy_a_feature",
  name: "record_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a round whose totals were added up by hand (paper splits). Each player split the next round's budget (list_state nextRound.budgetPerPlayer: round 1 the budget per player, later the pool's leftover split evenly) across nextRound.features. Params: {totals: {featureId: whole total}, players (people who split, ≥3), date? (YYYY-MM-DD the round was held: backdatable, not in the future, not before the game's last round; default today)}. Each feature's total is capped at what it still needs, the rest goes back to the pool; a short feature keeps its pledge. Saved as a round with totals only (the spread isn't known for typed totals). Refused when the round can't run (nextRound.blocked), the date can't be used, the totals can't come from that many splits, or it would spend more than the pool has left. Returns {saved: true, id, round, date, budgetPerPlayer, spent, refunded, funded: {id, title}[], short: {id, title, by}[], outcome} or {saved: false, reason}.",
  paramsSchema: recordRoundParams,
  handler: (params) => recordRound(browserStore, params, false),
  mcpHandler: (params, ctx) => recordRound(serverStore(ctx.userId), params, true),
});
