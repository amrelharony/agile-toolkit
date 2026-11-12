/**
 * Wall rooms: the host's model of the wall, and the rules every request
 * meets. Pure: every function returns the next wall and never mutates its
 * input, so the room hook keeps the wall in a ref and the tests can drive
 * it without a channel.
 *
 * Rules for a participant's request (`applyWallIntent`), in order:
 *  1. the sender must not have been removed, and must hold a seat;
 *  2. the same sender's request id is applied once (a resend changes
 *     nothing; the hook sends the acks again). That ring is short, so what
 *     a take-back undid is also remembered for the whole round: a
 *     taken-back post's id and a taken-back vote's lock are never taken
 *     again, so replaying an old request can't bring either back;
 *  3. posts, votes and take-backs need the round they name to be the open
 *     one (a take-back works on a closed round too);
 *  4. a post: cleaned to 1–280 characters with no control or bidi
 *     characters, at most one every 5 seconds and 30 a round per member,
 *     200 a round in all, and a post id nobody used this round (taken-back
 *     ones included);
 *  5. a vote: the post must be on the wall and shown (not hidden until
 *     reveal), not the voter's own, one per member per post, with a lock
 *     no taken-back vote had, and at most 400 a round per member (taken-back
 *     ones included, which keeps the remembered locks bounded); taken back
 *     only with the key behind that vote's lock;
 *  6. a take-back of a post only with the key behind its lock;
 *  7. a hand: up or down, the sender's own.
 *
 * `by` is self-declared, and every member receives every request, but the
 * requests are encrypted to the host and the keys behind the locks never
 * leave their sender's tab, so nobody can take back someone else's post or
 * vote. Who wrote and who upvoted what (`author`, `voters`) live here, in
 * the host's memory only: `wallView` shares no author and no voter, and
 * `toWallResult` saves no id at all.
 */

import { cleanText, shareableText } from "../sanitize";
import {
  WALL_LIMITS,
  lockOf,
  type WallIntent,
  type WallMode,
  type WallPost,
  type WallRefusal,
  type WallRoomTool,
  type WallRoundResult,
  type WallRoundView,
} from "./protocol";

// ── Shapes ───────────────────────────────────────────────────────────

export interface HostPost {
  pid: string;
  text: string;
  /** Who wrote it (a member id). In memory only. */
  author: string;
  /** The lock its take-back must open. */
  lock: string;
  /** Who upvoted it: member id → the locks of their vote (more than one after a merge). */
  voters: ReadonlyMap<string, readonly string[]>;
  /** The host took it off the wall. */
  hidden: boolean;
  /** Merged into this post (a duplicate): it no longer shows on its own. */
  mergedInto: string | null;
  /** Posts merged into this one, oldest first. */
  merged: readonly { pid: string; text: string }[];
}

export interface HostWallRound {
  id: string;
  prompt: string;
  open: boolean;
  mode: WallMode;
  revealed: boolean;
  /** In the order they came in. */
  posts: ReadonlyMap<string, HostPost>;
  /** Posts each member made this round. */
  postsBy: ReadonlyMap<string, number>;
  /** When each member last posted (epoch ms). */
  lastPostAt: ReadonlyMap<string, number>;
  /** Posts this round took, taken-back ones included. */
  accepted: number;
  /** Ids of posts taken back this round: never taken again. */
  withdrawn: ReadonlySet<string>;
  /** Upvotes each member gave this round, taken-back ones included. */
  votesBy: ReadonlyMap<string, number>;
  /** Locks of upvotes taken back this round: a vote carrying one is refused. */
  spentLocks: ReadonlySet<string>;
}

export interface HostWall {
  round: HostWallRound | null;
  /** Raised hands, oldest first. */
  hands: readonly { id: string; at: number }[];
  /** Recent `<sender>:<request id>` keys, oldest first. */
  recent: readonly string[];
}

export interface WallContext {
  /** Members holding a seat now (the host included). */
  admitted: ReadonlySet<string>;
  /** Members the host removed. */
  removed: ReadonlySet<string>;
  /** Epoch ms, for the post rate. */
  now: number;
}

export type WallIntentResult =
  | { ok: true; wall: HostWall }
  | { ok: false; why: WallRefusal; wall: HostWall }
  /** The same request again: nothing changes. */
  | { ok: false; duplicate: true; wall: HostWall };

export function emptyWall(): HostWall {
  return { round: null, hands: [], recent: [] };
}

