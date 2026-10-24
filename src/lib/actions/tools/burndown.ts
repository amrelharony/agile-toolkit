/**
 * Burndown Generator — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.burndown.*
 *
 *   1. compute  — pure: the ideal line, the gap and a least-squares finish
 *                 for a remaining[] series the agent passes (lib/sprints/
 *                 metrics). With the sprint's dates it counts working days,
 *                 as the page does.
 *   2. status   — what the Burndown page shows for a sprint: the burn read
 *                 off the sprint board's stories (else the typed daily log),
 *                 the ideal line on the team's working days, the gap, the
 *                 % done of the current scope, the projected finish and the
 *                 verdict, day by day (lib/sprints/burn, the page's model).
 *   3. log_day  — merge one day of the typed daily log (remaining, the
 *                 scope-change flag, the note), the way the page writes it
 *                 (lib/sprints/day-writes).
 *
 * Backing CRUD: workspace.sprint.*, workspace.sprint_series.*,
 * workspace.story.*, workspace.ceremony_cadence.* (auto-generated). The
 * entity kinds match workspace-store's registerCollection names, so a
 * server write round-trips into the page.
 */

import { z } from "zod";
import { registry } from "../registry";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  CEREMONY_CADENCE_ID,
  type CeremonyCadenceDoc,
  type Sprint,
  type SprintSeries,
  type Story,
} from "@/lib/stores/workspace-types";
import { burnReport, burnSeries, burnStatus } from "@/lib/sprints/burn";
import { cadenceCalendar, normalizeCadence } from "@/lib/sprints/cadence";
import { normalizeCalendar, type WorkingCalendar } from "@/lib/sprints/calendar";
import { withBurndownDay, type BurndownDayPatch } from "@/lib/sprints/day-writes";
import { isExampleSprintId } from "@/lib/sprints/example";
import { fitLine, gap as gapOf, gapLabel, projectFinish } from "@/lib/sprints/metrics";
import {
  dayDate,
  dayEntry,
  endDateFor,
  hasSyntheticDates,
  idealRemainingAt,
  pickDefaultSprint,
  sprintLengthDays,
} from "@/lib/sprints/series";
import { todayLocalISO } from "@/lib/utils/formatters";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** MUST match registerCollection(...) in workspace-store.ts. */
const KIND_SPRINT = "workspace:sprint";
const KIND_SERIES = "workspace:sprintSeries";
const KIND_STORY = "workspace:story";
const KIND_CADENCE = "workspace:ceremonyCadence";

const ws = () => useWorkspaceStore.getState();

/* ── Where the sprint data lives ──────────────────────────────────────── */

/**
 * The browser's workspace, or the user's rows on the server: the sprints,
 * their daily logs, the stories and the team's working calendar. Shared
 * with tool.burnup.*.
 */
export interface BurnStore {
  sprints(): Promise<Sprint[]>;
  series(sprintId: string): Promise<SprintSeries | undefined>;
  stories(): Promise<Story[]>;
  calendar(): Promise<WorkingCalendar>;
  putSeries(series: SprintSeries): Promise<void>;
}

export const browserBurnStore: BurnStore = {
  sprints: async () => ws().sprints ?? [],
  series: async (id) => (ws().sprintSeries ?? []).find((s) => s.id === id),
  stories: async () => ws().stories ?? [],
  calendar: async () =>
    cadenceCalendar(
      normalizeCadence((ws().ceremonyCadences ?? []).find((d) => d.id === CEREMONY_CADENCE_ID))
    ),
  putSeries: async (series) => ws().upsertSprintSeries(series),
};

export function serverBurnStore(userId: string): BurnStore {
  return {
    sprints: async () => serverListEntities<Sprint>(userId, KIND_SPRINT),
    series: async (id) =>
      (await serverGetEntity<SprintSeries>(userId, KIND_SERIES, id)) ?? undefined,
    stories: async () => serverListEntities<Story>(userId, KIND_STORY),
    calendar: async () =>
      cadenceCalendar(
        normalizeCadence(
          await serverGetEntity<CeremonyCadenceDoc>(userId, KIND_CADENCE, CEREMONY_CADENCE_ID)
        )
      ),
    putSeries: async (series) => {
      await serverUpsertEntity<SprintSeries>(userId, KIND_SERIES, series);
    },
  };
}

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

