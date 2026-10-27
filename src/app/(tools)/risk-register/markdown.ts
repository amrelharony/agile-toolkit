import type { Risk } from "@/lib/stores/workspace-types";
import {
  RISK_STATUSES,
  RISK_STATUS_LABEL,
  compareRisks,
  residualScore,
  riskDaysOverdue,
  riskLevel,
  riskScore,
  riskSummary,
  riskVerdict,
  toScale,
} from "@/lib/risks/model";
import { todayIso } from "@/lib/sprints/series";
import { countedRisks, exportedRisks } from "./analysis";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** What became of the impediment a risk was raised as, for its cell. */
export type ImpedimentState = "raised" | "resolved" | null;

export interface RiskMarkdownOptions {
  /** The page's sentence; computed from the risks when absent. */
  verdict?: string;
  /** Whether the risk was raised as an impediment that still exists, and if it is resolved. */
  impediment?: (r: Risk) => ImpedimentState;
}

/**
 * The register as Markdown, for a steering-group page or a release thread:
 * the verdict, the counts and the exposure before and after mitigation,
 * then every risk in the register's order (active first, then score, then
 * days overdue) with its owner, rating, the rating after mitigation, its
 * status, the plan and its due date (overdue days named), and whether it
 * was raised as an impediment. Scores and levels are lib/risks/model's.
 * While the team has risks of its own the example's are left out, as
 * every number leaves them out, and the counts line says how many.
 */
export function toMarkdown(
  risks: readonly Risk[],
  now: Date = new Date(),
  opts: RiskMarkdownOptions = {}
): string {
  const title = `# Risk Register — ${mdDate(now)}`;
  if (risks.length === 0) return `${title}\n\nNo risks logged yet.\n`;
  const today = todayIso(now);
  const counted = countedRisks(risks);
  const listed = exportedRisks(risks);
  const left = risks.length - listed.length;
  const verdict = opts.verdict ?? riskVerdict(counted, today);
  const s = riskSummary(counted, today);
  const ordered = listed.sort((a, b) => compareRisks(a, b, today));
  // The counts are the summary's, over the same rows as the verdict and the exposure.
  const counts = RISK_STATUSES.filter((st) => s.byStatus[st] > 0).map(
    (st) => `${s.byStatus[st]} ${st}`
  );
  const exposure =
    s.active > 0
      ? ` Exposure of the active risks: ${s.exposure} now, ${s.residualExposure} after mitigation (${s.residualAssessed} of ${s.active} assessed).`
      : "";
  const leftOut =
    left > 0 ? ` The example's ${left} ${left === 1 ? "risk is" : "risks are"} left out.` : "";

  const lines = [
    title,
    "",
    verdict,
    "",
    `${s.total} risk${s.total === 1 ? "" : "s"}: ${counts.join(", ")}.${exposure}${leftOut}`,
    "",
    "## Risks in order",
    "",
    "| # | Risk | Owner | P × I | Score | After mitigation | Status | Mitigation | Due | Impediment |",
    "|---:|---|---|---|---:|---|---|---|---|---|",
    ...ordered.map((r, i) => {
      const score = riskScore(r);
      const after = residualScore(r);
      const overdue = riskDaysOverdue(r, today);
      const due = r.mitigationDueAt
        ? `${r.mitigationDueAt}${overdue > 0 ? ` (${overdue} ${overdue === 1 ? "day" : "days"} overdue)` : ""}`
        : "";
      const imp = opts.impediment?.(r) ?? null;
      return `| ${i + 1} | ${cell(r.title) || "(untitled)"} | ${cell(r.owner)} | ${
        toScale(r.probability) ?? 1
      } × ${toScale(r.impact) ?? 1} | ${score} (${riskLevel(score)}) | ${
        after === null
          ? "Not assessed"
          : `${toScale(r.residualProbability)} × ${toScale(r.residualImpact)} = ${after}`
      } | ${RISK_STATUS_LABEL[r.status] ?? cell(r.status)} | ${cell(r.mitigation)} | ${due} | ${
        imp === "resolved" ? "Resolved" : imp === "raised" ? "Raised" : ""
      } |`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}
