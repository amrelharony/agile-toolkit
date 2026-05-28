/**
 * Risk Register — tool-local actions.
 *
 * Category: Portfolio, Discovery & Risk (squad S5, Wave 2 — risk CRUD)
 * Tool:     5×5 probability × impact register with mitigation tracking
 *
 * Agent surface: tool.risk_register.*
 * Backing CRUD : workspace.risk.{create,list,update,delete}
 *                (auto-registered via defineCrudActions in workspace/index.ts)
 *
 * ─── CRUD-BACKED tool with a pure compute helper ──────────────────────
 * The Risk Register is fundamentally a record-keeping entity (CRUD via
 * workspace.risk.*) — but agents reaching for it almost always want one
 * of two side-quests that the generic CRUD surface can't express
 * concisely:
 *
 *   1. compute_risk_score  — pure: probability × impact → {score, level}.
 *                            No mcpHandler (referentially transparent).
 *                            Mirrors the in-app riskScore() / riskColor()
 *                            functions in risk-register-client.tsx:72-81
 *                            so the agent's risk classification matches
 *                            what the user sees on the heatmap.
 *   2. list_state          — read all risks + summary stats (byStatus,
 *                            byLevel, topRisks). Saves the agent from
 *                            paging through the full list to answer
 *                            "what's the riskiest thing in flight?".
 *   3. set_status          — lifecycle transition (open → mitigating →
 *                            closed | accepted). Confirms on "closed" /
 *                            "accepted" terminal states — both wipe a
 *                            risk from the actionable heatmap (see
 *                            risk-register-client.tsx:215 — the matrix
 *                            filter excludes both).
 *   4. set_mitigation      — write a mitigation plan (+ optional due
 *                            date). Auto-transitions open → mitigating
 *                            as a cleanup convenience so the agent
 *                            doesn't need to chain set_status afterward.
 *
 * ─── Probability / Impact scale — 1..5 each ───────────────────────────
 * The Risk type in workspace-types.ts:49-50 pins probability and impact
 * to the literal union 1 | 2 | 3 | 4 | 5. The in-app form (risk-register
 * client.tsx:67-70, clampToScale) silently rounds and clamps anything
 * else into [1,5]. We mirror that here: z.number().int().min(1).max(5)
 * at the boundary so the agent's inputs are validated before they reach
 * the store (where a bad value would either trip the workspace.risk
 * schema or, worse, persist a corrupt entity).
 *
 * ─── Threshold buckets (matches riskColor in the client) ──────────────
 * The in-app heatmap colours risks in four bands (risk-register-client
 * .tsx:76-81):
 *
 *   score ≥ 16 → critical (red    #ef4444)
 *   score ≥ 10 → high     (amber  #f59e0b)
 *   score ≥ 5  → medium   (yellow #facc15)
 *   score < 5  → low      (green  #34d399)
 *
 * The Zod-emitted level values are kept verbatim ("low" | "medium" |
 * "high" | "critical") so an agent's "show me the criticals" query
 * resolves through the same vocabulary the UI uses.
 *
 * ─── ID NAMING ────────────────────────────────────────────────────────
 * Namespace is `tool.risk_register` (snake_case; the user-facing route
 * is /risk-register). Entity kind is `workspace:risk` — single-word, no
 * asymmetry — matching the workspace.risk CRUD's kindFromToolId output
 * and the existing summarize-workspace consumer at intents/summarize-
 * workspace.ts:149.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverGetEntity, serverUpsertEntity } from "../server-store";
import type { Risk } from "@/lib/stores/workspace-types";

/** Entity kind in user_entities — matches kindFromToolId("workspace.risk")
 *  used by the generic workspace CRUD, so reads/writes here line up
 *  byte-for-byte with workspace.risk.* and the summarize-workspace
 *  intent's existing risk fetch. */
const KIND_RISK = "workspace:risk";

/** Closed enum of valid Risk lifecycle statuses. Matches the literal
 *  union in workspace-types.ts:54 verbatim — Zod will reject anything
 *  else at the boundary. */
const STATUSES = ["open", "mitigating", "closed", "accepted"] as const;
const StatusSchema = z.enum(STATUSES);

/** Risk levels keyed by score band. Same vocabulary the in-app heatmap
 *  uses (see riskColor in risk-register-client.tsx:76-81) so an agent
 *  asking about "high" risks gets the same set the user sees. */
type Level = "low" | "medium" | "high" | "critical";

/** Pure threshold helper. Mirrors the >=16 / >=10 / >=5 / <5 bands the
 *  client uses to colour heatmap cells. Keep this in sync with the UI
 *  if those thresholds ever change — drift here means an agent's
 *  classification disagrees with what the user is looking at. */
