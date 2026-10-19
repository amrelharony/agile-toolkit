/**
 * Browser persistence for LOCAL-ONLY Planning Poker sessions.
 *
 * A session nobody else can join (a visitor's, or the owner's when
 * Realtime isn't configured) otherwise lives only in React state, so a
 * refresh or a click to another tool threw away every story and
 * estimate. Live realtime rooms are never stored here: the room is
 * their source of truth and restoring one would re-open a channel.
 *
 * Every storage access is wrapped — private windows, blocked site data
 * and a full quota all throw, and none of them may break the tool.
 */

import { isValidSession, type Session } from "./types";

export const LOCAL_SESSION_KEY = "agile-toolkit:planning-poker:session";

// A valid session tops out well under this (500 stories × 5 KB
// descriptions is the validator's ceiling); anything larger is corrupt
// and not worth handing to JSON.parse.
const MAX_STORED_CHARS = 4_000_000;

export function loadLocalSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw || raw.length > MAX_STORED_CHARS) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocalSession(session: Session): void {
  try {
    window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage full or unavailable — the session still runs in memory */
  }
}

export function clearLocalSession(): void {
  try {
    window.localStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Re-key a restored session to the current browser identity. The host's
 * participant id comes from the `agile-toolkit:user` slot; if that was
 * reset since the session was saved, the old id would leave the host
 * without a voting deck.
 */
export function adoptLocalSession(stored: Session, userId: string): Session {
  if (stored.hostId === userId) return stored;
  return {
    ...stored,
    hostId: userId,
    participants: stored.participants.map((p) =>
      p.id === stored.hostId ? { ...p, id: userId } : p
    ),
  };
}
