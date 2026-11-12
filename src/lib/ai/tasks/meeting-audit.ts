/**
 * Meeting Audit's AI task, the browser-safe half: up to five concrete changes
 * to the team's recurring meetings, from their length, cadence, headcount,
 * purpose and ratings. The person accepts each one; an accepted change goes
 * into that meeting's notes with its verdict set to change, with Undo.
 *
 * Without AI the rules answer (lib/meeting-audit/model ruleChanges: a long
 * daily meeting is timeboxed, a long one with no outcome is cut, …), so the
 * audit works the same with AI off. The prompt is in `meeting-audit.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  MEETING_CADENCES,
  MEETING_VERDICTS,
  type MeetingAudit,
} from "@/lib/stores/workspace-types";
import {
  ATTENDEES_MAX,
  MEETING_CHANGES_MAX,
  MINUTES_MAX,
  RATING_MAX,
  RATING_MIN,
  ruleChanges,
} from "@/lib/meeting-audit/model";

/** At most this many meetings per ask: a team's recurring calendar. */
export const MEETING_AUDIT_MAX_MEETINGS = 30;
/** Purposes and notes as sent: the first 300 characters say enough. */
export const MEETING_AUDIT_TEXT_MAX = 300;
const ID_MAX = 64;

const rating = z.number().int().min(RATING_MIN).max(RATING_MAX).optional();

const input = z.object({
  meetings: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(ID_MAX),
        meeting: z.string().trim().min(1).max(200),
        cadence: z.enum(MEETING_CADENCES),
        minutes: z.number().positive().max(MINUTES_MAX),
        attendees: z.number().int().min(1).max(ATTENDEES_MAX),
        purpose: z.string().trim().max(MEETING_AUDIT_TEXT_MAX).optional(),
        ratings: z.object({
          purpose: rating,
          people: rating,
          outcome: rating,
          length: rating,
          energy: rating,
        }),
        verdict: z.enum(MEETING_VERDICTS).optional(),
        notes: z.string().trim().max(MEETING_AUDIT_TEXT_MAX).optional(),
      })
    )
    .min(1)
    .max(MEETING_AUDIT_MAX_MEETINGS),
});

const output = z.object({
  changes: z
    .array(
      z.object({
        meetingId: z.string().trim().min(1).max(ID_MAX),
        change: z.string().trim().min(1).max(200),
        why: z.string().trim().min(1).max(300),
      })
    )
    .max(MEETING_CHANGES_MAX),
});

export type MeetingAuditAiInput = z.infer<typeof input>;
export type MeetingChangeSuggestion = z.infer<typeof output>["changes"][number];

/** The task's view of one meeting, as the rules read it. */
function asAudit(m: MeetingAuditAiInput["meetings"][number]): MeetingAudit {
  const ratings: Record<string, number> = {};
  for (const [k, v] of Object.entries(m.ratings)) if (typeof v === "number") ratings[k] = v;
  return {
    id: m.id,
    meeting: m.meeting,
    cadence: m.cadence,
    minutes: m.minutes,
    attendees: m.attendees,
    purpose: m.purpose ?? "",
    ratings,
    ...(m.verdict ? { verdict: m.verdict } : {}),
    ...(m.notes ? { notes: m.notes } : {}),
    createdAt: "",
    updatedAt: "",
  };
}

/** The changes without AI: the rules over the same meetings. */
export function fallbackChanges(
  meetings: MeetingAuditAiInput["meetings"]
): MeetingChangeSuggestion[] {
  return ruleChanges(meetings.map(asAudit));
}

export const meetingAuditSuggestTask = defineAiTask({
  id: "meeting-audit.suggest",
  toolId: "meeting-audit",
  tier: "full",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: ({ meetings }) => ({ changes: fallbackChanges(meetings) }),
  sample: {
    meetings: [
      {
        id: "meeting_a1",
        meeting: "Daily Scrum",
        cadence: "daily",
        minutes: 30,
        attendees: 7,
        purpose: "Inspect progress toward the Sprint Goal and plan the next day.",
        ratings: { purpose: 4, people: 4, outcome: 3, length: 2, energy: 3 },
      },
      {
        id: "meeting_a2",
        meeting: "Weekly status sync",
        cadence: "weekly",
        minutes: 60,
        attendees: 12,
        purpose: "Everyone reports what they did.",
        ratings: { purpose: 2, people: 2, outcome: 1, length: 2, energy: 1 },
      },
    ],
  },
});
