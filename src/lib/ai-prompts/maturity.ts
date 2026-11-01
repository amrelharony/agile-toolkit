import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { MaturityAssessment, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { MATURITY_DIMENSIONS } from "../constants/maturity-model";
// The assessment's own rules (pure, server-safe): the prompt reads what the page shows.
import {
  latestAssessment,
  levelOf,
  maturityVerdict,
  roadmapFor,
  scoredCount,
  summarizeEntry,
  targetOf,
} from "../maturity/assessment";

interface MaturityData {
  /** The assessment document as the page reads it (normalizeMaturity). */
  doc: MaturityAssessment;
}

/**
 * Prompts for the Agile Maturity Assessment, from lib/maturity/assessment.
 * The scores are the latest saved assessment's; a team that never saved one
 * is "Not assessed yet" and the prompt reads the draft's scores as a draft,
 * never as a 0% or a level 1. Overall maturity runs 0-100% from every
 * dimension at level 1 to every one at 5 (maturityPct). A dimension nobody
 * scored is Not scored. Nothing is scored: no prompts.
 */
export function generateMaturityPrompts(
  data: MaturityData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { doc } = data;
  const latest = latestAssessment(doc);
  const scores = latest?.scores ?? doc.scores;
  if (scoredCount(scores) === 0) return [];

  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const target = targetOf(doc);
  const dimensions = MATURITY_DIMENSIONS.map((d) => ({
    name: d.name,
    level: levelOf(scores[d.id]),
  }));

  const table = formatTable(
    ["Dimension", "Current (1-5)", "Target", "Gap"],
    dimensions.map((d) => [
      d.name,
      d.level ?? "Not scored",
      target,
      d.level === null ? "—" : Math.max(0, target - d.level),
    ])
  );

  const summary = latest ? summarizeEntry(latest) : null;
  const overall = summary
    ? `Overall Score: ${summary.percentage}% (Level ${summary.level} · ${summary.label}, assessed on ${summary.assessedAt})`
    : `Overall Score: Not assessed yet. These are the draft's scores (${scoredCount(scores)} of ${MATURITY_DIMENSIONS.length} dimensions scored), not a saved assessment`;
  const results =
    `${maturityVerdict(doc)}\n\n${overall}\n` +
    `Scale: 0% = every dimension at level 1, 100% = every dimension at level 5\n` +
    `Target Level: ${target}`;

  // The page's roadmap: one level at a time, weakest first. A draft has
  // none yet, so its gaps are read off the scored dimensions the same way.
  const steps = latest
    ? roadmapFor(latest, target).map((s) => ({ name: s.name, gap: s.target - s.current }))
    : dimensions
        .flatMap((d) =>
          d.level !== null && d.level < target ? [{ name: d.name, gap: target - d.level }] : []
        )
        .sort((a, b) => b.gap - a.gap);
  const biggestGaps =
    steps.length > 0
      ? `Biggest gaps: ${steps
          .slice(0, 3)
          .map((s) => `${s.name} (gap: ${s.gap})`)
          .join(", ")}`
      : `Every scored dimension is at or above the target level.`;

  return [
    {
      id: "maturity-gap",
      title: "Maturity Gap Analysis",
      description: "Identify the biggest gaps and create a prioritized improvement sequence.",
      prompt:
        buildPreamble(
          "Agile Maturity Assessment",
          "It rates the team across multiple agile dimensions on a 1-5 scale against target levels."
        ) +
        `## Assessment Results\n\n${results}\n\n${table}\n\n${biggestGaps}${context}\n\n## Questions\n\n1. In what order should the team address these gaps? What's the optimal improvement sequence?\n2. For each dimension with a gap > 1, what specific practices would bridge the gap?\n3. Are there dependencies between dimensions (e.g., must improve X before Y)?\n4. What quick wins could move the overall maturity score in the next 4 weeks?\n5. Is the target level realistic for this team? Should any targets be adjusted?`,
    },
    {
      id: "maturity-roadmap",
      title: "Quarterly Improvement Roadmap",
      description: "Design a quarter-by-quarter plan to reach the target maturity level.",
      prompt:
        buildPreamble("Agile Maturity Assessment", "Create a phased improvement roadmap.") +
        `## Assessment Results\n\n${results}\n\n${table}${context}\n\n## Questions\n\n1. Design a 3-quarter roadmap to reach the target maturity level for the top 3 gap dimensions.\n2. For each quarter, specify: focus area, practices to adopt, success metrics, and expected maturity gain.\n3. What training or coaching investments would accelerate improvement?\n4. How should progress be measured — what milestones indicate real maturity gain vs. superficial compliance?\n5. What organizational support does the team need to succeed? Draft a brief request for leadership.`,
    },
  ];
}
