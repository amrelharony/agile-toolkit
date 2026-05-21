import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface Entry {
  kind: "nps" | "csat";
  date: string;
  score: number;
  verbatim?: string;
}

export function generateNpsCsatPrompts(data: {
  entries: Entry[];
  nps: number;
  csat: number;
}): PromptDefinition[] {
  if (data.entries.length === 0) return [];
  // NPS/CSAT verbatims are written by external customers — the highest
  // injection-risk surface in the toolkit. Sanitize each cell (collapses
  // newlines, strips backticks, strips delimiter literals) and clamp at
  // 400 chars so a single rant can't dominate the prompt budget.
  const verbatims = data.entries
    .filter((e) => e.verbatim)
    .map((e) => `- (${e.kind}, ${e.score}) "${sanitizePromptCell(e.verbatim!, 400)}"`);
  const { data: sampled } = truncateData(verbatims, 20);
  const wrappedVerbatims = wrapUserContent(sampled.join("\n"));
  const trendTable = formatTable(
    ["Date", "Kind", "Score"],
    data.entries
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-20)
      .map((e) => [e.date, e.kind, e.score])
  );

  return [
    {
      id: "nps-themes",
      title: "Verbatim Theme Analysis",
      description: "Cluster customer verbatims into themes and prioritize what to address.",
      prompt:
        buildPreamble(
          "NPS/CSAT Tracker",
          `Current NPS: ${data.nps}. CSAT avg: ${data.csat.toFixed(1)}. ${data.entries.length} responses.`
        ) +
        `## Verbatim Comments\n\n${wrappedVerbatims}\n\n## Questions\n\n1. What 3-5 themes emerge from the verbatims?\n2. Which themes drive detractors vs. promoters?\n3. Prioritize what to address first for the biggest NPS lift.`,
    },
    {
      id: "nps-trend",
      title: "Score Trend Diagnosis",
      description: "Explain what's driving score movement over time.",
      prompt:
        buildPreamble(
          "NPS/CSAT Tracker",
          "Trend shifts often correlate with product launches, outages, or policy changes."
        ) +
        `## Recent Scores\n\n${trendTable}\n\n## Questions\n\n1. Is the trend rising, falling, or stable?\n2. What could have caused any notable shifts?\n3. What would you investigate next?`,
    },
  ];
}
