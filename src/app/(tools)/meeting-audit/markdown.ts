import type { MeetingAudit } from "@/lib/stores/workspace-types";
import {
  AUDIT_QUESTIONS,
  CADENCE_LABEL,
  VERDICT_LABEL,
  auditSummary,
  auditVerdict,
  byCost,
  hoursText,
  meetingScore,
  ratingOf,
  resetPlan,
  weeklyHours,
  weeklyText,
} from "@/lib/meeting-audit/model";

/** "12 Nov 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
const cell = (v: string | number) =>
  String(v)
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();

const row = (cells: (string | number)[]) => `| ${cells.map(cell).join(" | ")} |`;

/**
 * The audit as Markdown, for the team's retro or a proposal to the people
 * who own the calendar: the verdict sentence, every meeting the costliest
 * first (how often, how long, how many, the person-hours a week, the average
 * rating and the verdict), the ratings by question, and the ritual reset
 * plan the verdicts add up to.
 */
export function toMarkdown(audits: readonly MeetingAudit[], now: Date = new Date()): string {
  const title = `# Meeting audit — ${mdDate(now)}`;
  if (audits.length === 0) return `${title}\n\nNo meetings audited yet.\n`;
  const sorted = [...audits].sort(byCost);
  const lines = [title, "", auditVerdict(auditSummary(sorted)), ""];
  lines.push(
    row([
      "Meeting",
      "How often",
      "Minutes",
      "People",
      "Person-hours a week",
      "Average rating",
      "Verdict",
    ]),
    row(["---", "---", "---", "---", "---", "---", "---"]),
    ...sorted.map((a) => {
      const score = meetingScore(a);
      return row([
        a.meeting,
        CADENCE_LABEL[a.cadence],
        a.minutes,
        a.attendees,
        hoursText(weeklyHours(a)),
        score === null ? "—" : Math.round(score * 10) / 10,
        a.verdict ? VERDICT_LABEL[a.verdict] : "—",
      ]);
    }),
    ""
  );
  lines.push(
    "## Ratings (1 not at all, 5 always)",
    "",
    row(["Meeting", ...AUDIT_QUESTIONS.map((q) => q.label)]),
    row(["---", ...AUDIT_QUESTIONS.map(() => "---")]),
    ...sorted.map((a) => row([a.meeting, ...AUDIT_QUESTIONS.map((q) => ratingOf(a, q.id) ?? "—")])),
    ""
  );
  const plan = resetPlan(sorted);
  lines.push("## Ritual reset plan", "");
  lines.push(
    `Now: ${weeklyText(plan.hoursNow)}. After the drops: ${weeklyText(plan.hoursAfter)}.`,
    ""
  );
  const group = (heading: string, list: MeetingAudit[], detail: (a: MeetingAudit) => string) => {
    if (list.length === 0) return;
    lines.push(`### ${heading}`, "", ...list.map((a) => `- ${cell(a.meeting)}${detail(a)}`), "");
  };
  const notes = (a: MeetingAudit) => (a.notes?.trim() ? `: ${cell(a.notes)}` : "");
  group("Keep", plan.keep, notes);
  group("Change", plan.change, (a) => notes(a) || ": what to change isn't written yet");
  group("Drop", plan.drop, (a) => ` (frees ${weeklyText(weeklyHours(a))})${notes(a)}`);
  group("No verdict yet", plan.undecided, () => "");
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The CSV the export offers: one row per meeting, a column per question. */
export function toCsv(audits: readonly MeetingAudit[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: [
      "Meeting",
      "How often",
      "Minutes",
      "People",
      "Person-hours a week",
      ...AUDIT_QUESTIONS.map((q) => q.label),
      "Verdict",
      "What it's for",
      "What to change",
    ],
    rows: [...audits]
      .sort(byCost)
      .map((a) => [
        a.meeting,
        CADENCE_LABEL[a.cadence],
        a.minutes,
        a.attendees,
        Number(hoursText(weeklyHours(a))),
        ...AUDIT_QUESTIONS.map((q) => ratingOf(a, q.id) ?? ""),
        a.verdict ? VERDICT_LABEL[a.verdict] : "",
        a.purpose,
        a.notes ?? "",
      ]),
  };
}
