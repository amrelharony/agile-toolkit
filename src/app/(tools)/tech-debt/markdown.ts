import type { TechDebtItem } from "@/lib/stores/workspace-types";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import { todayIso } from "@/lib/sprints/series";
import {
  debtScale,
  debtSummary,
  debtVerdict,
  isInterestEstimated,
  isOpenDebt,
  rankedDebt,
} from "@/lib/tech-debt/model";
import { fmt } from "@/lib/charts/chart-text";
import { countedDebt, exportedDebt } from "./analysis";

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

/** What became of the backlog story an item was sent to, for its cell. */
export type BacklogState = "sent" | "done" | null;

export interface DebtMarkdownOptions {
  /**
   * The team's sprint length (the cadence's). Absent while the team hasn't
   * set one: the ages then use the default (14 days), and the export says
   * it is the default.
   */
  sprintLengthDays?: number;
  /** The page's sentence; computed from the items when absent. */
  verdict?: string;
  /** Whether the item's backlog story still exists, and if it is done. */
  backlog?: (t: TechDebtItem) => BacklogState;
}

/**
 * The debt as Markdown, for a planning thread or an architecture review:
 * the verdict and what the open debt costs a sprint, then every item in
 * the page's order (open first, then score, then age) with its area,
 * ratings, interest, age in sprints of the team's cadence, score (the cap
 * named), whether it is on the backlog, and its status. Ages and scores
 * are lib/tech-debt/model's. While the team has items of its own the
 * example's are left out, as every number leaves them out, and the
 * counts line says how many.
 */
export function toMarkdown(
  items: readonly TechDebtItem[],
  now: Date = new Date(),
  opts: DebtMarkdownOptions = {}
): string {
  const title = `# Tech Debt — ${mdDate(now)}`;
  if (items.length === 0) return `${title}\n\nNo tech debt logged yet.\n`;
  const today = todayIso(now);
  const len = opts.sprintLengthDays ?? DEFAULT_CADENCE.sprintLengthDays;
  const counted = countedDebt(items);
  const listed = exportedDebt(items);
  const left = items.length - listed.length;
  const verdict = opts.verdict ?? debtVerdict(counted, len, today, { includeExamples: true });
  // The counts are the summary's, over the same items as the verdict and the interest.
  const s = debtSummary(counted, len, today, undefined, { includeExamples: true });
  const total = s.open + s.resolved;
  const cost =
    s.open === 0
      ? ""
      : s.unestimated === s.open
        ? // Never "about 0 points": nothing is estimated, as the page's "—" says.
          " None of the open debt has an interest estimate."
        : ` Interest on the open debt: about ${fmt(s.interestPerSprint)} ${
            s.interestPerSprint === 1 ? "point" : "points"
          } a sprint${s.unestimated > 0 ? ` (${s.unestimated} not estimated)` : ""}.`;
  const leftOut =
    left > 0 ? ` The example's ${left} ${left === 1 ? "item is" : "items are"} left out.` : "";
  const basis =
    opts.sprintLengthDays === undefined
      ? `${len}-day sprints (the default: the team hasn't set a sprint length)`
      : `${len}-day sprints`;

  const lines = [
    title,
    "",
    verdict,
    "",
    `${total} ${total === 1 ? "item" : "items"}: ${s.open} open, ${s.resolved} paid down.${cost} Ages are in ${basis}.${leftOut}`,
    "",
    "## Items in order",
    "",
    "| # | Item | Area | Impact | Effort | Interest/sprint | Age (sprints) | Score | Backlog | Status |",
    "|---:|---|---|---:|---:|---:|---:|---:|---|---|",
    ...rankedDebt(listed, len, today).map(({ item: t, ageSprints, score }, i) => {
      const backlog = opts.backlog?.(t) ?? null;
      return `| ${i + 1} | ${cell(t.title) || "(untitled)"} | ${cell(t.area)} | ${debtScale(
        t.impact
      )} | ${debtScale(t.effort)} | ${
        isInterestEstimated(t) ? fmt(t.interestRate as number) : "Not estimated"
      } | ${ageSprints ?? ""} | ${fmt(score.total)}${score.capped ? " (capped)" : ""} | ${
        backlog === "done" ? "Story done" : backlog === "sent" ? "On the backlog" : ""
      } | ${isOpenDebt(t) ? "Open" : `Paid down ${(t.resolvedAt ?? "").slice(0, 10)}`} |`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}
