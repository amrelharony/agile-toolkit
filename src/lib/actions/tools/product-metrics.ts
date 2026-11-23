/**
 * Product Metrics — tool-local actions.
 *
 * Category: Outcomes & Pulse (tools plan, phase 2)
 *
 * Agent surface: tool.product_metrics.*
 * Backing CRUD : workspace.product_metric.* (the Phase 43 entity the page
 *                and the EBM Dashboard read). These verbs keep the page's
 *                rules (lib/product-metrics/model `metricRuleProblems`): one
 *                North Star, at most five inputs, one metric per funnel
 *                stage and per HEART feature and category, at most 60.
 *
 *   1. list_state        — the North Star with its inputs, HEART by feature,
 *                          the funnel's latest period, every metric's latest
 *                          reading, change, progress and trend, the verdict.
 *   2. add_reading       — one dated reading on a metric (a second on the
 *                          same day replaces the first).
 *   3. add_funnel_period — one day's counts for the funnel stages at once.
 *   4. set_north_star    — make a metric the North Star (the old one becomes
 *                          a plain metric first).
 *   5. suggest_metrics   — read only: the page's own templates for a
 *                          framework (Ask Amr's answer without AI).
 *
 * All act on the user's own data, so all are offered to a visitor's Amr.
 * The page logs history; these verbs don't.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import {
  AARRR_STAGES,
  PRODUCT_METRIC_KIND,
  PRODUCT_GOAL_KIND,
  type AarrrStage,
  type ProductGoal,
  type ProductMetric,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { latestCheckInDay } from "@/lib/okrs/progress";
import { productGoalLine } from "@/lib/product-goal/model";
import { isExampleId } from "@/lib/utils/example-id";
import {
  READING_ID_PREFIX,
  READING_NOTE_MAX,
  funnelView,
  heartView,
  latestReading,
  metricChange,
  metricProgress,
  metricRuleProblems,
  metricTrend,
  metricsVerdict,
  northStarView,
  previousReading,
  stageMetrics,
  usableMetrics,
  validateReading,
  withReading,
} from "@/lib/product-metrics/model";
import { METRIC_FRAMEWORKS, metricTemplates } from "@/lib/product-metrics/templates";

const ws = () => useWorkspaceStore.getState();

/** Where reads and writes go, in the browser or on the server. */
interface MetricsStore {
  /** Over MCP the server's day may be behind the user's (latestCheckInDay). */
  onServer: boolean;
  all(): Promise<ProductMetric[]>;
  put(rows: ProductMetric[]): Promise<void>;
  goals(): Promise<ProductGoal[]>;
}

const browserStore: MetricsStore = {
  onServer: false,
  all: async () => ws().productMetrics ?? [],
  put: async (rows) => {
    for (const r of rows) ws().upsertProductMetric(r);
  },
  goals: async () => ws().productGoals ?? [],
};

const serverStore = (userId: string): MetricsStore => ({
  onServer: true,
  all: () => serverListEntities<ProductMetric>(userId, PRODUCT_METRIC_KIND),
  put: async (rows) => {
    for (const r of rows) await serverUpsertEntity<ProductMetric>(userId, PRODUCT_METRIC_KIND, r);
  },
  goals: () => serverListEntities<ProductGoal>(userId, PRODUCT_GOAL_KIND),
});

/** One metric as list_state reads it. */
function metricSummary(m: ProductMetric) {
  const latest = latestReading(m);
  const before = previousReading(m);
  const change = metricChange(m);
  const trend = metricTrend(m);
  return {
    id: m.id,
    name: m.name,
    ...(m.definition ? { definition: m.definition } : {}),
    ...(m.unit ? { unit: m.unit } : {}),
    direction: m.direction,
    ...(m.baseline !== undefined ? { baseline: m.baseline } : {}),
    ...(m.target !== undefined ? { target: m.target } : {}),
    ...(m.owner ? { owner: m.owner } : {}),
    ...(m.role ? { role: m.role } : {}),
    ...(m.heart ? { heart: m.heart } : {}),
    ...(m.aarrr ? { aarrr: m.aarrr } : {}),
    ...(m.kva ? { kva: m.kva } : {}),
    ...(m.source ? { source: m.source } : {}),
    latest: latest ? { date: latest.date, value: latest.value } : null,
    previous: before ? { date: before.date, value: before.value } : null,
    change: change?.delta ?? null,
    better: change?.better ?? null,
    progress: metricProgress(m),
    trend: trend.word,
    readings: m.readings?.length ?? 0,
    example: isExampleId(m.id),
  };
}

