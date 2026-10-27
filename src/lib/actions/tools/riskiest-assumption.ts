/**
 * Riskiest Assumption Canvas — tool-local actions.
 *
 * Category: Workshops & Facilitation (squad S11)
 * Tool:     List assumptions, rank them by risk × (6 − evidence), and test
 *           the riskiest as a hypothesis in the Hypothesis Tracker.
 *
 * Agent surface: tool.riskiest_assumption.*
 * Backing CRUD : workspace.riskiest_assumption.* (auto-generated). Singleton:
 *                one canvas document (assumptions[]) under a fixed id.
 *
 *   1. list_state       — the ranking (the page's score and order, rated and
 *                         untested only), the unrated and the tested.
 *   2. add_assumption   — log an assumption; ratings are optional (absent =
 *                         not rated: never ranked or placed).
 *   3. rate_assumption  — set or clear its risk and evidence ratings.
 *   4. set_status       — move an assumption through its validation lifecycle.
 *   5. test_assumption  — the page's "Test": a drafted hypothesis in the
 *                         tracker, linked both ways (once per assumption).
 *
 * The score, ranking and tested rule come from lib/assumptions, which the
 * page uses too. Entity kinds "workspace:riskiestAssumption" and
 * "workspace:hypothesisTracker" (the fixed ids RA_ID and
 * HYPOTHESIS_TRACKER_ID) match the browser sync and the generic CRUD.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  Assumption,
  AssumptionLevel,
  AssumptionStatus,
  HandoffLink,
  HypothesisTracker,
  RiskiestAssumption,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  ASSUMPTION_STATEMENT_MAX,
  ASSUMPTION_STATUSES,
  ASSUMPTION_TEXT_MAX,
  RA_ID,
  assumptionHypothesisSource,
  assumptionScore,
  isRated,
  quadrantOf,
  rankAssumptions,
  ratingOf,
  testResultOf,
} from "@/lib/assumptions/model";
import {
  HYPOTHESIS_TRACKER_ID,
  hypothesisFromSource,
  hypothesisLink,
  linkedTest,
  missingFields,
  withHypothesis,
} from "@/lib/hypotheses/model";

/** MUST match registerCollection("riskiestAssumption", …) in workspace-store.ts. */
const KIND_RA = "workspace:riskiestAssumption";
/** MUST match registerCollection("hypothesisTracker", …) in workspace-store.ts. */
const KIND_HT = "workspace:hypothesisTracker";

const StatusSchema = z.enum(ASSUMPTION_STATUSES);
const LevelSchema = z.number().int().min(1).max(5);

const ws = () => useWorkspaceStore.getState();

/* ── The store adapter ───────────────────────────────────────────────── */

interface CanvasStore {
  canvas(): Promise<RiskiestAssumption | null>;
  put(doc: RiskiestAssumption): Promise<void>;
  tracker(): Promise<HypothesisTracker | null>;
  putTracker(doc: HypothesisTracker): Promise<void>;
}

const browserStore: CanvasStore = {
  canvas: async () => (ws().riskiestAssumptions ?? []).find((d) => d.id === RA_ID) ?? null,
  put: async (doc) => ws().upsertRiskiestAssumption(doc),
  tracker: async () =>
    (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID) ?? null,
  putTracker: async (doc) => ws().upsertHypothesisTracker(doc),
};

function serverStore(userId: string): CanvasStore {
  return {
    canvas: async () => (await serverGetEntity<RiskiestAssumption>(userId, KIND_RA, RA_ID)) ?? null,
    put: async (doc) => {
      await serverUpsertEntity<RiskiestAssumption>(userId, KIND_RA, doc);
    },
    tracker: async () =>
      (await serverGetEntity<HypothesisTracker>(userId, KIND_HT, HYPOTHESIS_TRACKER_ID)) ?? null,
    putTracker: async (doc) => {
      await serverUpsertEntity<HypothesisTracker>(userId, KIND_HT, doc);
    },
  };
}

