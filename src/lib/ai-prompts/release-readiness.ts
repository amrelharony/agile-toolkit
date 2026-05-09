import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface ReleaseLite {
  name: string;
  status: string;
  plannedDate: string;
  shippedDate?: string;
  gatesPassed: number;
  gatesTotal: number;
  description?: string;
}

export function generateReleaseReadinessPrompts(data: {
  releases: ReleaseLite[];
  pctOnTime: number | null;
  avgGatesOpen: number | null;
  gateFailureCounts: Record<string, number>;
}): PromptDefinition[] {
  if (data.releases.length === 0) return [];

  const releaseTable = formatTable(
    [
      "Release",
      "Status",
      "Planned",
      "Shipped",
      "Gates passed",
      "Description",
    ],
    data.releases.slice(0, 12).map((r) => [
      r.name,
      r.status,
      r.plannedDate,
      r.shippedDate ?? "—",
      `${r.gatesPassed} / ${r.gatesTotal}`,
      (r.description ?? "—").slice(0, 60),
    ])
  );

  const failTable = formatTable(
    ["Gate", "Times skipped"],
    Object.entries(data.gateFailureCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([g, n]) => [g, n])
  );

  const onTimeText =
    data.pctOnTime === null
      ? "No releases shipped yet."
      : `${data.pctOnTime.toFixed(0)}% of releases shipped on or before their planned date.`;

  const gatesOpenText =
    data.avgGatesOpen === null
      ? ""
      : `Avg ${data.avgGatesOpen.toFixed(1)} gates open at ship time.`;

  return [
    {
      id: "gate-compliance",
      title: "Gate compliance review",
      description:
        "Surface the pre-release gates that are most often skipped and recommend remediation.",
      prompt:
        buildPreamble(
          "Release Readiness",
          `${onTimeText} ${gatesOpenText}`.trim()
        ) +
        `## Releases\n\n${releaseTable}\n\n## Most-skipped gates\n\n${failTable}\n\n## Questions\n\n1. Which gates are most often skipped and why is that likely happening?\n2. Recommend gating policy changes — which gates should be hard blocks vs. soft warnings?\n3. Identify two or three gates the team could automate to reduce the cost of compliance.\n4. Draft a one-paragraph "ship policy" addressing the gaps above.`,
    },
    {
      id: "pre-release-rituals",
      title: "Pre-release rituals",
      description:
        "Recommend pre-release ritual changes to improve readiness and reduce rollback risk.",
      prompt:
        buildPreamble(
          "Release Readiness",
          "Rituals (go/no-go meetings, dry-runs, rollback rehearsals) decide whether gates are real or theater."
        ) +
        `## Releases\n\n${releaseTable}\n\n## Questions\n\n1. Looking at recent releases, are gates being checked early or only at ship time?\n2. Recommend a 30-minute pre-release ritual for the team.\n3. How should the team handle gate exceptions — who approves, what's logged?\n4. Suggest two leading indicators (vs. ship-time gates) the team could track.`,
    },
  ];
}
