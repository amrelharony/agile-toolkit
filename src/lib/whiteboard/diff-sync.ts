/**
 * Diff-based realtime sync for whiteboard objects.
 *
 * The existing `use-room` ships a full-state-broadcast pattern that
 * collapses for a board of 100+ objects (every move = 100 objects on
 * the wire). This module instead broadcasts only the changed objects
 * and uses a monotonic `version` field per object for last-write-wins
 * conflict resolution.
 *
 * Protocol — three broadcast event kinds on the room channel:
 *
 *   1. `whiteboard:patch`       — payload `{ added, updated, removed, by }`
 *                                 sent on every local mutation.
 *   2. `whiteboard:heartbeat`   — payload `{ versions: {id: ver} }` every
 *                                 ~10s for drift recovery. Receivers find
 *                                 IDs they're missing or stale on and
 *                                 request them via `whiteboard:request`.
 *   3. `whiteboard:request`     — payload `{ ids: string[] }`. Any peer
 *                                 that has those IDs answers with a patch.
 *
 * Conflict resolution is dead-simple LWW: keep the object with the
 * higher `version`. Concurrent edits to different objects merge cleanly;
 * concurrent edits to the *same* object resolve to whichever client wrote
 * last (the version field is bumped by the writer before broadcasting).
 */

import type { WhiteboardObject } from "@/lib/stores/workspace-types";

export interface WhiteboardPatch {
  /** Objects fully replaced (new objects use the same array). */
  upserted: WhiteboardObject[];
  /** Object IDs deleted by the sender. */
  removed: string[];
  /** Sender user ID — used to ignore our own echoed patches. */
  by: string;
  /** ISO timestamp — used for heartbeats / drift detection. */
  at: string;
}

export interface WhiteboardHeartbeat {
  /** Map from object ID → current version. Receivers detect drift. */
  versions: Record<string, number>;
  by: string;
  at: string;
}

export interface WhiteboardRequest {
  ids: string[];
  by: string;
}

/**
 * Compute a patch from a previous-snapshot view to a current snapshot.
 * Used by the local-change emitter to figure out what to broadcast.
 */
export function computePatch(
  prev: readonly WhiteboardObject[],
  next: readonly WhiteboardObject[],
  by: string,
): WhiteboardPatch {
  const prevById = new Map(prev.map((o) => [o.id, o]));
  const nextById = new Map(next.map((o) => [o.id, o]));
  const upserted: WhiteboardObject[] = [];
  const removed: string[] = [];
  for (const o of next) {
    const before = prevById.get(o.id);
    if (!before || before.version !== o.version) upserted.push(o);
  }
  for (const id of Array.from(prevById.keys())) {
    if (!nextById.has(id)) removed.push(id);
  }
  return { upserted, removed, by, at: new Date().toISOString() };
}

/**
 * Stateful Differ — keeps a long-lived `prevById` Map across calls so
 * we don't rebuild it from the full local array on every patch.
 *
 * R10-deferred: the previous `computePatch(prev, next, by)` rebuilt
 * BOTH maps from scratch on every call. At 60fps drag broadcasts
 * over a 1000-object board, that's ~120k Map allocations per second
 * just to compute the diff. The stateful differ amortises this:
 * after the first call (initial baseline), each subsequent call
 * iterates only `next` and the running prev map, then mutates the
 * stored map to the new baseline.
 *
 * Usage in use-canvas-room.ts:
 *
 *   const differRef = useRef(createDiffer());
 *   const patch = differRef.current.diff(currentObjects, userId);
 *   if (!patch.empty) broadcast(patch.value);
 *
 * The first call sees an empty prev → everything is "upserted" once;
 * subsequent calls send only deltas.
 */
export interface Differ {
  /**
   * Compute the patch from the last-seen state to `next`. Returns
   * `{ empty: true }` when nothing changed (avoids broadcasting a no-op
   * patch that just stamps `at` and `by`). Otherwise advances the
   * internal baseline to `next` automatically.
   */
  diff(next: readonly WhiteboardObject[], by: string): { empty: true } | { empty: false; value: WhiteboardPatch };
  /** Reset the baseline — call on boardId change so the new board's
   *  initial state isn't diffed against the old board's. */
  reset(initial?: readonly WhiteboardObject[]): void;
  /** Read-only view for debugging / heartbeat sampling. */
  size(): number;
}

