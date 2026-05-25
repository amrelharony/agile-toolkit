/**
 * Pure merge primitives for Planning Poker realtime sync.
 *
 * Extracted from the hook so they can be unit-tested without pulling in
 * React, useRoom, or jsdom-only contexts. The hook in `use-poker-session.ts`
 * is a thin wrapper that wires presence + broadcasts to these functions.
 */

import type { Session, Participant } from "./types";

export const REDACTED_VOTE = "•";

export interface PresenceLike {
  id: string;
  joinedAt: string;
  name: string;
}

export function clampVote(vote: string | null, scale: Set<string>): string | null {
  if (vote === null) return null;
  if (vote === REDACTED_VOTE) return REDACTED_VOTE;
  if (scale.has(vote)) return vote;
  return null;
}

export function preserveHostOnlyFields(prev: Session, next: Session): Session {
  return {
    ...next,
    stories: prev.stories,
    revealed: prev.revealed,
    currentStoryIdx: prev.currentStoryIdx,
    hostId: prev.hostId,
    host: prev.host,
    scale: prev.scale,
    scaleType: prev.scaleType,
    sessionName: prev.sessionName,
    roomCode: prev.roomCode,
  };
}

export function clampCurrentStoryIdx(s: Session): Session {
  if (s.stories.length === 0) {
    return s.currentStoryIdx === 0 ? s : { ...s, currentStoryIdx: 0 };
  }
  if (s.currentStoryIdx < 0 || s.currentStoryIdx >= s.stories.length) {
    return { ...s, currentStoryIdx: 0 };
  }
  return s;
}

/**
 * Pre-reveal vote-leak defence (H7).
 *
 * Map every participant's non-null vote to `REDACTED_VOTE` in the
 * broadcast payload, EXCEPT the sender's own row — the sender's vote
 * has to traverse the wire for the host to learn it. Other peers' votes
 * carried by the snapshot (notably in the host's heartbeat) are
 * redacted, so the 5 s repeating heartbeat doesn't leak everyone.
 */
export function redactVotesForBroadcast(s: Session, senderId: string): Session {
  if (s.revealed) return s;
  if (!s.participants.some((p) => p.id !== senderId && p.vote !== null && p.vote !== REDACTED_VOTE))
    return s;
  return {
    ...s,
    participants: s.participants.map((p) =>
      p.id === senderId || p.vote === null ? p : { ...p, vote: REDACTED_VOTE }
    ),
  };
}

export interface MergeInputs {
  prev: Session | null;
  next: Session;
  envBy: string | null;
  trustedHostId: string | null;
  presentMemberIds: Set<string>;
  receiverId: string;
  /** Used during host migration: the locally-elected new host id (only
   *  set when the original host has been absent for >10s). The merge
   *  will accept hostId changes from this peer. */
  electedHostId?: string | null;
}

/**
 * Pure merge for incoming `poker:state` payloads.
 *
 * Trust model:
 *   - With no `prev`, only the snapshot whose `by` matches its own claimed
 *     `hostId` AND is present in members can bootstrap local state.
 *   - With `prev`, only the trusted hostId (= `trustedHostId`, or the
 *     elected migration target) can mutate host-only fields. Other peers
 *     are bounded to their own participant row.
 *   - Votes outside the locally-known scale are dropped to null.
 *   - The redacted sentinel `"•"` is preserved (pre-reveal heartbeats).
 *     The receiver's own row keeps its locally-known real vote when the
 *     incoming says `"•"` — heartbeat redactions never wipe own vote UI.
 */
export function mergePokerState(inp: MergeInputs): Session | null {
  const { prev, next, envBy, trustedHostId, presentMemberIds, receiverId, electedHostId } = inp;

  if (!prev) {
    if (typeof envBy !== "string" || envBy.length === 0) return null;
    if (envBy !== next.hostId) return null;
    if (!presentMemberIds.has(envBy)) return null;
    const scaleSet = new Set(next.scale);
    return clampCurrentStoryIdx({
      ...next,
      participants: next.participants.map((p) => ({ ...p, vote: clampVote(p.vote, scaleSet) })),
    });
  }

  const trusted = trustedHostId ?? prev.hostId;
  const elected = electedHostId ?? null;
  const senderTrusted =
    typeof envBy === "string" &&
    envBy.length > 0 &&
    presentMemberIds.has(envBy) &&
    (envBy === trusted || (elected !== null && envBy === elected));

  if (senderTrusted) {
    const scaleSet = new Set(next.scale);
    const localOwn = prev.participants.find((p) => p.id === receiverId)?.vote ?? null;
    const participants = next.participants.map((p) => {
      let vote = clampVote(p.vote, scaleSet);
      if (
        p.id === receiverId &&
        vote === REDACTED_VOTE &&
        localOwn !== null &&
        localOwn !== REDACTED_VOTE
      ) {
        vote = localOwn;
      }
      return { ...p, vote };
    });
    return clampCurrentStoryIdx({ ...next, participants });
  }

  if (typeof envBy !== "string" || envBy.length === 0) return prev;
  if (!presentMemberIds.has(envBy)) return prev;
  if (envBy === receiverId) return prev;
  const scaleSet = new Set(prev.scale);
  const ours = new Map<string, Participant>(prev.participants.map((p) => [p.id, p]));
  for (const p of next.participants) {
    if (p.id !== envBy) continue;
    ours.set(p.id, { ...p, vote: clampVote(p.vote, scaleSet) });
  }
  return { ...prev, participants: Array.from(ours.values()) };
}

export function electNewHost<T extends PresenceLike>(
  members: T[],
  missingHostId: string
): T | null {
  const candidates = members.filter((m) => m.id !== missingHostId);
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, m) => (m.joinedAt < earliest.joinedAt ? m : earliest));
}
