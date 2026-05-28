/**
 * RAPID Decision Matrix — tool-local actions.
 *
 * Category: Decision Frameworks (squad S13, Wave 2 / CRUD-backed)
 * Tool:     Bain's Recommend / Agree / Perform / Input / Decide model
 *
 * Agent surface: tool.rapid_decision.*
 * Backing CRUD : workspace.rapid_decision.{create,list,update,delete}
 *                (auto-registered via defineCrudActions in workspace/index.ts)
 *
 * ─── DECISION-CRUD variant of the calc-tool pattern ──────────────────
 * Unlike prioritization tools (WSJF, RICE, ICE…) which share one
 * collection and filter by `framework`, RAPID has its own dedicated
 * collection (`rapidDecisions`). The CRUD verbs are auto-generated; this
 * file adds the tool-specific verbs an agent reaches for in conversation:
 *
 *   1. list_state            — snapshot of all decisions + status stats
 *   2. set_status            — lifecycle transitions (open → decided → implemented)
 *   3. assign_role           — idempotent append to one of A/P/I role arrays
 *   4. set_decider           — set the single Decide role (string, not array)
 *   5. set_recommend         — set the Recommend field (string, single owner)
 *
 * ─── Why "assign_role" not "set_role" ─────────────────────────────────
 * The A/P/I roles are arrays (multiple people can be in the "must agree"
 * group). The agent intent is overwhelmingly *append* ("also add Sarah
 * to the agree list"), not *replace*. assign_role is idempotent — if
 * the person is already in the role, it returns {added: false} without
 * mutating, so an agent can call it speculatively without producing
 * spurious history events.
 *
 * The D role (decide) and R role (recommend) are single strings — one
 * decider, one recommender — so they use the singular set_decider and
 * set_recommend verbs.
 *
 * ─── requiresConfirmation rationale ──────────────────────────────────
 * Additive operations (assign_role, set_recommend, set_decider) are
 * cheap to undo — re-call the same verb with the corrected value. No
 * confirmation gate.
 *
 * set_status → "implemented" IS gated. "implemented" is the lifecycle
 * end state — agents reading the workspace treat implemented decisions
 * as historical record, not in-flight work. Reversing requires manual
 * intervention. Treat as the point of no return.
 *
 * set_status → "open" or "decided" is NOT gated; teams routinely flip
 * back and forth between these as new information arrives.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverGetEntity, serverUpsertEntity } from "../server-store";
import type { RAPIDDecision } from "@/lib/stores/workspace-types";

/** Entity kind in user_entities — derived from the workspace CRUD
 *  toolId ("workspace.rapid_decision") via kindFromToolId, which maps it
 *  to the camelCase "workspace:rapidDecision" the browser sync engine also
 *  uses, so MCP writes round-trip into the browser store. */
const KIND_RAPID_DECISION = "workspace:rapidDecision";

const STATUS_VALUES = ["open", "decided", "implemented"] as const;
const StatusSchema = z.enum(STATUS_VALUES);

/** Array-valued RAPID roles. The D (decide) and R (recommend) slots
 *  are single strings and use their own set_* verbs. */
const ARRAY_ROLE_VALUES = ["agree", "perform", "input"] as const;
type ArrayRole = (typeof ARRAY_ROLE_VALUES)[number];
const ArrayRoleSchema = z.enum(ARRAY_ROLE_VALUES);

const ws = () => useWorkspaceStore.getState();

