/**
 * Risk Register — tool-local actions.
 *
 * Category: Portfolio, Discovery & Risk
 * Tool:     5×5 probability × impact register with mitigation tracking
 *
 * Agent surface: tool.risk_register.*
 *   1. compute_risk_score — pure: probability × impact → {score, level}.
 *   2. list_state         — the risks as the register lists them: score,
 *                           level, residual, overdue, age in sprints, the
 *                           impediment each was raised as, the verdict.
 *   3. set_status         — lifecycle move (open → mitigating → accepted /
 *                           closed); closing takes a day (backdated, never
 *                           future). Confirms on closed / accepted.
 *   4. set_mitigation     — the plan, its due date and the residual rating
 *                           (both or neither); open → mitigating when a
 *                           plan is written.
 *   5. set_owner          — who owns it, with the roster's spelling.
 *   6. delete             — remove a risk (final for an agent).
 *   7. raise_impediment   — the risk happened: raise it as an impediment
 *                           (its level becomes the severity) and link it.
 * Backing CRUD: workspace.risk.{create,list,update,delete} (defineCrudActions
 * in workspace/index.ts; every write there stamps updatedAt too, an update
 * merges into the risk as listed here, and a delete of a row still in the
 * old blob is refused with 'pending_move' as below).
 *
 * One store: workspace.risks since Phase 8. Every number comes from
 * lib/risks/model, the same reading the page, the hand-off and the next
 * steps use. Reads include the old register blob's rows still waiting for
 * the page's one-time move (lib/risks/legacy-register: the blob and its
 * moved-ids record, from this browser's storage or the user's user_state
 * rows on the server), so an agent sees what the page lists; a write on
 * such a row saves the merged row into the workspace. A delete of one is
 * refused ('pending_move'): only the page can mark it moved.
 *
 * Every write stamps `updatedAt` (the move then knows the workspace's copy
 * is the newer one). Days are the user's local "YYYY-MM-DD"; over MCP the
 * server's day may be behind the user's, so the day after it is accepted
 * too. Age in sprints divides by the cadence's sprintLengthDays (14 when
 * unset).
 *
 * Entity kind: "workspace:risk", matching the browser sync and the CRUD.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
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
  type Impediment,
  type Risk,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import { enoughData } from "@/lib/analytics/min-sample";
import { kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { normalizeCadence } from "@/lib/sprints/cadence";
import { isIsoDate } from "@/lib/sprints/calendar";
import {
  RISK_OWNER_MAX,
  RISK_STATUSES,
  RISK_TEXT_MAX,
  closedOn,
  compareRisks,
  impedimentLinkOf,
  isActiveRisk,
  isHighLevel,
  isRiskOverdue,
  residualAboveCurrent,
  residualScore,
  riskAgeDays,
  riskAgeSprints,
  riskDaysOverdue,
  riskImpedimentSource,
  riskLevel,
  riskScore,
  riskSummary,
  riskVerdict,
} from "@/lib/risks/model";
import {
  RISK_REGISTER_KEY,
  RISK_REGISTER_MOVED_KEY,
  isPendingRiskRow,
  withPendingRisks,
} from "@/lib/risks/legacy-register";
import { buildImpediment } from "@/lib/handoffs/targets/impediment";
import { addDays, isResolved } from "@/lib/impediments/model";
import { findRosterMember } from "@/lib/team/names";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";

/** MUST match registerCollection("risk", "risks") in workspace-store.ts and the workspace.risk CRUD. */
export const KIND_RISK = "workspace:risk";
const KIND_IMPEDIMENT = "workspace:impediment";
const KIND_MEMBER = "workspace:teamMember";
const KIND_CADENCE = "workspace:ceremonyCadence";

const ws = () => useWorkspaceStore.getState();

/* ── The store adapter ───────────────────────────────────────────────── */

export interface RiskRecords {
  /** Every risk as the register lists it. */
  records: Risk[];
  /** Ids of rows of the old register blob still waiting for the page's move. */
  pendingIds: string[];
}

