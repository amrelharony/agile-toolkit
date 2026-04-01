import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface VelocityData {
  sprints: { name: string; committed: number; completed: number }[];
  stats: { avgVelocity: number; predictability: number; sd: number; trendDir: string };
}

export function generateVelocityPrompts(data: VelocityData): PromptDefinition[] {
  if (data.sprints.length === 0) return [];

  const table = formatTable(
    ["Sprint", "Committed", "Completed", "Delta"],
    data.sprints.map((s) => [s.name, s.committed, s.completed, s.completed - s.committed])
  );

  const statsBlock = [
    `Average Velocity: ${Math.round(data.stats.avgVelocity * 10) / 10} pts/sprint`,
    `Predictability (completed ≥ committed): ${Math.round(data.stats.predictability)}%`,
    `Standard Deviation: ${Math.round(data.stats.sd * 10) / 10} pts`,
    `Trend Direction: ${data.stats.trendDir}`,
  ].join("\n");

  return [
    {
      id: "velocity-trend",
      title: "Velocity Trend Analysis",
      description: "Analyze velocity trends, stability, and what the numbers reveal about team performance.",
      prompt:
        buildPreamble("Velocity Tracker", "It shows sprint-by-sprint committed vs. completed story points.") +
        `## Sprint Data\n\n${table}\n\n## Summary Statistics\n\n${statsBlock}\n\n## Questions\n\n1. Is this team's velocity stable, improving, or declining? What does the trend tell us?\n2. How predictable is this team's delivery? What does the standard deviation suggest?\n3. Are there any sprints that look anomalous? What might explain them?\n4. Based on this data, what velocity range should the team commit to for the next sprint?\n5. What specific actions could improve both velocity and predictability?`,
    },
    {
      id: "velocity-commitment",
      title: "Commitment Accuracy Review",
      description: "Evaluate over/under-commitment patterns and calibration strategies.",
      prompt:
        buildPreamble("Velocity Tracker", "Compare committed vs. completed points each sprint to assess estimation accuracy.") +
        `## Sprint Data\n\n${table}\n\n## Summary Statistics\n\n${statsBlock}\n\n## Questions\n\n1. Is the team consistently over-committing or under-committing? By how much?\n2. What pattern of commitment bias do you see across sprints?\n3. How should the team adjust their sprint planning to improve commitment accuracy?\n4. What estimation techniques or practices would help close the gap between committed and completed?\n5. Create a brief "commitment calibration checklist" the team can use in sprint planning.`,
    },
    {
      id: "velocity-planning",
      title: "Release Planning with Velocity",
      description: "Use velocity data to forecast delivery timelines with confidence intervals.",
      prompt:
        buildPreamble("Velocity Tracker", "Use historical velocity to help with release planning.") +
        `## Sprint Data\n\n${table}\n\n## Summary Statistics\n\n${statsBlock}\n\n## Questions\n\nOur team needs to deliver a backlog. Using this velocity data:\n\n1. What velocity range (optimistic / likely / pessimistic) should we use for forecasting?\n2. If we have 100 story points remaining, how many sprints should we plan for at each confidence level?\n3. What are the key risks to these forecasts based on the velocity patterns you see?\n4. How can we communicate delivery timelines to stakeholders in a way that accounts for uncertainty?\n5. What leading indicators should we watch to know if we're falling behind the forecast?`,
    },
  ];
}
