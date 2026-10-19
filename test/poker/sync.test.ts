import { describe, expect, it } from "vitest";
import {
  mergePokerState,
  clampVote,
  clampCurrentStoryIdx,
  redactVotesForBroadcast,
  electNewHost,
  REDACTED_VOTE,
} from "@/app/(tools)/planning-poker/merge";
import type { Session } from "@/app/(tools)/planning-poker/types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC123",
    sessionName: "Sprint 42",
    scale: ["1", "2", "3", "5", "8"],
    scaleType: "fibonacci",
    host: "Alice",
    hostId: "host-id",
    participants: [
      { id: "host-id", name: "Alice", vote: null },
      { id: "guest-1", name: "Bob", vote: null },
    ],
    stories: [
      { id: "s1", title: "Story 1", finalEstimate: null },
      { id: "s2", title: "Story 2", finalEstimate: null },
    ],
    currentStoryIdx: 0,
    revealed: false,
    ...overrides,
  };
}

function presence(...ids: string[]): Set<string> {
  return new Set(ids);
}

describe("mergePokerState — first contact (prev === null)", () => {
  it("bootstraps when sender is the claimed host and is present", () => {
    const next = session();
    const merged = mergePokerState({
      prev: null,
      next,
      envBy: "host-id",
      trustedHostId: null,
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "guest-1",
    });
    expect(merged).not.toBeNull();
    expect(merged?.hostId).toBe("host-id");
  });

  it("rejects bootstrap when sender is not the claimed host", () => {
    const next = session();
    const merged = mergePokerState({
      prev: null,
      next,
      envBy: "attacker",
      trustedHostId: null,
      presentMemberIds: presence("host-id", "attacker"),
      receiverId: "guest-1",
    });
    expect(merged).toBeNull();
  });

  it("rejects bootstrap when sender is not in members", () => {
    const next = session();
    const merged = mergePokerState({
      prev: null,
      next,
      envBy: "host-id",
      trustedHostId: null,
      presentMemberIds: presence("guest-1"),
      receiverId: "guest-1",
    });
    expect(merged).toBeNull();
  });
});

describe("mergePokerState — host impersonation defense", () => {
  it("rejects host-only mutations when sender forges by===next.hostId but is not the trusted host", () => {
    const prev = session();
    // Attacker crafts a malicious snapshot that claims they are the host,
    // matching the bug C1 pattern.
    const attackerSession = session({
      hostId: "attacker",
      host: "Mallory",
      stories: [{ id: "evil", title: "Evil story", finalEstimate: null }],
      revealed: true,
      currentStoryIdx: 0,
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "attacker", name: "Mallory", vote: null },
      ],
    });
    const merged = mergePokerState({
      prev,
      next: attackerSession,
      envBy: "attacker",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1", "attacker"),
      receiverId: "guest-1",
    });
    expect(merged).not.toBeNull();
    expect(merged?.hostId).toBe("host-id");
    expect(merged?.stories).toEqual(prev.stories);
    expect(merged?.revealed).toBe(false);
  });

  it("rejects trusted-host mutations when the claimant is not in members", () => {
    const prev = session();
    const evil = session({ stories: [{ id: "x", title: "x", finalEstimate: null }] });
    const merged = mergePokerState({
      prev,
      next: evil,
      envBy: "host-id",
      trustedHostId: "host-id",
      presentMemberIds: presence("guest-1"),
      receiverId: "guest-1",
    });
    expect(merged?.stories).toEqual(prev.stories);
  });

  it("accepts host-only mutations from the trusted host present in members", () => {
    const prev = session();
    const next = session({
      stories: [
        { id: "s1", title: "Story 1", finalEstimate: null },
        { id: "s2", title: "Story 2", finalEstimate: null },
        { id: "s3", title: "Story 3", finalEstimate: null },
      ],
    });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "host-id",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "guest-1",
    });
    expect(merged?.stories).toHaveLength(3);
  });
});

