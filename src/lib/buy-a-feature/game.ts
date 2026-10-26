/**
 * Buy-a-Feature: the game's numbers, for the page and its agent actions.
 *
 * Features are PrioritizationItem rows (framework "buy-feature") with a
 * whole `fields.price` and what was `fields.raised` toward it. The game
 * document (`BuyAFeatureGame`, a singleton) holds the players and each
 * one's budget; the pool is budget × players. The game only works when the
 * pool is below the sum of the prices (nobody can have everything), so the
 * budget check says when it isn't.
 *
 * Money moves at pool level, never per player:
 *  - a purchase at the table is capped at what the feature still needs
 *    (the rest goes back to the pool) and refused above what's left in it;
 *  - a round (the vote-room kit's allocation kind) splits each player's
 *    share of what's left; each feature's total is capped the same way,
 *    and pledges for a feature that falls short stay as progress;
 *  - "Refund unfunded features" ends the game: short features give their
 *    money back.
 *
 * Old rows saved before purchases were capped can hold more than their
 * price, or a price of 0 or a fraction: they read as capped at the price,
 * or "Not priced" (left out of rounds and the budget check) until someone
 * prices them.
 *
 * Pure and server-safe (the MCP actions import it): no React, no store, no
 * "use client" module.
 */

import {
  type AllocationRound,
  type BuyAFeatureGame,
  type PrioritizationItem,
} from "@/lib/stores/workspace-types";
import {
  allocationAmount,
  type AllocationRoundResult,
  type AllocationSheet,
} from "@/lib/realtime/vote-room/allocation";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { listAnd } from "@/lib/charts/chart-text";
import { roundsFor } from "@/lib/hundred-dollar/allocation";

/** The rows' framework. */
export const BUY_FEATURE_FRAMEWORK = "buy-feature" as const;

export const FEATURE_TITLE_MAX = 200;
/** The highest price (the old form's bound). */
export const PRICE_MAX = 1_000_000_000;
/** A player's budget: what a round's sheet can split (the kit's bounds). */
export const BUDGET_MIN = VOTE_LIMITS.minBudget;
export const BUDGET_MAX = VOTE_LIMITS.maxBudget;
export const PLAYERS_MIN = 1;
export const PLAYERS_MAX = 999;
export const UNIT_MAX = VOTE_LIMITS.maxUnitChars;
/** Shown before amounts when the game has no unit of its own. */
export const DEFAULT_UNIT = "$";

export function isFeatureRow(row: PrioritizationItem): boolean {
  return row.framework === BUY_FEATURE_FRAMEWORK;
}

/** The game's features, in store order. */
export function featureRows(rows: readonly PrioritizationItem[] | undefined): PrioritizationItem[] {
  return (rows ?? []).filter(isFeatureRow);
}

/** Whether `n` is a price a feature can have: whole, 1 to PRICE_MAX. */
export function isPrice(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= PRICE_MAX;
}

export function isBudget(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= BUDGET_MIN && n <= BUDGET_MAX;
}

export function isPlayers(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= PLAYERS_MIN && n <= PLAYERS_MAX;
}

/** The game's unit, or "$". */
export function unitOf(game: BuyAFeatureGame | null | undefined): string {
  const u = game?.unit?.trim();
  return u ? u.slice(0, UNIT_MAX) : DEFAULT_UNIT;
}

/** A feature as the game counts it. */
export interface FeatureLedger {
  id: string;
  title: string;
  /** Whole, 1 or more; null when "Not priced" (a legacy 0, negative or fraction). */
  price: number | null;
  /** Raised toward the price, never above it. */
  raised: number;
  /** What an old row held above its price (before purchases were capped): 0 normally. */
  overStored: number;
}

export function featureLedger(row: PrioritizationItem): FeatureLedger {
  const rawPrice = Number(row.fields?.price);
  const price = isPrice(rawPrice) ? rawPrice : null;
  const rawRaised = Number(row.fields?.raised);
  const stored = Number.isFinite(rawRaised) && rawRaised > 0 ? rawRaised : 0;
  const raised = price === null ? stored : Math.min(stored, price);
  return { id: row.id, title: row.title, price, raised, overStored: stored - raised };
}