async function listState(store: MetricsStore) {
  const all = usableMetrics(await store.all());
  const today = todayLocalISO();
  const { northStar, inputs } = northStarView(all);
  const funnel = funnelView(all);
  return {
    verdict: metricsVerdict(all, today),
    productGoal: productGoalLine(await store.goals()),
    northStar: northStar ? metricSummary(northStar) : null,
    inputs: inputs.map(metricSummary),
    heart: heartView(all).map((g) => ({
      feature: g.feature,
      categories: Object.fromEntries(
        Object.entries(g.rows).map(([category, m]) => [category, m ? m.id : null])
      ),
    })),
    funnel: {
      date: funnel.date,
      previousDate: funnel.previousDate,
      nested: funnel.nested,
      leakiest: funnel.leakiest,
      stages: funnel.stages.map((s) => ({
        stage: s.stage,
        metricId: s.metric?.id ?? null,
        count: s.count,
        ofBefore: s.ofBefore,
        ofAcquired: s.ofAcquired,
        change: s.change,
      })),
    },
    metrics: all.map(metricSummary),
    exampleLoaded: all.some((m) => isExampleId(m.id)),
  };
}

// ──────── tool.product_metrics.list_state ────────
registry.register({
  id: "tool.product_metrics.list_state",
  toolId: "tool.product_metrics",
  name: "list_state",
  category: "read",
  description:
    "Read Product Metrics as the page shows it. Returns {verdict, productGoal: string | null, northStar: Metric | null, inputs: Metric[], heart: {feature, categories: {happiness|engagement|adoption|retention|task-success: metricId}}[], funnel: {date (the latest day with an acquisition reading and another stage's), previousDate, nested (false when a share passes 100%: the counts don't nest), leakiest: activation|retention|null, stages: {stage, metricId, count, ofBefore (activation: of acquisition, retention: of activation, referral and revenue: of retention; 0..1), ofAcquired, change (ofBefore minus the period before's)}[]}, metrics: Metric[], exampleLoaded}. Metric = {id, name, definition?, unit?, direction, baseline?, target?, owner?, role?, heart?, aarrr?, kva?, source?, latest: {date, value} | null, previous, change (latest − previous), better (moved the right way; null when unchanged), progress (0..1 to the target, null = not measured), trend: rising|falling|flat|null (null under 6 readings), readings (count), example}. Example rows are flagged; the North Star and funnel read the team's own rows when it has any.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_p, ctx) => listState(serverStore(ctx.userId)),
});

// ──────── tool.product_metrics.add_reading ────────
const DayParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .optional()
  .describe("The day of the reading, YYYY-MM-DD. Default today. Never a later day.");

const AddReadingParams = z.object({
  metricId: z.string().min(1).max(200),
  value: z.number().finite(),
  date: DayParam,
  note: z.string().trim().max(READING_NOTE_MAX).optional(),
});

async function addReading(store: MetricsStore, p: z.infer<typeof AddReadingParams>) {
  const all = await store.all();
  const metric = all.find((m) => m.id === p.metricId);
  if (!metric) return { recorded: false as const, reason: "not_found" as const };
  const today = todayLocalISO();
  const checked = validateReading(
    { date: p.date ?? today, value: String(p.value), note: p.note ?? "" },
    latestCheckInDay(today, store.onServer)
  );
  if (!checked.ok) {
    throw new Error(`${Object.values(checked.errors).join(" ")} Nothing was saved.`);
  }
  const now = new Date().toISOString();
  const readingId = `${READING_ID_PREFIX}${nanoid(8)}`;
  const { metric: next, replaced } = withReading(
    metric,
    {
      id: readingId,
      date: checked.values.date,
      value: checked.values.value,
      ...(checked.values.note ? { note: checked.values.note } : {}),
    },
    now
  );
  await store.put([next]);
  const latest = latestReading(next);
  return {
    recorded: true as const,
    readingId,
    date: checked.values.date,
    replaced,
    latest: latest ? { date: latest.date, value: latest.value } : null,
    change: metricChange(next)?.delta ?? null,
  };
}

registry.register({
  id: "tool.product_metrics.add_reading",
  toolId: "tool.product_metrics",
  name: "add_reading",
  category: "write",
  description:
    "Record one dated reading on a product metric (also an EBM measure's reading). A second reading on the same day replaces the first; the newest 52 are kept. The day defaults to today and can't be later. Returns {recorded: true, readingId, date, replaced, latest: {date, value}, change (latest − the reading before, or null)} or {recorded: false, reason: not_found}.",
  paramsSchema: AddReadingParams,
  handler: async (p) => addReading(browserStore, p),
  mcpHandler: async (p, ctx) => addReading(serverStore(ctx.userId), p),
});

// ──────── tool.product_metrics.add_funnel_period ────────
const Count = z.number().int().min(0);
const FunnelParams = z.object({
  date: DayParam,
  counts: z
    .object(
      Object.fromEntries(AARRR_STAGES.map((s) => [s, Count.optional()])) as Record<
        AarrrStage,
        z.ZodOptional<typeof Count>
      >
    )
    .describe(
      "People at each stage on that day: acquisition and at least one other stage (activation, retention, referral, revenue)."
    ),
});

