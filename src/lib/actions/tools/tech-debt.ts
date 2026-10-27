/**
 * Tech Debt Tracker — tool-local actions.
 *
 * Category: Risk & Governance
 * Tool:     Debt inventory, ranked by impact, effort and interest per sprint
 *
 * Agent surface: tool.tech_debt.*
 *   1. compute_priority — pure: the page's score for a hypothetical item.
 *   2. list_state       — the items as the page lists them: age in sprints,
 *                         score, the backlog story each was sent to, the
 *                         verdict and the per-area numbers.
 *   3. mark_resolved    — resolve on a day (backdated, never future).
 *   4. add_tag          — idempotent append to tags[].
 *   5. set_area         — the grouping field behind the hotspot.
 *   6. delete           — remove an item (final for an agent).
 *   7. add_to_backlog   — put an open item on the backlog as a story and
 *                         link it, as the page's "Add to backlog" does.
 * Backing CRUD: workspace.tech_debt.* (defineCrudActions in
 * workspace/index.ts; every write there stamps updatedAt too, an update
 * merges into the item as listed here, and a delete of a row still in the
 * old blob is refused with 'pending_move' as below).
 *
 * One store: workspace.techDebt since Phase 8. Every number comes from
 * lib/tech-debt/model, the page's own reading:
 *
 *     score = impact × 4 − effort + min(INTEREST_CAP, interestRate × ageSprints)
 *
 * with the age in whole sprints of the team's cadence (calendar days ÷
 * sprintLengthDays, 14 when unset) and the interest term capped at 10, so
 * an old trivial item never outranks a fresh critical one. Reads include
 * the old Tech Debt blob's rows still waiting for the page's one-time move
 * (lib/tech-debt/legacy, from this browser's storage or the user's
 * user_state rows on the server); a write on such a row saves the merged
 * row into the workspace, and a delete of one is refused ('pending_move'):
 * only the page can mark it moved.
 *
 * Every write stamps `updatedAt`. Days are the user's local "YYYY-MM-DD";
 * over MCP the day after the server's is accepted too (the server's day
 * may be behind the user's).
 *
 * Entity kind: "workspace:techDebt" (camelCase), matching the browser sync
 * engine's collection and the CRUD.
 */

import { z } from "zod";
import { registry } from "../registry";
import type { ActionContext } from "../context";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverDeleteEntity,
  serverGetEntity,
  serverGetUserStateBlob,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import {
  CEREMONY_CADENCE_ID,
  type CeremonyCadenceDoc,
  type HandoffLink,
  type Story,
  type TechDebtItem,
} from "@/lib/stores/workspace-types";
import { normalizeCadence } from "@/lib/sprints/cadence";
import { isIsoDate } from "@/lib/sprints/calendar";
import {
  INTEREST_CAP,
  INTEREST_RATE_MAX,
  UNASSIGNED_AREA,
  debtScale,
  debtScore,
  debtStoryOf,
  debtSummary,
  debtTimeToResolve,
  debtVerdict,
  isOpenDebt,
  rankedDebt,
  type RankedDebt,
} from "@/lib/tech-debt/model";
import {
  TECH_DEBT_KEY,
  TECH_DEBT_MOVED_KEY,
  isPendingTechDebtRow,
  withPendingTechDebt,
} from "@/lib/tech-debt/legacy";
import { buildBacklogStory } from "@/lib/handoffs/targets/backlog-story";
import { addDays } from "@/lib/impediments/model";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";

/** MUST match registerCollection("techDebt", "techDebt") in workspace-store.ts and the CRUD's kind. */
export const KIND_TECH_DEBT = "workspace:techDebt";
const KIND_STORY = "workspace:story";
const KIND_CADENCE = "workspace:ceremonyCadence";

const ws = () => useWorkspaceStore.getState();

/* ── The store adapter ───────────────────────────────────────────────── */