export function createDiffer(initial: readonly WhiteboardObject[] = []): Differ {
  const prevById = new Map(initial.map((o) => [o.id, o]));
  return {
    diff(next, by) {
      const upserted: WhiteboardObject[] = [];
      const removed: string[] = [];
      const nextIds = new Set<string>();
      for (const o of next) {
        nextIds.add(o.id);
        const before = prevById.get(o.id);
        if (!before || before.version !== o.version) upserted.push(o);
      }
      // Find removed by walking prevById (smaller-side iteration; with
      // mostly-stable IDs `prevById.size` ~= `next.length`, so this is
      // O(N) in board size but O(mutations) per call after the first).
      // Use forEach for older lib-es targets that don't support
      // iterator-spread without downlevelIteration.
      prevById.forEach((_v, id) => {
        if (!nextIds.has(id)) removed.push(id);
      });
      if (upserted.length === 0 && removed.length === 0) return { empty: true };
      // R11-fix: advance the baseline INCREMENTALLY instead of rebuilding
      // the entire Map. The previous `new Map(next.map(...))` was O(N) on
      // every call — defeating the differ's promise of O(mutations).
      // Now: only touch the slots that actually changed. Shallow-copy
      // upserted objects so a downstream in-place mutation of `next`
      // cannot corrupt our baseline (defensive against callers that
      // bend the immutable contract).
      for (const o of upserted) prevById.set(o.id, { ...o });
      for (const id of removed) prevById.delete(id);
      return { empty: false, value: { upserted, removed, by, at: new Date().toISOString() } };
    },
    reset(initial) {
      prevById.clear();
      if (initial) for (const o of initial) prevById.set(o.id, { ...o });
    },
    size() {
      return prevById.size;
    },
  };
}

/**
 * Apply an incoming patch against a current local list. Returns the merged
 * list. Objects with an older or equal version than the local copy are
 * discarded — LWW.
 *
 * Special-case for Voting objects: the `votes` map is keyed by voter id,
 * and each voter can only legitimately write their own slot. We
 * therefore:
 *   - Restrict incoming.votes writes to the key `patch.by` (so peer A
 *     cannot retroactively change peer B's vote — C13 in the audit).
 *   - Merge per-key with VALUE comparison (not just key count), so a
 *     same-user revote at equal version is not silently dropped (C11).
 *   - Freeze the vote set once `revealed` is true on either side — late
 *     votes can't leak in after reveal (C12).
 *
 * Pure function, deterministic given the inputs.
 */
