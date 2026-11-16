import { describe, expect, it } from "vitest";
import {
  WALL_LIMITS,
  lockOf,
  padIntent,
  readIntent,
  readSealedIntent,
  readWallState,
  wallStateInput,
  type WallIntent,
  type WallStateBody,
} from "@/lib/realtime/wall-room/protocol";
import {
  applyWallIntent,
  emptyWall,
  hideWallPost,
  hostWallPosts,
  lowerAllHands,
  markWallAnswered,
  mergeWallPosts,
  openWallRound,
  scoreAverage,
  setWallBuild,
  setWallOpen,
  setWallScoring,
  toWallResult,
  wallView,
  type HostWall,
  type WallContext,
} from "@/lib/realtime/wall-room/host";
import { postsToScore, scoreText } from "@/lib/realtime/wall-room/score";

/**
 * The wall's round kinds beyond posts and upvotes (Audience Wall): a
 * question marked answered, brainwriting's "Yes, and…" threads, 25/10
 * scoring (five posts each, 1 to 5, totals only once shown), and "lower
 * all" hands. The same hostile-input rules as the rest of the wall.
 */

const RID = "round_000001";
const A = "alice_0000000000";
const B = "bobby_0000000000";
const C = "carol_0000000000";
const D = "dave0_0000000000";
const SIG = "s".repeat(86);
const KEYS = { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` };
const KEY_A = "keyA_0123456789abcdef";
const KEY_B = "keyB_0123456789abcdef";
const KEY_C = "keyC_0123456789abcdef";

let now = 5_000_000;
const ctx = (over: Partial<WallContext> = {}): WallContext => ({
  admitted: new Set([A, B, C, D]),
  removed: new Set(),
  now,
  ...over,
});

let iidN = 0;
const iid = () => `iidm_${String(++iidN).padStart(7, "0")}`;
let pidN = 0;
const pid = () => `pidm_${String(++pidN).padStart(7, "0")}`;

function apply(wall: HostWall, by: string, intent: WallIntent) {
  return applyWallIntent(wall, by, iid(), intent, ctx());
}

function post(wall: HostWall, by: string, text: string, re?: string, key = KEY_A) {
  const id = pid();
  const res = apply(wall, by, {
    t: "post",
    r: RID,
    pid: id,
    text,
    lock: lockOf(key),
    ...(re ? { re } : {}),
  });
  if (!res.ok) throw new Error(`post refused: ${"why" in res ? res.why : "duplicate"}`);
  now += WALL_LIMITS.postIntervalMs;
  return { wall: res.wall, id };
}

function body(round: WallStateBody["round"]): WallStateBody {
  return {
    v: 1,
    by: "host_00000000000",
    seq: 3,
    tool: "audience-wall",
    endsAt: Date.now() + 3_600_000,
    keys: KEYS,
    round,
    hands: [],
    acks: [],
    nacks: [],
  };
}

/** As it travels: JSON, signed. */
const signed = (b: WallStateBody) => JSON.parse(JSON.stringify({ ...b, sig: SIG })) as unknown;

describe("questions marked answered", () => {
  it("marks a post answered, shares it, sorts it after the rest, and saves it", () => {
    let wall = openWallRound(emptyWall(), RID, "Questions?", "live")!;
    const q1 = post(wall, A, "How do we deploy?");
    wall = q1.wall;
    const q2 = post(wall, B, "Who owns the backlog?");
    wall = q2.wall;
    wall = apply(wall, C, { t: "vote", r: RID, pid: q1.id, lock: lockOf(KEY_C) }).wall;
    wall = markWallAnswered(wall, q1.id, true);
    const posts = wallView(wall).round!.posts!;
    expect(posts.map((p) => p.text)).toEqual(["Who owns the backlog?", "How do we deploy?"]);
    expect(posts[1]).toMatchObject({ answered: true, votes: 1 });
    expect(posts[0].answered).toBeUndefined();
    expect(toWallResult(wall, "audience-wall", "2026-11-12T10:00:00Z")!.posts[1]).toEqual({
      text: "How do we deploy?",
      votes: 1,
      merged: [],
      answered: true,
    });
    // Back to unanswered, and no change for a post that isn't on the wall.
    expect(wallView(markWallAnswered(wall, q1.id, false)).round!.posts![0].answered).toBe(
      undefined
    );
    const hidden = hideWallPost(wall, q2.id, true);
    expect(markWallAnswered(hidden, q2.id, true)).toBe(hidden);
  });
});

describe("brainwriting: Yes, and…", () => {
  it("takes a reply only in a build round, on a shown post on the wall", () => {
    let wall = openWallRound(emptyWall(), RID, "Ideas for onboarding", "live")!;
    const first = post(wall, A, "A buddy for every new joiner");
    wall = first.wall;
    // Brainwriting off: refused.
    expect(
      apply(wall, B, {
        t: "post",
        r: RID,
        pid: pid(),
        text: "and a welcome lunch",
        lock: lockOf(KEY_B),
        re: first.id,
      })
    ).toMatchObject({ ok: false, why: "closed" });
    wall = setWallBuild(wall, true);
    const reply = post(wall, B, "and the buddy pairs on the first story", first.id, KEY_B);
    wall = reply.wall;
    expect(wallView(wall).round).toMatchObject({ build: true });
    const shared = wallView(wall).round!.posts!;
    expect(shared.find((p) => p.id === reply.id)!.re).toBe(first.id);
    expect(shared.find((p) => p.id === first.id)!.re).toBeUndefined();
    // A reply to a reply joins the first post's thread.
    const deeper = post(wall, C, "and a checklist the buddy owns", reply.id, KEY_C);
    expect(wallView(deeper.wall).round!.posts!.find((p) => p.id === deeper.id)!.re).toBe(first.id);
    // A post that isn't there.
    expect(
      apply(wall, C, {
        t: "post",
        r: RID,
        pid: pid(),
        text: "and more",
        lock: lockOf(KEY_C),
        re: "nope_0000000",
      })
    ).toMatchObject({ ok: false, why: "gone" });
  });

  it("refuses a reply while posts are hidden until reveal", () => {
    let wall = openWallRound(emptyWall(), RID, "Ideas", "hidden", { build: true })!;
    const first = post(wall, A, "Idea one");
    wall = first.wall;
    expect(
      apply(wall, B, {
        t: "post",
        r: RID,
        pid: pid(),
        text: "and two",
        lock: lockOf(KEY_B),
        re: first.id,
      })
    ).toMatchObject({ ok: false, why: "closed" });
  });

  it("lets a reply stand alone when the post it builds on leaves the wall, and saves links by place", () => {
    let wall = openWallRound(emptyWall(), RID, "Ideas", "live", { build: true })!;
    const first = post(wall, A, "Pair on support tickets");
    wall = first.wall;
    const reply = post(wall, B, "and rotate weekly", first.id, KEY_B);
    wall = reply.wall;
    const saved = toWallResult(wall, "audience-wall", "2026-11-12T10:00:00Z")!;
    const at = saved.posts.findIndex((p) => p.text === "and rotate weekly");
    expect(saved.posts[at].re).toBe(
      saved.posts.findIndex((p) => p.text === first.wall.round!.posts.get(first.id)!.text)
    );
    expect(JSON.stringify(saved)).not.toContain(first.id);
    wall = hideWallPost(wall, first.id, true);
    expect(wallView(wall).round!.posts!.find((p) => p.id === reply.id)!.re).toBeUndefined();
    // The host's own list shows the hidden post without a thread on it.
    expect(hostWallPosts(wall)!.find((p) => p.id === first.id)).toMatchObject({ hidden: true });
  });

  it("reads replies from the wire only when they name a top post in the list", () => {
    const top = { id: "pidtop000001", text: "Idea", votes: 0, merged: [] };
    const reply = { id: "pidrep000001", text: "and more", votes: 0, merged: [], re: top.id };
    const round = {
      id: RID,
      prompt: "Ideas",
      open: true,
      mode: "live" as const,
      revealed: false,
      count: 2,
      posts: [top, reply],
      build: true,
    };
    expect(readWallState(signed(body(round)), "audience-wall")!.round!.posts![1].re).toBe(top.id);
    const orphan = { ...round, posts: [top, { ...reply, re: "pidgone00001" }] };
    expect(readWallState(signed(body(orphan)), "audience-wall")).toBeNull();
    const chained = {
      ...round,
      count: 3,
      posts: [top, reply, { ...reply, id: "pidrep000002", re: reply.id }],
    };
    expect(readWallState(signed(body(chained)), "audience-wall")).toBeNull();
    // A request's reply id is checked too.
    const plain = padIntent({
      t: "post",
      r: RID,
      pid: "pidnew000001",
      text: "x",
      lock: lockOf(KEY_A),
      re: "pidnew000001",
    })!;
    expect(readIntent(plain)).toBeNull();
  });
});

describe("25/10 scoring", () => {
  function scoredWall() {
    let wall = openWallRound(emptyWall(), RID, "Our boldest idea", "hidden")!;
    const ids: string[] = [];
    for (const [by, text, key] of [
      [A, "Ship weekly", KEY_A],
      [B, "Kill the status meeting", KEY_B],
      [C, "Pair on every bug", KEY_C],
      [A, "Customer on call", KEY_A],
    ] as const) {
      const p = post(wall, by, text, undefined, key);
      wall = p.wall;
      ids.push(p.id);
    }
    return { wall: setWallScoring(wall, "open"), ids };
  }

  it("opening the scoring stops posts, shows them, and keeps the round closed", () => {
    const { wall } = scoredWall();
    expect(wall.round).toMatchObject({ scoring: "open", open: false, revealed: true });
    expect(setWallOpen(wall, true)).toBe(wall);
    expect(wallView(wall).round).toMatchObject({ scoring: "open", scored: 0 });
    // Totals stay off the wire, and off the host's screen, until shown.
    expect(wallView(wall).round!.posts!.every((p) => p.score === undefined)).toBe(true);
    expect(hostWallPosts(wall)!.every((p) => p.score === undefined)).toBe(true);
  });

  it("takes 1 to 5 on someone else's post, five posts each, and changes a score only with its key", () => {
    const { wall: start, ids } = scoredWall();
    let wall = start;
    expect(
      apply(wall, A, { t: "score", r: RID, pid: ids[0], value: 4, lock: lockOf(KEY_A) })
    ).toMatchObject({ ok: false, why: "own-post" });
    let res = apply(wall, B, { t: "score", r: RID, pid: ids[0], value: 4, lock: lockOf(KEY_B) });
    expect(res.ok).toBe(true);
    wall = res.wall;
    expect(wallView(wall).round!.scored).toBe(1);
    // Someone under B's id without B's key can't change it.
    expect(
      apply(wall, B, {
        t: "score",
        r: RID,
        pid: ids[0],
        value: 1,
        lock: lockOf("forged_key_012345678"),
        key: "forged_key_012345678",
      })
    ).toMatchObject({ ok: false, why: "not-yours" });
    res = apply(wall, B, {
      t: "score",
      r: RID,
      pid: ids[0],
      value: 5,
      lock: lockOf(KEY_B),
      key: KEY_B,
    });
    expect(res.ok).toBe(true);
    wall = res.wall;
    wall = apply(wall, C, { t: "score", r: RID, pid: ids[0], value: 3, lock: lockOf(KEY_C) }).wall;
    wall = setWallScoring(wall, "shown");
    const top = wallView(wall).round!.posts!.find((p) => p.id === ids[0])!;
    expect(top).toMatchObject({ score: 8, scorers: 2 });
    expect(scoreText(top)).toBe("4 on average from 2 people");
    // Shown: no more scores.
    expect(
      apply(wall, D, { t: "score", r: RID, pid: ids[1], value: 2, lock: lockOf(KEY_A) })
    ).toMatchObject({ ok: false, why: "closed" });
  });

  it("caps one person at five posts scored", () => {
    let wall = openWallRound(emptyWall(), RID, "Ideas", "live")!;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = post(wall, A, `Idea ${i}`);
      wall = p.wall;
      ids.push(p.id);
    }
    wall = setWallScoring(wall, "open");
    for (let i = 0; i < 5; i++) {
      const r = apply(wall, B, {
        t: "score",
        r: RID,
        pid: ids[i],
        value: 3,
        lock: lockOf(`keyB${i}_0123456789abcd`),
      });
      expect(r.ok).toBe(true);
      wall = r.wall;
    }
    expect(
      apply(wall, B, {
        t: "score",
        r: RID,
        pid: ids[5],
        value: 3,
        lock: lockOf("keyB5_0123456789abcd"),
      })
    ).toMatchObject({ ok: false, why: "member-cap" });
  });

  it("ranks the shown totals by average, saves them, and won't merge a scored round", () => {
    const { wall: start, ids } = scoredWall();
    let wall = start;
    // Post 1: one 5. Post 2: 4 and 4. Post 3: nobody.
    wall = apply(wall, A, { t: "score", r: RID, pid: ids[1], value: 4, lock: lockOf(KEY_A) }).wall;
    wall = apply(wall, C, { t: "score", r: RID, pid: ids[1], value: 4, lock: lockOf(KEY_C) }).wall;
    wall = apply(wall, D, { t: "score", r: RID, pid: ids[0], value: 5, lock: lockOf(KEY_A) }).wall;
    expect(mergeWallPosts(wall, ids[2], ids[3])).toBe(wall);
    wall = setWallScoring(wall, "shown");
    const posts = wallView(wall).round!.posts!;
    expect(posts.map((p) => p.text).slice(0, 2)).toEqual([
      "Ship weekly",
      "Kill the status meeting",
    ]);
    expect(posts.map(scoreAverage).slice(0, 2)).toEqual([5, 4]);
    expect(posts[posts.length - 1].scorers).toBe(0);
    const saved = toWallResult(wall, "audience-wall", "2026-11-12T10:00:00Z")!;
    expect(saved.posts[0]).toMatchObject({ text: "Ship weekly", score: 5, scorers: 1 });
    // The wire: totals only on a shown round, on every post.
    const view = wallView(wall).round!;
    expect(readWallState(signed(body(view)), "audience-wall")).not.toBeNull();
    const early = { ...view, scoring: "open" as const };
    expect(readWallState(signed(body(early)), "audience-wall")).toBeNull();
    const missing = {
      ...view,
      posts: view.posts!.map((p) => ({ id: p.id, text: p.text, votes: p.votes, merged: p.merged })),
    };
    expect(readWallState(signed(body(missing)), "audience-wall")).toBeNull();
    // The signed text covers the totals.
    expect(wallStateInput(body(view))).not.toBe(
      wallStateInput(body({ ...view, posts: view.posts!.map((p) => ({ ...p, score: 25 })) }))
    );
  });

  it("only moves forward: off → open → shown", () => {
    const wall = openWallRound(emptyWall(), RID, "Ideas", "live")!;
    expect(setWallScoring(wall, "shown")).toBe(wall);
    const open = setWallScoring(wall, "open");
    expect(setWallScoring(open, "open")).toBe(open);
    const shown = setWallScoring(open, "shown");
    expect(setWallScoring(shown, "open")).toBe(shown);
  });

  it("reads only whole scores from 1 to 5 off the wire", () => {
    const ok = padIntent({
      t: "score",
      r: RID,
      pid: "pidnew000001",
      value: 3,
      lock: lockOf(KEY_A),
    })!;
    expect(readIntent(ok)).toEqual({
      t: "score",
      r: RID,
      pid: "pidnew000001",
      value: 3,
      lock: lockOf(KEY_A),
    });
    for (const value of [0, 6, 2.5, "3"]) {
      const bad = padIntent({
        t: "score",
        r: RID,
        pid: "pidnew000001",
        value: value as number,
        lock: lockOf(KEY_A),
      })!;
      expect(readIntent(bad), String(value)).toBeNull();
    }
  });

  it("picks the same five posts for a person every time, never their own", () => {
    const posts = Array.from({ length: 12 }, (_, i) => ({
      id: `pid_${String(i).padStart(8, "0")}`,
    }));
    const mine = new Set([posts[0].id, posts[1].id]);
    const first = postsToScore(posts, { roundId: RID, selfId: A, mine });
    expect(first).toHaveLength(5);
    expect(first.some((id) => mine.has(id))).toBe(false);
    expect(postsToScore([...posts].reverse(), { roundId: RID, selfId: A, mine })).toEqual(first);
    expect(postsToScore(posts, { roundId: RID, selfId: B, mine })).not.toEqual(first);
    expect(postsToScore(posts.slice(0, 3), { roundId: RID, selfId: A, mine })).toHaveLength(1);
  });
});

describe("raised hands", () => {
  it("lowers every hand at once", () => {
    let wall = emptyWall();
    wall = apply(wall, A, { t: "hand", up: true }).wall;
    wall = apply(wall, B, { t: "hand", up: true }).wall;
    expect(wallView(wall).hands).toEqual([A, B]);
    const lowered = lowerAllHands(wall);
    expect(wallView(lowered).hands).toEqual([]);
    expect(lowerAllHands(lowered)).toBe(lowered);
  });
});

describe("who is sending: a member id tied to its tab's secret", () => {
  const SECRET_A = "secretA_0123456789abc";
  const SECRET_B = "secretB_0123456789abc";
  const SECRET_X = "secretX_0123456789abc";
  const as = (wall: HostWall, by: string, secret: string | null, intent: WallIntent) =>
    applyWallIntent(wall, by, iid(), intent, ctx({ secret }));

  function wallWithPosts() {
    let wall = openWallRound(emptyWall(), RID, "Our boldest idea", "live")!;
    const a = as(wall, A, SECRET_A, {
      t: "post",
      r: RID,
      pid: "pid_alice001",
      text: "Ship weekly",
      lock: lockOf(KEY_A),
    });
    expect(a.ok).toBe(true);
    now += WALL_LIMITS.postIntervalMs;
    const b = as(a.wall, B, SECRET_B, {
      t: "post",
      r: RID,
      pid: "pid_bobby001",
      text: "Kill the status meeting",
      lock: lockOf(KEY_B),
    });
    expect(b.ok).toBe(true);
    now += WALL_LIMITS.postIntervalMs;
    wall = b.wall;
    return wall;
  }

  it("refuses a score sent under someone else's id the same way on every post, so it tells nothing", () => {
    const wall = setWallScoring(wallWithPosts(), "open");
    // X claims to be A, on A's own post and on B's: one answer, and no "own-post".
    const own = as(wall, A, SECRET_X, {
      t: "score",
      r: RID,
      pid: "pid_alice001",
      value: 5,
      lock: lockOf(KEY_C),
    });
    const other = as(wall, A, SECRET_X, {
      t: "score",
      r: RID,
      pid: "pid_bobby001",
      value: 5,
      lock: lockOf(KEY_C),
    });
    expect(own).toMatchObject({ ok: false, why: "not-admitted" });
    expect(other).toMatchObject({ ok: false, why: "not-admitted" });
    // Without a secret at all: the same.
    expect(
      as(wall, A, null, { t: "score", r: RID, pid: "pid_bobby001", value: 5, lock: lockOf(KEY_C) })
    ).toMatchObject({ ok: false, why: "not-admitted" });
    // Nothing was counted, and A still scores B's post, from A's own tab.
    expect(wallView(other.wall).round!.scored).toBe(0);
    const real = as(other.wall, A, SECRET_A, {
      t: "score",
      r: RID,
      pid: "pid_bobby001",
      value: 4,
      lock: lockOf(KEY_A),
    });
    expect(real.ok).toBe(true);
    expect(wallView(real.wall).round!.scored).toBe(1);
  });

  it("refuses a vote or a hand under someone else's id, and ties a newcomer on first use", () => {
    const wall = wallWithPosts();
    expect(
      as(wall, B, SECRET_X, { t: "vote", r: RID, pid: "pid_alice001", lock: lockOf(KEY_C) })
    ).toMatchObject({ ok: false, why: "not-admitted" });
    expect(as(wall, B, SECRET_X, { t: "hand", up: true })).toMatchObject({
      ok: false,
      why: "not-admitted",
    });
    // C has sent nothing yet: C's first request ties C's id to C's tab.
    const c = as(wall, C, SECRET_X, { t: "hand", up: true });
    expect(c.ok).toBe(true);
    expect(as(c.wall, C, SECRET_A, { t: "hand", up: false })).toMatchObject({
      ok: false,
      why: "not-admitted",
    });
    expect(as(c.wall, C, SECRET_X, { t: "hand", up: false }).ok).toBe(true);
    // The tie outlives the round.
    const next = openWallRound(c.wall, "round_000002", "Next", "live")!;
    expect(as(next, C, SECRET_A, { t: "hand", up: false })).toMatchObject({
      ok: false,
      why: "not-admitted",
    });
  });

  it("carries the secret inside the sealed request, apart from the request itself", () => {
    const intent: WallIntent = {
      t: "post",
      r: RID,
      pid: "pid_alice001",
      // The longest post a request takes: 280 characters at three bytes each, a reply.
      text: "反".repeat(WALL_LIMITS.maxPostChars),
      lock: lockOf(KEY_A),
      re: "pid_bobby001",
    };
    const plain = padIntent(intent, SECRET_A)!;
    expect(plain).not.toBeNull();
    expect(readSealedIntent(plain)).toEqual({ intent, secret: SECRET_A });
    expect(readIntent(plain)).toEqual(intent);
    expect(readSealedIntent(padIntent(intent)!)).toEqual({ intent, secret: null });
    expect(padIntent(intent, "short")).toBeNull();
    const forged = JSON.stringify({ t: "hand", up: true, s: "no!" });
    expect(readSealedIntent(forged + " ".repeat(WALL_LIMITS.intentBytes - forged.length))).toBe(
      null
    );
  });
});

describe("25/10 limits the room reads", () => {
  it("takes no scorer past 20 on a post and no score past 100 a round, so the state stays readable", () => {
    const members = Array.from(
      { length: 24 },
      (_, i) => `memb${String(i).padStart(2, "0")}_0000000000`
    );
    const room = ctx({ admitted: new Set([A, ...members]) });
    let wall = openWallRound(emptyWall(), RID, "Our boldest idea", "live")!;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = `pid_idea${String(i).padStart(4, "0")}`;
      const res = applyWallIntent(
        wall,
        A,
        iid(),
        {
          t: "post",
          r: RID,
          pid: id,
          text: `Idea ${i}`,
          lock: lockOf(KEY_A),
        },
        { ...room, now: now + i * WALL_LIMITS.postIntervalMs }
      );
      expect(res.ok).toBe(true);
      wall = res.wall;
      ids.push(id);
    }
    wall = setWallScoring(wall, "open");
    const score = (by: string, pid: string) =>
      applyWallIntent(
        wall,
        by,
        iid(),
        { t: "score", r: RID, pid, value: 3, lock: lockOf(`${by.slice(0, 6)}_0123456789abcd`) },
        room
      );
    // Twenty people score the first five posts: 100 scores, 20 on each.
    for (const by of members.slice(0, 20)) {
      for (const pid of ids.slice(0, 5)) {
        const res = score(by, pid);
        expect(res.ok).toBe(true);
        wall = res.wall;
      }
    }
    // A 21st scorer on one of them: refused, as is a 101st score on the sixth post.
    expect(score(members[20], ids[0])).toMatchObject({ ok: false, why: "round-full" });
    expect(score(members[20], ids[5])).toMatchObject({ ok: false, why: "round-full" });
    const shown = setWallScoring(wall, "shown");
    expect(readWallState(signed(body(wallView(shown).round)), "audience-wall")).not.toBeNull();
  });
});

describe("a round that takes no posts", () => {
  it("opens closed for posts (a raise-hand queue), still takes hands, and can open later", () => {
    const wall = openWallRound(emptyWall(), RID, "Raise your hand to speak", "live", {
      takePosts: false,
    })!;
    expect(wall.round!.open).toBe(false);
    expect(
      apply(wall, A, { t: "post", r: RID, pid: pid(), text: "Hi", lock: lockOf(KEY_A) })
    ).toMatchObject({ ok: false, why: "closed" });
    expect(apply(wall, A, { t: "hand", up: true }).ok).toBe(true);
    expect(setWallOpen(wall, true).round!.open).toBe(true);
  });
});

describe("which five a person scores", () => {
  it("is seeded by the tab's secret, not by ids the room can see", () => {
    const posts = Array.from({ length: 20 }, (_, i) => ({
      id: `pid_${String(i).padStart(8, "0")}`,
    }));
    const bySecret = (seed: string) => postsToScore(posts, { roundId: RID, selfId: A, seed });
    // Knowing the round and the member id doesn't give the pick.
    expect(bySecret("secretA_0123456789abc")).not.toEqual(
      postsToScore(posts, { roundId: RID, selfId: A })
    );
    expect(bySecret("secretA_0123456789abc")).not.toEqual(bySecret("secretZ_0123456789abc"));
    expect(bySecret("secretA_0123456789abc")).toEqual(bySecret("secretA_0123456789abc"));
  });

  it("drops its own posts after the shuffle, so the others keep their places", () => {
    const posts = Array.from({ length: 20 }, (_, i) => ({
      id: `pid_${String(i).padStart(8, "0")}`,
    }));
    const seed = "secretA_0123456789abc";
    const all = postsToScore(posts, { roundId: RID, selfId: A, seed, count: 20 });
    const mine = new Set([all[1]]);
    expect(postsToScore(posts, { roundId: RID, selfId: A, seed, mine })).toEqual(
      all.filter((id) => !mine.has(id)).slice(0, 5)
    );
  });
});