/** What the feature still needs; 0 when funded or not priced. */
export function remaining(f: FeatureLedger): number {
  return f.price === null ? 0 : Math.max(0, f.price - f.raised);
}

export function isFunded(f: FeatureLedger): boolean {
  return f.price !== null && f.raised >= f.price;
}

/** Raised as a share of the price (0 to 1), or null when not priced. */
export function fundedShare(f: FeatureLedger): number | null {
  return f.price === null ? null : Math.min(1, f.raised / f.price);
}

/**
 * A purchase of `amount` (whole, 1 or more): what it applies, capped at
 * what the feature still needs, and what goes back to the buyer.
 */
export function recordPurchase(
  f: FeatureLedger,
  amount: number
): { raised: number; applied: number; refunded: number } {
  const applied = Math.max(0, Math.min(amount, remaining(f)));
  return { raised: f.raised + applied, applied, refunded: amount - applied };
}

export interface Pool {
  players: number;
  budgetPerPlayer: number;
  /** players × budgetPerPlayer. */
  pool: number;
  /** Raised across every feature (capped at each price). */
  spent: number;
  /** pool − spent, never below 0. */
  left: number;
  /** What the features hold above the pool (old purchases, or a lowered budget): 0 normally. */
  overspent: number;
}

/** The pool, or null until the players and each one's budget are set. */
export function pool(
  game: BuyAFeatureGame | null | undefined,
  features: readonly FeatureLedger[]
): Pool | null {
  const budgetPerPlayer = game?.budgetPerPlayer;
  const players = game?.players;
  if (!isBudget(budgetPerPlayer) || !isPlayers(players)) return null;
  const total = budgetPerPlayer * players;
  const spent = features.reduce((s, f) => s + f.raised, 0);
  return {
    players,
    budgetPerPlayer,
    pool: total,
    spent,
    left: Math.max(0, total - spent),
    overspent: Math.max(0, spent - total),
  };
}

export interface BudgetCheck {
  pool: number;
  sumOfPrices: number;
  /** The pool is below the sum of prices: nobody can buy everything. */
  ok: boolean;
  /** pool ÷ sum of prices; null with nothing priced. */
  share: number | null;
  /** About half the prices split between the players; null when outside the budget's bounds. */
  suggestedBudget: number | null;
  /** The budget each player must stay below for the check to pass; null with nothing priced. */
  budgetBelow: number | null;
}

/**
 * Whether the game can make people choose: the players' money in all must
 * be below the features' prices in all. The usual advice is about half, so
 * that is what it suggests.
 */
export function budgetCheck(
  prices: readonly number[],
  players: number,
  budgetPerPlayer: number
): BudgetCheck {
  const sumOfPrices = prices.reduce((s, p) => s + p, 0);
  const total = players * budgetPerPlayer;
  const half = players > 0 ? Math.floor(sumOfPrices / 2 / players) : 0;
  return {
    pool: total,
    sumOfPrices,
    ok: sumOfPrices > 0 && total < sumOfPrices,
    share: sumOfPrices > 0 ? total / sumOfPrices : null,
    suggestedBudget: isBudget(half) ? half : null,
    budgetBelow: sumOfPrices > 0 && players > 0 ? Math.ceil(sumOfPrices / players) : null,
  };
}

/** The priced features' prices. */
export function pricesOf(features: readonly FeatureLedger[]): number[] {
  return features.flatMap((f) => (f.price === null ? [] : [f.price]));
}

/** The budget check for the game as it stands, or null until the pool is set. */
export function gameCheck(
  game: BuyAFeatureGame | null | undefined,
  features: readonly FeatureLedger[]
): BudgetCheck | null {
  const p = pool(game, features);
  return p ? budgetCheck(pricesOf(features), p.players, p.budgetPerPlayer) : null;
}

