/**
 * Daily Standup — tool-local actions.
 *
 * Category: Ceremonies (squad S3 — daily standup + blocker tracking)
 *
 * Agent surface: tool.standup.*
 * Backing CRUD : workspace.standup_entry.* (auto-generated). The roster is
 *                the shared workspace teamMembers list.
 *
 * The live and async standups share one entity, StandupEntry (`mode`:
 * "live" | "async"); the async tool's older AsyncUpdate rows are read as
 * async entries (lib/standup/entries). This file adds:
 *   1. list_state      — a day's entries (both modes) + blocker rollup +
 *                        which roster members have/haven't posted.
 *   2. resolve_blocker — resolve an entry's blocker, or reopen it
 *                        (StandupEntry.blockerResolved). Idempotent.
 *   3. post            — post a live entry, one per person per day as on
 *                        the page (tool.async_standup.post is the async one).
 *   4. remove_entry    — remove an entry, and the old async update under
 *                        its id, so it doesn't show again.
 *
 * Entity kind is "workspace:standupEntry" (camelCase via kindFromToolId),
 * matching the browser sync engine so MCP-posted entries round-trip.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverDeleteEntity,
  serverListEntities,
  serverGetEntity,
  serverUpsertEntity,
} from "../server-store";
import type { AsyncUpdate, StandupEntry, TeamMember } from "@/lib/stores/workspace-types";
import {
  allStandupEntries,
  entryFor,
  fromAsyncUpdate,
  hasBlocker,
  notPostedYet,
  postedEntry,
  standupMode,
} from "@/lib/standup/entries";

const KIND_STANDUP = "workspace:standupEntry";
const KIND_ASYNC = "workspace:asyncUpdate";
const KIND_TEAM = "workspace:teamMember";

const ws = () => useWorkspaceStore.getState();

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build the day-focused standup summary. Shared by the browser + MCP
 *  paths so both return an identical shape. */
function summarize(entries: StandupEntry[], memberNames: string[], date: string) {
  const todays = entries.filter((e) => e.date === date);
  const submitted = new Set(todays.map((e) => e.member));
  const openBlockers = todays.filter((e) => hasBlocker(e) && !e.blockerResolved);
  const resolvedBlockers = todays.filter((e) => hasBlocker(e) && e.blockerResolved);
  return {
    date,
    total: entries.length,
    todaysCount: todays.length,
    byMode: {
      live: todays.filter((e) => standupMode(e) === "live").length,
      async: todays.filter((e) => standupMode(e) === "async").length,
    },
    submittedToday: Array.from(submitted),
    missingMembers: notPostedYet(todays, memberNames, date),
    openBlockers,
    resolvedBlockers,
    todaysEntries: todays,
  };
}

// ──────── tool.standup.list_state ────────
registry.register({
  id: "tool.standup.list_state",
  toolId: "tool.standup",
  name: "list_state",
  category: "read",
  description:
    "Summarise the standup for a day (defaults to today, UTC), live and async entries together. Returns {date, total, todaysCount, byMode: {live, async}, submittedToday: string[], missingMembers: string[] (roster members with no entry), openBlockers, resolvedBlockers, todaysEntries (each with mode: live | async)}.",
  paramsSchema: z.object({
    date: z.string().optional().describe("Day to summarise, YYYY-MM-DD. Defaults to today (UTC)."),
  }),
  handler: async (params) => {
    const s = ws();
    const names = (s.teamMembers ?? []).map((m) => m.name);
    const entries = allStandupEntries(s.standupEntries, s.asyncUpdates).map((e) => ({
      ...e,
      mode: standupMode(e),
    }));
    return summarize(entries, names, params.date ?? todayUTC());
  },
  mcpHandler: async (params, ctx) => {
    const [entries, updates, members] = await Promise.all([
      serverListEntities<StandupEntry>(ctx.userId, KIND_STANDUP),
      serverListEntities<AsyncUpdate>(ctx.userId, KIND_ASYNC),
      serverListEntities<TeamMember>(ctx.userId, KIND_TEAM),
    ]);
    return summarize(
      allStandupEntries(entries, updates).map((e) => ({ ...e, mode: standupMode(e) })),
      members.map((m) => m.name),
      params.date ?? todayUTC()
    );
  },
});

/** The entry with its blocker resolved, or reopened; the same object when it already is. */
function withResolved(entry: StandupEntry, resolved: boolean): StandupEntry {
  if (Boolean(entry.blockerResolved) === resolved) return entry;
  if (resolved) return { ...entry, blockerResolved: true };
  const { blockerResolved, ...rest } = entry;
  void blockerResolved;
  return rest;
}

