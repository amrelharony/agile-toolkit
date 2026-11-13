/**
 * Save round, for Audience Wall: a live round's result becomes a saved
 * wall of the kind the room was opened as, at the front of the list,
 * logged by its counts (never its text), with Amr's cheer. Hands back the
 * undo the wall kit puts in its toast, or false when there's nothing to
 * keep.
 */

import { nanoid } from "nanoid";
import { cheer } from "@/lib/celebrate/cheer";
import { sessionFromResult, type WallKind, type WallResultLike } from "@/lib/audience-wall/model";
import { updateWalls } from "@/lib/audience-wall/store";
import { AUDIENCE_WALL_ACTIONS } from "@/lib/history/event-actions";

type Log = (action: string, payload?: Record<string, unknown>) => void;

export function saveWallRound(
  result: WallResultLike & { mode: string },
  kind: WallKind,
  { log, now = () => new Date() }: { log: Log; now?: () => Date }
): false | (() => void) {
  const session = sessionFromResult(result, kind, {
    id: `wall_${nanoid(10)}`,
    savedAt: result.closedAt || now().toISOString(),
  });
  if (session.posts.length === 0) return false;
  updateWalls((list) => [session, ...list]);
  log(AUDIENCE_WALL_ACTIONS.WALL_SAVED, {
    kind,
    mode: result.mode,
    posts: session.posts.length,
  });
  cheer("audience-wall", "result");
  return () => updateWalls((list) => list.filter((s) => s.id !== session.id));
}
