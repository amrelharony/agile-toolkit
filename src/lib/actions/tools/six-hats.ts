/**
 * Six Thinking Hats — tool-local actions.
 *
 * Category: Decision Frameworks (squad S13, Wave 4)
 * Tool:     De Bono's parallel-thinking framework (white / red / black /
 *           yellow / green / blue thoughts on the same problem).
 *
 * Agent surface: tool.six_hats.*
 * Backing CRUD : workspace.six_hats_thought.{create,list,update,delete}
 *                (auto-generated via defineCrudActions in workspace/index.ts).
 *
 * ─── CRUD-BACKED tool pattern ────────────────────────────────────────
 * SixHatsThought is a pure record-keeping entity (id, hat, text,
 * loggedAt) — there is no formula to assert, just a timeline of
 * thoughts grouped by hat colour. Generic create / list / update /
 * delete already exist on workspace.six_hats_thought.*, so this file
 * adds the VERBS THE AGENT WANTS TO SPEAK in the Six Hats vocabulary:
 *
 *   1. list_state        — return all thoughts grouped by hat
 *                          ({white: [...], red: [...], ..., total}).
 *                          Lets the agent see the session at a glance
 *                          without paging through the flat list and
 *                          bucketing client-side.
 *   2. log_thought       — convenience over workspace.six_hats_thought.create.
 *                          Takes only {hat, text}; stamps id + loggedAt
 *                          so the agent doesn't have to.
 *   3. summarize_by_hat  — PURE. Given a payload of items, return a
 *                          per-hat digest ({count, latestThought,
 *                          allThoughts}). No workspace read, no MCP
 *                          handler — agents call this after a write
 *                          loop to feed the next planning step a
 *                          compact summary.
 *   4. export_session    — render all thoughts in chronological order
 *                          as markdown ({markdown: string}). Useful for
 *                          an agent to generate a session writeup the
 *                          team can paste into a retro doc or wiki.
 *
 * ─── ENTITY KIND ─────────────────────────────────────────────────────
 * The server-side entity kind written by defineCrudActions is
 *   `workspace:sixHatsThought`     (camelCase via kindFromToolId)
 * The browser sync layer registers the same collection as
 *   `workspace:sixHatsThought`     (camelCase via registerCollection)
 *
 * Both sides agree on the camelCase kind, so thoughts written through
 * the MCP path round-trip into the browser tab on next pull-from-server.
 * The READ/WRITE pair on the server uses this kind consistently (matches
 * the defineCrudActions write path), so list_state / export_session reads
 * here line up byte-for-byte with the generic CRUD surface.
 *
 * ─── ID NAMING ───────────────────────────────────────────────────────
 * Namespace is `tool.six_hats` (snake_case in the action id; the URL
 * route is /six-hats with a hyphen). The auto-generated CRUD surface
 * uses `workspace.six_hats_thought` for the entity flavour — the
 * underscore in the entity slug matches the kind on disk.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type { SixHatsThought } from "@/lib/stores/workspace-types";

/** Server-side entity kind. Matches kindFromToolId("workspace.six_hats_thought")
 *  used by the auto-generated CRUD in src/lib/actions/workspace/index.ts,
 *  so server reads/writes here line up byte-for-byte with the generic
 *  surface and with the browser sync engine — both camelCase. */
const KIND_SIX_HATS = "workspace:sixHatsThought";

/** Closed enum of the six hats. Matches the literal union in
 *  workspace-types.ts:SixHatsThought.hat verbatim — Zod will reject
 *  anything else at the boundary. Listed in De Bono's canonical order
 *  (white → red → black → yellow → green → blue). */
const HATS = ["white", "red", "black", "yellow", "green", "blue"] as const;
type Hat = (typeof HATS)[number];
const HatSchema = z.enum(HATS);

/** Human-readable labels for each hat colour — used in export_session
 *  markdown so the writeup is self-explanatory without the reader
 *  having to memorise De Bono. Kept private to this file because the
 *  client (six-hats-client.tsx) has its own UI-flavoured labels
 *  ("White — Facts") that aren't appropriate for a plain markdown
 *  export (the em-dash trips some renderers). */
