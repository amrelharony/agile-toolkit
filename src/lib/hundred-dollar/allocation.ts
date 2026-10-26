/**
 * The $100 Test's numbers, for the page and its agent actions, and the
 * saved-round helpers Buy-a-Feature shares (both run the vote-room kit's
 * "allocation" rounds and keep them as `AllocationRound`s).
 *
 * Two kinds of split live side by side:
 *  - the agreed split: one $100 split the group agrees on together (or one
 *    person's), on each item's `fields.allocation`, in whole dollars. A
 *    new item has none until someone types an amount, so a deliberate $0
 *    can be told from "not given yet";
 *  - team rounds: everyone splits their own $100 anonymously, and only the
 *    aggregates are kept: per item the total, how many gave it something,
 *    and how many people fell in each of five bands of the budget. Never
 *    anyone's split, and never who answered.
 *
 * Pure and server-safe (the MCP actions import it): no React, no store, no
 * "use client" module.
 */

import {
  ALLOCATION_ROUND_TOOLS,
  type AllocationRound,
  type AllocationRoundTool,
  type PrioritizationItem,
} from "@/lib/stores/workspace-types";
import {
  ALLOCATION_BANDS,
  allocationAmount,
  allocationBandEdges,
  allocationMean,
  bandLabel,
  middleHalfText,
  type AllocationRoundResult,
  type AllocationSheet,
} from "@/lib/realtime/vote-room/allocation";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { listAnd } from "@/lib/charts/chart-text";
import { isIsoDate } from "@/lib/sprints/calendar";

/** The budget everyone splits. */
export const HUNDRED = 100;

/** The rows' framework. */
export const HUNDRED_FRAMEWORK = "hundred-dollar" as const;

/** Same cap as Buy-a-Feature's features and the backlog's stories. */
export const ITEM_TITLE_MAX = 200;

/** The live sheet's id (one per tool: a round's own id is the room's). */
export const HUNDRED_SHEET_ID = "hundred-dollar-test";

/** A share of the people in an item's most common band at or above which they "mostly agree". */
export const AGREE_SHARE = 0.6;
/** At or below this share, the team "is split" on the item. */
export const SPLIT_SHARE = 0.4;

const EPSILON = 1e-9;

/** "$34", or "$33.50" for a legacy amount in cents. */
export function dollars(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? `$${r.toLocaleString("en-US")}` : `$${r.toFixed(2)}`;
}

export function isHundredRow(row: PrioritizationItem): boolean {
  return row.framework === HUNDRED_FRAMEWORK;
}

/** The $100 Test's items, in store order. */
export function hundredRows(rows: readonly PrioritizationItem[] | undefined): PrioritizationItem[] {
  return (rows ?? []).filter(isHundredRow);
}

/**
 * An item's amount in the agreed split, or null when none was given. A
 * legacy row in cents keeps its cents until it is edited; a stored amount
 * below 0 or not a number reads as none.
 */