/** A round is showing its posts: as they arrive, or after Reveal. */
export function wallShown(r: Pick<HostWallRound, "mode" | "revealed">): boolean {
  return r.mode === "live" || r.revealed;
}

const onWall = (p: HostPost) => !p.hidden && p.mergedInto === null;

function withPost(round: HostWallRound, post: HostPost): HostWallRound {
  const posts = new Map(round.posts);
  posts.set(post.pid, post);
  return { ...round, posts };
}

// ── The host's own moves ─────────────────────────────────────────────

/**
 * A new round on the wall, open, with `prompt` (one line, hidden
 * characters stripped, cut to 280 characters; null when nothing is left)
 * and `mode`. Any earlier round goes, with everything in it; raised hands
 * stay.
 */
export function openWallRound(
  wall: HostWall,
  id: string,
  prompt: string,
  mode: WallMode
): HostWall | null {
  // The host's own words: hidden characters stripped, not refused.
  const clean = shareableText(String(prompt ?? ""), WALL_LIMITS.maxPromptChars);
  if (!clean) return null;
  return {
    ...wall,
    round: {
      id,
      prompt: clean,
      open: true,
      mode,
      revealed: false,
      posts: new Map(),
      postsBy: new Map(),
      lastPostAt: new Map(),
      accepted: 0,
      withdrawn: new Set(),
      votesBy: new Map(),
      spentLocks: new Set(),
    },
  };
}

/** Open or close the round (closed: no new posts or votes; take-backs still work). */
export function setWallOpen(wall: HostWall, open: boolean): HostWall {
  if (!wall.round || wall.round.open === open) return wall;
  return { ...wall, round: { ...wall.round, open } };
}

/**
 * "Show posts as they arrive" or "Hidden until reveal". Switching a hidden
 * round to live shows its posts (it counts as revealed); a revealed round
 * can't be hidden again.
 */
export function setWallMode(wall: HostWall, mode: WallMode): HostWall {
  const r = wall.round;
  if (!r || r.mode === mode) return wall;
  if (mode === "hidden" && (r.revealed || r.mode === "live")) {
    // Posts already shown can't be taken back off people's screens.
    return r.posts.size === 0 ? { ...wall, round: { ...r, mode } } : wall;
  }
  return { ...wall, round: { ...r, mode, revealed: r.revealed || mode === "live" } };
}

/** Show a hidden round's posts. */
export function revealWall(wall: HostWall): HostWall {
  const r = wall.round;
  if (!r || r.revealed) return wall;
  return { ...wall, round: { ...r, revealed: true } };
}

/** Take a post off the wall, or put it back. */
export function hideWallPost(wall: HostWall, pid: string, hidden: boolean): HostWall {
  const post = wall.round?.posts.get(pid);
  if (!wall.round || !post || post.hidden === hidden || post.mergedInto !== null) return wall;
  return { ...wall, round: withPost(wall.round, { ...post, hidden }) };
}

/**
 * Merge post `from` into post `into` (a duplicate question): `from`'s text
 * goes under `into`'s, its upvotes join `into`'s (a person who upvoted both
 * counts once; `into`'s writer's own vote is dropped), and it no longer
 * shows on its own. Unchanged when either isn't on the wall, they're the
 * same, or `into` would hold more than `WALL_LIMITS.maxMergedTexts` texts.
 */
export function mergeWallPosts(wall: HostWall, from: string, into: string): HostWall {
  const r = wall.round;
  const a = r?.posts.get(into);
  const b = r?.posts.get(from);
  if (!r || !a || !b || a === b || !onWall(a) || !onWall(b)) return wall;
  const merged = [...a.merged, { pid: b.pid, text: b.text }, ...b.merged];
  if (merged.length > WALL_LIMITS.maxMergedTexts) return wall;
  const voters = new Map(a.voters);
  b.voters.forEach((locks, member) => {
    if (member === a.author) return;
    if (!voters.has(member) && voters.size >= WALL_LIMITS.maxVotesPerPost) return;
    voters.set(member, [...(voters.get(member) ?? []), ...locks]);
  });
  const posts = new Map(r.posts);
  posts.set(a.pid, { ...a, merged, voters });
  posts.set(b.pid, { ...b, mergedInto: a.pid, merged: [], voters: new Map() });
  for (const child of b.merged) {
    const c = posts.get(child.pid);
    if (c) posts.set(c.pid, { ...c, mergedInto: a.pid });
  }
  return { ...wall, round: { ...r, posts } };
}

