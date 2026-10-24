/**
 * Fair turns in a round-robin segment (the Daily Scrum's round of the team):
 * how long the speaker who's up has, and what everyone after them gets.
 *
 * The segment's time isn't cut into fixed slots up front. Each speaker gets
 * an even share of what is left when their turn begins, so someone who
 * finishes early gives the rest more and someone who runs over shortens the
 * rest, never below MIN_TURN_SECONDS. Pure: times in, shares out.
 */

/** A speaker in the order. Names are unique (any case); the id marks example rows. */
export interface Participant {
  id: string;
  name: string;
}

/** A finished turn, as a run records it. */
export interface Turn {
  speakerId: string;
  /** The name at the time, so a speaker removed later still reads right. */
  name: string;
  /** Active (unpaused) milliseconds the turn took. */
  spentMs: number;
  /** The share they had when the turn began, in seconds. */
  shareSeconds: number;
  /** Passed over (absent, nothing to say); what they spent still counts. */
  skipped: boolean;
}

/** Nobody's turn is cut below half a minute, however far the round has run over. */
export const MIN_TURN_SECONDS = 30;

/**
 * The share of the next turn: what's left of `budgetSeconds` after
 * `usedSeconds`, split evenly over the `speakersLeft` still to speak (the
 * one starting included), in whole seconds and never below the floor.
 */
export function turnShare(
  budgetSeconds: number,
  usedSeconds: number,
  speakersLeft: number
): number {
  if (!(speakersLeft > 0)) return 0;
  const left = Math.max(0, budgetSeconds - usedSeconds);
  return Math.max(MIN_TURN_SECONDS, Math.floor(left / speakersLeft));
}

export type SlotStatus = "done" | "skipped" | "current" | "next";

export interface SpeakerSlot {
  id: string;
  name: string;
  status: SlotStatus;
  /** The share they had (done, skipped), have (current) or would get now (next). */
  shareSeconds: number;
  /** Seconds spoken so far; 0 for those still waiting. */
  spentSeconds: number;
}

export interface SpeakerPlan {
  /** Finished turns first, then the current speaker, then everyone waiting. */
  slots: SpeakerSlot[];
  /** The speaker who's up, if anyone is left. */
  current: SpeakerSlot | null;
  /** The current speaker's seconds past their share (0 while within it). */
  overtimeSeconds: number;
  /** What each waiting speaker gets if the current one stops now or at their share. */
  nextShareSeconds: number;
  /** Everyone in the order has had (or skipped) a turn. */
  everyoneSpoke: boolean;
  /** The round needs more than the segment has, even at the floor. */
  overbooked: boolean;
}

/**
 * The turns of one round-robin segment right now.
 *
 * `order` is the speaking order as it stands (people can be added during
 * the round; they join at the end); `turns` are the finished ones. The
 * current speaker is the first in the order without a turn. Waiting
 * speakers' share assumes the current one takes at least their own share,
 * so it shrinks live while the current speaker runs over.
 *
 * `usedSeconds` is the budget already gone when the current turn began.
 * It is at least the finished turns, and more when the segment ran before
 * turn-taking began or a speaker left mid-turn: sharing the whole segment
 * then would promise the waiting speakers time that is already spent.
 */
export function speakerPlan(
  budgetSeconds: number,
  order: readonly Participant[],
  turns: readonly Turn[],
  currentSpentSeconds: number,
  usedSeconds = 0
): SpeakerPlan {
  const spoken = new Set(turns.map((t) => t.speakerId));
  const waiting = order.filter((p) => !spoken.has(p.id));
  const turnsUsed = turns.reduce((sum, t) => sum + Math.max(0, t.spentMs), 0) / 1000;
  const used = Math.max(turnsUsed, Number.isFinite(usedSeconds) ? usedSeconds : 0);

  const slots: SpeakerSlot[] = turns.map((t) => ({
    id: t.speakerId,
    name: t.name,
    status: t.skipped ? "skipped" : "done",
    shareSeconds: t.shareSeconds,
    spentSeconds: Math.round(Math.max(0, t.spentMs) / 1000),
  }));

  const [up, ...after] = waiting;
  let current: SpeakerSlot | null = null;
  let nextShareSeconds = 0;
  let overtimeSeconds = 0;
  if (up) {
    const share = turnShare(budgetSeconds, used, waiting.length);
    const spent = Math.max(0, Math.floor(currentSpentSeconds));
    current = {
      id: up.id,
      name: up.name,
      status: "current",
      shareSeconds: share,
      spentSeconds: spent,
    };
    overtimeSeconds = Math.max(0, spent - share);
    nextShareSeconds = turnShare(budgetSeconds, used + Math.max(share, spent), after.length);
    slots.push(
      current,
      ...after.map((p) => ({
        id: p.id,
        name: p.name,
        status: "next" as const,
        shareSeconds: nextShareSeconds,
        spentSeconds: 0,
      }))
    );
  }

  return {
    slots,
    current,
    overtimeSeconds,
    nextShareSeconds,
    everyoneSpoke: order.length > 0 && waiting.length === 0,
    overbooked: waiting.length * MIN_TURN_SECONDS > Math.max(0, budgetSeconds - used),
  };
}

/**
 * The speaking order before the round starts: an even share each (the last
 * speaker also gets the seconds that don't divide), from `offsetSeconds`
 * into the meeting. For the agenda in the Markdown export.
 */
export function plannedSlots(
  budgetSeconds: number,
  order: readonly Participant[],
  offsetSeconds = 0
): { participant: Participant; startSeconds: number; seconds: number }[] {
  const n = order.length;
  if (n === 0) return [];
  const per = Math.floor(budgetSeconds / n);
  return order.map((participant, i) => ({
    participant,
    startSeconds: offsetSeconds + i * per,
    seconds: i === n - 1 ? budgetSeconds - i * per : per,
  }));
}
