import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Risk } from "../stores/workspace-types";
import { MIN_SAMPLE } from "../analytics/min-sample";
import {
  RISK_LEVEL_LABEL,
  RISK_STATUS_LABEL,
  compareRisks,
  residualAboveCurrent,
  residualScore,
  riskDaysOverdue,
  riskLevel,
  riskScore,
  riskSummary,
  riskVerdict,
  toScale,
} from "../risks/model";

/**
 * The register as the Risk Register page counts it: the rows its numbers
 * read (the team's own, or the example's while it holds nothing else),
 * the day overdue is judged on, and the median time to mitigate.
 */
interface RiskData {
  risks: readonly Risk[];
  /** "YYYY-MM-DD". */
  today: string;
  medianTTM: number | null;
  /**
   * Risks closed so far (timeToClose's closed): the median's sample. With
   * MIN_SAMPLE.average of them and still no median, fewer than half have
   * closed, which the prompt says, as the page's card does.
   */
  closed: number;
}

/** The table lists this many risks, in the register's order. */
const MAX_ROWS = 20;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "6 (Medium)", from the 1–5 ratings as the register scores them. */
const scoreText = (score: number) => `${score} (${RISK_LEVEL_LABEL[riskLevel(score)]})`;

/** The rating after mitigation, "4 (Low)", flagged when it is above the current one; "Not assessed" without both. */
function residualText(r: Risk): string {
  const after = residualScore(r);
  if (after === null) return "Not assessed";
  return `${scoreText(after)}${residualAboveCurrent(r) ? ", above the current rating" : ""}`;
}

function dueText(r: Risk, today: string): string {
  const due = (r.mitigationDueAt ?? "").slice(0, 10);
  if (!due) return "—";
  const late = riskDaysOverdue(r, today);
  return late > 0 ? `${due} (${plural(late, "day")} overdue)` : due;
}

/**
 * The risk prompts with the page's numbers (lib/risks/model): each risk's
 * score (probability × impact on the 1–5 scale) and level (16 and up
 * critical, 10 high, 5 medium, else low), its owner, days its mitigation
 * is overdue and its rating after mitigation; the register's counts and
 * exposure, and its verdict. Rows are in the register's order: active
 * first, then the highest score, then the most days overdue.
 */
export function generateRiskRegisterPrompts(data: RiskData): PromptDefinition[] {
  const { risks, today } = data;
  if (risks.length === 0) return [];
  const s = riskSummary(risks, today);
  const sorted = [...risks].sort((a, b) => compareRisks(a, b, today));
  const table = formatTable(
    [
      "Risk",
      "Owner",
      "Probability",
      "Impact",
      "Score",
      "Status",
      "Mitigation due",
      "After mitigation",
      "Mitigation plan",
    ],
    sorted
      .slice(0, MAX_ROWS)
      .map((r) => [
        r.title || "(untitled)",
        r.owner?.trim() || "No owner",
        toScale(r.probability) ?? 1,
        toScale(r.impact) ?? 1,
        scoreText(riskScore(r)),
        RISK_STATUS_LABEL[r.status] ?? r.status,
        dueText(r, today),
        residualText(r),
        (r.mitigation ?? "").slice(0, 80) || "None yet",
      ])
  );
  const more = risks.length > MAX_ROWS ? `\n(Showing ${MAX_ROWS} of ${risks.length} risks)` : "";
  const verdict = `Verdict: ${sanitizePromptCell(riskVerdict(risks, today), 400)}\n\n`;
  // Titles, owners and plans are user-typed, and the verdict names a title.
  const body = wrapUserContent(`${verdict}${table}${more}`);
  // The page card's three readings: below the sample, fewer than half closed, the median.
  const ttm =
    data.closed < MIN_SAMPLE.average
      ? `Median time to mitigate: — (shows once ${MIN_SAMPLE.average} are closed; ${data.closed} so far).`
      : data.medianTTM === null
        ? `Median time to mitigate: — (fewer than half have closed yet, over ${data.closed} closed).`
        : `Median time to mitigate: ${plural(data.medianTTM, "day")} (over ${data.closed} closed).`;
  const counts = `${plural(s.active, "active risk")} (open or mitigating), ${s.high} high or critical, ${plural(s.overdue, "mitigation")} overdue, ${s.unowned} with no owner. Exposure (sum of active scores) ${s.exposure} now, ${s.residualExposure} after mitigation (${s.residualAssessed} of ${s.active} rated for after). ${ttm}`;
  const scale =
    "Each risk is rated 1–5 for probability and impact; the score is their product, and its level is critical from 16, high from 10, medium from 5, else low.";

  return [
    {
      id: "risk-prioritize",
      title: "Risk Prioritization",
      description: "Rank risks and identify the critical few.",
      prompt:
        buildPreamble("Risk Register", `${scale} ${counts}`) +
        `## Risks, in the register's order\n\n${body}\n\n## Questions\n\n1. Which 3-5 risks demand immediate attention, given their level, owner and overdue mitigations?\n2. Which risks have weak mitigation plans, or a rating after mitigation that barely improves on today's?\n3. Are any risks better accepted than mitigated?`,
    },
    {
      id: "risk-mitigation",
      title: "Mitigation Plan Review",
      description: "Coach on the quality of mitigation plans.",
      prompt:
        buildPreamble(
          "Risk Register",
          `${scale} ${counts} Effective mitigations are specific, owned, and time-bound.`
        ) +
        `## Risks\n\n${body}\n\n## Questions\n\n1. Which mitigations are vague, unowned or past due?\n2. For the top 3 risks, draft sharper mitigation plans.\n3. What additional risks might we be missing in this domain?`,
    },
  ];
}