/** "6 players × $100 = $600 can buy 52% of the $1,150 of features." */
export function budgetText(check: BudgetCheck, p: Pool, unit: string): string {
  const money = (n: number) => allocationAmount(n, unit);
  const head = `${p.players} ${p.players === 1 ? "player" : "players"} × ${money(p.budgetPerPlayer)} = ${money(check.pool)}`;
  if (check.sumOfPrices === 0) return `${head}. Price the features to see what it can buy.`;
  if (!check.ok) return `${head} could buy all ${money(check.sumOfPrices)} of features.`;
  return `${head} can buy ${Math.round((check.share ?? 0) * 100)}% of the ${money(check.sumOfPrices)} of features.`;
}

/** Why the game can't make people choose, in one sentence, or null when it can. */
export function budgetProblem(check: BudgetCheck, unit: string): string | null {
  if (check.ok || check.sumOfPrices === 0) return null;
  const below =
    check.budgetBelow === null ? "" : ` below ${allocationAmount(check.budgetBelow, unit)} each`;
  return `The players could buy everything. Lower the budget${below}, or add features.`;
}

/** A later round's budget per player: what's left in the pool, split evenly (whole units). */
export function nextRoundBudget(p: Pool): number {
  return p.players > 0 ? Math.floor(p.left / p.players) : 0;
}

/** This game's rounds so far, newest first. */
export function gameRounds(rounds: readonly AllocationRound[] | undefined): AllocationRound[] {
  return roundsFor(rounds, "buy-a-feature");
}

/** The next round's number (1 for the first). */
export function nextRoundNo(rounds: readonly AllocationRound[] | undefined): number {
  return gameRounds(rounds).length + 1;
}

/** The features a round can still fund: priced, not funded yet. */
export function openFeatures(features: readonly FeatureLedger[]): FeatureLedger[] {
  return features.filter((f) => f.price !== null && remaining(f) > 0);
}

/**
 * The sheet a round splits: each player's `budget` across the features
 * still to fund, each capped at what it still needs (one person can't
 * over-fund it, and the round's totals are capped again on save). Players
 * needn't spend everything. Null with fewer than two such features.
 */
export function buyAFeatureSheet(
  features: readonly FeatureLedger[],
  budget: number,
  unit: string,
  roundNo: number
): AllocationSheet | null {
  const open = openFeatures(features);
  if (open.length < VOTE_LIMITS.minAllocationItems) return null;
  const money = (n: number) => allocationAmount(n, unit);
  return {
    id: `buy-a-feature-round-${roundNo}`,
    title: `Buy-a-Feature, round ${roundNo}`,
    budget,
    unit,
    spendAll: false,
    items: open.map((f) => {
      const need = remaining(f);
      return {
        id: f.id,
        text: f.title.slice(0, FEATURE_TITLE_MAX),
        hint:
          f.raised > 0
            ? `Priced ${money(f.price as number)}, ${money(f.raised)} raised`
            : `Priced ${money(f.price as number)}`,
        // Above the kit's cap the budget binds anyway; the save caps the total.
        ...(need <= VOTE_LIMITS.maxCap ? { cap: need } : {}),
      };
    }),
  };
}

export interface NextRound {
  /** 1 for the first round. */
  number: number;
  /** Each player's budget: what's left in the pool split evenly; null without a pool. */
  budget: number | null;
  /** The sheet to split; null while the round can't run. */
  sheet: AllocationSheet | null;
  /** Why the round can't run, in one sentence; null when it can. */
  blocked: string | null;
}

/**
 * The next round, as the page offers it and the agent records it: its
 * number, each player's budget (round 1: the budget per player; later:
 * the pool's leftover split evenly) and the sheet, or why it can't run
 * (no pool, a pool that buys everything, fewer than two features to fund,
 * or too little left per player for the kit's smallest budget).
 */
