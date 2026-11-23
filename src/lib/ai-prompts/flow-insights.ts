import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface FlowInsightsPromptData {
  /** "sprint" or "week". */
  unit: "sprint" | "week";
  periods: {
    label: string;
    finished: number;
    feature: number;
    defect: number;
    debt: number;
    risk: number;
    unsorted: number;
    failurePct: number | null;
  }[];
  /** The target mix, or null. */
  target: { feature: number; defect: number; debt: number; risk: number } | null;
  /** Counts only, never names. */
  stability: {
    name: string;
    people: number;
    joined: number;
    left: number;
    pct: number | null;
  }[];
  trend: string | null;
}

/**
 * Copyable prompts for Flow Insights: read the work mix against the
 * target, and plan the next sprint's balance. Numbers only: counts and
 * percentages, never who joined or left. Sprint names are typed by the
 * team, so each is sanitized and the block wrapped as data.
 */
export function generateFlowInsightsPrompts(data: FlowInsightsPromptData): PromptDefinition[] {
  if (data.periods.every((p) => p.finished === 0)) return [];
  const unit = data.unit === "sprint" ? "Sprint" : "Week";
  const mix = formatTable(
    [unit, "Finished", "Feature", "Defect", "Debt", "Risk", "Not sorted", "Repeat work"],
    data.periods.map((p) => [
      sanitizePromptCell(p.label, 60),
      p.finished,
      p.feature,
      p.defect,
      p.debt,
      p.risk,
      p.unsorted,
      p.failurePct === null ? "-" : `${p.failurePct}%`,
    ])
  );
  const target = data.target
    ? `Feature ${data.target.feature}%, defect ${data.target.defect}%, debt ${data.target.debt}%, risk ${data.target.risk}%`
    : "No target mix set";
  const stability = data.stability.length
    ? formatTable(
        ["Sprint", "People", "Joined", "Left", "Stability"],
        data.stability.map((s) => [
          sanitizePromptCell(s.name, 60),
          s.people,
          s.joined,
          s.left,
          s.pct === null ? "-" : `${s.pct}%`,
        ])
      )
    : "(no finished sprints)";
  const block = wrapUserContent(
    [
      "**Work mix:**",
      mix,
      "",
      `**Target mix:** ${target}`,
      data.trend ? `**Repeat work trend:** ${sanitizePromptCell(data.trend, 200)}` : "",
      "",
      "**Team stability:**",
      stability,
    ]
      .filter((line, i, all) => line !== "" || all[i - 1] !== "")
      .join("\n")
  );
  return [
    {
      id: "flow-mix",
      title: "Read our work mix",
      description: "What the mix of finished work says, and what to change first.",
      prompt:
        buildPreamble("Flow Insights", "Read a team's mix of finished work.") +
        `## Our numbers\n\n${block}\n\n## Questions\n\n1. Where does our mix differ most from the target, and what could cause that?\n2. Is repeat work (defects and reopened items) taking too much of our capacity? What would you look into first?\n3. Did a team change line up with a change in the mix?\n4. Suggest one small experiment for next sprint and how we'd know it worked.`,
    },
    {
      id: "flow-balance",
      title: "Balance the next sprint",
      description: "Plan a sprint that moves the mix towards the target.",
      prompt:
        buildPreamble("Flow Insights", "Plan the balance of a sprint.") +
        `## Our numbers\n\n${block}\n\n## Questions\n\n1. How many items of each kind should our next sprint hold to move towards the target, given what we usually finish?\n2. What should we say to the Product Owner about the debt and risk work?\n3. What would tell us mid-sprint that the balance is slipping?`,
    },
  ];
}