export interface TechDebtRecords {
  /** Every item as the page lists it. */
  records: TechDebtItem[];
  /** Ids of rows of the old Tech Debt blob still waiting for the page's move. */
  pendingIds: string[];
}

/** Where the items live: the browser's workspace, or the user's rows on the server. */
export interface TechDebtStore {
  onServer: boolean;
  list(): Promise<TechDebtRecords>;
  /** Save an item under its id (already stamped). */
  put(t: TechDebtItem): Promise<void>;
  remove(id: string): Promise<void>;
  stories(): Promise<Story[]>;
  putStory(s: Story): Promise<void>;
  /** The team's sprint length in days (the cadence's; 14 when unset). */
  sprintLengthDays(): Promise<number>;
}

const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

/** The items as the page reads them: the workspace's and the old blob's pending rows. */
function recordsFrom(
  items: readonly TechDebtItem[] | undefined,
  blob: unknown,
  movedRaw: unknown
): TechDebtRecords {
  const moved = idsOf(movedRaw);
  const records = withPendingTechDebt(items ?? [], blob, moved);
  return {
    records,
    pendingIds: records.filter((t) => isPendingTechDebtRow(t.id, blob, moved)).map((t) => t.id),
  };
}

/** A usePersisted blob as this browser holds it (it mirrors the cloud row), or null. */
function browserBlob(key: string): unknown {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const browserTechDebtStore: TechDebtStore = {
  onServer: false,
  list: async () =>
    recordsFrom(ws().techDebt, browserBlob(TECH_DEBT_KEY), browserBlob(TECH_DEBT_MOVED_KEY)),
  put: async (t) => ws().upsertTechDebt(t),
  // The store's remove unpins canvas cards, as the page's delete does.
  remove: async (id) => {
    if ((ws().techDebt ?? []).some((t) => t.id === id)) ws().removeTechDebt(id);
  },
  stories: async () => ws().stories ?? [],
  putStory: async (s) => ws().upsertStory(s),
  sprintLengthDays: async () =>
    normalizeCadence((ws().ceremonyCadences ?? []).find((d) => d.id === CEREMONY_CADENCE_ID))
      .sprintLengthDays,
};

export function serverTechDebtStore(userId: string): TechDebtStore {
  return {
    onServer: true,
    list: async () => {
      const [items, blob, moved] = await Promise.all([
        serverListEntities<TechDebtItem>(userId, KIND_TECH_DEBT),
        serverGetUserStateBlob(userId, TECH_DEBT_KEY),
        serverGetUserStateBlob(userId, TECH_DEBT_MOVED_KEY),
      ]);
      return recordsFrom(items, blob, moved);
    },
    put: async (t) => {
      await serverUpsertEntity<TechDebtItem>(userId, KIND_TECH_DEBT, t);
    },
    remove: async (id) => {
      await serverDeleteEntity(userId, KIND_TECH_DEBT, id);
    },
    stories: async () => serverListEntities<Story>(userId, KIND_STORY),
    putStory: async (s) => {
      await serverUpsertEntity<Story>(userId, KIND_STORY, s);
    },
    sprintLengthDays: async () =>
      normalizeCadence(
        await serverGetEntity<CeremonyCadenceDoc>(userId, KIND_CADENCE, CEREMONY_CADENCE_ID)
      ).sprintLengthDays,
  };
}

/** The item as saved by a verb: stamped, so the move reads the workspace's copy as the newer one. */
const stamped = (t: TechDebtItem): TechDebtItem => ({ ...t, updatedAt: new Date().toISOString() });

type Out = Record<string, unknown>;

/**
 * Change one item with `fn` (given the item as the page lists it, a
 * pending blob row with its fields folded in): `{next, result}` saves
 * `next` stamped, `{result}` alone writes nothing. Unknown ids answer
 * `missing`.
 */
async function changeItem(
  store: TechDebtStore,
  id: string,
  missing: Out,
  fn: (t: TechDebtItem) => { next: TechDebtItem; result: Out } | { result: Out }
): Promise<Out> {
  const { records } = await store.list();
  const current = records.find((t) => t.id === id);
  if (!current) return missing;
  const out = fn(current);
  if ("next" in out) await store.put(stamped(out.next));
  return out.result;
}

/** The latest day a verb takes: today in the browser, the day after the server's on the server. */
const latestDay = (today: string, onServer: boolean): string =>
  onServer ? addDays(today, 1) : today;

/* ── Rank tiers ──────────────────────────────────────────────────────── */

/**
 * Tiers on the page's score (−1 to 29: a base of −1 to 19 plus up to
 * INTEREST_CAP of interest): must_fix from 16 (an impact-4 item that is
 * cheap, or one that has piled up interest), should_fix from 8, else defer.
 */
function rankTier(total: number): "must_fix" | "should_fix" | "defer" {
  if (total >= 16) return "must_fix";
  if (total >= 8) return "should_fix";
  return "defer";
}

const FORMULA = `impact × 4 − effort + min(${INTEREST_CAP}, interestRate × ageSprints)`;

/* ── tool.tech_debt.compute_priority ─────────────────────────────────── */

const ScaleSchema = z.number().int().min(1).max(5);

registry.register({
  id: "tool.tech_debt.compute_priority",
  toolId: "tool.tech_debt",
  name: "compute_priority",
  category: "read",
  description: `Compute the Tech Debt page's score and a rank tier (must_fix ≥ 16 | should_fix ≥ 8 | defer) for a hypothetical item. Pure — no persistence. Formula: ${FORMULA}, impact and effort 1–5, interestRate the score points it gains per sprint left unpaid (default 0), ageSprints its age in whole sprints (default 0); the interest term is capped at ${INTEREST_CAP}, so the score runs from −1 to 29. list_state ranks real items the same way. Returns {priority (the total), score: {base, interest, capped, total}, rank_tier, formula}.`,
  paramsSchema: z.object({
    impact: ScaleSchema.describe("How much it slows the team, 1–5"),
    effort: ScaleSchema.describe("How much work paying it down is, 1–5"),
    interestRate: z
      .number()
      .min(0)
      .max(INTEREST_RATE_MAX)
      .optional()
      .describe("Score points it gains per sprint left unpaid; defaults to 0"),
    ageSprints: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Its age in whole sprints; defaults to 0 (raised this sprint)"),
  }),
  handler: async (params) => {
    const score = debtScore(params, params.ageSprints ?? 0);
    return { priority: score.total, score, rank_tier: rankTier(score.total), formula: FORMULA };
  },
  // No mcpHandler — pure compute is identical server and client.
});

/* ── tool.tech_debt.list_state ───────────────────────────────────────── */

/** One item as list_state returns it: the stored fields plus what the page shows. */
function itemView(r: RankedDebt, stories: readonly Story[], pendingIds: readonly string[]) {
  const story = debtStoryOf(r.item, stories);
  return {
    ...r.item,
    ageDays: r.ageDays,
    ageSprints: r.ageSprints,
    score: r.score,
    rank_tier: rankTier(r.score.total),
    open: isOpenDebt(r.item),
    inBacklog: story?.storyId ?? null,
    storyDone: story?.done ?? false,
    example: isExampleId(r.item.id),
    pending: pendingIds.includes(r.item.id),
  };
}

async function listState(store: TechDebtStore, params: { today?: string }) {
  const today = params.today ?? todayLocalISO();
  const [{ records, pendingIds }, stories, sprintLengthDays] = await Promise.all([
    store.list(),
    store.stories(),
    store.sprintLengthDays(),
  ]);
  // The keys from before Phase 8 keep their meaning: every listed item.
  const byArea: Record<string, number> = {};
  let totalImpact = 0;
  let totalEffort = 0;
  let openCount = 0;
  let resolvedCount = 0;
  for (const t of records) {
    totalImpact += debtScale(t.impact);
    totalEffort += debtScale(t.effort);
    if (isOpenDebt(t)) openCount += 1;
    else resolvedCount += 1;
    const area = t.area?.trim() || UNASSIGNED_AREA;
    byArea[area] = (byArea[area] ?? 0) + 1;
  }
  const s = debtSummary(records, sprintLengthDays, today, stories);
  return {
    today,
    sprintLengthDays,
    totalImpact,
    totalEffort,
    openCount,
    resolvedCount,
    byArea,
    items: rankedDebt(records, sprintLengthDays, today).map((r) =>
      itemView(r, stories, pendingIds)
    ),
    openByArea: s.openByArea,
    hotspot: s.hotspot,
    interestPerSprint: s.interestPerSprint,
    unestimated: s.unestimated,
    oldestSprints: s.oldestSprints,
    inBacklog: s.inBacklog,
    verdict: debtVerdict(records, sprintLengthDays, today),
    timeToResolve: debtTimeToResolve(
      records.filter((t) => !isExampleId(t.id)),
      today
    ),
    pending: pendingIds.length,
    examples: records.filter((t) => isExampleId(t.id)).length,
  };
}

const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "Expected a YYYY-MM-DD day")
  .describe(
    "YYYY-MM-DD, the user's local day (a timestamp is read as its date). Pass the user's date: over MCP the server's day may be a day behind theirs, so the day after the server's is taken too."
  );