const HAT_LABELS: Record<Hat, string> = {
  white: "White (Facts)",
  red: "Red (Feelings)",
  black: "Black (Risks)",
  yellow: "Yellow (Benefits)",
  green: "Green (Creativity)",
  blue: "Blue (Process)",
};

const ws = () => useWorkspaceStore.getState();

/** Zero-initialised per-hat buckets. Returning a fresh copy from a
 *  helper (vs. spreading a singleton) keeps the API immutable — a
 *  caller that mutates the returned bucket won't poison the next
 *  call. */
function emptyBuckets(): Record<Hat, SixHatsThought[]> {
  return {
    white: [],
    red: [],
    black: [],
    yellow: [],
    green: [],
    blue: [],
  };
}

/** Group an array of thoughts into per-hat buckets. Skips items whose
 *  `hat` is out of the closed enum (defensive — legacy persist data or
 *  hand-edits could carry an unknown value; the client renderer has
 *  the same guard, see six-hats-client.tsx grouped useMemo). */
function group(items: SixHatsThought[]): Record<Hat, SixHatsThought[]> {
  const m = emptyBuckets();
  for (const t of items) {
    if (t.hat && m[t.hat]) m[t.hat].push(t);
  }
  return m;
}

// ──────── tool.six_hats.list_state ────────
// Snapshot grouped by hat + total count. The agent's most common
// opening question for the Six Hats tool is "what's in each hat right
// now?" — returning the grouped object in one round-trip avoids a
// follow-up reduce on the agent's end, and matches the shape the
// client renders.
registry.register({
  id: "tool.six_hats.list_state",
  toolId: "tool.six_hats",
  name: "list_state",
  category: "read",
  description:
    "List all Six Thinking Hats thoughts grouped by hat. Returns {white, red, black, yellow, green, blue} as arrays plus a total count. Mirrors the in-app grouping so an agent can describe a session at a glance.",
  paramsSchema: z.object({}),
  handler: async () => {
    const items = ws().sixHatsThoughts ?? [];
    const buckets = group(items);
    return { ...buckets, total: items.length };
  },
  mcpHandler: async (_params, ctx) => {
    const items = await serverListEntities<SixHatsThought>(ctx.userId, KIND_SIX_HATS);
    const buckets = group(items);
    return { ...buckets, total: items.length };
  },
});

// ──────── tool.six_hats.log_thought ────────
// Convenience over workspace.six_hats_thought.create. The generic
// create surface requires the agent to construct a full entity object
// (id, hat, text, loggedAt); this verb takes only the inputs that
// actually vary call-to-call ({hat, text}) and stamps id + loggedAt.
// Returns {id} so the agent can chain further mutations.
registry.register({
  id: "tool.six_hats.log_thought",
  toolId: "tool.six_hats",
  name: "log_thought",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log a single thought under one of the six hats (white | red | black | yellow | green | blue). Stamps id + loggedAt automatically. Returns {id}.",
  paramsSchema: z.object({
    hat: HatSchema,
    text: z.string().min(1).max(2000),
  }),
  handler: async (params) => {
    const item: SixHatsThought = {
      id: `sixHats_${Math.random().toString(36).slice(2, 10)}`,
      hat: params.hat,
      text: params.text.trim(),
      loggedAt: new Date().toISOString(),
    };
    ws().upsertSixHatsThought(item);
    return { id: item.id };
  },
  mcpHandler: async (params, ctx) => {
    const item: SixHatsThought = {
      id: `sixHats_${Math.random().toString(36).slice(2, 10)}`,
      hat: params.hat,
      text: params.text.trim(),
      loggedAt: new Date().toISOString(),
    };
    await serverUpsertEntity<SixHatsThought>(ctx.userId, KIND_SIX_HATS, item);
    return { id: item.id };
  },
});

