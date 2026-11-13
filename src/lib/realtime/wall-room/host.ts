/**
 * Wall rooms: the host's model of the wall, and the rules every request
 * meets. Pure: every function returns the next wall and never mutates its
 * input, so the room hook keeps the wall in a ref and the tests can drive
 * it without a channel.
 *
 * Rules for a participant's request (`applyWallIntent`), in order:
 *  1. the sender must not have been removed, and must hold a seat, and the
 *     secret inside the request (`ctx.secret`, its tab's) must be the one
 *     the host first saw from that id: the first request ties the id to it;
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
 *  7. a hand: up or down, the sender's own;
 *  8. a "Yes, and…" post (`re`): only in a brainwriting round, on a post
 *     that is on the wall and shown; it is linked to that post's thread
 *     (a reply to a reply joins the first post's);
 *  9. a 25/10 score: only while scoring is open, 1 to 5, on a post on the
 *     wall that isn't the scorer's own, on at most five posts per member,
 *     20 scorers per post and 100 scores a round (what the room reads);
 *     a score is changed only with the key behind its lock.
 *
 * `by` is self-declared, and every member receives every request, but the
 * requests are encrypted to the host, the keys behind the locks never
 * leave their sender's tab, and an id is tied to its tab's secret on first
 * use, so nobody can take back someone else's post or vote, or send as
 * someone who already sent anything. Who wrote and who upvoted what
 * (`author`, `voters`) live here, in
 * the host's memory only: `wallView` shares no author and no voter, and
 * `toWallResult` saves no id at all.
 */

import { cleanText, shareableText } from "../sanitize";
import {
  WALL_LIMITS,
  WALL_MAX_SCORERS,
  WALL_MAX_SCORES,
  lockOf,
  type WallIntent,
  type WallMode,
  type WallPost,
  type WallRefusal,
  type WallResultPost,
  type WallRoomTool,
  type WallRoundResult,
  type WallRoundView,
  type WallScoring,
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
  /** Brainwriting: the post this one builds on, or null. */
  re?: string | null;
  /** The host marked it answered. */
  answered?: boolean;
  /** 25/10: member id → their score and the lock its change must open. In memory only. */
  scores?: ReadonlyMap<string, { value: number; lock: string }>;
}

/** The round's options when it opens. */
export interface WallRoundOptions {
  /** Brainwriting: take "Yes, and…" posts on the posts on the wall. */
  build?: boolean;
  /**
   * False: the round opens without taking posts (a raise-hand queue, where
   * the hand is the point). The host can start taking them later.
   */
  takePosts?: boolean;
}

/** Member ids the host ties to a tab's secret, at most (old ones are never dropped). */
export const WALL_MAX_SENDERS = 1_000;

export interface HostWallRound {
  id: string;
  prompt: string;
  open: boolean;
  mode: WallMode;
  revealed: boolean;
  /** Brainwriting: "Yes, and…" posts are taken. */
  build?: boolean;
  /** 25/10 scoring, or null/absent for a round that isn't scored. */
  scoring?: WallScoring | null;
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
  /**
   * Member id → the lock of the tab secret its first request carried ("" for
   * a request with none). In memory only; it lasts as long as the room, so a
   * member who leaves can't be stood in for later.
   */
  senders?: ReadonlyMap<string, string>;
}

