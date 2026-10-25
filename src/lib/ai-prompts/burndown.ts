import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import { gap } from "@/lib/sprints/metrics";
import { endDateFor, idealRemainingAt } from "@/lib/sprints/series";

interface BurndownData {
  config: { totalPoints: number; sprintDays: number; sprintStartDate: string };
  /**
   * `ideal`: the ideal points left that day as the page draws it (lib/sprints/burn,
   * on the team's working days). Without it, the shared ideal line on calendar days.
   * `gap`: the day's gap as the page quotes it (BurnDay.gap, from the exact
   * ideal); without it, worked out from the rounded ideal.
   */
  entries: {
    day: number;
    remaining: number | null;
    scopeChange: boolean;
    description?: string;
    ideal?: number;
    gap?: number | null;
  }[];
  /** Where the numbers came from: "From the sprint board", "Typed in the daily log". */
  source?: string;
}

export function generateBurndownPrompts(data: BurndownData): PromptDefinition[] {
  const filledEntries = data.entries.filter((e) => e.remaining !== null);
  if (filledEntries.length === 0 || data.config.sprintDays <= 0) return [];

  const sprint = {
    startDate: data.config.sprintStartDate,
    endDate: endDateFor(data.config.sprintStartDate, data.config.sprintDays),
  };
  const ideal = (e: BurndownData["entries"][number]) =>
    Math.round((e.ideal ?? idealRemainingAt(sprint, data.config.totalPoints, e.day)) * 10) / 10;
  const variance = (e: BurndownData["entries"][number]) =>
    typeof e.gap === "number" ? e.gap : gap(e.remaining!, ideal(e));

  const table = formatTable(
    ["Day", "Remaining", "Ideal", "Variance", "Scope Change", "Note"],
    filledEntries.map((e) => {
      return [
        e.day,
        e.remaining!,
        ideal(e),
        variance(e),
        e.scopeChange ? "Yes" : "",
        (e.description ?? "—").slice(0, 80),
      ];
    })
  );

  const scopeChanges = filledEntries.filter((e) => e.scopeChange).length;
  const lastEntry = filledEntries[filledEntries.length - 1];
  const currentVariance = lastEntry ? variance(lastEntry) : 0;

  const context = [
    `Sprint: ${data.config.sprintDays} days, ${data.config.totalPoints} story points planned`,
    `Start Date: ${data.config.sprintStartDate}`,
    `Latest data: Day ${lastEntry?.day ?? 0}, ${lastEntry?.remaining ?? "N/A"} pts remaining`,
    `Current variance from ideal: ${currentVariance > 0 ? "+" : ""}${currentVariance} pts (positive: behind)`,
    `Scope changes recorded: ${scopeChanges}`,
    ...(data.source ? [`Source: ${data.source}`] : []),
  ].join("\n");

  return [
    {
      id: "burndown-progress",
      title: "Sprint Progress Analysis",
      description: "Deep dive into whether the sprint is on track and what to do about it.",
      prompt:
        buildPreamble(
          "Burndown Chart",
          "It tracks remaining story points day by day against an ideal linear burn."
        ) +
        `## Sprint Configuration\n\n${context}\n\n## Day-by-Day Data\n\n${table}\n\n## Questions\n\n1. Is this sprint on track, ahead, or behind? By how much?\n2. What does the burn pattern tell you — is work being completed steadily or in bursts?\n3. Are there any plateau periods where no work was completed? What might cause this?\n4. Based on the current trajectory, will the team complete all planned work by sprint end?\n5. What mid-sprint corrections would you recommend right now?`,
    },
    {
      id: "burndown-shape",
      title: "Burndown Shape Coaching",
      description: "Classify the burndown pattern and get targeted coaching advice.",
      prompt:
        buildPreamble("Burndown Chart", "Analyze the shape of the burndown to coach the team.") +
        `## Sprint Configuration\n\n${context}\n\n## Day-by-Day Data\n\n${table}\n\n## Questions\n\nBurndown shapes reveal how a team works. Common patterns include:\n- **Steady burn**: Linear decline (ideal)\n- **Late burn / hockey stick**: Flat then steep drop near end\n- **Front-loaded**: Steep early, flat later\n- **Plateau & drop**: Periods of no progress followed by bursts\n- **Scope creep**: Line goes up before going down\n\n1. Which pattern best describes this burndown? Why?\n2. What does this pattern reveal about the team's workflow, testing, and integration practices?\n3. What specific process changes would move this team toward a steadier burn?\n4. How should the team structure their daily work and standups to achieve more consistent progress?\n5. What would an ideal burndown look like for this team given their sprint length and capacity?`,
    },
    ...(scopeChanges > 0
      ? [
          {
            id: "burndown-scope",
            title: "Scope Change Impact",
            description: "Analyze scope changes and their effect on sprint delivery.",
            prompt:
              buildPreamble("Burndown Chart", "Focus on scope changes during the sprint.") +
              `## Sprint Configuration\n\n${context}\n\n## Day-by-Day Data\n\n${table}\n\n## Questions\n\nThis sprint had ${scopeChanges} scope change(s) recorded.\n\n1. How did scope changes impact the team's ability to deliver on the original commitment?\n2. Are the scope changes happening early or late in the sprint? What does the timing tell us?\n3. What policies or agreements could the team establish to manage mid-sprint scope changes?\n4. How should the team communicate the impact of scope changes to stakeholders?\n5. Draft a brief "scope change protocol" that balances flexibility with sprint commitment integrity.`,
          },
        ]
      : []),
  ];
}