/** The params every status action takes. */
export const StatusParams = z.object({
  sprintId: z
    .string()
    .max(128)
    .optional()
    .describe("The sprint; defaults to the active sprint, else the newest (as the page opens)."),
  today: ISO_DATE.optional().describe("Read the sprint as of this day; defaults to today."),
  source: z
    .enum(["stories", "log"])
    .optional()
    .describe(
      "Show this source when it holds anything (the page's switch); absent, the rule decides: the board while the sprint has pointed stories, else the typed log."
    ),
});

/**
 * The page's burn for a sprint (`burnReport`), or why there is none. The
 * sprint defaults the way the page picks one (pickDefaultSprint).
 */
export async function readBurn(store: BurnStore, params: z.infer<typeof StatusParams>) {
  const sprints = await store.sprints();
  if (sprints.length === 0) return { found: false as const, reason: "no_sprints" as const };
  const sprint = params.sprintId
    ? sprints.find((s) => s.id === params.sprintId)
    : pickDefaultSprint(sprints, null);
  if (!sprint) return { found: false as const, reason: "not_found" as const };
  const [series, stories, calendar] = await Promise.all([
    store.series(sprint.id),
    store.stories(),
    store.calendar(),
  ]);
  const report = burnReport({
    sprint,
    series,
    stories,
    calendar,
    today: params.today ?? todayLocalISO(),
    ...(params.source ? { prefer: params.source } : {}),
  });
  return { found: true as const, ...report };
}

/** The status actions' return shape, described once for both tools. */
export const STATUS_RETURNS =
  "Returns {found: false, reason: 'no_sprints' | 'not_found'} or {found: true, sprintId, sprintName, sprintStatus, source ('stories': read off the sprint board's pointed stories; 'log': the typed daily log; 'none'), available: {stories, log}, phase ('before' | 'running' | 'over' | 'undated'), lengthDays (the last day's number; day 0 is the start date), workingDays, onWorkingDays, todayDay, lastDay (the last day read), committed, base (what the ideal line starts from), initialScope, scopeNow, scopeAdded, scopeRemoved (points that joined or left after day 0), done, remaining, completionPct (of the current scope), idealRemaining, gap (remaining − ideal; positive = behind), gapLabel ('Behind by 3 points'), projectedFinishDay (calendar day the points left reach 0 at this pace; may be past lengthDays), willFinishOnTime, projectedMeetDay (calendar day the points done reach the current scope), willMeetOnTime, cantTell (open stories have no points, so the pace can't be read), unpointedOpen, caveats: string[], verdict (the burndown's sentence), scopeVerdict (the burnup's), days: {day, date, working, off ('weekend' | 'holiday' | null), ideal, remaining, done, scope, added, removed, from ('stories' | 'typed' | 'derived' | 'plan' | null)}[]}. The ideal line and the projections count the team's working days (the cadence's workingDays and holidays); 'Day N' stays a calendar day. The same numbers as the page.";

/* ── tool.burndown.compute ────────────────────────────────────────────── */

const CalendarParams = {
  startDate: ISO_DATE.optional().describe(
    "The sprint's first day. With endDate, remaining[i] is the reading on calendar day i and the ideal line counts working days, as the page does."
  ),
  endDate: ISO_DATE.optional().describe("The sprint's last day (the ideal reaches 0 on it)."),
  workingDays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .optional()
    .describe("Weekdays the team works, 0 = Sunday … 6 = Saturday; default Monday to Friday."),
  holidays: z.array(ISO_DATE).max(400).optional().describe("Team holidays, YYYY-MM-DD."),
};

/** A sprint the compute actions can chart from the dates an agent passed, or null without them. */
export function computeSprint(
  params: { startDate?: string; endDate?: string },
  pointsPlanned: number
): Sprint | null {
  if (!params.startDate || !params.endDate || params.endDate <= params.startDate) return null;
  const sprint: Sprint = {
    id: "compute",
    name: "This sprint",
    startDate: params.startDate,
    endDate: params.endDate,
    pointsPlanned,
    status: "active",
  };
  return hasSyntheticDates(sprint) ? null : sprint;
}

export function computeCalendar(params: {
  workingDays?: number[];
  holidays?: string[];
}): WorkingCalendar {
  return normalizeCalendar({ workingDays: params.workingDays, holidays: params.holidays });
}

