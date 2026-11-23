/**
 * A/B Calculator — tool-local actions.
 *
 * Category: Experimentation & A/B (on the More tools shelf)
 *
 * Agent surface: tool.ab_calculator.*
 *   1. list_state    — the saved tests as the page reads them: each with its
 *                      plan sized (people a version, days), its result (B
 *                      against A, the interval, p, the split check) and the
 *                      early-look state ("Too early to call" below the
 *                      planned sample).
 *   2. sample_size   — the page's plan: people a version, the total, the
 *                      days at the daily traffic, and the smallest effect
 *                      findable in 1 to 4 weeks. Pure.
 *   3. analyze       — the page's reading of two versions' counts. Pure.
 *   4. record_counts — a saved test's visitors and conversions; returns the
 *                      reading.
 *   5. set_decision  — ship B, keep A or run it again, with a note.
 * Backing CRUD: workspace.ab_test.* (defineCrudActions in
 * workspace/index.ts: create, list, update, delete, each write stamped).
 *
 * A result goes on a hypothesis through the Hypothesis Tracker's own verb,
 * tool.hypothesis_tracker.use_ab_result: this tool never writes one. Every
 * number comes from lib/experiments, as on the page. One store:
 * workspace.abTests (kind "workspace:abTest").
 */

import { z } from "zod";
import { registry } from "../registry";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  AB_DECISIONS,
  AB_TEST_KIND,
  TOOL_TEXT_MAX,
  type AbTest,
  type AbTestPlan,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { HOW_TO_READ, type ConversionAnalysis } from "@/lib/experiments/ab";
import {
  COUNT_MAX,
  PLAN_CONFIDENCES,
  PLAN_POWERS,
  abTests,
  effectTable,
  planResult,
  readResult,
  testSummary,
  withCounts,
  type ResultReading,
} from "@/lib/experiments/model";

const ws = () => useWorkspaceStore.getState();

type Out = Record<string, unknown>;

/** Where the tests live: the browser's workspace, or the user's rows on the server. */
interface TestStore {
  list(): Promise<AbTest[]>;
  put(t: AbTest): Promise<void>;
}

const browserStore: TestStore = {
  list: async () => ws().abTests ?? [],
  put: async (t) => ws().upsertAbTest(t),
};

