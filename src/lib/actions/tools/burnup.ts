/**
 * Burnup Generator — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.burnup.*
 *
 *   1. compute  — pure: progress, scope added and removed, and a
 *                 least-squares forecast of the day the done line meets the
 *                 current scope, for scope[] and completed[] the agent
 *                 passes (lib/sprints/metrics). With the sprint's dates it
 *                 counts working days, as the page does.
 *   2. status   — what the Burnup page shows for a sprint (lib/sprints/burn,
 *                 the same read as tool.burndown.status, whose numbers it
 *                 shares; its headline is the scope verdict).
 *   3. log_day  — merge one day of the typed daily log (scope, points done,
 *                 the note), the way the page writes it (lib/sprints/day-writes).
 */

import { z } from "zod";
import { registry } from "../registry";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { burnSeries, burnStatus } from "@/lib/sprints/burn";
import { withBurnupDay, type BurnupDayPatch } from "@/lib/sprints/day-writes";
import { isExampleSprintId } from "@/lib/sprints/example";
import { completionPct, fitLine, projectFinish } from "@/lib/sprints/metrics";
import { dayDate, dayEntry, hasSyntheticDates, sprintLengthDays } from "@/lib/sprints/series";
import {
  STATUS_RETURNS,
  StatusParams,
  browserBurnStore,
  computeCalendar,
  computeSprint,
  readBurn,
  serverBurnStore,
  type BurnStore,
} from "./burndown";

const round1 = (n: number) => Math.round(n * 10) / 10;

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

/* ── tool.burnup.compute ──────────────────────────────────────────────── */

const ComputeParams = z
  .object({
    scope: z
      .array(z.number().min(0))
      .min(1)
      .max(400)
      .describe("Total scope per day, oldest first."),
    completed: z
      .array(z.number().min(0))
      .min(1)
      .max(400)
      .describe("Completed points per day, oldest first. Same length as scope."),
    startDate: ISO_DATE.optional().describe(
      "The sprint's first day. With endDate, entry i is calendar day i and the forecast counts working days, as the page does."
    ),
    endDate: ISO_DATE.optional().describe("The sprint's last day."),
    workingDays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .optional()
      .describe("Weekdays the team works, 0 = Sunday … 6 = Saturday; default Monday to Friday."),
    holidays: z.array(ISO_DATE).max(400).optional().describe("Team holidays, YYYY-MM-DD."),
  })
  .refine((p) => p.scope.length === p.completed.length, {
    message: "scope and completed must be the same length.",
  });