/** Where the risks live: the browser's workspace, or the user's rows on the server. */
export interface RiskStore {
  onServer: boolean;
  list(): Promise<RiskRecords>;
  /** Save a risk under its id (already stamped). */
  put(r: Risk): Promise<void>;
  remove(id: string): Promise<void>;
  roster(): Promise<TeamMember[]>;
  impediments(): Promise<Impediment[]>;
  putImpediment(i: Impediment): Promise<void>;
  /** The team's sprint length in days (the cadence's; 14 when unset). */
  sprintLengthDays(): Promise<number>;
}

const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

/** The risks as the page reads them: the workspace's and the old blob's pending rows. */
function recordsFrom(risks: readonly Risk[] | undefined, blob: unknown, movedRaw: unknown) {
  const moved = idsOf(movedRaw);
  const records = withPendingRisks(risks ?? [], blob, moved);
  return {
    records,
    pendingIds: records.filter((r) => isPendingRiskRow(r.id, blob, moved)).map((r) => r.id),
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

export const browserRiskStore: RiskStore = {
  onServer: false,
  list: async () =>
    recordsFrom(ws().risks, browserBlob(RISK_REGISTER_KEY), browserBlob(RISK_REGISTER_MOVED_KEY)),
  put: async (r) => ws().upsertRisk(r),
  // The store's remove unpins canvas cards, as the page's delete does
  // (without its browser-only blob write: a pending row is refused first).
  remove: async (id) => {
    if ((ws().risks ?? []).some((r) => r.id === id)) ws().removeRisk(id);
  },
  roster: async () => ws().teamMembers ?? [],
  impediments: async () => ws().impediments ?? [],
  putImpediment: async (i) => ws().upsertImpediment(i),
  sprintLengthDays: async () =>
    normalizeCadence((ws().ceremonyCadences ?? []).find((d) => d.id === CEREMONY_CADENCE_ID))
      .sprintLengthDays,
};

export function serverRiskStore(userId: string): RiskStore {
  return {
    onServer: true,
    list: async () => {
      const [risks, blob, moved] = await Promise.all([
        serverListEntities<Risk>(userId, KIND_RISK),
        serverGetUserStateBlob(userId, RISK_REGISTER_KEY),
        serverGetUserStateBlob(userId, RISK_REGISTER_MOVED_KEY),
      ]);
      return recordsFrom(risks, blob, moved);
    },
    put: async (r) => {
      await serverUpsertEntity<Risk>(userId, KIND_RISK, r);
    },
    remove: async (id) => {
      await serverDeleteEntity(userId, KIND_RISK, id);
    },
    roster: async () => serverListEntities<TeamMember>(userId, KIND_MEMBER),
    impediments: async () => serverListEntities<Impediment>(userId, KIND_IMPEDIMENT),
    putImpediment: async (i) => {
      await serverUpsertEntity<Impediment>(userId, KIND_IMPEDIMENT, i);
    },
    sprintLengthDays: async () =>
      normalizeCadence(
        await serverGetEntity<CeremonyCadenceDoc>(userId, KIND_CADENCE, CEREMONY_CADENCE_ID)
      ).sprintLengthDays,
  };
}

/** The risk as saved by a verb: stamped, so the move reads the workspace's copy as the newer one. */
const stamped = (r: Risk): Risk => ({ ...r, updatedAt: new Date().toISOString() });

type Out = Record<string, unknown>;

/* ── Days ────────────────────────────────────────────────────────────── */

/**
 * The latest day a verb takes: today in the browser; on the server, whose
 * day (UTC on a typical deploy) isn't the user's, the day after it, so a
 * user ahead of UTC can date a move on their own today.
 */
const latestDay = (today: string, onServer: boolean): string =>
  onServer ? addDays(today, 1) : today;

/**
 * The day a close is stamped with when none is given: today, or the day it
 * was raised when that is later and still allowed (on the server today can
 * be the user's yesterday, and a risk raised on their today must not read
 * as closed before it was raised).
 */
function stampDay(r: Risk, today: string, latest: string): string {
  const raised = (r.raisedAt ?? "").slice(0, 10);
  return isIsoDate(raised) && raised > today && raised <= latest ? raised : today;
}

/** Why `day` can't date a move on `r` (after `latest`, before it was raised), or null. */
function dayProblem(
  day: string,
  r: Risk,
  latest: string
): "not_a_day" | "future_day" | "before_raised" | null {
  if (!isIsoDate(day)) return "not_a_day";
  if (day > latest) return "future_day";
  const raised = (r.raisedAt ?? "").slice(0, 10);
  if (isIsoDate(raised) && day < raised) return "before_raised";
  return null;
}

/* ── Views ───────────────────────────────────────────────────────────── */

/** The impediment a risk was raised as, while it still exists, and whether it is resolved. */
function raisedImpediment(r: Risk, impediments: readonly Impediment[]) {
  const link = impedimentLinkOf(r);
  const imp = link ? impediments.find((i) => i.id === link.targetId) : undefined;
  return imp ? { id: imp.id, resolved: isResolved(imp) } : null;
}

/** One risk as list_state returns it: the stored fields plus what the register shows. */
export function riskView(
  r: Risk,
  today: string,
  sprintLengthDays: number,
  impediments: readonly Impediment[],
  pendingIds: readonly string[] = []
) {
  const score = riskScore(r);
  const after = residualScore(r);
  return {
    ...r,
    score,
    level: riskLevel(score),
    residualScore: after,
    residualLevel: after === null ? null : riskLevel(after),
    residualAboveCurrent: residualAboveCurrent(r),
    active: isActiveRisk(r),
    overdue: isRiskOverdue(r, today),
    daysOverdue: riskDaysOverdue(r, today),
    ageDays: riskAgeDays(r, today),
    ageSprints: riskAgeSprints(r, sprintLengthDays, today),
    closedOn: closedOn(r) ?? null,
    impediment: raisedImpediment(r, impediments),
    example: isExampleId(r.id),
    pending: pendingIds.includes(r.id),
  };
}

/**
 * How long risks take to close, as the page's "Median time to mitigate"
 * reads it (app/(tools)/risk-register/analysis.ts timeToClose, the same
 * lib calls): days from raised to closed (riskAgeDays, closedOn), open
 * and mitigating risks counted as still waiting at today, accepted ones
 * left out; the Kaplan-Meier median from MIN_SAMPLE.average closed risks
 * (null below it, or while fewer than half have closed).
 */
export function timeToClose(
  risks: readonly Risk[],
  today: string
): { closed: number; medianDays: number | null } {
  const observations = risks.flatMap((r) => {
    if (r.status === "accepted") return [];
    const duration = riskAgeDays(r, today);
    return duration === null ? [] : [{ duration, event: closedOn(r) !== undefined }];
  });
  const closed = observations.filter((o) => o.event).length;
  return {
    closed,
    medianDays: enoughData(closed, "average")
      ? medianSurvivalTime(kaplanMeier(observations))
      : null,
  };
}

/* ── Schemas ─────────────────────────────────────────────────────────── */

const StatusSchema = z.enum(RISK_STATUSES);

/** 1–5 in whole numbers: the 5×5 matrix's scale. Refused (never clamped) at the boundary. */
const ScaleSchema = z
  .number()
  .int()
  .min(1)
  .max(5)
  .describe("1..5 scale (Probability or Impact rating on the 5×5 matrix)");

const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date format yyyy-mm-dd")
  .describe(
    "YYYY-MM-DD, the user's local day. Pass the user's date: over MCP the server's day may be a day behind theirs, so the day after the server's is taken too."
  );

/* ── tool.risk_register.compute_risk_score ───────────────────────────── */

registry.register({
  id: "tool.risk_register.compute_risk_score",
  toolId: "tool.risk_register",
  name: "compute_risk_score",
  category: "read",
  description:
    "Compute a 5×5 risk score (probability × impact) and classify it as low / medium / high / critical. Pure — no persistence. Bands: <5 low, 5-9 medium, 10-15 high, ≥16 critical (the register's matrix). 'high' (true for high and critical) is the one meaning of a high risk across the toolkit.",
  paramsSchema: z.object({
    probability: ScaleSchema,
    impact: ScaleSchema,
  }),
  handler: async (params) => {
    const score = riskScore(params);
    const level = riskLevel(score);
    return {
      score,
      level,
      high: isHighLevel(level),
      formula: "probability × impact (1..5 each → 1..25)",
    };
  },
  // No mcpHandler — pure compute is identical server and client.
});

/* ── tool.risk_register.list_state ───────────────────────────────────── */

async function listState(store: RiskStore, params: { today?: string }) {
  const today = params.today ?? todayLocalISO();
  const [{ records, pendingIds }, impediments, sprintLengthDays] = await Promise.all([
    store.list(),
    store.impediments(),
    store.sprintLengthDays(),
  ]);
  const ordered = [...records].sort((a, b) => compareRisks(a, b, today));
  const views = ordered.map((r) => riskView(r, today, sprintLengthDays, impediments, pendingIds));
  // The keys from before Phase 8 keep their meaning: every listed risk.
  const byStatus: Record<Risk["status"], number> = {
    open: 0,
    mitigating: 0,
    closed: 0,
    accepted: 0,
  };
  const byLevel = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const v of views) {
    if (v.status in byStatus) byStatus[v.status] += 1;
    byLevel[v.level] += 1;
  }
  const topRisks = views
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  // The new keys read the register as the page does: examples left out.
  const s = riskSummary(records, today);
  return {
    today,
    sprintLengthDays,
    total: records.length,
    byStatus,
    byLevel,
    topRisks,
    items: views,
    active: s.active,
    high: s.high,
    overdue: s.overdue,
    unowned: s.unowned,
    exposure: s.exposure,
    residualExposure: s.residualExposure,
    residualAssessed: s.residualAssessed,
    verdict: riskVerdict(records, today),
    timeToClose: timeToClose(
      records.filter((r) => !isExampleId(r.id)),
      today
    ),
    pending: pendingIds.length,
    examples: records.filter((r) => isExampleId(r.id)).length,
  };
}

registry.register({
  id: "tool.risk_register.list_state",
  toolId: "tool.risk_register",
  name: "list_state",
  category: "read",
  description:
    "List the risks as the Risk Register shows them, in its order (active first, then score, then days overdue, then title), including rows of the old register page not moved in yet. Params: today? (YYYY-MM-DD, the user's day; default today). Returns {today, sprintLengthDays (the cadence's; 14 when unset), total, byStatus: {open, mitigating, closed, accepted}, byLevel: {low, medium, high, critical} (these three count every listed risk, examples included), topRisks (≤10 by score), items: Risk & {score, level, residualScore | null, residualLevel | null, residualAboveCurrent, active, overdue, daysOverdue, ageDays | null, ageSprints | null (whole sprints of the cadence), closedOn | null (resolvedAt only while closed: a reopened risk counts as open), impediment: {id, resolved} | null (what it was raised as), example, pending}, active, high (active and high or critical), overdue, unowned (active with no owner), exposure (Σ score of active risks), residualExposure (Σ residual-or-current score of active risks), residualAssessed, verdict (one sentence), timeToClose: {closed, medianDays | null} (the page's 'Median time to mitigate': the Kaplan-Meier median of days raised → closed, open risks counted as still waiting, accepted ones left out; null below 3 closed risks or while fewer than half have closed), pending (old rows not moved yet), examples} — the summary keys after items leave example rows out.",
  paramsSchema: z.object({ today: DaySchema.optional() }),
  handler: async (params) => listState(browserRiskStore, params),
  mcpHandler: async (params, ctx) => listState(serverRiskStore(ctx.userId), params),
});

/* ── tool.risk_register.set_status ───────────────────────────────────── */

const SetStatusSchema = z.object({
  id: z.string(),
  status: StatusSchema,
  resolvedAt: DaySchema.optional().describe(
    "With status 'closed' only: the day it was closed (default today; never in the future, never before it was raised)."
  ),
});

async function setStatus(
  store: RiskStore,
  p: z.infer<typeof SetStatusSchema>,
  ctx: ActionContext
): Promise<Out> {
  const { records } = await store.list();
  const current = records.find((r) => r.id === p.id);
  if (!current) return { updated: false, reason: "not-found" };
  if (p.resolvedAt !== undefined && p.status !== "closed") {
    return { updated: false, reason: "resolved_at_needs_closed" };
  }
  const today = todayLocalISO();
  const latest = latestDay(today, store.onServer);
  if (p.resolvedAt !== undefined) {
    const why = dayProblem(p.resolvedAt, current, latest);
    if (why) return { updated: false, reason: why };
  }
  const sameStatus = current.status === p.status;
  // Re-dating a close is the one same-status change.
  if (
    sameStatus &&
    !(p.status === "closed" && p.resolvedAt && p.resolvedAt !== current.resolvedAt)
  ) {
    return { updated: false, reason: "already-in-status" };
  }
  if (!sameStatus && (p.status === "closed" || p.status === "accepted") && ctx.confirm) {
    const ok = await ctx.confirm(
      `Mark risk "${current.title}" as ${p.status}? This removes it from the actionable heatmap — closed/accepted risks are treated as resolved or out-of-scope.`
    );
    if (!ok) return { updated: false, reason: "declined" };
  }
  // Closing stamps the day it closed (a reopened risk's earlier date is
  // replaced); any other move keeps resolvedAt, which reads as closed only
  // while the status is closed (lib/risks/model closedOn).
  const next: Risk = {
    ...current,
    status: p.status,
    ...(p.status === "closed"
      ? { resolvedAt: p.resolvedAt ?? stampDay(current, today, latest) }
      : {}),
  };
  await store.put(stamped(next));
  return {
    updated: true,
    status: next.status,
    ...(next.status === "closed" ? { resolvedAt: next.resolvedAt } : {}),
  };
}

registry.register({
  id: "tool.risk_register.set_status",
  toolId: "tool.risk_register",
  name: "set_status",
  category: "write",
  // Confirms in the handler (ctx.confirm) on a move to closed or accepted
  // only, so the routine open ↔ mitigating moves don't gate.
  requiresConfirmation: false,
  description:
    "Update a risk's lifecycle status (open / mitigating / accepted / closed). Moves to 'closed' or 'accepted' take a risk off the matrix and are confirmed where the caller can confirm. Closing stamps resolvedAt with the day given (resolvedAt, YYYY-MM-DD: backdate it; never in the future, never before it was raised) or today; closing an already-closed risk with another resolvedAt re-dates it. Reopening keeps resolvedAt, which counts only while closed. Params: id, status, resolvedAt?. Returns {updated: true, status, resolvedAt?} or {updated: false, reason: 'not-found' | 'already-in-status' | 'declined' | 'resolved_at_needs_closed' | 'not_a_day' | 'future_day' | 'before_raised'}.",
  paramsSchema: SetStatusSchema,
  handler: async (params, ctx) => setStatus(browserRiskStore, params, ctx),
  mcpHandler: async (params, ctx) => setStatus(serverRiskStore(ctx.userId), params, ctx),
});

/* ── tool.risk_register.set_mitigation ───────────────────────────────── */

const SetMitigationSchema = z
  .object({
    id: z.string(),
    mitigation: z
      .string()
      .trim()
      .min(1)
      .max(RISK_TEXT_MAX)
      .optional()
      .describe("The mitigation plan"),
    mitigationDueAt: DaySchema.optional().describe(
      "Optional target date (ISO yyyy-mm-dd) by which mitigation should complete; not before it was raised"
    ),
    residualProbability: ScaleSchema.nullable()
      .optional()
      .describe(
        "1–5 once the plan has worked; with residualImpact (both or neither); null clears both"
      ),
    residualImpact: ScaleSchema.nullable()
      .optional()
      .describe(
        "1–5 once the plan has worked; with residualProbability (both or neither); null clears both"
      ),
  })
  .superRefine((p, ctx) => {
    const rp = p.residualProbability;
    const ri = p.residualImpact;
    const pair =
      (rp === undefined && ri === undefined) ||
      (rp === null && ri === null) ||
      (typeof rp === "number" && typeof ri === "number");
    if (!pair) {
      ctx.addIssue({
        code: "custom",
        path: ["residualImpact"],
        message:
          "Set the residual probability and impact together (or both null to clear), or neither.",
      });
    }
    if (p.mitigation === undefined && p.mitigationDueAt === undefined && rp === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["mitigation"],
        message: "Give a mitigation, a due date or the residual rating.",
      });
    }
  });

