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
 * for To do, so a team sets its WIP limits once. To do is the sprint's
 * queue, though: its count shows against the limit, but only the columns
 * of work in progress nudge (see `sprintBreaches`).
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

/**
 * A completed or cancelled sprint. Its board is a record of what the
 * sprint delivered (its velocity, review and burndown read it), so it opens
 * read-only: moving a done story out would clear its done time, as Sprint
 * Planning refuses to plan into a closed sprint for the same reason.
 */
export function isClosedSprint(sprint: Pick<Sprint, "status">): boolean {
  return sprint.status === "completed" || sprint.status === "cancelled";
}

/** Why a closed sprint's board can't be changed, for the note above it. */
export function closedBoardNote(sprint: Pick<Sprint, "name" | "status">): string {
  const state = sprint.status === "cancelled" ? "cancelled" : "completed";
  return `${sprint.name} is ${state}, so its board is read-only: moving its stories now would change what the sprint delivered. Pick an open sprint to keep working.`;
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
 * From the status history when its last entry is the current status.
 * Never walked back over an earlier "backlog" entry, although a backlog
 * story waits in To do too: Sprint Planning writes "backlog" when it moves
 * a story out of the sprint and "todo" when it plans it back in, so the
 * time before is product backlog, not this sprint's To do. Otherwise, for
 * a story moved before the history was kept or edited by hand: when work
 * started (In progress, Review) or when it was done.
 */
export function columnEnteredAt(story: Story): string | null {
  const col = sprintColumnOf(story.status);
  const history = story.statusHistory ?? [];
  const last = history[history.length - 1];
  if (last && last.status === story.status && valid(last.at)) return last.at;
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

/** Whether a column over its limit nudges: only the work in progress does (see below). */
export const nudges = (col: SprintColumnId) => col === "in_progress" || col === "review";

/**
 * Columns of work in progress (In progress, Review) holding more stories
 * than their limit. To do is the sprint's queue and Done is finished, so
 * neither nudges: To do shares the Flow board's Ready limit (5 unless the
 * team changed it), and a sprint planned with more stories than that would
 * have warned from day one, before anyone started anything.
 */
export function sprintBreaches(
  byColumn: Record<SprintColumnId, readonly Story[]>,
  wipLimits: Partial<Record<KanbanColumnId, number>>
): SprintBreach[] {
  return SPRINT_COLUMNS.flatMap(({ id, label, wipKey }) => {
    if (!nudges(id)) return [];
    const limit = wipLimits[wipKey] ?? 0;
    const count = byColumn[id].length;
    return limit > 0 && count > limit ? [{ column: id, label, count, limit }] : [];
  });
}

const stories = (n: number) => `${n} ${n === 1 ? "story" : "stories"}`;

/**
 * "In progress has 5 stories, limit 3: finish something before starting
 * more." A nudge, never a block: the move has already happened.
 */
export function wipNudge(b: SprintBreach): string {
  return `${b.label} has ${stories(b.count)}, limit ${b.limit}: finish something before starting more.`;
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
  const flowing = breaches[0];
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
const FLOW_KEYS = ["status", "startedAt", "doneAt", "statusHistory"] as const;

/**
 * Whether the story's latest change is still the move from `before` to
 * `movedTo`: its newest history entry is that move, right after the
 * history as it was. The status alone can't tell: To do → In progress →
 * Review → In progress ends where the first move did.
 */
function isLatestMove(current: Story, before: Story, movedTo: StoryStatus): boolean {
  if (current.status !== movedTo) return false;
  const now = current.statusHistory ?? [];
  const was = before.statusHistory ?? [];
  const last = now[now.length - 1];
  if (!last || last.status !== movedTo || last.from !== before.status) return false;
  const wasLast = was[was.length - 1];
  if (!wasLast) return now.length === 1;
  const prior = now[now.length - 2];
  return prior !== undefined && prior.at === wasLast.at && prior.status === wasLast.status;
}

/**
 * `current` with the move to `movedTo` undone: status, flow stamps and
 * history as they were in `before`, and every other field (an owner or a
 * blocked flag set since) as it is now. The flag comes back only when the
 * move itself cleared it, by going to Done. Null when the story has moved
 * again since, so Undo never drags it back over a newer move.
 */
export function revertMove(current: Story, before: Story, movedTo: StoryStatus): Story | null {
  if (!isLatestMove(current, before, movedTo)) return null;
  const next: Story = { ...current };
  const target = next as unknown as Record<string, unknown>;
  for (const key of FLOW_KEYS) {
    if (before[key] === undefined) delete target[key];
    else target[key] = before[key];
  }
  if (movedTo === "done" && before.blocked) next.blocked = true;
  return next;
}
