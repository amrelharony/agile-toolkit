/**
 * Meeting Audit — tool-local actions.
 *
 * Category: Continuous Improvement (on the More tools shelf)
 *
 * Agent surface: tool.meeting_audit.*
 *   1. list_state      — the meetings as the page lists them (the costliest
 *                        first): person-hours a week, ratings by question,
 *                        average, verdict and notes; the summary, the page's
 *                        sentence and the ritual reset plan.
 *   2. rate            — set (or clear) a meeting's ratings, 1–5 per question.
 *   3. set_verdict     — keep, change or drop a meeting (or clear it), with
 *                        the notes on what to change.
 *   4. suggest_changes — up to five concrete changes, by the page's rules
 *                        (the AI task's fallback). Pure.
 *   5. accept_change   — add one change to a meeting's notes and mark it to
 *                        change, as the page's "Add to plan" does.
 * Backing CRUD: workspace.meeting_audit.* (defineCrudActions in
 * workspace/index.ts: create, list, update, delete, each write stamped).
 *
 * One store: workspace.meetingAudits (kind "workspace:meetingAudit"). Cost
 * is attendees × minutes × meetings a week (daily 5, weekly 1, fortnightly
 * ½, monthly 12/52, quarterly 4/52), in person-hours, as on the page.
 */

import { z } from "zod";
import { registry } from "../registry";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  MEETING_AUDIT_KIND,
  MEETING_VERDICTS,
  TOOL_TEXT_MAX,
  type MeetingAudit,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  AUDIT_QUESTIONS,
  AUDIT_QUESTION_IDS,
  CADENCE_PER_WEEK,
  RATING_MAX,
  RATING_MIN,
  auditSummary,
  auditVerdict,
  countedAudits,
  meetingAudits,
  meetingScore,
  ratingOf,
  resetPlan,
  ruleChanges,
  weeklyHours,
  withChange,
  withRating,
} from "@/lib/meeting-audit/model";

const ws = () => useWorkspaceStore.getState();

type Out = Record<string, unknown>;

/** Where the meetings live: the browser's workspace, or the user's rows on the server. */
interface AuditStore {
  list(): Promise<MeetingAudit[]>;
  put(a: MeetingAudit): Promise<void>;
}

const browserStore: AuditStore = {
  list: async () => ws().meetingAudits ?? [],
  put: async (a) => ws().upsertMeetingAudit(a),
};