const ComputeParams = z.object({
  totalPoints: z.number().min(0),
  remaining: z
    .array(z.number().min(0))
    .min(1)
    .max(400)
    .describe("Remaining points at the end of each elapsed day, oldest first."),
  sprintDays: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Without dates: the number of day-indices the ideal line spans (it reaches 0 at index sprintDays−1). Defaults to remaining.length. Ignored when startDate and endDate are given."
    ),
  ...CalendarParams,
});

function computeBurndown(params: z.infer<typeof ComputeParams>) {
  const { totalPoints, remaining } = params;
  const currentDay = remaining.length - 1; // 0-indexed
  const currentRemaining = remaining[currentDay];
  const slopePerDay = round1(fitLine(remaining).slope);
  const sprint = computeSprint(params, totalPoints);

  if (sprint) {
    // The page's model on a log of these readings: working-day ideal and projection.
    const calendar = computeCalendar(params);
    const series: SprintSeries = {
      id: sprint.id,
      days: remaining.map((r, day) => ({ day, remaining: r })),
    };
    const lengthDays = sprintLengthDays(sprint);
    const today = dayDate(sprint, Math.min(currentDay, lengthDays)) ?? params.startDate!;
    const burn = burnSeries({ sprint, series, stories: [], calendar, today });
    const status = burnStatus(burn, sprint);
    const ideal = idealRemainingAt(sprint, totalPoints, currentDay, burn.calendar);
    const gap = gapOf(currentRemaining, ideal);
    return {
      sprintDays: lengthDays + 1,
      currentDay,
      currentRemaining,
      idealRemainingNow: round1(ideal),
      gap,
      gapLabel: gapLabel(gap),
      onTrack: gap <= 0,
      slopePerDay,
      projectedCompletionDay: status.projectedFinishDay,
      willFinishOnTime: status.willFinishOnTime === true,
      convention: burn.onWorkingDays ? ("working_days" as const) : ("calendar_days" as const),
      lengthDays,
      workingDays: burn.workingDays,
    };
  }

  // The day-index model: the ideal falls from totalPoints at index 0 to 0
  // at index sprintDays−1, the shared ideal line over that many days.
  const sprintDays = params.sprintDays ?? remaining.length;
  const span: Sprint = {
    id: "compute",
    name: "This sprint",
    startDate: "2000-01-03",
    endDate: endDateFor("2000-01-03", Math.max(1, sprintDays - 1)),
    pointsPlanned: totalPoints,
    status: "active",
  };
  const ideal = sprintDays > 1 ? idealRemainingAt(span, totalPoints, currentDay) : 0;
  const gap = gapOf(currentRemaining, ideal);
  const finish = projectFinish(remaining);
  return {
    sprintDays,
    currentDay,
    currentRemaining,
    idealRemainingNow: round1(ideal),
    gap,
    gapLabel: gapLabel(gap),
    onTrack: gap <= 0,
    slopePerDay,
    projectedCompletionDay: finish,
    willFinishOnTime: finish !== null && finish <= sprintDays - 1,
    convention: "index" as const,
  };
}

registry.register({
  id: "tool.burndown.compute",
  toolId: "tool.burndown",
  name: "compute",
  category: "read",
  description:
    "Compute burndown status from numbers you pass (pure; to read a sprint as the page shows it, use tool.burndown.status). Params: totalPoints, remaining[] (one reading per elapsed day, oldest first), optional sprintDays, optional startDate/endDate (YYYY-MM-DD) with optional workingDays (0 = Sunday … 6 = Saturday, default Monday to Friday) and holidays. Returns {sprintDays, currentDay, currentRemaining, idealRemainingNow, gap (actual−ideal; +behind/−ahead), gapLabel, onTrack, slopePerDay, projectedCompletionDay (fractional day index; null if not burning down; the last index once 0 is reached), willFinishOnTime, convention}. CONVENTION without dates ('index'): the ideal burns from totalPoints at index 0 to 0 at the LAST index (sprintDays−1), so pass sprintDays = remaining.length or the sprint's day count. With startDate and endDate ('working_days'): remaining[i] is calendar day i (day 0 = startDate), the ideal reaches 0 on endDate and burns only on working days, the projection is a calendar day, and sprintDays = lengthDays + 1 (also returned with workingDays) — the page's numbers.",
  paramsSchema: ComputeParams,
  handler: async (params) => computeBurndown(params),
});

