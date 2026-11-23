/**
 * Team Time's AI task, the lite half pages import (no zod; the def, with
 * its schemas, is `team-time.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import { NOTE_MAX, scheduleTips } from "@/lib/team-time/note";
import type { ScheduleNoteAiInput, ScheduleNoteAiOutput } from "./team-time";
export type { ScheduleNoteAiInput, ScheduleNoteAiOutput } from "./team-time";

/** The note's caps (lib/team-time/note), for the page. */
export const SCHEDULE_NOTE_MAX = NOTE_MAX;

/**
 * The note without AI: the page's own rules over the same facts (where the
 * team is, how much it shares, then up to four tips). An input with no
 * places, which the schema refuses, throws: the button then asks to fill
 * the tool in first.
 */
export const teamTimeScheduleNoteFallback = (i: ScheduleNoteAiInput): ScheduleNoteAiOutput =>
  scheduleTips(i);

export const teamTimeScheduleNoteTask = lazyAiTask<ScheduleNoteAiInput, ScheduleNoteAiOutput>(
  {
    id: "team-time.schedule_note",
    toolId: "team-time",
    fallback: teamTimeScheduleNoteFallback,
  },
  () => import("./team-time").then((m) => m.teamTimeScheduleNoteTask)
);