describe("mergePokerState — guest defense (C2)", () => {
  it("bounds non-host senders to their own participant row", () => {
    const prev = session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "guest-1", name: "Bob", vote: null },
        { id: "guest-2", name: "Carol", vote: null },
      ],
    });
    // guest-2 maliciously crafts a snapshot with everything changed,
    // including flipping revealed=true and rewriting other peers' votes.
    const malicious = session({
      stories: [{ id: "evil", title: "evil", finalEstimate: null }],
      revealed: true,
      participants: [
        { id: "host-id", name: "Alice", vote: "999" },
        { id: "guest-1", name: "Bob", vote: "999" },
        { id: "guest-2", name: "Carol", vote: "5" },
      ],
    });
    const merged = mergePokerState({
      prev,
      next: malicious,
      envBy: "guest-2",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1", "guest-2"),
      receiverId: "guest-1",
    });
    expect(merged?.revealed).toBe(false);
    expect(merged?.stories).toEqual(prev.stories);
    // Other peers' votes are preserved.
    expect(merged?.participants.find((p) => p.id === "host-id")?.vote).toBeNull();
    expect(merged?.participants.find((p) => p.id === "guest-1")?.vote).toBeNull();
    // guest-2's own row updates.
    expect(merged?.participants.find((p) => p.id === "guest-2")?.vote).toBe("5");
  });

  it("rejects non-host sender not present in members", () => {
    const prev = session();
    const next = session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "guest-1", name: "Bob", vote: "5" },
      ],
    });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "guest-1",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id"),
      receiverId: "host-id",
    });
    expect(merged?.participants.find((p) => p.id === "guest-1")?.vote).toBeNull();
  });
});

describe("mergePokerState — vote scale bounds (H8)", () => {
  it("drops votes outside the local scale to null", () => {
    const prev = session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "guest-1", name: "Bob", vote: null },
      ],
    });
    const next = session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "guest-1", name: "Bob", vote: "999" },
      ],
    });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "guest-1",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "host-id",
    });
    expect(merged?.participants.find((p) => p.id === "guest-1")?.vote).toBeNull();
  });

  it("accepts a vote that is in scale", () => {
    const prev = session();
    const next = session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "guest-1", name: "Bob", vote: "5" },
      ],
    });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "guest-1",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "host-id",
    });
    expect(merged?.participants.find((p) => p.id === "guest-1")?.vote).toBe("5");
  });

  it("preserves the redacted sentinel", () => {
    const prev = session();
    const next = session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "guest-1", name: "Bob", vote: REDACTED_VOTE },
      ],
    });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "host-id",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "guest-1",
    });
    expect(merged?.participants.find((p) => p.id === "guest-1")?.vote).toBe(REDACTED_VOTE);
  });

  it("preserves receiver's own real vote against incoming redaction", () => {
    const prev = session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "guest-1", name: "Bob", vote: "5" },
      ],
    });
    // Host's heartbeat redacts everyone's vote.
    const next = session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "guest-1", name: "Bob", vote: REDACTED_VOTE },
      ],
    });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "host-id",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "guest-1",
    });
    expect(merged?.participants.find((p) => p.id === "guest-1")?.vote).toBe("5");
  });
});

describe("mergePokerState — currentStoryIdx bounds (M12)", () => {
  it("clamps out-of-range index to 0", () => {
    const prev = session();
    const next = session({ currentStoryIdx: 99 });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "host-id",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "guest-1",
    });
    expect(merged?.currentStoryIdx).toBe(0);
  });

  it("keeps in-range index", () => {
    const prev = session();
    const next = session({ currentStoryIdx: 1 });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "host-id",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "guest-1",
    });
    expect(merged?.currentStoryIdx).toBe(1);
  });
});