registry.register({
  id: "tool.tech_debt.list_state",
  toolId: "tool.tech_debt",
  name: "list_state",
  category: "read",
  description: `List the tech-debt items as the Tech Debt page ranks them: open before resolved, then score, then age, then title, including rows of the old page not moved in yet. Score: ${FORMULA} (interest capped at ${INTEREST_CAP}), age in whole sprints of the cadence. Params: today? (YYYY-MM-DD; default today). Returns {today, sprintLengthDays (the cadence's; 14 when unset), totalImpact, totalEffort, openCount, resolvedCount, byArea: Record<area, count> (these count every item, examples included; no area: '__unassigned'), items: TechDebtItem & {ageDays | null, ageSprints | null, score: {base, interest, capped, total}, rank_tier, open, inBacklog: storyId | null (its backlog story, while it exists), storyDone, example, pending}, openByArea, hotspot: {area, impact} | null (most impact points of open debt), interestPerSprint (open, estimated items), unestimated, oldestSprints | null, inBacklog (open items with a live story), verdict, timeToResolve: {resolved, medianDays | null} (the page's 'how long debt takes to pay down': the Kaplan-Meier median of days raised → resolved, open items counted as still waiting; null below 5 paid-down items or while fewer than half are), pending (old rows not moved yet), examples} — the keys after items leave example rows out.`,
  paramsSchema: z.object({ today: DaySchema.optional() }),
  handler: async (params) => listState(browserTechDebtStore, params),
  mcpHandler: async (params, ctx) => listState(serverTechDebtStore(ctx.userId), params),
});

