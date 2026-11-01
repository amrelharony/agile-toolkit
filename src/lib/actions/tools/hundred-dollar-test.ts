/**
 * $100 Test — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     cumulative voting: split $100 across competing items. One
 *           agreed split (the group's, or one person's) on the items, plus
 *           anonymous team rounds where everyone splits their own $100 and
 *           only the aggregates are kept.
 *
 * Agent surface: tool.hundred_dollar_test.*
 * Backing CRUD : workspace.prioritization.* (rows with framework
 *                "hundred-dollar": fields.allocation, the agreed split) and
 *                workspace.allocation_round.* (saved rounds, totals only).
 *
 *   1. list_state      — items with the agreed split, its total and what's
 *                        left, saved rounds with each item's team average
 *                        and spread, the latest round beside the split.
 *   2. add_item        — an item to split between.
 *   3. set_allocation  — an item's amount in the agreed split, capped like
 *                        the page (whole dollars, never past $100 in all).
 *   4. record_round    — a team round from paper: each person's split, or
 *                        each item's total and how many people.
 *   5. remove_round    — delete one saved round.
 *
 * Every number comes from lib/hundred-dollar/allocation, the code the page
 * uses, and rounds are folded by the vote-room kit's own counting
 * (addAllocation / foldAllocationTotals): totals and averages from 3
 * people, who backed what and the spread bands from 5. Splits passed in
 * are folded and dropped: nothing per person is stored.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverDeleteEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  ALLOCATION_ROUND_KIND,
  type AllocationRound,
  type PrioritizationItem,
} from "@/lib/stores/workspace-types";
import {
  addAllocation,
  emptyAllocationTally,
  foldAllocationTotals,
  revealAllocation,
  toAllocationResult,
  type AllocationTally,
} from "@/lib/realtime/vote-room/allocation";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";
import {
  HUNDRED,
  HUNDRED_FRAMEWORK,
  ITEM_TITLE_MAX,
  allocationOf,
  allocationRoundFrom,
  capAllocation,
  compareSplit,
  hundredDollarSheet,
  hundredDollarVerdict,
  hundredRows,
  roundDayProblem,
  roundsFor,
  splitSummary,
  spreadKnownOf,
  spreadReason,
  teamAverages,
  withAllocation,
} from "@/lib/hundred-dollar/allocation";

const KIND_PRIORITIZATION = "workspace:prioritization";

const ws = () => useWorkspaceStore.getState();

/** Where the test lives: the browser's workspace, or the user's rows on the server. */
interface TestStore {
  rows(): Promise<PrioritizationItem[]>;
  rounds(): Promise<AllocationRound[]>;
  putRow(row: PrioritizationItem): Promise<void>;
  putRound(round: AllocationRound): Promise<void>;
  removeRound(id: string): Promise<void>;
}

const browserStore: TestStore = {
  rows: async () => hundredRows(ws().prioritizations),
  rounds: async () => ws().allocationRounds ?? [],
  putRow: async (row) => ws().upsertPrioritization(row),
  putRound: async (round) => ws().upsertAllocationRound(round),
  removeRound: async (id) => ws().removeAllocationRound(id),
};

function serverStore(userId: string): TestStore {
  return {
    rows: async () =>
      hundredRows(await serverListEntities<PrioritizationItem>(userId, KIND_PRIORITIZATION)),
    rounds: () => serverListEntities<AllocationRound>(userId, ALLOCATION_ROUND_KIND),
    putRow: (row) => serverUpsertEntity(userId, KIND_PRIORITIZATION, row),
    putRound: (round) => serverUpsertEntity(userId, ALLOCATION_ROUND_KIND, round),
    removeRound: (id) => serverDeleteEntity(userId, ALLOCATION_ROUND_KIND, id),
  };
}

/* ── list_state ─────────────────────────────────────────────────────── */

function roundOut(r: AllocationRound) {
  return {
    id: r.id,
    title: r.title,
    date: r.date,
    ballots: r.ballots,
    source: r.source,
    spreadKnown: spreadKnownOf(r),
    spreadNote: spreadReason(r),
    items: teamAverages(r).map((t) => ({
      itemId: t.itemId,
      text: t.text,
      total: t.total,
      average: t.mean,
      backers: t.backers,
      bands: t.bands,
      middleHalf: t.middleHalf,
    })),
  };
}

async function summarize(store: TestStore) {
  const [rows, allRounds] = await Promise.all([store.rows(), store.rounds()]);
  const rounds = roundsFor(allRounds, "hundred-dollar-test");
  const latest = rounds[0] ?? null;
  const split = splitSummary(rows);
  return {
    items: rows.map((r) => ({ id: r.id, title: r.title, allocation: allocationOf(r) })),
    split: {
      total: split.total,
      remaining: split.remaining,
      full: split.full,
      given: split.given,
    },
    canRunRound: hundredDollarSheet(rows) !== null,
    rounds: rounds.map(roundOut),
    latestBesideSplit: latest
      ? compareSplit(rows, latest).map((c) => ({
          itemId: c.itemId,
          text: c.text,
          agreed: c.agreed,
          teamAverage: c.mean,
          backers: c.backers,
          current: c.current,
        }))
      : null,
    verdict: hundredDollarVerdict(rows, latest),
  };
}

