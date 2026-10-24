import { SAY_DO_GRADE_LABEL } from "@/lib/sprints/metrics";
import { fmt } from "@/lib/sprints/hub-view";
import {
  finishedRows,
  perDayText,
  velocitySummary,
  type VelocityRow,
  type VelocitySummary,
} from "./view";

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The say/do column: "Met (97%)" for a finished sprint, else where it stands. */
function outcome(r: VelocityRow): string {
  if (r.finished && r.completed !== null) {
    if (!r.sayDo) return "No commitment";
    return `${SAY_DO_GRADE_LABEL[r.sayDo.grade]} (${r.sayDo.pct}%)`;
  }
  switch (r.status) {
    case "planned":
      return "Planned";
    case "active":
      return "In progress";
    case "cancelled":
      return "Cancelled";
    default:
      return "—";
  }
}

/**
 * Velocity as Markdown, for a sprint review page or a planning thread: the
 * shared velocity (the last 3 finished sprints by end date), the graded
 * say/do, the points per person-day, then every sprint. Like the tiles,
 * only finished sprints count: a planned or running sprint can't have met
 * or missed anything yet.
 */
export function toMarkdown(
  rows: readonly VelocityRow[],
  now: Date = new Date(),
  {
    summary,
    verdict,
  }: {
    summary?: Pick<VelocitySummary, "velocity" | "sayDo" | "perPersonDay">;
    verdict?: string;
  } = {}
): string {
  const title = `# Velocity — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo sprints yet.\n`;

  const finished = finishedRows(rows);
  const lines = [title, ""];
  if (verdict) lines.push(verdict, "");
  if (finished.length === 0) {
    lines.push("No finished sprints yet.");
  } else {
    const s =
      summary ??
      velocitySummary(
        finished.map((r) => ({
          id: r.id,
          name: r.name,
          startDate: "",
          endDate: "",
          pointsPlanned: r.committed,
          pointsCompleted: r.completed,
          status: "completed" as const,
        }))
      );
    const v = s.velocity;
    lines.push(
      `**Velocity:** ${fmt(v.average ?? 0)} points, the average of the last ${
        v.count === 1 ? "finished sprint" : plural(v.count, "finished sprint")
      } by end date`
    );
    const sd = s.sayDo;
    lines.push(
      "",
      sd.count === 0
        ? "**Say/do:** no finished sprint had a commitment."
        : `**Say/do:** ${sd.byGrade.met} of ${plural(sd.count, "sprint")} met the commitment (90–110%); ${sd.byGrade.close} close, ${sd.byGrade.missed} missed, ${sd.byGrade.over} over. Mean ${sd.meanSayDoPct}%.`
    );
    const pd = s.perPersonDay;
    lines.push(
      "",
      pd.average === null
        ? "**Per person-day:** no capacity plan for the last sprints."
        : `**Per person-day:** ${perDayText(pd.average)} points (${plural(pd.count, "sprint")} with a capacity plan)`
    );
  }

  lines.push(
    "",
    "## Sprints",
    "",
    "| Sprint | Committed | Completed | Say/do | Points per person-day | Goal |",
    "|---|---:|---:|---|---:|---|",
    ...rows.map(
      (r) =>
        `| ${cell(r.name) || "—"} | ${fmt(r.committed)} | ${
          r.completed === null ? "—" : fmt(r.completed)
        } | ${outcome(r)} | ${r.perDay === null ? "—" : perDayText(r.perDay)} | ${cell(
          r.description
        )} |`
    )
  );
  return `${lines.join("\n")}\n`;
}
