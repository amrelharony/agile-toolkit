/**
 * EBM Dashboard — tool-local actions.
 *
 * Category: Metrics & Dashboards (tools plan, phase 2)
 *
 * Agent surface: tool.ebm_dashboard.*
 * Backing CRUD : workspace.ebm_board.* (the one EbmBoard document: the
 *                strategic goal and the reviews) and workspace.product_metric.*
 *                (the measures are product metrics with `kva` set, so they
 *                show in Product Metrics too). Readings go through
 *                tool.product_metrics.add_reading.
 *
 *   1. list_state            — the goal ladder, each key value area with its
 *                              measures, progress and experiments, the
 *                              weakest area, the last review, the verdict.
 *   2. add_measure           — a new measure in an area, or tag a metric.
 *   3. read_sources          — read only: the toolkit's own numbers each
 *                              source gives today (cycle time, DORA, NPS,
 *                              tech debt); never writes.
 *   4. accept_source_reading — write a measure's source reading as a reading.
 *   5. set_strategic_goal    — the strategic goal and why it matters.
 *   6. suggest_focus         — read only: "Suggest a focus" without AI.
 *   7. record_review         — save a review with each area's score now.
 *
 * All act on the user's own data, so all are offered to a visitor's Amr.
 * The page logs history; these verbs don't.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import { DORA_DOC_ID } from "@/lib/dora/samples";
import {
  EBM_BOARD_ID,
  EBM_BOARD_KIND,
  EBM_VALUE_AREAS,
  KANBAN_BOARD_ID,
  METRIC_SOURCE_IDS,
  PRODUCT_GOAL_KIND,
  PRODUCT_METRIC_KIND,
  type DoraScorecard,
  type EbmBoard,
  type HypothesisTracker,
  type KanbanBoard,
  type NpsResponse,
  type ProductGoal,
  type ProductMetric,
  type Sprint,
  type Story,
  type TechDebtItem,
} from "@/lib/stores/workspace-types";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { todayLocalISO } from "@/lib/utils/formatters";
import { latestCheckInDay } from "@/lib/okrs/progress";
import { isExampleId } from "@/lib/utils/example-id";
import {
  METRIC_DEFINITION_MAX,
  METRIC_NAME_MAX,
  METRIC_UNIT_MAX,
  READING_ID_PREFIX,
  compactMetric,
  latestReading,
  metricFromValues,
  metricProgress,
  metricRuleProblems,
  metricTrend,
  usableMetrics,
  validateMetric,
  withReading,
  EMPTY_METRIC_DRAFT,
} from "@/lib/product-metrics/model";
import {
  AREA_LABEL,
  REVIEW_ID_PREFIX,
  REVIEW_NOTE_MAX,
  STRATEGIC_GOAL_MAX,
  STRATEGIC_WHY_MAX,
  areaProgress,
  ebmExampleLoaded,
  ebmVerdict,
  experimentsFor,
  goalLadder,
  hypothesesOf,
  measuresByArea,
  newReview,
  normalizeBoard,
  reviewsNewestFirst,
  ruleReview,
  validateReview,
  validateStrategicGoal,
  weakestArea,
  withReview,
  withStrategicGoal,
  areaScores,
} from "@/lib/ebm/model";
import { SOURCE_INFO, readSource, type SourceData } from "@/lib/ebm/sources";

const ws = () => useWorkspaceStore.getState();

/** Where reads and writes go, in the browser or on the server. */
interface EbmStore {
  onServer: boolean;
  metrics(): Promise<ProductMetric[]>;
  putMetric(m: ProductMetric): Promise<void>;
  board(): Promise<EbmBoard | null>;
  putBoard(b: EbmBoard): Promise<void>;
  goals(): Promise<ProductGoal[]>;
  sprints(): Promise<Sprint[]>;
  trackers(): Promise<HypothesisTracker[]>;
  sources(): Promise<SourceData>;
}

