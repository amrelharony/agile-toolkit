/**
 * Facilitator mode for a LOCAL Planning Poker session.
 *
 * Most teams estimate on one shared screen: a visitor can't open a live
 * room, so the facilitator runs the vote for everyone. The people they add
 * are ordinary participants with no device of their own, and the vote the
 * facilitator records for each of them sits in that participant's `vote`
 * field, exactly where a live room keeps a guest's vote. The session
 * screen keeps it face down until Reveal, the local session stores it like
 * any other field, and `isValidSession` needs nothing new to accept it.
 *
 * Never used for a live room: a guest there votes from their own device.
 */

import type { Participant, Session } from "./types";

/** `isValidSession`'s caps: a session over them would fail to restore. */
export const MAX_PARTICIPANTS = 100;
export const MAX_NAME_LENGTH = 80;

/** Matches names across the roster and the table: trimmed, case-insensitive. */
export function playerKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A name as it's stored: one line, single spaces, within the validator's cap. */
export function cleanPlayerName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH).trim();
}

function newPlayerId(): string {
  return `player-${crypto.randomUUID()}`;
}

/**
 * `session` with a seat for each new name. Blank names, names already at
 * the table and anything past the participant cap are skipped, so adding
 * the whole roster twice is a no-op.
 */
export function addPlayers(
  session: Session,
  names: readonly string[],
  makeId: () => string = newPlayerId
): { session: Session; added: Participant[] } {
  const taken = new Set(session.participants.map((p) => playerKey(p.name)));
  const added: Participant[] = [];
  for (const raw of names) {
    if (session.participants.length + added.length >= MAX_PARTICIPANTS) break;
    const name = cleanPlayerName(raw);
    const key = playerKey(name);
    if (!name || taken.has(key)) continue;
    taken.add(key);
    added.push({ id: makeId(), name, vote: null });
  }
  if (added.length === 0) return { session, added };
  return { session: { ...session, participants: [...session.participants, ...added] }, added };
}

/**
 * `session` with these players seated, as `addPlayers` worked them out
 * against an earlier copy of it: anyone whose name is now taken, or who
 * would go past the cap, is left out.
 */
export function seatPlayers(session: Session, players: readonly Participant[]): Session {
  const taken = new Set(session.participants.map((p) => playerKey(p.name)));
  const ids = new Set(session.participants.map((p) => p.id));
  const seated: Participant[] = [];
  for (const p of players) {
    if (session.participants.length + seated.length >= MAX_PARTICIPANTS) break;
    const key = playerKey(p.name);
    if (!p.name || taken.has(key) || ids.has(p.id)) continue;
    taken.add(key);
    ids.add(p.id);
    seated.push(p);
  }
  if (seated.length === 0) return session;
  return { ...session, participants: [...session.participants, ...seated] };
}

/** `session` without the player `id`. The facilitator's own seat stays. */
export function removePlayer(session: Session, id: string): Session {
  if (id === session.hostId || !session.participants.some((p) => p.id === id)) return session;
  return { ...session, participants: session.participants.filter((p) => p.id !== id) };
}

/** `session` with `player` back at `index`, unless they're already seated. */
export function restorePlayer(session: Session, player: Participant, index: number): Session {
  if (session.participants.some((p) => p.id === player.id)) return session;
  if (session.participants.length >= MAX_PARTICIPANTS) return session;
  const participants = [...session.participants];
  participants.splice(Math.min(Math.max(index, 0), participants.length), 0, player);
  return { ...session, participants };
}

/**
 * Record `value` as `id`'s face-down vote. Picking always sets, never
 * toggles: a toggle would tell the room which card the player had played.
 * Ignored once the votes are revealed, or for a card that isn't on the
 * scale.
 */
export function voteFor(session: Session, id: string, value: string): Session {
  if (session.revealed || !session.scale.includes(value)) return session;
  if (!session.participants.some((p) => p.id === id)) return session;
  return {
    ...session,
    participants: session.participants.map((p) => (p.id === id ? { ...p, vote: value } : p)),
  };
}

/**
 * Who votes next when the screen is passed round: the first person after
 * `afterId` who hasn't voted, wrapping to the start. `afterId` comes last,
 * so a skipped player goes to the back of the line. Null once everyone
 * has voted.
 */
export function nextVoter(
  participants: readonly Participant[],
  afterId: string | null
): Participant | null {
  const start = afterId === null ? 0 : participants.findIndex((p) => p.id === afterId) + 1;
  const ordered = [...participants.slice(start), ...participants.slice(0, start)];
  return ordered.find((p) => p.vote === null) ?? null;
}

/** Everyone at the table has a card down (and there's more than one person). */
export function allVotesIn(session: Session): boolean {
  return (
    !session.revealed &&
    session.participants.length > 1 &&
    session.participants.every((p) => p.vote !== null)
  );
}