// ──────── tool.rapid_decision.list_state ────────
// Read-only snapshot with status histogram for at-a-glance dashboards.
registry.register({
  id: "tool.rapid_decision.list_state",
  toolId: "tool.rapid_decision",
  name: "list_state",
  category: "read",
  description:
    "List all RAPID decisions in the workspace with a status histogram (open/decided/implemented counts) and the full item array.",
  paramsSchema: z.object({}),
  handler: async () => {
    const items = ws().rapidDecisions ?? [];
    const byStatus: Record<(typeof STATUS_VALUES)[number], number> = {
      open: 0,
      decided: 0,
      implemented: 0,
    };
    for (const d of items) {
      // Defensive: a stray legacy status would silently inflate "open" if
      // we used a default — count only known buckets so the totals
      // remain trustworthy.
      if (d.status === "open" || d.status === "decided" || d.status === "implemented") {
        byStatus[d.status]++;
      }
    }
    return { items, byStatus, count: items.length };
  },
  mcpHandler: async (_params, ctx) => {
    const items = await serverListEntities<RAPIDDecision>(ctx.userId, KIND_RAPID_DECISION);
    const byStatus: Record<(typeof STATUS_VALUES)[number], number> = {
      open: 0,
      decided: 0,
      implemented: 0,
    };
    for (const d of items) {
      if (d.status === "open" || d.status === "decided" || d.status === "implemented") {
        byStatus[d.status]++;
      }
    }
    return { items, byStatus, count: items.length };
  },
});