function serverStore(userId: string): TestStore {
  return {
    list: () => serverListEntities<AbTest>(userId, AB_TEST_KIND),
    put: async (t) => {
      await serverUpsertEntity<AbTest>(userId, AB_TEST_KIND, t);
    },
  };
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const pair = (i: readonly [number, number]) => [r6(i[0]), r6(i[1])];

/** The analysis as an agent reads it: fractions rounded, the sentence and the early look. */
function analysisOut(a: ConversionAnalysis) {
  return {
    a: {
      visitors: a.a.visitors,
      conversions: a.a.conversions,
      rate: r6(a.a.rate),
      interval: pair(a.a.interval),
    },
    b: {
      visitors: a.b.visitors,
      conversions: a.b.conversions,
      rate: r6(a.b.rate),
      interval: pair(a.b.interval),
    },
    difference: r6(a.difference),
    differenceInterval: pair(a.differenceInterval),
    lift: a.lift === null ? null : r6(a.lift),
    liftInterval: a.liftInterval ? pair(a.liftInterval) : null,
    z: r4(a.z),
    p: a.p,
    sided: a.sided,
    confidence: a.confidence,
    intervalLevel: r6(a.level),
    significant: a.significant,
    split: { chiSquare: r4(a.split.chiSquare), p: a.split.p, flagged: a.split.flagged },
  };
}

function readingOut(r: ResultReading) {
  return {
    ...analysisOut(r.analysis),
    sentence: r.sentence,
    verdict: r.verdict,
    early: r.early,
    note: r.note,
    splitWarning: r.splitWarning,
  };
}

function planOut(plan: AbTestPlan) {
  const sized = planResult(plan);
  if (!sized) return null;
  return {
    treatment: r6(sized.treatment),
    perVariant: sized.perVariant,
    total: sized.total,
    days: sized.run?.days ?? null,
    weeks: sized.run?.weeks ?? null,
    tooBig: sized.tooBig,
  };
}

/* ── list_state ──────────────────────────────────────────────────────── */

async function listState(store: TestStore): Promise<Out> {
  const tests = abTests(await store.list());
  const real = tests.filter((t) => !isExampleId(t.id));
  return {
    total: real.length,
    examples: tests.length - real.length,
    howToRead: HOW_TO_READ.join(" "),
    tests: tests.map((t) => {
      const s = testSummary(t);
      return {
        ...t,
        example: isExampleId(t.id),
        sized: planOut(t.plan),
        result: s.result ? readingOut(s.result) : null,
      };
    }),
  };
}

registry.register({
  id: "tool.ab_calculator.list_state",
  toolId: "tool.ab_calculator",
  name: "list_state",
  category: "read",
  description:
    "List the saved A/B tests as the page reads them. Rates are fractions (0.1 is 10%). Returns {total (without the examples), examples, howToRead, tests: each stored row (name, question?, metricName?, metricId?, hypothesisId?, plan {baseline, mde, mdeMode: relative | absolute, confidence, power, sided: two | one, dailyTraffic?}, variants [A, B] {id, name, visitors, conversions}, guardrails?, status: planned | running | done, startedOn?, endedOn?, decision?: ship | keep | rerun, note?) plus example, sized {treatment, perVariant (people each version needs), total, days | null, weeks | null, tooBig} | null, result {a, b (each visitors, conversions, rate, interval), difference (B − A), differenceInterval, lift (B ÷ A − 1) | null, liftInterval | null, z, p, sided, confidence, intervalLevel, significant, split {chiSquare, p, flagged}, sentence, verdict ('Too early to call: …' until the smaller version reaches perVariant), early {planned, smaller, met}, note, splitWarning} | null (no counts yet)}. Never read p as the chance that B is better. Add, edit and delete tests with workspace.ab_test.*.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── sample_size ─────────────────────────────────────────────────────── */

const Fraction = z.number().gt(0).lt(1);
const Confidence = z
  .number()
  .refine((v) => (PLAN_CONFIDENCES as readonly number[]).includes(v), {
    message: "0.9, 0.95 or 0.99",
  })
  .describe("0.9, 0.95 or 0.99.");
const Power = z
  .number()
  .refine((v) => (PLAN_POWERS as readonly number[]).includes(v), { message: "0.8 or 0.9" })
  .describe("0.8 or 0.9.");
const Sided = z.enum(["two", "one"]);

const PlanParams = z.object({
  baseline: Fraction.describe("The current conversion rate, a fraction (0.1 is 10%)."),
  mde: z
    .number()
    .gt(0)
    .lt(100)
    .describe(
      "The smallest change worth finding: with mdeMode relative a share of the baseline (0.2 is +20%), with absolute in points as a fraction (0.02 is +2 points)."
    ),
  mdeMode: z.enum(["relative", "absolute"]),
  confidence: Confidence,
  power: Power,
  sided: Sided.describe("two: any difference; one: only 'B is better'."),
  dailyTraffic: z
    .number()
    .int()
    .min(1)
    .max(COUNT_MAX)
    .optional()
    .describe("Visitors a day, both versions together."),
});

function sampleSize(p: z.infer<typeof PlanParams>): Out {
  const plan: AbTestPlan = { ...p };
  const sized = planOut(plan);
  if (!sized) {
    return {
      ok: false,
      reason: "out_of_range",
      message: "B's rate with that change is 100% or more: pick a smaller change.",
    };
  }
  return {
    ok: true,
    ...sized,
    effects: effectTable(plan).map((e) => ({
      weeks: e.weeks,
      perVariant: e.perVariant,
      absolute: e.absolute === null ? null : r6(e.absolute),
      relative: e.relative === null ? null : r6(e.relative),
    })),
  };
}

registry.register({
  id: "tool.ab_calculator.sample_size",
  toolId: "tool.ab_calculator",
  name: "sample_size",
  category: "read",
  description:
    "Size a conversion A/B test as the page's Plan does (R's power.prop.test: 10% → 12% at 95% two-sided and 80% power needs 3,841 a version). Pure: saves nothing. Returns {ok: true, treatment (B's rate if the change is real), perVariant, total, days | null, weeks | null (whole weeks: run whole weeks), tooBig (over 100 million a version: pick a bigger effect), effects: {weeks, perVariant, absolute (points, a fraction) | null, relative | null}[] (the smallest rise findable in 1 to 4 weeks at dailyTraffic; [] without it)} or {ok: false, reason: 'out_of_range', message}.",
  paramsSchema: PlanParams,
  handler: async (params) => sampleSize(params),
  mcpHandler: async (params) => sampleSize(params),
});

/* ── analyze ─────────────────────────────────────────────────────────── */

const CountSchema = z
  .object({
    visitors: z.number().int().min(1).max(COUNT_MAX),
    conversions: z.number().int().min(0).max(COUNT_MAX),
  })
  .refine((c) => c.conversions <= c.visitors, { message: "conversions are at most visitors" });

const AnalyzeParams = z.object({
  a: CountSchema.describe("The control's visitors and conversions."),
  b: CountSchema.describe("B's visitors and conversions."),
  plan: PlanParams.optional().describe(
    "The test's plan: its confidence and sides read the result, and its sample decides 'Too early to call'. Without it, 95% two-sided, with a note to decide the sample first next time."
  ),
});

function analyze(p: z.infer<typeof AnalyzeParams>): Out {
  const r = readResult(p.plan ?? null, { a: p.a, b: p.b });
  return r ? readingOut(r) : {};
}

registry.register({
  id: "tool.ab_calculator.analyze",
  toolId: "tool.ab_calculator",
  name: "analyze",
  category: "read",
  description:
    "Read two versions' counts as the page's Read does. Pure: saves nothing. Each rate with a Wilson interval, B − A with Newcombe's interval, the lift with Katz's interval, the pooled z test (one-sided p for 'B is better' on a one-sided plan, whose intervals are two-sided at 1 − 2α), and a chi-square check of the split against even (flagged below p 0.001). Returns {a, b, difference, differenceInterval, lift | null, liftInterval | null, z, p, sided, confidence, intervalLevel, significant, split {chiSquare, p, flagged}, sentence, verdict, early {planned, smaller, met}, note, splitWarning}. The verdict reads 'Too early to call' until the smaller version reaches the plan's sample. Never read p as the chance that B is better.",
  paramsSchema: AnalyzeParams,
  handler: async (params) => analyze(params),
  mcpHandler: async (params) => analyze(params),
});

/* ── record_counts ───────────────────────────────────────────────────── */

const RecordParams = z.object({
  testId: z.string().min(1).describe("The test's id (see list_state)."),
  variants: z
    .array(
      z
        .object({
          id: z
            .string()
            .min(1)
            .max(64)
            .describe("The version's id: A's first, then B's (see list_state)."),
          visitors: z.number().int().min(0).max(COUNT_MAX),
          conversions: z.number().int().min(0).max(COUNT_MAX),
        })
        .refine((v) => v.conversions <= v.visitors, { message: "conversions are at most visitors" })
    )
    .length(2)
    .describe("Both versions' counts so far, by id."),
});

async function findTest(store: TestStore, id: string): Promise<AbTest | null> {
  return abTests(await store.list()).find((t) => t.id === id) ?? null;
}

async function recordCounts(store: TestStore, p: z.infer<typeof RecordParams>): Promise<Out> {
  const t = await findTest(store, p.testId);
  if (!t) return { updated: false, reason: "not_found" };
  const byId = new Map(p.variants.map((v) => [v.id, v]));
  const [a, b] = t.variants;
  const va = byId.get(a.id);
  const vb = byId.get(b.id);
  if (!va || !vb || va === vb) {
    return {
      updated: false,
      reason: "unknown_variant",
      message: `Give the counts for the versions ${a.id} and ${b.id}.`,
    };
  }
  const counts = {
    a: { visitors: va.visitors, conversions: va.conversions },
    b: { visitors: vb.visitors, conversions: vb.conversions },
  };
  const next: AbTest = {
    ...t,
    variants: withCounts(t.variants, counts),
    updatedAt: new Date().toISOString(),
  };
  await store.put(next);
  const s = testSummary(next);
  return { updated: true, id: t.id, result: s.result ? readingOut(s.result) : null };
}

registry.register({
  id: "tool.ab_calculator.record_counts",
  toolId: "tool.ab_calculator",
  name: "record_counts",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a saved test's visitors and conversions so far, as the page's Save counts does: both versions, by their ids (see list_state), whole numbers, conversions at most visitors. Returns {updated: true, id, result (as list_state's, null while a version has no visitors)} or {updated: false, reason: 'not_found' | 'unknown_variant' (with a message)}. Below the planned sample the verdict is 'Too early to call': don't call a winner early.",
  paramsSchema: RecordParams,
  handler: async (params) => recordCounts(browserStore, params),
  mcpHandler: async (params, ctx) => recordCounts(serverStore(ctx.userId), params),
});

/* ── set_decision ────────────────────────────────────────────────────── */

const DecisionParams = z.object({
  testId: z.string().min(1).describe("The test's id (see list_state)."),
  decision: z
    .enum(AB_DECISIONS)
    .nullable()
    .describe("ship (B goes to everyone), keep (A stays), rerun (run it again); null clears it."),
  note: z
    .string()
    .max(TOOL_TEXT_MAX.text)
    .optional()
    .describe("Why: replaces the test's note when given; '' clears it."),
});

async function setDecision(store: TestStore, p: z.infer<typeof DecisionParams>): Promise<Out> {
  const t = await findTest(store, p.testId);
  if (!t) return { updated: false, reason: "not_found" };
  const next: AbTest = { ...t, updatedAt: new Date().toISOString() };
  if (p.decision) next.decision = p.decision;
  else delete next.decision;
  if (p.note !== undefined) {
    const note = p.note.trim();
    if (note) next.note = note;
    else delete next.note;
  }
  await store.put(next);
  return {
    updated: true,
    id: t.id,
    decision: next.decision ?? null,
    hypothesisId: next.hypothesisId ?? null,
  };
}

registry.register({
  id: "tool.ab_calculator.set_decision",
  toolId: "tool.ab_calculator",
  name: "set_decision",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record what the team decided on a test, as the page's decision buttons do: ship (B goes to everyone), keep (A stays) or rerun, or null to clear it; with a note, which replaces the test's note when given ('' clears it). Agree it with the user first: it is the team's call. A linked hypothesis isn't changed here: tool.hypothesis_tracker.use_ab_result puts the result on its card. Returns {updated: true, id, decision | null, hypothesisId | null} or {updated: false, reason: 'not_found'}.",
  paramsSchema: DecisionParams,
  handler: async (params) => setDecision(browserStore, params),
  mcpHandler: async (params, ctx) => setDecision(serverStore(ctx.userId), params),
});
