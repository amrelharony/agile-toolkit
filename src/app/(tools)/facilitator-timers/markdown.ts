import {
  TIMER_KINDS,
  TIMER_TITLE,
  clockTime,
  currentStep,
  lengthText,
  personHours,
  personHoursText,
  planText,
  type TimerRun,
} from "@/lib/facilitator-timers/model";
import type { AgendaDraftState, FacilitatorSettings } from "@/lib/facilitator-timers/store";

/** "12 Nov 2026" */
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

const minutes = (m: number) => (Number.isInteger(m) ? String(m) : m.toFixed(1));

/**
 * The session's timers as Markdown, for the workshop notes: each timer's
 * plan, the timer on (and a break's return time), what the meeting used in
 * person-hours, and the agenda being drafted. The cost ticker's rate and
 * money never go in: they stay in the browser tab.
 */
export function toMarkdown(
  {
    settings,
    run,
    remainingSeconds,
    cost,
    agenda,
  }: {
    settings: Pick<FacilitatorSettings, "pomodoro" | "crazy8s" | "breakMinutes">;
    /** The timer on, if any. */
    run: TimerRun | null;
    remainingSeconds: number;
    /** The cost ticker's people and time, once it has run (no money). */
    cost: { attendees: number; seconds: number } | null;
    agenda: AgendaDraftState;
  },
  now: Date = new Date()
): string {
  const lines = [`# Facilitator Timers — ${mdDate(now)}`, "", "## Timers", ""];
  for (const kind of TIMER_KINDS)
    lines.push(`- **${TIMER_TITLE[kind]}:** ${planText(kind, settings)}`);

  const step = run ? currentStep(run) : undefined;
  if (run && (step || run.finished)) {
    lines.push("", "## On now", "");
    if (run.finished) lines.push(`- ${run.title}: done, all ${run.steps.length} steps.`);
    else if (run.kind === "break" && run.backAt !== undefined) {
      lines.push(
        `- Break: back at ${clockTime(run.backAt)} (${lengthText(remainingSeconds)} left).`
      );
    } else if (step) {
      lines.push(
        `- ${run.title}: ${step.label}, ${lengthText(remainingSeconds)} left (step ${run.index + 1} of ${run.steps.length}).`
      );
    }
  }

  if (cost && cost.seconds > 0) {
    lines.push(
      "",
      "## Meeting time",
      "",
      `- ${cost.attendees} ${cost.attendees === 1 ? "person" : "people"} for ${lengthText(cost.seconds)}: ${personHoursText(personHours(cost.attendees, cost.seconds))}.`,
      "- The cost ticker's rate and amounts stay in the browser: they are not exported."
    );
  }

  if (agenda.segments.length > 0) {
    const total = agenda.segments.reduce((s, x) => s + x.minutes, 0);
    lines.push(
      "",
      `## Agenda draft${agenda.goal ? `: ${cell(agenda.goal)}` : ""}`,
      "",
      "| # | Segment | Minutes | What happens |",
      "|---:|---|---:|---|",
      ...agenda.segments.map(
        (s, i) => `| ${i + 1} | ${cell(s.label)} | ${minutes(s.minutes)} | ${cell(s.hint)} |`
      ),
      "",
      `**Total: ${minutes(total)} minutes${
        agenda.minutes && agenda.minutes !== total ? ` (planned ${agenda.minutes})` : ""
      }.**`
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
