/**
 * RAPID Decision Matrix — tool-local actions, kept as aliases onto the
 * decision records the Decision Log, DACI and RAPID share
 * (workspace.decisions).
 *
 * Category: Decision Frameworks
 * Tool:     Bain's Recommend / Agree / Perform / Input / Decide. Since
 *           Phase 7 a RAPID decision is a decision record raised in the
 *           RAPID form (template "rapid"): Decide (D) is its decider,
 *           Recommend, Agree, Perform and Input are its roles, and RAPID's
 *           old statuses map onto the record's lifecycle:
 *             open        = proposed (a decided one set to open is
 *                           reopened: reopenedAt, as the page's Reopen)
 *             decided     = accepted (or deprecated / superseded)
 *             implemented = decided and carried out (implementedAt)
 *
 * Agent surface: tool.rapid_decision.*
 *   1. list_state    — the RAPID records in the old shape, plus their
 *                      number, label, outcome and issues.
 *   2. set_status    — move a record in RAPID's words; "implemented" asks
 *                      for confirmation on both paths when the caller can
 *                      confirm (it is the end state).
 *   3. assign_role   — idempotent append to Agree / Perform / Input.
 *   4. set_decider   — the single Decide (D).
 *   5. set_recommend — the single Recommend (R).
 *
 * Old RAPID rows (workspace.rapidDecisions) are read through as records
 * under their own ids; the first write saves a Decision under that id and
 * leaves the old row behind as the backup. workspace.rapid_decision.*
 * CRUD stays for old callers. tool.decision_log.* is the full surface.
 */

import { z } from "zod";
import { registry } from "../registry";
import type { ActionContext } from "../context";
import type { Decision } from "@/lib/stores/workspace-types";
import {
  decisionIssues,
  decisionLabel,
  legacyStatusOf,
  roleHolders,
  templateOf,
  withLegacyStatus,
} from "@/lib/decisions/model";
import { nameKey } from "@/lib/team/names";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  browserDecisionStore,
  changeRecord,
  deciderRefusal,
  rosterName,
  serverDecisionStore,
  type DecisionStore,
} from "./decision-log";

const STATUS_VALUES = ["open", "decided", "implemented"] as const;
type RapidStatus = (typeof STATUS_VALUES)[number];
const StatusSchema = z.enum(STATUS_VALUES);

/** Array-valued RAPID roles; Decide and Recommend have their own set_* verbs. */
const ARRAY_ROLE_VALUES = ["agree", "perform", "input"] as const;
const ArrayRoleSchema = z.enum(ARRAY_ROLE_VALUES);

const isRapid = (d: Decision) => templateOf(d) === "rapid";

/** A record's status in RAPID's words (RAPID has no "revisit": a reopened one is open). */
function rapidStatus(d: Decision): RapidStatus {
  const s = legacyStatusOf(d, "rapid");
  return s === "revisit" ? "open" : s;
}

/** A RAPID record in the RAPID tool's old shape, with what the merged record adds. */
export function rapidView(d: Decision, today: string) {
  return {
    id: d.id,
    title: d.title,
    ...(d.context ? { context: d.context } : {}),
    ...(roleHolders(d, "recommend")[0] ? { recommend: roleHolders(d, "recommend")[0] } : {}),
    agree: roleHolders(d, "agree"),
    perform: roleHolders(d, "perform"),
    input: roleHolders(d, "input"),
    ...(d.decider ? { decide: d.decider } : {}),
    status: rapidStatus(d),
    date: d.date,
    // Added by the merge: the record's place in the log and what it says.
    number: d.number,
    label: decisionLabel(d),
    lifecycle: d.status,
    decision: d.decision,
    ...(d.decidedAt ? { decidedAt: d.decidedAt } : {}),
    ...(d.implementedAt ? { implementedAt: d.implementedAt } : {}),
    issues: decisionIssues(d, today),
  };
}

// ──────── tool.rapid_decision.list_state ────────
async function listState(store: DecisionStore) {
  const today = todayLocalISO();
  const items = (await store.list()).records.filter(isRapid);
  const byStatus: Record<RapidStatus, number> = { open: 0, decided: 0, implemented: 0 };
  for (const d of items) byStatus[rapidStatus(d)] += 1;
  return { items: items.map((d) => rapidView(d, today)), byStatus, count: items.length };
}

registry.register({
  id: "tool.rapid_decision.list_state",
  toolId: "tool.rapid_decision",
  name: "list_state",
  category: "read",
  description:
    "List the RAPID decision records (the Decision Log's records raised in the RAPID form) with a status histogram in RAPID's words. Returns {items: {id, title, context?, recommend?, agree, perform, input, decide?, status (open|decided|implemented), date, number, label ('RAPID-0005'), lifecycle, decision (the outcome), decidedAt?, implementedAt?, issues}[], byStatus: {open, decided, implemented}, count}.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserDecisionStore),
  mcpHandler: async (_params, ctx) => listState(serverDecisionStore(ctx.userId)),
});

// ──────── tool.rapid_decision.set_status ────────
const SetStatusSchema = z.object({ id: z.string(), status: StatusSchema });

