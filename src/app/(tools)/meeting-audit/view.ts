import type { MeetingAudit } from "@/lib/stores/workspace-types";
import {
  MEETING_AUDIT_MAX_MEETINGS,
  MEETING_AUDIT_TEXT_MAX,
  type MeetingAuditAiInput,
} from "@/lib/ai/tasks/meeting-audit";
import {
  ATTENDEES_MAX,
  AUDIT_QUESTION_IDS,
  MINUTES_MAX,
  ratingOf,
  type MeetingValues,
} from "@/lib/meeting-audit/model";

type AiRatings = MeetingAuditAiInput["meetings"][number]["ratings"];

/**
 * What Amr is asked about: up to 30 meetings (the costliest first, as
 * given), each cut to what the task takes. A meeting with no usable length
 * (a row an older build saved) is left out: it costs nothing to change.
 */
export function auditAiInput(audits: readonly MeetingAudit[]): MeetingAuditAiInput {
  return {
    meetings: audits
      .filter((a) => a.minutes > 0)
      .slice(0, MEETING_AUDIT_MAX_MEETINGS)
      .map((a) => {
        const ratings: AiRatings = {};
        for (const id of AUDIT_QUESTION_IDS) {
          const v = ratingOf(a, id);
          if (v !== null) ratings[id] = v;
        }
        const purpose = a.purpose.trim().slice(0, MEETING_AUDIT_TEXT_MAX);
        const notes = (a.notes ?? "").trim().slice(0, MEETING_AUDIT_TEXT_MAX);
        return {
          id: a.id,
          meeting: a.meeting.slice(0, 200),
          cadence: a.cadence,
          minutes: Math.min(a.minutes, MINUTES_MAX),
          attendees: Math.min(Math.max(1, Math.floor(a.attendees)), ATTENDEES_MAX),
          ...(purpose ? { purpose } : {}),
          ratings,
          ...(a.verdict ? { verdict: a.verdict } : {}),
          ...(notes ? { notes } : {}),
        };
      }),
  };
}

/** Which fields an edit changed, for the history log. */
export function changedFields(a: MeetingAudit, v: MeetingValues): string[] {
  const out: string[] = [];
  if (a.meeting !== v.meeting) out.push("meeting");
  if (a.cadence !== v.cadence) out.push("cadence");
  if (a.minutes !== v.minutes) out.push("minutes");
  if (a.attendees !== v.attendees) out.push("attendees");
  if (a.purpose !== v.purpose) out.push("purpose");
  if ((a.notes ?? "") !== (v.notes ?? "")) out.push("notes");
  return out;
}
