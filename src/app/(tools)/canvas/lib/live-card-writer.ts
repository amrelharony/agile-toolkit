/**
 * Where a Sprint board card's changes go: to its story. A live card is a
 * view of the story (./live-boards), so a move or an edit made only to the
 * card would be put back by the next reconcile; instead the story is
 * written, and the card follows it like every other tool that reads the
 * story (the Kanban sprint board, the cockpit, Burndown, agents).
 *
 * Moves go through `setStoryStatus`, the app's one status writer, so the
 * flow stamps stay right. Every story write comes with Undo, twice over:
 * in its toast, and as a `CanvasUndoEffect` the caller records for Cmd+Z
 * (the canvas's own undo restores only board objects, which the board
 * would lay out from the story again straight after). Both put back only
 * what is still as this write left it (`revertMove`, `swapFields`), so a
 * newer move or edit, or the other Undo having run, is never overwritten.
 * Each helper reads the story at the moment it writes, never a render's
 * copy.
 */

import { STORY_TITLE_MAX } from "@/lib/handoffs/targets/backlog-story";
import { setStoryStatus } from "@/lib/sprints/store";
import { isStoryStatus } from "@/lib/sprints/story-status";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story, StoryStatus, WhiteboardCard } from "@/lib/stores/workspace-types";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import {
  closedBoardNote,
  isClosedSprint,
  moveMessage,
  revertMove,
  sprintColumnOf,
} from "../../kanban/sprint-view";
import { withOwner } from "../../kanban/sprint-writer";
import type { CanvasUndoEffect } from "../use-undo-stack";
import type { StoryMove } from "./live-boards";

export type { StoryMove } from "./live-boards";

const storyById = (id: string) => useWorkspaceStore.getState().stories.find((s) => s.id === id);

/** The closed sprint `story` is in, if it is in one. */
function closedSprintOf(story: Story) {
  if (!story.sprintId) return undefined;
  const sprint = useWorkspaceStore.getState().sprints.find((s) => s.id === story.sprintId);
  return sprint && isClosedSprint(sprint) ? sprint : undefined;
}

/** A move about to be made: the story as it was, and where it goes. */
interface PlannedMove {
  story: Story;
  status: StoryStatus;
}

/**
 * The moves that would change something. Skips a story that is gone,
 * already in that status, or in a closed sprint (its board is read-only:
 * moving a done story out would change what the sprint delivered), and a
 * story listed twice.
 */
function planMoves(moves: readonly StoryMove[]): PlannedMove[] {
  const planned: PlannedMove[] = [];
  for (const { storyId, status } of moves) {
    const story = storyById(storyId);
    if (!story || story.status === status || closedSprintOf(story)) continue;
    if (planned.some((p) => p.story.id === story.id)) continue;
    planned.push({ story, status });
  }
  return planned;
}

const applyMoves = (planned: readonly PlannedMove[]) =>
  planned.forEach(({ story, status }) => setStoryStatus(story.id, status));

/** Undo: each story back where it was, unless it has moved again since. */
function revertMoves(planned: readonly PlannedMove[]): void {
  const ws = useWorkspaceStore.getState();
  for (const { story, status } of planned) {
    const current = storyById(story.id);
    const back = current && revertMove(current, story, status);
    if (back) ws.upsertStory(back);
  }
}

/** Redo: each move again, for a story still where the Undo left it. */
function redoMoves(planned: readonly PlannedMove[]): void {
  for (const { story, status } of planned) {
    const current = storyById(story.id);
    if (current && current.status === story.status && !closedSprintOf(current)) {
      setStoryStatus(story.id, status);
    }
  }
}

const moveLabel = (planned: readonly PlannedMove[], title = planned[0].story.title) =>
  planned.length === 1
    ? moveMessage(title, sprintColumnOf(planned[0].status))
    : `Moved ${planned.length} stories.`;

/**
 * Move stories dropped into other columns, with one Undo for the lot (see
 * `planMoves` for what is skipped). Returns how Cmd+Z undoes and redoes
 * the moves, or null when nothing moved.
 */
export function moveSprintStories(moves: readonly StoryMove[]): CanvasUndoEffect | null {
  const planned = planMoves(moves);
  if (planned.length === 0) return null;
  const effect: CanvasUndoEffect = {
    undo: () => revertMoves(planned),
    redo: () => redoMoves(planned),
  };
  undoable({ label: moveLabel(planned), apply: () => applyMoves(planned), revert: effect.undo });
  return effect;
}

