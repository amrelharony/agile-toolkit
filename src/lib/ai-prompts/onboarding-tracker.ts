import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
// The tracker's own definitions (pure, server-safe): a milestone's status
// and the KPIs are counted here exactly as the page and its cards count them.
import {
  dayOf,
  isFinished,
  milestoneStatus,
  onboardingStats,
  onboardingVerdict,
  type Onboardee,
} from "@/app/(tools)/onboarding-tracker/model";
import { markStatText } from "@/app/(tools)/onboarding-tracker/markdown";

/** "Day 12", "Starts in 3 days", or "No start date". */
function dayText(day: number | null): string {
  if (day === null) return "No start date";
  if (day < 0) return `Starts in ${-day === 1 ? "1 day" : `${-day} days`}`;
  return `Day ${day}`;
}

/**
 * Prompts for the Onboarding Speed Tracker. Statuses and KPIs are the
 * page's (onboarding-tracker/model): a milestone is overdue once the days
 * since the start pass its target and at risk once more than half of it has
 * passed; the averages need MIN_SAMPLE.average people, and below that the
 * prompt says how many reached it rather than quoting a mean.
 */
export function generateOnboardingTrackerPrompts(
  data: {
    /** The people as the page lists them (roster names applied). */
    onboardees: readonly Onboardee[];
    /** "YYYY-MM-DD": the page's today. */
    today: string;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  const { onboardees, today } = data;
  if (onboardees.length === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";
  const stats = onboardingStats(onboardees, today);

  const late = onboardees.flatMap((p) => {
    const day = dayOf(p, today);
    return p.milestones.flatMap((m) => {
      const status = milestoneStatus(day ?? 0, m);
      return status === "overdue" || status === "at-risk" ? [{ p, m, day, status }] : [];
    });
  });
  // Overdue first, as the page's callout reads.
  late.sort((a, b) => Number(a.status === "at-risk") - Number(b.status === "at-risk"));

  const personTable = formatTable(
    ["Name", "Role", "Buddy", "Started", "Today", "Milestones", "Overdue / at risk", "Description"],
    onboardees.slice(0, 15).map((p) => {
      const completed = p.milestones.filter((m) => m.completedAt).length;
      const mine = late.filter((l) => l.p === p);
      const overdue = mine.filter((l) => l.status === "overdue").length;
      return [
        p.name,
        p.role ?? "—",
        p.buddy || "—",
        p.startDate || "—",
        dayText(dayOf(p, today)),
        `${completed}/${p.milestones.length}${isFinished(p) ? " (finished)" : ""}`,
        `${overdue} / ${mine.length - overdue}`,
        (p.description ?? "—").slice(0, 60),
      ];
    })
  );

  const lateTable =
    late.length > 0
      ? formatTable(
          ["Person", "Milestone", "Target day", "Today", "Status"],
          late
            .slice(0, 20)
            .map(({ p, m, day, status }) => [
              p.name,
              m.name,
              m.targetDays,
              dayText(day),
              status === "overdue" ? "Overdue" : "At risk",
            ])
        )
      : "_No overdue or at-risk milestones._";

  const people =
    `${stats.active} active onboardee${stats.active === 1 ? "" : "s"}` +
    (stats.finished > 0 ? ` (${stats.finished} more finished every milestone)` : "");

  return [
    {
      id: "onboarding-bottleneck",
      title: "Onboarding bottleneck analysis",
      description: "Find where new joiners are stuck and what is slowing them down.",
      prompt:
        buildPreamble(
          "Onboarding Speed Tracker",
          `${people}. Time to first PR: ${markStatText(stats.firstPr)}. Time to productivity: ${markStatText(stats.productive)}. Overdue / at-risk milestones: ${stats.overdue} / ${stats.atRisk}.`
        ) +
        `## Where things stand\n\n${onboardingVerdict(onboardees, today)}\n\n## People\n\n${personTable}\n\n## Overdue (past the target day) and at-risk (more than half the target time used) milestones\n\n${lateTable}${wsContext}\n\n## Questions\n\n1. Which milestone is the most common bottleneck across the cohort?\n2. Are environment-setup milestones (first commit) lagging more than independence milestones?\n3. What 3 changes to the onboarding playbook would compress the ramp?`,
    },
    {
      id: "onboarding-mentorship",
      title: "Mentorship recommendations",
      description: "Suggest pairing, shadowing, and mentor rotations to accelerate ramp.",
      prompt:
        buildPreamble(
          "Onboarding Speed Tracker",
          "Mentorship is the highest-leverage variable in time-to-productivity."
        ) +
        `## People\n\n${personTable}${wsContext}\n\n## Questions\n\n1. Which onboardees would benefit most from a dedicated mentor right now?\n2. What pairing patterns (PR review buddies, shadow rotations, codebase tours) fit each person's stage?\n3. Suggest a 4-week mentorship cadence and the specific milestones it should support.`,
    },
  ];
}
