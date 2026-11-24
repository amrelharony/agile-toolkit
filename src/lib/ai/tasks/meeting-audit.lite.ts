/**
 * Meeting Audit's AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `meeting-audit.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import type { MeetingAudit } from "@/lib/stores/workspace-types";
import { ruleChanges } from "@/lib/meeting-audit/model";
import type {
  MeetingAuditAiInput,
  MeetingAuditAiOutput,
  MeetingChangeSuggestion,
} from "./meeting-audit";
export type {
  MeetingAuditAiInput,
  MeetingAuditAiOutput,
  MeetingChangeSuggestion,
} from "./meeting-audit";

/** At most this many meetings per ask: a team's recurring calendar. */
export const MEETING_AUDIT_MAX_MEETINGS = 30;
/** Purposes and notes as sent: the first 300 characters say enough. */
export const MEETING_AUDIT_TEXT_MAX = 300;
/**
 * Ids as the task takes them. A stored id can be longer (an agent may choose
 * one), so the page leaves such a meeting out of the ask.
 */
export const MEETING_AUDIT_ID_MAX = 64;

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

/** The task's answer without AI. */
export const meetingAuditSuggestFallback = ({
  meetings,
}: MeetingAuditAiInput): MeetingAuditAiOutput => ({ changes: fallbackChanges(meetings) });

export const meetingAuditSuggestTask = lazyAiTask<MeetingAuditAiInput, MeetingAuditAiOutput>(
  { id: "meeting-audit.suggest", toolId: "meeting-audit", fallback: meetingAuditSuggestFallback },
  () => import("./meeting-audit").then((m) => m.meetingAuditSuggestTask)
);
