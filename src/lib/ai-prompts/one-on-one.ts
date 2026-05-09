import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface AgendaItem {
  id: string;
  text: string;
  status: "open" | "discussed" | "action_required";
  action?: string;
  owner?: string;
  dueDate?: string;
}

interface Meeting {
  id: string;
  manager: string;
  report: string;
  date: string;
  agenda: AgendaItem[];
  notes?: string;
  description?: string;
}

export function generateOneOnOnePrompts(data: {
  meetings: Meeting[];
}): PromptDefinition[] {
  if (data.meetings.length === 0) return [];

  const sorted = [...data.meetings].sort((a, b) => b.date.localeCompare(a.date));
  const recent = sorted.slice(0, 8);

  const meetingTable = formatTable(
    ["Date", "Manager", "Report", "Agenda items", "Open/Discussed/Action"],
    recent.map((m) => {
      const open = m.agenda.filter((a) => a.status === "open").length;
      const discussed = m.agenda.filter((a) => a.status === "discussed").length;
      const action = m.agenda.filter((a) => a.status === "action_required").length;
      return [m.date, m.manager, m.report, m.agenda.length, `${open}/${discussed}/${action}`];
    })
  );

  const allActions = data.meetings.flatMap((m) =>
    m.agenda
      .filter((a) => a.status === "action_required")
      .map((a) => ({
        meeting: `${m.manager} ↔ ${m.report} (${m.date})`,
        text: a.action || a.text,
        owner: a.owner,
        dueDate: a.dueDate,
      }))
  );

  const actionTable =
    allActions.length > 0
      ? formatTable(
          ["Meeting", "Action", "Owner", "Due"],
          allActions.slice(0, 15).map((a) => [
            a.meeting,
            a.text.slice(0, 60),
            a.owner ?? "—",
            a.dueDate ?? "—",
          ])
        )
      : "_No action items captured yet._";

  return [
    {
      id: "one-on-one-cadence",
      title: "1:1 Cadence Review",
      description:
        "Audit cadence, attendance, and the open-vs-action balance across recent 1:1s.",
      prompt:
        buildPreamble(
          "1:1 Meeting Tracker",
          `${data.meetings.length} meetings logged across ${new Set(
            data.meetings.map((m) => `${m.manager}-${m.report}`)
          ).size} pair(s).`
        ) +
        `## Recent meetings\n\n${meetingTable}\n\n## Action items\n\n${actionTable}\n\n## Questions\n\n1. Is the cadence consistent? Where are gaps that suggest skipped 1:1s?\n2. Are agendas getting discussed (vs. perpetually open)?\n3. Are action items closing or piling up?\n4. Recommend 2 changes to the 1:1 ritual to lift signal-to-noise.`,
    },
    {
      id: "one-on-one-career",
      title: "Career Conversation Prompts",
      description:
        "Generate growth-themed questions tailored to recent agenda content.",
      prompt:
        buildPreamble(
          "1:1 Meeting Tracker",
          "Career conversations need explicit airtime — they don't happen by accident."
        ) +
        `## Recent meetings\n\n${meetingTable}\n\n## Questions\n\n1. Suggest 5 career-conversation prompts that complement (not duplicate) the recent agenda.\n2. For each pair, identify a growth theme worth probing in the next 1:1.\n3. What signals in the agenda suggest the report needs more challenge vs. more support?\n4. Recommend a once-a-quarter career-arc check-in template tailored to this manager-report pair.`,
    },
  ];
}
