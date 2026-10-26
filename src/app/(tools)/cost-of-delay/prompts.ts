import type { PromptDefinition } from "@/lib/ai-prompts/types";
import { buildPreamble, formatTable, wrapUserContent } from "@/lib/ai-prompts/prompt-utils";
import { buildWorkspaceContext } from "@/lib/ai-prompts/cross-tool-context";
import type { Workspace } from "@/lib/stores/workspace-types";
import { COST_OF_DELAY } from "@/lib/prioritization/methods";
import { formatNumber, toNumber } from "@/lib/prioritization/methods/fields";
import { COD_URGENCY_LABEL, type CodUrgency } from "@/lib/prioritization/methods/cost-of-delay";
import type { RankedRow } from "@/lib/prioritization/rank";
import { todayIso } from "@/lib/sprints/series";
import { fixedDateStart, laneOf, startText, waitingPerWeek } from "./lanes";

/**
 * The AI prompts over the queue as the page reads it: CD3, the urgency
 * lanes and the fixed-date starts. (lib/ai-prompts/cost-of-delay still
 * describes the old per week × weeks delayed total, so the tool builds its
 * own until that one moves to CD3.)
 */
export function generateCd3Prompts(
  rows: readonly RankedRow[],
  workspace?: Workspace | null
): PromptDefinition[] {
  if (rows.length === 0) return [];
  const today = todayIso();
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const lane = (r: RankedRow) => {
    const id = laneOf(r);
    return id === "unscored"
      ? "Not scored (no duration)"
      : id === "none"
        ? "No profile"
        : COD_URGENCY_LABEL[id as CodUrgency];
  };
  const table = formatTable(
    ["Initiative", "$ per week", "Weeks of work", "CD3", "Lane", "Fixed date"],
    rows.slice(0, 20).map((r) => {
      const start = fixedDateStart(r, today);
      const perWeek = toNumber(r.values.perWeekUsd);
      const weeks = toNumber(r.values.durationWeeks);
      return [
        r.row.title,
        perWeek === undefined ? "—" : `$${formatNumber(perWeek, 2)}`,
        weeks === undefined ? "—" : formatNumber(weeks, 2),
        r.result.score === null ? "—" : COST_OF_DELAY.format(r.result.score),
        lane(r),
        start ? startText(start, today) : "",
      ];
    })
  );
  const { perWeek, count } = waitingPerWeek(rows);
  return [
    {
      id: "cod-cd3-sequence",
      title: "Sequence by CD3",
      description: "Check the order of work by CD3 and urgency profile, and the fixed-date risks.",
      prompt:
        buildPreamble(
          "Cost of Delay (CD3)",
          "It scores each initiative as CD3 = cost of delay per week ÷ duration in weeks, ordered in lanes: expedite, fixed date by latest start, standard and intangible by CD3."
        ) +
        `Waiting costs $${formatNumber(perWeek, 2)} per week across ${count} scored initiatives.\n\n## Initiatives\n\n${wrapUserContent(table)}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Is the order sensible? Which item would you challenge, and why?\n` +
        `2. Which per-week costs look over-precise, and what range would you put on them?\n` +
        `3. Is any fixed date at risk given its latest start? What should start this week?\n` +
        `4. Are the expedite items truly expedite, or is the lane being used to jump the queue?\n` +
        `5. Could any long job be split so a smaller slice delivers most of the value sooner (a higher CD3)?`,
    },
  ];
}
