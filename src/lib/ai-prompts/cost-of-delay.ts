import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";
import { COST_OF_DELAY } from "../prioritization/methods";
import { formatNumber, toNumber } from "../prioritization/methods/fields";
import type { RankedRow } from "../prioritization/rank";
import { todayIso } from "../sprints/series";
import {
  LANE_HEADING,
  LANE_ORDER,
  fixedDateStart,
  laneOf,
  startText,
  waitingPerWeek,
} from "@/app/(tools)/cost-of-delay/lanes";

/**
 * The queue as the Cost-of-Delay page reads it: the ranked rows
 * (rankMethodRows, read through to a linked backlog item), `today` for the
 * fixed-date starts, and the page's verdict.
 */
interface CostOfDelayData {
  rows: readonly RankedRow[];
  today?: string;
  verdict?: string;
}

/**
 * The AI prompt over the queue as the page shows it: CD3 = cost of delay
 * per week ÷ duration in weeks (the registry's score and rounding), the
 * urgency lanes in the page's order and words (its lane headings) and the
 * fixed-date starts. A legacy row (per week × weeks delayed, no duration)
 * reads "Not scored", never a CD3 or a summed total.
 */
export function generateCostOfDelayPrompts(
  data: CostOfDelayData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { rows } = data;
  if (rows.length === 0) return [];
  const today = data.today ?? todayIso();
  const context = workspace ? buildWorkspaceContext(workspace) : "";
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
        // The heading of the lane the page lists the row under.
        LANE_HEADING[laneOf(r)],
        start ? startText(start, today) : "",
      ];
    })
  );
  const note = rows.length > 20 ? `\n(Showing 20 of ${rows.length} initiatives)` : "";
  const { perWeek, count } = waitingPerWeek(rows);
  // The verdict names initiatives, so it goes inside the untrusted block.
  const verdict = data.verdict ? `Verdict: ${sanitizePromptCell(data.verdict, 400)}\n\n` : "";
  return [
    {
      id: "cod-cd3-sequence",
      title: "Sequence by CD3",
      description: "Check the order of work by CD3 and urgency profile, and the fixed-date risks.",
      prompt:
        buildPreamble(
          "Cost of Delay (CD3)",
          `It scores each initiative as CD3 = cost of delay per week ÷ duration in weeks, ordered in lanes, first to last, each heading saying what orders it: ${LANE_ORDER.map((id) => LANE_HEADING[id]).join("; ")}.`
        ) +
        `Waiting costs $${formatNumber(perWeek, 2)} per week across ${count} scored initiatives.\n\n## Initiatives\n\n${wrapUserContent(verdict + table + note)}\n` +
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
