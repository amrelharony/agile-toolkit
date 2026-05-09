import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface PostMortemLite {
  title: string;
  status: string;
  incidentDate: string;
  summary?: string;
  contributingFactors: string[];
  actionCount: number;
  openActionCount: number;
  description?: string;
}

export function generatePostMortemPrompts(data: {
  postmortems: PostMortemLite[];
  drafts: number;
  inReview: number;
  publishedThisQuarter: number;
  overdueActions: number;
}): PromptDefinition[] {
  if (data.postmortems.length === 0) return [];

  const pmTable = formatTable(
    [
      "Title",
      "Status",
      "Incident date",
      "Factors #",
      "Actions (open / total)",
      "Summary",
    ],
    data.postmortems.slice(0, 12).map((p) => [
      p.title,
      p.status,
      p.incidentDate,
      p.contributingFactors.length,
      `${p.openActionCount} / ${p.actionCount}`,
      (p.summary ?? p.description ?? "—").slice(0, 80),
    ])
  );

  return [
    {
      id: "blameless-framing",
      title: "Blameless framing review",
      description:
        "Audit summaries and contributing factors for blameful language, root-cause myopia, and missing systemic factors.",
      prompt:
        buildPreamble(
          "Blameless Post-Mortem",
          `${data.drafts} drafts, ${data.inReview} in review, ${data.publishedThisQuarter} published this quarter.`
        ) +
        `## Post-mortems\n\n${pmTable}\n\n## Questions\n\n1. Identify any blameful or person-centric language in the summaries — recommend rewrites.\n2. Are contributing factors limited to a single 'root cause', or do they capture multiple systemic factors?\n3. For any post-mortem with no action items, suggest two preventive actions.\n4. Recommend a one-sentence "blameless framing" reminder for the team's template header.`,
    },
    {
      id: "action-prioritization",
      title: "Action item prioritization",
      description:
        "Recommend how to sequence open action items across post-mortems to reduce the highest-impact recurrence risk.",
      prompt:
        buildPreamble(
          "Blameless Post-Mortem",
          `${data.overdueActions} overdue action items across post-mortems.`
        ) +
        `## Post-mortems\n\n${pmTable}\n\n## Questions\n\n1. Which post-mortems carry the most open actions and what does that signal about ownership or sequencing?\n2. Recommend a quarterly cap on open actions per team, with rationale.\n3. Identify any actions that look like 'add more monitoring' band-aids vs. structural fixes — flag them.\n4. Draft a one-paragraph policy for action-item review cadence.`,
    },
  ];
}