// ──────── tool.standup.resolve_blocker ────────
// Convenience over workspace.standup_entry.update for the single most-
// common transition. requiresConfirmation:false — flagging a blocker
// resolved doesn't destroy data. An old async update is written as an
// async entry under its id, with the blocker resolved.
registry.register({
  id: "tool.standup.resolve_blocker",
  toolId: "tool.standup",
  name: "resolve_blocker",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark a standup entry's blocker resolved (blockerResolved=true), live or async, or reopen it with resolved=false, as the page's Resolve and Reopen do. Idempotent. Returns {updated: false} when the id is unknown.",
  paramsSchema: z.object({
    id: z.string(),
    resolved: z.boolean().optional().describe("false reopens the blocker. Defaults to true."),
  }),
  handler: async (params) => {
    const s = ws();
    const stored = (s.standupEntries ?? []).find((e) => e.id === params.id);
    const legacy = stored ? undefined : (s.asyncUpdates ?? []).find((u) => u.id === params.id);
    const current = stored ?? (legacy ? fromAsyncUpdate(legacy) : undefined);
    if (!current) return { updated: false };
    const next = withResolved(current, params.resolved ?? true);
    if (next !== current) s.upsertStandupEntry(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    let current = await serverGetEntity<StandupEntry>(ctx.userId, KIND_STANDUP, params.id);
    if (!current) {
      const legacy = await serverGetEntity<AsyncUpdate>(ctx.userId, KIND_ASYNC, params.id);
      current = legacy ? fromAsyncUpdate(legacy) : null;
    }
    if (!current) return { updated: false };
    const next = withResolved(current, params.resolved ?? true);
    if (next !== current) await serverUpsertEntity<StandupEntry>(ctx.userId, KIND_STANDUP, next);
    return { updated: true };
  },
});

const PostParams = z.object({
  member: z.string().trim().min(1).max(120),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("YYYY-MM-DD. Defaults to today (UTC)."),
  yesterday: z.string().max(4000),
  today: z.string().trim().min(1).max(4000),
  blockers: z.string().max(4000).optional(),
  description: z.string().max(4000).optional(),
});

// ──────── tool.standup.post ────────
registry.register({
  id: "tool.standup.post",
  toolId: "tool.standup",
  name: "post",
  category: "write",
  requiresConfirmation: false,
  description:
    "Post one member's live standup entry for a day (defaults to today, UTC): yesterday, today (required), optional blockers and notes. One entry per person per day, either mode: posting again replaces that day's entry under its id, keeping its blocker's resolution and hand-offs while the blocker text is unchanged. Returns {posted: true, id, replaced}.",
  paramsSchema: PostParams,
  handler: async (params) => {
    const s = ws();
    const date = params.date ?? todayUTC();
    const existing = entryFor(
      allStandupEntries(s.standupEntries, s.asyncUpdates),
      params.member,
      date
    );
    const entry = postedEntry(
      existing,
      { ...params, date },
      "live",
      `standup_${nanoid(8)}`,
      Date.now()
    );
    s.upsertStandupEntry(entry);
    return { posted: true, id: entry.id, replaced: Boolean(existing) };
  },
  mcpHandler: async (params, ctx) => {
    const date = params.date ?? todayUTC();
    const [entries, updates] = await Promise.all([
      serverListEntities<StandupEntry>(ctx.userId, KIND_STANDUP),
      serverListEntities<AsyncUpdate>(ctx.userId, KIND_ASYNC),
    ]);
    const existing = entryFor(allStandupEntries(entries, updates), params.member, date);
    const entry = postedEntry(
      existing,
      { ...params, date },
      "live",
      `standup_${nanoid(8)}`,
      Date.now()
    );
    await serverUpsertEntity<StandupEntry>(ctx.userId, KIND_STANDUP, entry);
    return { posted: true, id: entry.id, replaced: Boolean(existing) };
  },
});

// ──────── tool.standup.remove_entry ────────
// The page removes an entry and the old async update under its id
// together: removing only the entry would bring the old update back.
registry.register({
  id: "tool.standup.remove_entry",
  toolId: "tool.standup",
  name: "remove_entry",
  category: "write",
  description:
    "Remove a standup entry (live or async), and the old async update under the same id, so it doesn't show again. Returns {removed: boolean}.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async ({ id }) => {
    const s = ws();
    const entry = (s.standupEntries ?? []).some((e) => e.id === id);
    const update = (s.asyncUpdates ?? []).some((u) => u.id === id);
    if (entry) s.removeStandupEntry(id);
    if (update) s.removeAsyncUpdate(id);
    return { removed: entry || update };
  },
  mcpHandler: async ({ id }, ctx) => {
    const [entry, update] = await Promise.all([
      serverGetEntity<StandupEntry>(ctx.userId, KIND_STANDUP, id),
      serverGetEntity<AsyncUpdate>(ctx.userId, KIND_ASYNC, id),
    ]);
    if (entry) await serverDeleteEntity(ctx.userId, KIND_STANDUP, id);
    if (update) await serverDeleteEntity(ctx.userId, KIND_ASYNC, id);
    return { removed: Boolean(entry || update) };
  },
});