function levelForScore(score: number): Level {
  if (score >= 16) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

const ws = () => useWorkspaceStore.getState();

/** Probability / impact validator. 1..5 integers — the Risk type is a
 *  closed literal union over those values and the in-app form clamps
 *  anything else (risk-register-client.tsx:67-70). We enforce at the
 *  boundary rather than silently rounding so the agent gets a clear
 *  error when it passes something nonsensical. */
const ScaleSchema = z
  .number()
  .int()
  .min(1)
  .max(5)
  .describe("1..5 scale (Probability or Impact rating on the 5×5 matrix)");

// ──────── tool.risk_register.compute_risk_score ────────
// Pure: probability × impact → {score, level}. No persistence. Agents
// can call this during planning ("what level would a 4×4 risk be?")
// without touching the workspace. No mcpHandler — referentially
// transparent, runs identically on server and client.
registry.register({
  id: "tool.risk_register.compute_risk_score",
  toolId: "tool.risk_register",
  name: "compute_risk_score",
  category: "read",
  description:
    "Compute a 5×5 risk score (probability × impact) and classify it as low / medium / high / critical. Pure — no persistence. Bands: <5 low, 5-9 medium, 10-15 high, ≥16 critical (matches the in-app heatmap colouring).",
  paramsSchema: z.object({
    probability: ScaleSchema,
    impact: ScaleSchema,
  }),
  handler: async (params) => {
    const score = params.probability * params.impact;
    return {
      score,
      level: levelForScore(score),
      formula: "probability × impact (1..5 each → 1..25)",
    };
  },
  // No mcpHandler — pure compute is identical server and client.
});

// ──────── tool.risk_register.list_state ────────
// Snapshot + summary stats. The agent's most common opening question
// for a risk tool is "what's the riskiest thing right now?" — returning
// items, byStatus, byLevel, AND topRisks (top-10 by score) in one
// round-trip avoids a follow-up sort on the agent's end.
registry.register({
  id: "tool.risk_register.list_state",
  toolId: "tool.risk_register",
  name: "list_state",
  category: "read",
  description:
    "List all risks in the workspace with summary breakdowns. Returns {total, byStatus: {open, mitigating, closed, accepted}, byLevel: {low, medium, high, critical}, topRisks: Risk[] (≤10 by score, descending), items: Risk[]}.",
  paramsSchema: z.object({}),
  handler: async () => {
    const items = ws().risks ?? [];
    return summarize(items);
  },
  mcpHandler: async (_params, ctx) => {
    const items = await serverListEntities<Risk>(ctx.userId, KIND_RISK);
    return summarize(items);
  },
});

/** Build the {total, byStatus, byLevel, topRisks, items} response. Kept
 *  as a single helper so the browser-path and MCP-path responses are
 *  guaranteed identical — drift here would mean an agent gets different
 *  shapes depending on whether it's invoked from chat or over MCP. */
function summarize(items: Risk[]) {
  // Pre-initialise every bucket so the agent can index byStatus.open /
  // byLevel.critical without an existence check, even on an empty
  // workspace.
  const byStatus: Record<Risk["status"], number> = {
    open: 0,
    mitigating: 0,
    closed: 0,
    accepted: 0,
  };
  const byLevel: Record<Level, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const scored = items.map((r) => {
    // Defensive: a hand-crafted entity with a string probability would
    // NaN the bucket; coerce via Number() and floor any out-of-range
    // value into [1,5] so the breakdown stays trustworthy.
    const p = clampScale(r.probability);
    const i = clampScale(r.impact);
    const score = p * i;
    if (r.status in byStatus) byStatus[r.status] += 1;
    const level = levelForScore(score);
    byLevel[level] += 1;
    return { risk: r, score, level };
  });
  // topRisks: descending by score, max 10. Ties resolved by the source
  // order (stable sort) — good enough for an at-a-glance list; the
  // agent can re-sort if it cares.
  const topRisks = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((s) => ({ ...s.risk, score: s.score, level: s.level }));
  return { total: items.length, byStatus, byLevel, topRisks, items };
}

/** Clamp a potentially-loose probability/impact value into [1,5]. The
 *  Risk type is a closed literal union but Zustand state can hold
 *  anything that survived a hydration; mirror clampToScale from
 *  risk-register-client.tsx:67-70 so the breakdown matches the UI. */
function clampScale(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

// ──────── tool.risk_register.set_status ────────
// Lifecycle transition. Confirms on "closed" / "accepted" terminal
// states — both remove the risk from the actionable heatmap (see
// risk-register-client.tsx:215, which excludes both from the matrix
// grid). "accepted" means the team has decided not to mitigate; "closed"
// means the risk has been resolved. Both are points of no return in
// the sense that flipping back loses the survival-analysis closure
// timestamp unless the agent restores `resolvedAt` manually.
//
// On `status === "closed"` we set `resolvedAt = now()` if missing —
// mirrors the in-app onValueChange handler in risk-register-client.tsx
// :629-634 so the Kaplan-Meier survival chart picks the transition up.
registry.register({
  id: "tool.risk_register.set_status",
  toolId: "tool.risk_register",
  name: "set_status",
  category: "write",
  // requiresConfirmation is set dynamically in the handler via a
  // ctx.confirm call when transitioning to "closed" or "accepted".
  // The static flag stays false so other transitions (open ↔
  // mitigating) don't gate.
  requiresConfirmation: false,
  description:
    "Update a risk's lifecycle status (open / mitigating / closed / accepted). Transitions to 'closed' or 'accepted' are treated as terminal — agents are prompted via ctx.confirm where available. 'closed' also stamps resolvedAt if missing so survival analysis is preserved.",
  paramsSchema: z.object({
    id: z.string(),
    status: StatusSchema,
  }),
  handler: async (params, ctx) => {
    const current = (ws().risks ?? []).find((r) => r.id === params.id);
    if (!current) return { updated: false, reason: "not-found" as const };
    if (current.status === params.status) {
      // No-op: same status. Avoid bumping the entity needlessly so the
      // history feed doesn't show a fake transition.
      return { updated: false, reason: "already-in-status" as const };
    }
    if ((params.status === "closed" || params.status === "accepted") && ctx.confirm) {
      const ok = await ctx.confirm(
        `Mark risk "${current.title}" as ${params.status}? This removes it from the actionable heatmap — closed/accepted risks are treated as resolved or out-of-scope.`
      );
      if (!ok) return { updated: false, reason: "declined" as const };
    }
    const next: Risk = { ...current, status: params.status };
    if (params.status === "closed" && !next.resolvedAt) {
      // Stamp closure date so K-M survival analysis picks it up.
      // Use yyyy-mm-dd to match the in-app todayLocalISO format
      // (risk-register-client.tsx:631).
      next.resolvedAt = new Date().toISOString().slice(0, 10);
    }
    ws().upsertRisk(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const current = await serverGetEntity<Risk>(ctx.userId, KIND_RISK, params.id);
    if (!current) return { updated: false, reason: "not-found" as const };
    if (current.status === params.status) {
      return { updated: false, reason: "already-in-status" as const };
    }
    // MCP path has no interactive confirm (ctx.confirm is undefined);
    // terminal-state transitions are at the caller's discretion. See
    // the file header for the rationale.
    const next: Risk = { ...current, status: params.status };
    if (params.status === "closed" && !next.resolvedAt) {
      next.resolvedAt = new Date().toISOString().slice(0, 10);
    }
    await serverUpsertEntity<Risk>(ctx.userId, KIND_RISK, next);
    return { updated: true };
  },
});

// ──────── tool.risk_register.set_mitigation ────────
// Set the mitigation plan (and optionally a due date). Cleanup
// convenience: if the risk is currently "open" we auto-transition it
// to "mitigating" — having a mitigation plan and a status of "open"
// is contradictory in the data model, and forcing the agent to chain
// set_status afterward is friction without benefit.
//
// We do NOT auto-transition from any other status (closed/accepted
// shouldn't quietly reopen just because someone added a note;
// mitigating obviously stays put). Returns {updated, transitioned}
// so the agent can tell whether the status flipped.
registry.register({
  id: "tool.risk_register.set_mitigation",
  toolId: "tool.risk_register",
  name: "set_mitigation",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the mitigation plan (and optional ISO yyyy-mm-dd due date) on a risk. Auto-transitions status from 'open' to 'mitigating' as a cleanup convenience — other statuses are left untouched. Returns {updated, transitioned} so the agent knows if the status changed.",
  paramsSchema: z.object({
    id: z.string(),
    mitigation: z.string().min(1).max(2000),
    mitigationDueAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date format yyyy-mm-dd")
      .optional()
      .describe("Optional target date (ISO yyyy-mm-dd) by which mitigation should complete"),
  }),
  handler: async (params) => {
    const current = (ws().risks ?? []).find((r) => r.id === params.id);
    if (!current) return { updated: false, transitioned: false };
    const transitioned = current.status === "open";
    const next: Risk = {
      ...current,
      mitigation: params.mitigation,
      ...(params.mitigationDueAt ? { mitigationDueAt: params.mitigationDueAt } : {}),
      ...(transitioned ? { status: "mitigating" as const } : {}),
    };
    ws().upsertRisk(next);
    return { updated: true, transitioned };
  },
  mcpHandler: async (params, ctx) => {
    const current = await serverGetEntity<Risk>(ctx.userId, KIND_RISK, params.id);
    if (!current) return { updated: false, transitioned: false };
    const transitioned = current.status === "open";
    const next: Risk = {
      ...current,
      mitigation: params.mitigation,
      ...(params.mitigationDueAt ? { mitigationDueAt: params.mitigationDueAt } : {}),
      ...(transitioned ? { status: "mitigating" as const } : {}),
    };
    await serverUpsertEntity<Risk>(ctx.userId, KIND_RISK, next);
    return { updated: true, transitioned };
  },
});
