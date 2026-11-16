/**
 * Meeting Audit's AI task, the server half: the instructions and the meetings
 * as data. Server-only, so the prompt never reaches the browser. The runner
 * adds the scope rule, the guardrail and the JSON-shape line, and wraps
 * `user()` in `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { AUDIT_QUESTIONS, CADENCE_LABEL } from "@/lib/meeting-audit/model";
import { meetingAuditSuggestTask } from "./meeting-audit";

const QUESTION_LINE = AUDIT_QUESTIONS.map((q) => `${q.id} (${q.question})`).join("; ");

export const meetingAuditSuggestPrompt = defineAiPrompt(meetingAuditSuggestTask, {
  system: [
    "You are an agile coach helping a team reset its recurring meetings.",
    "Each meeting comes with how often it meets, how many minutes it takes, how many people attend, its purpose, and the team's ratings from 1 (not at all) to 5 (always) on these questions:",
    `${QUESTION_LINE}.`,
    "Suggest up to 5 concrete changes that would save the most time or make the meetings more useful, the most valuable first: such as a shorter timebox, fewer people, a written update instead of a meeting, a clearer purpose, a different format, a lower cadence, or dropping a meeting for a trial period.",
    "Each change is one instruction of a few words about one meeting, with the meeting's id copied exactly as given and a reason of one sentence that uses the meeting's numbers or ratings.",
    "Keep the Scrum events (Sprint Planning, Daily Scrum, Sprint Review, Sprint Retrospective): suggest how to run them better, never that they be dropped.",
    "Skip meetings the team already marked to drop, and never invent meetings or ids.",
  ].join(" "),
  user: ({ meetings }) =>
    meetings
      .map((m) => {
        const ratings = Object.entries(m.ratings)
          .filter(([, v]) => typeof v === "number")
          .map(([k, v]) => `${k} ${v}`)
          .join(", ");
        return [
          `Meeting ${m.id}: ${m.meeting}`,
          `  ${CADENCE_LABEL[m.cadence]}, ${m.minutes} minutes, ${m.attendees} people`,
          m.purpose ? `  Purpose: ${m.purpose}` : null,
          `  Ratings: ${ratings || "not rated yet"}`,
          m.verdict ? `  Verdict so far: ${m.verdict}` : null,
          m.notes ? `  Notes: ${m.notes}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n"),
});
