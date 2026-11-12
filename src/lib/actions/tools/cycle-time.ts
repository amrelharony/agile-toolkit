/**
 * Cycle Time Analyzer — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.cycle_time.*
 *
 *   1. list_state          — cycle time as the page shows it, read live
 *      from the boards: finished stories (Sprint board) and cards (Flow
 *      board), the summary, the SLE, the latest finished items and the
 *      ageing work in progress. The same lib/flow pipeline as the page
 *      (storyItems / cardItems → finishedItems → cycleSummary, ageingWip),
 *      so the P85 here is the page's to the day.
 *   2. compute_percentiles — the same summary over durations the agent passes.
 *   3. by_stage            — Time in each status, as the page reads it: the
 *      finished items' elapsed time per status between the start and Done
 *      from the boards' recorded moves, each status's median and P85, and
 *      the flow efficiency with the statuses passed as waiting
 *      (lib/flow stageBreakdown).
 *
 * One convention everywhere (lib/flow cycleDays): whole local calendar
 * days with the start and the finish both counted, so a same-day item took
 * 1 day. Percentiles are nearest rank (lib/sprints/metrics percentile).
 * The page's typed items stay on the device that typed them.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities } from "../server-store";
import {
  KANBAN_BOARD_ID,
  type KanbanBoard,
  type Sprint,
  type Story,
} from "@/lib/stores/workspace-types";
import { quantile } from "@/lib/analytics/anomaly";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import { percentile } from "@/lib/sprints/metrics";
import { todayIso } from "@/lib/sprints/series";
import {
  DEFAULT_WAITING,
  STAGE_ORDER,
  addDays,
  ageingWip,
  cardItems,
  cycleSummary,
  finishedItems,
  itemEfficiency,
  stageBreakdown,
  storyItems,
  type FlowItem,
} from "@/lib/flow";

const KIND_STORY = "workspace:story";
const KIND_SPRINT = "workspace:sprint";
const KIND_KANBAN = "workspace:kanbanBoard";

const round1 = (n: number) => Math.round(n * 10) / 10;
const round1OrNull = (n: number | null) => (n === null ? null : round1(n));

/** How many finished items list_state lists (the latest). */
const LATEST_ITEMS = 50;

// ──────── tool.cycle_time.compute_percentiles ────────
registry.register({
  id: "tool.cycle_time.compute_percentiles",
  toolId: "tool.cycle_time",
  name: "compute_percentiles",
  category: "read",
  description:
    "Summarise completed work-item cycle times (in days). Count days as the page does: whole calendar days with the start and the finish both counted, so an item started and finished on the same day is 1 (not 0). Returns {count, average, min, max, p50, p85, p95 (nearest-rank percentiles, the page's and the Flow board's method), sleTarget (= P85, the conventional Service Level Expectation), outliers: number[] (IQR fences)}. The page quotes the average from 3 items and the percentiles from 5. Pure.",
  paramsSchema: z.object({
    durations: z
      .array(z.number().min(0))
      .min(1)
      .describe(
        "Completed work-item cycle times, in days (one entry per item; a same-day item is 1)."
      ),
  }),
  handler: async (params) => {
    const sorted = [...params.durations].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    // The outlier fences only: interpolated quartiles, as Tukey's rule uses them.
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const p85 = percentile(sorted, 85) as number;
    return {
      count: n,
      average: round1(sum / n),
      min: sorted[0],
      max: sorted[n - 1],
      p50: percentile(sorted, 50) as number,
      p85,
      p95: percentile(sorted, 95) as number,
      sleTarget: p85,
      outliers: sorted.filter((v) => v < lowerFence || v > upperFence),
    };
  },
});

// ──────── tool.cycle_time.list_state ────────
interface BoardData {
  stories: Story[];
  sprints: Sprint[];
  board: KanbanBoard | null;
}

const browserData = async (): Promise<BoardData> => {
  const s = useWorkspaceStore.getState();
  return {
    stories: s.stories ?? [],
    sprints: s.sprints ?? [],
    board: (s.kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID) ?? null,
  };
};

const serverData = async (userId: string): Promise<BoardData> => {
  const [stories, sprints, board] = await Promise.all([
    serverListEntities<Story>(userId, KIND_STORY),
    serverListEntities<Sprint>(userId, KIND_SPRINT),
    serverGetEntity<KanbanBoard>(userId, KIND_KANBAN, KANBAN_BOARD_ID),
  ]);
  return { stories, sprints, board: board ?? null };
};