function serverStore(userId: string): AuditStore {
  return {
    list: () => serverListEntities<MeetingAudit>(userId, MEETING_AUDIT_KIND),
    put: async (a) => {
      await serverUpsertEntity<MeetingAudit>(userId, MEETING_AUDIT_KIND, a);
    },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The stored row and its reading, or null when no meeting has that id. */
async function findMeeting(
  store: AuditStore,
  id: string
): Promise<{ raw: MeetingAudit; audit: MeetingAudit } | null> {
  const raw = (await store.list()).find((a) => a.id === id);
  const audit = raw ? meetingAudits([raw])[0] : undefined;
  return raw && audit ? { raw, audit } : null;
}

/* ── tool.meeting_audit.list_state ───────────────────────────────────── */

async function listState(store: AuditStore): Promise<Out> {
  const audits = meetingAudits(await store.list());
  const counted = countedAudits(audits);
  const summary = auditSummary(counted);
  const plan = resetPlan(counted);
  const names = (list: MeetingAudit[]) => list.map((a) => ({ id: a.id, meeting: a.meeting }));
  return {
    questions: AUDIT_QUESTIONS.map((q) => ({ id: q.id, label: q.label, question: q.question })),
    verdict: auditVerdict(summary),
    summary: {
      meetings: summary.meetings,
      weeklyHours: round1(summary.weeklyHours),
      rated: summary.rated,
      fullyRated: summary.fullyRated,
      verdicts: summary.verdicts,
      hoursFreed: round1(summary.hoursFreed),
      hoursToChange: round1(summary.hoursToChange),
    },
    plan: {
      keep: names(plan.keep),
      change: plan.change.map((a) => ({ id: a.id, meeting: a.meeting, notes: a.notes ?? null })),
      drop: names(plan.drop),
      undecided: names(plan.undecided),
      hoursNow: round1(plan.hoursNow),
      hoursAfter: round1(plan.hoursAfter),
    },
    examples: audits.filter((a) => isExampleId(a.id)).length,
    meetings: audits.map((a) => {
      const score = meetingScore(a);
      return {
        id: a.id,
        meeting: a.meeting,
        cadence: a.cadence,
        minutes: a.minutes,
        attendees: a.attendees,
        purpose: a.purpose,
        weeklyHours: round1(weeklyHours(a)),
        ratings: Object.fromEntries(AUDIT_QUESTION_IDS.map((id) => [id, ratingOf(a, id)])),
        averageRating: score === null ? null : round1(score),
        verdict: a.verdict ?? null,
        notes: a.notes ?? null,
        example: isExampleId(a.id),
      };
    }),
  };
}

registry.register({
  id: "tool.meeting_audit.list_state",
  toolId: "tool.meeting_audit",
  name: "list_state",
  category: "read",
  description: `List the Meeting Audit as the page shows it: the team's recurring meetings, the costliest first, each with its person-hours a week (attendees × minutes × meetings a week: ${Object.entries(
    CADENCE_PER_WEEK
  )
    .map(([c, n]) => `${c} ${round1(n)}`)
    .join(
      ", "
    )}), ratings 1–5 by question (null: not rated), average, verdict (keep | change | drop | null) and notes (what to change). Returns {questions: {id, label, question}[], verdict (the page's sentence), summary: {meetings, weeklyHours, rated, fullyRated, verdicts: {keep, change, drop, none}, hoursFreed (by drops), hoursToChange}, plan: {keep, change (with notes), drop, undecided, hoursNow, hoursAfter}, examples, meetings: {id, meeting, cadence, minutes, attendees, purpose, weeklyHours, ratings, averageRating | null, verdict | null, notes | null, example}[]}. Summary and plan count the team's own meetings (the example's only while there are none). Add, edit and delete meetings with workspace.meeting_audit.*.`,
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── tool.meeting_audit.rate ─────────────────────────────────────────── */

const Rating = z.number().int().min(RATING_MIN).max(RATING_MAX).nullable().optional();

const RateParams = z.object({
  id: z.string().min(1).describe("The meeting's id (see list_state)."),
  ratings: z
    .object({
      purpose: Rating,
      people: Rating,
      outcome: Rating,
      length: Rating,
      energy: Rating,
    })
    .describe(
      "1 (not at all) to 5 (always) per question; null clears one; questions left out stay as they are."
    ),
});

async function rate(store: AuditStore, params: z.infer<typeof RateParams>): Promise<Out> {
  const found = await findMeeting(store, params.id);
  if (!found) return { updated: false, reason: "not_found" };
  let ratings = found.raw.ratings ?? {};
  const changed: string[] = [];
  for (const id of AUDIT_QUESTION_IDS) {
    const v = params.ratings[id];
    if (v === undefined) continue;
    ratings = withRating(ratings, id, v);
    changed.push(id);
  }
  if (changed.length === 0) return { updated: false, reason: "nothing_to_rate" };
  const next = { ...found.raw, ratings, updatedAt: new Date().toISOString() };
  await store.put(next);
  const score = meetingScore(next);
  return {
    updated: true,
    id: found.audit.id,
    rated: changed,
    averageRating: score === null ? null : round1(score),
  };
}

registry.register({
  id: "tool.meeting_audit.rate",
  toolId: "tool.meeting_audit",
  name: "rate",
  category: "write",
  requiresConfirmation: false,
  description: `Rate a meeting with the team, as the page's Rate panel does: 1 (not at all) to 5 (always) on ${AUDIT_QUESTIONS.map(
    (q) => `${q.id} (${q.question})`
  ).join(
    "; "
  )}. null clears a rating; questions left out stay as they are. Params: id, ratings. Returns {updated: true, id, rated: questionId[], averageRating | null} or {updated: false, reason: 'not_found' | 'nothing_to_rate'}.`,
  paramsSchema: RateParams,
  handler: async (params) => rate(browserStore, params),
  mcpHandler: async (params, ctx) => rate(serverStore(ctx.userId), params),
});

/* ── tool.meeting_audit.set_verdict ──────────────────────────────────── */

const VerdictParams = z.object({
  id: z.string().min(1).describe("The meeting's id (see list_state)."),
  verdict: z.enum(MEETING_VERDICTS).nullable().describe("keep | change | drop; null clears it."),
  notes: z
    .string()
    .max(TOOL_TEXT_MAX.long)
    .optional()
    .describe("What to change: replaces the meeting's notes when given; '' clears them."),
});

async function setVerdict(store: AuditStore, params: z.infer<typeof VerdictParams>): Promise<Out> {
  const found = await findMeeting(store, params.id);
  if (!found) return { updated: false, reason: "not_found" };
  const next: MeetingAudit = { ...found.raw, updatedAt: new Date().toISOString() };
  if (params.verdict) next.verdict = params.verdict;
  else delete next.verdict;
  if (params.notes !== undefined) {
    const notes = params.notes.trim();
    if (notes) next.notes = notes;
    else delete next.notes;
  }
  await store.put(next);
  return { updated: true, id: found.audit.id, verdict: next.verdict ?? null };
}

registry.register({
  id: "tool.meeting_audit.set_verdict",
  toolId: "tool.meeting_audit",
  name: "set_verdict",
  category: "write",
  requiresConfirmation: false,
  description:
    "Give a meeting its verdict, as the page's Verdict buttons do: keep, change or drop (null clears it); with notes (what to change), which replace the meeting's notes when given ('' clears them). Agree it with the user first: it is the team's call. Params: id, verdict, notes?. Returns {updated: true, id, verdict | null} or {updated: false, reason: 'not_found'}.",
  paramsSchema: VerdictParams,
  handler: async (params) => setVerdict(browserStore, params),
  mcpHandler: async (params, ctx) => setVerdict(serverStore(ctx.userId), params),
});

/* ── tool.meeting_audit.suggest_changes ──────────────────────────────── */

async function suggestChanges(store: AuditStore): Promise<Out> {
  const counted = countedAudits(meetingAudits(await store.list()));
  const names = new Map(counted.map((a) => [a.id, a.meeting]));
  return {
    changes: ruleChanges(counted).map((c) => ({ ...c, meeting: names.get(c.meetingId) ?? "" })),
  };
}

registry.register({
  id: "tool.meeting_audit.suggest_changes",
  toolId: "tool.meeting_audit",
  name: "suggest_changes",
  category: "read",
  description:
    "Suggest up to five concrete changes to the team's meetings by the page's rules (what 'Suggest changes' offers without AI): a daily meeting over 15 minutes is timeboxed, a long one with no outcome is cut, one with the wrong people trimmed, a status meeting moved to writing, a low-energy one given a new format; one per meeting first, the costliest first, never for a meeting marked to drop or a Scrum event dropped. Only suggests: confirm with the user, then accept_change. Returns {changes: {meetingId, meeting, change, why}[]}.",
  paramsSchema: z.object({}),
  handler: async () => suggestChanges(browserStore),
  mcpHandler: async (_params, ctx) => suggestChanges(serverStore(ctx.userId)),
});

/* ── tool.meeting_audit.accept_change ────────────────────────────────── */

const AcceptParams = z.object({
  id: z.string().min(1).describe("The meeting's id (see list_state)."),
  change: z
    .string()
    .max(200)
    .refine((v) => v.trim() !== "", { message: "can't be blank" })
    .describe("The change, as an instruction: 'Timebox it to 15 minutes'."),
});

async function acceptChange(store: AuditStore, params: z.infer<typeof AcceptParams>): Promise<Out> {
  const found = await findMeeting(store, params.id);
  if (!found) return { updated: false, reason: "not_found" };
  const next = withChange(found.audit, params.change);
  // The stored row keeps any field the reading left out; notes, verdict and the stamp change.
  await store.put({
    ...found.raw,
    ...(next.notes ? { notes: next.notes } : {}),
    ...(next.verdict ? { verdict: next.verdict } : {}),
    updatedAt: next.updatedAt,
  });
  return {
    updated: true,
    id: found.audit.id,
    verdict: next.verdict ?? null,
    notes: next.notes ?? null,
  };
}

registry.register({
  id: "tool.meeting_audit.accept_change",
  toolId: "tool.meeting_audit",
  name: "accept_change",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a change to a meeting's plan, as the page's 'Add to plan' does: the change goes on its own line in the meeting's notes (not twice) and its verdict becomes change, unless the team marked it to drop. Params: id, change. Returns {updated: true, id, verdict, notes} or {updated: false, reason: 'not_found'}.",
  paramsSchema: AcceptParams,
  handler: async (params) => acceptChange(browserStore, params),
  mcpHandler: async (params, ctx) => acceptChange(serverStore(ctx.userId), params),
});
