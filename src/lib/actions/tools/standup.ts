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
 * async entries (lib/standup/entries). Posting a live entry is plain
 * workspace.standup_entry.create; an async one is tool.async_standup.post.
 * This file adds:
 *   1. list_state      — a day's entries (both modes) + blocker rollup +
 *                        which roster members have/haven't posted.
 *   2. resolve_blocker — flip an entry's blocker to resolved (folds into
 *                        StandupEntry.blockerResolved). Idempotent.
 *
 * Entity kind is "workspace:standupEntry" (camelCase via kindFromToolId),
 * matching the browser sync engine so MCP-posted entries round-trip.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverGetEntity, serverUpsertEntity } from "../server-store";
import type { AsyncUpdate, StandupEntry, TeamMember } from "@/lib/stores/workspace-types";
import {
  allStandupEntries,
  fromAsyncUpdate,
  hasBlocker,
  notPostedYet,
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
    "Mark a standup entry's blocker resolved (sets blockerResolved=true), live or async. Idempotent — a no-op if already resolved. Returns {updated: false} when the id is unknown.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params) => {
    const s = ws();
    const stored = (s.standupEntries ?? []).find((e) => e.id === params.id);
    const legacy = stored ? undefined : (s.asyncUpdates ?? []).find((u) => u.id === params.id);
    const current = stored ?? (legacy ? fromAsyncUpdate(legacy) : undefined);
    if (!current) return { updated: false };
    if (current.blockerResolved) return { updated: true };
    s.upsertStandupEntry({ ...current, blockerResolved: true });
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    let current = await serverGetEntity<StandupEntry>(ctx.userId, KIND_STANDUP, params.id);
    if (!current) {
      const legacy = await serverGetEntity<AsyncUpdate>(ctx.userId, KIND_ASYNC, params.id);
      current = legacy ? fromAsyncUpdate(legacy) : null;
    }
    if (!current) return { updated: false };
    if (current.blockerResolved) return { updated: true };
    await serverUpsertEntity<StandupEntry>(ctx.userId, KIND_STANDUP, {
      ...current,
      blockerResolved: true,
    });
    return { updated: true };
  },
});