const ListParams = z.object({
  source: z
    .enum(["sprint", "flow", "all"])
    .optional()
    .describe("Which board: 'sprint' (stories), 'flow' (Flow board cards) or 'all' (default)."),
  sprintId: z
    .string()
    .optional()
    .describe("Only this sprint's stories (those in it, and those it carried over or descoped)."),
  sinceDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe("Only items finished in the last N days, today included (default: all)."),
});

function listState(data: BoardData, params: z.infer<typeof ListParams>, today: string) {
  const source = params.source ?? "all";
  const sprint = params.sprintId ? data.sprints.find((s) => s.id === params.sprintId) : undefined;
  if (params.sprintId && !sprint)
    return { found: false as const, reason: "sprint_not_found" as const };
  const stories: FlowItem[] =
    source === "flow" ? [] : storyItems(data.stories, sprint ? { sprint } : {});
  const cards: FlowItem[] = source === "sprint" || sprint ? [] : cardItems(data.board?.cards ?? []);
  const items = [...stories, ...cards];
  const from = params.sinceDays
    ? (addDays(today, -(params.sinceDays - 1)) ?? undefined)
    : undefined;
  const finished = finishedItems(items, { from, to: today });
  const summary = cycleSummary(finished.map((f) => f.days));
  const average = enoughData(summary.count, "average");
  const distribution = enoughData(summary.count, "distribution");
  const p85 = distribution ? summary.p85 : null;
  const ageing = ageingWip(items, today, p85);
  return {
    found: true as const,
    source,
    sprintId: sprint?.id ?? null,
    range: { from: from ?? null, to: today },
    count: summary.count,
    average: average ? round1OrNull(summary.average) : null,
    median: distribution ? summary.median : null,
    p85,
    p95: distribution ? summary.p95 : null,
    spread: distribution ? round1OrNull(summary.spread) : null,
    sleDays: p85,
    minForAverage: MIN_SAMPLE.average,
    minForPercentiles: MIN_SAMPLE.distribution,
    items: finished
      .slice(-LATEST_ITEMS)
      .reverse()
      .map((f) => ({
        id: f.id,
        title: f.title,
        source: f.kind === "story" ? "sprint" : "flow",
        startedOn: f.startedOn,
        doneOn: f.doneOn,
        days: f.days,
      })),
    ageing: ageing.map((a) => ({
      id: a.id,
      title: a.title,
      source: a.kind === "story" ? "sprint" : "flow",
      stage: a.stage,
      startedOn: a.startedOn,
      ageDays: a.ageDays,
      overP85: a.overP85,
      blocked: a.blocked,
      ...(a.owner ? { owner: a.owner } : {}),
    })),
  };
}

registry.register({
  id: "tool.cycle_time.list_state",
  toolId: "tool.cycle_time",
  name: "list_state",
  category: "read",
  description:
    "Cycle time as the page shows it, read live from the boards' start and done times: finished stories (Sprint board) and Flow-board cards in Done, in whole local days with the start and the finish both counted (a same-day item is 1). Params: source? 'sprint' | 'flow' | 'all' (default), sprintId? (that sprint's stories only), sinceDays? 1–365 (finished in the last N days). Returns {found: true, source, sprintId, range {from | null, to}, count, average (null below 3 items), median, p85, p95, spread (null below 5), sleDays (= p85: 85% finish within it), minForAverage, minForPercentiles, items: {id, title, source 'sprint' | 'flow', startedOn, doneOn, days}[] (the latest 50 finished, newest first), ageing: {id, title, source, stage 'in_progress' | 'review', startedOn, ageDays (the start day is 1), overP85 (null until p85 is quoted), blocked, owner?}[] (work in progress, oldest first)} or {found: false, reason: 'sprint_not_found'}. An item dropped straight into Done has no cycle time. The page's typed items stay on the device that typed them.",
  paramsSchema: ListParams,
  handler: async (params) => listState(await browserData(), params, todayIso()),
  mcpHandler: async (params, ctx) => listState(await serverData(ctx.userId), params, todayIso()),
});

// ──────── tool.cycle_time.by_stage ────────
const round2 = (n: number) => Math.round(n * 100) / 100;

const ByStageParams = ListParams.extend({
  waiting: z
    .array(z.enum(STAGE_ORDER))
    .max(STAGE_ORDER.length)
    .optional()
    .describe(
      `The statuses to count as waiting for the flow efficiency (the rest count as active). Default: the page's default, ${DEFAULT_WAITING.map((s) => `'${s}'`).join(", ")} ('done' is a stint in Done before a reopen). Pass e.g. ['review'] when work in Review mostly waits for a reviewer. The page's own marking stays on the device that set it.`
    ),
});

