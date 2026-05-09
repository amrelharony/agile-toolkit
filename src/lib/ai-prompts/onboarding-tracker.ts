import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface OnboardingMilestoneData {
  name: string;
  targetDays: number;
  completedAt?: string;
  notes?: string;
}

interface OnboardingPersonData {
  name: string;
  role?: string;
  startDate: string;
  description?: string;
  milestones: OnboardingMilestoneData[];
}

export function generateOnboardingTrackerPrompts(data: {
  onboardees: OnboardingPersonData[];
  avgTimeToFirstPR: number | null;
  avgTimeToProductivity: number | null;
  atRiskCount: number;
}): PromptDefinition[] {
  if (data.onboardees.length === 0) return [];
  const today = Date.now();

  const personRows = data.onboardees.slice(0, 15).map((p) => {
    const completed = p.milestones.filter((m) => m.completedAt).length;
    const ageDays = Math.floor(
      (today - new Date(p.startDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    return [
      p.name,
      p.role ?? "—",
      p.startDate,
      `${ageDays}d`,
      `${completed}/${p.milestones.length}`,
      (p.description ?? "—").slice(0, 60),
    ];
  });

  const personTable = formatTable(
    ["Name", "Role", "Started", "Age", "Milestones", "Description"],
    personRows
  );

  const overdue = data.onboardees.flatMap((p) => {
    const start = new Date(p.startDate).getTime();
    return p.milestones
      .filter((m) => {
        if (m.completedAt) return false;
        const dayElapsed = Math.floor((today - start) / (1000 * 60 * 60 * 24));
        return dayElapsed > m.targetDays * 0.5;
      })
      .map((m) => [p.name, m.name, m.targetDays]);
  });

  const overdueTable =
    overdue.length > 0
      ? formatTable(["Person", "Milestone", "Target days"], overdue.slice(0, 20))
      : "_No at-risk milestones._";

  return [
    {
      id: "onboarding-bottleneck",
      title: "Onboarding bottleneck analysis",
      description:
        "Find where new joiners are stuck and what is slowing them down.",
      prompt:
        buildPreamble(
          "Onboarding Speed Tracker",
          `${data.onboardees.length} active onboardees. Avg time-to-first-PR ${
            data.avgTimeToFirstPR !== null
              ? data.avgTimeToFirstPR.toFixed(1) + "d"
              : "n/a"
          }. Avg time-to-productivity ${
            data.avgTimeToProductivity !== null
              ? data.avgTimeToProductivity.toFixed(1) + "d"
              : "n/a"
          }. At-risk milestones: ${data.atRiskCount}.`
        ) +
        `## People\n\n${personTable}\n\n## At-risk milestones (>50% past target, no completion)\n\n${overdueTable}\n\n## Questions\n\n1. Which milestone is the most common bottleneck across the cohort?\n2. Are environment-setup milestones (first commit) lagging more than independence milestones?\n3. What 3 changes to the onboarding playbook would compress the ramp?`,
    },
    {
      id: "onboarding-mentorship",
      title: "Mentorship recommendations",
      description:
        "Suggest pairing, shadowing, and mentor rotations to accelerate ramp.",
      prompt:
        buildPreamble(
          "Onboarding Speed Tracker",
          "Mentorship is the highest-leverage variable in time-to-productivity."
        ) +
        `## People\n\n${personTable}\n\n## Questions\n\n1. Which onboardees would benefit most from a dedicated mentor right now?\n2. What pairing patterns (PR review buddies, shadow rotations, codebase tours) fit each person's stage?\n3. Suggest a 4-week mentorship cadence and the specific milestones it should support.`,
    },
  ];
}
