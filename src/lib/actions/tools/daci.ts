/**
 * DACI Decision Doc — tool-local actions, kept as aliases onto the decision
 * records the Decision Log, DACI and RAPID share (workspace.decisions).
 *
 * Category: Decision Frameworks
 * Tool:     Driver / Approver / Contributors / Informed. Since Phase 7 a
 *           DACI decision is a decision record raised in the DACI form
 *           (template "daci"): the Approver is its decider, Driver,
 *           Contributors and Informed are its roles, and DACI's old
 *           statuses map onto the record's lifecycle:
 *             open        = proposed (not reopened)
 *             decided     = accepted (or deprecated / superseded)
 *             implemented = decided and carried out (implementedAt)
 *             revisit     = proposed again after a decision (reopenedAt)
 *
 * Agent surface: tool.daci.*
 *   1. list_state      — the DACI records in the old shape (status in
 *                        DACI's words), plus their number, label, outcome
 *                        and issues.
 *   2. set_status      — move a DACI record in DACI's words.
 *   3. add_contributor — idempotent append to Contributors.
 *   4. add_informed    — idempotent append to Informed.
 *
 * Old DACI rows (workspace.daciDecisions) are read through as records under
 * their own ids; the first write saves a Decision under that id and leaves
 * the old row behind as the backup. workspace.daci_decision.* CRUD stays
 * for old callers. tool.decision_log.* is the full surface (decide,
 * supersede, roles, options).
 */

import { z } from "zod";
import { registry } from "../registry";
import type { Decision, TeamMember } from "@/lib/stores/workspace-types";
import {
  decisionIssues,
  decisionLabel,
  legacyStatusOf,
  optionsOf,
  roleHolders,
  templateOf,
  withLegacyStatus,
  type LegacyDecisionStatus,
} from "@/lib/decisions/model";
import { nameKey } from "@/lib/team/names";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  browserDecisionStore,
  changeRecord,
  rosterName,
  serverDecisionStore,
  withRole,
  type DecisionStore,
} from "./decision-log";

/** DACI's own status vocabulary, as its callers have always sent it. */
const STATUSES = ["open", "decided", "implemented", "revisit"] as const;
const StatusSchema = z.enum(STATUSES);

const isDaci = (d: Decision) => templateOf(d) === "daci";

/** A DACI record in the DACI tool's old shape, with what the merged record adds. */
export function daciView(d: Decision, today: string) {
  return {
    id: d.id,
    title: d.title,
    ...(d.context ? { context: d.context } : {}),
    ...(roleHolders(d, "driver")[0] ? { driver: roleHolders(d, "driver")[0] } : {}),
    ...(d.decider ? { approver: d.decider } : {}),
    contributors: roleHolders(d, "contributor"),
    informed: roleHolders(d, "informed"),
    options: optionsOf(d).map((o) => o.text),
    ...(d.recommendation ? { recommendation: d.recommendation } : {}),
    status: legacyStatusOf(d, "daci"),
    date: d.date,
    // Added by the merge: the record's place in the log and what it says.
    number: d.number,
    label: decisionLabel(d),
    lifecycle: d.status,
    decision: d.decision,
    ...(d.decidedAt ? { decidedAt: d.decidedAt } : {}),
    ...(d.implementedAt ? { implementedAt: d.implementedAt } : {}),
    ...(d.reopenedAt ? { reopenedAt: d.reopenedAt } : {}),
    issues: decisionIssues(d, today),
  };
}

// ──────── tool.daci.list_state ────────
registry.register({
  id: "tool.daci.list_state",
  toolId: "tool.daci",
  name: "list_state",
  category: "read",
  description:
    "List the DACI decision records (the Decision Log's records raised in the DACI form) with a breakdown by DACI status. Returns {total, byStatus: {open, decided, implemented, revisit}, items: {id, title, context?, driver?, approver?, contributors, informed, options: string[], recommendation?, status (DACI's words), date, number, label ('DACI-0004'), lifecycle (proposed|accepted|deprecated|superseded), decision (the outcome), decidedAt?, implementedAt?, reopenedAt?, issues}[]}.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserDecisionStore),
  mcpHandler: async (_params, ctx) => listState(serverDecisionStore(ctx.userId)),
});