/** Lower someone's hand (the host may lower anyone's). */
export function lowerHand(wall: HostWall, id: string): HostWall {
  if (!wall.hands.some((h) => h.id === id)) return wall;
  return { ...wall, hands: wall.hands.filter((h) => h.id !== id) };
}

/** Drop the hands of people no longer in the room. */
export function keepPresentHands(wall: HostWall, present: ReadonlySet<string>): HostWall {
  if (wall.hands.every((h) => present.has(h.id))) return wall;
  return { ...wall, hands: wall.hands.filter((h) => present.has(h.id)) };
}

// ── Participants' requests ───────────────────────────────────────────

/** The post a take-back or vote on `pid` lands on: itself, or what it was merged into. */
function landing(round: HostWallRound, pid: string): HostPost | null {
  let post = round.posts.get(pid) ?? null;
  for (let hops = 0; post && post.mergedInto !== null && hops < 4; hops++) {
    post = round.posts.get(post.mergedInto) ?? null;
  }
  return post;
}

/** Apply one participant's request. Never mutates `wall`. */
export function applyWallIntent(
  wall: HostWall,
  by: string,
  iid: string,
  intent: WallIntent,
  ctx: WallContext
): WallIntentResult {
  const refuse = (why: WallRefusal): WallIntentResult => ({ ok: false, why, wall });
  if (ctx.removed.has(by) || !ctx.admitted.has(by)) return refuse("not-admitted");
  const key = `${by}:${iid}`;
  if (wall.recent.includes(key)) return { ok: false, duplicate: true, wall };
  const recent = [...wall.recent, key].slice(-WALL_LIMITS.recentRing);
  const accept = (next: HostWall): WallIntentResult => ({ ok: true, wall: { ...next, recent } });
  const refuseOnce = (why: WallRefusal): WallIntentResult => ({
    ok: false,
    why,
    wall: { ...wall, recent },
  });

  if (intent.t === "hand") {
    const up = wall.hands.some((h) => h.id === by);
    if (intent.up === up) return accept(wall);
    return accept({
      ...wall,
      hands: intent.up
        ? [...wall.hands, { id: by, at: ctx.now }]
        : wall.hands.filter((h) => h.id !== by),
    });
  }

  const r = wall.round;
  if (!r || intent.r !== r.id) return refuseOnce("closed");

  switch (intent.t) {
    case "post": {
      if (!r.open) return refuseOnce("closed");
      const text = cleanText(intent.text, WALL_LIMITS.maxPostChars);
      if (text === null) return refuseOnce("bad-text");
      const mine = r.postsBy.get(by) ?? 0;
      if (mine >= WALL_LIMITS.maxPostsPerMember) return refuseOnce("member-cap");
      const last = r.lastPostAt.get(by);
      if (last !== undefined && ctx.now - last < WALL_LIMITS.postIntervalMs) {
        return refuseOnce("rate");
      }
      if (r.accepted >= WALL_LIMITS.maxPostsPerRound) return refuseOnce("round-full");
      // Taken back once: a replay of the old request can't put it back.
      if (r.posts.has(intent.pid) || r.withdrawn.has(intent.pid)) return refuseOnce("already");
      const post: HostPost = {
        pid: intent.pid,
        text,
        author: by,
        lock: intent.lock,
        voters: new Map(),
        hidden: false,
        mergedInto: null,
        merged: [],
      };
      const round = withPost(r, post);
      return accept({
        ...wall,
        round: {
          ...round,
          postsBy: new Map(r.postsBy).set(by, mine + 1),
          lastPostAt: new Map(r.lastPostAt).set(by, ctx.now),
          accepted: r.accepted + 1,
        },
      });
    }

    case "withdraw": {
      const post = r.posts.get(intent.pid);
      if (!post) return refuseOnce("gone");
      if (post.author !== by || lockOf(intent.key) !== post.lock) return refuseOnce("not-yours");
      const posts = new Map(r.posts);
      posts.delete(post.pid);
      // Merged into another: its text leaves that post too.
      if (post.mergedInto !== null) {
        const host = posts.get(post.mergedInto);
        if (host) {
          posts.set(host.pid, { ...host, merged: host.merged.filter((m) => m.pid !== post.pid) });
        }
      }
      // Others merged into it stand on their own again.
      for (const child of post.merged) {
        const c = posts.get(child.pid);
        if (c) posts.set(c.pid, { ...c, mergedInto: null });
      }
      return accept({
        ...wall,
        round: { ...r, posts, withdrawn: new Set(r.withdrawn).add(post.pid) },
      });
    }

    case "vote": {
      if (!r.open || !wallShown(r)) return refuseOnce("closed");
      const post = r.posts.get(intent.pid);
      if (!post || !onWall(post)) return refuseOnce("gone");
      if (post.author === by) return refuseOnce("own-post");
      if (post.voters.has(by)) return refuseOnce("already");
      // A taken-back vote's request, replayed: it stays taken back.
      if (r.spentLocks.has(intent.lock)) return refuseOnce("already");
      const given = r.votesBy.get(by) ?? 0;
      if (given >= WALL_LIMITS.maxVotesPerMember) return refuseOnce("member-cap");
      if (post.voters.size >= WALL_LIMITS.maxVotesPerPost) return refuseOnce("round-full");
      const voters = new Map(post.voters).set(by, [intent.lock]);
      return accept({
        ...wall,
        round: {
          ...withPost(r, { ...post, voters }),
          votesBy: new Map(r.votesBy).set(by, given + 1),
        },
      });
    }

    case "unvote": {
      const post = landing(r, intent.pid);
      if (!post) return refuseOnce("gone");
      const locks = post.voters.get(by);
      if (!locks || !locks.includes(lockOf(intent.key))) return refuseOnce("not-yours");
      const voters = new Map(post.voters);
      voters.delete(by);
      const spentLocks = new Set(r.spentLocks);
      for (const lock of locks) spentLocks.add(lock);
      return accept({ ...wall, round: { ...withPost(r, { ...post, voters }), spentLocks } });
    }
  }
}