describe("mergePokerState — hostId change rejection", () => {
  it("rejects hostId change from a non-host peer", () => {
    const prev = session();
    const next = session({ hostId: "attacker", host: "Mallory" });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "guest-1",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "host-id",
    });
    expect(merged?.hostId).toBe("host-id");
    expect(merged?.host).toBe("Alice");
  });

  it("accepts hostId change from the elected migration target", () => {
    const prev = session();
    const next = session({
      hostId: "guest-1",
      host: "Bob",
    });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "guest-1",
      trustedHostId: "host-id",
      presentMemberIds: presence("guest-1"),
      receiverId: "guest-2",
      electedHostId: "guest-1",
    });
    expect(merged?.hostId).toBe("guest-1");
    expect(merged?.host).toBe("Bob");
  });
});

describe("redactVotesForBroadcast (H7)", () => {
  it("leaves the snapshot unchanged when revealed", () => {
    const s = session({
      revealed: true,
      participants: [
        { id: "host-id", name: "Alice", vote: "5" },
        { id: "guest-1", name: "Bob", vote: "8" },
      ],
    });
    expect(redactVotesForBroadcast(s, "host-id")).toBe(s);
  });

  it("redacts other peers' non-null votes to the sentinel", () => {
    const s = session({
      participants: [
        { id: "host-id", name: "Alice", vote: "5" },
        { id: "guest-1", name: "Bob", vote: "8" },
        { id: "guest-2", name: "Carol", vote: null },
      ],
    });
    const out = redactVotesForBroadcast(s, "host-id");
    expect(out.participants.find((p) => p.id === "host-id")?.vote).toBe("5");
    expect(out.participants.find((p) => p.id === "guest-1")?.vote).toBe(REDACTED_VOTE);
    expect(out.participants.find((p) => p.id === "guest-2")?.vote).toBeNull();
  });
});

describe("clampVote", () => {
  it("keeps null", () => {
    expect(clampVote(null, new Set(["1", "2"]))).toBeNull();
  });
  it("keeps in-scale values", () => {
    expect(clampVote("2", new Set(["1", "2"]))).toBe("2");
  });
  it("drops out-of-scale values to null", () => {
    expect(clampVote("999", new Set(["1", "2"]))).toBeNull();
  });
  it("preserves the redaction sentinel", () => {
    expect(clampVote(REDACTED_VOTE, new Set(["1", "2"]))).toBe(REDACTED_VOTE);
  });
});

describe("clampCurrentStoryIdx", () => {
  it("clamps negative index to 0 (or keeps 0 when stories empty)", () => {
    const s = clampCurrentStoryIdx(session({ stories: [], currentStoryIdx: -5 }));
    expect(s.currentStoryIdx).toBe(0);
  });
  it("clamps out-of-range index to 0", () => {
    const s = clampCurrentStoryIdx(session({ currentStoryIdx: 99 }));
    expect(s.currentStoryIdx).toBe(0);
  });
  it("keeps in-range index unchanged", () => {
    const s = clampCurrentStoryIdx(session({ currentStoryIdx: 1 }));
    expect(s.currentStoryIdx).toBe(1);
  });
});

describe("electNewHost", () => {
  it("returns the earliest-joined non-missing-host candidate", () => {
    const elected = electNewHost(
      [
        { id: "host-id", name: "Alice", color: "#fff", joinedAt: "2026-01-01T00:00:00Z" },
        { id: "guest-1", name: "Bob", color: "#fff", joinedAt: "2026-01-01T00:00:05Z" },
        { id: "guest-2", name: "Carol", color: "#fff", joinedAt: "2026-01-01T00:00:03Z" },
      ],
      "host-id"
    );
    expect(elected?.id).toBe("guest-2");
  });

  it("returns null when no candidates remain", () => {
    const elected = electNewHost(
      [{ id: "host-id", name: "Alice", color: "#fff", joinedAt: "2026-01-01T00:00:00Z" }],
      "host-id"
    );
    expect(elected).toBeNull();
  });
});

/**
 * Visitor live rooms: the host passes `admit` so a member it removed
 * (its blocklist) or one past the 20-member cap changes nothing, even
 * while they stay connected. Owner and guest rooms pass no `admit`.
 */
