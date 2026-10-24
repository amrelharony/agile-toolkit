import type { DesignSprintOutput, DesignSprintPlan } from "@/lib/stores/workspace-types";
import type { DesignSprintToday } from "@/lib/design-sprint/day";
import { DESIGN_SPRINT_DAY_NAMES, DESIGN_SPRINT_DAY_PURPOSE } from "@/lib/design-sprint/plan";
import {
  dateRange,
  dayOutputs,
  dayTasks,
  planDays,
  shortDay,
  sprintQuestions,
  statusText,
} from "./doc";
import {
  ANSWER_LABEL,
  DAY_SLOTS,
  INTERVIEWS,
  SIGNAL_LABEL,
  isAnswer,
  isSignal,
  isWebLink,
  outputsIn,
} from "./outputs";
import { designSprintVerdict } from "./verdict";

/** One line of text: newlines collapsed. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return oneLine(v).replace(/\|/g, "\\|");
}

/** Where hand-offs land, as the export names them. */
const SENT_TO: Record<string, string> = {
  hypothesis: "Hypothesis Tracker",
  "backlog-story": "Backlog",
};

const sentTo = (o: DesignSprintOutput) =>
  (o.sentTo ?? []).map((l) => SENT_TO[l.route] ?? l.route).join(", ") || "—";

/** An output as a list item, its link (a web link only) after the text. */
function outputLine(o: DesignSprintOutput): string {
  const text = oneLine(o.text);
  const url = o.url && isWebLink(o.url) ? o.url : null;
  if (!url) return `- ${text}`;
  return url === text ? `- <${url}>` : `- ${text} — <${url}>`;
}

/**
 * The sprint as Markdown, for the team's wiki or the hand-over after Test
 * day: the dates and roles, then each day's tasks and outputs, the
 * findings with their signal, how many interviews they came up in and
 * where they were sent, and the answers to the sprint questions.
 */
export function toMarkdown(plan: DesignSprintPlan, t: DesignSprintToday): string {
  const roles = [
    plan.decider ? `Decider: ${oneLine(plan.decider)}` : null,
    plan.facilitator ? `Facilitator: ${oneLine(plan.facilitator)}` : null,
  ].filter(Boolean);
  const when = [dateRange(t.dates) || `Starts ${plan.startDate}`, statusText(plan, t)];
  const lines: string[] = [`# Design sprint: ${oneLine(plan.name)}`, "", when.join(" · ")];
  if (roles.length > 0) lines.push("", roles.join(" · "));
  if (plan.description?.trim()) lines.push("", plan.description.trim());
  lines.push("", `**${designSprintVerdict(plan, t)}**`);

  planDays(plan).forEach((day, i) => {
    const date = shortDay(t.dates[i]);
    lines.push(
      "",
      `## Day ${day.day} · ${DESIGN_SPRINT_DAY_NAMES[day.day]}${date ? ` — ${date}` : ""}`,
      "",
      DESIGN_SPRINT_DAY_PURPOSE[day.day]
    );

    const tasks = dayTasks(day);
    if (tasks.length > 0) {
      const done = tasks.filter((x) => x.done).length;
      lines.push("", `**Tasks** (${done} of ${tasks.length} done)`, "");
      for (const task of tasks) {
        const owner = task.owner?.trim() ? ` — ${oneLine(task.owner)}` : "";
        lines.push(`- [${task.done ? "x" : " "}] ${oneLine(task.text)}${owner}`);
      }
    }

    const outputs = dayOutputs(day);
    for (const slot of DAY_SLOTS[day.day]) {
      const items = outputsIn(day.day, slot, outputs);
      // A day's notes only when there are some; every other slot says what's missing.
      if (items.length === 0 && slot.kind === "note") continue;
      lines.push("", `**${slot.heading}**`, "");
      if (items.length === 0) {
        lines.push(`_${slot.emptyText}_`);
      } else if (slot.kind === "finding") {
        lines.push(
          "| Finding | Signal | Seen in | Sent to |",
          "|---|---|---:|---|",
          ...items.map(
            (o) =>
              `| ${md(o.text)} | ${isSignal(o.signal) ? SIGNAL_LABEL[o.signal] : "Not judged"} | ${
                typeof o.seenIn === "number" ? `${o.seenIn} of ${INTERVIEWS}` : "—"
              } | ${md(sentTo(o))} |`
          )
        );
      } else {
        lines.push(...items.map(outputLine));
      }
    }

    if (day.day === 5) {
      const questions = sprintQuestions(plan);
      if (questions.length > 0) {
        lines.push(
          "",
          "**Answers to the sprint questions**",
          "",
          "| Sprint question | Answer |",
          "|---|---|",
          ...questions.map(
            (q) =>
              `| ${md(q.text)} | ${isAnswer(q.answer) ? ANSWER_LABEL[q.answer] : "Not answered"} |`
          )
        );
      }
    }
  });

  return `${lines.join("\n")}\n`;
}