async function listState(store: DecisionStore) {
  const today = todayLocalISO();
  const items = (await store.list()).records.filter(isDaci);
  const byStatus: Record<LegacyDecisionStatus, number> = {
    open: 0,
    decided: 0,
    implemented: 0,
    revisit: 0,
  };
  for (const d of items) byStatus[legacyStatusOf(d, "daci")] += 1;
  return { total: items.length, byStatus, items: items.map((d) => daciView(d, today)) };
}

// ──────── tool.daci.set_status ────────
const SetStatusSchema = z.object({ id: z.string(), status: StatusSchema });

async function setStatus(store: DecisionStore, p: z.infer<typeof SetStatusSchema>) {
  const today = todayLocalISO();
  return changeRecord(store, p.id, { updated: false }, (d) => {
    if (!isDaci(d)) return { refuse: { updated: false, reason: "not_daci" } };
    const next = withLegacyStatus(d, p.status, today, "daci");
    return next === d ? { same: { updated: true } } : { next, result: { updated: true } };
  });
}

registry.register({
  id: "tool.daci.set_status",
  toolId: "tool.daci",
  name: "set_status",
  category: "write",
  description:
    "Set a DACI record's status in DACI's words: open (proposed), decided (accepted; dated today when it was open), implemented (decided and carried out today), revisit (reopened today). Use tool.decision_log.decide to write the outcome. Params: id, status. Returns {updated: true} or {updated: false, reason?: 'not_daci'} (unknown id, or a record in another form).",
  paramsSchema: SetStatusSchema,
  handler: async (params) => setStatus(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => setStatus(serverDecisionStore(ctx.userId), params),
});

// ──────── tool.daci.add_contributor / add_informed ────────
async function addPerson(
  store: DecisionStore,
  id: string,
  role: "contributor" | "informed",
  person: string
) {
  return changeRecord(store, id, { added: false }, (d, _all, roster: readonly TeamMember[]) => {
    if (!isDaci(d)) return { refuse: { added: false, reason: "not_daci" } };
    const name = rosterName(person, roster);
    if (roleHolders(d, role).some((h) => nameKey(h) === nameKey(name))) {
      return { same: { added: false } };
    }
    const out = withRole(d, role, name);
    return "next" in out
      ? { next: out.next, result: { added: true } }
      : { refuse: { added: false } };
  });
}

registry.register({
  id: "tool.daci.add_contributor",
  toolId: "tool.daci",
  name: "add_contributor",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a person to a DACI record's Contributors (the roster's spelling when they're on the team). Idempotent: skips a name already there (any case). Params: id, contributor. Returns {added: false} when the id is unknown, the record isn't DACI, or the name was already there.",
  paramsSchema: z.object({ id: z.string(), contributor: z.string().min(1).max(120) }),
  handler: async (params) =>
    addPerson(browserDecisionStore, params.id, "contributor", params.contributor),
  mcpHandler: async (params, ctx) =>
    addPerson(serverDecisionStore(ctx.userId), params.id, "contributor", params.contributor),
});

registry.register({
  id: "tool.daci.add_informed",
  toolId: "tool.daci",
  name: "add_informed",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a person to a DACI record's Informed list (the roster's spelling when they're on the team). Idempotent: skips a name already there (any case). Params: id, informed. Returns {added: false} when the id is unknown, the record isn't DACI, or the name was already there.",
  paramsSchema: z.object({ id: z.string(), informed: z.string().min(1).max(120) }),
  handler: async (params) =>
    addPerson(browserDecisionStore, params.id, "informed", params.informed),
  mcpHandler: async (params, ctx) =>
    addPerson(serverDecisionStore(ctx.userId), params.id, "informed", params.informed),
});
