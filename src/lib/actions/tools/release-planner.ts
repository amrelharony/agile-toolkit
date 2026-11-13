/**
 * Release Planner — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1 — calculator)
 * Agent surface: tool.release_planner.*
 *
 * Pure compute, no persistence (plan D2: calculators expose compute_*). The
 * forecast runs the same seeded Monte Carlo as the page
 * (lib/sprints/release-forecast): sprints that delivered 0 are drawn like
 * any other, percentiles use the nearest-rank rule, and a run that never
 * finishes ranks last instead of being dropped — so an agent and the page
 * give the same numbers. No mcpHandler: it runs identically server- and
 * client-side.
 *
 * throughput_forecast is the page's "count items" mode
 * (lib/sprints/throughput-forecast): items finished per week, typed or read
 * off a board (so it has a server read too), into when N items are done,
 * how many fit by a date, and the cut line through features in order.
 */

import { z } from "zod";
import { registry } from "../registry";
import { serverGetEntity, serverListEntities } from "../server-store";
import {
  chanceWithin,
  deliverableIn,
  finishDate,
  simulateRelease,
  sprintsUntil,
} from "@/lib/sprints/release-forecast";
import {
  DEFAULT_WINDOW,
  FEATURE_ITEMS_MAX,
  FEATURES_MAX,
  MAX_WEEKS,
  throughputForecast,
  weeklyThroughput,
} from "@/lib/sprints/throughput-forecast";
import { cardItems, storyItems } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  type KanbanBoard,
  type KanbanCard,
  type Story,
} from "@/lib/stores/workspace-types";

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const ForecastParams = z.object({
  backlogPoints: z.number().min(0).describe("Remaining scope in story points."),
  velocities: z
    .array(z.number().min(0))
    .min(1)
    .describe(
      "Completed points of past sprints, e.g. the last 6–8. Sprints that delivered 0 count: they are real history."
    ),
  scopeChangePct: z
    .number()
    .min(-90)
    .max(500)
    .optional()
    .describe("Expected scope change, as a percent of the backlog (default 0; negative to cut)."),
  scopeBufferPct: z
    .number()
    .min(0)
    .optional()
    .describe("Older name for scopeChangePct; used when scopeChangePct is absent."),
  iterations: z
    .number()
    .int()
    .min(100)
    .max(50000)
    .optional()
    .describe("Monte-Carlo iterations (default 10000)."),
  startDate: IsoDay.optional().describe("When the first forecast sprint starts, for dates."),
  sprintLengthDays: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe("Calendar days per sprint."),
  targetDate: IsoDay.optional().describe(
    "Answer 'by this date?': the chance of finishing and the scope deliverable by then."
  ),
});

type ForecastInput = z.infer<typeof ForecastParams>;

export function releaseForecast(params: ForecastInput) {
  const change = params.scopeChangePct ?? params.scopeBufferPct ?? 0;
  const effectiveBacklog = Math.round(params.backlogPoints * (1 + change / 100) * 10) / 10;
  const velocities = params.velocities.filter((v) => Number.isFinite(v) && v >= 0);
  const avgVelocity =
    velocities.length > 0
      ? Math.round((velocities.reduce((a, b) => a + b, 0) / velocities.length) * 10) / 10
      : 0;
  const options = params.iterations ? { iterations: params.iterations } : {};
  const forecast = simulateRelease(effectiveBacklog, velocities, options);

  // Nothing left to deliver takes no sprints; no history means we can't say.
  const done = !(effectiveBacklog > 0);
  const finite = forecast ? Array.from(forecast.runs).filter(Number.isFinite) : [];
  const sprints = done
    ? { p50: 0, p75: 0, p85: 0, p95: 0 }
    : {
        p50: forecast?.p50 ?? null,
        p75: forecast?.p75 ?? null,
        p85: forecast?.p85 ?? null,
        p95: forecast?.p95 ?? null,
      };
  const { startDate, sprintLengthDays: length, targetDate } = params;
  const datesKnown = Boolean(startDate && length);
  const dateAt = (n: number | null) =>
    datesKnown && n !== null ? finishDate(startDate as string, n, length as number) : null;

  let target: {
    date: string;
    sprints: number;
    chance: number;
    deliverable: { p50: number; p85: number } | null;
  } | null = null;
  if (datesKnown && targetDate) {
    const n = sprintsUntil(startDate as string, targetDate, length as number);
    target = {
      date: targetDate,
      sprints: n,
      chance: forecast ? Math.round(chanceWithin(forecast, n) * 1000) / 1000 : 0,
      deliverable: deliverableIn(velocities, n, options),
    };
  }

  return {
    effectiveBacklog,
    avgVelocity,
    sampleSize: velocities.length,
    sprints,
    unfinishedRuns: forecast?.unfinished ?? 0,
    minSprints: done ? 0 : finite.length > 0 ? finite[0] : null,
    maxSprints: done ? 0 : finite.length > 0 ? finite[finite.length - 1] : null,
    finishDates: datesKnown
      ? { p50: dateAt(sprints.p50), p85: dateAt(sprints.p85), p95: dateAt(sprints.p95) }
      : null,
    target,
  };
}

// ──────── tool.release_planner.forecast ────────
registry.register({
  id: "tool.release_planner.forecast",
  toolId: "tool.release_planner",
  name: "forecast",
  category: "read",
  description:
    "Monte-Carlo release forecast, the same as the Release Planner page: how many sprints a backlog needs at the team's past velocities (0-point sprints count). Returns {effectiveBacklog, avgVelocity, sampleSize, sprints: {p50, p75, p85, p95} (null when that many runs never finish), unfinishedRuns, minSprints, maxSprints, finishDates: {p50, p85, p95} (with startDate + sprintLengthDays), target: {date, sprints, chance (0–1), deliverable: {p50, p85} points} (with targetDate)}. Pure — no persistence.",
  paramsSchema: ForecastParams,
  handler: async (params) => releaseForecast(params),
});