// ── What the room sees, and what is saved ────────────────────────────

/** Posts on the wall, shared: no author, no voter, most votes first (ties by id, not arrival). */
function sharedPosts(round: HostWallRound): WallPost[] {
  const out: WallPost[] = [];
  round.posts.forEach((p) => {
    if (!onWall(p)) return;
    out.push({
      id: p.pid,
      text: p.text,
      votes: p.voters.size,
      merged: p.merged.map((m) => m.text),
    });
  });
  return out.sort((a, b) => b.votes - a.votes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The round and hands as the state shares them: posts only once shown. */
export function wallView(wall: HostWall): { round: WallRoundView | null; hands: string[] } {
  const hands = wall.hands.map((h) => h.id);
  const r = wall.round;
  if (!r) return { round: null, hands };
  const posts = sharedPosts(r);
  return {
    round: {
      id: r.id,
      prompt: r.prompt,
      open: r.open,
      mode: r.mode,
      revealed: r.revealed,
      count: posts.length,
      posts: wallShown(r) ? posts : null,
    },
    hands,
  };
}

/** A post as the host's own screen lists it: the shared post, plus whether the host hid it. */
export interface HostWallPost extends WallPost {
  hidden: boolean;
}

/**
 * What the host's screen may draw: the posts on the wall and the ones the
 * host hid, most votes first, or null while the round is hidden until
 * reveal (then only the count shows, so no post text is in the page).
 */
export function hostWallPosts(wall: HostWall): HostWallPost[] | null {
  const r = wall.round;
  if (!r || !wallShown(r)) return null;
  const shown: HostWallPost[] = sharedPosts(r).map((p) => ({ ...p, hidden: false }));
  const hidden: HostWallPost[] = [];
  r.posts.forEach((p) => {
    if (p.hidden && p.mergedInto === null) {
      hidden.push({
        id: p.pid,
        text: p.text,
        votes: p.voters.size,
        merged: p.merged.map((m) => m.text),
        hidden: true,
      });
    }
  });
  return [...shown, ...hidden];
}

/**
 * The round as the tool's onSave gets it: the prompt, and each post on the
 * wall (not the ones the host hid) with its text, votes and merged texts,
 * most votes first. No post id, no member id, no name. Null without a
 * round, with nothing on the wall, or while the round is hidden until
 * reveal: the host keeps only posts it has seen.
 */
export function toWallResult(
  wall: HostWall,
  tool: WallRoomTool,
  closedAt: string
): WallRoundResult | null {
  const r = wall.round;
  if (!r || !wallShown(r)) return null;
  const posts = sharedPosts(r).map((p) => ({
    text: p.text,
    votes: p.votes,
    merged: p.merged.slice(),
  }));
  if (posts.length === 0) return null;
  return { roundId: r.id, tool, prompt: r.prompt, closedAt, mode: r.mode, posts };
}