async function setMitigation(
  store: RiskStore,
  p: z.infer<typeof SetMitigationSchema>
): Promise<Out> {
  const { records } = await store.list();
  const current = records.find((r) => r.id === p.id);
  if (!current) return { updated: false, transitioned: false };
  if (p.mitigationDueAt !== undefined) {
    if (!isIsoDate(p.mitigationDueAt)) {
      return { updated: false, transitioned: false, reason: "not_a_day" };
    }
    const raised = (current.raisedAt ?? "").slice(0, 10);
    if (isIsoDate(raised) && p.mitigationDueAt < raised) {
      return { updated: false, transitioned: false, reason: "due_before_raised" };
    }
  }
  // A plan written for an open risk moves it to mitigating; no other status moves.
  const transitioned = p.mitigation !== undefined && current.status === "open";
  const next: Risk = {
    ...current,
    ...(p.mitigation !== undefined ? { mitigation: p.mitigation } : {}),
    ...(p.mitigationDueAt !== undefined ? { mitigationDueAt: p.mitigationDueAt } : {}),
    ...(transitioned ? { status: "mitigating" as const } : {}),
  };
  if (typeof p.residualProbability === "number" && typeof p.residualImpact === "number") {
    next.residualProbability = p.residualProbability as Risk["probability"];
    next.residualImpact = p.residualImpact as Risk["impact"];
  } else if (p.residualProbability === null) {
    delete next.residualProbability;
    delete next.residualImpact;
  }
  await store.put(stamped(next));
  const after = residualScore(next);
  return {
    updated: true,
    transitioned,
    score: riskScore(next),
    residualScore: after,
    // Warned, never refused: a plan can make a risk likelier for a while.
    ...(residualAboveCurrent(next) ? { warning: "residual_above_current" } : {}),
  };
}

