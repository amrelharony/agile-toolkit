import type { Assumption, Hypothesis } from "@/lib/stores/workspace-types";
import { ratingOf } from "@/lib/assumptions/model";
import { linkedTest } from "@/lib/hypotheses/model";
import {
  assumptionsVerdict,
  canvasView,
  countedAssumptions,
  resultText,
  statusLabel,
} from "./view";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

/** Where its hypothesis stands, in words; "" when it was never sent. */
function testText(a: Assumption, hypotheses: readonly Pick<Hypothesis, "id" | "status">[]): string {
  const t = linkedTest(a.sentTo, hypotheses);
  if (t.state === "none") return "";
  return t.state === "testing" ? `testing (${t.status})` : `hypothesis ${t.result}`;
}

/**
 * The canvas as Markdown: the verdict, the ranking with its scores (the
 * order to test them in), the assumptions not rated yet, and the tested
 * ones with what settled them. The rows the page ranks (countedAssumptions):
 * example rows next to the team's own are left out, and say so.
 */
export function assumptionsToMarkdown(
  assumptions: readonly Assumption[],
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[]
): string {
  const lines = ["# Riskiest assumptions", ""];
  if (assumptions.length === 0) {
    lines.push("No assumptions yet.");
    return `${lines.join("\n")}\n`;
  }
  const counted = countedAssumptions(assumptions);
  const view = canvasView(counted.rows, hypotheses);
  lines.push(`> ${assumptionsVerdict(view)}${counted.example ? " (the example)" : ""}`, "");
  if (counted.aside.length > 0) {
    const n = counted.aside.length;
    lines.push(
      `_The example's ${n} ${n === 1 ? "assumption is" : "assumptions are"} left out._`,
      ""
    );
  }
  if (view.ranked.length > 0) {
    lines.push(
      "## Ranking (score = risk × (6 − evidence))",
      "",
      "| # | Assumption | Risk | Evidence | Score | Status | Test |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...view.ranked.map(
        (r) =>
          `| ${r.rank} | ${cell(r.assumption.statement)} | ${ratingOf(r.assumption.riskLevel)} | ${ratingOf(r.assumption.evidenceLevel)} | ${r.score} | ${statusLabel(r.assumption.status)} | ${cell(testText(r.assumption, hypotheses) || "—")} |`
      ),
      ""
    );
  }
  if (view.unrated.length > 0) {
    lines.push("## Not rated", "");
    for (const a of view.unrated) lines.push(`- ${oneLine(a.statement)}`);
    lines.push("");
  }
  if (view.tested.length > 0) {
    lines.push("## Tested", "");
    for (const a of view.tested) {
      lines.push(`- ${oneLine(a.statement)}: ${resultText(a, hypotheses).toLowerCase()}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
