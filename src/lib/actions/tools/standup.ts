/**
 * Daily Standup — tool-local actions.
 *
 * Category: Ceremonies (squad S3 — daily standup + blocker tracking)
 *
 * Agent surface: tool.standup.*
 * Backing CRUD : workspace.standup_entry.* (auto-generated). The roster is
 *                the shared workspace teamMembers list.
 *
 * Posting an entry is plain workspace.standup_entry.create. This file adds:
 *   1. list_state     — today's entries + blocker rollup + which roster
 *                       members have/haven't submitted, in one call.
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
import type { StandupEntry, TeamMember } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

const KIND_STANDUP = "workspace:standupEntry";
const KIND_TEAM = "workspace:teamMember";

const ws = () => useWorkspaceStore.getState();

/** The MCP server's "today": it has no user time zone, so UTC. The in-app
 *  path uses the user's local day, as the standup board stores entries. */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function hasBlocker(e: StandupEntry): boolean {
  return (e.blockers ?? "").trim().length > 0;
}

/** Build the today-focused standup summary. Shared by the browser + MCP
 *  paths so both return an identical shape. */
function summarize(entries: StandupEntry[], memberNames: string[], date: string) {
  const todays = entries.filter((e) => e.date === date);
  const submitted = new Set(todays.map((e) => e.member));
  const openBlockers = todays.filter((e) => hasBlocker(e) && !e.blockerResolved);
  const resolvedBlockers = todays.filter((e) => hasBlocker(e) && e.blockerResolved);
  const missingMembers = memberNames.filter((m) => !submitted.has(m));
  return {
    date,
    total: entries.length,
    todaysCount: todays.length,
    submittedToday: Array.from(submitted),
    missingMembers,
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
    "Summarise the standup for a day (defaults to today: the user's local day in the app, UTC over MCP). Returns {date, total, todaysCount, submittedToday: string[], missingMembers: string[] (roster members with no entry), openBlockers, resolvedBlockers, todaysEntries}.",
  paramsSchema: z.object({
    date: z
      .string()
      .optional()
      .describe(
        "Day to summarise, YYYY-MM-DD. Defaults to today (local in the app, UTC over MCP)."
      ),
  }),
  handler: async (params) => {
    const s = ws();
    const names = (s.teamMembers ?? []).map((m) => m.name);
    // The board dates entries by the local day (todayLocalISO); the UTC day
    // summarised yesterday's standup just after local midnight east of UTC.
    return summarize(s.standupEntries ?? [], names, params.date ?? todayLocalISO());
  },
  mcpHandler: async (params, ctx) => {
    const [entries, members] = await Promise.all([
      serverListEntities<StandupEntry>(ctx.userId, KIND_STANDUP),
      serverListEntities<TeamMember>(ctx.userId, KIND_TEAM),
    ]);
    return summarize(
      entries,
      members.map((m) => m.name),
      params.date ?? todayUTC()
    );
  },
});

// ──────── tool.standup.resolve_blocker ────────
// Convenience over workspace.standup_entry.update for the single most-
// common transition. requiresConfirmation:false — flagging a blocker
// resolved doesn't destroy data.
registry.register({
  id: "tool.standup.resolve_blocker",
  toolId: "tool.standup",
  name: "resolve_blocker",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark a standup entry's blocker resolved (sets blockerResolved=true). Idempotent — a no-op if already resolved. Returns {updated: false} when the id is unknown.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params) => {
    const current = (ws().standupEntries ?? []).find((e) => e.id === params.id);
    if (!current) return { updated: false };
    if (current.blockerResolved) return { updated: true };
    ws().upsertStandupEntry({ ...current, blockerResolved: true });
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const current = await serverGetEntity<StandupEntry>(ctx.userId, KIND_STANDUP, params.id);
    if (!current) return { updated: false };
    if (current.blockerResolved) return { updated: true };
    await serverUpsertEntity<StandupEntry>(ctx.userId, KIND_STANDUP, {
      ...current,
      blockerResolved: true,
    });
    return { updated: true };
  },
});
