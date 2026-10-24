/**
 * The Sprint board's logic: the selected sprint's stories laid out by
 * status, how long each has sat in its column, WIP-limit nudges, the
 * header's verdict and how a move is undone. Pure, so the board, its
 * Markdown export and the tests agree.
 */

import type { KanbanColumnId, Sprint, Story, StoryStatus } from "@/lib/stores/workspace-types";
import { completionPct } from "@/lib/sprints/metrics";
import type { StoryProgress } from "@/lib/sprints/progress";
import { fmt } from "@/lib/charts/chart-text";
import { DAY_MS } from "./flow-view";

export type SprintColumnId = "todo" | "in_progress" | "review" | "done";

export interface SprintColumn {
  id: SprintColumnId;
  label: string;
  /** The status a story moved here gets. */
  status: StoryStatus;
  /** The Flow board column whose WIP limit this one shares. */
  wipKey: KanbanColumnId;
}

/**
 * Four columns over `Story.status`. A sprint story still marked "backlog"
 * (planned in but not started) waits in To do; moving a story to To do
 * writes "todo". The limits are the Flow board's, with Ready standing in
 * for To do, so a team sets its WIP limits once.
 */
export const SPRINT_COLUMNS: readonly SprintColumn[] = [
  { id: "todo", label: "To do", status: "todo", wipKey: "ready" },
  { id: "in_progress", label: "In progress", status: "in_progress", wipKey: "in_progress" },
  { id: "review", label: "Review", status: "review", wipKey: "review" },
  { id: "done", label: "Done", status: "done", wipKey: "done" },
];

export const SPRINT_COLUMN_LABEL = Object.fromEntries(
  SPRINT_COLUMNS.map((c) => [c.id, c.label])
) as Record<SprintColumnId, string>;

export function sprintColumn(id: SprintColumnId): SprintColumn {
  return SPRINT_COLUMNS.find((c) => c.id === id) ?? SPRINT_COLUMNS[0];
}

export function isSprintColumnId(value: unknown): value is SprintColumnId {
  return SPRINT_COLUMNS.some((c) => c.id === value);
}

/** The column a status shows in. An unknown status (a newer build, a hand edit) waits in To do. */
export function sprintColumnOf(status: StoryStatus | string): SprintColumnId {
  return status === "in_progress" || status === "review" || status === "done" ? status : "todo";
}

/** The sprint's stories by column, each column in stored order. */
export function storiesByColumn(
  stories: readonly Story[],
  sprintId: string
): Record<SprintColumnId, Story[]> {
  const out: Record<SprintColumnId, Story[]> = { todo: [], in_progress: [], review: [], done: [] };
  for (const story of stories) {
    if (story.sprintId === sprintId) out[sprintColumnOf(story.status)].push(story);
  }
  return out;
}

const valid = (iso: string | undefined): iso is string =>
  typeof iso === "string" && Number.isFinite(Date.parse(iso));

/**
 * When the story entered the column it is in, or null when nothing says.
 * From the status history when its last entry is the current status,
 * walking back over earlier entries in the same column (backlog → to do is
 * one stay in To do). Otherwise, for a story moved before the history was
 * kept or edited by hand: when work started (In progress, Review) or when
 * it was done.
 */
export function columnEnteredAt(story: Story): string | null {
  const col = sprintColumnOf(story.status);
  const history = story.statusHistory ?? [];
  const last = history[history.length - 1];
  if (last && last.status === story.status && valid(last.at)) {
    let at = last.at;
    for (let i = history.length - 2; i >= 0; i--) {
      const entry = history[i];
      if (sprintColumnOf(entry.status) !== col || !valid(entry.at)) break;
      at = entry.at;
    }
    return at;
  }
  if (col === "done") return valid(story.doneAt) ? story.doneAt : null;
  if (col === "in_progress" || col === "review") {
    return valid(story.startedAt) ? story.startedAt : null;
  }
  return null;
}

/** Whole days the story has been in its column (0 on the day it moved), or null when unknown. */
export function daysInColumn(story: Story, now: Date): number | null {
  const at = columnEnteredAt(story);
  if (at === null) return null;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / DAY_MS));
}

