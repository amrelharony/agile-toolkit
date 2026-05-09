import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface IssueData {
  component: string;
  wcagCriterion: string;
  severity: string;
  status: string;
  ageDays: number;
  description?: string;
}

export function generateA11yPrompts(data: {
  issues: IssueData[];
  totalOpen: number;
  bySeverity: Record<string, number>;
  componentsAffected: number;
  avgAge: number;
}): PromptDefinition[] {
  if (data.issues.length === 0) return [];

  const table = formatTable(
    ["Component", "WCAG", "Severity", "Status", "Age (d)", "Description"],
    data.issues
      .slice(0, 25)
      .map((i) => [
        i.component,
        i.wcagCriterion,
        i.severity,
        i.status,
        i.ageDays,
        (i.description ?? "—").slice(0, 80),
      ])
  );

  return [
    {
      id: "a11y-priority",
      title: "Highest-Impact Remediation Order",
      description:
        "Sequence the open accessibility backlog by user impact, severity, and oldest age.",
      prompt:
        buildPreamble(
          "Accessibility Audit Tracker",
          `${data.totalOpen} open issue(s) across ${data.componentsAffected} component(s). Avg age ${data.avgAge.toFixed(1)}d.`
        ) +
        `## Issues\n\n${table}\n\n## Questions\n\n1. Rank the top 8 issues to fix first using a severity × usage-impact heuristic; explain assumptions.\n2. Which issues block keyboard-only or screen-reader users today (functional barriers)?\n3. Suggest 2 quick wins (small components, low effort) that demonstrate visible progress.`,
    },
    {
      id: "a11y-coverage",
      title: "Coverage Gap Analysis",
      description:
        "Identify components likely under-audited and recommend a sweep plan.",
      prompt:
        buildPreamble(
          "Accessibility Audit Tracker",
          `${data.componentsAffected} component(s) with at least one logged issue.`
        ) +
        `## Issues\n\n${table}\n\n## Questions\n\n1. Are issues clustered in a few components or spread evenly? What does that suggest about audit coverage?\n2. Which 3 user-facing surfaces likely have hidden a11y debt (mention typical patterns: forms, modals, charts, dataviz, drag-drop)?\n3. Recommend a 2-sprint plan to close the most-likely-missed gaps.`,
    },
  ];
}
