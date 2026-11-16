/**
 * A story's flow stamps, written whenever its status changes: when work
 * started, when it was done, and a capped history of the changes. Pure, so
 * the browser writer (`setStoryStatus` in ./store.ts) and the agents'
 * `workspace.story.*` actions stamp a change the same way. Its sprint moves
 * are stamped too (`stampStoryMembership`), by the workspace store on every
 * local write and by the agents' writes, so a burnup can tell when scope
 * joined or left a sprint. So are its refinements (`stampRefinedWrite`): a
 * write that changes what the story says stamps `refinedAt`, which Backlog
 * Health's stale check reads; an Undo that takes back only its own change
 * puts the earlier stamp back (`withRefinedPutBack`).
 *
 *   - Into in progress, review or done from the backlog or to do: `startedAt`.
 *   - Back to the backlog or to do: `startedAt` and `doneAt` are cleared (the
 *     history keeps the earlier attempt).
 *   - Into done: `doneAt`, and `blocked` is cleared. Out of done: no `doneAt`.
 */

import type {
  Story,
  StorySprintChange,
  StoryStatus,
  StoryStatusChange,
} from "@/lib/stores/workspace-types";

/** At most this many status changes are kept per story (the latest). */
export const STORY_STATUS_HISTORY_CAP = 50;

/** At most this many sprint moves are kept per story (the latest). */
export const STORY_SPRINT_HISTORY_CAP = 20;

export const STORY_STATUSES: readonly StoryStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
];

/** Statuses that mean work on the story has started. */
const STARTED: ReadonlySet<StoryStatus> = new Set<StoryStatus>(["in_progress", "review", "done"]);

export function isStoryStatus(value: unknown): value is StoryStatus {
  return typeof value === "string" && (STORY_STATUSES as readonly string[]).includes(value);
}

/** The history with `change` added, keeping only the latest entries. */
function withChange(
  history: readonly StoryStatusChange[] | undefined,
  change: StoryStatusChange
): StoryStatusChange[] {
  return [...(history ?? []), change].slice(-STORY_STATUS_HISTORY_CAP);
}

/**
 * `story` moved to `status` at `at`, with its stamps updated. The same story
 * (by reference) when the status doesn't change.
 */
export function withStoryStatus(
  story: Story,
  status: StoryStatus,
  at: string = new Date().toISOString()
): Story {
  if (story.status === status) return story;
  const next: Story = {
    ...story,
    status,
    statusHistory: withChange(story.statusHistory, { status, from: story.status, at }),
  };
  if (!STARTED.has(status)) {
    delete next.startedAt;
    delete next.doneAt;
  } else if (!STARTED.has(story.status)) {
    next.startedAt = at;
  }
  if (status === "done") {
    next.doneAt = at;
    delete next.blocked;
  } else {
    delete next.doneAt;
  }
  return next;
}

/** `story` flagged (or no longer flagged) as blocked. */
export function withStoryBlocked(story: Story, blocked: boolean): Story {
  if (Boolean(story.blocked) === blocked) return story;
  const next: Story = { ...story };
  if (blocked) next.blocked = true;
  else delete next.blocked;
  return next;
}

/** A story's points as a number (an unestimated story has none to record). */
function pointsOf(story: Pick<Story, "points">): number | undefined {
  return typeof story.points === "number" && Number.isFinite(story.points)
    ? story.points
    : undefined;
}

function sprintChange(
  story: Story,
  sprintId: string | undefined,
  from: string | undefined,
  at: string,
  carriedOver?: boolean
): StorySprintChange {
  const points = pointsOf(story);
  return {
    ...(sprintId ? { sprintId } : {}),
    ...(from ? { from } : {}),
    at,
    ...(points !== undefined ? { points } : {}),
    ...(carriedOver ? { carriedOver: true } : {}),
  };
}

/**
 * `story` moved to `sprintId` (undefined: back to the backlog) at `at`, with
 * the move recorded. The same story (by reference) when its sprint doesn't
 * change. `carriedOver` marks a move made by closing the sprint it left.
 */
export function withStorySprint(
  story: Story,
  sprintId: string | undefined,
  at: string = new Date().toISOString(),
  { carriedOver = false }: { carriedOver?: boolean } = {}
): Story {
  const to = sprintId || undefined;
  if ((story.sprintId || undefined) === to) return story;
  const next: Story = {
    ...story,
    sprintHistory: [
      ...(story.sprintHistory ?? []),
      sprintChange(story, to, story.sprintId || undefined, at, carriedOver),
    ].slice(-STORY_SPRINT_HISTORY_CAP),
  };
  if (to) next.sprintId = to;
  else delete next.sprintId;
  return next;
}

/**
 * Stamps for any write of a story: `next` is the record about to be saved
 * and `prev` the stored one (undefined for a new story). A new story gets
 * `createdAt`, and its sprint as its first sprint move. A changed `sprintId`
 * is recorded, unless the write set its own `sprintHistory` (an Undo putting
 * a copy back, or `withStorySprint` marking a carry-over): that is kept as
 * written. The same story (by reference) when there is nothing to stamp.
 */
