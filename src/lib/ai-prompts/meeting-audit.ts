import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData, wrapUserContent } from "./prompt-utils";
import type { MeetingAudit } from "../stores/workspace-types";
import {
  AUDIT_QUESTIONS,
  CADENCE_LABEL,
  VERDICT_LABEL,
  auditSummary,
  auditVerdict,
  byCost,
  hoursText,
  ratingOf,
  weeklyHours,
} from "../meeting-audit/model";

/**
 * Copyable prompts over the meeting audit as the page shows it: each
 * meeting's cadence, length, headcount, person-hours a week, ratings and
 * verdict, for a ritual reset proposal and for running the kept meetings
 * better. Names, purposes and notes are typed by people, so the table is
 * wrapped as untrusted content.
 */
export function generateMeetingAuditPrompts(audits: readonly MeetingAudit[]): PromptDefinition[] {
  if (audits.length === 0) return [];
  const sorted = [...audits].sort(byCost);
  const { data: shown, truncated, totalCount } = truncateData(sorted, 30);
  const table = formatTable(
    [
      "Meeting",
      "How often",
      "Minutes",
      "People",
      "Person-hours a week",
      ...AUDIT_QUESTIONS.map((q) => q.label),
      "Verdict",
      "Purpose",
    ],
    shown.map((a) => [
      a.meeting,
      CADENCE_LABEL[a.cadence],
      a.minutes,
      a.attendees,
      hoursText(weeklyHours(a)),
      ...AUDIT_QUESTIONS.map((q) => ratingOf(a, q.id) ?? "-"),
      a.verdict ? VERDICT_LABEL[a.verdict] : "-",
      a.purpose || "-",
    ])
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} meetings)\n` : "";
  const data = wrapUserContent(`${table}${note}`);
  const verdict = auditVerdict(auditSummary(sorted));
  const scale = AUDIT_QUESTIONS.map((q) => `${q.label}: ${q.question}`).join("\n- ");
  return [
    {
      id: "meeting-audit-reset",
      title: "Ritual reset proposal",
      description: "A plan to keep, change or drop each meeting, with the time it frees.",
      prompt:
        buildPreamble(
          "Meeting Audit",
          "It lists the team's recurring meetings with what each costs in person-hours a week and the team's ratings from 1 (not at all) to 5 (always)."
        ) +
        `## The questions\n\n- ${scale}\n\n## Meetings\n\n${data}\n\n${verdict}\n\n## Questions\n\n1. For each meeting, keep, change or drop? Give one concrete change for each one you would change.\n2. Which changes free the most person-hours a week, and how many in total?\n3. Which meetings overlap in purpose and could be merged?\n4. Write a short proposal the team could agree at its next retro, with a trial period for each change.`,
    },
    {
      id: "meeting-audit-run-better",
      title: "Run the kept meetings better",
      description: "Agendas and formats for the meetings the team keeps.",
      prompt:
        buildPreamble("Meeting Audit", "Help the team run its recurring meetings better.") +
        `## Meetings\n\n${data}\n\n## Questions\n\n1. For the meetings rated lowest on outcome or energy, suggest an agenda and a format that would lift them.\n2. Which meetings would work better in writing, or with fewer people?\n3. What should each meeting's one-line purpose be?`,
    },
  ];
}
