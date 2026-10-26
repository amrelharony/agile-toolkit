import { exampleId } from "@/lib/utils/example-id";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { methodRow } from "@/lib/prioritization/binding";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { Values } from "@/lib/prioritization/methods";
import { FRAMEWORK } from "./model";

/** `today` moved by `n` days. */
function shift(today: string, n: number): string {
  const d = isoDayNumber(today);
  return d === null ? today : isoFromDayNumber(d + n);
}

type Task = [title: string, answers: Values, dueIn?: number];

/**
 * A team lead's week: an overdue outage fix and a board pack the date makes
 * urgent (Do), hiring and onboarding to plan (Schedule), two small asks to
 * hand off, one named and one not (Delegate), a chore to drop (Delete) and
 * one task still to answer (Not sorted yet). Dates are relative to today,
 * so the panes look the same whenever the example is loaded.
 */
const TASKS: Task[] = [
  ["Fix the login outage for EU customers", { urgent: "true", important: "true" }, -2],
  ["Send the quarterly board pack to finance", { urgent: "false", important: "true" }, 1],
  ["Plan Q1 hiring with the team leads", { urgent: "false", important: "true" }, 7],
  ["Write the onboarding guide for new developers", { urgent: "false", important: "true" }],
  [
    "Book the room for Friday's sprint review",
    { urgent: "true", important: "false", delegateTo: "Priya" },
    3,
  ],
  ["Answer the vendor's security questionnaire", { urgent: "true", important: "false" }],
  ["Reorganise the shared drive folders", { urgent: "false", important: "false" }],
  ["Review the travel policy update", { important: "false" }],
];

/** The example tasks (example- ids: Clear example removes exactly these). */
export function buildExample(
  today: string = todayLocalISO(),
  now: Date = new Date()
): PrioritizationItem[] {
  const at = now.toISOString();
  return TASKS.map(([title, answers, dueIn], i) =>
    methodRow({
      id: exampleId(`eis-${i + 1}`),
      framework: FRAMEWORK,
      title,
      values: dueIn === undefined ? answers : { ...answers, dueAt: shift(today, dueIn) },
      now: at,
      ctx: { today },
    })
  );
}
