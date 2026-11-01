import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { MIN_SAMPLE } from "../analytics/min-sample";
import {
  COST_CATEGORIES,
  FAILURE_SHARE_HIGH,
  costBreakdown,
  failureShareTrend,
  failureShareVerdict,
  type QualityCostPeriod,
} from "../quality/cost";
import {
  SHORT_LABEL,
  amountText,
  distributionText,
  failureShareChartText,
  money,
  sharePct,
  sideText,
} from "@/app/(tools)/quality-cost/view";

/**
 * The quarters as the Cost of Quality page shows them: every logged
 * quarter (its saved ones, or the example's while it is loaded) and the
 * one on screen.
 */
interface QualityCostData {
  periods: readonly QualityCostPeriod[];
  /** The quarter on screen; the latest when absent or gone. */
  shownId?: string;
}

/** The quarter table lists the latest this many. */
const MAX_QUARTERS = 12;

/** "up 8 points on 2026-Q2", from the rounded shares as the page shows them. */
function changeText(trend: ReturnType<typeof failureShareTrend>): string {
  const { latest, previous } = trend;
  if (!latest || !previous || latest.share === null || previous.share === null) return "";
  const points = Math.round(latest.share * 100) - Math.round(previous.share * 100);
  if (points === 0) return ` Level with ${previous.period}.`;
  const n = Math.abs(points);
  return ` ${points > 0 ? "Up" : "Down"} ${n} point${n === 1 ? "" : "s"} on ${previous.period}.`;
}

/** The Mann-Kendall reading over the quarters' shares, once there are MIN_SAMPLE.trend of them. */
function trendText(trend: ReturnType<typeof failureShareTrend>, scored: number): string {
  if (!trend.trend) {
    return ` A trend test needs ${MIN_SAMPLE.trend} quarters with a failure share (${scored} so far).`;
  }
  const { trend: way, significant, pValue } = trend.trend;
  if (way === "none" || !significant) {
    return ` Over ${scored} quarters there is no clear trend in the failure share (Mann-Kendall p = ${pValue.toFixed(2)}).`;
  }
  return ` Over ${scored} quarters the failure share is trending ${way} (Mann-Kendall p = ${pValue.toFixed(2)}).`;
}

/**
 * The cost-of-quality prompts with the page's numbers (lib/quality/cost):
 * each quarter's four costs as entered (a cost left out reads "Not
 * entered", never $0, and is left out of the shares), its total and
 * failure share (needing a figure on each side), the change on the quarter
 * before and the trend once there are enough quarters, and the verdict.
 */
export function generateQualityCostPrompts(
  data: QualityCostData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const periods = data.periods;
  if (periods.length === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";
  const trend = failureShareTrend(periods);
  const scored = trend.points.filter((p) => p.share !== null).length;
  const shown = periods.find((p) => p.id === data.shownId) ?? periods[periods.length - 1];
  const b = costBreakdown(shown.costs);

  const verdict =
    failureShareVerdict(trend) ??
    "No quarter has a failure share yet: it needs a prevention or detection cost and a failure cost.";
  const history = formatTable(
    ["Quarter", ...COST_CATEGORIES.map((c) => SHORT_LABEL[c]), "Total", "Failure share"],
    [...periods].slice(-MAX_QUARTERS).map((p) => {
      const pb = costBreakdown(p.costs);
      return [
        p.period,
        ...COST_CATEGORIES.map((c) => amountText(p.costs, c)),
        pb.entered === 0 ? "—" : money(pb.total),
        pb.failureShare === null ? "—" : sharePct(pb.failureShare),
      ];
    })
  );
  const more =
    periods.length > MAX_QUARTERS
      ? `\n(Showing the latest ${MAX_QUARTERS} of ${periods.length} quarters)`
      : "";
  const split = distributionText(shown.costs, shown.period);
  const distribution = formatTable(
    split.table.columns,
    split.table.rows.map((r) => r.map(String))
  );
  const sides = `Conformance (prevention + detection) ${sideText(shown.costs, "conformance")}; non-conformance (internal + external failure) ${sideText(shown.costs, "nonConformance")}; failure share ${b.failureShare === null ? "— (needs a cost on each side)" : sharePct(b.failureShare)}.`;
  const missing =
    b.missing.length > 0
      ? ` Not entered for ${shown.period}: ${b.missing.map((c) => SHORT_LABEL[c].toLowerCase()).join(", ")}.`
      : "";
  const note = shown.note?.trim()
    ? `\n\nNote on ${shown.period}: ${sanitizePromptCell(shown.note, 600)}`
    : "";
  const trendLine = `${failureShareChartText(trend).summary}${changeText(trend)}${trendText(trend, scored)}`;
  const context = `${verdict} Failure costs above ${Math.round(FAILURE_SHARE_HIGH * 100)}% of quality spend read as high.`;
  // The notes are user-typed.
  const quarters = wrapUserContent(
    `## Quarters\n\n${history}${more}\n\n${trendLine}\n\n## ${shown.period} in detail\n\n${distribution}\n\n${sides}${missing}${note}`
  );

  return [
    {
      id: "coq-interpretation",
      title: "COQ Framework Interpretation",
      description: "Interpret the conformance vs non-conformance ratio in plain language.",
      prompt:
        buildPreamble("Cost of Quality Calculator", context) +
        `${quarters}${wsContext}\n\n## Questions\n\n1. Is the conformance/non-conformance ratio healthy? (Mature orgs: ~70/30 or better.) Is the failure share moving the right way across the quarters?\n2. Where are the heaviest non-conformance costs? What does that imply about the engineering or QA process?\n3. Apply the rule of thumb "$1 in prevention saves ~$100 in failure" to the specific numbers — what's the ROI of a small reallocation?`,
    },
    {
      id: "coq-investment",
      title: "Investment Recommendation",
      description: "Recommend where to shift the next dollar of quality spend.",
      prompt:
        buildPreamble("Cost of Quality Calculator", context) +
        `${quarters}${wsContext}\n\n## Questions\n\n1. Where should the next $10K of quality budget go? Justify with the COQ ratio rule.\n2. Are there hidden costs likely missing from this picture (cycle delay, churn, brand damage), or categories not entered yet?\n3. Recommend 3 concrete prevention investments most likely to compound.`,
    },
  ];
}