registry.register({
  id: "tool.risk_register.set_mitigation",
  toolId: "tool.risk_register",
  name: "set_mitigation",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a risk's mitigation plan, its due date (YYYY-MM-DD, not before the risk was raised) and/or its residual rating, the probability and impact once the plan has worked (1–5 each, both or neither; both null clears it). Writing a plan moves an 'open' risk to 'mitigating'; other statuses are left alone. Params: id, mitigation?, mitigationDueAt?, residualProbability?, residualImpact? (at least one). Returns {updated: true, transitioned, score, residualScore | null, warning?: 'residual_above_current' (the residual score is higher than the current one: saved, but check it)} or {updated: false, transitioned: false, reason?: 'not_a_day' | 'due_before_raised'} (no reason: unknown id).",
  paramsSchema: SetMitigationSchema,
  handler: async (params) => setMitigation(browserRiskStore, params),
  mcpHandler: async (params, ctx) => setMitigation(serverRiskStore(ctx.userId), params),
});

/* ── tool.risk_register.set_owner ────────────────────────────────────── */

const SetOwnerSchema = z.object({
  id: z.string(),
  owner: z
    .string()
    .trim()
    .max(RISK_OWNER_MAX)
    .describe("Who owns the risk (the roster's spelling is used); an empty string clears it"),
});