/** The canvas with assumption `id` replaced by `update(it)`. */
function withAssumption(
  doc: RiskiestAssumption,
  id: string,
  update: (a: Assumption) => Assumption
): RiskiestAssumption {
  return {
    ...doc,
    id: RA_ID,
    assumptions: doc.assumptions.map((a) => (a.id === id ? update(a) : a)),
  };
}

/* ── list_state ──────────────────────────────────────────────────────── */

function summarize(doc: RiskiestAssumption | null, tracker: HypothesisTracker | null) {
  const assumptions = doc?.assumptions ?? [];
  const hypotheses = tracker?.hypotheses ?? [];
  const byStatus: Record<AssumptionStatus, number> = {
    untested: 0,
    testing: 0,
    validated: 0,
    invalidated: 0,
  };
  for (const a of assumptions) if (a.status in byStatus) byStatus[a.status] += 1;
  // Example rows are the page's demo: an agent's ranking leaves them out.
  const { ranked, unrated, tested } = rankAssumptions(
    assumptions.filter((a) => !isExampleId(a.id)),
    hypotheses
  );
  const top = ranked[0];
  return {
    exists: doc !== null,
    total: assumptions.length,
    byStatus,
    riskiest: top
      ? {
          id: top.assumption.id,
          statement: top.assumption.statement,
          riskLevel: ratingOf(top.assumption.riskLevel),
          evidenceLevel: ratingOf(top.assumption.evidenceLevel),
          score: top.score,
        }
      : null,
    ranking: ranked.map((r) => ({
      id: r.assumption.id,
      statement: r.assumption.statement,
      rank: r.rank,
      score: r.score,
      riskLevel: ratingOf(r.assumption.riskLevel),
      evidenceLevel: ratingOf(r.assumption.evidenceLevel),
      quadrant: quadrantOf(r.assumption),
      status: r.assumption.status,
      test: linkedTest(r.assumption.sentTo, hypotheses),
    })),
    unrated: unrated.map((a) => ({ id: a.id, statement: a.statement, status: a.status })),
    tested: tested.map((a) => ({
      id: a.id,
      statement: a.statement,
      status: a.status,
      result: testResultOf(a, hypotheses),
    })),
    assumptions,
  };
}

registry.register({
  id: "tool.riskiest_assumption.list_state",
  toolId: "tool.riskiest_assumption",
  name: "list_state",
  category: "read",
  description:
    "Summarise the riskiest-assumption canvas, ranked as the page ranks it. Returns {exists, total, byStatus: {untested, testing, validated, invalidated}, riskiest ({id, statement, riskLevel, evidenceLevel, score} or null), ranking: [{id, statement, rank, score (risk × (6 − evidence), 1..25; ties go to higher risk, then lower evidence, then the order added), riskLevel, evidenceLevel, quadrant ('test-first' | 'monitor' | 'defer' | 'solid'), status, test: {state: 'none'} | {state: 'testing', hypothesisId, status} | {state: 'tested', hypothesisId, result: 'inconclusive'}}], unrated: [{id, statement, status}] (not rated: never ranked), tested: [{id, statement, status, result: 'validated' | 'invalidated'}] (its status, or its linked hypothesis's result, settled it; an inconclusive test stays ranked), assumptions (as stored)}. Example rows (ids starting 'example-') are left out of riskiest, ranking, unrated and tested.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.canvas(), await browserStore.tracker()),
  mcpHandler: async (_params, ctx) => {
    const store = serverStore(ctx.userId);
    const [doc, tracker] = await Promise.all([store.canvas(), store.tracker()]);
    return summarize(doc, tracker);
  },
});

/* ── add_assumption ──────────────────────────────────────────────────── */

const AddSchema = z.object({
  statement: z.string().min(1).max(ASSUMPTION_STATEMENT_MAX),
  riskLevel: LevelSchema.optional().describe(
    "1–5, how badly it hurts if wrong; leave out when not rated."
  ),
  evidenceLevel: LevelSchema.optional().describe(
    "1–5, how much evidence backs it; leave out when not rated."
  ),
  testIdea: z.string().max(ASSUMPTION_TEXT_MAX).optional(),
  status: StatusSchema.optional(),
  description: z.string().max(ASSUMPTION_TEXT_MAX).optional(),
});

