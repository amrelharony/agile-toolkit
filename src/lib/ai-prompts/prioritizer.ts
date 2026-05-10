import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

interface PrioritizerData {
  items: {
    name: string;
    moscow: string;
    businessValue: number;
    timeCriticality: number;
    riskReduction: number;
    jobSize: number;
    reach: number;
    impact: number;
    confidence: number;
    effort: number;
    description?: string;
  }[];
}

function wsjf(i: PrioritizerData["items"][0]) {
  // Mirror the client (`Math.max(1, jobSize)`) so a zero or sub-1 jobSize doesn't
  // explode the score and matches the figure the user sees in the UI.
  const denom = Math.max(1, i.jobSize);
  return Math.round(((i.businessValue + i.timeCriticality + i.riskReduction) / denom) * 10) / 10;
}
function rice(i: PrioritizerData["items"][0]) {
  // `confidence` is stored as 0-100 here but the RICE formula expects 0-1.
  // Without the /100, RICE comes out 100× too high relative to the UI.
  // Effort is also clamped to ≥0.1 to mirror the client's protection against
  // div-by-zero on tiny estimates.
  return i.effort > 0
    ? Math.round(((i.reach * i.impact * (i.confidence / 100)) / Math.max(0.1, i.effort)) * 10) / 10
    : 0;
}

export function generatePrioritizerPrompts(data: PrioritizerData, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];

  const { data: shown, truncated, totalCount } = truncateData(data.items);

  const table = formatTable(
    ["Item", "MoSCoW", "WSJF", "RICE", "Effort", "Description"],
    shown.map((i) => [i.name, i.moscow.toUpperCase(), wsjf(i), rice(i), i.effort, (i.description ?? "—").slice(0, 80)])
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} items)\n` : "";

  const mustHaves = data.items.filter((i) => i.moscow === "must");
  const wontHaves = data.items.filter((i) => i.moscow === "wont");

  const context = workspace ? buildWorkspaceContext(workspace) : "";

  return [
    {
      id: "prioritizer-validate",
      title: "Prioritization Validation",
      description: "Challenge the ranking and identify potential biases or misalignments.",
      prompt: buildPreamble("Backlog Prioritizer", "It scores items using MoSCoW, WSJF, and RICE frameworks simultaneously.") +
        `## Backlog Items\n\n${table}${note}\n\nMust-haves: ${mustHaves.length} | Won't-haves: ${wontHaves.length} | Total items: ${data.items.length}${context}\n\n## Questions\n\n1. Are the MoSCoW categories well-distributed? Is anything mis-categorized based on the WSJF/RICE scores?\n2. Do the WSJF and RICE rankings agree? Where do they diverge and what does that mean?\n3. Are there any "hidden gems" — items with high value/impact but low priority placement?\n4. Challenge the Must-have list: should any items be downgraded? Are there too many Must-haves?\n5. What ordering would you recommend for the next sprint based on this data?`,
    },
    {
      id: "prioritizer-quickwins",
      title: "Quick Win Identification",
      description: "Find high-value, low-effort items that can deliver fast results.",
      prompt: buildPreamble("Backlog Prioritizer", "Identify quick wins from the scored backlog.") +
        `## Backlog Items\n\n${table}${note}${context}\n\n## Questions\n\n1. Which items have the highest value-to-effort ratio? List the top 5 quick wins.\n2. Are there items that could be split into smaller pieces to capture value sooner?\n3. How should the team balance quick wins with strategic Must-have items?\n4. Draft a stakeholder-friendly explanation of why you'd recommend this ordering.\n5. What items would you defer or drop entirely? Why?`,
    },
  ];
}