export function applyPatch(
  local: readonly WhiteboardObject[],
  patch: WhiteboardPatch,
): WhiteboardObject[] {
  const map = new Map(local.map((o) => [o.id, o]));
  // SECURITY: stamp the local copy of every accepted upsert with
  // `updatedBy = patch.by`. The peer can claim any string in their
  // payload (or omit the field — `updatedBy` is optional in the
  // validator), so the local record of "who last wrote this" must be
  // anchored to the carrier — not to the carrier's own claim, which
  // is unauthenticated until we have a server-side broker. Without
  // this stamping, a hostile peer can win an LWW race with
  // `{...payload, updatedBy: undefined}`, then send a follow-up
  // `removed` patch that the receiver accepts because
  // `existing.updatedBy === undefined` (the old fall-through). The
  // stamping closes that 2-step exploit and lets the removal check
  // below remain permissive enough for legitimate flows where
  // production code never sets `createdBy`.
  const stamp = (o: WhiteboardObject): WhiteboardObject => ({ ...o, updatedBy: patch.by });
  for (const incoming of patch.upserted) {
    const existing = map.get(incoming.id);
    if (!existing) {
      // First sight of this id. For voting, we still restrict incoming
      // votes to the sender's own slot — preserves the invariant
      // "you can only vote for yourself" even on first-write.
      if (incoming.type === "voting") {
        map.set(incoming.id, stamp(restrictVotesToSender(incoming, patch.by)));
      } else {
        map.set(incoming.id, stamp(incoming));
      }
      continue;
    }
    if (incoming.version > existing.version) {
      if (incoming.type === "voting" && existing.type === "voting") {
        map.set(incoming.id, stamp(mergeVoting(existing, incoming, patch.by)));
      } else {
        map.set(incoming.id, stamp(incoming));
      }
    } else if (incoming.version === existing.version) {
      // Tie-break: same-version concurrent edits. Without a
      // deterministic order, peer A and peer B that both bumped a
      // shared object from v=5 to v=6 would each keep their own
      // value forever — heartbeats agree they're both at v=6 so
      // drift recovery never fires. Use `(updatedBy, updatedAt, id)`
      // as a tie-breaker; both peers compute the same winner because
      // the comparison is symmetric.
      if (incoming.type === "voting" && existing.type === "voting") {
        const merged = mergeVoting(existing, incoming, patch.by);
        if (!sameVoting(existing, merged)) map.set(incoming.id, stamp(merged));
      } else if (sameVersionWinnerIsIncoming(existing, incoming)) {
        map.set(incoming.id, stamp(incoming));
      }
      // Otherwise keep existing — both sides reach the same conclusion.
    }
  }
  // patch.removed needs an ownership check. Without one, a hostile
  // peer can broadcast `{removed: ["every-id-they've-ever-seen"]}`
  // and wipe other users' work. We accept removals only if the
  // local object's `updatedBy` matches the patch sender (the user
  // is allowed to delete their own object) OR the local object's
  // `createdBy` matches the sender (creator can delete what they
  // made). For more restrictive auth, push the check to the
  // server-side broker.
  //
  // SECURITY: we deliberately do NOT accept a removal when
  // `existing.updatedBy === undefined`. An earlier version of this
  // code did, on the theory that "an object nobody has written to is
  // safe to delete". The hole: `updatedBy` is optional in the
  // validator, so a hostile peer can broadcast a 2-step exploit —
  // first an upsert with `updatedBy: undefined` (passes validation,
  // wins the LWW race if version > existing), then a removed patch
  // that the receiver accepts because `updatedBy` is now undefined
  // locally. Net effect: arbitrary object deletion. By requiring
  // explicit ownership we close this; objects that genuinely lack
  // `updatedBy` (legacy data, never edited) fall back to `createdBy`
  // which is set at creation.
  for (const id of patch.removed) {
    const existing = map.get(id);
    if (!existing) {
      // We don't have it locally — nothing to delete. Skip rather
      // than silently accept, so a heartbeat won't re-propagate the
      // stale tombstone.
      continue;
    }
    // Accept the removal if:
    //   - The sender is the last writer (they own it), OR
    //   - The object's `createdBy` matches the sender (creator can
    //     always delete their own creation).
    // NB: we do NOT accept on `existing.updatedBy === undefined` —
    // see the 2-step exploit description above.
    const canRemove =
      existing.updatedBy === patch.by ||
      existing.createdBy === patch.by;
    if (canRemove) {
      map.delete(id);
    }
    // Otherwise we silently ignore — the hostile peer doesn't get
    // confirmation, but the local object survives.
  }
  return Array.from(map.values());
}

/** Deterministic tie-break for same-version concurrent edits on
 * non-voting objects. Both peers run this and reach the same
 * conclusion, so the LWW-with-equal-version state converges.
 *
 * Order: most-recent `updatedAt` wins; on timestamp tie,
 * lexicographic `updatedBy` wins; on user tie, `id` wins (this case
 * is effectively impossible). */