export function nextRound(
  features: readonly FeatureLedger[],
  game: BuyAFeatureGame | null | undefined,
  rounds: readonly AllocationRound[] | undefined
): NextRound {
  const number = nextRoundNo(rounds);
  const unit = unitOf(game);
  const p = pool(game, features);
  if (!p) {
    return {
      number,
      budget: null,
      sheet: null,
      blocked: "Set the players and each one's budget first.",
    };
  }
  const budget = nextRoundBudget(p);
  const no = (blocked: string): NextRound => ({ number, budget, sheet: null, blocked });
  const problem = budgetProblem(
    budgetCheck(pricesOf(features), p.players, p.budgetPerPlayer),
    unit
  );
  if (problem) return no(problem);
  if (openFeatures(features).length < VOTE_LIMITS.minAllocationItems) {
    return no("A round needs at least two priced features that aren't funded yet.");
  }
  if (budget < BUDGET_MIN) {
    return no(
      `Only ${allocationAmount(budget, unit)} is left per player, too little for another round. Buy the last features at the table.`
    );
  }
  return { number, budget, sheet: buyAFeatureSheet(features, budget, unit, number), blocked: null };
}

export interface RoundApplied {
  /** Feature id → raised after the round, for the features it changed. */
  next: Map<string, number>;
  /** Features the round funded. */
  funded: string[];
  /** Given above what a feature needed (or to a feature no longer in the game): back to the pool. */
  refunded: number;
  /** Features that got money but still fall short, and by how much. */
  short: { id: string; by: number }[];
  /** What the round spends from the pool. */
  spends: number;
  /** Round items whose feature is gone or no longer priced. */
  missing: string[];
}

/**
 * A round's totals against the features as they are now: each total is
 * capped at what its feature still needs, the rest goes back to the pool.
 */
export function applyAllocationRound(
  features: readonly FeatureLedger[],
  r: Pick<AllocationRoundResult, "items">
): RoundApplied {
  const byId = new Map(features.map((f) => [f.id, f]));
  const out: RoundApplied = {
    next: new Map(),
    funded: [],
    refunded: 0,
    short: [],
    spends: 0,
    missing: [],
  };
  for (const item of r.items) {
    const f = byId.get(item.id);
    if (!f || f.price === null) {
      out.refunded += item.total;
      out.missing.push(item.id);
      continue;
    }
    const raisedNow = out.next.get(f.id) ?? f.raised;
    const need = Math.max(0, f.price - raisedNow);
    const applied = Math.min(item.total, need);
    out.refunded += item.total - applied;
    if (applied === 0) continue;
    const raised = raisedNow + applied;
    out.next.set(f.id, raised);
    out.spends += applied;
    if (raised >= f.price) out.funded.push(f.id);
    else out.short.push({ id: f.id, by: f.price - raised });
  }
  return out;
}

/**
 * What saving a round does, in one sentence: "Funded Search and Exports;
 * Single sign-on is $60 short; $40 of over-funding went back to the pool."
 */
export function roundOutcomeText(
  applied: RoundApplied,
  features: readonly FeatureLedger[],
  unit: string
): string {
  const money = (n: number) => allocationAmount(n, unit);
  const title = new Map(features.map((f) => [f.id, f.title]));
  const name = (id: string) => title.get(id) ?? "a feature";
  const parts = [
    applied.funded.length > 0
      ? `Funded ${listAnd(applied.funded.map(name))}`
      : applied.spends > 0
        ? `No feature funded yet: ${money(applied.spends)} pledged`
        : "Nothing was spent",
  ];
  if (applied.short.length > 0 && applied.short.length <= 2) {
    parts.push(applied.short.map((s) => `${name(s.id)} is ${money(s.by)} short`).join(", and "));
  } else if (applied.short.length > 2) {
    parts.push(`${applied.short.length} features are still short`);
  }
  if (applied.refunded > 0) {
    parts.push(`${money(applied.refunded)} of over-funding went back to the pool`);
  }
  return `${parts.join("; ")}.`;
}

/** Why the round can't be saved against the pool, or null when it can. */
export function roundPoolProblem(
  applied: RoundApplied,
  p: Pool | null,
  unit: string
): string | null {
  if (!p) return "Set the players and each one's budget first.";
  if (applied.spends <= p.left) return null;
  const money = (n: number) => allocationAmount(n, unit);
  return `The round would spend ${money(applied.spends)}, more than the ${money(p.left)} left in the pool, so nothing was saved. Check the number of players.`;
}

