import { NO_VALUE } from "@/lib/charts/chart-text";
import {
  COST_CATEGORIES,
  COST_CATEGORY_LABEL,
  costBreakdown,
  failureShareTrend,
  failureShareVerdict,
  legacyCosts,
  type QualityCostState,
} from "@/lib/quality/cost";
import { amountText, money, sharePct } from "./view";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * The Cost of Quality history as Markdown: the verdict, one row per
 * quarter (a category not entered reads "Not entered", never $0), and the
 * figures from before quarters while they haven't been saved as one.
 */
export function qualityCostMarkdown(state: QualityCostState): string {
  const periods = state.periods ?? [];
  const lines = ["# Cost of Quality", ""];
  const verdict = failureShareVerdict(failureShareTrend(periods));
  if (verdict) lines.push(`> ${verdict}`, "");
  if (state.hourlyRate !== undefined) {
    lines.push(`Hourly rate for hours × rate: ${money(state.hourlyRate)}`, "");
  }

  if (periods.length === 0) {
    lines.push("No quarters logged yet.", "");
  } else {
    const head = [
      "Quarter",
      ...COST_CATEGORIES.map((c) => COST_CATEGORY_LABEL[c]),
      "Total",
      "Failure share",
      "Note",
    ];
    lines.push(`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`);
    for (const p of periods) {
      const b = costBreakdown(p.costs);
      const cells = [
        p.period,
        ...COST_CATEGORIES.map((c) => {
          const amount = amountText(p.costs, c);
          const hours = p.hours?.[c];
          return hours === undefined ? amount : `${amount} (${hours} h)`;
        }),
        money(b.total),
        b.failureShare === null ? NO_VALUE : sharePct(b.failureShare),
        p.note ?? "",
      ];
      lines.push(`| ${cells.map(md).join(" | ")} |`);
    }
    lines.push("");
  }

  const legacy = legacyCosts(state);
  if (legacy) {
    lines.push("## Figures not yet saved as a quarter", "");
    for (const c of COST_CATEGORIES)
      lines.push(`- ${COST_CATEGORY_LABEL[c]}: ${amountText(legacy, c)}`);
    if (state.description?.trim()) lines.push(`- Note: ${md(state.description)}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
