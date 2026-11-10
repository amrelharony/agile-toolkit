import { SAY_DO_GRADE_LABEL } from "@/lib/sprints/metrics";
import { fmt } from "@/lib/charts/chart-text";
import type { SprintTrendSummary } from "@/lib/sprints/trends";
import {
  carryOverText,
  followThroughText,
  scopeText,
  sourcesText,
  type FollowThroughRead,
} from "./view";

/** "19 Oct 2026" */
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

/**
 * The cross-sprint trend as Markdown, for a retro page or a quarterly
 * review: the verdict, the window's averages (with the retros'
 * follow-through beside say/do, when given), then one row per finished
 * sprint with where its carry-over and scope numbers came from.
 */
export function toMarkdown(
  summary: SprintTrendSummary,
  {
    verdict,
    now = new Date(),
    followThrough,
  }: { verdict?: string | null; now?: Date; followThrough?: FollowThroughRead } = {}
): string {
  const title = `# Sprint trends — ${mdDate(now)}`;
  if (summary.rows.length === 0) {
    return `${title}\n\nNo finished sprints yet: a sprint counts once it is closed with its completed points.\n`;
  }
  const n = summary.rows.length;
  const lines = [title, ""];
  if (verdict) lines.push(verdict, "");
  lines.push(
    summary.window === null
      ? `All ${n} finished sprints, oldest first by end date.`
      : `The last ${n} of ${summary.finishedCount} finished sprints, oldest first by end date.`,
    ""
  );

  const { sayDo, carryOver, churn } = summary;
  lines.push(
    "## Averages",
    "",
    `- **Say/do:** ${sayDo.met} met (90–110%), ${sayDo.close} close, ${sayDo.missed} missed, ${sayDo.over} over${
      sayDo.meanPct !== null ? `; mean ${sayDo.meanPct}%` : ""
    }`,
    `- **Carry-over:** ${
      carryOver.meanPoints !== null
        ? `${fmt(carryOver.meanPoints)} points a sprint`
        : "not enough sprints say yet"
    }`,
    `- **Scope churn:** ${churn.meanPct !== null ? `${churn.meanPct}% of the commitment` : "not enough sprints record it yet"}`,
    ...(followThrough ? [`- **Retro follow-through:** ${followThroughText(followThrough)}`] : []),
    "",
    "## Sprints",
    "",
    "| Sprint | Committed | Completed | Say/do | Carried over | Scope +/− | Source |",
    "|---|---:|---:|---|---|---|---|",
    ...summary.rows.map(
      (r) =>
        `| ${cell(r.sprint.name) || "—"} | ${fmt(r.committed)} | ${
          r.completed === null ? "—" : fmt(r.completed)
        } | ${r.sayDo ? `${r.sayDo.pct}% (${SAY_DO_GRADE_LABEL[r.sayDo.grade]})` : "No commitment"} | ${cell(
          carryOverText(r)
        )} | ${cell(scopeText(r))} | ${cell(sourcesText(r))} |`
    )
  );
  return `${lines.join("\n")}\n`;
}
