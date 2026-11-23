import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData, wrapUserContent } from "./prompt-utils";
import type { AbTest } from "../stores/workspace-types";
import { DECISION_LABEL, STATUS_LABEL, countText, testSummary } from "../experiments/model";
import { HOW_TO_READ, analysisPText, percentText, pointsText, rateText } from "../experiments/ab";

/**
 * Copyable prompts over the A/B tests as the page reads them: each test's
 * plan (the current rate, the smallest change worth finding, the people
 * each version needs), its counts and rates, B against A with its interval
 * and p, whether the planned sample is in, and the decision. Names,
 * questions and notes are typed by people, so the table is wrapped as
 * untrusted content. The numbers are the page's own; the prompts ask for
 * reading and planning, never for new sums.
 */
export function generateAbCalculatorPrompts(tests: readonly AbTest[]): PromptDefinition[] {
  if (tests.length === 0) return [];
  const {
    data: shown,
    truncated,
    totalCount,
  } = truncateData(
    [...tests].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    20
  );
  const table = formatTable(
    [
      "Test",
      "Status",
      "Current rate",
      "Smallest change",
      "People a version",
      "A",
      "B",
      "B − A",
      "p",
      "Sample in",
      "Decision",
      "Question",
    ],
    shown.map((t) => {
      const s = testSummary(t);
      const r = s.result;
      const change =
        t.plan.mdeMode === "relative"
          ? `${pointsText(t.plan.mde)}%`
          : `${pointsText(t.plan.mde)} points`;
      return [
        t.name,
        STATUS_LABEL[t.status] ?? t.status,
        rateText(t.plan.baseline),
        change,
        s.plan ? countText(s.plan.perVariant) : "-",
        s.counts
          ? `${countText(s.counts.a.conversions)} of ${countText(s.counts.a.visitors)}`
          : "-",
        s.counts
          ? `${countText(s.counts.b.conversions)} of ${countText(s.counts.b.visitors)}`
          : "-",
        r
          ? `${pointsText(r.analysis.difference)} points (${percentText(r.analysis.level)} interval ${pointsText(r.analysis.differenceInterval[0])} to ${pointsText(r.analysis.differenceInterval[1])})`
          : "-",
        r ? analysisPText(r.analysis) : "-",
        r ? (r.early.met ? "yes" : "not yet") : "-",
        t.decision ? DECISION_LABEL[t.decision] : "-",
        t.question || "-",
      ];
    })
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} tests)\n` : "";
  const data = wrapUserContent(`${table}${note}`);
  const reading = HOW_TO_READ.join(" ");
  return [
    {
      id: "ab-calculator-read",
      title: "Read the results",
      description: "What each finished test shows, and what to decide.",
      prompt:
        buildPreamble(
          "A/B Calculator",
          "It lists conversion A/B tests with their plans, counts, the difference between B and A, its interval and p value, and whether the planned sample is in."
        ) +
        `## Tests\n\n${data}\n\n${reading}\n\n## Questions\n\n1. For each test whose sample is in, what does the result say, in plain words a stakeholder would follow? Don't read p as the chance that B is better.\n2. Which decisions (ship B, keep A, run it again) do the numbers support, and which tests are too early to call?\n3. What could make a result misleading here: an uneven split, a test stopped early, part of a week?`,
    },
    {
      id: "ab-calculator-next",
      title: "Plan the next test",
      description: "Ideas for the next experiment and what to watch.",
      prompt:
        buildPreamble("A/B Calculator", "Help the team plan its next conversion test.") +
        `## Tests so far\n\n${data}\n\n## Questions\n\n1. What should the next test try, given what these showed?\n2. Which guardrail metrics should it watch, and why?\n3. What is the smallest change worth finding, and is the traffic enough to find it in a few weeks?`,
    },
  ];
}
