import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

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

function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Centralized at-risk check — duplicated from the client so the AI prompt
 * generator stays free of UI-layer imports. Keep both impls in sync.
 */
function isAtRisk(
  startDate: string,
  milestone: { targetDays: number; completedAt?: string },
  todayMs: number
): boolean {
  if (milestone.completedAt) return false;
  const start = parseLocalDate(startDate);
  if (!start) return false;
  const elapsed = (todayMs - start.getTime()) / 86400000;
  return elapsed > milestone.targetDays * 0.5;
}

export function generateOnboardingTrackerPrompts(
  data: {
    onboardees: OnboardingPersonData[];
    avgTimeToFirstPR: number | null;
    avgTimeToProductivity: number | null;
    atRiskCount: number;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.onboardees.length === 0) return [];
  const today = Date.now();
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";

  const personRows = data.onboardees.slice(0, 15).map((p) => {
    const completed = p.milestones.filter((m) => m.completedAt).length;
    const start = parseLocalDate(p.startDate);
    const ageDays = start
      ? Math.floor((today - start.getTime()) / 86400000)
      : 0;
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

  const overdue = data.onboardees.flatMap((p) =>
    p.milestones
      .filter((m) => isAtRisk(p.startDate, m, today))
      .map((m) => [p.name, m.name, m.targetDays])
  );

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
        `## People\n\n${personTable}\n\n## At-risk milestones (>50% past target, no completion)\n\n${overdueTable}\n\n## Questions\n\n1. Which milestone is the most common bottleneck across the cohort?\n2. Are environment-setup milestones (first commit) lagging more than independence milestones?\n3. What 3 changes to the onboarding playbook would compress the ramp?` +
        wsContext,
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
        `## People\n\n${personTable}\n\n## Questions\n\n1. Which onboardees would benefit most from a dedicated mentor right now?\n2. What pairing patterns (PR review buddies, shadow rotations, codebase tours) fit each person's stage?\n3. Suggest a 4-week mentorship cadence and the specific milestones it should support.` +
        wsContext,
    },
  ];
}