/* ── tool.tech_debt.mark_resolved ────────────────────────────────────── */

const MarkResolvedSchema = z.object({
  id: z.string(),
  resolvedAt: DaySchema.optional().describe(
    "The day it was paid down (default today; never in the future, never before it was raised; a timestamp is read as its date)"
  ),
});

async function markResolved(
  store: TechDebtStore,
  p: z.infer<typeof MarkResolvedSchema>
): Promise<Out> {
  const today = todayLocalISO();
  const latest = latestDay(today, store.onServer);
  const day = (p.resolvedAt ?? "").slice(0, 10);
  if (p.resolvedAt !== undefined && !isIsoDate(day)) return { updated: false, reason: "not_a_day" };
  if (p.resolvedAt !== undefined && day > latest) return { updated: false, reason: "future_day" };
  return changeItem(store, p.id, { updated: false, reason: "not_found" }, (t) => {
    const raised = (t.raisedAt ?? "").slice(0, 10);
    const known = isIsoDate(raised);
    if (p.resolvedAt !== undefined && known && day < raised) {
      return { result: { updated: false, reason: "before_raised" } };
    }
    // No day given: today, or the day it was raised when the server's
    // today is behind it.
    const resolvedAt =
      p.resolvedAt !== undefined
        ? day
        : known && raised > today && raised <= latest
          ? raised
          : today;
    return { next: { ...t, resolvedAt }, result: { updated: true, resolvedAt } };
  });
}