function newAssumption(p: z.infer<typeof AddSchema>): Assumption {
  return {
    id: crypto.randomUUID(),
    statement: p.statement,
    ...(p.riskLevel !== undefined ? { riskLevel: p.riskLevel as AssumptionLevel } : {}),
    ...(p.evidenceLevel !== undefined ? { evidenceLevel: p.evidenceLevel as AssumptionLevel } : {}),
    ...(p.testIdea ? { testIdea: p.testIdea } : {}),
    status: p.status ?? "untested",
    ...(p.description ? { description: p.description } : {}),
  };
}

async function addAssumption(store: CanvasStore, p: z.infer<typeof AddSchema>) {
  const base = (await store.canvas()) ?? { id: RA_ID, assumptions: [] };
  const a = newAssumption(p);
  // Appended, as the page adds them.
  await store.put({ ...base, id: RA_ID, assumptions: [...base.assumptions, a] });
  return { added: true, id: a.id, rated: isRated(a), score: assumptionScore(a) };
}

registry.register({
  id: "tool.riskiest_assumption.add_assumption",
  toolId: "tool.riskiest_assumption",
  name: "add_assumption",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an assumption, last in the list as on the page. riskLevel and evidenceLevel are optional whole numbers 1..5: leave them out when the user hasn't rated it (an unrated assumption is never ranked; rate it later with rate_assumption). High risk with low evidence ranks first (score = risk × (6 − evidence)). status defaults to 'untested'. Creates the canvas if absent. Returns {added: true, id, rated, score (null when not rated)}.",
  paramsSchema: AddSchema,
  handler: async (params) => addAssumption(browserStore, params),
  mcpHandler: async (params, ctx) => addAssumption(serverStore(ctx.userId), params),
});

/* ── rate_assumption ─────────────────────────────────────────────────── */

const RateSchema = z.object({
  assumptionId: z.string(),
  riskLevel: LevelSchema.nullable()
    .optional()
    .describe("1–5; null clears it (not rated); leave out to keep it."),
  evidenceLevel: LevelSchema.nullable()
    .optional()
    .describe("1–5; null clears it (not rated); leave out to keep it."),
});

async function rateAssumption(store: CanvasStore, p: z.infer<typeof RateSchema>) {
  if (p.riskLevel === undefined && p.evidenceLevel === undefined) {
    return { updated: false, reason: "no_change" };
  }
  const [doc, tracker] = await Promise.all([store.canvas(), store.tracker()]);
  if (!doc || !doc.assumptions.some((a) => a.id === p.assumptionId)) {
    return { updated: false, reason: "not_found" };
  }
  const next = withAssumption(doc, p.assumptionId, (a) => {
    const out: Assumption = { ...a };
    for (const key of ["riskLevel", "evidenceLevel"] as const) {
      const v = p[key];
      if (v === null) delete out[key];
      else if (v !== undefined) out[key] = v as AssumptionLevel;
    }
    return out;
  });
  await store.put(next);
  const a = next.assumptions.find((x) => x.id === p.assumptionId)!;
  const rank =
    rankAssumptions(
      next.assumptions.filter((x) => !isExampleId(x.id)),
      tracker?.hypotheses
    ).ranked.find((r) => r.assumption.id === a.id)?.rank ?? null;
  return {
    updated: true,
    riskLevel: ratingOf(a.riskLevel),
    evidenceLevel: ratingOf(a.evidenceLevel),
    score: assumptionScore(a),
    rank,
  };
}

registry.register({
  id: "tool.riskiest_assumption.rate_assumption",
  toolId: "tool.riskiest_assumption",
  name: "rate_assumption",
  category: "write",
  requiresConfirmation: false,
  description:
    "Rate an assumption: riskLevel (how badly it hurts if wrong) and evidenceLevel (how much evidence backs it), whole numbers 1..5. null clears a rating (not rated: it leaves the ranking); a rating left out is kept. Returns {updated: true, riskLevel, evidenceLevel, score (null while either is unset), rank (its place in the ranking; null when unrated or tested)} or {updated: false, reason: 'not_found' | 'no_change'}.",
  paramsSchema: RateSchema,
  handler: async (params) => rateAssumption(browserStore, params),
  mcpHandler: async (params, ctx) => rateAssumption(serverStore(ctx.userId), params),
});

