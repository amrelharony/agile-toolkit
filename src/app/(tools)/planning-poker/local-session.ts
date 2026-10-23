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
    window.localStorage.removeItem(QUEUED_IDS_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Which of the stored session's stories came from the queue. They aren't
 * saved to the backlog (their estimate goes back to their source), and
 * once one is estimated the queue no longer lists it, so the session keeps
 * its own note. Kept beside the session rather than in it: the session is
 * the room's payload, and its shape is shared with every guest's build.
 */
export const QUEUED_IDS_KEY = "agile-toolkit:planning-poker:queued-story-ids";

/** More ids than a session holds stories is corrupt. */
const MAX_QUEUED_IDS = 500;

export function loadQueuedStoryIds(): string[] {
  try {
    const raw = window.localStorage.getItem(QUEUED_IDS_KEY);
    if (!raw || raw.length > 64 * MAX_QUEUED_IDS) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64)
      .slice(0, MAX_QUEUED_IDS);
  } catch {
    return [];
  }
}

export function saveQueuedStoryIds(ids: readonly string[]): void {
  try {
    if (ids.length === 0) window.localStorage.removeItem(QUEUED_IDS_KEY);
    else window.localStorage.setItem(QUEUED_IDS_KEY, JSON.stringify(ids.slice(0, MAX_QUEUED_IDS)));
  } catch {
    /* storage full or unavailable — the note lives in memory */
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