registry.register({
  id: "tool.tech_debt.mark_resolved",
  toolId: "tool.tech_debt",
  name: "mark_resolved",
  category: "write",
  requiresConfirmation: true,
  description:
    "Mark a tech-debt item resolved (paid down) on a day: resolvedAt YYYY-MM-DD, default today; backdate it, never in the future, never before it was raised (a timestamp is read as its date). An item already resolved is re-dated. Its age in sprints stops at that day. Returns {updated: true, resolvedAt} or {updated: false, reason: 'not_found' | 'not_a_day' | 'future_day' | 'before_raised'}. Reopen it on the page (Undo) or with workspace.tech_debt.update {id, patch: {resolvedAt: \"\"}} (an empty resolvedAt reads as open).",
  paramsSchema: MarkResolvedSchema,
  handler: async (params) => markResolved(browserTechDebtStore, params),
  mcpHandler: async (params, ctx) => markResolved(serverTechDebtStore(ctx.userId), params),
});

/* ── tool.tech_debt.add_tag ──────────────────────────────────────────── */

const AddTagSchema = z.object({
  id: z.string(),
  tag: z.string().min(1).max(80),
});

const addTag = (store: TechDebtStore, p: z.infer<typeof AddTagSchema>) =>
  changeItem(store, p.id, { added: false }, (t) => {
    const existing = t.tags ?? [];
    if (existing.includes(p.tag)) return { result: { added: false } };
    return { next: { ...t, tags: [...existing, p.tag] }, result: { added: true } };
  });

registry.register({
  id: "tool.tech_debt.add_tag",
  toolId: "tool.tech_debt",
  name: "add_tag",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append a tag to an existing tech-debt item's tags[]. Idempotent — skips if the tag is already present. Returns {added: false} when the id is unknown OR the tag was already there.",
  paramsSchema: AddTagSchema,
  handler: async (params) => addTag(browserTechDebtStore, params),
  mcpHandler: async (params, ctx) => addTag(serverTechDebtStore(ctx.userId), params),
});

/* ── tool.tech_debt.set_area ─────────────────────────────────────────── */

const SetAreaSchema = z.object({
  id: z.string(),
  area: z.string().min(1).max(120),
});

const setArea = (store: TechDebtStore, p: z.infer<typeof SetAreaSchema>) =>
  changeItem(store, p.id, { updated: false }, (t) => ({
    next: { ...t, area: p.area },
    result: { updated: true },
  }));

registry.register({
  id: "tool.tech_debt.set_area",
  toolId: "tool.tech_debt",
  name: "set_area",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the area field on an existing tech-debt item (the hotspot groups open debt by it). Overwrites the previous value (this is a categorisation move, not an append). Returns {updated: false} when the id is unknown.",
  paramsSchema: SetAreaSchema,
  handler: async (params) => setArea(browserTechDebtStore, params),
  mcpHandler: async (params, ctx) => setArea(serverTechDebtStore(ctx.userId), params),
});

/* ── tool.tech_debt.delete ───────────────────────────────────────────── */

/**
 * Delete an item as the page does (canvas cards pinned to it are
 * unpinned). A row of the old Tech Debt page still waiting for the page's
 * move is refused: only the page can mark it moved, or the move would
 * bring it back. A backlog story made from it stays (its link back reads
 * as gone).
 */