// ──────── tool.release_planner.throughput_forecast ────────

const KIND_STORY = "workspace:story";
const KIND_KANBAN = "workspace:kanbanBoard";

interface BoardRead {
  stories: () => Promise<Story[]>;
  cards: () => Promise<KanbanCard[]>;
}

const browserBoards: BoardRead = {
  stories: async () => useWorkspaceStore.getState().stories ?? [],
  cards: async () =>
    (useWorkspaceStore.getState().kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID)
      ?.cards ?? [],
};

const serverBoards = (userId: string): BoardRead => ({
  stories: () => serverListEntities<Story>(userId, KIND_STORY),
  cards: async () =>
    (await serverGetEntity<KanbanBoard>(userId, KIND_KANBAN, KANBAN_BOARD_ID))?.cards ?? [],
});

const ThroughputParams = z.object({
  source: z
    .enum(["typed", "sprint", "flow"])
    .optional()
    .describe(
      "Where the weekly throughput comes from: 'typed' (weeklyThroughput), 'sprint' (stories finished on the Sprint board) or 'flow' (Flow board cards). Default: typed when weeklyThroughput is given, else the Sprint board when it has finished stories, else the Flow board."
    ),
  weeklyThroughput: z
    .array(z.number().int().min(0).max(100_000))
    .max(MAX_WEEKS)
    .optional()
    .describe("Items finished per week, oldest first. Quiet weeks count: pass them as 0."),
  weeks: z
    .union([z.literal(8), z.literal(12), z.literal(26), z.literal(52)])
    .optional()
    .describe("Complete weeks of a board's history to replay: 8, 12 (default), 26 or 52."),
  items: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .optional()
    .describe("Items left to finish: answers 'when will they be done?'."),
  startDate: IsoDay.optional().describe("The forecast's first day (default today)."),
  targetDate: IsoDay.optional().describe(
    "Answers 'how many items by this date?' and draws the features' cut line."
  ),
  features: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        items: z.number().int().min(1).max(FEATURE_ITEMS_MAX),
      })
    )
    .max(FEATURES_MAX)
    .optional()
    .describe("Features in build order, each with its item count, for the cut line."),
  iterations: z.number().int().min(100).max(50000).optional().describe("Runs (default 10000)."),
  today: IsoDay.optional().describe(
    "Today, for the boards' complete weeks (the week in progress isn't counted); default the server's today."
  ),
});

/** The page's item forecast for the params, reading a board when the throughput isn't typed. */
export async function throughputForecastAction(
  boards: BoardRead,
  params: z.infer<typeof ThroughputParams>
) {
  const today = params.today ?? todayIso();
  const start = params.startDate ?? today;
  let source = params.source ?? (params.weeklyThroughput ? "typed" : undefined);
  let finished: { doneOn: string | null }[] = [];
  if (source !== "typed") {
    const [stories, cards] = await Promise.all([boards.stories(), boards.cards()]);
    const fromStories = storyItems(stories).filter((i) => i.doneOn !== null);
    const fromCards = cardItems(cards).filter((i) => i.doneOn !== null);
    source ??= fromStories.length > 0 ? "sprint" : "flow";
    finished = source === "sprint" ? fromStories : fromCards;
  }
  const weeks =
    source === "typed"
      ? (params.weeklyThroughput ?? []).map((value, i) => ({ label: `Week ${i + 1}`, value }))
      : weeklyThroughput(finished, today, params.weeks ?? DEFAULT_WINDOW);
  const forecast = throughputForecast({
    samples: weeks.map((w) => w.value),
    items: params.items ?? null,
    start,
    target: params.targetDate ?? null,
    features: params.features ?? [],
    ...(params.iterations ? { iterations: params.iterations } : {}),
  });
  return { source, start, weeks, ...forecast };
}

registry.register({
  id: "tool.release_planner.throughput_forecast",
  toolId: "tool.release_planner",
  name: "throughput_forecast",
  category: "read",
  description:
    "The Release Planner's item-count forecast: a seeded Monte Carlo over items finished per week (complete ISO weeks; quiet weeks count as 0 and are drawn like any other), the same numbers as the page. Throughput is typed (weeklyThroughput) or read off the Sprint board's finished stories or the Flow board's cards. Answers 'when will N items be done?' (items), 'how many by a date?' (targetDate) and the cut line through features in build order (features). Returns {source, start, weeks: {label, value}[], weeksUsed, enough (4+ weeks, one with a finish), notEnough ('few-weeks' | 'nothing-finished' | null), average (items a week), when: {items, weeks {p50, p85, p95} (null when that share doesn't finish within 520 weeks), dates {p50, p85, p95}, histogram {weeks, count}[], unfinished, chance (0–1 by targetDate) | null} | null, howMany: {target, weeks, p50, p85, p95 (at least this many items in 50/85/95% of runs), histogram {items, count}[]} | null, cutLine: {target, rows {name, items, cumulative, weeks, p50Date, p85Date, inByTarget}[], above (features done by the target in 85% of runs) | null} | null}. Read only.",
  paramsSchema: ThroughputParams,
  handler: async (params) => throughputForecastAction(browserBoards, params),
  mcpHandler: async (params, ctx) => throughputForecastAction(serverBoards(ctx.userId), params),
});