async function setOwner(store: RiskStore, p: z.infer<typeof SetOwnerSchema>): Promise<Out> {
  const [{ records }, roster] = await Promise.all([store.list(), store.roster()]);
  const current = records.find((r) => r.id === p.id);
  if (!current) return { updated: false, reason: "not_found" };
  const member = findRosterMember(roster, p.owner);
  const owner = member?.name ?? p.owner;
  const result = { updated: true, owner: owner || null, onTeam: Boolean(member) };
  if ((current.owner ?? "") === owner) return result;
  const next: Risk = { ...current, ...(owner ? { owner } : {}) };
  if (!owner) delete next.owner;
  await store.put(stamped(next));
  return result;
}

registry.register({
  id: "tool.risk_register.set_owner",
  toolId: "tool.risk_register",
  name: "set_owner",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set who owns a risk; a name on the team roster is stored with the roster's spelling, and an empty owner clears it. Params: id, owner. Returns {updated: true, owner | null, onTeam} or {updated: false, reason: 'not_found'}.",
  paramsSchema: SetOwnerSchema,
  handler: async (params) => setOwner(browserRiskStore, params),
  mcpHandler: async (params, ctx) => setOwner(serverRiskStore(ctx.userId), params),
});

/* ── tool.risk_register.delete ───────────────────────────────────────── */