/* ── set_status ──────────────────────────────────────────────────────── */

async function setStatus(
  store: CanvasStore,
  p: { assumptionId: string; status: AssumptionStatus }
) {
  const doc = await store.canvas();
  if (!doc || !doc.assumptions.some((a) => a.id === p.assumptionId)) return { updated: false };
  await store.put(withAssumption(doc, p.assumptionId, (a) => ({ ...a, status: p.status })));
  return { updated: true };
}

registry.register({
  id: "tool.riskiest_assumption.set_status",
  toolId: "tool.riskiest_assumption",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set an assumption's status (untested | testing | validated | invalidated). Validated or invalidated takes it out of the ranking. Its linked hypothesis's result never sets this: do it once the user agrees with the result. Returns {updated: false} when the canvas or assumption id is unknown.",
  paramsSchema: z.object({
    assumptionId: z.string(),
    status: StatusSchema,
  }),
  handler: async (params) => setStatus(browserStore, params),
  mcpHandler: async (params, ctx) => setStatus(serverStore(ctx.userId), params),
});

/* ── test_assumption ─────────────────────────────────────────────────── */

async function testAssumption(store: CanvasStore, id: string) {
  const [doc, tracker] = await Promise.all([store.canvas(), store.tracker()]);
  const a = doc?.assumptions.find((x) => x.id === id);
  if (!doc || !a) return { sent: false, reason: "not_found" };
  if (isExampleId(a.id)) return { sent: false, reason: "example" };
  const hypotheses = tracker?.hypotheses ?? [];
  if (testResultOf(a, hypotheses) !== null) return { sent: false, reason: "tested" };
  // Testing, or tested inconclusive: test it again through that hypothesis.
  if (linkedTest(a.sentTo, hypotheses).state !== "none") {
    return {
      sent: false,
      reason: "already_sent",
      hypothesisId: hypothesisLink(a.sentTo)?.targetId,
    };
  }
  const src = assumptionHypothesisSource(a);
  if (!src.title.trim()) return { sent: false, reason: "blank" };
  const h = hypothesisFromSource(src, nanoid(8), todayLocalISO());
  await store.putTracker(withHypothesis(tracker, h));
  // Only the link is written: the assumption's status stays the user's call.
  const link: HandoffLink = { route: "hypothesis", targetId: h.id, at: new Date().toISOString() };
  await store.put(
    withAssumption(doc, a.id, (x) => ({
      ...x,
      sentTo: [...(x.sentTo ?? []).filter((l) => l.route !== "hypothesis"), link],
    }))
  );
  return { sent: true, hypothesisId: h.id, believe: h.believe, missing: missingFields(h) };
}

registry.register({
  id: "tool.riskiest_assumption.test_assumption",
  toolId: "tool.riskiest_assumption",
  name: "test_assumption",
  category: "write",
  requiresConfirmation: false,
  description:
    "Test an assumption, as the page's 'Test' does: a drafted hypothesis in the Hypothesis Tracker (the statement as 'We believe', its description as what to learn, its test idea as what we'll do), linked both ways. The tracker then needs the success metric (and what we'll do, when there was no test idea) before it runs. Once per assumption while that hypothesis exists; the assumption's status is left as it is. Params: assumptionId. Returns {sent: true, hypothesisId, believe, missing} or {sent: false, reason: 'not_found' | 'example' | 'already_sent' (with hypothesisId) | 'tested' | 'blank'}.",
  paramsSchema: z.object({ assumptionId: z.string() }),
  handler: async (params) => testAssumption(browserStore, params.assumptionId),
  mcpHandler: async (params, ctx) => testAssumption(serverStore(ctx.userId), params.assumptionId),
});
