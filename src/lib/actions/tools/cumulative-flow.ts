/**
 * Cumulative Flow Diagram — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.cumulative_flow.*
 *
 *   1. list_state — the CFD the page draws from a board: the selected
 *      sprint's stories (Sprint board) or the Flow board's cards, per stage
 *      per calendar day, with WIP, throughput per elapsed day, the Little's
 *      Law lead time and the measured cycle time. The same lib/flow
 *      pipeline as the page (storyItems / cardItems → dailyCounts →
 *      littlesLaw), so the numbers agree; throughput and lead time are null
 *      below MIN_SAMPLE.average days, as the page shows "—".
 *   2. compute    — the same metrics from a series the agent passes, with
 *      optional dates so throughput is per elapsed day.
 *
 * The page's typed snapshots stay on the device that typed them; agents
 * read the boards. Reads only: "workspace:story", "workspace:sprint" and
 * the Flow board singleton "workspace:kanbanBoard" / KANBAN_BOARD_ID.
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
import { xmrLimits } from "@/lib/analytics/control-chart";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import {
  BOARD_WORKFLOW,
  SPRINT_WORKFLOW,
  addDays,
  cardItems,
  cycleSummary,
  dailyCounts,
  doneOf,
  finishedItems,
  littlesLaw,
  storyItems,
  wipOf,
  type FlowItem,
} from "@/lib/flow";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { pickDefaultSprint, todayIso } from "@/lib/sprints/series";

const KIND_STORY = "workspace:story";
const KIND_SPRINT = "workspace:sprint";
const KIND_KANBAN = "workspace:kanbanBoard";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round2OrNull = (n: number | null | undefined) =>
  n === null || n === undefined ? null : round2(n);

/** The Flow board's default range, as on the page. */
const DEFAULT_FLOW_DAYS = 30;

interface FlowData {
  stories: Story[];
  sprints: Sprint[];
  board: KanbanBoard | null;
}

const browserData = async (): Promise<FlowData> => {
  const s = useWorkspaceStore.getState();
  return {
    stories: s.stories ?? [],
    sprints: s.sprints ?? [],
    board: (s.kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID) ?? null,
  };
};

const serverData = async (userId: string): Promise<FlowData> => {
  const [stories, sprints, board] = await Promise.all([
    serverListEntities<Story>(userId, KIND_STORY),
    serverListEntities<Sprint>(userId, KIND_SPRINT),
    serverGetEntity<KanbanBoard>(userId, KIND_KANBAN, KANBAN_BOARD_ID),
  ]);
  return { stories, sprints, board: board ?? null };
};

/** The sprint's days so far: its start to today, or to its end once over (the page's sprintRange). */
function sprintRange(sprint: Sprint, today: string): { from: string; to: string } | null {
  const start = isoDayNumber(sprint.startDate);
  const end = isoDayNumber(sprint.endDate);
  const now = isoDayNumber(today);
  if (start === null || now === null || now < start) return null;
  return {
    from: sprint.startDate,
    to: end !== null && end >= start && end < now ? sprint.endDate : today,
  };
}

/** The last `days` days, from no earlier than the first card arrived (the page's flowRange). */
function flowRange(items: readonly FlowItem[], today: string, days: number) {
  const now = isoDayNumber(today);
  if (now === null) return null;
  let first: number | null = null;
  for (const item of items) {
    const n = isoDayNumber(item.arrivedOn);
    if (n !== null && (first === null || n < first)) first = n;
  }
  if (first === null) return null;
  const back = now - (Math.max(1, Math.floor(days)) - 1);
  return { from: isoFromDayNumber(Math.min(now, Math.max(back, first))), to: today };
}

/**
 * Little's Law's lead time on the toolkit's day rule, as the page reads it
 * (cumulative-flow/view sameDayLeadTime): WIP counted at the end of each
 * day misses each item's last day, so avg WIP ÷ throughput is one day
 * under lib/flow cycleDays, which counts a same-day item as 1.
 */
const sameDayLeadTime = (rawDays: number) => rawDays + 1;

/** Sum of the In progress and Review limits, only when both are set (the page's boardWipLimit). */
function boardWipLimit(board: KanbanBoard | null): number | null {
  const l = board?.wipLimits;
  if (!l) return null;
  return l.in_progress > 0 && l.review > 0 ? l.in_progress + l.review : null;
}