function sameVersionWinnerIsIncoming(
  existing: WhiteboardObject,
  incoming: WhiteboardObject,
): boolean {
  const exAt = existing.updatedAt ?? existing.createdAt ?? "";
  const inAt = incoming.updatedAt ?? incoming.createdAt ?? "";
  if (exAt !== inAt) return inAt > exAt;
  const exBy = existing.updatedBy ?? existing.createdBy ?? "";
  const inBy = incoming.updatedBy ?? incoming.createdBy ?? "";
  if (exBy !== inBy) return inBy > exBy;
  return false; // identical metadata → keep existing
}

/** Build a new voting object that incorporates only the legitimate
 * incoming write — the sender's own slot — on top of the existing
 * vote map. Honours the "revealed" lockout. */
function mergeVoting(
  existing: WhiteboardObject & { type: "voting" },
  incoming: WhiteboardObject & { type: "voting" },
  sender: string,
): WhiteboardObject & { type: "voting" } {
  // Higher-version writer wins for non-vote fields (question,
  // options, revealed).
  const baseFromWinner = incoming.version >= existing.version ? incoming : existing;
  // If EITHER side is revealed, freeze votes to the revealed snapshot.
  // Use the snapshot from whichever side flipped to revealed (it's the
  // authoritative tally).
  if (existing.revealed && !incoming.revealed) {
    // Existing already revealed — late incoming patch cannot un-reveal
    // or add votes.
    return { ...existing };
  }
  if (incoming.revealed && !existing.revealed) {
    // Incoming reveal wins the reveal-flip. SECURITY: we cannot trust
    // the carrier's vote map verbatim — a hostile peer could mint a
    // higher-versioned `revealed=true` patch carrying forged victim
    // votes ({alice:"FORGED", carol:"FORGED"}) and the receiver would
    // otherwise commit those tallies to its local store. Instead:
    //   1. Start from `existing.votes` (the legitimate pre-reveal
    //      tally, which was filtered through restrictVotesToSender
    //      and the per-slot lock-down on each prior write).
    //   2. Layer in incoming votes ONLY for keys already known
    //      locally (so the revealer's late writes can update visible
    //      tallies if a slot legitimately changed) PLUS the sender's
    //      own slot (so the act of revealing can also commit the
    //      revealer's own final vote).
    //   3. Drop any other incoming vote keys — they're either votes
    //      the revealer hadn't seen yet (which will heartbeat in
    //      from the holding peer) or fabrications.
    const safeVotes: Record<string, string> = { ...existing.votes };
    for (const [voter, choice] of Object.entries(incoming.votes ?? {})) {
      const allowed = voter === sender || voter in existing.votes;
      if (allowed && typeof choice === "string") safeVotes[voter] = choice;
    }
    return { ...incoming, votes: safeVotes };
  }
  if (existing.revealed && incoming.revealed) {
    // Both revealed — votes already frozen. Take the higher-version
    // copy's non-vote fields, KEEP THE UNION of declared votes.
    // Without unionising, a late `revealed=true` patch that
    // re-bumps the version (perhaps after a peer added a vote that
    // the revealer hadn't seen) would WIPE the missing votes here.
    // The comment used to claim this branch unions, but the code
    // only spread `baseFromWinner` — a real data-loss bug.
    return {
      ...baseFromWinner,
      votes: { ...existing.votes, ...incoming.votes },
    };
  }
  // Neither side revealed — accept incoming's vote ONLY for the
  // sender's own slot. This kills the "peer A spoofing peer B's
  // vote" attack.
  const nextVotes: Record<string, string> = { ...existing.votes };
  const senderVote = incoming.votes?.[sender];
  if (typeof senderVote === "string") {
    nextVotes[sender] = senderVote;
  } else if (sender in (incoming.votes ?? {}) === false && sender in existing.votes) {
    // Sender omitted their own slot in the new payload → they
    // retracted their vote.
    delete nextVotes[sender];
  }
  return { ...baseFromWinner, votes: nextVotes };
}

/** Compare two voting objects: same `votes` map AND same revealed flag
 * AND same options. Used to skip no-op replacements that would otherwise
 * remount the voting widget. */