/** Feature id → 0 for every feature with money that isn't funded (the end of the game). */
export function refundUnfunded(features: readonly FeatureLedger[]): Map<string, number> {
  return new Map(features.filter((f) => f.raised > 0 && !isFunded(f)).map((f) => [f.id, 0]));
}

/**
 * Why a purchase of `amount` can't be recorded, in one sentence, or null
 * when it can. `amount` undefined is a blank box, NaN unreadable.
 */
export function purchaseProblem(
  f: FeatureLedger,
  amount: number | undefined,
  p: Pool | null,
  unit: string
): string | null {
  const money = (n: number) => allocationAmount(n, unit);
  if (amount === undefined) return "Enter an amount.";
  if (!Number.isInteger(amount) || amount < 1) return "Enter a whole amount, 1 or more.";
  if (f.price === null) return "Price this feature first.";
  if (isFunded(f)) return "It's already funded.";
  if (!p) return "Set the players and each one's budget first: purchases come out of the pool.";
  const { applied } = recordPurchase(f, amount);
  if (applied > p.left) {
    return p.left === 0 ? "The pool is spent." : `Only ${money(p.left)} left in the pool.`;
  }
  return null;
}

/** The row with `raised` (capped at its price): score mirrors it, status says whether it's funded. */
export function withRaised(
  row: PrioritizationItem,
  raised: number,
  now: string
): PrioritizationItem {
  const f = featureLedger({ ...row, fields: { ...(row.fields ?? {}), raised } });
  const status =
    row.status === "shipped" || row.status === "dropped"
      ? row.status
      : isFunded(f)
        ? "decided"
        : "open";
  return {
    ...row,
    score: f.raised,
    status,
    fields: { ...(row.fields ?? {}), raised: f.raised },
    updatedAt: now,
  };
}

/** The row repriced: what it raised above the new price goes back to the pool. */
export function withPrice(
  row: PrioritizationItem,
  price: number,
  now: string
): { row: PrioritizationItem; refunded: number } {
  const before = featureLedger(row);
  const priced = { ...row, fields: { ...(row.fields ?? {}), price } };
  const raised = Math.min(before.raised + before.overStored, price);
  return {
    row: withRaised(priced, raised, now),
    refunded: Math.max(0, before.raised - raised),
  };
}

/** A new feature's row (unscored: nothing raised yet). */
export function newFeatureRow(
  id: string,
  title: string,
  price: number,
  now: string
): PrioritizationItem {
  return {
    id,
    framework: BUY_FEATURE_FRAMEWORK,
    title: title.trim().slice(0, FEATURE_TITLE_MAX),
    score: 0,
    fields: { price, raised: 0 },
    status: "open",
    updatedAt: now,
  };
}

/**
 * The one-sentence answer above the market: what still needs setting up,
 * or what the game has funded and what's left in the pool.
 */
export function buyAFeatureVerdict(
  features: readonly FeatureLedger[],
  game: BuyAFeatureGame | null | undefined
): string {
  if (features.length === 0) return "No features yet.";
  const unit = unitOf(game);
  const money = (n: number) => allocationAmount(n, unit);
  const priced = features.filter((f) => f.price !== null);
  if (priced.length === 0) return "Price the features to start the game.";
  const p = pool(game, features);
  const sum = pricesOf(features).reduce((s, x) => s + x, 0);
  if (!p) {
    return `${priced.length} ${priced.length === 1 ? "feature" : "features"} priced at ${money(sum)} in all: set the players and each one's budget to start.`;
  }
  const check = budgetCheck(pricesOf(features), p.players, p.budgetPerPlayer);
  const problem = budgetProblem(check, unit);
  if (problem) return problem;
  const funded = features.filter(isFunded);
  if (p.spent === 0) return `${budgetText(check, p, unit).replace(/\.$/, "")}; nothing bought yet.`;
  const left = `${money(p.left)} of the ${money(p.pool)} pool left`;
  if (funded.length === 0) {
    return `No feature funded yet: ${money(p.spent)} pledged, ${left}.`;
  }
  const names = funded.length <= 3 ? ` (${listAnd(funded.map((f) => f.title))})` : "";
  return `Funded ${funded.length} of ${priced.length} features${names}, with ${left}.`;
}
