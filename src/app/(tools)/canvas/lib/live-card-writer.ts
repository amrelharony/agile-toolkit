/**
 * Where a Sprint board card's changes go: to its story. A live card is a
 * view of the story (./live-boards), so a move or an edit made only to the
 * card would be put back by the next reconcile; instead the story is
 * written, and the card follows it like every other tool that reads the
 * story (the Kanban sprint board, the cockpit, Burndown, agents).
 *
 * Moves go through `setStoryStatus`, the app's one status writer, so the
 * flow stamps stay right, and come with Undo through `revertMove`, which
 * never drags a story back over a newer move. Each helper reads the story
 * at the moment it writes, never a render's copy.
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
import type { StoryMove } from "./live-boards";

export type { StoryMove } from "./live-boards";

const storyById = (id: string) => useWorkspaceStore.getState().stories.find((s) => s.id === id);

/** The closed sprint `story` is in, if it is in one. */
function closedSprintOf(story: Story) {
  if (!story.sprintId) return undefined;
  const sprint = useWorkspaceStore.getState().sprints.find((s) => s.id === story.sprintId);
  return sprint && isClosedSprint(sprint) ? sprint : undefined;
}

/**
 * Move stories dropped into other columns, with one Undo for the lot.
 * Skips a story that is gone, already in that status, or in a closed sprint
 * (its board is read-only: moving a done story out would change what the
 * sprint delivered). Returns how many moved.
 */
export function moveSprintStories(moves: readonly StoryMove[]): number {
  const before: { story: Story; status: StoryStatus }[] = [];
  for (const { storyId, status } of moves) {
    const story = storyById(storyId);
    if (!story || story.status === status || closedSprintOf(story)) continue;
    if (before.some((b) => b.story.id === story.id)) continue;
    before.push({ story, status });
  }
  if (before.length === 0) return 0;
  const [first] = before;
  undoable({
    label:
      before.length === 1
        ? moveMessage(first.story.title, sprintColumnOf(first.status))
        : `Moved ${before.length} stories.`,
    apply: () => before.forEach(({ story, status }) => setStoryStatus(story.id, status)),
    revert: () => {
      const ws = useWorkspaceStore.getState();
      for (const { story, status } of before) {
        const current = storyById(story.id);
        const back = current && revertMove(current, story, status);
        if (back) ws.upsertStory(back);
      }
    },
  });
  return before.length;
}

/** The card fields a story owns on a Sprint board. */
const STORY_FIELDS = ["title", "points", "assignee", "status"] as const;

/**
 * Save a Sprint board card's edit (the card detail form, the inline title)
 * to its story: title, points and assignee as the story's title, points and
 * owner, a status as a move (with Undo). Returns the patch to apply to the
 * card itself: the fields that stay on the card (description, due date,
 * tags, colour) plus the story's new values, so the card shows them at once
 * and the next reconcile has nothing to change. A field the story can't
 * take (an empty title, negative points, an unknown status) is left out and
 * the story keeps its value.
 */
export function writeLiveCardEdit(
  card: WhiteboardCard,
  patch: Partial<WhiteboardCard>
): Partial<WhiteboardCard> {
  const rest: Partial<WhiteboardCard> = { ...patch };
  for (const key of STORY_FIELDS) delete rest[key];
  const storyId = card.sourceRef?.tool === "story" ? card.sourceRef.entityId : undefined;
  const story = storyId ? storyById(storyId) : undefined;
  // No story behind it (removed a moment ago): reconcile takes the card away.
  if (!story) return rest;
  const closed = closedSprintOf(story);
  if (closed) {
    toast.info(closedBoardNote(closed));
    return rest;
  }

  const out: Partial<WhiteboardCard> = { ...rest };
  let next: Story = story;
  if ("title" in patch) {
    const title = (patch.title ?? "").trim().slice(0, STORY_TITLE_MAX);
    if (!title) {
      toast.info("A story needs a title, so it keeps its old one.");
    } else if (title !== story.title) {
      next = { ...next, title };
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
        out.points = p;
      }
    }
  }
  if ("assignee" in patch) {
    const owned = withOwner(next, patch.assignee ?? "");
    if (owned !== next) {
      next = owned;
      out.assignee = owned.owner;
    }
  }
  if (next !== story) useWorkspaceStore.getState().upsertStory(next);

  if ("status" in patch && isStoryStatus(patch.status) && patch.status !== story.status) {
    if (moveSprintStories([{ storyId: story.id, status: patch.status }]) > 0) {
      out.status = sprintColumnOf(patch.status);
    }
  }
  return out;
}
