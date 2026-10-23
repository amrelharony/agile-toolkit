/**
 * The ceremony cadence as agents send it: the checks `normalizeCadence`
 * applies, as a zod schema, so a bad time or weekday is rejected with a
 * message instead of silently becoming the default. Shared by the
 * `workspace.ceremony_cadence` CRUD and `tool.ceremony_cadence.set`.
 */

import { z } from "zod";
import { MAX_SPRINT_LENGTH_DAYS, TIME_PATTERN } from "./cadence";
import { MAX_HOLIDAYS, isIsoDate } from "./calendar";

export const TimeSchema = z.string().regex(TIME_PATTERN, 'a local time as "HH:MM" (24-hour)');

/** 0 = Sunday … 6 = Saturday. */
export const WeekdaySchema = z.number().int().min(0).max(6);

/** A calendar date, "YYYY-MM-DD", that exists. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as "YYYY-MM-DD"')
  .refine((v) => isIsoDate(v), "a real calendar date");

export const CeremonyCadenceFields = {
  sprintLengthDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_SPRINT_LENGTH_DAYS)
    .describe("Calendar days from the first day to the last day (a two-week sprint is 14)."),
  dailyTime: TimeSchema.describe("Daily Scrum time, local HH:MM."),
  dailyWeekdays: z
    .array(WeekdaySchema)
    .min(1)
    .describe("Weekdays the Daily Scrum runs on: 0 = Sunday … 6 = Saturday."),
  planningTime: TimeSchema.describe("Sprint Planning time on day 0, local HH:MM."),
  reviewTime: TimeSchema.describe("Sprint Review time on the last day, local HH:MM."),
  retroTime: TimeSchema.describe("Sprint Retrospective time on the last day, local HH:MM."),
  refinement: z
    .object({ weekday: WeekdaySchema, time: TimeSchema })
    .nullable()
    .describe("Weekly Backlog Refinement slot, or null when the team has no fixed one."),
  workingDays: z
    .array(WeekdaySchema)
    .min(1)
    .optional()
    .describe(
      "Weekdays the team works, 0 = Sunday … 6 = Saturday (default Monday to Friday). Ideal lines and day counts skip the others."
    ),
  holidays: z
    .array(IsoDateSchema)
    .max(MAX_HOLIDAYS)
    .optional()
    .describe(
      'Team holidays as "YYYY-MM-DD": not counted as working days, and no Daily Scrum or refinement on them. [] clears them.'
    ),
};

/** A whole cadence. */
export const CeremonyCadenceSchema = z.object(CeremonyCadenceFields);

/** Some of a cadence: what `tool.ceremony_cadence.set` takes. */
export const CeremonyCadencePatchSchema = z.object(CeremonyCadenceFields).partial();
