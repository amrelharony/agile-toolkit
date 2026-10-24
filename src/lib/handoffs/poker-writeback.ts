/**
 * Planning Poker's side of the queue: pull queued stories into a session,
 * and write an accepted estimate back to where the story came from.
 *
 * Trust: the write-back looks the story up in THIS browser's own queue, by
 * the session story id the host stamped when it pulled the story in. The
 * session payload (which guests also send) is only used for that id and the
 * accepted value; the target card comes from the queue entry. A guest's
 * browser has no such entry, and a forged or unknown id matches nothing, so
 * both do nothing.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PokerEstimate, PokerQueueItem, StoryMap } from "@/lib/stores/workspace-types";
import {
  POKER_DESCRIPTION_MAX,
  POKER_TITLE_MAX,
  currentPokerLog,
  updatePokerLog,
} from "./targets/poker-queue";
import { STORY_MAP_ID } from "@/lib/stores/workspace-types";

/** MUST match SM_ID in story-mapper-client.tsx and actions/tools/story-mapper.ts. */
export { STORY_MAP_ID };

/** The session's own cap on stories. */
const MAX_SESSION_STORIES = 500;

/** A story as the Planning Poker session holds it. */
export interface QueuedSessionStory {
  id: string;
  title: string;
  description?: string;
  finalEstimate: null;
}

/** Queue items not in the session yet: never pulled in, or pulled into a
 *  session that has since ended (their story id isn't in `sessionStoryIds`). */
export function pendingQueueItems(
  queue: readonly PokerQueueItem[] | undefined,
  sessionStoryIds: readonly string[] = []
): PokerQueueItem[] {
  const inSession = new Set(sessionStoryIds);
  return (queue ?? []).filter((q) => !q.sessionStoryId || !inSession.has(q.sessionStoryId));
}

/**
 * Turn the pending queue items into session stories, and stamp each queue
 * item with the story id it became (the write-back's only key). At most
 * `room` stories, so a session never passes its 500-story limit.
 */
export function takeQueuedStories(
  sessionStoryIds: readonly string[] = [],
  room = MAX_SESSION_STORIES - sessionStoryIds.length
): QueuedSessionStory[] {
  const pending = pendingQueueItems(currentPokerLog()?.queue, sessionStoryIds).slice(
    0,
    Math.max(0, room)
  );
  if (pending.length === 0) return [];
  const stamped = new Map<string, string>();
  const stories = pending.map((q) => {
    const id = crypto.randomUUID();
    stamped.set(q.id, id);
    const title = q.title.trim().slice(0, POKER_TITLE_MAX) || "Untitled story";
    const description = q.description?.slice(0, POKER_DESCRIPTION_MAX) || undefined;
    return { id, title, ...(description ? { description } : {}), finalEstimate: null };
  });
  updatePokerLog((doc) => ({
    ...doc,
    queue: (doc.queue ?? []).map((q) =>
      stamped.has(q.id) ? { ...q, sessionStoryId: stamped.get(q.id) } : q
    ),
  }));
  return stories;
}

/** Set `estimate` on a story-map card. False when the card is gone. */
function setStoryMapEstimate(cardId: string, estimate: string): boolean {
  const map: StoryMap | undefined = (useWorkspaceStore.getState().storyMaps ?? []).find(
    (m) => m.id === STORY_MAP_ID
  );
  if (!map) return false;
  let found = false;
  const slices = map.slices.map((sl) => {
    let changed = false;
    const cards = Object.fromEntries(
      Object.entries(sl.cards).map(([stepId, list]) => [
        stepId,
        list.map((c) => {
          if (c.id !== cardId) return c;
          found = true;
          changed = true;
          return { ...c, estimate };
        }),
      ])
    );
    return changed ? { ...sl, cards } : sl;
  });
  if (!found) return false;
  useWorkspaceStore.getState().upsertStoryMap({ ...map, slices });
  return true;
}

/**
 * Set `points` on a workspace story (Sprint Planning queues these). Only a
 * numeric estimate can become points; a T-shirt size is logged but not
 * written. False when the story is gone or the value isn't a number.
 */
function setStoryPoints(storyId: string, estimate: string): boolean {
  const n = Number(estimate);
  if (!Number.isFinite(n) || n < 0) return false;
  const story = useWorkspaceStore.getState().stories.find((st) => st.id === storyId);
  if (!story) return false;
  useWorkspaceStore.getState().upsertStory({ ...story, points: n });
  return true;
}

export interface WriteBackInput {
  /** The session story the host accepted an estimate for. */
  sessionStoryId: string;
  value: string;
  scaleType: string;
  votes?: string[];
}

export interface WriteBackResult {
  /** The queue entry the story came from; null when nothing matched. */
  item: PokerQueueItem | null;
  /** Whether the estimate landed on the source card. */
  written: boolean;
}

/**
 * The host accepted `value` for a session story. When that story came from
 * this browser's queue: write the estimate to the source card, log it (under
 * the queue item's id, with its sourceRef) and take it off the queue.
 * Anything else is ignored.
 */
export function writeBackPokerEstimate({
  sessionStoryId,
  value,
  scaleType,
  votes,
}: WriteBackInput): WriteBackResult {
  const none: WriteBackResult = { item: null, written: false };
  if (typeof sessionStoryId !== "string" || !sessionStoryId) return none;
  const estimate = typeof value === "string" ? value.trim() : "";
  if (!estimate || estimate.length > 32) return none;
  const item = currentPokerLog()?.queue?.find((q) => q.sessionStoryId === sessionStoryId);
  if (!item) return none;

  const written =
    item.sourceRef.tool === "story-mapper"
      ? setStoryMapEstimate(item.sourceRef.id, estimate)
      : item.sourceRef.tool === "story"
        ? setStoryPoints(item.sourceRef.id, estimate)
        : false;

  const logged: PokerEstimate = {
    id: item.id,
    storyTitle: item.title,
    finalEstimate: estimate,
    scaleType,
    ...(votes && votes.length > 0 ? { votes: votes.slice(0, 100) } : {}),
    decidedAt: new Date().toISOString(),
    sourceRef: item.sourceRef,
  };
  updatePokerLog((doc) => ({
    ...doc,
    estimates: [...(doc.estimates ?? []).filter((e) => e.id !== item.id), logged],
    queue: (doc.queue ?? []).filter((q) => q.id !== item.id),
  }));
  return { item, written };
}
