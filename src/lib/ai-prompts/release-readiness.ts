import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { ReleaseStats } from "@/lib/releases/model";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";

interface ReleaseLite {
  name: string;
  status: string;
  plannedDate: string;
  shippedDate?: string;
  rolledBackAt?: string;
  gatesPassed: number;
  gatesTotal: number;
  /** The open gates by label (the team's own names). */
  openGates: string[];
  description?: string;
}

/**
 * Prompts for Release Readiness. The numbers come from lib/releases (the
 * page's and the agent's one definition): every ship, rolled-back ones and
 * a reopened release's earlier ships included, and the gates by the
 * team's labels rather than a fixed list.
 */
export function generateReleaseReadinessPrompts(data: {
  releases: ReleaseLite[];
  stats: ReleaseStats;
  skipped: { label: string; skipped: number; of: number }[];
}): PromptDefinition[] {
  if (data.releases.length === 0) return [];
  const { stats } = data;

  const releaseTable = formatTable(
    ["Release", "Status", "Planned", "Shipped", "Rolled back", "Gates passed", "Open gates"],
    data.releases
      .slice(0, 12)
      .map((r) => [
        r.name,
        r.status,
        r.plannedDate,
        r.shippedDate ?? "—",
        r.rolledBackAt ?? "—",
        `${r.gatesPassed} / ${r.gatesTotal}`,
        r.openGates.length > 0 ? r.openGates.join(", ").slice(0, 80) : "—",
      ])
  );

  const failTable = formatTable(
    ["Gate", "Open at ship", "Of ships"],
    data.skipped.filter((g) => g.skipped > 0).map((g) => [g.label, g.skipped, g.of])
  );

  const onTimeText =
    stats.shipped === 0
      ? "Nothing has shipped yet."
      : stats.shipped < MIN_SAMPLE.average || stats.pct === null
        ? `${stats.shipped} ship(s) so far: too few to quote an on-time rate.`
        : `${stats.pct.toFixed(0)}% of ${stats.shipped} ships went out on or before their planned date; ${stats.rolledBack} of them rolled back.`;

  const gatesOpenText =
    stats.avgGatesOpen === null || stats.shipped < MIN_SAMPLE.average
      ? ""
      : `Avg ${stats.avgGatesOpen.toFixed(1)} gates open at ship time.`;

  return [
    {
      id: "gate-compliance",
      title: "Gate compliance review",
      description:
        "Surface the pre-release gates that are most often skipped and recommend remediation.",
      prompt:
        buildPreamble("Release Readiness", `${onTimeText} ${gatesOpenText}`.trim()) +
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
