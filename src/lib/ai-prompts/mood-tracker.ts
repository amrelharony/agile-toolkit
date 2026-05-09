import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import { mean } from "../analytics/anomaly";

interface MoodEntry {
  memberId: string;
  date: string;
  score: number;
  note?: string;
}

export function generateMoodTrackerPrompts(data: {
  entries: MoodEntry[];
  days: string[];
  overallAvg: number;
}): PromptDefinition[] {
  if (data.entries.length === 0) return [];
  const byDay = data.days.map((d) => {
    const todays = data.entries.filter((e) => e.date === d);
    return {
      date: d,
      avg: todays.length > 0 ? mean(todays.map((e) => e.score)) : 0,
      count: todays.length,
    };
  });
  const table = formatTable(
    ["Date", "Avg", "Responses"],
    byDay.map((d) => [d.date, d.avg ? d.avg.toFixed(2) : "-", d.count])
  );

  return [
    {
      id: "mood-interpretation",
      title: "Mood Trend Interpretation",
      description: "Coach on what the team's 14-day mood pattern reveals.",
      prompt:
        buildPreamble("Team Mood Tracker", `14-day average: ${data.overallAvg.toFixed(2)} / 5.`) +
        `## Daily Averages\n\n${table}\n\n## Questions\n\n1. What does this mood pattern tell you about team health?\n2. Are there correlation signals with sprint boundaries, incidents, or deadlines?\n3. Recommend 2-3 actions the Scrum Master should take.`,
    },
    {
      id: "mood-intervention",
      title: "Low-Mood Intervention Plan",
      description: "If mood is low or falling, build a plan to address it.",
      prompt:
        buildPreamble("Team Mood Tracker", "Low mood is a leading indicator of burnout and attrition.") +
        `## Daily Averages\n\n${table}\n\n## Questions\n\n1. What immediate 1:1 or retro topics should address this?\n2. What structural changes reduce mood drivers (meetings, interruptions, scope pressure)?\n3. How can the team monitor if interventions work?`,
    },
  ];
}
