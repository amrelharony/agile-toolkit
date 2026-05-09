import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface PrSampleData {
  prNumber?: string;
  author: string;
  cycleHours: number | null;
  reviewerCount: number;
  commentCount: number;
  linesChanged: number;
  description?: string;
}

export function generateCodeReviewPrompts(data: {
  samples: PrSampleData[];
  avgCycleHours: number | null;
  avgReviewDepth: number;
  avgPrSize: number;
  unmerged: number;
}): PromptDefinition[] {
  if (data.samples.length === 0) return [];

  const table = formatTable(
    [
      "PR",
      "Author",
      "Cycle (h)",
      "Reviewers",
      "Comments",
      "Lines",
      "Description",
    ],
    data.samples
      .slice(-30)
      .map((s) => [
        s.prNumber ?? "—",
        s.author,
        s.cycleHours !== null ? s.cycleHours.toFixed(1) : "—",
        s.reviewerCount,
        s.commentCount,
        s.linesChanged,
        (s.description ?? "—").slice(0, 60),
      ])
  );

  const cycleLine =
    data.avgCycleHours !== null
      ? `Avg cycle: ${data.avgCycleHours.toFixed(1)}h.`
      : "No merged PRs — cycle time unavailable.";

  return [
    {
      id: "code-review-bottlenecks",
      title: "Review Bottleneck Analysis",
      description:
        "Surface where reviews are getting stuck — by author, reviewer load, PR size, or specific PRs.",
      prompt:
        buildPreamble(
          "Code Review Metrics",
          `${data.samples.length} PR sample(s); ${cycleLine} Avg review depth ${data.avgReviewDepth.toFixed(1)} comments/PR; avg PR size ${data.avgPrSize.toFixed(0)} lines; ${data.unmerged} unmerged.`
        ) +
        `## PRs (last ${Math.min(30, data.samples.length)})\n\n${table}\n\n## Questions\n\n1. Which PRs are outliers in cycle time relative to their size? What's the pattern?\n2. Is review depth (comments) correlated with PR size or with a few specific authors/reviewers?\n3. Recommend 3 process changes to compress cycle time without sacrificing review quality.`,
    },
    {
      id: "code-review-pr-size",
      title: "PR-Size Guidance",
      description:
        "Use PR size and cycle time to recommend an upper-bound size policy.",
      prompt:
        buildPreamble(
          "Code Review Metrics",
          `Avg PR size ${data.avgPrSize.toFixed(0)} lines; avg cycle ${data.avgCycleHours?.toFixed(1) ?? "—"}h.`
        ) +
        `## PRs\n\n${table}\n\n## Questions\n\n1. At what line count does cycle time noticeably degrade in this dataset?\n2. Recommend a soft and hard PR-size limit, with rationale.\n3. What anti-patterns produce huge PRs and how would you discourage them?`,
    },
  ];
}
