import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { URGENT_WITHIN_DAYS, dueText } from "../prioritization/methods/eisenhower";
import type { RankedRow } from "../prioritization/rank";
import {
  UNSORTED,
  compareTasks,
  eisGroups,
  urgentReason,
  type TaskView,
} from "@/app/(tools)/eisenhower/model";
import { eisVerdict } from "@/app/(tools)/eisenhower/verdict";

/**
 * The matrix as the Eisenhower page reads it: its tasks, scored by the
 * registry (eisRows, a legacy hand-picked quadrant read first), and today,
 * which a due date's urgency is judged against.
 */
interface EisenhowerData {
  rows: readonly RankedRow[];
  today: string;
}

/** A pane lists this many tasks. */
const MAX_PER_PANE = 40;

/** What a task's line says after its title: why it's urgent, its due date, who takes it. */
function details(t: TaskView): string {
  const parts: string[] = [];
  const reason = urgentReason(t.urgency);
  if (reason) parts.push(reason.charAt(0).toLowerCase() + reason.slice(1));
  else if (t.urgency.because === "toggle") parts.push("marked urgent");
  if (t.urgency.daysToDue !== null && !reason) parts.push(dueText(t.urgency.daysToDue));
  if (t.delegateTo) parts.push(`handed to ${sanitizePromptCell(t.delegateTo, 80)}`);
  if (!t.quadrant) {
    const missing = t.ranked.result.missing;
    if (missing.includes("important")) parts.push("whether it's important isn't answered");
    if (missing.includes("urgent")) parts.push("whether it's urgent isn't answered");
  }
  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}

/**
 * The coaching prompt over the four panes as the page shows them today:
 * each task's pane derived from its two answers and its due date (due
 * within URGENT_WITHIN_DAYS days, or overdue, is urgent whatever the
 * toggle says), why it is urgent, who it is handed to, the tasks still
 * missing an answer under "Not sorted yet", and the page's verdict.
 */
export function generateEisenhowerPrompts(
  data: EisenhowerData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { rows, today } = data;
  if (rows.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const order = compareTasks(today);
  // Task titles are user-typed, and the verdict names them.
  const sections = eisGroups(rows, today)
    .filter((g) => g.id !== UNSORTED || g.tasks.length > 0)
    .map((g) => {
      const tasks = [...g.tasks].sort((a, b) => order(a.ranked, b.ranked));
      const lines = tasks
        .slice(0, MAX_PER_PANE)
        .map((t) => `- ${sanitizePromptCell(t.ranked.row.title, 120)}${details(t)}`);
      const more = tasks.length > MAX_PER_PANE ? `\n(and ${tasks.length - MAX_PER_PANE} more)` : "";
      return `### ${g.label} (${tasks.length}): ${g.meaning}\n${lines.join("\n") || "(none)"}${more}`;
    })
    .join("\n\n");
  const body = wrapUserContent(
    `Verdict: ${sanitizePromptCell(eisVerdict(rows, today), 400)}\n\n${sections}`
  );
  return [
    {
      id: "eisenhower-coaching",
      title: "Personal Productivity Coaching",
      description: "Coach the user toward more 'Schedule' time and less 'Do/Delete'.",
      prompt:
        buildPreamble(
          "Eisenhower Matrix",
          `It plots tasks on urgent vs important. A task is urgent when it is marked urgent or is due within ${URGENT_WITHIN_DAYS} days (overdue included); the pane follows from both answers. Today is ${today}.`
        ) +
        body +
        "\n" +
        context +
        `\n## Questions\n\n` +
        `1. Is the 'Do' quadrant overloaded — am I living in firefighting mode?\n` +
        `2. Which 'Schedule' items would have the biggest payoff if I made time this week, before their due dates make them urgent?\n` +
        `3. Who could I realistically delegate the 'Delegate' items to, where nobody has them yet?\n` +
        `4. Are 'Delete' items truly trivial, or am I avoiding hard work?\n` +
        `5. Recommend three habit changes to shift more time into Schedule next month.`,
    },
  ];
}
