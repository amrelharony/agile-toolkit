/**
 * What the host's page does to its rounds without a meeting, through the
 * workspace store (the entity syncs, so the host's phone and laptop see the
 * same rounds). Every read goes through `readAsyncRound`, so an expired
 * round is closed before anything is added to it.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  ENTITY_ROW_MAX_BYTES,
  type PokerAsyncRound,
  type PokerAsyncStory,
  type Story,
} from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { undoable } from "@/lib/utils/undoable";
import { withRefinedPutBack } from "@/lib/sprints/story-status";
import { currentPokerLog } from "@/lib/handoffs/targets/poker-queue";
import { writeBackPokerEstimate } from "@/lib/handoffs/poker-writeback";
import {
  NOT_IN_BROWSER,
  addReply,
  readAsyncRound,
  replyProblem,
  withStoryEstimate,
  type AsyncReplyCode,
} from "@/lib/estimation/async-pack";
import { planBacklogSave } from "../backlog";

export const TOO_BIG = "This round is too big to save. Close an older round first.";

/** The round with this id as every reader shows it, if this browser has it. */
export function roundById(id: string): PokerAsyncRound | undefined {
  const round = (useWorkspaceStore.getState().pokerAsyncRounds ?? []).find((r) => r.id === id);
  return round ? readAsyncRound(round) : undefined;
}

/** Save `round`, unless it has grown past a row's limit (then the sentence why). */
export function saveRound(round: PokerAsyncRound): string | null {
  if (jsonBytes(round) > ENTITY_ROW_MAX_BYTES) return TOO_BIG;
  useWorkspaceStore.getState().upsertPokerAsyncRound(round);
  return null;
}

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

/** A name short enough for a one-line label. */
export function shortTitle(title: string, max = 40): string {
  const t = title.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export type AcceptResult =
  | { via: "queue"; written: boolean; title: string }
  | { via: "backlog"; created: boolean };

/**
 * The host agreed `value` for one of the round's stories. A story from the
 * queue (its id is a queue item's stamped sessionStoryId) has the estimate
 * written back to where it came from, as a live session does. A typed story
 * is saved to the backlog with its points (Planning Poker's own Save to
 * backlog, keyed by the story's id), with Undo. Either way the round keeps
 * the agreed card.
 */
export function acceptAsyncEstimate(
  roundId: string,
  story: PokerAsyncStory,
  value: string,
  votes: string[]
): AcceptResult | null {
  const round = roundById(roundId);
  if (!round || round.status === "closed") return null;
  const now = () => new Date().toISOString();
  const queued = (currentPokerLog()?.queue ?? []).some((q) => q.sessionStoryId === story.id);
  if (queued) {
    const { item, written } = writeBackPokerEstimate({
      sessionStoryId: story.id,
      value,
      scaleType: round.scaleType,
      votes,
    });
    saveRound(withStoryEstimate(round, story.id, value, now()));
    return { via: "queue", written, title: item?.title ?? story.title };
  }

  const { upsertStory, removeStory } = useWorkspaceStore.getState();
  const plan = planBacklogSave(
    [{ id: story.id, title: story.title, finalEstimate: value }],
    useWorkspaceStore.getState().stories
  );
  const stamps = new Map<string, string | undefined>();
  undoable({
    label: `Agreed ${value} for “${shortTitle(story.title)}”`,
    description:
      plan.create.length > 0
        ? "Saved to the backlog."
        : plan.update.length > 0
          ? "Its backlog story got the points."
          : undefined,
    apply: () => {
      for (const st of plan.create) upsertStory(st);
      for (const { after } of plan.update) upsertStory(after);
      const saved = useWorkspaceStore.getState().stories;
      for (const { before } of plan.update) {
        stamps.set(before.id, saved.find((x) => x.id === before.id)?.refinedAt);
      }
      const current = roundById(roundId);
      if (current) saveRound(withStoryEstimate(current, story.id, value, now()));
    },
    revert: () => {
      const stories = useWorkspaceStore.getState().stories;
      for (const st of plan.create) if (stories.some((x) => x.id === st.id)) removeStory(st.id);
      for (const { before } of plan.update) {
        const cur = stories.find((x) => x.id === before.id);
        if (!cur) continue;
        const restored: Story = { ...cur, points: before.points };
        if (before.points === undefined) delete restored.points;
        upsertStory(withRefinedPutBack(restored, stamps.get(before.id), before.refinedAt));
      }
      const current = roundById(roundId);
      if (current) saveRound(withStoryEstimate(current, story.id, undefined, now()));
    },
  });
  return { via: "backlog", created: plan.create.length > 0 };
}