// ──────── tool.rapid_decision.set_status ────────
// Lifecycle transition. Confirms only on the "implemented" terminal
// state (see file-header rationale). Returns updated=false when the
// id is unknown — idempotent so the agent doesn't need a precheck.
registry.register({
  id: "tool.rapid_decision.set_status",
  toolId: "tool.rapid_decision",
  name: "set_status",
  category: "write",
  // requiresConfirmation is set dynamically in the handler via a
  // ctx.confirm call when transitioning to "implemented". The static
  // flag stays false so the agent UI doesn't gate every transition.
  requiresConfirmation: false,
  description:
    "Update a RAPID decision's lifecycle status (open / decided / implemented). Transitions to 'implemented' are treated as terminal — agents should be sure before calling.",
  paramsSchema: z.object({
    id: z.string(),
    status: StatusSchema,
  }),
  handler: async (params, ctx) => {
    const current = (ws().rapidDecisions ?? []).find((d) => d.id === params.id);
    if (!current) return { updated: false };
    if (current.status === params.status) {
      // No-op: same status. Avoid bumping the entity needlessly so the
      // history feed doesn't show a fake transition.
      return { updated: false, reason: "already-in-status" as const };
    }
    if (params.status === "implemented" && ctx.confirm) {
      const ok = await ctx.confirm(
        `Mark RAPID decision "${current.title}" as implemented? This is the lifecycle end state.`
      );
      if (!ok) return { updated: false, reason: "declined" as const };
    }
    const next: RAPIDDecision = { ...current, status: params.status };
    ws().upsertRAPIDDecision(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const current = await serverGetEntity<RAPIDDecision>(
      ctx.userId,
      KIND_RAPID_DECISION,
      params.id
    );
    if (!current) return { updated: false };
    if (current.status === params.status) {
      return { updated: false, reason: "already-in-status" as const };
    }
    // MCP path has no interactive confirm (ctx.confirm is undefined);
    // implemented-transition is at the caller's discretion. See header.
    const next: RAPIDDecision = { ...current, status: params.status };
    await serverUpsertEntity<RAPIDDecision>(ctx.userId, KIND_RAPID_DECISION, next);
    return { updated: true };
  },
});

// ──────── tool.rapid_decision.assign_role ────────
// Idempotent append to an array-valued RAPID role (agree/perform/input).
// Does NOT cover the singular roles (decide → set_decider, recommend →
// set_recommend) — those have their own verbs because "assign" implies
// multi-assignee semantics.
registry.register({
  id: "tool.rapid_decision.assign_role",
  toolId: "tool.rapid_decision",
  name: "assign_role",
  category: "write",
  requiresConfirmation: false,
  description:
    "Idempotently add a person to one of a RAPID decision's array-valued roles (agree / perform / input). For the singular Decide role use set_decider; for Recommend use set_recommend. Returns {added: false} when the person is already in the role.",
  paramsSchema: z.object({
    id: z.string(),
    role: ArrayRoleSchema,
    person: z.string().min(1).max(120),
  }),
  handler: async (params) => {
    const current = (ws().rapidDecisions ?? []).find((d) => d.id === params.id);
    if (!current) return { added: false, reason: "not-found" as const };
    const role = params.role as ArrayRole;
    const personTrim = params.person.trim();
    if (!personTrim) return { added: false, reason: "empty-person" as const };
    const existing = current[role] ?? [];
    if (existing.includes(personTrim)) {
      return { added: false, reason: "already-assigned" as const };
    }
    const next: RAPIDDecision = { ...current, [role]: [...existing, personTrim] };
    ws().upsertRAPIDDecision(next);
    return { added: true };
  },
  mcpHandler: async (params, ctx) => {
    const current = await serverGetEntity<RAPIDDecision>(
      ctx.userId,
      KIND_RAPID_DECISION,
      params.id
    );
    if (!current) return { added: false, reason: "not-found" as const };
    const role = params.role as ArrayRole;
    const personTrim = params.person.trim();
    if (!personTrim) return { added: false, reason: "empty-person" as const };
    const existing = current[role] ?? [];
    if (existing.includes(personTrim)) {
      return { added: false, reason: "already-assigned" as const };
    }
    const next: RAPIDDecision = { ...current, [role]: [...existing, personTrim] };
    await serverUpsertEntity<RAPIDDecision>(ctx.userId, KIND_RAPID_DECISION, next);
    return { added: true };
  },
});

// ──────── tool.rapid_decision.set_decider ────────
// Set the single D (decide) field. The decider is the one person with
// final say; if the team needs multiple, that's not a RAPID decision —
// it's a consensus / DACI hybrid. The verb name "set" makes the
// overwrite semantics explicit (vs. assign_role's append semantics).
registry.register({
  id: "tool.rapid_decision.set_decider",
  toolId: "tool.rapid_decision",
  name: "set_decider",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the single Decide (D) role on a RAPID decision. The decider is one person with final say — for multi-person agreement use the Agree (A) role via assign_role.",
  paramsSchema: z.object({
    id: z.string(),
    person: z.string().min(1).max(120),
  }),
  handler: async (params) => {
    const current = (ws().rapidDecisions ?? []).find((d) => d.id === params.id);
    if (!current) return { updated: false };
    const personTrim = params.person.trim();
    if (!personTrim) return { updated: false };
    const next: RAPIDDecision = { ...current, decide: personTrim };
    ws().upsertRAPIDDecision(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const current = await serverGetEntity<RAPIDDecision>(
      ctx.userId,
      KIND_RAPID_DECISION,
      params.id
    );
    if (!current) return { updated: false };
    const personTrim = params.person.trim();
    if (!personTrim) return { updated: false };
    const next: RAPIDDecision = { ...current, decide: personTrim };
    await serverUpsertEntity<RAPIDDecision>(ctx.userId, KIND_RAPID_DECISION, next);
    return { updated: true };
  },
});

// ──────── tool.rapid_decision.set_recommend ────────
// Set the Recommend field. The recommender owns the proposal — single
// authorship by design (otherwise the proposal lacks a clear champion
// to drive it through the matrix).
registry.register({
  id: "tool.rapid_decision.set_recommend",
  toolId: "tool.rapid_decision",
  name: "set_recommend",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the Recommend (R) field on a RAPID decision — the owner of the proposal. Free-form text (typically a person's name, sometimes a team).",
  paramsSchema: z.object({
    id: z.string(),
    recommendation: z.string().min(1).max(500),
  }),
  handler: async (params) => {
    const current = (ws().rapidDecisions ?? []).find((d) => d.id === params.id);
    if (!current) return { updated: false };
    const recTrim = params.recommendation.trim();
    if (!recTrim) return { updated: false };
    const next: RAPIDDecision = { ...current, recommend: recTrim };
    ws().upsertRAPIDDecision(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const current = await serverGetEntity<RAPIDDecision>(
      ctx.userId,
      KIND_RAPID_DECISION,
      params.id
    );
    if (!current) return { updated: false };
    const recTrim = params.recommendation.trim();
    if (!recTrim) return { updated: false };
    const next: RAPIDDecision = { ...current, recommend: recTrim };
    await serverUpsertEntity<RAPIDDecision>(ctx.userId, KIND_RAPID_DECISION, next);
    return { updated: true };
  },
});
