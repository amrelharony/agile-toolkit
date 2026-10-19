/**
 * Host migration for realtime rooms with one authoritative host (Planning
 * Poker today, the visitor Retro room next).
 *
 * When the trusted host drops out of presence for longer than
 * `HOST_MIGRATION_DELAY_MS`, every remaining peer runs `electNewHost` on
 * its own copy of the member list. The pick is deterministic, so they all
 * agree without exchanging messages.
 *
 * `joinedAt` is self-declared by each member, so a member can rig the
 * election by claiming an early time. Rooms accept that: anyone holding
 * the link can already impersonate the host to other participants.
 */

/** How long the host must be missing before anyone takes over. */
export const HOST_MIGRATION_DELAY_MS = 10_000;

export interface ElectionCandidate {
  id: string;
  /** ISO-8601 time the member says it joined. Compared as a string. */
  joinedAt: string;
}

/**
 * The member who takes over from `missingHostId`: the earliest `joinedAt`,
 * with the smaller id winning an exact tie so every peer picks the same
 * one whatever order its member list is in. Null when nobody else is left.
 */
export function electNewHost<T extends ElectionCandidate>(
  members: readonly T[],
  missingHostId: string
): T | null {
  let best: T | null = null;
  for (const m of members) {
    if (m.id === missingHostId) continue;
    if (
      best === null ||
      m.joinedAt < best.joinedAt ||
      (m.joinedAt === best.joinedAt && m.id < best.id)
    ) {
      best = m;
    }
  }
  return best;
}

/**
 * Whether a host first seen missing at `missingSince` (epoch ms, null while
 * present) has been gone long enough to elect a replacement at `now`.
 */
export function hostMissingLongEnough(
  missingSince: number | null,
  now: number,
  delayMs: number = HOST_MIGRATION_DELAY_MS
): boolean {
  return missingSince !== null && now - missingSince >= delayMs;
}