export function stampStoryMembership(
  next: Story,
  prev: Story | undefined,
  at: string = new Date().toISOString()
): Story {
  if (!prev) {
    const needsCreated = !next.createdAt;
    const needsJoin = Boolean(next.sprintId) && !(next.sprintHistory ?? []).length;
    if (!needsCreated && !needsJoin) return next;
    const out: Story = { ...next };
    if (needsCreated) out.createdAt = at;
    if (needsJoin) out.sprintHistory = [sprintChange(next, next.sprintId, undefined, at)];
    return out;
  }
  if ((prev.sprintId || undefined) === (next.sprintId || undefined)) return next;
  if (!same(next.sprintHistory, prev.sprintHistory)) return next;
  return {
    ...next,
    sprintHistory: [
      ...(prev.sprintHistory ?? []),
      sprintChange(next, next.sprintId || undefined, prev.sprintId || undefined, at),
    ].slice(-STORY_SPRINT_HISTORY_CAP),
  };
}

const STAMPS = ["startedAt", "doneAt", "blocked", "statusHistory"] as const;

/** Equal by value (a validated copy of the history is a new array). */
function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

const REFINED_FIELDS = ["title", "points", "notes", "acceptanceCriteria", "gwt"] as const;

/** Stamps `refinedAt` when a write changes what the story says (not on create, nor when the write sets it itself). */
export function stampRefinedWrite(
  next: Story,
  prev: Story | undefined,
  at: string = new Date().toISOString()
): Story {
  if (!prev || next.refinedAt !== prev.refinedAt) return next;
  return REFINED_FIELDS.some((k) => !same(next[k], prev[k])) ? { ...next, refinedAt: at } : next;
}

/**
 * For an Undo (or Redo) that rebuilds a story from its current copy and
 * takes back only its own change: `from` is the `refinedAt` the change being
 * taken back left, `to` the one the story had before it (undefined: none).
 * While the story still carries `from`, it gets `to`, which the write then
 * keeps as written (`stampRefinedWrite`), so undoing a fix leaves a stale
 * story stale. A newer edit's stamp is left alone.
 */
export function withRefinedPutBack(
  next: Story,
  from: string | undefined,
  to: string | undefined
): Story {
  if (from === to || next.refinedAt !== from) return next;
  const out: Story = { ...next };
  if (to === undefined) delete out.refinedAt;
  else out.refinedAt = to;
  return out;
}

/** At most this many writes' stamps are kept for a later Undo (the latest). */
const REFINED_MARKS_CAP = 50;

/**
 * The `refinedAt` stamps of writes an Undo may take back later, by key, for
 * a page whose Undo arrives as a plain write (the Given/When/Then editor's
 * delete): `note` after the write, with the stamp the story had before it
 * and the one it left; `putBack` on the Undo's write, which then keeps the
 * earlier stamp (`withRefinedPutBack`). Each key is used once.
 */
export interface RefinedMarks {
  note(key: string, before: string | undefined, after: string | undefined): void;
  putBack(key: string, next: Story): Story;
}

export function createRefinedMarks(): RefinedMarks {
  const marks = new Map<string, { before: string | undefined; after: string | undefined }>();
  return {
    note(key, before, after) {
      marks.delete(key);
      marks.set(key, { before, after });
      while (marks.size > REFINED_MARKS_CAP) {
        const oldest = marks.keys().next().value;
        if (oldest === undefined) break;
        marks.delete(oldest);
      }
    },
    putBack(key, next) {
      const mark = marks.get(key);
      if (!mark) return next;
      marks.delete(key);
      return withRefinedPutBack(next, mark.after, mark.before);
    },
  };
}

/**
 * Stamps for a story an agent wrote: `next` is the record about to be saved
 * and `prev` the stored one (undefined for a new story). A status change is
 * stamped like `withStoryStatus`, except that a stamp the write set itself
 * (a backfilled `doneAt`, say) is kept as written. A new story that starts
 * out in progress or done gets the start and done times it lacks. A change
 * to its title, points, notes or criteria stamps `refinedAt`
 * (`stampRefinedWrite`); nothing else changes.
 */
export function stampStoryWrite(
  next: Story,
  prev: Story | undefined,
  at: string = new Date().toISOString()
): Story {
  return stampRefinedWrite(
    stampStoryMembership(stampStatusWrite(next, prev, at), prev, at),
    prev,
    at
  );
}

function stampStatusWrite(next: Story, prev: Story | undefined, at: string): Story {
  if (!prev) {
    const out: Story = { ...next };
    if (STARTED.has(next.status) && !next.startedAt) out.startedAt = at;
    if (next.status === "done" && !next.doneAt) out.doneAt = at;
    return out;
  }
  if (prev.status === next.status) return next;
  const base: Story = { ...next, status: prev.status };
  for (const key of STAMPS) {
    if (prev[key] === undefined) delete base[key];
    else (base as unknown as Record<string, unknown>)[key] = prev[key];
  }
  const stamped = withStoryStatus(base, next.status, at);
  for (const key of STAMPS) {
    if (same(next[key], prev[key])) continue;
    // The write set this stamp itself.
    if (next[key] === undefined) delete stamped[key];
    else (stamped as unknown as Record<string, unknown>)[key] = next[key];
  }
  return stamped;
}
