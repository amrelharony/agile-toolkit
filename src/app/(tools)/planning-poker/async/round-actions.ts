/**
 * What the host's page does to its rounds without a meeting, through the
 * workspace store (the entity syncs, so the host's phone and laptop see the
 * same rounds). Every read goes through `readAsyncRound`, so an expired
 * round is closed before anything is added to it.
 */

import type { PokerAsyncRound, PokerAsyncStory } from "@/lib/stores/workspace-types";
import { currentPokerLog } from "@/lib/handoffs/targets/poker-queue";
import { writeBackPokerEstimate } from "@/lib/handoffs/poker-writeback";
import {
  NOT_IN_BROWSER,
  addReply,
  replyProblem,
  withStoryEstimate,
  type AsyncReplyCode,
} from "@/lib/estimation/async-pack";
import { agreeTypedStory, roundById, saveRound } from "./round-store";

export { TOO_BIG, agreeTypedStory, roundById, saveRound, shortTitle } from "./round-store";

export type AddReplyResult =
  | { ok: true; round: PokerAsyncRound; name: string }
  | { ok: false; problem: string };

/** Add a reply to its round in this browser (Replace or Keep both on a clash). */
export function addReplyToRound(
  reply: AsyncReplyCode,
  mode: "replace" | "keep-both"
): AddReplyResult {
  const round = roundById(reply.roundId);
  const problem = replyProblem(reply, round);
  if (problem || !round) return { ok: false, problem: problem ?? NOT_IN_BROWSER };
  const next = addReply(round, reply, mode, {
    id: `reply_${crypto.randomUUID()}`,
    at: new Date().toISOString(),
  });
  if (next === round) return { ok: false, problem: `“${round.title}” takes no more replies.` };
  const tooBig = saveRound(next);
  if (tooBig) return { ok: false, problem: tooBig };
  return { ok: true, round: next, name: next.replies[next.replies.length - 1].name };
}

export type AcceptResult =
  | { via: "queue"; written: boolean; title: string }
  | { via: "backlog"; created: boolean };

/**
 * The host agreed `value` for one of the round's stories. A story from the
 * queue (its id is a queue item's stamped sessionStoryId) has the estimate
 * written back to where it came from, as a live session does. A typed story
 * is saved to the backlog with its points (`agreeTypedStory`), with Undo.
 * Either way the round keeps the agreed card.
 */
export function acceptAsyncEstimate(
  roundId: string,
  story: PokerAsyncStory,
  value: string,
  votes: string[]
): AcceptResult | null {
  const round = roundById(roundId);
  if (!round || round.status === "closed") return null;
  const queued = (currentPokerLog()?.queue ?? []).some((q) => q.sessionStoryId === story.id);
  if (queued) {
    const { item, written } = writeBackPokerEstimate({
      sessionStoryId: story.id,
      value,
      scaleType: round.scaleType,
      votes,
    });
    saveRound(withStoryEstimate(round, story.id, value, new Date().toISOString()));
    return { via: "queue", written, title: item?.title ?? story.title };
  }
  return { via: "backlog", ...agreeTypedStory(roundId, story, value) };
}