/**
 * Delete a risk as the page does (canvas cards pinned to it are unpinned).
 * A row of the old register page still waiting for the page's move is
 * refused: deleting it has to mark it moved in the user's storage, which
 * only the page can do, or the move would bring it back.
 */
async function deleteRisk(store: RiskStore, id: string, ctx: ActionContext): Promise<Out> {
  const { records, pendingIds } = await store.list();
  const r = records.find((x) => x.id === id);
  if (!r) return { deleted: false, reason: "not_found" };
  if (pendingIds.includes(id)) {
    return {
      deleted: false,
      reason: "pending_move",
      message:
        "This risk is still moving in from the old Risk Register page: open the Risk Register once, then delete it (or delete it there).",
    };
  }
  if (ctx.confirm) {
    const ok = await ctx.confirm(
      `Delete risk "${r.title || r.id}"? An agent's delete can't be undone.`
    );
    if (!ok) return { deleted: false, confirmed: false };
  }
  await store.remove(id);
  return { deleted: true, id, title: r.title };
}

registry.register({
  id: "tool.risk_register.delete",
  toolId: "tool.risk_register",
  name: "delete",
  category: "write",
  requiresConfirmation: true,
  description:
    "Delete a risk, as the page's delete does (canvas cards pinned to it are unpinned). Final for an agent (the page offers Undo): confirm with the user first. Params: id. Returns {deleted: true, id, title} or {deleted: false, reason: 'not_found' | 'pending_move', message?} or {deleted: false, confirmed: false}. 'pending_move': a row of the old Risk Register page not moved in yet; open the Risk Register once, then delete it.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params, ctx) => deleteRisk(browserRiskStore, params.id, ctx),
  mcpHandler: async (params, ctx) => deleteRisk(serverRiskStore(ctx.userId), params.id, ctx),
});

