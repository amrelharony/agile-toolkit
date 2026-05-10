import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface SosEntry {
  meetingDate: string;
  team: string;
  kind: string;
  text: string;
  blockedBy?: string;
  status: string;
}

export function generateScrumOfScrumsPrompts(data: { entries: SosEntry[]; staleBlockers: SosEntry[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.entries.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const table = formatTable(
    ["Date", "Team", "Kind", "Text", "Blocked By", "Status"],
    data.entries.slice(0, 20).map((e) => [e.meetingDate, e.team, e.kind, e.text.slice(0, 40), e.blockedBy ?? "", e.status])
  );
  return [
    {
      id: "sos-escalation",
      title: "Escalation Strategy",
      description: "Coach on which blockers should be escalated and how.",
      prompt:
        buildPreamble(
          "Scrum of Scrums",
          `${data.staleBlockers.length} blocker(s) aged 3+ days.`
        ) +
        `## Recent entries\n\n${table}${context}\n\n## Questions\n\n1. Which blockers need RTE/leadership escalation now?\n2. Which dependencies should become formal integration stories?\n3. What patterns in the log suggest systemic coordination issues?`,
    },
    {
      id: "sos-health",
      title: "Coordination Health",
      description: "Evaluate the health of cross-team coordination.",
      prompt:
        buildPreamble("Scrum of Scrums", "Good SoS meetings surface coordination issues fast; bad ones just report status.") +
        `## Recent entries\n\n${table}${context}\n\n## Questions\n\n1. Is the log showing real coordination or just status broadcast?\n2. Which teams are disproportionately creating/absorbing blockers?\n3. Recommend 2 format changes for the next SoS meeting.`,
    },
  ];
}