const browserStore: EbmStore = {
  onServer: false,
  metrics: async () => ws().productMetrics ?? [],
  putMetric: async (m) => ws().upsertProductMetric(m),
  board: async () => (ws().ebmBoards ?? []).find((b) => b.id === EBM_BOARD_ID) ?? null,
  putBoard: async (b) => ws().upsertEbmBoard(b),
  goals: async () => ws().productGoals ?? [],
  sprints: async () => ws().sprints ?? [],
  trackers: async () => ws().hypothesisTrackers ?? [],
  sources: async () => {
    const s = ws();
    return {
      stories: s.stories ?? [],
      boards: s.kanbanBoards ?? [],
      dora: s.doraScorecards ?? [],
      nps: s.npsResponses ?? [],
      techDebt: s.techDebt ?? [],
    };
  },
};

const serverStore = (userId: string): EbmStore => ({
  onServer: true,
  metrics: () => serverListEntities<ProductMetric>(userId, PRODUCT_METRIC_KIND),
  putMetric: (m) => serverUpsertEntity<ProductMetric>(userId, PRODUCT_METRIC_KIND, m),
  board: () => serverGetEntity<EbmBoard>(userId, EBM_BOARD_KIND, EBM_BOARD_ID),
  putBoard: (b) => serverUpsertEntity<EbmBoard>(userId, EBM_BOARD_KIND, b),
  goals: () => serverListEntities<ProductGoal>(userId, PRODUCT_GOAL_KIND),
  sprints: () => serverListEntities<Sprint>(userId, "workspace:sprint"),
  trackers: async () => {
    const doc = await serverGetEntity<HypothesisTracker>(
      userId,
      "workspace:hypothesisTracker",
      HYPOTHESIS_TRACKER_ID
    );
    return doc ? [doc] : [];
  },
  sources: async () => {
    const [stories, board, dora, nps, techDebt] = await Promise.all([
      serverListEntities<Story>(userId, "workspace:story"),
      serverGetEntity<KanbanBoard>(userId, "workspace:kanbanBoard", KANBAN_BOARD_ID),
      serverGetEntity<DoraScorecard>(userId, "workspace:doraScorecard", DORA_DOC_ID),
      serverListEntities<NpsResponse>(userId, "workspace:npsResponse"),
      serverListEntities<TechDebtItem>(userId, "workspace:techDebt"),
    ]);
    return {
      stories,
      boards: board ? [board] : [],
      dora: dora ? [dora] : [],
      nps,
      techDebt,
    };
  },
});

const boardOf = async (store: EbmStore) => {
  const raw = await store.board();
  return raw ? normalizeBoard(raw) : null;
};

const AreaEnum = z.enum(EBM_VALUE_AREAS);

function measureSummary(m: ProductMetric) {
  const latest = latestReading(m);
  return {
    id: m.id,
    name: m.name,
    ...(m.unit ? { unit: m.unit } : {}),
    direction: m.direction,
    ...(m.target !== undefined ? { target: m.target } : {}),
    ...(m.baseline !== undefined ? { baseline: m.baseline } : {}),
    ...(m.source ? { source: m.source } : {}),
    latest: latest ? { date: latest.date, value: latest.value } : null,
    progress: metricProgress(m),
    trend: metricTrend(m).word,
    example: isExampleId(m.id),
  };
}

async function listState(store: EbmStore) {
  const [metrics, board, goals, sprints, trackers] = await Promise.all([
    store.metrics(),
    boardOf(store),
    store.goals(),
    store.sprints(),
    store.trackers(),
  ]);
  const byArea = measuresByArea(metrics);
  const scores = areaScores(byArea);
  const hypotheses = hypothesesOf(trackers);
  const last = reviewsNewestFirst(board)[0] ?? null;
  return {
    verdict: ebmVerdict(byArea, board, todayLocalISO()),
    ladder: goalLadder({ board, goals, sprints }),
    areas: EBM_VALUE_AREAS.map((area) => ({
      area,
      label: AREA_LABEL[area],
      progress: areaProgress(byArea[area]),
      measures: byArea[area].map(measureSummary),
      experiments: experimentsFor(byArea[area], hypotheses).map((e) => ({
        hypothesisId: e.hypothesis.id,
        metricId: e.metricId,
        status: e.hypothesis.status,
        believe: e.hypothesis.believe,
      })),
    })),
    weakestArea: weakestArea(scores),
    lastReview: last,
    reviews: board?.reviews.length ?? 0,
    exampleLoaded: ebmExampleLoaded(metrics, board),
  };
}