/* ── tool.risk_register.raise_impediment ─────────────────────────────── */

/**
 * The risk happened: raise it as an impediment, as the page's "Raise as
 * impediment" does (lib/risks/model riskImpedimentSource: the level is the
 * severity, the mitigation plan goes in the description, the owner and a
 * link back), and record the link on the risk (sentTo). The risk's status
 * is left as it is; once the impediment is resolved, list_state shows it
 * (impediment.resolved) for the risk to be closed.
 */
async function raiseImpediment(store: RiskStore, id: string): Promise<Out> {
  const [{ records }, impediments] = await Promise.all([store.list(), store.impediments()]);
  const r = records.find((x) => x.id === id);
  if (!r) return { raised: false, reason: "not_found" };
  if (isExampleId(r.id)) return { raised: false, reason: "example" };
  if (!isActiveRisk(r)) return { raised: false, reason: "not_active" };
  if (!r.title.trim()) return { raised: false, reason: "untitled" };
  const live = raisedImpediment(r, impediments);
  if (live) return { raised: false, reason: "already_raised", impedimentId: live.id };
  const impediment = buildImpediment(riskImpedimentSource(r), `imp_${nanoid(8)}`, todayLocalISO());
  await store.putImpediment(impediment);
  const link: HandoffLink = {
    route: "impediment",
    targetId: impediment.id,
    at: new Date().toISOString(),
  };
  // A dead link on the route (its impediment deleted) is replaced.
  const sentTo = [...(r.sentTo ?? []).filter((l) => l.route !== "impediment"), link];
  await store.put(stamped({ ...r, sentTo }));
  return { raised: true, impedimentId: impediment.id, severity: impediment.severity };
}

registry.register({
  id: "tool.risk_register.raise_impediment",
  toolId: "tool.risk_register",
  name: "raise_impediment",
  category: "write",
  requiresConfirmation: false,
  description:
    "The risk happened: raise an active risk as an impediment, as the page's 'Raise as impediment' does. The impediment gets the title, the description with the mitigation plan, the owner, the risk's level as its severity (low | medium | high | critical) and a link back (sourceRef risk-register); the risk records the link (sentTo) and keeps its status. Once the impediment is resolved, list_state shows impediment.resolved: then close the risk with set_status. Params: id. Returns {raised: true, impedimentId, severity} or {raised: false, reason: 'not_found' | 'example' | 'not_active' | 'untitled' | 'already_raised', impedimentId?}.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params) => raiseImpediment(browserRiskStore, params.id),
  mcpHandler: async (params, ctx) => raiseImpediment(serverRiskStore(ctx.userId), params.id),
});
