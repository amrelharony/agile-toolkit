import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
// The map's own definitions (pure, server-safe): the prompt counts as the page does.
import {
  QUADRANTS,
  QUADRANT_LABEL,
  SENTIMENT_LABEL,
  quadrantOf,
  stakeholderVerdict,
  touchStatus,
  type Quadrant,
  type Stakeholder,
} from "@/app/(tools)/stakeholder-map/model";
import { sentimentText } from "@/app/(tools)/stakeholder-map/markdown";

/** "Manage Closely", or "Not placed" for someone nobody has placed yet. */
const quadrantText = (s: Stakeholder) => {
  const q = quadrantOf(s);
  return q ? QUADRANT_LABEL[q] : "Not placed";
};

/**
 * Prompts for the Stakeholder Map. Every stakeholder is in them, placed or
 * not: a position or a sentiment nobody has set reads "Not placed" / "not
 * set", never a default, and the quadrant counts, blockers and the verdict
 * are the page's (stakeholder-map/model).
 */
export function generateStakeholderMapPrompts(
  data: {
    stakeholders: readonly Stakeholder[];
    /** "YYYY-MM-DD": the page's today, for the touches due. */
    today: string;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  const { stakeholders, today } = data;
  if (stakeholders.length === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";

  const inQuadrant = (q: Quadrant) => stakeholders.filter((s) => quadrantOf(s) === q).length;
  const unplaced = stakeholders.filter((s) => quadrantOf(s) === null).length;
  const blockers = stakeholders.filter((s) => s.currentSentiment === "blocker");
  const champions = stakeholders.filter((s) => s.currentSentiment === "champion").length;
  const overdue = stakeholders.filter((s) => touchStatus(s, today) === "overdue").length;
  const counts = QUADRANTS.map((q) => `${QUADRANT_LABEL[q]}: ${inQuadrant(q)}`);

  const stakeholderTable = formatTable(
    [
      "Name",
      "Role",
      "Quadrant",
      "Interest",
      "Authority",
      "Sentiment now → needed",
      "Last contact",
      "Next touch",
      "Strategy",
      "Description",
    ],
    stakeholders
      .slice(0, 20)
      .map((s) => [
        s.name,
        s.role ?? "—",
        quadrantText(s),
        s.interest ?? "—",
        s.authority ?? "—",
        sentimentText(s),
        s.lastContactAt ?? "—",
        s.nextTouchAt ?? "—",
        (s.strategy ?? "—").slice(0, 60),
        (s.description ?? "—").slice(0, 60),
      ])
  );

  const blockerTable =
    blockers.length > 0
      ? formatTable(
          ["Name", "Role", "Quadrant", "Authority", "Needed", "Strategy"],
          blockers
            .slice(0, 15)
            .map((s) => [
              s.name,
              s.role ?? "—",
              quadrantText(s),
              s.authority ?? "—",
              s.desiredSentiment ? SENTIMENT_LABEL[s.desiredSentiment] : "not set",
              s.strategy ?? "—",
            ])
        )
      : "_No blockers logged._";

  const standing = [
    `- ${stakeholderVerdict(stakeholders, today)}`,
    `- Blockers: ${blockers.length}${champions > 0 ? ` (${champions} champion${champions === 1 ? "" : "s"})` : ""}`,
    `- Touches overdue: ${overdue}`,
  ].join("\n");
  const total = `${stakeholders.length} stakeholder${stakeholders.length === 1 ? "" : "s"}${unplaced > 0 ? ` (${unplaced} not placed on the map yet)` : ""}`;

  return [
    {
      id: "stakeholder-strategy",
      title: "Engagement strategy critique",
      description: "Critique each quadrant's engagement plan and surface mismatches.",
      prompt:
        buildPreamble("Stakeholder Map", `${total}. ${counts.join(", ")}.`) +
        `## Where things stand\n\n${standing}\n\n## Stakeholders\n\n${stakeholderTable}${wsContext}\n\n## Questions\n\n1. Which stakeholders are misclassified (e.g., a high-authority blocker only being "monitored")? Where would you place the ones not placed yet?\n2. Are the documented strategies generic or tailored to each person's interest/authority?\n3. Suggest a 2-week engagement plan for the "Manage Closely" quadrant.`,
    },
    {
      id: "stakeholder-blockers",
      title: "Blocker conversion plan",
      description: "Propose conversion paths to move blockers and skeptics toward supporters.",
      prompt:
        buildPreamble(
          "Stakeholder Map",
          `${blockers.length} blocker(s) currently logged. Conversion is high-leverage but slow.`
        ) +
        `## Blockers\n\n${blockerTable}\n\n## All stakeholders\n\n${stakeholderTable}${wsContext}\n\n## Questions\n\n1. For each blocker, infer the most likely root cause (lost autonomy, surprise, missed credit, …) and a counter-move.\n2. Which supporter is best positioned to peer-influence each blocker?\n3. What 1-page leadership communication would shift the highest-authority blocker?`,
    },
  ];
}
