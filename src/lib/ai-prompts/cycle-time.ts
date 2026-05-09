import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData } from "./prompt-utils";

interface CycleTimeData {
  items: { name: string; startDate: string; endDate: string; cycleTimeDays: number; description?: string }[];
  stats: { mean: number; median: number; p85: number; p95: number; stdDev: number };
}

export function generateCycleTimePrompts(data: CycleTimeData): PromptDefinition[] {
  if (data.items.length === 0) return [];

  const { data: shown, truncated, totalCount } = truncateData(data.items);
  const table = formatTable(
    ["Item", "Start", "End", "Cycle Time (days)", "Description"],
    shown.map((i) => [i.name, i.startDate, i.endDate, i.cycleTimeDays, (i.description ?? "—").slice(0, 80)])
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} items)\n` : "";

  const statsBlock = [
    `Mean: ${data.stats.mean} days`,
    `Median: ${data.stats.median} days`,
    `85th Percentile: ${data.stats.p85} days`,
    `95th Percentile: ${data.stats.p95} days`,
    `Std Deviation: ${data.stats.stdDev} days`,
  ].join("\n");

  return [
    {
      id: "cycletime-analysis",
      title: "Cycle Time Distribution Analysis",
      description: "Evaluate predictability, identify outliers, and set service level expectations.",
      prompt: buildPreamble("Cycle Time Tracker", "It measures how long work items take from start to done.") +
        `## Statistics\n\n${statsBlock}\n\n## Work Items\n\n${table}${note}\n\n## Questions\n\n1. How predictable is this team's delivery? What does the spread between median and P85 tell us?\n2. Are there outlier items? What patterns explain the longest cycle times?\n3. What Service Level Expectation (SLE) would you recommend? (e.g., "85% of items done within X days")\n4. How does the standard deviation compare to the mean — is the process stable or chaotic?\n5. What specific process changes would reduce cycle time variability?`,
    },
    {
      id: "cycletime-forecast",
      title: "Probabilistic Forecasting",
      description: "Use cycle time percentiles to forecast delivery dates for upcoming work.",
      prompt: buildPreamble("Cycle Time Tracker", "Help the team forecast delivery using historical cycle time data.") +
        `## Statistics\n\n${statsBlock}\n\n## Work Items\n\n${table}${note}\n\n## Questions\n\n1. If a new item starts today, when can we promise delivery with 85% confidence?\n2. How should we communicate delivery timelines to stakeholders using this data?\n3. How many items can the team expect to complete in the next 2 weeks based on throughput?\n4. What is the Monte Carlo probability of completing 5 items within 10 days?\n5. How should this data inform sprint planning and backlog prioritization?`,
    },
  ];
}