export interface SprintBreach {
  column: SprintColumnId;
  label: string;
  count: number;
  limit: number;
}

/** Columns holding more stories than their limit. Done is never limited. */
export function sprintBreaches(
  byColumn: Record<SprintColumnId, readonly Story[]>,
  wipLimits: Partial<Record<KanbanColumnId, number>>
): SprintBreach[] {
  return SPRINT_COLUMNS.flatMap(({ id, label, wipKey }) => {
    if (id === "done") return [];
    const limit = wipLimits[wipKey] ?? 0;
    const count = byColumn[id].length;
    return limit > 0 && count > limit ? [{ column: id, label, count, limit }] : [];
  });
}

const stories = (n: number) => `${n} ${n === 1 ? "story" : "stories"}`;

/**
 * "In progress has 5 stories, limit 3: finish something before starting
 * more." A nudge, never a block: the move has already happened. To do is a
 * queue, so its nudge is about how much was planned in.
 */
export function wipNudge(b: SprintBreach): string {
  const head = `${b.label} has ${stories(b.count)}, limit ${b.limit}`;
  return b.column === "todo"
    ? `${head}: plan less into the sprint, or raise the limit.`
    : `${head}: finish something before starting more.`;
}

/** "Moved “Pay by card” to Review." plus the nudge when the move went over the limit. */
export function moveMessage(title: string, to: SprintColumnId, breach?: SprintBreach): string {
  const moved = `Moved “${title.trim() || "story"}” to ${SPRINT_COLUMN_LABEL[to]}.`;
  return breach ? `${moved} ${wipNudge(breach)}` : moved;
}

const pointsText = (n: number) => `${fmt(n)} ${n === 1 ? "point" : "points"}`;

/**
 * The header's one sentence: how far the sprint has come, then the one
 * thing that most needs the team's attention (blocked stories, a column
 * over its limit, unestimated stories, nothing started).
 */
export function sprintBoardVerdict(
  sprint: Pick<Sprint, "name">,
  progress: StoryProgress,
  breaches: readonly SprintBreach[]
): string {
  const { count, doneCount, scope, done } = progress;
  if (count === 0) return `No stories are planned into ${sprint.name} yet.`;
  if (doneCount === count) {
    return `Every story in ${sprint.name} is done${scope > 0 ? `: ${pointsText(scope)}` : ""}.`;
  }
  const pct = completionPct(done, scope);
  const base =
    scope > 0 && pct !== null
      ? `${fmt(done)} of ${pointsText(scope)} done (${pct}%)`
      : `${doneCount} of ${stories(count)} done`;
  const started = progress.byStatus.in_progress.count + progress.byStatus.review.count;
  const flowing = breaches.find((b) => b.column !== "todo");
  let caveat = "";
  if (progress.blocked > 0) {
    const n = progress.blocked;
    caveat = `; ${stories(n)} ${n === 1 ? "is" : "are"} blocked, so unblock ${n === 1 ? "it" : "them"} first`;
  } else if (flowing) {
    caveat = `; ${flowing.label} is over its WIP limit, so finish something before starting more`;
  } else if (progress.unestimated > 0) {
    const n = progress.unestimated;
    caveat = `; ${stories(n)} ${n === 1 ? "has" : "have"} no estimate yet`;
  } else if (started === 0 && doneCount === 0) {
    caveat = "; nothing has been started yet";
  }
  return `${base}${caveat}.`;
}

/** Fields a move writes (through `withStoryStatus`), which an Undo puts back. */
const FLOW_KEYS = ["status", "startedAt", "doneAt", "blocked", "statusHistory"] as const;

/**
 * `current` with the move to `movedTo` undone: status, flow stamps, blocked
 * flag and history as they were in `before`, and every other field (an
 * owner set since) as it is now. Null when the story has moved again since,
 * so Undo never drags it back over a newer move.
 */
export function revertMove(current: Story, before: Story, movedTo: StoryStatus): Story | null {
  if (current.status !== movedTo) return null;
  const next: Story = { ...current };
  const target = next as unknown as Record<string, unknown>;
  for (const key of FLOW_KEYS) {
    if (before[key] === undefined) delete target[key];
    else target[key] = before[key];
  }
  return next;
}