export interface WallContext {
  /** Members holding a seat now (the host included). */
  admitted: ReadonlySet<string>;
  /** Members the host removed. */
  removed: ReadonlySet<string>;
  /** Epoch ms, for the post rate. */
  now: number;
  /** The secret inside the request (its sender's tab's), or null/absent for none. */
  secret?: string | null;
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
 * and `mode`, taking posts unless `options.takePosts` is false. Any earlier
 * round goes, with everything in it; raised hands stay.
 */
export function openWallRound(
  wall: HostWall,
  id: string,
  prompt: string,
  mode: WallMode,
  options: WallRoundOptions = {}
): HostWall | null {
  // The host's own words: hidden characters stripped, not refused.
  const clean = shareableText(String(prompt ?? ""), WALL_LIMITS.maxPromptChars);
  if (!clean) return null;
  return {
    ...wall,
    round: {
      id,
      prompt: clean,
      open: options.takePosts !== false,
      mode,
      revealed: false,
      build: options.build === true,
      scoring: null,
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

/**
 * Open or close the round (closed: no new posts or votes; take-backs still
 * work). A scored round stays closed: its posts are fixed while people
 * score them.
 */
export function setWallOpen(wall: HostWall, open: boolean): HostWall {
  if (!wall.round || wall.round.open === open) return wall;
  if (open && wall.round.scoring) return wall;
  return { ...wall, round: { ...wall.round, open } };
}

/** Brainwriting on or off: whether "Yes, and…" posts are taken. */
export function setWallBuild(wall: HostWall, build: boolean): HostWall {
  if (!wall.round || (wall.round.build === true) === build) return wall;
  return { ...wall, round: { ...wall.round, build } };
}

/**
 * 25/10, forward only: "open" starts the scoring (it stops new posts and
 * shows the posts, so everyone can score them), "shown" stops it and
 * shares each post's total. Anything else leaves the wall as it is.
 */
export function setWallScoring(wall: HostWall, scoring: WallScoring): HostWall {
  const r = wall.round;
  if (!r) return wall;
  const now = r.scoring ?? null;
  if (scoring === "open" && now === null) {
    return { ...wall, round: { ...r, scoring, open: false, revealed: true } };
  }
  if (scoring === "shown" && now === "open") {
    return { ...wall, round: { ...r, scoring } };
  }
  return wall;
}

/** Mark a question answered, or not. Only a post on the wall. */
export function markWallAnswered(wall: HostWall, pid: string, answered: boolean): HostWall {
  const post = wall.round?.posts.get(pid);
  if (!wall.round || !post || !onWall(post) || (post.answered === true) === answered) return wall;
  return { ...wall, round: withPost(wall.round, { ...post, answered }) };
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
 * same, `into` would hold more than `WALL_LIMITS.maxMergedTexts` texts, or
 * the round is scored (scores don't merge).
 */
export function mergeWallPosts(wall: HostWall, from: string, into: string): HostWall {
  const r = wall.round;
  const a = r?.posts.get(into);
  const b = r?.posts.get(from);
  if (!r || !a || !b || a === b || !onWall(a) || !onWall(b) || r.scoring) return wall;
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

/** Lower every raised hand. */
export function lowerAllHands(wall: HostWall): HostWall {
  return wall.hands.length === 0 ? wall : { ...wall, hands: [] };
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

/**
 * The first post of `post`'s thread on the wall: the post it builds on
 * (through merges, a few hops at most), or null when it builds on none
 * that is on the wall. Threads are one level deep.
 */
function threadOf(round: HostWallRound, post: HostPost): HostPost | null {
  let cur: HostPost = post;
  for (let hops = 0; cur.re && hops < 4; hops++) {
    const parent = landing(round, cur.re);
    if (!parent || parent.pid === post.pid || !onWall(parent)) break;
    cur = parent;
  }
  return cur === post ? null : cur;
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
  // `by` is self-declared: the id's first request ties it to its tab's
  // secret, and a request under that id with another secret (or none) is
  // someone else's. Refused before anything about a post is looked at, so
  // it can't tell whose a post is.
  const seal = ctx.secret ? lockOf(ctx.secret) : "";
  const tied = wall.senders?.get(by);
  if (tied !== undefined && tied !== seal) return refuse("not-admitted");
  if (tied === undefined && (wall.senders?.size ?? 0) >= WALL_MAX_SENDERS) {
    return refuse("not-admitted");
  }
  const senders: ReadonlyMap<string, string> =
    tied === undefined ? new Map(wall.senders ?? []).set(by, seal) : (wall.senders ?? new Map());
  const recent = [...wall.recent, key].slice(-WALL_LIMITS.recentRing);
  const accept = (next: HostWall): WallIntentResult => ({
    ok: true,
    wall: { ...next, recent, senders },
  });
  const refuseOnce = (why: WallRefusal): WallIntentResult => ({
    ok: false,
    why,
    wall: { ...wall, recent, senders },
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
      let re: string | null = null;
      if (intent.re !== undefined) {
        // "Yes, and…": only while the host runs brainwriting, on a post people can see.
        if (!r.build || !wallShown(r)) return refuseOnce("closed");
        const parent = landing(r, intent.re);
        if (!parent || !onWall(parent)) return refuseOnce("gone");
        re = (threadOf(r, parent) ?? parent).pid;
      }
      const post: HostPost = {
        pid: intent.pid,
        text,
        author: by,
        lock: intent.lock,
        voters: new Map(),
        hidden: false,
        mergedInto: null,
        merged: [],
        re,
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

    case "score": {
      if (r.scoring !== "open") return refuseOnce("closed");
      const post = r.posts.get(intent.pid);
      if (!post || !onWall(post)) return refuseOnce("gone");
      if (post.author === by) return refuseOnce("own-post");
      const scores = post.scores ?? new Map<string, { value: number; lock: string }>();
      const given = scores.get(by);
      if (given) {
        // A change: only with the key behind the first score's lock.
        if (intent.key === undefined || lockOf(intent.key) !== given.lock) {
          return refuseOnce("not-yours");
        }
        if (given.value === intent.value) return accept(wall);
        const next = new Map(scores).set(by, { value: intent.value, lock: given.lock });
        return accept({ ...wall, round: withPost(r, { ...post, scores: next }) });
      }
      let scored = 0;
      let total = 0;
      r.posts.forEach((p) => {
        if (p.scores?.has(by)) scored += 1;
        total += p.scores?.size ?? 0;
      });
      if (scored >= WALL_LIMITS.scoresPerMember) return refuseOnce("member-cap");
      // What the room reads: past these, every participant would refuse the
      // state (people who left keep their scores, so newcomers could pass them).
      if (scores.size >= WALL_MAX_SCORERS || total >= WALL_MAX_SCORES) {
        return refuseOnce("round-full");
      }
      const next = new Map(scores).set(by, { value: intent.value, lock: intent.lock });
      return accept({ ...wall, round: withPost(r, { ...post, scores: next }) });
    }
  }
}

// ── What the room sees, and what is saved ────────────────────────────

/** A post's 25/10 totals: the sum of its scores and how many scored it. */
function totals(p: HostPost): { score: number; scorers: number } {
  let score = 0;
  p.scores?.forEach((s) => {
    score += s.value;
  });
  return { score, scorers: p.scores?.size ?? 0 };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One post as the room shares it, with what the round's kind adds. */
function sharedPost(round: HostWallRound, p: HostPost): WallPost {
  const out: WallPost = {
    id: p.pid,
    text: p.text,
    votes: p.voters.size,
    merged: p.merged.map((m) => m.text),
  };
  const thread = onWall(p) ? threadOf(round, p) : null;
  if (thread) out.re = thread.pid;
  if (p.answered) out.answered = true;
  if (round.scoring === "shown") Object.assign(out, totals(p));
  return out;
}

/**
 * 25/10: a post's average score, or -1 when nobody scored it. Each person
 * scores five posts picked at random, so posts get different numbers of
 * scores, and the average (not the sum) ranks them fairly.
 */
export function scoreAverage(p: { score?: number; scorers?: number }): number {
  return p.scorers ? (p.score ?? 0) / p.scorers : -1;
}

/**
 * Posts on the wall, shared: no author, no voter, no score while scoring
 * is open. Most votes first (ties by id, not arrival), answered questions
 * after the rest; once 25/10 totals are shown, the best average first.
 */
function sharedPosts(round: HostWallRound): WallPost[] {
  const out: WallPost[] = [];
  round.posts.forEach((p) => {
    if (onWall(p)) out.push(sharedPost(round, p));
  });
  // Threads are one level deep on the wire: a "Yes, and…" whose post is
  // itself one (after a hide and a show) stands on its own instead.
  const shared = new Map(out.map((p) => [p.id, p]));
  for (const p of out) {
    if (p.re === undefined) continue;
    const parent = shared.get(p.re);
    if (!parent || parent === p || parent.re !== undefined) delete p.re;
  }
  if (round.scoring === "shown") {
    return out.sort(
      (a, b) =>
        scoreAverage(b) - scoreAverage(a) ||
        (b.scorers ?? 0) - (a.scorers ?? 0) ||
        b.votes - a.votes ||
        byId(a, b)
    );
  }
  return out.sort(
    (a, b) =>
      Number(a.answered === true) - Number(b.answered === true) || b.votes - a.votes || byId(a, b)
  );
}

/** 25/10: the scores given so far on the posts on the wall. */
function scoresGiven(round: HostWallRound): number {
  let n = 0;
  round.posts.forEach((p) => {
    if (onWall(p)) n += p.scores?.size ?? 0;
  });
  return n;
}

/** The round and hands as the state shares them: posts only once shown. */
export function wallView(wall: HostWall): { round: WallRoundView | null; hands: string[] } {
  const hands = wall.hands.map((h) => h.id);
  const r = wall.round;
  if (!r) return { round: null, hands };
  const posts = sharedPosts(r);
  const round: WallRoundView = {
    id: r.id,
    prompt: r.prompt,
    open: r.open,
    mode: r.mode,
    revealed: r.revealed,
    count: posts.length,
    posts: wallShown(r) ? posts : null,
  };
  if (r.build) round.build = true;
  if (r.scoring) {
    round.scoring = r.scoring;
    round.scored = scoresGiven(r);
  }
  return { round, hands };
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
    if (p.hidden && p.mergedInto === null) hidden.push({ ...sharedPost(r, p), hidden: true });
  });
  return [...shown, ...hidden];
}

/**
 * The round as the tool's onSave gets it: the prompt, and each post on the
 * wall (not the ones the host hid) with its text, votes and merged texts,
 * most votes first. No post id, no member id, no name: a "Yes, and…"
 * post points at the post it builds on by its place in the list, and 25/10
 * totals come only once they were shown. Null without a round, with
 * nothing on the wall, or while the round is hidden until reveal: the host
 * keeps only posts it has seen.
 */
export function toWallResult(
  wall: HostWall,
  tool: WallRoomTool,
  closedAt: string
): WallRoundResult | null {
  const r = wall.round;
  if (!r || !wallShown(r)) return null;
  const shared = sharedPosts(r);
  const place = new Map(shared.map((p, i) => [p.id, i]));
  const posts = shared.map((p) => {
    const out: WallResultPost = { text: p.text, votes: p.votes, merged: p.merged.slice() };
    const re = p.re === undefined ? undefined : place.get(p.re);
    if (re !== undefined) out.re = re;
    if (p.answered) out.answered = true;
    if (p.score !== undefined) {
      out.score = p.score;
      out.scorers = p.scorers ?? 0;
    }
    return out;
  });
  if (posts.length === 0) return null;
  return { roundId: r.id, tool, prompt: r.prompt, closedAt, mode: r.mode, posts };
}