function byStage(data: BoardData, params: z.infer<typeof ByStageParams>, today: string) {
  const source = params.source ?? "all";
  const sprint = params.sprintId ? data.sprints.find((s) => s.id === params.sprintId) : undefined;
  if (params.sprintId && !sprint)
    return { found: false as const, reason: "sprint_not_found" as const };
  const items: FlowItem[] = [
    ...(source === "flow" ? [] : storyItems(data.stories, sprint ? { sprint } : {})),
    ...(source === "sprint" || sprint ? [] : cardItems(data.board?.cards ?? [])),
  ];
  const from = params.sinceDays
    ? (addDays(today, -(params.sinceDays - 1)) ?? undefined)
    : undefined;
  const b = stageBreakdown(items, { waiting: params.waiting ?? DEFAULT_WAITING, from, to: today });
  const waiting = new Set<string>(b.waiting);
  return {
    found: true as const,
    source,
    sprintId: sprint?.id ?? null,
    range: { from: from ?? null, to: today },
    count: b.items.length,
    approximate: b.approximate,
    waiting: b.waiting,
    totalDays: round2(b.totalDays),
    stages: b.stages.map((s) => ({
      stage: s.stage,
      label: s.label,
      items: s.items,
      median: s.median === null ? null : round2(s.median),
      p85: s.p85 === null ? null : round2(s.p85),
      totalDays: round2(s.totalDays),
      share: s.share === null ? null : round1(s.share),
      waiting: s.waiting,
    })),
    flowEfficiency: {
      pct: b.efficiency.pct,
      activeDays: round2(b.efficiency.activeDays),
      waitingDays: round2(b.efficiency.waitingDays),
      reason: b.efficiency.reason,
    },
    minForPercentiles: MIN_SAMPLE.distribution,
    minForEfficiency: MIN_SAMPLE.average,
    items: b.items
      .slice(-LATEST_ITEMS)
      .reverse()
      .map((it) => {
        const eff = itemEfficiency(it, waiting);
        return {
          id: it.id,
          title: it.title,
          source: it.kind === "story" ? "sprint" : "flow",
          startedOn: it.startedOn,
          doneOn: it.doneOn,
          cycleDays: it.cycleDays,
          elapsedDays: round2(it.elapsedDays),
          stages: it.stages.map((s) => ({ stage: s.stage, days: round2(s.days) })),
          efficiency: eff === null ? null : round1(eff),
        };
      }),
  };
}

registry.register({
  id: "tool.cycle_time.by_stage",
  toolId: "tool.cycle_time",
  name: "by_stage",
  category: "read",
  description:
    "Cycle time by stage, as the Cycle Time page's Time in each status reads it: for finished stories (Sprint board) and Flow-board cards whose moves were recorded, the elapsed time spent in each status from the start of work to Done (days with a fraction, so a same-day item adds up to less than a day; cycleDays keeps the page's whole-day count). Params: source? 'sprint' | 'flow' | 'all' (default), sprintId? (that sprint's stories only), sinceDays? 1–365 (finished in the last N days), waiting? stage ids counted as waiting ('backlog' | 'todo' | 'ready' | 'in_progress' | 'review' | 'done'; default backlog, todo, ready, done). Returns {found: true, source, sprintId, range {from | null, to}, count (items read), approximate (finished items with no recorded moves, left out), waiting, totalDays, stages: {stage, label, items, median, p85 (days; null below 5 items), totalDays, share (% of all the time), waiting}[] in board order, flowEfficiency {pct (active time %; null unless reason 'ok'), activeDays, waitingDays, reason 'ok' | 'not_enough' (below 3 items) | 'one_kind' (all the time is in active statuses, or all in waiting ones: mark a waiting one)}, minForPercentiles, minForEfficiency, items: {id, title, source, startedOn, doneOn, cycleDays, elapsedDays, stages {stage, days}[], efficiency (% active, null with no time)}[] (the latest 50, newest first)} or {found: false, reason: 'sprint_not_found'}. Read-only.",
  paramsSchema: ByStageParams,
  handler: async (params) => byStage(await browserData(), params, todayIso()),
  mcpHandler: async (params, ctx) => byStage(await serverData(ctx.userId), params, todayIso()),
});