registry.register({
  id: "tool.hundred_dollar_test.list_state",
  toolId: "tool.hundred_dollar_test",
  name: "list_state",
  category: "read",
  description:
    "Summarise the $100 Test as the page shows it. Returns {items: {id, title, allocation|null (the agreed split's whole dollars; null = none given yet, not $0)}[], split: {total, remaining (100 − total; negative only for a legacy split over $100), full, given (items with an amount)}, canRunRound (2+ items), rounds: {id, title, date, ballots, source: room|facilitator, spreadKnown, spreadNote|null, items: {itemId, text, total, average (total ÷ ballots), backers|null, bands|null (people per band: $0, $1–10, $11–25, $26–50, $51–100), middleHalf|null}[]}[] newest first (backers and bands only from 5 people, never for typed totals), latestBesideSplit: {itemId, text, agreed|null, teamAverage|null, backers|null, current}[] | null, verdict}. Rounds hold totals only, never anyone's split or who answered.",
  paramsSchema: z.object({}),
  handler: () => summarize(browserStore),
  mcpHandler: (_params, ctx) => summarize(serverStore(ctx.userId)),
});

/* ── add_item ───────────────────────────────────────────────────────── */

async function addItem(store: TestStore, title: string) {
  const row: PrioritizationItem = {
    id: `prio_${nanoid(8)}`,
    framework: HUNDRED_FRAMEWORK,
    title: title.trim().slice(0, ITEM_TITLE_MAX),
    fields: {},
    status: "open",
    updatedAt: new Date().toISOString(),
  };
  await store.putRow(row);
  return { added: true, id: row.id, title: row.title };
}

registry.register({
  id: "tool.hundred_dollar_test.add_item",
  toolId: "tool.hundred_dollar_test",
  name: "add_item",
  category: "write",
  requiresConfirmation: false,
  description: `Add an item to split the $100 between, with no amount yet. Params: {title (≤${ITEM_TITLE_MAX})}. Returns {added: true, id, title}.`,
  paramsSchema: z.object({ title: z.string().trim().min(1).max(ITEM_TITLE_MAX) }),
  handler: (params) => addItem(browserStore, params.title),
  mcpHandler: (params, ctx) => addItem(serverStore(ctx.userId), params.title),
});

/* ── set_allocation ─────────────────────────────────────────────────── */

async function setAllocation(store: TestStore, id: string, amount: number) {
  const rows = await store.rows();
  const row = rows.find((r) => r.id === id);
  if (!row) return { set: false, reason: `No $100 Test item with id "${id}".` };
  const { saved, note } = capAllocation(rows, id, amount);
  if (allocationOf(row) !== saved) {
    await store.putRow(withAllocation(row, saved, new Date().toISOString()));
  }
  const after = rows.map((r) => (r.id === id ? withAllocation(r, saved, r.updatedAt) : r));
  return { set: true, saved, note, remaining: splitSummary(after).remaining };
}

registry.register({
  id: "tool.hundred_dollar_test.set_allocation",
  toolId: "tool.hundred_dollar_test",
  name: "set_allocation",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set an item's amount in the agreed split. Params: {id, amount (whole dollars, 0..100)}. Capped like the page: never more than the money the other items leave, so the split never passes $100. Returns {set: true, saved (what was stored), note|null (why it differs from amount), remaining} or {set: false, reason}.",
  paramsSchema: z.object({
    id: z.string().min(1),
    amount: z.number().int().min(0).max(HUNDRED),
  }),
  handler: (params) => setAllocation(browserStore, params.id, params.amount),
  mcpHandler: (params, ctx) => setAllocation(serverStore(ctx.userId), params.id, params.amount),
});

/* ── record_round ───────────────────────────────────────────────────── */

const amounts = z.record(z.string(), z.number().int().min(0).max(HUNDRED));

const recordRoundParams = z.object({
  splits: z
    .array(amounts)
    .max(VOTE_LIMITS.maxTallyBallots)
    .optional()
    .describe(
      "One object per person: item id -> whole dollars, each adding up to exactly $100 (a missing item is $0). Folded into totals and dropped: nothing per person is kept."
    ),
  totals: z
    .record(z.string(), z.number().int().min(0))
    .optional()
    .describe("Instead of splits: item id -> what everyone gave it in all. Needs `people`."),
  people: z
    .number()
    .int()
    .min(1)
    .max(VOTE_LIMITS.maxTallyBallots)
    .optional()
    .describe("With totals: how many people split $100 each."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "YYYY-MM-DD the round was held (backdate; not in the future). Default today; pass the user's local date."
    ),
});

