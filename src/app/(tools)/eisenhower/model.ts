/**
 * The Eisenhower matrix on the page: which pane each task sits in today,
 * why it's urgent, its due and delegate chips, and what the exports say.
 * Every quadrant comes from the method registry
 * (lib/prioritization/methods/eisenhower), the code the agent actions use,
 * so the page and an agent put a task in the same pane on the same day.
 * Pure.
 *
 * The quadrant is derived from the two answers and the due date, never
 * stored: a legacy row holding only a hand-picked `quadrant` reads as the
 * matching answers, and a task missing an answer waits under "Not sorted
 * yet", never in Do.
 */

import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { toDay, toText } from "@/lib/prioritization/methods/fields";
import {
  EISENHOWER_LABEL,
  EISENHOWER_MEANING,
  EISENHOWER_QUADRANTS,
  dueText,
  eisenhowerQuadrant,
  urgency,
  type EisenhowerQuadrant,
  type Urgency,
} from "@/lib/prioritization/methods/eisenhower";
import { rankMethodRows, type RankedRow } from "@/lib/prioritization/rank";
import type { Values } from "@/lib/prioritization/methods";

export const FRAMEWORK = "eisenhower" as const;

/** The list for tasks missing an answer (legacy junk, a raw CRUD write). */
export const UNSORTED = "unsorted" as const;
export const UNSORTED_LABEL = "Not sorted yet";

export type EisGroupId = EisenhowerQuadrant | typeof UNSORTED;

/** A name short enough for a sentence or a toast. */
export function shortName(name: string, max = 40): string {
  const t = name.trim() || "Untitled task";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The tasks, scored by the registry for `today` (YYYY-MM-DD). */
export function eisRows(rows: readonly PrioritizationItem[], today: string): RankedRow[] {
  return rankMethodRows(FRAMEWORK, rows, [], { today });
}

/** What a task shows: its pane, why it's urgent, its due date and who takes it. */
export interface TaskView {
  ranked: RankedRow;
  quadrant: EisenhowerQuadrant | null;
  urgency: Urgency;
  dueAt: string | null;
  delegateTo: string | null;
}

export function taskView(r: RankedRow, today: string): TaskView {
  return {
    ranked: r,
    quadrant: eisenhowerQuadrant(r.values, today),
    urgency: urgency(r.values, today),
    dueAt: toDay(r.values.dueAt) ?? null,
    delegateTo: toText(r.values.delegateTo, 80) ?? null,
  };
}

/**
 * Within a pane: due soonest first (overdue at the top), undated after,
 * then by title. The panes themselves come from the derived quadrant.
 */
export function compareTasks(today: string) {
  return (a: RankedRow, b: RankedRow): number => {
    const da = urgency(a.values, today).daysToDue;
    const db = urgency(b.values, today).daysToDue;
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }
    return a.row.title.localeCompare(b.row.title);
  };
}

export interface EisGroup {
  id: EisGroupId;
  label: string;
  meaning: string;
  tasks: TaskView[];
}

/**
 * The four panes in Do, Schedule, Delegate, Delete order, then "Not
 * sorted yet". Tasks keep the order they are given in (the order on
 * screen while someone edits), so a pane never re-sorts itself.
 */
export function eisGroups(rows: readonly RankedRow[], today: string): EisGroup[] {
  const groups: EisGroup[] = [
    ...EISENHOWER_QUADRANTS.map((q) => ({
      id: q,
      label: EISENHOWER_LABEL[q],
      meaning: EISENHOWER_MEANING[q],
      tasks: [] as TaskView[],
    })),
    {
      id: UNSORTED,
      label: UNSORTED_LABEL,
      meaning: "Answer whether each is urgent and important to sort it.",
      tasks: [],
    },
  ];
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const r of rows) {
    const t = taskView(r, today);
    byId.get(t.quadrant ?? UNSORTED)?.tasks.push(t);
  }
  return groups;
}

/** "Urgent because it's due tomorrow": only when the date made it urgent. */
export function urgentReason(u: Urgency): string | null {
  if (u.because !== "due" || u.daysToDue === null) return null;
  return `Urgent because it's ${dueText(u.daysToDue)}`;
}

/**
 * The form's live line: where the answers put the task today, and why
 * when the due date made it urgent ("Urgent because it's due tomorrow, so
 * it goes to Do."). Says what's missing until both are answered.
 */
export function previewText(v: Values, today: string): string {
  const q = eisenhowerQuadrant(v, today);
  if (!q) {
    if (v.important === undefined && v.urgent === undefined) {
      return "Answer both questions to see where it goes.";
    }
    return v.important === undefined
      ? "Say whether it's important to see where it goes."
      : "Say whether it's urgent to see where it goes.";
  }
  const reason = urgentReason(urgency(v, today));
  return reason
    ? `${reason}, so it goes to ${EISENHOWER_LABEL[q]}.`
    : `Goes to ${EISENHOWER_LABEL[q]}.`;
}

/** A yes/no answer for display ("Yes", "No", or "" when not answered). */
export function answerText(v: number | string | undefined): string {
  return v === "true" ? "Yes" : v === "false" ? "No" : "";
}

/** The CSV export: the quadrant derived today, never a stored one. */
export function toCsv(
  rows: readonly RankedRow[],
  today: string
): { headers: string[]; rows: (string | number)[][] } {
  return {
    headers: ["Quadrant", "Task", "Urgent", "Important", "Due", "Delegate to", "Urgent because"],
    rows: rows.map((r) => {
      const t = taskView(r, today);
      return [
        t.quadrant ? EISENHOWER_LABEL[t.quadrant] : UNSORTED_LABEL,
        r.row.title,
        answerText(r.values.urgent),
        answerText(r.values.important),
        t.dueAt ?? "",
        t.delegateTo ?? "",
        urgentReason(t.urgency) ?? (t.urgency.because === "toggle" ? "Marked urgent" : ""),
      ];
    }),
  };
}

/** The tasks as the AI prompt reads them: grouped by pane label, with their derived panes. */
export function promptGroups(
  rows: readonly RankedRow[],
  today: string
): Record<string, PrioritizationItem[]> {
  const out: Record<string, PrioritizationItem[]> = {};
  for (const g of eisGroups(rows, today)) {
    if (g.id === UNSORTED && g.tasks.length === 0) continue;
    out[g.label] = g.tasks.map((t) => t.ranked.row);
  }
  return out;
}
