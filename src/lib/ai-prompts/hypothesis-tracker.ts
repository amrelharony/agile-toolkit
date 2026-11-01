import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Hypothesis } from "../stores/workspace-types";
import { MIN_SAMPLE, enoughData } from "../analytics/min-sample";
import { formatMetric, missingFields, suggestVerdict } from "../hypotheses/model";
import { missingText, statusLabel, targetText } from "@/app/(tools)/hypothesis-tracker/view";

/**
 * The tests as the Hypothesis Tracker page counts them: the rows its
 * validation rate reads (the team's own, or the example's while it holds
 * nothing else), the rate itself, the median time to a result and the
 * page's verdict.
 */
interface HypothesisData {
  items: readonly Hypothesis[];
  /** validated ÷ decisive (lib/hypotheses validationRate), 0..1; null with no decisive result ("—", never 0%). */
  validationRate: number | null;
  /** Median days from raised to result, or null below the sample or while fewer than half have one. */
  medianTimeToValidate: number | null;
  /**
   * Tests with a result so far (timeToLearn's resolved): the median's
   * sample. With MIN_SAMPLE.distribution of them and still no median,
   * fewer than half have given a result, which the prompt says, as the
   * page's chart does.
   */
  results: number;
  verdict?: string;
}

/** The table lists this many hypotheses. */
const MAX_ROWS = 20;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "validated (target met)", from the numbers; "—" without a target and a measured result. */
function suggestedText(h: Hypothesis): string {
  const s = suggestVerdict(h);
  return s ? `${s.verdict} (target ${s.met ? "met" : "missed"})` : "—";
}

/**
 * The hypothesis prompts with the page's numbers (lib/hypotheses): the
 * validation rate, which leaves inconclusive results out and reads "—"
 * with no decisive result, the median time to learn, and per hypothesis
 * its numeric target, the measured result, the verdict those numbers
 * suggest (binary: target met → validated, missed → invalidated; the team
 * applies it), what a hand-off draft still needs and the team's context
 * (the page's "Context" line, the stored description).
 */
export function generateHypothesisTrackerPrompts(data: HypothesisData): PromptDefinition[] {
  const { items } = data;
  if (items.length === 0) return [];
  const rate =
    data.validationRate === null
      ? "Validation rate: — (no decisive result yet)."
      : `Validation rate: ${Math.round(data.validationRate * 100)}% of decisive results held up (inconclusive ones aren't counted).`;
  // The page's readings (view.ts timeToLearn): below the sample, fewer than half with a result, the median.
  const learn = !enoughData(data.results, "distribution")
    ? `Median time to a result: — (shows once ${MIN_SAMPLE.distribution} tests have a result; ${data.results} so far).`
    : data.medianTimeToValidate === null
      ? `Median time to a result: — (over ${plural(data.results, "result")}, fewer than half of the tests have given a result yet).`
      : `Median time to a result: ${plural(data.medianTimeToValidate, "day")} (over ${plural(data.results, "result")}; open tests count as still waiting).`;
  const table = formatTable(
    [
      "We believe",
      "We'll do",
      "Success looks like",
      "Target",
      "Measured",
      "Suggested verdict",
      "Status",
      "What we learned",
      "Context",
    ],
    items.slice(0, MAX_ROWS).map((h) => {
      const missing = missingFields(h);
      return [
        (h.believe ?? "").slice(0, 60) || "—",
        (h.willDo ?? "").slice(0, 60) || "—",
        (h.successMetric ?? "").slice(0, 60) || "—",
        h.target ? targetText(h.target) : "No numeric target",
        typeof h.actual === "number" ? formatMetric(h.actual, h.target?.unit) : "—",
        suggestedText(h),
        `${statusLabel(h.status)}${missing.length > 0 ? ` (needs ${missingText(missing)})` : ""}`,
        (h.outcome ?? "").slice(0, 60) || "—",
        (h.description ?? "").slice(0, 80) || "—",
      ];
    })
  );
  const more =
    items.length > MAX_ROWS ? `\n(Showing ${MAX_ROWS} of ${items.length} hypotheses)` : "";
  const verdict = data.verdict ? `Verdict: ${sanitizePromptCell(data.verdict, 400)}\n\n` : "";
  // Every line of a hypothesis is user-typed.
  const body = wrapUserContent(`${verdict}${table}${more}`);
  const context = `${rate} ${learn} A suggested verdict comes from the measured result against the target; the team decides whether to apply it.`;

  return [
    {
      id: "hyp-quality",
      title: "Hypothesis Quality Review",
      description: "Coach on whether hypotheses are testable and well-framed.",
      prompt:
        buildPreamble("Hypothesis Tracker", context) +
        `## Hypotheses\n\n${body}\n\n## Questions\n\n1. Which hypotheses are actually testable vs. just opinions?\n2. Are success metrics and targets measurable and falsifiable? Which need a numeric target or a baseline?\n3. Where the status differs from the suggested verdict, what should the team check before deciding?\n4. Sharpen the 3 weakest hypotheses.`,
    },
    {
      id: "hyp-portfolio",
      title: "Discovery Portfolio Balance",
      description: "Evaluate risk diversification across the discovery portfolio.",
      prompt:
        buildPreamble(
          "Hypothesis Tracker",
          `${context} A healthy discovery portfolio mixes low-risk incremental bets with larger directional bets.`
        ) +
        `## Hypotheses\n\n${body}\n\n## Questions\n\n1. Are hypotheses too similar? Too diverse?\n2. What's the ratio of cheap tests to expensive ones?\n3. Recommend 2-3 new hypotheses to round out the portfolio.`,
    },
  ];
}
