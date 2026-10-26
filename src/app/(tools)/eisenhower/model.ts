/**
 * The Eisenhower matrix on the page: which pane each task sits in today,
 * why it's urgent, its due and delegate chips, and what the exports say.
 * Every quadrant comes from the method registry
 * (lib/prioritization/methods/eisenhower), the code the agent actions use,
 * so the page and an agent put a task in the same pane on the same day.
 * Pure.
 *
 * The quadrant is derived from the two answers and the due date, never
 * stored: a legacy row holding a hand-picked `quadrant` reads as the
 * matching answers (legacyQuadrantFirst), and a task missing an answer
 * waits under "Not sorted yet", never in Do.
 */

import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { toChoice, toDay, toText } from "@/lib/prioritization/methods/fields";
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

/**
 * A row as the old app showed it. Before Phase 7 the pane WAS the stored
 * `quadrant`: the old page's quadrant menu changed only it, and the old
 * agent actions stored it beside `urgent` / `important` (with a quadrant
 * an agent decided overriding them). New code never stores a quadrant
 * (the method's write drops it), so a row that still holds a valid one is
 * legacy and its quadrant is the user's last word: the row reads with
 * `urgent` / `important` set aside, so the method maps the quadrant back
 * to its answers. Pure; the stored row is untouched, and the next save
 * writes the answers the editor showed.
 *
 * The agent actions apply the same rule (lib/actions/tools/eisenhower),
 * as the method's own read() should (it lets the answers win today).
 */
export function legacyQuadrantFirst(row: PrioritizationItem): PrioritizationItem {
  if (row.framework !== FRAMEWORK || !toChoice(EISENHOWER_QUADRANTS, row.fields?.quadrant)) {
    return row;
  }
  const fields = { ...row.fields };
  delete fields.urgent;
  delete fields.important;
  return { ...row, fields };
}

/** The list for tasks missing an answer (legacy junk, a raw CRUD write). */
export const UNSORTED = "unsorted" as const;
export const UNSORTED_LABEL = "Not sorted yet";

export type EisGroupId = EisenhowerQuadrant | typeof UNSORTED;

/** A name short enough for a sentence or a toast. */
export function shortName(name: string, max = 40): string {
  const t = name.trim() || "Untitled task";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The tasks, scored by the registry for `today` (YYYY-MM-DD), a legacy
 * quadrant read first. Each ranked row carries the stored row itself (a
 * delete's Undo puts back exactly what was there).
 */
export function eisRows(rows: readonly PrioritizationItem[], today: string): RankedRow[] {
  const stored = new Map(rows.map((r) => [r.id, r]));
  return rankMethodRows(FRAMEWORK, rows.map(legacyQuadrantFirst), [], { today }).map((r) => ({
    ...r,
    row: stored.get(r.row.id) ?? r.row,
  }));
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

/** Both questions are answered: the form can save (the method needs both). */
export const bothAnswered = (v: Values): boolean =>
  v.important !== undefined && v.urgent !== undefined;

/**
 * The form's live line: where the answers put the task today, and why
 * when the due date made it urgent ("Urgent because it's due tomorrow, so
 * it goes to Do."). Says what's missing until both are answered, the same
 * rule the form saves by: a near due date doesn't stand in for the Urgent
 * answer, so the line never names a pane the form would then refuse.
 */
export function previewText(v: Values, today: string): string {
  const q = bothAnswered(v) ? eisenhowerQuadrant(v, today) : null;
  if (!q) {
    if (v.important === undefined && v.urgent === undefined) {
      return "Answer both questions to see where it goes.";
    }
    if (v.important === undefined) return "Say whether it's important to see where it goes.";
    const u = urgency(v, today);
    return u.because === "due" && u.daysToDue !== null
      ? `Say whether it's urgent (being ${dueText(u.daysToDue)} makes it urgent anyway).`
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