async function recordRound(
  store: TestStore,
  params: z.infer<typeof recordRoundParams>,
  onServer: boolean
) {
  const rows = await store.rows();
  const sheet = hundredDollarSheet(rows);
  if (!sheet) return { saved: false, reason: "Add at least two items first." };
  const hasSplits = params.splits !== undefined;
  const hasTotals = params.totals !== undefined;
  if (hasSplits === hasTotals) {
    return { saved: false, reason: "Pass either splits, or totals with people." };
  }
  const today = todayLocalISO();
  // The server's day (UTC on a typical deploy) isn't the user's: allow the day after it.
  const latest = onServer ? addDays(today, 1) : today;
  const date = params.date ?? today;
  const dayProblem = roundDayProblem(date, latest);
  if (dayProblem) return { saved: false, reason: dayProblem };
  const ids = new Set(sheet.items.map((x) => x.id));
  const keys = [
    ...(params.splits ?? []).flatMap((s) => Object.keys(s)),
    ...Object.keys(params.totals ?? {}),
  ];
  const unknown = Array.from(new Set(keys.filter((k) => !ids.has(k))));
  if (unknown.length > 0) return { saved: false, reason: `Unknown items: ${unknown.join(", ")}.` };
  const minN = MIN_SAMPLE.anonymous;

  let tally: AllocationTally | null = emptyAllocationTally("agent", sheet);
  let ballots: number;
  if (params.splits) {
    ballots = params.splits.length;
    for (let i = 0; i < params.splits.length && tally; i++) {
      const split = sheet.items.map((x) => params.splits?.[i][x.id] ?? 0);
      const next = addAllocation(tally, split, sheet);
      if (!next) {
        const sum = split.reduce((a, b) => a + b, 0);
        return {
          saved: false,
          reason: `Split ${i + 1} gives $${sum}: each person gives out exactly $${HUNDRED}.`,
        };
      }
      tally = next;
    }
  } else {
    ballots = params.people ?? 0;
    if (ballots < 1) return { saved: false, reason: "Pass people with totals." };
    tally = foldAllocationTotals(
      tally,
      sheet.items.map((x) => params.totals?.[x.id] ?? 0),
      ballots,
      sheet
    );
    if (!tally) {
      return {
        saved: false,
        reason: `Totals from ${ballots} people add up to exactly ${ballots} × $${HUNDRED}, with no item over ${ballots} × $${HUNDRED}.`,
      };
    }
  }
  if (!tally || ballots < minN) {
    return { saved: false, reason: `A round needs ${minN} people, so no one's split shows.` };
  }
  const revealed = revealAllocation(tally, minN);
  const result = revealed
    ? toAllocationResult(sheet, revealed, {
        tool: "hundred-dollar-test",
        roundId: `tally-${Date.now().toString(36)}`,
        closedAt: new Date().toISOString(),
        minN,
        ballots,
        source: "facilitator",
        spreadKnown: tally.spreadKnown,
      })
    : null;
  if (!result) return { saved: false, reason: `A round needs ${minN} people.` };
  const round = allocationRoundFrom(result, { id: `allocationRound_${nanoid(8)}`, date });
  await store.putRound(round);
  return { saved: true, ...roundOut(round), verdict: hundredDollarVerdict(rows, round) };
}

registry.register({
  id: "tool.hundred_dollar_test.record_round",
  toolId: "tool.hundred_dollar_test",
  name: "record_round",
  category: "write",
  requiresConfirmation: false,
  description: `Save a team round counted on paper, over every current item ($100 each, given out in full). Params: {splits?: {itemId: dollars}[] (one per person, each exactly $100), or totals?: {itemId: dollars} with people? (how many split), date? (YYYY-MM-DD, backdatable)}. At least ${MIN_SAMPLE.anonymous} people. Splits are folded and dropped; only per-item totals are kept, plus who backed what and the spread bands from ${VOTE_LIMITS.minNSpread} splits (typed totals never show a spread). Returns {saved: true, id, title, date, ballots, source, spreadKnown, spreadNote, items, verdict} or {saved: false, reason}.`,
  paramsSchema: recordRoundParams,
  handler: (params) => recordRound(browserStore, params, false),
  mcpHandler: (params, ctx) => recordRound(serverStore(ctx.userId), params, true),
});

/* ── remove_round ───────────────────────────────────────────────────── */

async function removeRound(store: TestStore, id: string) {
  const round = roundsFor(await store.rounds(), "hundred-dollar-test").find((r) => r.id === id);
  if (!round) return { removed: false, reason: `No $100 Test round with id "${id}".` };
  await store.removeRound(id);
  return { removed: true };
}

registry.register({
  id: "tool.hundred_dollar_test.remove_round",
  toolId: "tool.hundred_dollar_test",
  name: "remove_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Delete one saved team round by id (the page offers Undo; an agent's delete is final, so confirm with the user first). Returns {removed: true} or {removed: false, reason}.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: (params) => removeRound(browserStore, params.id),
  mcpHandler: (params, ctx) => removeRound(serverStore(ctx.userId), params.id),
});