describe("mergePokerState — admission (visitor rooms)", () => {
  const withGuestVote = (vote: string) =>
    session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "guest-1", name: "Bob", vote },
      ],
    });

  it("lets an admitted sender change its own row", () => {
    const prev = session();
    const merged = mergePokerState({
      prev,
      next: withGuestVote("5"),
      envBy: "guest-1",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "host-id",
      admit: () => true,
    });
    expect(merged?.participants.find((p) => p.id === "guest-1")?.vote).toBe("5");
  });

  it("ignores every row from a blocked sender, even its own", () => {
    const blocked = new Set(["guest-1"]);
    const prev = session();
    const merged = mergePokerState({
      prev,
      next: withGuestVote("5"),
      envBy: "guest-1",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "host-id",
      admit: (id) => !blocked.has(id),
    });
    expect(merged).toBe(prev);
  });

  it("does not re-seat a removed member who sends their row again", () => {
    // The host removed guest-1; their client keeps broadcasting a session
    // with their row added back.
    const prev = session({ participants: [{ id: "host-id", name: "Alice", vote: null }] });
    const blocked = new Set(["guest-1"]);
    const merged = mergePokerState({
      prev,
      next: withGuestVote("8"),
      envBy: "guest-1",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "host-id",
      admit: (id) => !blocked.has(id),
    });
    expect(merged?.participants.map((p) => p.id)).toEqual(["host-id"]);
  });

  it("ignores a sender past the member cap (present, but not seated)", () => {
    // Presence shows 21 people; the host's ledger seats the first 20.
    const seated = new Set(["host-id", ...Array.from({ length: 19 }, (_, i) => `m${i}`)]);
    const prev = session({ participants: [{ id: "host-id", name: "Alice", vote: null }] });
    const next = session({
      participants: [
        { id: "host-id", name: "Alice", vote: null },
        { id: "late-21", name: "Late", vote: "3" },
      ],
    });
    const merged = mergePokerState({
      prev,
      next,
      envBy: "late-21",
      trustedHostId: "host-id",
      presentMemberIds: presence(...Array.from(seated), "late-21"),
      receiverId: "host-id",
      admit: (id) => seated.has(id),
    });
    expect(merged).toBe(prev);
  });

  it("refuses a blocked sender's bootstrap and host claims too", () => {
    const admit = (id: string) => id !== "attacker";
    expect(
      mergePokerState({
        prev: null,
        next: session({ hostId: "attacker" }),
        envBy: "attacker",
        trustedHostId: null,
        presentMemberIds: presence("attacker", "guest-1"),
        receiverId: "guest-1",
        admit,
      })
    ).toBeNull();

    // Even as the elected migration target, a refused sender changes nothing.
    const prev = session();
    expect(
      mergePokerState({
        prev,
        next: session({ hostId: "attacker", revealed: true }),
        envBy: "attacker",
        trustedHostId: "host-id",
        presentMemberIds: presence("attacker", "guest-1"),
        receiverId: "guest-1",
        electedHostId: "attacker",
        admit,
      })
    ).toBe(prev);
  });

  it("refuses a sender with no id when admit is set", () => {
    const prev = session();
    expect(
      mergePokerState({
        prev,
        next: withGuestVote("5"),
        envBy: null,
        trustedHostId: "host-id",
        presentMemberIds: presence("host-id", "guest-1"),
        receiverId: "host-id",
        admit: () => true,
      })
    ).toBe(prev);
  });

  it("leaves owner and guest rooms (no admit) exactly as before", () => {
    const prev = session();
    const merged = mergePokerState({
      prev,
      next: withGuestVote("5"),
      envBy: "guest-1",
      trustedHostId: "host-id",
      presentMemberIds: presence("host-id", "guest-1"),
      receiverId: "host-id",
    });
    expect(merged?.participants.find((p) => p.id === "guest-1")?.vote).toBe("5");
  });
});