// ──────── tool.six_hats.summarize_by_hat ────────
// Pure — no workspace read. Given a payload of items (typically the
// items the agent just logged, or a subset filtered by time / author),
// produce a per-hat digest the agent can feed into its next planning
// step. Has NO mcpHandler because it doesn't touch storage; the same
// handler runs in browser, agent, and MCP contexts.
registry.register({
  id: "tool.six_hats.summarize_by_hat",
  toolId: "tool.six_hats",
  name: "summarize_by_hat",
  category: "read",
  description:
    "Pure helper. Given {items: SixHatsThought[]}, return a per-hat digest: byHat[hat] = {count, latestThought?, allThoughts}. Use this after a logged session to feed a compact summary into the next planning step.",
  paramsSchema: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        hat: HatSchema,
        text: z.string(),
        loggedAt: z.string(),
      })
    ),
  }),
  handler: async (params) => {
    const byHat: Record<Hat, { count: number; latestThought?: string; allThoughts: string[] }> = {
      white: { count: 0, allThoughts: [] },
      red: { count: 0, allThoughts: [] },
      black: { count: 0, allThoughts: [] },
      yellow: { count: 0, allThoughts: [] },
      green: { count: 0, allThoughts: [] },
      blue: { count: 0, allThoughts: [] },
    };
    // Track latest loggedAt per hat so we don't have to sort each
    // bucket (saves O(n log n) when the items array is large).
    const latestAt: Record<Hat, string> = {
      white: "",
      red: "",
      black: "",
      yellow: "",
      green: "",
      blue: "",
    };
    for (const t of params.items) {
      const slot = byHat[t.hat];
      if (!slot) continue; // defensive: schema rejects unknown hat upstream
      slot.count += 1;
      slot.allThoughts.push(t.text);
      // String comparison on ISO timestamps is lexicographically
      // correct for chronological order — no Date parsing needed.
      if (t.loggedAt > latestAt[t.hat]) {
        latestAt[t.hat] = t.loggedAt;
        slot.latestThought = t.text;
      }
    }
    return { byHat };
  },
});

// ──────── tool.six_hats.export_session ────────
// Render every thought in chronological order as a markdown writeup.
// Useful for an agent generating a session summary to paste into a
// retro doc / wiki. Has both a browser handler and an mcpHandler
// because it reads the workspace.
registry.register({
  id: "tool.six_hats.export_session",
  toolId: "tool.six_hats",
  name: "export_session",
  category: "read",
  description:
    "Export the full Six Hats session as a markdown writeup. Thoughts are listed under per-hat headings in chronological order. Returns {markdown: string}.",
  paramsSchema: z.object({}),
  handler: async () => {
    const items = ws().sixHatsThoughts ?? [];
    return { markdown: renderMarkdown(items) };
  },
  mcpHandler: async (_params, ctx) => {
    const items = await serverListEntities<SixHatsThought>(ctx.userId, KIND_SIX_HATS);
    return { markdown: renderMarkdown(items) };
  },
});

/** Build the markdown writeup. Sections are in canonical De Bono order
 *  (white → red → black → yellow → green → blue); within each section
 *  thoughts are listed in chronological order (oldest first) so the
 *  reader follows the session as it unfolded. Skips hats with zero
 *  thoughts to keep the output tight — a session that never put on
 *  the green hat shouldn't have an empty "Green" heading.
 *
 *  Kept as a single helper so the browser-path and MCP-path outputs
 *  are guaranteed identical — drift would mean an agent gets different
 *  markdown depending on whether it's invoked from chat or over MCP. */
function renderMarkdown(items: SixHatsThought[]): string {
  if (items.length === 0) {
    return "# Six Thinking Hats — Session\n\n_No thoughts logged yet._\n";
  }
  const buckets = group(items);
  // Sort each bucket chronologically. ISO string compare is correct
  // here — no Date parsing needed.
  for (const hat of HATS) {
    buckets[hat].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  }
  const lines: string[] = ["# Six Thinking Hats — Session", ""];
  for (const hat of HATS) {
    const bucket = buckets[hat];
    if (bucket.length === 0) continue;
    lines.push(`## ${HAT_LABELS[hat]}`);
    lines.push("");
    for (const t of bucket) {
      lines.push(`- ${t.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