async function deleteItem(store: TechDebtStore, id: string, ctx: ActionContext): Promise<Out> {
  const { records, pendingIds } = await store.list();
  const t = records.find((x) => x.id === id);
  if (!t) return { deleted: false, reason: "not_found" };
  if (pendingIds.includes(id)) {
    return {
      deleted: false,
      reason: "pending_move",
      message:
        "This item is still moving in from the old Tech Debt page: open Tech Debt once, then delete it (or delete it there).",
    };
  }
  if (ctx.confirm) {
    const ok = await ctx.confirm(
      `Delete tech-debt item "${t.title || t.id}"? An agent's delete can't be undone.`
    );
    if (!ok) return { deleted: false, confirmed: false };
  }
  await store.remove(id);
  return { deleted: true, id, title: t.title };
}

registry.register({
  id: "tool.tech_debt.delete",
  toolId: "tool.tech_debt",
  name: "delete",
  category: "write",
  requiresConfirmation: true,
  description:
    "Delete a tech-debt item, as the page's delete does (canvas cards pinned to it are unpinned; a backlog story made from it stays). Final for an agent (the page offers Undo): confirm with the user first. Params: id. Returns {deleted: true, id, title} or {deleted: false, reason: 'not_found' | 'pending_move', message?} or {deleted: false, confirmed: false}. 'pending_move': a row of the old Tech Debt page not moved in yet; open Tech Debt once, then delete it.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params, ctx) => deleteItem(browserTechDebtStore, params.id, ctx),
  mcpHandler: async (params, ctx) => deleteItem(serverTechDebtStore(ctx.userId), params.id, ctx),
});

/* ── tool.tech_debt.add_to_backlog ───────────────────────────────────── */

/**
 * Put an open item on the backlog, as the page's "Add to backlog" does: a
 * backlog story with the item's title and a link back (sourceRef
 * tech-debt), unestimated (effort 1–5 isn't story points: Planning Poker's
 * nudge picks it up), and the link recorded on the item (sentTo). A second
 * send while that story exists is refused.
 */
async function addToBacklog(store: TechDebtStore, id: string): Promise<Out> {
  const [{ records }, stories] = await Promise.all([store.list(), store.stories()]);
  const t = records.find((x) => x.id === id);
  if (!t) return { sent: false, reason: "not_found" };
  if (isExampleId(t.id)) return { sent: false, reason: "example" };
  if (!isOpenDebt(t)) return { sent: false, reason: "resolved" };
  if (!t.title.trim()) return { sent: false, reason: "untitled" };
  const live = debtStoryOf(t, stories);
  if (live) return { sent: false, reason: "already_sent", storyId: live.storyId };
  const story = buildBacklogStory({ title: t.title, sourceRef: { tool: "tech-debt", id: t.id } });
  await store.putStory(story);
  const link: HandoffLink = {
    route: "backlog-story",
    targetId: story.id,
    at: new Date().toISOString(),
  };
  // A dead link on the route (its story deleted) is replaced.
  const sentTo = [...(t.sentTo ?? []).filter((l) => l.route !== "backlog-story"), link];
  await store.put(stamped({ ...t, sentTo }));
  return { sent: true, storyId: story.id };
}

registry.register({
  id: "tool.tech_debt.add_to_backlog",
  toolId: "tool.tech_debt",
  name: "add_to_backlog",
  category: "write",
  requiresConfirmation: false,
  description:
    "Put an open tech-debt item on the backlog, as the page's 'Add to backlog' does: a backlog story with its title, unestimated (effort isn't story points), linked back to the item (sourceRef tech-debt); the item records the link (sentTo). Once that story is done, list_state shows storyDone: then mark the item resolved. Params: id. Returns {sent: true, storyId} or {sent: false, reason: 'not_found' | 'example' | 'resolved' | 'untitled' | 'already_sent', storyId?}.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params) => addToBacklog(browserTechDebtStore, params.id),
  mcpHandler: async (params, ctx) => addToBacklog(serverTechDebtStore(ctx.userId), params.id),
});