/* ── tool.burndown.status ─────────────────────────────────────────────── */

registry.register({
  id: "tool.burndown.status",
  toolId: "tool.burndown",
  name: "status",
  category: "read",
  description: `What the Burndown page shows for a sprint: the points left, done and in scope by day, read off the sprint board's stories when the sprint has pointed stories (each story's sprint moves say when it joined or left; its status history when it was done), else the typed daily log; the ideal line on the team's working days; the gap, the % done and the projected finish; and the verdict sentence. Params: {sprintId?, today?, source?}. ${STATUS_RETURNS}`,
  paramsSchema: StatusParams,
  handler: async (params) => readBurn(browserBurnStore, params),
  mcpHandler: async (params, ctx) => readBurn(serverBurnStore(ctx.userId), params),
});

/* ── tool.burndown.log_day ────────────────────────────────────────────── */

const LogDayParams = z
  .object({
    sprintId: z.string().min(1).max(128),
    day: z
      .number()
      .int()
      .min(0)
      .max(400)
      .describe("Calendar day of the sprint: 0 is the start date, the last day is lengthDays."),
    remaining: z
      .number()
      .min(0)
      .max(100_000)
      .nullable()
      .optional()
      .describe("Points left at the end of the day; null clears it."),
    scopeChange: z
      .boolean()
      .optional()
      .describe(
        "Flag the day as a scope change. Where remaining rose that day, Burnup's scope rises with it."
      ),
    note: z
      .string()
      .max(280)
      .nullable()
      .optional()
      .describe("The day's note; null or empty clears it."),
  })
  .refine((p) => p.remaining !== undefined || p.scopeChange !== undefined || p.note !== undefined, {
    message: "Give remaining, scopeChange or note.",
  });

async function logBurndownDay(store: BurnStore, params: z.infer<typeof LogDayParams>) {
  const sprint = (await store.sprints()).find((s) => s.id === params.sprintId);
  if (!sprint) return { logged: false as const, reason: "not_found" as const };
  if (isExampleSprintId(sprint.id))
    return { logged: false as const, reason: "example_sprint" as const };
  if (hasSyntheticDates(sprint)) return { logged: false as const, reason: "no_dates" as const };
  const lengthDays = sprintLengthDays(sprint);
  if (params.day > lengthDays) {
    return { logged: false as const, reason: "day_out_of_range" as const, lengthDays };
  }
  const patch: BurndownDayPatch = {};
  if (params.remaining !== undefined) patch.remaining = params.remaining;
  if (params.scopeChange !== undefined) patch.scopeChange = params.scopeChange;
  if (params.note !== undefined) patch.note = params.note;
  const current = (await store.series(sprint.id)) ?? { id: sprint.id };
  const next = withBurndownDay(sprint, current, params.day, patch);
  await store.putSeries({ ...next, id: sprint.id });
  return {
    logged: true as const,
    sprintId: sprint.id,
    day: params.day,
    entry: dayEntry(next, params.day) ?? null,
  };
}

registry.register({
  id: "tool.burndown.log_day",
  toolId: "tool.burndown",
  name: "log_day",
  category: "write",
  requiresConfirmation: false,
  description:
    "Merge one day into a sprint's typed daily log, as the Burndown page writes it: {sprintId, day (calendar day 0…lengthDays), remaining? (points left; null clears), scopeChange? (flag; on a day remaining rose, the day's scope follows so Burnup's scope line rises; a scope Burnup typed is never touched), note? (null clears)}. Only the fields given change; the rest of the day and the other days stay. The log is the fallback: while the sprint has pointed stories, the page and tool.burndown.status read the board instead. Returns {logged: true, sprintId, day, entry (the day as stored, null when it emptied)} or {logged: false, reason: 'not_found' | 'example_sprint' | 'no_dates' | 'day_out_of_range'}.",
  paramsSchema: LogDayParams,
  handler: async (params) => logBurndownDay(browserBurnStore, params),
  mcpHandler: async (params, ctx) => logBurndownDay(serverBurnStore(ctx.userId), params),
});
