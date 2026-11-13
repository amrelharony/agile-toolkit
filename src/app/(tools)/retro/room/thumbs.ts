/**
 * Retro visitor room, revision 2: the Lean Coffee thumbs vote. When a
 * topic's timebox runs out the host asks "keep going or move on?", each
 * member puts a thumb up or down, and the host closes the vote to show the
 * totals.
 *
 * The poll lives in the host's memory only, like the intent ledger, and no
 * message the host sends says who voted what. The room's snapshot carries
 * `toRoomPoll`: while the vote is open, how many have voted; once closed,
 * the totals too, frozen from then on (a member who leaves after the close
 * keeps their thumb in the totals, or the change would show how they voted).
 *
 * Not anonymous on the wire: like a card's vote, a thumb is a `thumb`
 * intent broadcast on the room's channel with the sender's member id in
 * clear, and every peer receives every intent. The app never shows it, but
 * a participant's tab with devtools open could pair a thumb with a name.
 * The vote kit (lib/realtime/vote-room) seals ballots to the host's key;
 * this room has no host key to seal to (an accepted risk for a low-stakes
 * keep-going question, the same as the board's dot votes).
 *
 * A first thumb comes with a lock (the SHA-256 of a key only the voter's
 * tab holds); changing it needs that key, and brings a new lock. `by` is
 * self-declared, so the key is what stops one member changing another's
 * thumb. Pure: `applyThumb` returns the next poll and never mutates.
 */

import { cleanText } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import {
  MAX_POLL_TOPIC_CHARS,
  isIntentId,
  lockOf,
  type IntentEnv,
  type RoomPoll,
  type ThumbChoice,
} from "./protocol";

/** The host's poll, in memory. */
export interface ThumbPoll {
  id: string;
  topic: string;
  open: boolean;
  /** Member id → their thumb and the lock it was cast with. */
  votes: Record<string, { choice: ThumbChoice; lock: string }>;
}

export type ThumbRejection =
  | "bad-shape"
  | "no-poll"
  | "closed"
  | "removed"
  | "not-admitted"
  | "not-yours";

export type ThumbResult = { ok: true; poll: ThumbPoll } | { ok: false; reason: ThumbRejection };

export interface ThumbContext {
  admitted: ReadonlySet<string>;
  removed: ReadonlySet<string>;
  /** The host's own thumb (a promoted host): no key asked for. */
  local?: boolean;
}

/** A new, open poll on `topic`. */
export function openThumbPoll(id: string, topic: string): ThumbPoll {
  return {
    id,
    topic: cleanText(topic, MAX_POLL_TOPIC_CHARS) ?? "This topic",
    open: true,
    votes: {},
  };
}

/** The poll closed: no more thumbs, and the totals go to the room. */
export function closeThumbPoll(poll: ThumbPoll): ThumbPoll {
  return poll.open ? { ...poll, open: false } : poll;
}

const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/**
 * Apply a thumb: the poll must exist, match the intent's poll id and be
 * open; the sender must hold a seat and not be removed; a change must
 * carry the key behind the sender's earlier lock.
 */
export function applyThumb(poll: ThumbPoll | null, env: IntentEnv, ctx: ThumbContext): ThumbResult {
  const intent = env.intent;
  if (intent.t !== "thumb") return { ok: false, reason: "bad-shape" };
  if (!poll || poll.id !== intent.pollId) return { ok: false, reason: "no-poll" };
  if (!poll.open) return { ok: false, reason: "closed" };
  if (ctx.removed.has(env.by)) return { ok: false, reason: "removed" };
  if (!ctx.admitted.has(env.by)) return { ok: false, reason: "not-admitted" };
  const before = has(poll.votes, env.by) ? poll.votes[env.by] : undefined;
  if (before && !ctx.local) {
    if (!intent.key || lockOf(intent.key) !== before.lock)
      return { ok: false, reason: "not-yours" };
  }
  // Built from entries, so any member id is an own key.
  const votes = Object.fromEntries([
    ...Object.entries(poll.votes).filter(([id]) => id !== env.by),
    [env.by, { choice: intent.choice, lock: intent.lock }],
  ]);
  return { ok: true, poll: { ...poll, votes } };
}

/**
 * The open poll without the votes of members who left or were removed. A
 * closed poll is returned as it is: its totals were shown to the room, and
 * recounting them as someone leaves would show the room that member's thumb.
 */
export function withoutVoters(poll: ThumbPoll, gone: (id: string) => boolean): ThumbPoll {
  if (!poll.open) return poll;
  const entries = Object.entries(poll.votes);
  const kept = entries.filter(([id]) => !gone(id));
  return kept.length === entries.length ? poll : { ...poll, votes: Object.fromEntries(kept) };
}

export interface ThumbTally {
  keep: number;
  move: number;
  voters: number;
}

export function thumbTally(poll: Pick<ThumbPoll, "votes">): ThumbTally {
  let keep = 0;
  let move = 0;
  for (const v of Object.values(poll.votes)) {
    if (v.choice === "keep") keep++;
    else move++;
  }
  return { keep, move, voters: keep + move };
}

/** The poll as the snapshot carries it: totals only once it's closed. */
export function toRoomPoll(poll: ThumbPoll): RoomPoll {
  const t = thumbTally(poll);
  const voters = Math.min(t.voters, VISITOR_LIMITS.maxMembers);
  return poll.open
    ? { id: poll.id, topic: poll.topic, open: true, voters }
    : {
        id: poll.id,
        topic: poll.topic,
        open: false,
        voters,
        keep: Math.min(t.keep, voters),
        move: Math.min(t.move, voters),
      };
}

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= VISITOR_LIMITS.maxMembers;

/**
 * A snapshot's poll, rebuilt from known fields, or null when it's malformed:
 * an id shaped like an intent id, clean topic text, a voter count within
 * the room, and totals only on a closed poll, adding up to the voters.
 */
export function readRoomPoll(raw: unknown): RoomPoll | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (!isIntentId(p.id) || typeof p.open !== "boolean") return null;
  if (typeof p.topic !== "string" || p.topic.length === 0) return null;
  if (cleanText(p.topic, MAX_POLL_TOPIC_CHARS) !== p.topic) return null;
  if (!isCount(p.voters)) return null;
  if (p.open) {
    if (p.keep !== undefined || p.move !== undefined) return null;
    return { id: p.id, topic: p.topic, open: true, voters: p.voters };
  }
  if (!isCount(p.keep) || !isCount(p.move) || p.keep + p.move !== p.voters) return null;
  return { id: p.id, topic: p.topic, open: false, voters: p.voters, keep: p.keep, move: p.move };
}
