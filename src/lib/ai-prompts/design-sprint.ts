import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

interface Task {
  id: string;
  text: string;
  done: boolean;
  owner?: string;
}

interface DaySection {
  day: 1 | 2 | 3 | 4 | 5;
  dayName: string;
  tasks: Task[];
  artifacts: string[];
}

interface Sprint {
  id: string;
  name: string;
  startDate: string;
  currentDay: 1 | 2 | 3 | 4 | 5;
  days: DaySection[];
  description?: string;
  decider?: string;
  facilitator?: string;
}

export function generateDesignSprintPrompts(
  data: {
    sprint: Sprint | null;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (!data.sprint) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const totalTasks = data.sprint.days.reduce((acc, d) => acc + d.tasks.length, 0);
  const doneTasks = data.sprint.days.reduce(
    (acc, d) => acc + d.tasks.filter((t) => t.done).length,
    0
  );
  const pct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

  const dayTable = formatTable(
    ["Day", "Phase", "Tasks", "Done", "Artifacts"],
    data.sprint.days.map((d) => [
      `Day ${d.day}`,
      d.dayName,
      d.tasks.length,
      d.tasks.filter((t) => t.done).length,
      d.artifacts.length,
    ])
  );

  const tasksToday =
    data.sprint.days.find((d) => d.day === data.sprint!.currentDay)?.tasks ?? [];
  const taskLines = tasksToday
    .map(
      (t) =>
        `- [${t.done ? "x" : " "}] ${t.text}${t.owner ? ` (${t.owner})` : ""}`
    )
    .join("\n");

  return [
    {
      id: "ds-coach",
      title: "Day-by-day coaching guide",
      description: "Tactical guidance for the team's current day in the GV design sprint.",
      prompt:
        buildPreamble(
          "Design Sprint Tracker",
          `Sprint "${data.sprint.name}", started ${data.sprint.startDate}. Currently on Day ${data.sprint.currentDay} (${data.sprint.days.find((d) => d.day === data.sprint!.currentDay)?.dayName}). ${pct}% of tasks done overall. Decider: ${data.sprint.decider ?? "(unassigned)"}, Facilitator: ${data.sprint.facilitator ?? "(unassigned)"}.`
        ) +
        `## Day breakdown\n\n${dayTable}\n\n## Today's tasks (Day ${data.sprint.currentDay})\n\n${taskLines || "(no tasks yet)"}\n\n## Questions\n\n1. What is the single most-important outcome for today and what would "good" look like?\n2. Which tasks above are the biggest time-sinks if not tightly facilitated?\n3. Recommend 2 facilitation moves the Decider/Facilitator should make this morning.\n4. What artifact must exist by end of day to unblock tomorrow?${context}`,
    },
    {
      id: "ds-critique",
      title: "Critique the team's framing",
      description: "Pressure-test how the team has framed the problem and constrained scope.",
      prompt:
        buildPreamble(
          "Design Sprint Tracker",
          `Sprint "${data.sprint.name}". ${data.sprint.description ?? "(no description provided)"}`
        ) +
        `## Day breakdown\n\n${dayTable}\n\n## Questions\n\n1. Is the sprint scope narrow enough to ship a testable prototype by Day 4?\n2. What signals would tell you the team is solving the wrong problem?\n3. If the user-test on Day 5 came back negative, what assumptions would be falsified?\n4. Suggest 2 framing alternatives the team could consider before locking in their target on Day 1.${context}`,
    },
  ];
}
