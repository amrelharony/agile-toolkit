/**
 * Async Standup — tool-local actions.
 *
 * Category: Ceremonies (squad S3 — async-first daily standup)
 * Tool:     Per-member daily updates with an auto-generated digest
 *
 * Agent surface: tool.async_standup.*
 * Storage      : the async standup is the Standup tool's async mode, so a
 *                post is a StandupEntry with mode "async" (one per person
 *                per day). The older workspace.async_update.* rows are read
 *                as async entries too (lib/standup/entries); that CRUD
 *                stays for old callers, but new posts go through `post`.
 *
 *   1. list_state — counts + the day's blocker rollup + a per-day histogram
 *                   so an agent can answer "who's posted / who's blocked?".
 *   2. digest     — the tool's signature output: a grouped-by-member
 *                   markdown digest for a given day (defaults to today),
 *                   ready to paste into Slack/email. Like the page's, it
 *                   covers the day's entries of both modes (one per person
 *                   per day); `mode` narrows it.
 *   3. post       — post (or replace) one member's async update for a day.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import {
  STANDUP_FORMATS,
  TEAM_TIME_PERSON_KIND,
  type AsyncUpdate,
  type StandupEntry,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import {
  BLOCKER_DRI_MAX,
  HANDOFF_MAX,
  allStandupEntries,
  entryFor,
  hasBlocker,
  postedEntry,
  standupDigest,
  standupMode,
  type StandupPlaces,
} from "@/lib/standup/entries";
import { standupPlaces } from "@/lib/team-time/sun";

const KIND_STANDUP = "workspace:standupEntry";
const KIND_ASYNC = "workspace:asyncUpdate";
/** MUST match registerCollection("teamMember", …) in workspace-store.ts. */
const KIND_MEMBER = "workspace:teamMember";

const ws = () => useWorkspaceStore.getState();

/** Server-side "today" (UTC). The browser tool uses the local day; an MCP
 *  agent has no locale, so UTC is the least-surprising default. Callers can
 *  pass an explicit `date` to digest any specific day. */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Where reads and writes go, in the browser or on the server. */
interface AsyncStore {
  /** Every standup entry, both modes, old async updates included. */
  list: () => Promise<StandupEntry[]>;
  put: (entry: StandupEntry) => Promise<void>;
  /** Where each poster works (Team Time), as the page reads it. */
  places: (entries: readonly StandupEntry[]) => Promise<StandupPlaces>;
}

const browserStore: AsyncStore = {
  list: async () => allStandupEntries(ws().standupEntries, ws().asyncUpdates),
  put: async (entry) => ws().upsertStandupEntry(entry),
  places: async (entries) =>
    standupPlaces(ws().teamTimePeople ?? [], ws().teamMembers ?? [], entries),
};

const serverStore = (userId: string): AsyncStore => ({
  list: async () => {
    const [entries, updates] = await Promise.all([
      serverListEntities<StandupEntry>(userId, KIND_STANDUP),
      serverListEntities<AsyncUpdate>(userId, KIND_ASYNC),
    ]);
    return allStandupEntries(entries, updates);
  },
  put: async (entry) => {
    await serverUpsertEntity<StandupEntry>(userId, KIND_STANDUP, entry);
  },
  places: async (entries) => {
    const [people, members] = await Promise.all([
      // Read through readPerson inside standupPlaces: a bad row is left out.
      serverListEntities<{ id: string }>(userId, TEAM_TIME_PERSON_KIND),
      serverListEntities<TeamMember>(userId, KIND_MEMBER),
    ]);
    return standupPlaces(people, members, entries);
  },
});

const asyncOnly = (entries: StandupEntry[]) => entries.filter((e) => standupMode(e) === "async");

/** Build the {total, today, todaysCount, todaysBlockers, byDate} response.
 *  Shared by the browser + MCP paths so both return an identical shape. */
function listState(items: StandupEntry[]) {
  const today = todayUTC();
  const todays = items.filter((u) => u.date === today);
  const todaysBlockers = todays.filter(hasBlocker);
  const counts = new Map<string, number>();
  for (const u of items) counts.set(u.date, (counts.get(u.date) ?? 0) + 1);
  const byDate = Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest day first
  return { total: items.length, today, todaysCount: todays.length, todaysBlockers, byDate };
}

function digest(items: StandupEntry[], date: string, places: StandupPlaces) {
  const day = items.filter((u) => u.date === date);
  return {
    date,
    markdown: standupDigest(items, date, { places }),
    updateCount: day.length,
    blockerCount: day.filter(hasBlocker).length,
    handoffCount: day.filter((u) => (u.handoff ?? "").trim()).length,
  };
}

