/**
 * "Queue for Poker": an unsized story goes to the Planning Poker queue, the
 * same queue Sprint Planning fills. The entry names the story
 * (`sourceRef: { tool: "story" }`), so the estimate the team accepts there
 * is written back to the story's points (lib/handoffs/poker-writeback.ts)
 * and the story leaves "needs points" here on its own. Its notes and
 * acceptance criteria go with it, as the description Poker shows.
 */

import { sendHandoff } from "@/lib/handoffs/send";
import {
  STORY_QUEUE_TOOL,
  currentPokerLog,
  pokerQueueRoute,
  storyQueueSource,
} from "@/lib/handoffs/targets/poker-queue";
import type { HandoffLink, PokerEstimationLog, Story } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";

/** The write-back looks for this tool name on a queued story. */
const STORY_TOOL = STORY_QUEUE_TOOL;

const source = storyQueueSource;

/** Ids of the stories waiting in the queue (pulled into a session or not). */
export function queuedStoryIds(log: PokerEstimationLog | undefined): Set<string> {
  return new Set(
    (log?.queue ?? []).filter((q) => q.sourceRef.tool === STORY_TOOL).map((q) => q.sourceRef.id)
  );
}

/**
 * The story's queue entry as a hand-off link. A story has no links of its
 * own: the queue entry is the record, so `sendHandoff` reads it from there
 * and refuses a second send while the story is still queued.
 */
function queueLinks(storyId: string): HandoffLink[] {
  const item = currentPokerLog()?.queue?.find(
    (q) => q.sourceRef.tool === STORY_TOOL && q.sourceRef.id === storyId
  );
  return item ? [{ route: "poker-queue", targetId: item.id, at: item.queuedAt }] : [];
}

/** Queue one story, with Undo. False when it was already queued. */
export function queueForPoker(story: Story): boolean {
  const link = sendHandoff("poker-queue", source(story), {
    getLinks: () => queueLinks(story.id),
    setLinks: () => {},
  });
  return link !== null;
}

/**
 * Queue every story in `stories` that isn't queued yet, with one Undo for
 * the lot. Returns how many were queued.
 */
export function queueAllForPoker(stories: readonly Story[]): number {
  const queued = queuedStoryIds(currentPokerLog());
  const toQueue = stories.filter((s) => s.title.trim() && !queued.has(s.id));
  if (toQueue.length === 0) return 0;
  let ids: string[] = [];
  undoable({
    label: `Queued ${toQueue.length} ${toQueue.length === 1 ? "story" : "stories"} for Planning Poker`,
    apply: () => {
      ids = toQueue.map((s) => pokerQueueRoute.send(source(s)));
    },
    revert: () => ids.forEach((id) => pokerQueueRoute.remove(id)),
  });
  return toQueue.length;
}
