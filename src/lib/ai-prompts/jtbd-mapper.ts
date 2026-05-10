import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

interface JobStory {
  id: string;
  situation: string;
  motivation: string;
  outcome: string;
  parentJobId?: string;
  description?: string;
}

function renderJob(j: JobStory): string {
  return `When ${j.situation || "(situation)"}, I want to ${j.motivation || "(motivation)"}, so I can ${j.outcome || "(outcome)"}.`;
}

export function generateJtbdPrompts(
  data: { jobs: JobStory[] },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.jobs.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const table = formatTable(
    ["#", "Job Story", "Parent", "Description"],
    data.jobs.slice(0, 30).map((j, i) => {
      const parent = j.parentJobId
        ? data.jobs.find((p) => p.id === j.parentJobId)
        : undefined;
      return [
        i + 1,
        renderJob(j),
        parent ? renderJob(parent).slice(0, 50) : "—",
        (j.description ?? "—").slice(0, 80),
      ];
    })
  );

  const orphans = data.jobs.filter((j) => !j.parentJobId).length;
  const childCount = data.jobs.length - orphans;

  return [
    {
      id: "jtbd-decomposition",
      title: "Job Story Decomposition Critique",
      description:
        "Evaluate whether jobs are decomposed at the right altitude — neither too abstract nor too solution-laden.",
      prompt:
        buildPreamble(
          "Job Story Mapper",
          `${data.jobs.length} job stories captured (${orphans} top-level, ${childCount} nested).`
        ) +
        `## Job Stories\n\n${table}${context}\n\n## Questions\n\n1. Are these job stories at a consistent level of abstraction, or do some collapse multiple jobs into one?\n2. Which jobs feel like solutions in disguise (\"I want to click button X\")?\n3. Where would you split a coarse job into 2-3 finer-grained ones?\n4. Suggest the next decomposition pass — which top-level jobs deserve children most?`,
    },
    {
      id: "jtbd-outcome-wording",
      title: "Outcome Wording Guidance",
      description:
        "Audit the \"so I can\" outcome clauses for emotional and functional clarity.",
      prompt:
        buildPreamble(
          "Job Story Mapper",
          "Strong outcomes describe the customer's progress — functional, emotional, or social — not the team's deliverable."
        ) +
        `## Job Stories\n\n${table}${context}\n\n## Questions\n\n1. Which outcome clauses describe genuine customer progress vs. internal metrics?\n2. Rewrite the 3 weakest outcomes to be more specific and progress-oriented.\n3. For each job, what success metric would tell you the outcome is achieved?\n4. Are any outcomes duplicates that suggest two job stories should be merged?`,
    },
  ];
}