async function digestOf(
  store: AsyncStore,
  params: { date?: string; mode?: "all" | "async" | "live" }
) {
  const all = await store.list();
  return digest(byMode(all, params.mode), params.date ?? todayUTC(), await store.places(all));
}

const PostParams = z.object({
  member: z.string().trim().min(1).max(120),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("YYYY-MM-DD. Defaults to today (UTC)."),
  yesterday: z.string().max(4000).describe("Yesterday, or Progress in the ppp format."),
  today: z.string().max(4000).describe("Today, or Plans in the ppp format."),
  blockers: z.string().max(4000).optional().describe("Blockers, or Problems in the ppp format."),
  description: z.string().max(4000).optional(),
  format: z
    .enum(STANDUP_FORMATS)
    .optional()
    .describe(
      "classic (Yesterday, Today, Blockers; the default) or ppp (Progress, Plans, Problems)."
    ),
  dri: z
    .string()
    .trim()
    .max(BLOCKER_DRI_MAX)
    .optional()
    .describe("Who can clear the blocker (the DRI); dropped when there is no blocker."),
  handoff: z
    .string()
    .max(HANDOFF_MAX)
    .optional()
    .describe("A hand-over to the next time zone: what to pick up, and where it is."),
});

/** One async post per person per day (postedEntry in lib/standup/entries). */
async function post(store: AsyncStore, params: z.infer<typeof PostParams>) {
  const date = params.date ?? todayUTC();
  const existing = entryFor(await store.list(), params.member, date);
  const entry = postedEntry(
    existing,
    { ...params, date },
    "async",
    `standup_${nanoid(8)}`,
    Date.now()
  );
  await store.put(entry);
  return { posted: true, id: entry.id, replaced: Boolean(existing) };
}

const DigestMode = z
  .enum(["all", "async", "live"])
  .optional()
  .describe("Which entries: all (default, as the page's digest), async or live.");

const byMode = (entries: StandupEntry[], mode: "all" | "async" | "live" | undefined) =>
  !mode || mode === "all" ? entries : entries.filter((e) => standupMode(e) === mode);

// ──────── tool.async_standup.list_state ────────
registry.register({
  id: "tool.async_standup.list_state",
  toolId: "tool.async_standup",
  name: "list_state",
  category: "read",
  description:
    "Summarise async standup activity (async-mode standup entries, older async updates included). Returns {total, today (UTC YYYY-MM-DD), todaysCount, todaysBlockers: StandupEntry[], byDate: {date, count}[] (newest day first)}.",
  paramsSchema: z.object({}),
  handler: async () => listState(asyncOnly(await browserStore.list())),
  mcpHandler: async (_params, ctx) => listState(asyncOnly(await serverStore(ctx.userId).list())),
});

// ──────── tool.async_standup.digest ────────
registry.register({
  id: "tool.async_standup.digest",
  toolId: "tool.async_standup",
  name: "digest",
  category: "read",
  description:
    "Render a grouped-by-member markdown digest of one day's standup updates (defaults to today, UTC), blockers first: by default every entry of the day, live and async, as the page's digest (one per person per day); mode narrows it. Progress/Plans/Problems updates print under those words (the blockers heading reads Problems when every update is one); a blocker with a DRI ends ' (DRI: name)'; '## Hand-overs' lists each hand-over from the poster's place to the next one east to west; and with Team Time's places known, people follow the order the day reaches them. Returns {date, markdown, updateCount, blockerCount, handoffCount}.",
  paramsSchema: z.object({
    date: z.string().optional().describe("Day to digest, YYYY-MM-DD. Defaults to today (UTC)."),
    mode: DigestMode,
  }),
  handler: async (params) => digestOf(browserStore, params),
  mcpHandler: async (params, ctx) => digestOf(serverStore(ctx.userId), params),
});

// ──────── tool.async_standup.post ────────
registry.register({
  id: "tool.async_standup.post",
  toolId: "tool.async_standup",
  name: "post",
  category: "write",
  requiresConfirmation: false,
  description:
    "Post one member's async standup update for a day (defaults to today, UTC): yesterday, today, optional blockers and notes; format? 'ppp' when they wrote Progress, Plans and Problems; dri? (who can clear the blocker, kept only with one); handoff? (a hand-over to the next time zone). One per person per day: posting again replaces that day's entry. Returns {posted: true, id, replaced}.",
  paramsSchema: PostParams,
  handler: async (params) => post(browserStore, params),
  mcpHandler: async (params, ctx) => post(serverStore(ctx.userId), params),
});