function sameVoting(
  a: WhiteboardObject & { type: "voting" },
  b: WhiteboardObject & { type: "voting" },
): boolean {
  if (a.revealed !== b.revealed) return false;
  // Non-vote fields that the user can edit. Without comparing these,
  // an at-same-version edit to `question` would be silently skipped.
  const aQuestion = (a as { question?: string }).question ?? "";
  const bQuestion = (b as { question?: string }).question ?? "";
  if (aQuestion !== bQuestion) return false;
  const aStoryId = (a as { storyId?: string }).storyId ?? "";
  const bStoryId = (b as { storyId?: string }).storyId ?? "";
  if (aStoryId !== bStoryId) return false;
  if (a.options.length !== b.options.length) return false;
  for (let i = 0; i < a.options.length; i++) {
    if (a.options[i] !== b.options[i]) return false;
  }
  const ak = Object.keys(a.votes);
  const bk = Object.keys(b.votes);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a.votes[k] !== b.votes[k]) return false;
  }
  return true;
}

/** When an unknown voting object first lands, strip every vote that
 * isn't from the sender — defense against peer spoofing other users'
 * vote choices on initial sight.
 *
 * Even when `revealed: true`, we MUST NOT trust the carrier's vote
 * map verbatim — a hostile peer can mint a fresh `{type:"voting",
 * revealed:true, votes:{victim:"forged"}}` object and broadcast it
 * for the first time; the receiver would otherwise import the forged
 * tally because there's no prior local copy to compare against. The
 * reveal-sticky guarantee only holds when we ALREADY have a local
 * copy of the (pre-reveal) votes — on first sight we have nothing to
 * anchor the tally to, so we treat the same way as an un-revealed
 * object: only the sender's own slot is trusted. Other peers who hold
 * the legitimate pre-reveal votes will heartbeat their copy in and
 * mergeVoting's union branch reconstructs the correct tally. */
function restrictVotesToSender(
  o: WhiteboardObject & { type: "voting" },
  sender: string,
): WhiteboardObject {
  const keys = Object.keys(o.votes);
  if (keys.length === 0) return o;
  if (keys.length === 1 && keys[0] === sender) return o;
  const senderVote = o.votes[sender];
  const next: Record<string, string> = {};
  if (typeof senderVote === "string") next[sender] = senderVote;
  return { ...o, votes: next };
}

/**
 * Compare local versions against a peer's heartbeat. Returns object IDs
 * the peer claims to have at higher (or unknown-to-us) versions — the
 * receiver should then request those via `whiteboard:request`.
 */
export function detectDrift(
  local: readonly WhiteboardObject[],
  hb: WhiteboardHeartbeat,
): string[] {
  const localVer = new Map(local.map((o) => [o.id, o.version]));
  const needed: string[] = [];
  for (const [id, ver] of Object.entries(hb.versions)) {
    const lv = localVer.get(id);
    if (lv === undefined || lv < ver) needed.push(id);
  }
  return needed;
}

const HEARTBEAT_MAX_KEYS = 500;

/**
 * Build a heartbeat from the current local objects.
 *
 * Caps the keyset to {@link HEARTBEAT_MAX_KEYS} (preferring objects with
 * higher versions, i.e. recently edited ones) so that boards with
 * thousands of stickies don't blow Supabase Realtime's message-size cap
 * with a 10-second-cadence broadcast. Drift recovery on boards larger
 * than the cap will need additional patches — acceptable since older
 * un-touched objects rarely drift.
 */
export function buildHeartbeat(local: readonly WhiteboardObject[], by: string): WhiteboardHeartbeat {
  const versions: Record<string, number> = {};
  const sample = local.length <= HEARTBEAT_MAX_KEYS
    ? local
    : [...local].sort((a, b) => b.version - a.version).slice(0, HEARTBEAT_MAX_KEYS);
  for (const o of sample) versions[o.id] = o.version;
  return { versions, by, at: new Date().toISOString() };
}

/** Bump version on a single object — used by every editor before upserting. */
export function bumpVersion<T extends WhiteboardObject>(o: T, userId?: string): T {
  return {
    ...o,
    version: o.version + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: userId ?? o.updatedBy,
  };
}
