import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";
// The tracker's own numbers (pure, server-safe): the prompt counts as the page does.
import {
  addressedShare,
  cadenceVerdict,
  compareCadence,
  isIsoDay,
  lastText,
  meetingsThisMonth,
  overdueActions,
  supersededIds,
  targetText,
  type AgendaItem,
  type Meeting,
  type ReportCadence,
} from "@/app/(tools)/one-on-one/model";

/** "Overdue" past its due day (as overdueActions counts it), else "Open"; "Done 2026-05-01" once done. */
function followUpStatus(a: AgendaItem, today: string): string {
  if (a.status === "done") return a.doneAt ? `Done ${a.doneAt}` : "Done";
  return a.dueDate && isIsoDay(a.dueDate) && a.dueDate < today ? "Overdue" : "Open";
}

/**
 * Prompts for the 1:1 tracker. The numbers are the page's (one-on-one/model):
 * an item is open, discussed, given an action or done; a carried-over item
 * counts once, in the 1:1 it was carried to; the cadence per report is the
 * page's rows (`cadenceByReport`, which needs the roster and the cadences
 * set, so the page hands them over).
 */
export function generateOneOnOnePrompts(
  data: {
    meetings: readonly Meeting[];
    /** The page's cadence rows, one per report. */
    reports: readonly ReportCadence[];
    /** "YYYY-MM-DD": the page's today. */
    today: string;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.meetings.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const { meetings, reports, today } = data;

  const sorted = [...meetings].sort((a, b) => b.date.localeCompare(a.date));
  const recent = sorted.slice(0, 8);

  const meetingTable = formatTable(
    ["Date", "Manager", "Report", "Agenda items", "Open/Discussed/Action/Done", "Description"],
    recent.map((m) => {
      const n = (s: AgendaItem["status"]) => m.agenda.filter((a) => a.status === s).length;
      // Truncate to 80 chars so the table stays scannable but the model
      // still sees the framing the user gave each meeting.
      const desc = m.description
        ? m.description.length > 80
          ? `${m.description.slice(0, 77)}...`
          : m.description
        : "—";
      return [
        m.date || "No date",
        m.manager,
        m.report,
        m.agenda.length,
        `${n("open")}/${n("discussed")}/${n("action_required")}/${n("done")}`,
        desc,
      ];
    })
  );

  // Follow-ups as the page counts them: an action carried to a later 1:1
  // is listed once, there. Open ones first, then the done ones.
  const superseded = supersededIds(meetings);
  const followUps = meetings.flatMap((m) =>
    m.agenda
      .filter(
        (a) => (a.status === "action_required" || a.status === "done") && !superseded.has(a.id)
      )
      .map((a) => ({ m, a }))
  );
  followUps.sort((x, y) => Number(x.a.status === "done") - Number(y.a.status === "done"));
  const actionTable =
    followUps.length > 0
      ? formatTable(
          ["Meeting", "Action", "Owner", "Due", "Status"],
          followUps
            .slice(0, 15)
            .map(({ m, a }) => [
              `${m.manager} ↔ ${m.report} (${m.date || "no date"})`,
              (a.action || a.text).slice(0, 60),
              a.owner ?? "—",
              a.dueDate ?? "—",
              followUpStatus(a, today),
            ])
        )
      : "_No action items captured yet._";

  const cadenceTable =
    reports.length > 0
      ? formatTable(
          ["Report", "1:1s held", "Last 1:1", "Cadence", "Past it by", "Next 1:1", "Open actions"],
          [...reports]
            .sort(compareCadence)
            .map((r) => [
              r.name,
              r.meetings,
              lastText(r),
              targetText(r) || "none yet",
              r.overdueBy !== null ? `${r.overdueBy} d` : "—",
              r.nextDate ?? "—",
              r.openActions,
            ])
        )
      : "_No reports yet._";

  const addressed = addressedShare(meetings);
  const pastCadence = reports.filter((r) => r.overdueBy !== null).length;
  const reportsText = reports.length === 1 ? "1 report" : `${reports.length} reports`;
  const standing = [
    `- ${cadenceVerdict(reports)}`,
    `- Meetings this month: ${meetingsThisMonth(meetings, today)}`,
    `- Action items overdue: ${overdueActions(meetings, today)}`,
    `- Addressed (discussed, actioned or done): ${addressed === null ? "—" : `${Math.round(addressed * 100)}%`}`,
    `- Past their cadence: ${reports.some((r) => r.targetDays !== null) ? `${pastCadence} of ${reportsText}` : `— (no cadence set or read from history yet)`}`,
  ].join("\n");

  return [
    {
      id: "one-on-one-cadence",
      title: "1:1 Cadence Review",
      description: "Audit cadence, attendance, and the open-vs-action balance across recent 1:1s.",
      prompt:
        buildPreamble(
          "1:1 Meeting Tracker",
          `${meetings.length} meetings logged across ${
            new Set(meetings.map((m) => `${m.manager}-${m.report}`)).size
          } pair(s).`
        ) +
        `## Where things stand\n\n${standing}\n\n## Cadence per report\n\n${cadenceTable}\n\n## Recent meetings\n\n${meetingTable}\n\n## Action items\n\n${actionTable}\n\n## Questions\n\n1. Is the cadence consistent? Where are gaps that suggest skipped 1:1s?\n2. Are agendas getting discussed (vs. perpetually open)?\n3. Are action items closing or piling up?\n4. Recommend 2 changes to the 1:1 ritual to lift signal-to-noise.${context}`,
    },
    {
      id: "one-on-one-career",
      title: "Career Conversation Prompts",
      description: "Generate growth-themed questions tailored to recent agenda content.",
      prompt:
        buildPreamble(
          "1:1 Meeting Tracker",
          "Career conversations need explicit airtime — they don't happen by accident."
        ) +
        `## Recent meetings\n\n${meetingTable}\n\n## Questions\n\n1. Suggest 5 career-conversation prompts that complement (not duplicate) the recent agenda.\n2. For each pair, identify a growth theme worth probing in the next 1:1.\n3. What signals in the agenda suggest the report needs more challenge vs. more support?\n4. Recommend a once-a-quarter career-arc check-in template tailored to this manager-report pair.${context}`,
    },
  ];
}