const ListParams = z.object({
  source: z
    .enum(["sprint", "flow"])
    .optional()
    .describe(
      "Which board: the sprint's stories or the Flow board's cards. Default: the sprint when it has stories, else the Flow board."
    ),
  sprintId: z
    .string()
    .optional()
    .describe("The sprint to chart (Sprint board). Default: the active sprint, else the newest."),
  days: z
    .number()
    .int()
    .min(7)
    .max(180)
    .optional()
    .describe(
      "Flow board only: how many days back from today (default 30, from the first card at the earliest)."
    ),
});

function listState(data: FlowData, params: z.infer<typeof ListParams>, today: string) {
  // A sprint asked for by id must exist: falling back to the active one
  // would report another sprint's flow as the one asked about.
  if (
    params.sprintId &&
    params.source !== "flow" &&
    !data.sprints.some((s) => s.id === params.sprintId)
  ) {
    return {
      found: false as const,
      reason: "sprint_not_found" as const,
      sprintId: params.sprintId,
    };
  }
  const sprint = pickDefaultSprint(data.sprints, params.sprintId);
  const sprintItems = sprint ? storyItems(data.stories, { sprint }) : [];
  const source = params.source ?? (sprintItems.length > 0 ? "sprint" : "flow");
  const items = source === "sprint" ? sprintItems : cardItems(data.board?.cards ?? []);
  const workflow = source === "sprint" ? SPRINT_WORKFLOW : BOARD_WORKFLOW;
  const range =
    source === "sprint"
      ? sprint && items.length
        ? sprintRange(sprint, today)
        : null
      : flowRange(items, today, params.days ?? DEFAULT_FLOW_DAYS);
  const counts = range ? dailyCounts(items, workflow, range) : { days: [], approximate: 0 };
  const totals = counts.days.map((d) => ({
    date: d.date,
    total: workflow.stages.reduce((sum, s) => sum + (d.counts[s.id] ?? 0), 0),
    wip: wipOf(d, workflow),
    done: doneOf(d, workflow),
  }));
  const enough = enoughData(totals.length, "average");
  const law = enough ? littlesLaw(totals) : null;
  const finished = range ? finishedItems(items, range) : [];
  const measured = cycleSummary(finished.map((f) => f.days));
  return {
    found: true as const,
    source,
    sprintId: source === "sprint" ? (sprint?.id ?? null) : null,
    sprintName: source === "sprint" ? (sprint?.name ?? null) : null,
    range,
    itemCount: items.length,
    stages: workflow.stages.map((s) => ({ id: s.id, label: s.label, kind: s.kind })),
    days: counts.days.map((d) => ({ date: d.date, counts: { ...d.counts } })),
    latest: totals[totals.length - 1] ?? null,
    enoughDays: enough,
    minDays: MIN_SAMPLE.average,
    avgWip: law ? round2(law.avgWip) : null,
    throughputPerDay: law ? round2(law.throughputPerDay) : enough && totals.length >= 2 ? 0 : null,
    littlesLawDays: law ? round2(sameDayLeadTime(law.leadTimeDays)) : null,
    measuredCycleTime: {
      count: measured.count,
      averageDays: enoughData(measured.count, "average") ? round2OrNull(measured.average) : null,
    },
    approximateItems: counts.approximate,
    wipLimit: boardWipLimit(data.board),
  };
}