/** Day-to-day rises and falls of the scope: what joined and what left. */
function churn(scope: readonly number[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (let i = 1; i < scope.length; i++) {
    const step = scope[i] - scope[i - 1];
    if (step > 0) added += step;
    else removed -= step;
  }
  return { added: round1(added), removed: round1(removed) };
}

function computeBurnup(params: z.infer<typeof ComputeParams>) {
  const { scope, completed } = params;
  const last = scope.length - 1;
  const currentScope = scope[last];
  const currentCompleted = completed[last];
  const remaining = currentScope - currentCompleted;
  const { added, removed } = churn(scope);
  const base = {
    currentScope,
    currentCompleted,
    remaining: round1(remaining),
    // Of the current scope, 0–100 (0 while there is no scope).
    percentComplete: completionPct(currentCompleted, currentScope) ?? 0,
    // Net, as documented: last minus first (removals pull it down).
    scopeCreep: round1(currentScope - scope[0]),
    scopeAdded: added,
    scopeRemoved: removed,
    completedPerDay: round1(fitLine(completed).slope),
  };

  const sprint = computeSprint(params, scope[0]);
  if (sprint) {
    // The page's model on a log of these readings: the done line on working days.
    const series: SprintSeries = {
      id: sprint.id,
      days: scope.map((s, day) => ({ day, scope: s, completed: completed[day] })),
    };
    const lengthDays = sprintLengthDays(sprint);
    const today = dayDate(sprint, Math.min(last, lengthDays)) ?? params.startDate!;
    const burn = burnSeries({
      sprint,
      series,
      stories: [],
      calendar: computeCalendar(params),
      today,
    });
    const status = burnStatus(burn, sprint);
    return {
      ...base,
      forecastDoneDay: remaining <= 0 ? last : status.projectedMeetDay,
      willMeetOnTime: remaining <= 0 ? last <= lengthDays : status.willMeetOnTime,
      convention: burn.onWorkingDays ? ("working_days" as const) : ("calendar_days" as const),
      lengthDays,
      workingDays: burn.workingDays,
    };
  }

  return {
    ...base,
    // When the completed trend reaches the current scope (projectFinish with a target).
    forecastDoneDay: remaining <= 0 ? last : projectFinish(completed, { target: currentScope }),
    convention: "index" as const,
  };
}

registry.register({
  id: "tool.burnup.compute",
  toolId: "tool.burnup",
  name: "compute",
  category: "read",
  description:
    "Compute burnup status from numbers you pass (pure; to read a sprint as the page shows it, use tool.burnup.status). Params: scope[] and completed[] (per elapsed day, oldest first, equal length), optional startDate/endDate (YYYY-MM-DD) with optional workingDays (0 = Sunday … 6 = Saturday, default Monday to Friday) and holidays. Returns {currentScope, currentCompleted, remaining, percentComplete (of the current scope, 0–100; 0 without scope), scopeCreep (net: scope[last]−scope[first]), scopeAdded and scopeRemoved (the day-to-day rises and falls of the scope, so a +5 then −8 reads as both), completedPerDay, forecastDoneDay (day index when the completed trend meets the current scope; the last index once met; null if not progressing), convention}. With startDate and endDate ('working_days'), entry i is calendar day i, the forecast runs on working days and is a calendar day, and willMeetOnTime, lengthDays and workingDays are added — the page's numbers.",
  paramsSchema: ComputeParams,
  handler: async (params) => computeBurnup(params),
});

/* ── tool.burnup.status ───────────────────────────────────────────────── */

registry.register({
  id: "tool.burnup.status",
  toolId: "tool.burnup",
  name: "status",
  category: "read",
  description: `What the Burnup page shows for a sprint: the scope and the points done by day, read off the sprint board's stories when the sprint has pointed stories (a story joining or leaving the sprint moves the scope that day), else the typed daily log; the scope added and removed since day 0; the % done of the current scope; the day the work meets the scope at this pace; and the scope verdict sentence. The same read as tool.burndown.status. Params: {sprintId?, today?, source?}. ${STATUS_RETURNS}`,
  paramsSchema: StatusParams,
  handler: async (params) => readBurn(browserBurnStore, params),
  mcpHandler: async (params, ctx) => readBurn(serverBurnStore(ctx.userId), params),
});

/* ── tool.burnup.log_day ──────────────────────────────────────────────── */

const LogDayParams = z
  .object({
    sprintId: z.string().min(1).max(128),
    day: z
      .number()
      .int()
      .min(0)
      .max(400)
      .describe("Calendar day of the sprint: 0 is the start date, the last day is lengthDays."),
    scope: z
      .number()
      .min(0)
      .max(100_000)
      .nullable()
      .optional()
      .describe("Total scope that day (carried forward to later days); null clears it."),
    completed: z
      .number()
      .min(0)
      .max(100_000)
      .nullable()
      .optional()
      .describe("Points done by the end of the day, a running total; null clears it."),
    note: z
      .string()
      .max(280)
      .nullable()
      .optional()
      .describe("The day's note; null or empty clears it."),
  })
  .refine((p) => p.scope !== undefined || p.completed !== undefined || p.note !== undefined, {
    message: "Give scope, completed or note.",
  });

async function logBurnupDay(store: BurnStore, params: z.infer<typeof LogDayParams>) {
  const sprint: Sprint | undefined = (await store.sprints()).find((s) => s.id === params.sprintId);
  if (!sprint) return { logged: false as const, reason: "not_found" as const };
  if (isExampleSprintId(sprint.id))
    return { logged: false as const, reason: "example_sprint" as const };
  if (hasSyntheticDates(sprint)) return { logged: false as const, reason: "no_dates" as const };
  const lengthDays = sprintLengthDays(sprint);
  if (params.day > lengthDays) {
    return { logged: false as const, reason: "day_out_of_range" as const, lengthDays };
  }
  const patch: BurnupDayPatch = {};
  if (params.scope !== undefined) patch.scope = params.scope;
  if (params.completed !== undefined) patch.completed = params.completed;
  if (params.note !== undefined) patch.note = params.note;
  const current = (await store.series(sprint.id)) ?? { id: sprint.id };
  const next = withBurnupDay(current, params.day, patch);
  await store.putSeries({ ...next, id: sprint.id });
  return {
    logged: true as const,
    sprintId: sprint.id,
    day: params.day,
    entry: dayEntry(next, params.day) ?? null,
  };
}

registry.register({
  id: "tool.burnup.log_day",
  toolId: "tool.burnup",
  name: "log_day",
  category: "write",
  requiresConfirmation: false,
  description:
    "Merge one day into a sprint's typed daily log, as the Burnup page writes it: {sprintId, day (calendar day 0…lengthDays), scope? (total scope that day; null clears), completed? (points done, a running total; null clears), note? (null clears)}. Only the fields given change. The log is the fallback: while the sprint has pointed stories, the page and tool.burnup.status read the board instead. Returns {logged: true, sprintId, day, entry (the day as stored, null when it emptied)} or {logged: false, reason: 'not_found' | 'example_sprint' | 'no_dates' | 'day_out_of_range'}.",
  paramsSchema: LogDayParams,
  handler: async (params) => logBurnupDay(browserBurnStore, params),
  mcpHandler: async (params, ctx) => logBurnupDay(serverBurnStore(ctx.userId), params),
});
