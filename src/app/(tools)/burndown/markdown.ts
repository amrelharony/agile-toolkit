import type { Sprint } from "@/lib/stores/workspace-types";
import type { BurnSeries, BurnStatus } from "@/lib/sprints/burn";
import { churnLine } from "@/lib/sprints/burn";
import { fmt } from "@/lib/sprints/hub-view";
import { dayDate, hasSyntheticDates } from "@/lib/sprints/series";

/** The burndown's shapes from before the burn model, kept for the AI prompts and the daily log. */
export interface DayEntry {
  id: string;
  day: number;
  remaining: number | null;
  scopeChange: boolean;
  description?: string;
}

export interface BurndownConfig {
  totalPoints: number;
  sprintDays: number;
  sprintStartDate: string;
}

/** "18 Oct 2026" */
export function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
export function mdCell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** "2026-10-12" as a local calendar date ("12 Oct 2026"), or the raw string if it isn't one. */
export function mdIsoDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? "").trim());
  return m ? mdDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : (iso ?? "");
}

const SOURCE_LINE: Record<BurnSeries["source"], string> = {
  stories: "From the sprint board",
  log: "Typed in the daily log",
  none: "Nothing recorded yet",
};

export function sourceLine(source: BurnSeries["source"]): string {
  return SOURCE_LINE[source];
}

const OFF = { weekend: "Weekend", holiday: "Holiday" } as const;

/** "Day 16 (3 Nov 2026)", for a projected calendar day (it may be past the end). */
export function dayAndDate(sprint: Pick<Sprint, "startDate" | "endDate">, day: number): string {
  const d = Math.ceil(day);
  const date = hasSyntheticDates(sprint) ? null : dayDate(sprint, d);
  return date ? `Day ${d} (${mdIsoDate(date)})` : `Day ${d}`;
}

/**
 * The burndown as Markdown, for a sprint review page or a Daily Scrum
 * thread: the verdict, where the sprint stands against the ideal line (on
 * working days), the scope that joined or left, then every day.
 */
export function burndownMarkdown(
  { sprint, burn, status }: { sprint: Sprint; burn: BurnSeries; status: BurnStatus },
  now: Date = new Date()
): string {
  const title = `# Burndown — ${mdDate(now)}`;
  const anything = burn.source !== "none" || burn.days.some((d) => d.note || d.scopeChangeFlag);
  if (!anything) {
    return `${title}\n\nNothing recorded yet: point the sprint's stories and move them on the board, or log the points left each day.\n`;
  }

  const lines = [
    title,
    "",
    `**Sprint:** ${mdCell(sprint.name)}: ${fmt(burn.committed)} points committed over ${
      burn.lengthDays
    } days (${burn.workingDays} working days), starting ${mdIsoDate(sprint.startDate)}`,
    `**Source:** ${sourceLine(burn.source)}`,
    "",
    status.verdict,
  ];

  if (burn.lastDay !== null && burn.remaining !== null && status.idealRemaining !== null) {
    const pct =
      status.completionPct === null ? "" : ` (${status.completionPct}% of the scope done)`;
    lines.push(
      "",
      `**Day ${burn.lastDay}:** ${fmt(burn.remaining)} points left, ideal ${fmt(
        status.idealRemaining
      )}: ${(status.gapLabel ?? "").toLowerCase()}${pct}`
    );
    lines.push(
      `**Projected finish:** ${
        status.cantTell
          ? "Can't tell yet (open stories have no points)"
          : status.projectedFinishDay === null
            ? "No trend yet"
            : `${dayAndDate(sprint, status.projectedFinishDay)}${
                status.willFinishOnTime === false ? ", after the last day" : ""
              }`
      }`
    );
  }
  const churn = churnLine(burn);
  lines.push(
    `**Scope:** ${churn.charAt(0).toUpperCase()}${churn.slice(1)} (${fmt(burn.initialScope)} → ${fmt(
      burn.scopeNow
    )})`
  );

  const moves = burn.days.filter((d) => d.added > 0 || d.removed > 0 || d.scopeChangeFlag);
  if (moves.length > 0) {
    lines.push(
      "",
      "## Scope changes",
      "",
      ...moves.map((d) => {
        const what = [
          d.added > 0 ? `+${fmt(d.added)}` : "",
          d.removed > 0 ? `−${fmt(d.removed)}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `- Day ${d.day}${what ? `: ${what} points` : ""}${d.note ? ` (${mdCell(d.note)})` : ""}`;
      })
    );
  }

  lines.push(
    "",
    "## Daily progress",
    "",
    "| Day | Date | Day off | Ideal | Remaining | Added | Removed | Note |",
    "|---:|---|---|---:|---:|---:|---:|---|",
    ...burn.days.map(
      (d) =>
        `| ${d.day} | ${d.date ? mdIsoDate(d.date) : ""} | ${d.off ? OFF[d.off] : ""} | ${fmt(
          d.ideal
        )} | ${d.remaining === null ? "—" : fmt(d.remaining)} | ${d.added ? fmt(d.added) : ""} | ${
          d.removed ? fmt(d.removed) : ""
        } | ${mdCell(d.note)} |`
    )
  );
  return `${lines.join("\n")}\n`;
}
