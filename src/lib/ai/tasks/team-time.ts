/**
 * Team Time's AI task, the def: a short note on the team's schedule with up
 * to four tips, from where the team works (places merged by offset and
 * office, never a person's name), how many minutes everyone shares, which
 * meetings land outside people's hours, the offices' anchor days and the
 * clock changes ahead. The note is only shown, with Copy: nothing is saved
 * from it. Without AI the page's own rules answer (lib/team-time/note
 * `scheduleTips`, through `team-time.lite.ts`, which pages import). The
 * prompt is in `team-time.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { NOTE_MAX } from "@/lib/team-time/note";
import { teamTimeScheduleNoteFallback } from "./team-time.lite";

export { SCHEDULE_NOTE_MAX, teamTimeScheduleNoteFallback } from "./team-time.lite";

const count = z.number().int().min(0).max(50);

const input = z.object({
  places: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(NOTE_MAX.label),
        offsetMinutes: z.number().int().min(-720).max(840),
        people: z.number().int().min(1).max(50),
        hours: z.string().trim().max(NOTE_MAX.hours),
        days: z.string().trim().max(NOTE_MAX.days),
      })
    )
    .min(1)
    .max(NOTE_MAX.places),
  overlapMinutes: z.number().int().min(0).max(1440),
  mostOverlapMinutes: z.number().int().min(0).max(1440),
  meetings: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(NOTE_MAX.meetingName),
        outsideHours: count,
        nightOrDayOff: count,
      })
    )
    .max(NOTE_MAX.meetings),
  anchorDays: z
    .array(
      z.object({
        site: z.string().trim().min(1).max(NOTE_MAX.site),
        days: z.array(z.number().int().min(0).max(6)).max(7),
      })
    )
    .max(NOTE_MAX.anchorDays),
  clockChanges: z
    .array(z.string().trim().min(1).max(NOTE_MAX.clockChange))
    .max(NOTE_MAX.clockChanges),
});

const output = z.object({
  note: z.string().trim().min(1).max(NOTE_MAX.note),
  tips: z.array(z.string().trim().min(1).max(NOTE_MAX.tip)).max(NOTE_MAX.tips),
});

export type ScheduleNoteAiInput = z.infer<typeof input>;
export type ScheduleNoteAiOutput = z.infer<typeof output>;

export const teamTimeScheduleNoteTask = defineAiTask({
  id: "team-time.schedule_note",
  toolId: "team-time",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: teamTimeScheduleNoteFallback,
  sample: {
    places: [
      { label: "Sydney", offsetMinutes: 660, people: 1, hours: "07:00–15:00", days: "Mon–Fri" },
      { label: "Bengaluru", offsetMinutes: 330, people: 1, hours: "11:00–19:30", days: "Mon–Fri" },
      { label: "Cairo", offsetMinutes: 120, people: 1, hours: "09:00–17:00", days: "Sun–Thu" },
      {
        label: "London office",
        offsetMinutes: 0,
        people: 2,
        hours: "09:00–17:30",
        days: "Mon–Fri",
      },
      { label: "Toronto", offsetMinutes: -300, people: 1, hours: "08:00–16:00", days: "Mon–Fri" },
    ],
    overlapMinutes: 0,
    mostOverlapMinutes: 60,
    meetings: [
      { name: "Daily Scrum", outsideHours: 3, nightOrDayOff: 1 },
      { name: "Retro", outsideHours: 3, nightOrDayOff: 2 },
    ],
    anchorDays: [{ site: "London office", days: [4] }],
    clockChanges: [],
  },
});
