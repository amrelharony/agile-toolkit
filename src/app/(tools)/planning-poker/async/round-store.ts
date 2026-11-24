/**
 * The small part of the host's rounds without a meeting that the Poker page
 * itself needs, before the rest of the feature loads: read and save a round
 * through the workspace store, and agree a typed story's estimate (saved to
 * the backlog, with Undo).
 *
 * Light on purpose: it reaches only the store, the backlog planner and
 * lib/estimation/async-rounds, never the codes in lib/estimation/async-pack.
 * ./round-actions re-exports it.
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
import { readAsyncRound, readAsyncRounds, withStoryEstimate } from "@/lib/estimation/async-rounds";
import { planBacklogSave } from "../backlog";

export const TOO_BIG = "This round is too big to save. Close an older round first.";

/** The round with this id as every reader shows it, if this browser has it (and can read it). */
export function roundById(id: string): PokerAsyncRound | undefined {
  const round = readAsyncRounds(useWorkspaceStore.getState().pokerAsyncRounds).find(
    (r) => r.id === id
  );
  return round ? readAsyncRound(round) : undefined;
}

/** Save `round`, unless it has grown past a row's limit (then the sentence why). */
export function saveRound(round: PokerAsyncRound): string | null {
  if (jsonBytes(round) > ENTITY_ROW_MAX_BYTES) return TOO_BIG;
  useWorkspaceStore.getState().upsertPokerAsyncRound(round);
  return null;
}

/** A name short enough for a one-line label. */
export function shortTitle(title: string, max = 40): string {
  const t = title.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The host agreed `value` for a typed story of round `roundId` (one that
 * didn't come from the queue): it is saved to the backlog with its points
 * (Planning Poker's own Save to backlog, keyed by the story's id, so saving
 * it again, or the live session's Save to backlog, never makes a duplicate),
 * and the round keeps the agreed card. One Undo takes both back. Accept on
 * the round and an estimate accepted in the live session "Talk about it
 * live" opened both come here.
 */
export function agreeTypedStory(
  roundId: string,
  story: Pick<PokerAsyncStory, "id" | "title">,
  value: string
): { created: boolean } {
  const now = () => new Date().toISOString();
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
  return { created: plan.create.length > 0 };
}