// ──────── tool.cumulative_flow.list_state ────────
registry.register({
  id: "tool.cumulative_flow.list_state",
  toolId: "tool.cumulative_flow",
  name: "list_state",
  category: "read",
  description:
    "The cumulative flow the page draws from a board, read live: the sprint's stories by status (To do, In progress, Review, Done) or the Flow board's cards by column, one point per calendar day (local days; done is the running total). Params: source? 'sprint' | 'flow' (default: the sprint when it has stories, else the Flow board), sprintId? (default: the active sprint, else the newest; an id that matches no sprint returns {found: false, reason: 'sprint_not_found', sprintId} instead of another sprint's flow), days? 7–180 (Flow board range back from today, default 30). Returns {found: true, source, sprintId, sprintName, range {from, to} | null (null before the sprint starts or without cards), itemCount, stages: {id, label, kind 'queue' | 'active' | 'done'}[], days: {date, counts: {stageId: n}}[], latest {date, total, wip, done} | null, enoughDays, minDays (3), avgWip, throughputPerDay (items finished per elapsed day), littlesLawDays (≈ days from start to done = avg WIP ÷ throughput + 1, on the page's day rule where a same-day item is 1 day, so it compares with measuredCycleTime) — all three null below minDays days, littlesLawDays also null with no throughput — measuredCycleTime {count, averageDays (null below 3 finished)}, approximateItems (placed from start/done stamps because their move history wasn't kept), wipLimit (In progress + Review limits from the board, null unless both are set)}. Typed snapshots stay on the device that typed them.",
  paramsSchema: ListParams,
  handler: async (params) => listState(await browserData(), params, todayIso()),
  mcpHandler: async (params, ctx) => listState(await serverData(ctx.userId), params, todayIso()),
});

// ──────── tool.cumulative_flow.compute ────────
registry.register({
  id: "tool.cumulative_flow.compute",
  toolId: "tool.cumulative_flow",
  name: "compute",
  category: "read",
  description:
    "Compute flow metrics from a CFD series the agent passes. Params: wip[] (in-progress count per point) and done[] (CUMULATIVE completed count per point), oldest first, equal length; dates? (YYYY-MM-DD per point, same length) so throughput is per elapsed day between uneven dates (without dates the points are taken as consecutive days). Returns {days (points), elapsedDays, avgWip, throughputPerDay, littlesLawCycleTimeDays (avgWip ÷ throughput; null without throughput), leadTimeDays (littlesLawCycleTimeDays + 1: the page's reading for WIP counted at the end of each day, where a same-day item is 1 day, as list_state's littlesLawDays; null without throughput), wipControlLimits {centerLine, ucl, lcl} | null, wipStable (all WIP within the limits) | null}. As on the page: avgWip, throughput and Little's Law are null below 3 points, and the control limits and wipStable below 8. Pure.",
  paramsSchema: z
    .object({
      wip: z
        .array(z.number().min(0))
        .min(2)
        .describe("In-progress item count per point, oldest first."),
      done: z
        .array(z.number().min(0))
        .min(2)
        .describe("Cumulative completed count per point, oldest first. Same length as wip."),
      dates: z
        .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
        .optional()
        .describe("The date of each point (YYYY-MM-DD), oldest first. Same length as wip."),
    })
    .refine((p) => p.wip.length === p.done.length, {
      message: "wip and done must be the same length.",
    })
    .refine((p) => !p.dates || p.dates.length === p.wip.length, {
      message: "dates must be the same length as wip.",
    }),
  handler: async (params) => {
    const { wip, done } = params;
    const n = wip.length;
    // Without dates, one point per day, as the series has always been read.
    const dates = params.dates ?? wip.map((_, i) => addDays("2000-01-01", i) as string);
    const points = wip.map((w, i) => ({ date: dates[i], wip: w, done: done[i] }));
    const enough = enoughData(n, "average");
    const law = enough ? littlesLaw(points) : null;
    const numbers = dates.map(isoDayNumber).filter((d): d is number => d !== null);
    const elapsedDays = numbers.length >= 2 ? Math.max(...numbers) - Math.min(...numbers) : 0;
    const limits = enoughData(n, "changePoint") ? xmrLimits(wip, true) : null;
    return {
      days: n,
      elapsedDays,
      avgWip: enough ? round2(wip.reduce((a, b) => a + b, 0) / n) : null,
      throughputPerDay: law ? round2(law.throughputPerDay) : enough ? 0 : null,
      littlesLawCycleTimeDays: law ? round2(law.leadTimeDays) : null,
      leadTimeDays: law ? round2(sameDayLeadTime(law.leadTimeDays)) : null,
      wipControlLimits: limits
        ? {
            centerLine: round2(limits.centerLine),
            ucl: round2(limits.ucl),
            lcl: round2(limits.lcl),
          }
        : null,
      wipStable: limits ? wip.every((v) => v >= limits.lcl && v <= limits.ucl) : null,
    };
  },
});