// ──────── tool.ebm_dashboard.list_state ────────
registry.register({
  id: "tool.ebm_dashboard.list_state",
  toolId: "tool.ebm_dashboard",
  name: "list_state",
  category: "read",
  description:
    "Read the EBM Dashboard as the page shows it. Returns {verdict, ladder: {strategic: {goal, why?} | null, intermediate: {id, statement} | null (the active Product Goal), tactical: {sprintId, sprintName, goal} | null (the active or planned sprint's goal)}, areas: {area: current-value|unrealized-value|time-to-market|ability-to-innovate, label, progress (0..1, the mean of its measures' progress to their targets; null = not measured, never a grade), measures: {id, name, unit?, direction, target?, baseline?, source?, latest: {date, value} | null, progress, trend: rising|falling|flat|null, example}[], experiments: {hypothesisId, metricId, status, believe}[]}[], weakestArea: area | null, lastReview: {id, date, focus, note?, areas} | null, reviews (count), exampleLoaded}. Area progress is the page's own simplification: EBM itself gives no score.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_p, ctx) => listState(serverStore(ctx.userId)),
});

// ──────── tool.ebm_dashboard.add_measure ────────
const AddMeasureParams = z
  .object({
    area: AreaEnum,
    metricId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Tag this existing product metric as a measure in the area, instead of a new one."),
    name: z.string().trim().min(1).max(METRIC_NAME_MAX).optional(),
    definition: z.string().trim().max(METRIC_DEFINITION_MAX).optional(),
    unit: z.string().trim().max(METRIC_UNIT_MAX).optional(),
    direction: z.enum(["increase", "decrease"]).optional(),
    baseline: z.number().finite().optional(),
    target: z.number().finite().optional(),
    source: z
      .enum(METRIC_SOURCE_IDS)
      .optional()
      .describe("Read its readings from the toolkit (see read_sources)."),
  })
  .refine((p) => p.metricId || (p.name && p.direction), {
    message: "Give metricId to tag a metric, or a name and a direction for a new measure.",
  });

async function addMeasure(store: EbmStore, p: z.infer<typeof AddMeasureParams>) {
  const all = await store.metrics();
  const now = new Date().toISOString();
  if (p.metricId) {
    const m = all.find((x) => x.id === p.metricId);
    if (!m) return { added: false as const, reason: "not_found" as const };
    const next = compactMetric({
      ...m,
      kva: p.area,
      ...(p.source ? { source: p.source } : {}),
      updatedAt: now,
    });
    await store.putMetric(next);
    return { added: true as const, metricId: m.id, created: false };
  }
  const checked = validateMetric({
    ...EMPTY_METRIC_DRAFT,
    name: p.name ?? "",
    definition: p.definition ?? "",
    unit: p.unit ?? "",
    direction: p.direction ?? "increase",
    baseline: p.baseline !== undefined ? String(p.baseline) : "",
    target: p.target !== undefined ? String(p.target) : "",
  });
  if (!checked.ok) throw new Error(`${Object.values(checked.errors).join(" ")} Nothing was saved.`);
  const row = metricFromValues(checked.values, {
    id: `metric_${nanoid(8)}`,
    now,
    extra: { kva: p.area, ...(p.source ? { source: p.source } : {}), readings: [] },
  });
  const problems = metricRuleProblems(row, all);
  if (problems.length > 0) throw new Error(`${problems.join(" ")} Nothing was saved.`);
  await store.putMetric(row);
  return { added: true as const, metricId: row.id, created: true };
}

