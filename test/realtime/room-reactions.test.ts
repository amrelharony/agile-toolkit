import { describe, expect, it } from "vitest";
import {
  REACTION_LIMITS,
  ROOM_REACTIONS,
  addFloating,
  createReactionLimiter,
  isReactionIndex,
  reactionLane,
  readReactionMessage,
  type FloatingReaction,
} from "@/lib/realtime/room-reactions";

/** Six emoji, sent as an index, held to a burst and then one every 2 s per member. */

const A = "member_aaaaaaaaa";
const B = "member_bbbbbbbbb";

describe("the six reactions", () => {
  it("are six emoji, each with its own plain label", () => {
    expect(ROOM_REACTIONS).toHaveLength(6);
    expect(new Set(ROOM_REACTIONS.map((r) => r.emoji)).size).toBe(6);
    expect(new Set(ROOM_REACTIONS.map((r) => r.label)).size).toBe(6);
    expect(isReactionIndex(0)).toBe(true);
    expect(isReactionIndex(5)).toBe(true);
    expect(isReactionIndex(6)).toBe(false);
    expect(isReactionIndex(-1)).toBe(false);
    expect(isReactionIndex(1.5)).toBe(false);
  });
});

describe("readReactionMessage", () => {
  it("rebuilds a reaction and drops anything else on it", () => {
    expect(readReactionMessage({ v: 1, by: A, r: 2, text: "hi" })).toEqual({ v: 1, by: A, r: 2 });
  });

  it("refuses anything that isn't one of the six from a well-formed sender", () => {
    for (const raw of [
      null,
      "👍",
      { v: 2, by: A, r: 0 },
      { v: 1, by: "", r: 0 },
      { v: 1, by: "bad id!", r: 0 },
      { v: 1, by: A, r: 6 },
      { v: 1, by: A, r: "0" },
      { v: 1, by: A, r: 0, pad: "x".repeat(200) },
    ]) {
      expect(readReactionMessage(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("the per-member limit", () => {
  it("lets a burst through, then one per refill, per member", () => {
    const limit = createReactionLimiter();
    const t = 1_000_000;
    for (let i = 0; i < REACTION_LIMITS.burst; i++) expect(limit.allow(A, t)).toBe(true);
    expect(limit.allow(A, t)).toBe(false);
    expect(limit.allow(A, t + REACTION_LIMITS.refillMs - 1)).toBe(false);
    expect(limit.allow(A, t + REACTION_LIMITS.refillMs + 1)).toBe(true);
    expect(limit.allow(A, t + REACTION_LIMITS.refillMs + 2)).toBe(false);
    // Someone else has their own budget.
    expect(limit.allow(B, t)).toBe(true);
  });

  it("holds a flood to the burst plus one per refill", () => {
    const limit = createReactionLimiter();
    let allowed = 0;
    // 100 a second for 10 s.
    for (let ms = 0; ms < 10_000; ms += 10) if (limit.allow(A, ms)) allowed++;
    expect(allowed).toBeLessThanOrEqual(REACTION_LIMITS.burst + 10_000 / REACTION_LIMITS.refillMs);
    expect(allowed).toBeGreaterThanOrEqual(REACTION_LIMITS.burst);
  });

  it("forgets the least recent sender past its cap, without breaking anyone's limit", () => {
    const limit = createReactionLimiter({ maxSenders: 3 });
    for (let i = 0; i < 3; i++) limit.allow(A, 0);
    expect(limit.allow(A, 0)).toBe(false);
    limit.allow("member_ccccccccc", 1);
    limit.allow("member_ddddddddd", 2);
    limit.allow("member_eeeeeeeee", 3);
    // A was forgotten, so it starts with a fresh burst: still at most `burst` at once.
    let again = 0;
    for (let i = 0; i < 10; i++) if (limit.allow(A, 4)) again++;
    expect(again).toBe(REACTION_LIMITS.burst);
  });
});

describe("on screen", () => {
  it("spreads lanes across the screen without chance", () => {
    const lanes = Array.from({ length: 50 }, (_, n) => reactionLane(n));
    for (const l of lanes) {
      expect(l).toBeGreaterThanOrEqual(0.08);
      expect(l).toBeLessThanOrEqual(0.92);
    }
    expect(reactionLane(3)).toBe(reactionLane(3));
    expect(new Set(lanes.map((l) => l.toFixed(3))).size).toBe(50);
  });

  it("keeps only the newest ones", () => {
    let list: FloatingReaction[] = [];
    for (let i = 0; i < REACTION_LIMITS.maxOnScreen + 5; i++) {
      list = addFloating(list, { key: `k${i}`, r: 0, lane: 0.5, at: i });
    }
    expect(list).toHaveLength(REACTION_LIMITS.maxOnScreen);
    expect(list[0].key).toBe("k5");
  });
});
