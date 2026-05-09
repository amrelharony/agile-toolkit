import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData } from "./prompt-utils";

interface CFDData {
  columns: { id: string; name: string; description?: string }[];
  entries: { date: string; counts: Record<string, number>; description?: string }[];
  wipLimit: number | null;
}

export function generateCFDPrompts(data: CFDData): PromptDefinition[] {
  if (data.entries.length === 0) return [];

  const { data: shown, truncated, totalCount } = truncateData(data.entries);
  const table = formatTable(
    ["Date", ...data.columns.map((c) => c.name), "Note"],
    shown.map((e) => [e.date, ...data.columns.map((c) => e.counts[c.id] ?? 0), (e.description ?? "—").slice(0, 80)])
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} entries)\n` : "";

  const stageList = data.columns
    .map((c) => `${c.name}${c.description ? ` — ${c.description.slice(0, 80)}` : ""}`)
    .join(" → ");

  const wipNote = data.wipLimit ? `WIP Limit: ${data.wipLimit}` : "No WIP limit set";

  return [
    {
      id: "cfd-flow",
      title: "Flow Efficiency Analysis",
      description: "Identify bottlenecks, estimate cycle times, and assess process health.",
      prompt: buildPreamble("Cumulative Flow Diagram", "It visualizes how work items flow through process stages over time.") +
        `## Process Stages: ${stageList}\n${wipNote}\n\n## Data\n\n${table}${note}\n\n## Questions\n\n1. Are any bands widening over time? This indicates a bottleneck — which stage is the constraint?\n2. Estimate the approximate cycle time and lead time from this CFD.\n3. Is work flowing smoothly or are there signs of starvation or blocking in any stage?\n4. How does the done rate compare to the intake rate? Is the system in balance?\n5. What is the biggest process improvement opportunity visible in this data?`,
    },
    {
      id: "cfd-wip",
      title: "WIP Limit Recommendations",
      description: "Determine optimal work-in-progress limits for each column.",
      prompt: buildPreamble("Cumulative Flow Diagram", "Use the flow data to recommend WIP limits.") +
        `## Process Stages: ${stageList}\n${wipNote}\n\n## Data\n\n${table}${note}\n\n## Questions\n\n1. What WIP limit would you recommend for each process stage and why?\n2. How would implementing WIP limits affect the team's cycle time?\n3. Which stage has the most variable WIP? What causes this variability?\n4. How should the team handle WIP limit violations — what policies do you suggest?\n5. Design a simple "pull system" protocol based on this flow data.`,
    },
  ];
}