async function setStatus(
  store: DecisionStore,
  p: z.infer<typeof SetStatusSchema>,
  ctx: ActionContext
) {
  const today = todayLocalISO();
  return changeRecord(store, p.id, { updated: false }, async (d) => {
    if (!isRapid(d)) return { refuse: { updated: false, reason: "not-rapid" as const } };
    if (rapidStatus(d) === p.status) {
      return { refuse: { updated: false, reason: "already-in-status" as const } };
    }
    // Deciding an open record needs its Decide (D), as the page's decide form asks.
    if (p.status !== "open") {
      const why = deciderRefusal(d);
      if (why) return { refuse: { updated: false, ...why } };
    }
    // The end state confirms on both paths (MCP supplies no confirm, so it proceeds there).
    if (p.status === "implemented" && ctx.confirm) {
      const ok = await ctx.confirm(
        `Mark RAPID decision "${d.title}" as implemented? This is the lifecycle end state.`
      );
      if (!ok) return { refuse: { updated: false, reason: "declined" as const } };
    }
    return { next: withLegacyStatus(d, p.status, today, "rapid"), result: { updated: true } };
  });
}

registry.register({
  id: "tool.rapid_decision.set_status",
  toolId: "tool.rapid_decision",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a RAPID record's status in RAPID's words: open (proposed; a decided record is reopened today, reopenedAt, as the page's Reopen does), decided (accepted; dated today when it was open), implemented (decided and carried out today; asks for confirmation when the caller can confirm). Deciding an open record needs its Decide (D) named first, as on the page (set_decider). Use tool.decision_log.decide to write the outcome. Params: id, status. Returns {updated: true} or {updated: false, reason?: 'already-in-status' | 'declined' | 'not-rapid' | 'no_decider', message?}.",
  paramsSchema: SetStatusSchema,
  handler: async (params, ctx) => setStatus(browserDecisionStore, params, ctx),
  mcpHandler: async (params, ctx) => setStatus(serverDecisionStore(ctx.userId), params, ctx),
});

// ──────── tool.rapid_decision.assign_role ────────
const AssignSchema = z.object({
  id: z.string(),
  role: ArrayRoleSchema,
  person: z.string().min(1).max(120),
});

async function assignRole(store: DecisionStore, p: z.infer<typeof AssignSchema>) {
  return changeRecord(
    store,
    p.id,
    { added: false, reason: "not-found" as const },
    (d, _all, roster) => {
      if (!isRapid(d)) return { refuse: { added: false, reason: "not-rapid" as const } };
      const trimmed = p.person.trim();
      if (!trimmed) return { refuse: { added: false, reason: "empty-person" as const } };
      const person = rosterName(trimmed, roster);
      const holders = roleHolders(d, p.role);
      if (holders.some((h) => nameKey(h) === nameKey(person))) {
        return { same: { added: false, reason: "already-assigned" as const } };
      }
      return {
        next: { ...d, roles: { ...(d.roles ?? {}), [p.role]: [...holders, person] } },
        result: { added: true },
      };
    }
  );
}

registry.register({
  id: "tool.rapid_decision.assign_role",
  toolId: "tool.rapid_decision",
  name: "assign_role",
  category: "write",
  requiresConfirmation: false,
  description:
    "Idempotently add a person (the roster's spelling when they're on the team) to a RAPID record's Agree, Perform or Input. For Decide use set_decider; for Recommend use set_recommend. More than 3 in Agree shows an issue (each one is a veto). Params: id, role (agree|perform|input), person. Returns {added: true} or {added: false, reason: 'not-found' | 'already-assigned' | 'empty-person' | 'not-rapid'}.",
  paramsSchema: AssignSchema,
  handler: async (params) => assignRole(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => assignRole(serverDecisionStore(ctx.userId), params),
});

// ──────── tool.rapid_decision.set_decider ────────
const DeciderSchema = z.object({ id: z.string(), person: z.string().min(1).max(120) });

async function setDecider(store: DecisionStore, p: z.infer<typeof DeciderSchema>) {
  return changeRecord(store, p.id, { updated: false }, (d, _all, roster) => {
    if (!isRapid(d)) return { refuse: { updated: false } };
    const person = p.person.trim();
    if (!person) return { refuse: { updated: false } };
    return { next: { ...d, decider: rosterName(person, roster) }, result: { updated: true } };
  });
}

registry.register({
  id: "tool.rapid_decision.set_decider",
  toolId: "tool.rapid_decision",
  name: "set_decider",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the single Decide (D) on a RAPID record: the one person with the final say (the roster's spelling when they're on the team). For several people who must agree, use assign_role with Agree. Params: id, person. Returns {updated: boolean}.",
  paramsSchema: DeciderSchema,
  handler: async (params) => setDecider(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => setDecider(serverDecisionStore(ctx.userId), params),
});

// ──────── tool.rapid_decision.set_recommend ────────
const RecommendSchema = z.object({ id: z.string(), recommendation: z.string().min(1).max(500) });

async function setRecommend(store: DecisionStore, p: z.infer<typeof RecommendSchema>) {
  return changeRecord(store, p.id, { updated: false }, (d, _all, roster) => {
    if (!isRapid(d)) return { refuse: { updated: false } };
    const who = p.recommendation.trim();
    if (!who) return { refuse: { updated: false } };
    return {
      next: { ...d, roles: { ...(d.roles ?? {}), recommend: [rosterName(who, roster)] } },
      result: { updated: true },
    };
  });
}

registry.register({
  id: "tool.rapid_decision.set_recommend",
  toolId: "tool.rapid_decision",
  name: "set_recommend",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set Recommend (R) on a RAPID record: the one person (or team) who owns the proposal, replacing whoever held it. The proposal's text itself is the record's recommendation (tool.decision_log). Params: id, recommendation (the person's name). Returns {updated: boolean}.",
  paramsSchema: RecommendSchema,
  handler: async (params) => setRecommend(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => setRecommend(serverDecisionStore(ctx.userId), params),
});