export function allocationOf(row: PrioritizationItem | undefined): number | null {
  const raw = row?.fields?.allocation;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The agreed split's amounts added up, rounded to cents (legacy rows drift). */
function totalOf(rows: readonly PrioritizationItem[], skipId?: string): number {
  const sum = rows.reduce((s, x) => (x.id === skipId ? s : s + (allocationOf(x) ?? 0)), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * What an amount typed for item `id` saves as, and why it changed, if it
 * did. Whole dollars from $0 to the money not given to the other items:
 * a negative amount saves $0, a fraction rounds, and an amount above what
 * is left saves what is left. The note names the item and both amounts, so
 * the cap is never silent.
 */
export function capAllocation(
  rows: readonly PrioritizationItem[],
  id: string,
  typed: number
): { saved: number; note: string | null } {
  const items = hundredRows(rows);
  const title = items.find((x) => x.id === id)?.title ?? "This item";
  const headroom = Math.max(0, Math.floor(HUNDRED - totalOf(items, id) + EPSILON));
  if (!Number.isFinite(typed)) return { saved: 0, note: null };
  const whole = Math.round(typed);
  const requested = Math.max(0, Math.min(HUNDRED, whole));
  const saved = Math.min(requested, headroom);
  if (typed === saved) return { saved, note: null };
  if (typed < 0) {
    return { saved, note: `Amounts can't be negative, so ${title} is set to $0.` };
  }
  if (saved < requested) {
    return {
      saved,
      note: `Only ${dollars(headroom)} was left, so ${title} got ${dollars(saved)}, not ${dollars(typed)}. Lower another item first to move money here.`,
    };
  }
  if (whole > HUNDRED) {
    return {
      saved,
      note: `The whole budget is ${dollars(HUNDRED)}, so ${title} got ${dollars(saved)}, not ${dollars(typed)}.`,
    };
  }
  return {
    saved,
    note: `Whole dollars only, so ${title} got ${dollars(saved)}, not ${dollars(typed)}.`,
  };
}

/** The row with `amount` in the agreed split (score mirrors it, as before). */
export function withAllocation(
  row: PrioritizationItem,
  amount: number,
  now: string
): PrioritizationItem {
  return {
    ...row,
    score: amount,
    fields: { ...(row.fields ?? {}), allocation: amount },
    updatedAt: now,
  };
}

/** The row with no amount in the agreed split (Clear all amounts). */
export function withoutAllocation(row: PrioritizationItem, now: string): PrioritizationItem {
  const fields = { ...(row.fields ?? {}) };
  delete fields.allocation;
  const next: PrioritizationItem = { ...row, fields, updatedAt: now };
  delete next.score;
  return next;
}

export interface SplitSummary {
  /** Dollars given out, to the cent. */
  total: number;
  /** $100 less the total; negative when a legacy split is over. */
  remaining: number;
  /** The whole $100 is given out (sub-cent drift counts as full). */
  full: boolean;
  /** Items with an amount (a deliberate $0 included). */
  given: number;
}

export function splitSummary(rows: readonly PrioritizationItem[]): SplitSummary {
  const items = hundredRows(rows);
  const total = totalOf(items);
  const remaining = Math.round((HUNDRED - total) * 100) / 100;
  return {
    total,
    remaining,
    full: Math.abs(remaining) < 0.005,
    given: items.filter((x) => allocationOf(x) !== null).length,
  };
}

/**
 * The sheet a team round splits: every item, $100 each, the whole $100
 * given out. Null with fewer than two items (nothing to trade off). Items
 * past the live limit (20) still get a sheet: the kit then offers paper
 * splits only, and says why.
 */
export function hundredDollarSheet(rows: readonly PrioritizationItem[]): AllocationSheet | null {
  const items = hundredRows(rows);
  if (items.length < VOTE_LIMITS.minAllocationItems) return null;
  return {
    id: HUNDRED_SHEET_ID,
    title: "$100 Test",
    budget: HUNDRED,
    unit: "$",
    spendAll: true,
    items: items.map((x) => ({ id: x.id, text: x.title.slice(0, ITEM_TITLE_MAX) })),
  };
}

/* ── Saved rounds (shared with Buy-a-Feature) ──────────────────────── */

export function isAllocationRoundTool(v: unknown): v is AllocationRoundTool {
  return (ALLOCATION_ROUND_TOOLS as readonly unknown[]).includes(v);
}

/**
 * A saved round as these tools write it: an `AllocationRound`, plus
 * `spreadKnown: false` when its totals were typed by hand. The record's
 * other fields can't tell typed totals from a spread withheld under 5
 * answers (both have no bands), so the flag is written for typed totals
 * only; a round without it reads as before (`spreadKnownOf`).
 */
export type AllocationRoundRecord = AllocationRound & { spreadKnown?: boolean };

/**
 * A closed round as the workspace keeps it: the kit's aggregates-only
 * result, under `id`, for the day `date` (YYYY-MM-DD). Nothing per person
 * is in the result, so nothing per person can reach the record.
 */
export function allocationRoundFrom(
  result: AllocationRoundResult,
  meta: { id: string; date: string }
): AllocationRoundRecord {
  return {
    id: meta.id,
    tool: result.tool,
    roundId: result.roundId,
    title: result.title,
    budget: result.budget,
    unit: result.unit,
    spendAll: result.spendAll,
    date: meta.date,
    closedAt: result.closedAt,
    minN: result.minN,
    ballots: result.ballots,
    source: result.source === "live" ? "room" : "facilitator",
    ...(result.spreadKnown ? {} : { spreadKnown: false }),
    bandEdges: result.bandEdges.slice(),
    items: result.items.map((x) => ({
      itemId: x.id,
      text: x.text,
      ...(x.cap !== undefined ? { cap: x.cap } : {}),
      total: x.total,
      backers: x.backers,
      bands: x.bands ? x.bands.slice() : null,
    })),
  };
}

/**
 * Whether a saved round knew how the amounts were spread. Typed totals
 * carry `spreadKnown: false` (any count). A round without the flag (all
 * others, and rows saved before it) is read from its bands: any bands, it
 * knew; none from 5 answers, its totals were typed in (a live round or
 * paper splits would have kept them); under 5 the spread was withheld.
 */
export function spreadKnownOf(round: AllocationRoundRecord): boolean {
  if (typeof round.spreadKnown === "boolean") return round.spreadKnown;
  if (round.items.some((x) => x.bands !== null)) return true;
  return round.ballots < Math.max(round.minN, VOTE_LIMITS.minNSpread);
}

/** A saved round in the kit's result shape, for its results view and Markdown. */
export function kitResultOf(round: AllocationRound): AllocationRoundResult {
  return {
    kind: "allocation",
    roundId: round.roundId,
    tool: round.tool,
    sheetId: round.tool,
    title: round.title,
    budget: round.budget,
    unit: round.unit,
    spendAll: round.spendAll,
    // The kit's Markdown prints closedAt's day, but a round's day is `date`
    // (backdated, or a local day its UTC timestamp disagrees with).
    closedAt:
      round.closedAt.slice(0, 10) === round.date ? round.closedAt : `${round.date}T12:00:00.000Z`,
    minN: round.minN,
    ballots: round.ballots,
    source: round.source === "room" ? "live" : "facilitator",
    spreadKnown: spreadKnownOf(round),
    bandEdges: round.bandEdges.length ? round.bandEdges.slice() : allocationBandEdges(round.budget),
    items: round.items.map((x) => ({
      id: x.itemId,
      text: x.text,
      ...(x.cap !== undefined ? { cap: x.cap } : {}),
      total: x.total,
      backers: x.backers,
      bands: x.bands ? x.bands.slice() : null,
    })),
  };
}

/** The sheet a saved round was split on (for the kit's results view). */
export function sheetOfRound(round: AllocationRound): AllocationSheet {
  return {
    id: round.tool,
    title: round.title,
    budget: round.budget,
    unit: round.unit,
    spendAll: round.spendAll,
    items: round.items.map((x) => ({
      id: x.itemId,
      text: x.text,
      ...(x.cap !== undefined ? { cap: x.cap } : {}),
    })),
  };
}

/** A tool's saved rounds, newest first (by day, then by close time). */
export function roundsFor(
  rounds: readonly AllocationRound[] | undefined,
  tool: AllocationRoundTool
): AllocationRound[] {
  return (rounds ?? [])
    .filter((r) => r.tool === tool)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.closedAt.localeCompare(a.closedAt) ||
        b.id.localeCompare(a.id)
    );
}

/** "20 Oct 2026" for a YYYY-MM-DD day. */
function dayText(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Why `day` can't date a saved round, in one sentence, or null when it
 * can: a real YYYY-MM-DD (paper rounds can be backdated), not after
 * `latest` (today; the server allows its tomorrow, since its day isn't the
 * user's) and, for a game whose rounds follow each other (Buy-a-Feature),
 * not before `earliest`, the last saved round's day.
 */
export function roundDayProblem(
  day: string,
  latest: string,
  earliest?: string | null
): string | null {
  if (!isIsoDate(day) || day.length !== 10) return "Pick a day.";
  if (day > latest) return "A round can't be dated in the future.";
  if (earliest && day < earliest) {
    return `A round can't be dated before the last one, on ${dayText(earliest)}.`;
  }
  return null;
}

/**
 * Why a saved round shows no spread, in one sentence, or null when it
 * shows one: "The spread shows from 5 answers; this round had 4." or that
 * the totals were typed in.
 */
export function spreadReason(round: AllocationRound): string | null {
  if (round.items.some((x) => x.bands !== null)) return null;
  if (!spreadKnownOf(round)) {
    return "The totals were typed in, so how the amounts were spread isn't known.";
  }
  const need = Math.max(round.minN, VOTE_LIMITS.minNSpread);
  return `The spread shows from ${need} answers; this round had ${round.ballots}.`;
}

export interface TeamAverage {
  itemId: string;
  text: string;
  total: number;
  /** total ÷ ballots; null with nobody. */
  mean: number | null;
  /** People who gave it more than 0; null when the spread was withheld. */
  backers: number | null;
  bands: number[] | null;
  /** "$11–$25 to $26–$50"; null when the spread was withheld. */
  middleHalf: string | null;
  /** The share of people in the item's most common band (0–1); null without bands. */
  agreement: number | null;
}

/** Each item's team average and spread, in the round's order. */
export function teamAverages(r: AllocationRound): TeamAverage[] {
  const edges = r.bandEdges.length ? r.bandEdges : allocationBandEdges(r.budget);
  return r.items.map((x) => {
    const bands = x.bands && x.bands.length === ALLOCATION_BANDS ? x.bands : null;
    return {
      itemId: x.itemId,
      text: x.text,
      total: x.total,
      mean: allocationMean(x.total, r.ballots),
      backers: bands ? x.backers : null,
      bands,
      middleHalf: bands ? middleHalfText(bands, edges, r.budget, r.unit) : null,
      agreement: bands && r.ballots > 0 ? Math.max(...bands) / r.ballots : null,
    };
  });
}

/** Band labels for a round's budget ("0", "$1–$10", …). */
export function bandLabels(r: Pick<AllocationRound, "budget" | "unit" | "bandEdges">): string[] {
  const edges = r.bandEdges.length ? r.bandEdges : allocationBandEdges(r.budget);
  return Array.from({ length: ALLOCATION_BANDS }, (_, k) => bandLabel(k, edges, r.budget, r.unit));
}

export interface SplitComparison {
  itemId: string;
  text: string;
  /** The agreed split's amount; null when none was given, or the item is gone. */
  agreed: number | null;
  /** The team's average in the round; null when the item wasn't in it. */
  mean: number | null;
  /** People who gave it something in the round; null when withheld or not in it. */
  backers: number | null;
  middleHalf: string | null;
  /** Whether the item is still in the test. */
  current: boolean;
}

/**
 * The round's items beside the agreed split: the round's items first, in
 * its order, then items added since. An item deleted since keeps its line
 * from the round, with no agreed amount.
 */
export function compareSplit(
  rows: readonly PrioritizationItem[],
  round: AllocationRound
): SplitComparison[] {
  const items = hundredRows(rows);
  const byId = new Map(items.map((x) => [x.id, x]));
  const seen = new Set<string>();
  const out: SplitComparison[] = teamAverages(round).map((t) => {
    seen.add(t.itemId);
    const row = byId.get(t.itemId);
    return {
      itemId: t.itemId,
      text: row?.title ?? t.text,
      agreed: row ? allocationOf(row) : null,
      mean: t.mean,
      backers: t.backers,
      middleHalf: t.middleHalf,
      current: Boolean(row),
    };
  });
  for (const row of items) {
    if (seen.has(row.id)) continue;
    out.push({
      itemId: row.id,
      text: row.title,
      agreed: allocationOf(row),
      mean: null,
      backers: null,
      middleHalf: null,
      current: true,
    });
  }
  return out;
}

/**
 * What the spread says about the leader: most people gave it nothing (a
 * few big amounts carried its average), the team mostly agrees on it, the
 * team is split on it, or nothing in between. Most people in the $0 band
 * is never "agreement" on an item that leads.
 */
function agreementClause(a: TeamAverage, ballots: number): string {
  if (!a.bands || ballots <= 0) return "";
  if (a.bands[0] / ballots > 0.5) return ", but most people gave it nothing";
  if (a.agreement === null) return "";
  if (a.agreement >= AGREE_SHARE) return ", and the team mostly agrees on it";
  if (a.agreement <= SPLIT_SHARE) return ", but the team is split on it";
  return "";
}

/**
 * The one-sentence answer above the list. With a saved team round, what
 * the team gave most to on average (only the count of people, never who);
 * without one, where the agreed split stands.
 */
export function hundredDollarVerdict(
  rows: readonly PrioritizationItem[],
  latest?: AllocationRound | null
): string {
  const items = hundredRows(rows);
  if (latest && latest.ballots > 0 && latest.items.length > 0) {
    const avgs = teamAverages(latest);
    const top = Math.max(...avgs.map((a) => a.mean ?? 0));
    const leaders = avgs.filter((a) => (a.mean ?? 0) === top);
    const head = `${latest.ballots} ${latest.ballots === 1 ? "person" : "people"} split ${allocationAmount(latest.budget, latest.unit)} each`;
    const money = allocationAmount(top, latest.unit);
    if (leaders.length === 1) {
      return `${head}: ${leaders[0].text} leads with ${money} on average${agreementClause(leaders[0], latest.ballots)}.`;
    }
    return `${head}: ${listAnd(leaders.map((a) => a.text))} lead with ${money} each on average.`;
  }
  if (items.length === 0) return "No items yet.";
  const split = splitSummary(items);
  if (split.total === 0) {
    return items.length < 2
      ? "Add another item, then split the $100 between them."
      : `Split the $100 across the ${items.length} items, or ask the team in a round.`;
  }
  if (split.remaining < -0.005) {
    return `The split is ${dollars(-split.remaining)} over the $100: lower an item.`;
  }
  if (!split.full) return `${dollars(split.remaining)} of the $100 is still to give out.`;
  const top = Math.max(...items.map((x) => allocationOf(x) ?? 0));
  const leaders = items.filter((x) => (allocationOf(x) ?? 0) === top).map((x) => x.title);
  return leaders.length === 1
    ? `Agreed split: ${leaders[0]} leads with ${dollars(top)}.`
    : `Agreed split: ${listAnd(leaders)} lead with ${dollars(top)} each.`;
}