registry.register({
  id: "tool.ebm_dashboard.add_measure",
  toolId: "tool.ebm_dashboard",
  name: "add_measure",
  category: "write",
  description:
    "Add a measure to a key value area: a new product metric {area, name, direction (increase | decrease), unit?, definition?, baseline?, target? (beyond the baseline in its direction), source? (a toolkit number it reads)}, or {area, metricId} to tag an existing metric (it keeps its other views). Returns {added: true, metricId, created} or {added: false, reason: not_found}. Add readings with tool.product_metrics.add_reading or accept_source_reading.",
  paramsSchema: AddMeasureParams,
  handler: async (p) => addMeasure(browserStore, p),
  mcpHandler: async (p, ctx) => addMeasure(serverStore(ctx.userId), p),
});

// ──────── tool.ebm_dashboard.read_sources ────────
async function readSources(store: EbmStore) {
  const [data, metrics] = await Promise.all([store.sources(), store.metrics()]);
  const today = todayLocalISO();
  const real = usableMetrics(metrics, { withExamples: false });
  return {
    sources: METRIC_SOURCE_IDS.map((id) => ({
      id,
      label: SOURCE_INFO[id].label,
      area: SOURCE_INFO[id].area,
      tool: SOURCE_INFO[id].tool,
      reading: readSource(id, data, today),
      measures: real.filter((m) => m.source === id).map((m) => m.id),
    })),
  };
}

registry.register({
  id: "tool.ebm_dashboard.read_sources",
  toolId: "tool.ebm_dashboard",
  name: "read_sources",
  category: "read",
  description:
    "Read the toolkit's own numbers the EBM measures can use, today; never writes. Returns {sources: {id: cycle-time-median|dora-lead-time|dora-deploys|dora-change-fail|nps-90d|open-tech-debt, label, area, tool, reading: {value, date, basis (in words, with its n)} | null (null: the tool hasn't enough data: 5 finished items for cycle time, 10 answers in 90 days for NPS, a DORA sample, any tech debt), measures: metricId[] (the team's measures that read it)}[]}. Example rows are left out.",
  paramsSchema: z.object({}),
  handler: async () => readSources(browserStore),
  mcpHandler: async (_p, ctx) => readSources(serverStore(ctx.userId)),
});

// ──────── tool.ebm_dashboard.accept_source_reading ────────
const AcceptParams = z.object({ measureId: z.string().min(1).max(200) });

async function acceptSourceReading(store: EbmStore, p: z.infer<typeof AcceptParams>) {
  const all = await store.metrics();
  const m = all.find((x) => x.id === p.measureId);
  if (!m) return { recorded: false as const, reason: "not_found" as const };
  if (!m.source) return { recorded: false as const, reason: "no_source" as const };
  const today = todayLocalISO();
  const reading = readSource(m.source, await store.sources(), today);
  if (!reading) return { recorded: false as const, reason: "no_reading" as const };
  if (reading.date > latestCheckInDay(today, store.onServer)) {
    return { recorded: false as const, reason: "no_reading" as const };
  }
  const { metric, replaced } = withReading(
    m,
    { id: `${READING_ID_PREFIX}${nanoid(8)}`, date: reading.date, value: reading.value },
    new Date().toISOString()
  );
  await store.putMetric(metric);
  return {
    recorded: true as const,
    date: reading.date,
    value: reading.value,
    basis: reading.basis,
    replaced,
  };
}

registry.register({
  id: "tool.ebm_dashboard.accept_source_reading",
  toolId: "tool.ebm_dashboard",
  name: "accept_source_reading",
  category: "write",
  description:
    "Write a measure's toolkit reading (its source's number today, as read_sources gives it) as a reading on the measure; a reading already on that day is replaced. Returns {recorded: true, date, value, basis, replaced} or {recorded: false, reason: not_found | no_source | no_reading}.",
  paramsSchema: AcceptParams,
  handler: async (p) => acceptSourceReading(browserStore, p),
  mcpHandler: async (p, ctx) => acceptSourceReading(serverStore(ctx.userId), p),
});

// ──────── tool.ebm_dashboard.set_strategic_goal ────────
const GoalParams = z.object({
  text: z
    .string()
    .trim()
    .max(STRATEGIC_GOAL_MAX)
    .nullable()
    .describe("The strategic goal; null or empty clears it (and its why)."),
  why: z.string().trim().max(STRATEGIC_WHY_MAX).optional().describe("Why it matters."),
});

