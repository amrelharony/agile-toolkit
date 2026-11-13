import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { createWebVoteCrypto } from "@/lib/realtime/vote-room/crypto";
import {
  WALL_LIMITS,
  WALL_ROOM_TOOLS,
  intentAad,
  intentCiphertextChars,
  lockOf,
  padIntent,
  readIntent,
  readIntentEnvelope,
  readWallState,
  wallRoundMarkdown,
  wallStateInput,
  type WallIntent,
  type WallStateBody,
} from "@/lib/realtime/wall-room/protocol";
import {
  applyWallIntent,
  emptyWall,
  hideWallPost,
  hostWallPosts,
  keepPresentHands,
  lowerHand,
  mergeWallPosts,
  openWallRound,
  revealWall,
  setWallMode,
  setWallOpen,
  toWallResult,
  wallView,
  type HostWall,
  type WallContext,
} from "@/lib/realtime/wall-room/host";
import { VISITOR_ROOM_KIND } from "@/lib/realtime/visitor-rooms";

/**
 * Wall rooms: the request rules (post size, rate and caps, one upvote per
 * member, take-backs only with the key), the host's moderation (hide,
 * merge, hands), the hiding rule on the wire, and what may be saved (no
 * ids, no names).
 */

const RID = "round_000001";
const HOST = "host_00000000000";
const A = "alice_0000000000";
const B = "bobby_0000000000";
const C = "carol_0000000000";
const SIG = "s".repeat(86);
const KEYS = { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` };
const KEY_A = "keyA_0123456789abcdef";
const KEY_B = "keyB_0123456789abcdef";

let now = 1_000_000;
const ctx = (over: Partial<WallContext> = {}): WallContext => ({
  admitted: new Set([HOST, A, B, C]),
  removed: new Set(),
  now,
  ...over,
});

let iidN = 0;
const iid = () => `iid_${String(++iidN).padStart(8, "0")}`;
let pidN = 0;
const pid = () => `pid_${String(++pidN).padStart(8, "0")}`;

function open(mode: "live" | "hidden" = "live"): HostWall {
  return openWallRound(emptyWall(), RID, "What should we stop doing?", mode)!;
}

function apply(wall: HostWall, by: string, intent: WallIntent, over: Partial<WallContext> = {}) {
  return applyWallIntent(wall, by, iid(), intent, ctx(over));
}

function post(wall: HostWall, by: string, text: string, key = KEY_A, id = pid()) {
  const res = apply(wall, by, { t: "post", r: RID, pid: id, text, lock: lockOf(key) });
  if (!res.ok) throw new Error(`post refused: ${"why" in res ? res.why : "duplicate"}`);
  now += WALL_LIMITS.postIntervalMs;
  return { wall: res.wall, id };
}

describe("wall tools", () => {
  it("are exactly the visitor tools whose room kind is wall", () => {
    expect([...WALL_ROOM_TOOLS]).toEqual(
      Object.entries(VISITOR_ROOM_KIND)
        .filter(([, k]) => k === "wall")
        .map(([t]) => t)
    );
  });
});

describe("requests on the wire", () => {
  it("pads every request to one size, a full post included", () => {
    const long = {
      t: "post" as const,
      r: RID,
      pid: pid(),
      text: "é".repeat(280),
      lock: lockOf(KEY_A),
    };
    const hand = { t: "hand" as const, up: true };
    const a = padIntent(long)!;
    const b = padIntent(hand)!;
    expect(new TextEncoder().encode(a).length).toBe(WALL_LIMITS.intentBytes);
    expect(new TextEncoder().encode(b).length).toBe(WALL_LIMITS.intentBytes);
    expect(readIntent(a)).toEqual(long);
    expect(readIntent(b)).toEqual(hand);
    // Even 280 quote marks, each escaped, fit.
    expect(padIntent({ ...long, text: '"'.repeat(280) })).not.toBeNull();
  });

  it.each<[string, string]>([
    ["unpadded JSON", JSON.stringify({ t: "hand", up: true })],
    [
      "a vote without a lock",
      padIntent({ t: "hand", up: true })!.replace(
        '"t":"hand","up":true',
        '"t":"vote","r":"round_000001","pid":"pid_00000001"'
      ),
    ],
  ])("refuses %s", (_label, plain) => {
    expect(readIntent(plain)).toBeNull();
  });

  it("seals to exactly that size with real WebCrypto, and only the host's key opens it", async () => {
    const crypto = createWebVoteCrypto(webcrypto.subtle as unknown as SubtleCrypto, (n) =>
      webcrypto.getRandomValues(new Uint8Array(n))
    );
    const host = await crypto.createHostKeys();
    const other = await crypto.createHostKeys();
    const plain = padIntent({ t: "hand", up: true })!;
    const aad = intentAad(A, "iid_00000001");
    const sealed = await crypto.seal(host.publicKeys.ecdh, aad, plain);
    expect(sealed.ct).toHaveLength(intentCiphertextChars());
    expect(await crypto.open(host, sealed, aad)).toBe(plain);
    expect(await crypto.open(other, sealed, aad)).toBeNull();
    // Moved to another sender or request id, it no longer opens.
    expect(await crypto.open(host, sealed, intentAad(B, "iid_00000001"))).toBeNull();
  });

  it("reads only envelopes of the one size", () => {
    const env = {
      v: 1,
      by: A,
      iid: "iid_00000001",
      epk: `B${"E".repeat(86)}`,
      iv: "i".repeat(16),
      ct: "c".repeat(intentCiphertextChars()),
    };
    expect(readIntentEnvelope(env)).toEqual(env);
    expect(readIntentEnvelope({ ...env, ct: "c".repeat(intentCiphertextChars() - 4) })).toBeNull();
    expect(readIntentEnvelope({ ...env, by: "short" })).toBeNull();
    expect(readIntentEnvelope({ ...env, iid: "x" })).toBeNull();
  });
});

describe("posting", () => {
  it("takes a cleaned post of up to 280 characters", () => {
    const { wall } = post(open(), A, "  Too many   meetings  ");
    expect(wallView(wall).round!.posts).toEqual([
      { id: expect.any(String), text: "Too many meetings", votes: 0, merged: [] },
    ]);
    const res = apply(wall, B, {
      t: "post",
      r: RID,
      pid: pid(),
      text: "‮flip",
      lock: lockOf(KEY_B),
    });
    expect(res).toMatchObject({ ok: false, why: "bad-text" });
  });

  it("lets one member post once every 5 seconds, 30 times a round", () => {
    let wall = open();
    wall = post(wall, A, "one").wall;
    now -= 1_000; // only 4 s since the last
    const soon = apply(wall, A, {
      t: "post",
      r: RID,
      pid: pid(),
      text: "two",
      lock: lockOf(KEY_A),
    });
    expect(soon).toMatchObject({ ok: false, why: "rate" });
    now += 1_000;
    for (let i = 1; i < WALL_LIMITS.maxPostsPerMember; i++) wall = post(wall, A, `post ${i}`).wall;
    const over = apply(wall, A, {
      t: "post",
      r: RID,
      pid: pid(),
      text: "one more",
      lock: lockOf(KEY_A),
    });
    expect(over).toMatchObject({ ok: false, why: "member-cap" });
    // Someone else can still post.
    expect(post(wall, B, "mine").wall.round!.posts.size).toBe(WALL_LIMITS.maxPostsPerMember + 1);
  });

  it("refuses a post for another round, a closed round, or someone not in the room", () => {
    const wall = open();
    expect(
      apply(wall, A, { t: "post", r: "round_000009", pid: pid(), text: "x", lock: lockOf(KEY_A) })
    ).toMatchObject({ ok: false, why: "closed" });
    expect(
      apply(setWallOpen(wall, false), A, {
        t: "post",
        r: RID,
        pid: pid(),
        text: "x",
        lock: lockOf(KEY_A),
      })
    ).toMatchObject({ ok: false, why: "closed" });
    expect(
      apply(
        wall,
        A,
        { t: "post", r: RID, pid: pid(), text: "x", lock: lockOf(KEY_A) },
        { removed: new Set([A]) }
      )
    ).toMatchObject({ ok: false, why: "not-admitted" });
  });

  it("applies the same request once", () => {
    const wall = open();
    const intent: WallIntent = { t: "post", r: RID, pid: pid(), text: "once", lock: lockOf(KEY_A) };
    const first = applyWallIntent(wall, A, "iid_dup00001", intent, ctx());
    expect(first.ok).toBe(true);
    const again = applyWallIntent(first.wall, A, "iid_dup00001", intent, ctx());
    expect(again).toMatchObject({ ok: false, duplicate: true });
    expect(again.wall.round!.posts.size).toBe(1);
  });
});

describe("votes and take-backs", () => {
  it("gives each member one upvote per post, never on their own, and takes it back with its key", () => {
    const posted = post(open(), A, "Stop status meetings");
    const id = posted.id;
    let wall = posted.wall;
    expect(apply(wall, A, { t: "vote", r: RID, pid: id, lock: lockOf(KEY_A) })).toMatchObject({
      ok: false,
      why: "own-post",
    });
    let res = apply(wall, B, { t: "vote", r: RID, pid: id, lock: lockOf(KEY_B) });
    expect(res.ok).toBe(true);
    wall = res.wall;
    expect(
      apply(wall, B, { t: "vote", r: RID, pid: id, lock: lockOf("another_key_0123456") })
    ).toMatchObject({ ok: false, why: "already" });
    expect(wallView(wall).round!.posts![0].votes).toBe(1);
    // Someone claiming B's id without B's key can't take the vote back.
    expect(
      apply(wall, B, { t: "unvote", r: RID, pid: id, key: "guessed_key_0123456" })
    ).toMatchObject({
      ok: false,
      why: "not-yours",
    });
    res = apply(wall, B, { t: "unvote", r: RID, pid: id, key: KEY_B });
    expect(res.ok).toBe(true);
    expect(wallView(res.wall).round!.posts![0].votes).toBe(0);
  });

  it("takes a post back only with the key behind its lock", () => {
    const { wall, id } = post(open(), A, "Mine");
    expect(apply(wall, A, { t: "withdraw", r: RID, pid: id, key: KEY_B })).toMatchObject({
      ok: false,
      why: "not-yours",
    });
    expect(apply(wall, B, { t: "withdraw", r: RID, pid: id, key: KEY_A })).toMatchObject({
      ok: false,
      why: "not-yours",
    });
    const res = apply(wall, A, { t: "withdraw", r: RID, pid: id, key: KEY_A });
    expect(res.ok).toBe(true);
    expect(wallView(res.wall).round!.count).toBe(0);
  });

  it("keeps a taken-back post or vote taken back when its old request is replayed later", () => {
    let wall = open();
    const mine = pid();
    const postIntent: WallIntent = {
      t: "post",
      r: RID,
      pid: mine,
      text: "Retract me",
      lock: lockOf(KEY_A),
    };
    let res = applyWallIntent(wall, A, "iid_post0001", postIntent, ctx());
    expect(res.ok).toBe(true);
    now += WALL_LIMITS.postIntervalMs;
    const other = post(res.wall, C, "Keep me", "keyC_0123456789abcdef");
    wall = other.wall;
    const voteIntent: WallIntent = { t: "vote", r: RID, pid: other.id, lock: lockOf(KEY_B) };
    res = applyWallIntent(wall, B, "iid_vote0001", voteIntent, ctx());
    expect(res.ok).toBe(true);
    res = apply(res.wall, B, { t: "unvote", r: RID, pid: other.id, key: KEY_B });
    expect(res.ok).toBe(true);
    res = apply(res.wall, A, { t: "withdraw", r: RID, pid: mine, key: KEY_A });
    expect(res.ok).toBe(true);
    wall = res.wall;
    // Enough other requests that the short ring of request ids forgets both.
    for (let i = 0; i <= WALL_LIMITS.recentRing; i++) {
      wall = apply(wall, C, { t: "hand", up: i % 2 === 0 }).wall;
    }
    expect(wall.recent).not.toContain(`${A}:iid_post0001`);
    expect(wall.recent).not.toContain(`${B}:iid_vote0001`);

    const replayedPost = applyWallIntent(wall, A, "iid_post0001", postIntent, ctx());
    expect(replayedPost).toMatchObject({ ok: false, why: "already" });
    expect(wallView(replayedPost.wall).round!.posts!.map((p) => p.text)).toEqual(["Keep me"]);
    // The same post id under a fresh request is refused too.
    expect(
      apply(wall, A, { t: "post", r: RID, pid: mine, text: "Back again", lock: lockOf(KEY_A) })
    ).toMatchObject({ ok: false, why: "already" });

    const replayedVote = applyWallIntent(wall, B, "iid_vote0001", voteIntent, ctx());
    expect(replayedVote).toMatchObject({ ok: false, why: "already" });
    expect(wallView(replayedVote.wall).round!.posts![0].votes).toBe(0);
    // B can still upvote it again, with a new key.
    const again = apply(wall, B, {
      t: "vote",
      r: RID,
      pid: other.id,
      lock: lockOf("keyB2_0123456789abcd"),
    });
    expect(again.ok).toBe(true);
    expect(wallView(again.wall).round!.posts![0].votes).toBe(1);
  });

  it("caps one member's upvotes in a round, taken-back ones included", () => {
    const posted = post(open(), A, "Vote on me");
    let wall = posted.wall;
    for (let i = 0; i < WALL_LIMITS.maxVotesPerMember; i++) {
      const key = `keyB_${String(i).padStart(16, "0")}`;
      const voted = apply(wall, B, { t: "vote", r: RID, pid: posted.id, lock: lockOf(key) });
      expect(voted.ok).toBe(true);
      wall = apply(voted.wall, B, { t: "unvote", r: RID, pid: posted.id, key }).wall;
    }
    expect(
      apply(wall, B, { t: "vote", r: RID, pid: posted.id, lock: lockOf("keyB_last_0123456789") })
    ).toMatchObject({ ok: false, why: "member-cap" });
    // Others can still vote.
    expect(apply(wall, C, { t: "vote", r: RID, pid: posted.id, lock: lockOf(KEY_B) }).ok).toBe(
      true
    );
    // A new round starts everyone afresh.
    const next = openWallRound(wall, "round_000002", "Next question", "live")!;
    expect(next.round!.votesBy.size).toBe(0);
    expect(next.round!.spentLocks.size).toBe(0);
    expect(next.round!.withdrawn.size).toBe(0);
  });

  it("takes no votes while posts are hidden until reveal", () => {
    const posted = post(open("hidden"), A, "Secret");
    const id = posted.id;
    let wall = posted.wall;
    expect(apply(wall, B, { t: "vote", r: RID, pid: id, lock: lockOf(KEY_B) })).toMatchObject({
      ok: false,
      why: "closed",
    });
    wall = revealWall(wall);
    // Reveal stops posts and votes; the host takes them again by choice.
    expect(apply(wall, B, { t: "vote", r: RID, pid: id, lock: lockOf(KEY_B) })).toMatchObject({
      ok: false,
      why: "closed",
    });
    wall = setWallOpen(wall, true);
    expect(apply(wall, B, { t: "vote", r: RID, pid: id, lock: lockOf(KEY_B) }).ok).toBe(true);
  });

  it("stops taking posts at Reveal, so no post shows on its own after the rest", () => {
    const first = post(open("hidden"), A, "First thought");
    const wall = revealWall(first.wall);
    expect(wallView(wall).round).toMatchObject({ open: false, revealed: true, count: 1 });
    expect(wallView(wall).round!.posts!.map((p) => p.text)).toEqual(["First thought"]);
    expect(
      apply(wall, B, { t: "post", r: RID, pid: pid(), text: "Late one", lock: lockOf(KEY_B) })
    ).toMatchObject({ ok: false, why: "closed" });
    // A take-back still works on the closed round.
    const back = apply(wall, A, { t: "withdraw", r: RID, pid: first.id, key: KEY_A });
    expect(back.ok).toBe(true);
    expect(wallView(back.wall).round!.count).toBe(0);
    // Revealing again changes nothing, and a live round never closes by itself.
    expect(revealWall(wall)).toBe(wall);
    const live = open("live");
    expect(revealWall(live)).toBe(live);
  });
});

describe("the host's moves", () => {
  it("hides a post from the room and its save, and can show it again", () => {
    const posted = post(open(), A, "Rude");
    const id = posted.id;
    let wall = posted.wall;
    wall = post(wall, B, "Fine", KEY_B).wall;
    wall = hideWallPost(wall, id, true);
    expect(wallView(wall).round!.posts!.map((p) => p.text)).toEqual(["Fine"]);
    expect(wallView(wall).round!.count).toBe(1);
    expect(hostWallPosts(wall)!.find((p) => p.text === "Rude")).toMatchObject({ hidden: true });
    expect(
      toWallResult(wall, "audience-wall", "2026-11-12T10:00:00Z")!.posts.map((p) => p.text)
    ).toEqual(["Fine"]);
    wall = hideWallPost(wall, id, false);
    expect(wallView(wall).round!.count).toBe(2);
  });

  it("merges a duplicate: its text under the other, its votes joined, a double vote counted once", () => {
    let wall = open();
    const first = post(wall, A, "How do we deploy?");
    wall = first.wall;
    const dup = post(wall, B, "How does deploy work?", KEY_B);
    wall = dup.wall;
    // C upvotes both, A upvotes the duplicate.
    for (const [by, p, key] of [
      [C, first.id, "keyC1_0123456789abc"],
      [C, dup.id, "keyC2_0123456789abc"],
      [A, dup.id, "keyA2_0123456789abc"],
    ] as const) {
      const res = apply(wall, by, { t: "vote", r: RID, pid: p, lock: lockOf(key) });
      expect(res.ok).toBe(true);
      wall = res.wall;
    }
    wall = mergeWallPosts(wall, dup.id, first.id);
    const shown = wallView(wall).round!.posts!;
    expect(shown).toEqual([
      { id: first.id, text: "How do we deploy?", votes: 1, merged: ["How does deploy work?"] },
    ]);
    // A wrote the post merged into, so A's vote on the duplicate is dropped: C counts once.
    expect(shown[0].votes).toBe(1);
    // C can still take a vote back with either key.
    const res = apply(wall, C, { t: "unvote", r: RID, pid: dup.id, key: "keyC2_0123456789abc" });
    expect(res.ok).toBe(true);
    expect(wallView(res.wall).round!.posts![0].votes).toBe(0);
    // B takes back the merged post: its text leaves the other.
    const back = apply(wall, B, { t: "withdraw", r: RID, pid: dup.id, key: KEY_B });
    expect(back.ok).toBe(true);
    expect(wallView(back.wall).round!.posts![0].merged).toEqual([]);
  });

  it("keeps a hidden round's posts off the wire and out of the host's screen until Reveal", () => {
    let wall = post(open("hidden"), A, "Hidden thought").wall;
    const view = wallView(wall);
    expect(view.round).toMatchObject({ mode: "hidden", revealed: false, count: 1, posts: null });
    expect(JSON.stringify(view)).not.toContain("Hidden thought");
    expect(hostWallPosts(wall)).toBeNull();
    expect(toWallResult(wall, "audience-wall", "2026-11-12T10:00:00Z")).toBeNull();
    // A revealed round can't be hidden again.
    wall = revealWall(wall);
    expect(setWallMode(wall, "hidden")).toBe(wall);
    expect(wallView(wall).round!.posts![0].text).toBe("Hidden thought");
    // Switching a hidden round to live shows it, as Reveal does.
    const live = setWallMode(post(open("hidden"), A, "x").wall, "live");
    expect(wallView(live).round!.posts).not.toBeNull();
  });

  it("queues hands oldest first, lets the host lower any, and drops people who left", () => {
    let wall = open();
    for (const by of [B, A]) {
      const res = apply(wall, by, { t: "hand", up: true });
      expect(res.ok).toBe(true);
      wall = res.wall;
      now += 1;
    }
    expect(wallView(wall).hands).toEqual([B, A]);
    wall = lowerHand(wall, B);
    expect(wallView(wall).hands).toEqual([A]);
    wall = keepPresentHands(wall, new Set([HOST, B]));
    expect(wallView(wall).hands).toEqual([]);
  });
});

describe("what the room sees and what is saved", () => {
  it("shares no author or voter, and saves the prompt, texts and votes with no ids", () => {
    let wall = open();
    const a = post(wall, A, "Fewer meetings");
    wall = a.wall;
    wall = post(wall, B, "More pairing", KEY_B).wall;
    wall = apply(wall, C, {
      t: "vote",
      r: RID,
      pid: a.id,
      lock: lockOf("keyC_0123456789abcd"),
    }).wall;
    const shared = JSON.stringify(wallView(wall));
    for (const member of [A, B, C]) expect(shared).not.toContain(member);
    const result = toWallResult(wall, "audience-wall", "2026-11-12T10:00:00.000Z")!;
    expect(result).toEqual({
      roundId: RID,
      tool: "audience-wall",
      prompt: "What should we stop doing?",
      closedAt: "2026-11-12T10:00:00.000Z",
      mode: "live",
      posts: [
        { text: "Fewer meetings", votes: 1, merged: [] },
        { text: "More pairing", votes: 0, merged: [] },
      ],
    });
    const json = JSON.stringify(result);
    for (const member of [A, B, C]) expect(json).not.toContain(member);
    expect(json).not.toContain(a.id);
    expect(wallRoundMarkdown(result)).toContain("| Fewer meetings | 1 |");
  });
});

describe("readWallState", () => {
  function body(over: Partial<WallStateBody> = {}): WallStateBody {
    const v = wallView(post(open(), A, "One").wall);
    return {
      v: 1,
      by: HOST,
      seq: 1,
      tool: "audience-wall",
      endsAt: Date.now() + 3_600_000,
      keys: KEYS,
      round: v.round,
      hands: [],
      acks: [],
      nacks: [],
      ...over,
    };
  }
  const wire = (b: object) => JSON.parse(JSON.stringify({ ...b, sig: SIG })) as unknown;

  it("accepts exactly what the host builds", () => {
    const b = body({ acks: ["iid_00000001"], nacks: [{ iid: "iid_00000002", why: "rate" }] });
    expect(readWallState(wire(b), "audience-wall")).toEqual({ ...b, sig: SIG });
  });

  it("refuses posts in a round that is hidden until reveal", () => {
    const b = body();
    const sneaky = { ...b, round: { ...b.round!, mode: "hidden", revealed: false } };
    expect(readWallState(wire(sneaky), "audience-wall")).toBeNull();
    const hidden = { ...b, round: { ...b.round!, mode: "hidden", revealed: false, posts: null } };
    expect(readWallState(wire(hidden), "audience-wall")).not.toBeNull();
  });

  it.each<[string, object]>([
    ["a count that isn't the posts", { round: { ...body().round!, count: 2 } }],
    ["an unknown refusal", { nacks: [{ iid: "iid_00000002", why: "because" }] }],
    ["a bad hand", { hands: ["nobody"] }],
    ["another tool", { tool: "retro" }],
  ])("refuses %s", (_label, over) => {
    expect(readWallState(wire({ ...body(), ...over }), "audience-wall")).toBeNull();
  });

  it("signs the round, hands and answers under the wall domain", () => {
    const input = wallStateInput(body());
    expect(JSON.parse(input)[0]).toBe("agile-toolkit:wall-room:v1");
    expect(wallStateInput(body({ hands: [A] }))).not.toBe(input);
  });
});
