import { describe, expect, it } from "vitest";
import { sealOf } from "@/lib/realtime/sender-tie";
import {
  VOTE_MAX_SENDERS,
  isVoteTabSecret,
  precheckSender,
  tieBallotSender,
} from "@/lib/realtime/vote-room/aggregate";

/**
 * The vote host's two steps of the sender tie, pure: the cheap check on a
 * ballot's envelope before anything is opened, and the tie once the
 * ballot's tab secret opened (the hook keeps it only for a counted ballot).
 */

const A = "alice_0000000000";
const B = "bobby_0000000000";
const SECRET_A = "secretA_0123456789xyz"; // 21 characters, like nanoid(21)
const SECRET_B = "secretB_0123456789xyz";
const tab = { epk: "T".repeat(87), iv: "t".repeat(16), ct: "s".repeat(50) };

describe("the vote host's tie steps", () => {
  it("takes exactly 21 URL-safe characters as a ballot's tab secret", () => {
    expect(isVoteTabSecret(SECRET_A)).toBe(true);
    expect(isVoteTabSecret("a".repeat(20))).toBe(false);
    expect(isVoteTabSecret("a".repeat(22))).toBe(false);
    expect(isVoteTabSecret(`${"a".repeat(20)}+`)).toBe(false);
    expect(isVoteTabSecret(null)).toBe(false);
  });

  it("refuses cheaply only a ballot of the other kind than the id's tie", () => {
    const none = new Map<string, string>();
    expect(precheckSender({ by: A }, none)).toBeNull();
    expect(precheckSender({ by: A, tab }, none)).toBeNull();
    const withSecret = new Map([[A, sealOf(SECRET_A)]]);
    expect(precheckSender({ by: A, tab }, withSecret)).toBeNull(); // opened and compared later
    expect(precheckSender({ by: A }, withSecret)).toBe("not-yours");
    const legacy = new Map([[A, ""]]);
    expect(precheckSender({ by: A }, legacy)).toBeNull();
    expect(precheckSender({ by: A, tab }, legacy)).toBe("not-yours");
  });

  it("ties an id to the first secret and refuses another, or none, later", () => {
    const first = tieBallotSender(new Map(), A, SECRET_A);
    if (!first.ok) throw new Error("tie refused");
    expect(first.senders.get(A)).toBe(sealOf(SECRET_A));
    // The map keeps a seal, never the secret.
    expect(JSON.stringify(Array.from(first.senders))).not.toContain(SECRET_A);
    expect(tieBallotSender(first.senders, A, SECRET_A).ok).toBe(true);
    expect(tieBallotSender(first.senders, A, SECRET_B)).toEqual({ ok: false, reason: "not-yours" });
    expect(tieBallotSender(first.senders, A, null)).toEqual({ ok: false, reason: "not-yours" });
    // Legacy ballots (no tab) keep counting under an id tied to none.
    const legacy = tieBallotSender(new Map(), B, null);
    if (!legacy.ok) throw new Error("tie refused");
    expect(tieBallotSender(legacy.senders, B, null).ok).toBe(true);
    expect(tieBallotSender(legacy.senders, B, SECRET_B)).toEqual({
      ok: false,
      reason: "not-yours",
    });
  });

  it("never changes the map it was given", () => {
    const senders = new Map([[A, sealOf(SECRET_A)]]);
    const res = tieBallotSender(senders, B, SECRET_B);
    expect(res.ok).toBe(true);
    expect(Array.from(senders)).toEqual([[A, sealOf(SECRET_A)]]);
  });

  it("refuses a new id past VOTE_MAX_SENDERS as a full room would", () => {
    const full = new Map(
      Array.from({ length: VOTE_MAX_SENDERS }, (_, i) => [`m${String(i).padStart(15, "0")}`, ""])
    );
    expect(tieBallotSender(full, A, SECRET_A)).toEqual({ ok: false, reason: "round-full" });
    expect(tieBallotSender(full, `m${"0".repeat(15)}`, null).ok).toBe(true);
  });
});