async function setStrategicGoal(store: EbmStore, p: z.infer<typeof GoalParams>) {
  const checked = validateStrategicGoal({ goal: p.text ?? "", why: p.text ? (p.why ?? "") : "" });
  if (!checked.ok) throw new Error(`${Object.values(checked.errors).join(" ")} Nothing was saved.`);
  const next = withStrategicGoal(await boardOf(store), checked.values, new Date().toISOString());
  await store.putBoard(next);
  return {
    set: true as const,
    strategicGoal: next.strategicGoal ?? null,
    strategicWhy: next.strategicWhy ?? null,
  };
}

registry.register({
  id: "tool.ebm_dashboard.set_strategic_goal",
  toolId: "tool.ebm_dashboard",
  name: "set_strategic_goal",
  category: "write",
  description:
    "Set the strategic goal at the top of the goal ladder (above the Product Goal and the sprint's goal), with why it matters; text null clears both. Returns {set: true, strategicGoal, strategicWhy}.",
  paramsSchema: GoalParams,
  handler: async (p) => setStrategicGoal(browserStore, p),
  mcpHandler: async (p, ctx) => setStrategicGoal(serverStore(ctx.userId), p),
});

// ──────── tool.ebm_dashboard.suggest_focus ────────
async function suggestFocus(store: EbmStore) {
  const r = ruleReview(measuresByArea(await store.metrics()));
  return {
    focus: r.focus,
    label: AREA_LABEL[r.focus],
    summary: r.summary,
    steps: r.steps,
    areas: r.areas,
  };
}

registry.register({
  id: "tool.ebm_dashboard.suggest_focus",
  toolId: "tool.ebm_dashboard",
  name: "suggest_focus",
  category: "read",
  description:
    "Suggest the area to focus on next without AI and without saving: an area with no measured progress first, else the weakest. Returns {focus, label, summary (built from the numbers), steps (next steps for that area), areas: {area: 0..1}}. Record it with record_review once the team agrees.",
  paramsSchema: z.object({}),
  handler: async () => suggestFocus(browserStore),
  mcpHandler: async (_p, ctx) => suggestFocus(serverStore(ctx.userId)),
});

// ──────── tool.ebm_dashboard.record_review ────────
const ReviewParams = z.object({
  focus: AreaEnum.describe("The area to focus on next."),
  note: z.string().trim().max(REVIEW_NOTE_MAX).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
    .optional()
    .describe("The review's day, default today, never later."),
});

async function recordReview(store: EbmStore, p: z.infer<typeof ReviewParams>) {
  const today = todayLocalISO();
  const checked = validateReview(
    { date: p.date ?? today, focus: p.focus, note: p.note ?? "" },
    latestCheckInDay(today, store.onServer)
  );
  if (!checked.ok) throw new Error(`${Object.values(checked.errors).join(" ")} Nothing was saved.`);
  const [metrics, board] = await Promise.all([store.metrics(), boardOf(store)]);
  const review = newReview(
    `${REVIEW_ID_PREFIX}${nanoid(8)}`,
    checked.values,
    measuresByArea(metrics.filter((m) => !isExampleId(m.id)))
  );
  await store.putBoard(withReview(board, review, new Date().toISOString()));
  return {
    recorded: true as const,
    reviewId: review.id,
    date: review.date,
    focus: review.focus,
    areas: review.areas,
  };
}

registry.register({
  id: "tool.ebm_dashboard.record_review",
  toolId: "tool.ebm_dashboard",
  name: "record_review",
  category: "write",
  description:
    "Record an EBM review: the area to focus on next, a note, and each area's progress now (the team's own measures; an area left out was not measured). The newest 24 reviews are kept. Returns {recorded: true, reviewId, date, focus, areas}.",
  paramsSchema: ReviewParams,
  handler: async (p) => recordReview(browserStore, p),
  mcpHandler: async (p, ctx) => recordReview(serverStore(ctx.userId), p),
});