async function addFunnelPeriod(store: MetricsStore, p: z.infer<typeof FunnelParams>) {
  const given = AARRR_STAGES.filter((s) => typeof p.counts[s] === "number");
  if (!given.includes("acquisition") || given.length < 2) {
    return {
      recorded: false as const,
      reason: "need_acquisition_and_another" as const,
    };
  }
  const all = await store.all();
  const byStage = stageMetrics(all.filter((m) => !isExampleId(m.id)));
  const missing = given.filter((s) => !byStage[s]);
  if (missing.length > 0) {
    return { recorded: false as const, reason: "no_stage_metric" as const, stages: missing };
  }
  const today = todayLocalISO();
  const date = p.date ?? today;
  const checked = validateReading(
    { date, value: "0", note: "" },
    latestCheckInDay(today, store.onServer)
  );
  if (!checked.ok) {
    throw new Error(`${Object.values(checked.errors).join(" ")} Nothing was saved.`);
  }
  const now = new Date().toISOString();
  const writes = given.map(
    (s) =>
      withReading(
        byStage[s] as ProductMetric,
        { id: `${READING_ID_PREFIX}${nanoid(8)}`, date, value: p.counts[s] as number },
        now
      ).metric
  );
  await store.put(writes);
  const merged = all.map((m) => writes.find((w) => w.id === m.id) ?? m);
  const funnel = funnelView(merged.filter((m) => !isExampleId(m.id)));
  return {
    recorded: true as const,
    date,
    stages: given,
    nested: funnel.nested,
    leakiest: funnel.leakiest,
  };
}

registry.register({
  id: "tool.product_metrics.add_funnel_period",
  toolId: "tool.product_metrics",
  name: "add_funnel_period",
  category: "write",
  description:
    "Record one period of the AARRR funnel: one reading on each stage's metric for the same day (default today, never later). Needs acquisition and at least one other stage, and a metric on each stage given (the team's own; set them up with workspace.product_metric.create and aarrr). Returns {recorded: true, date, stages, nested, leakiest} or {recorded: false, reason: need_acquisition_and_another | no_stage_metric, stages?}.",
  paramsSchema: FunnelParams,
  handler: async (p) => addFunnelPeriod(browserStore, p),
  mcpHandler: async (p, ctx) => addFunnelPeriod(serverStore(ctx.userId), p),
});

// ──────── tool.product_metrics.set_north_star ────────
const NorthStarParams = z.object({ metricId: z.string().min(1).max(200) });

async function setNorthStar(store: MetricsStore, p: z.infer<typeof NorthStarParams>) {
  const all = await store.all();
  const target = all.find((m) => m.id === p.metricId);
  if (!target) return { set: false as const, reason: "not_found" as const };
  if (target.role === "north-star") return { set: false as const, reason: "already" as const };
  const now = new Date().toISOString();
  const example = isExampleId(target.id);
  const previous = all.find(
    (m) => m.id !== target.id && m.role === "north-star" && isExampleId(m.id) === example
  );
  const cleared = previous ? { ...previous, role: undefined, updatedAt: now } : null;
  const next: ProductMetric = { ...target, role: "north-star", updatedAt: now };
  const after = all.map((m) => (m.id === cleared?.id ? cleared : m));
  const problems = metricRuleProblems(next, after);
  if (problems.length > 0) throw new Error(`${problems.join(" ")} Nothing was saved.`);
  if (cleared) {
    const { role: _r, ...rest } = cleared;
    void _r;
    await store.put([rest as ProductMetric]);
  }
  await store.put([next]);
  return { set: true as const, metricId: next.id, previous: previous?.id ?? null };
}

registry.register({
  id: "tool.product_metrics.set_north_star",
  toolId: "tool.product_metrics",
  name: "set_north_star",
  category: "write",
  description:
    "Make a product metric the North Star. The current North Star becomes a plain metric first (one North Star at a time). Agree it with the user before calling: the North Star is the one number the whole product works towards. Returns {set: true, metricId, previous: metricId | null} or {set: false, reason: not_found | already}.",
  paramsSchema: NorthStarParams,
  handler: async (p) => setNorthStar(browserStore, p),
  mcpHandler: async (p, ctx) => setNorthStar(serverStore(ctx.userId), p),
});

// ──────── tool.product_metrics.suggest_metrics ────────
registry.register({
  id: "tool.product_metrics.suggest_metrics",
  toolId: "tool.product_metrics",
  name: "suggest_metrics",
  category: "read",
  description:
    "Suggest metrics without saving anything, from the page's own templates: north-star (one North Star and three inputs), heart (the five categories for a feature) or aarrr (the five funnel stages), leaving out names in existing. Returns {metrics: {name, definition?, unit?, direction, role?, heartCategory?, goal?, signal?, aarrrStage?}[]}. Save the ones the user picks with workspace.product_metric.create.",
  paramsSchema: z.object({
    framework: z.enum(METRIC_FRAMEWORKS),
    feature: z.string().trim().max(120).optional().describe("The feature a HEART set is for."),
    existing: z.array(z.string().max(200)).max(60).optional(),
  }),
  handler: async ({ framework, feature, existing }) => ({
    metrics: metricTemplates({ framework, feature, existing: existing ?? [] }),
  }),
});