/** The story fields a card edit can write. */
type StoryFields = Partial<Pick<Story, "title" | "points" | "owner">>;

/**
 * Give the story `to`'s value for each field it still holds `from`'s for:
 * an Undo (from = what the edit wrote, to = what was there) or a Redo (the
 * other way round). A field changed since keeps its newer value.
 */
function swapFields(id: string, from: StoryFields, to: StoryFields): void {
  const current = storyById(id);
  if (!current) return;
  const next: Story = { ...current };
  const rec = next as unknown as Record<string, unknown>;
  let changed = false;
  for (const key of Object.keys(to) as (keyof StoryFields)[]) {
    if (current[key] !== from[key]) continue;
    if (to[key] === undefined) delete rec[key];
    else rec[key] = to[key];
    changed = true;
  }
  if (changed) useWorkspaceStore.getState().upsertStory(next);
}

/** The card fields a story owns on a Sprint board. */
const STORY_FIELDS = ["title", "points", "assignee", "status"] as const;

/** A Sprint board card's edit, split between the card and its story. */
export interface LiveCardEdit {
  /**
   * What to write on the card: the fields that stay on it (description,
   * due date, tags, colour) plus the story's new values, so the card shows
   * them at once and the next reconcile has nothing to change.
   */
  patch: Partial<WhiteboardCard>;
  /** How Cmd+Z takes back what the story took, or null when it took nothing. */
  effect: CanvasUndoEffect | null;
}

/**
 * Save a Sprint board card's edit (the card detail form, the inline title)
 * to its story: title, points and assignee as the story's title, points and
 * owner, a status as a move, all under one Undo. A field the story can't
 * take (an empty title, negative points, an unknown status) is left out and
 * the story keeps its value.
 */
export function writeLiveCardEdit(
  card: WhiteboardCard,
  patch: Partial<WhiteboardCard>
): LiveCardEdit {
  const rest: Partial<WhiteboardCard> = { ...patch };
  for (const key of STORY_FIELDS) delete rest[key];
  const storyId = card.sourceRef?.tool === "story" ? card.sourceRef.entityId : undefined;
  const story = storyId ? storyById(storyId) : undefined;
  // No story behind it (removed a moment ago): reconcile takes the card away.
  if (!story) return { patch: rest, effect: null };
  const closed = closedSprintOf(story);
  if (closed) {
    toast.info(closedBoardNote(closed));
    return { patch: rest, effect: null };
  }

  const out: Partial<WhiteboardCard> = { ...rest };
  const before: StoryFields = {};
  const written: StoryFields = {};
  let next: Story = story;
  if ("title" in patch) {
    const title = (patch.title ?? "").trim().slice(0, STORY_TITLE_MAX);
    if (!title) {
      toast.info("A story needs a title, so it keeps its old one.");
    } else if (title !== story.title) {
      next = { ...next, title };
      before.title = story.title;
      written.title = title;
      out.title = title;
    }
  }
  if ("points" in patch) {
    const p = patch.points;
    if (p === undefined || (Number.isFinite(p) && p >= 0)) {
      if (p !== story.points) {
        next = { ...next };
        if (p === undefined) delete next.points;
        else next.points = p;
        before.points = story.points;
        written.points = p;
        out.points = p;
      }
    }
  }
  if ("assignee" in patch) {
    const owned = withOwner(next, patch.assignee ?? "");
    if (owned !== next) {
      next = owned;
      before.owner = story.owner;
      written.owner = owned.owner;
      out.assignee = owned.owner;
    }
  }
  const fieldsChanged = next !== story;
  const planned =
    "status" in patch && isStoryStatus(patch.status) && patch.status !== story.status
      ? planMoves([{ storyId: story.id, status: patch.status }])
      : [];
  if (planned.length > 0) out.status = sprintColumnOf(planned[0].status);
  if (!fieldsChanged && planned.length === 0) return { patch: out, effect: null };

  const effect: CanvasUndoEffect = {
    undo: () => {
      revertMoves(planned);
      swapFields(story.id, written, before);
    },
    redo: () => {
      swapFields(story.id, before, written);
      redoMoves(planned);
    },
  };
  undoable({
    label:
      planned.length > 0 ? moveLabel(planned, next.title) : `Updated the story “${next.title}”.`,
    apply: () => {
      // Fields first: the move then stamps the story as it now reads.
      if (fieldsChanged) useWorkspaceStore.getState().upsertStory(next);
      applyMoves(planned);
    },
    revert: effect.undo,
  });
  return { patch: out, effect };
}
