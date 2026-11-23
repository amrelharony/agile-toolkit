import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSenderSecret, sealOf, tieSender } from "@/lib/realtime/sender-tie";
import { tabSecret } from "@/lib/realtime/tab-secret";
import { sha256Base64Url } from "@/lib/realtime/sha256";
import { isSenderSecret as wallIsSenderSecret, lockOf } from "@/lib/realtime/wall-room/protocol";
import { tabSecret as wallTabSecret } from "@/lib/realtime/wall-room/memo";

/**
 * The tie between a self-declared member id and the tab that first used
 * it, shared by the wall rooms and the vote rounds: the seal, the tie, and
 * the tab's secret in sessionStorage (the wall's key unchanged).
 */

/** Exactly 21 URL-safe characters, as a vote ballot's secret must be. */
const exactly21 = (v: unknown): v is string => isSenderSecret(v) && v.length === 21;

const A = "alice_0000000000";
const B = "bobby_0000000000";
const SECRET_A = "secretA_0123456789xyz"; // 21 characters
const SECRET_B = "secretB_0123456789xyz";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("sender-tie", () => {
  it("takes a secret of 16 to 64 URL-safe characters, as the wall always did", () => {
    expect(isSenderSecret("a".repeat(16))).toBe(true);
    expect(isSenderSecret("a".repeat(64))).toBe(true);
    for (const bad of ["a".repeat(15), "a".repeat(65), "with space_01234567", 21, null]) {
      expect(isSenderSecret(bad)).toBe(false);
    }
    // The wall's export is the shared one.
    expect(wallIsSenderSecret).toBe(isSenderSecret);
  });

  it("seals a secret as its SHA-256 (the wall's lock), and none as ''", () => {
    expect(sealOf(SECRET_A)).toBe(sha256Base64Url(SECRET_A));
    expect(sealOf(SECRET_A)).toBe(lockOf(SECRET_A));
    expect(sealOf(null)).toBe("");
    expect(sealOf(undefined)).toBe("");
    expect(sealOf("")).toBe("");
  });

  it("ties a new id, keeps the same map for a match, and refuses another seal", () => {
    const first = tieSender(undefined, A, sealOf(SECRET_A), 10);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(Array.from(first.senders)).toEqual([[A, sealOf(SECRET_A)]]);
    const again = tieSender(first.senders, A, sealOf(SECRET_A), 10);
    expect(again).toEqual({ ok: true, senders: first.senders });
    if (again.ok) expect(again.senders).toBe(first.senders);
    expect(tieSender(first.senders, A, sealOf(SECRET_B), 10)).toEqual({
      ok: false,
      why: "not-yours",
    });
    // Tied without a secret (an older build) is a tie too.
    expect(tieSender(first.senders, A, "", 10)).toEqual({ ok: false, why: "not-yours" });
  });

  it("never mutates the map, and refuses a new id once full (old ids stay)", () => {
    const one = tieSender(undefined, A, "", 1);
    if (!one.ok) throw new Error("tie refused");
    const before = Array.from(one.senders);
    expect(tieSender(one.senders, B, "", 1)).toEqual({ ok: false, why: "full" });
    expect(tieSender(one.senders, A, "", 1).ok).toBe(true);
    expect(Array.from(one.senders)).toEqual(before);
  });
});

describe("tab-secret", () => {
  it("makes a secret once, stores it under the prefix, and gives it back after a refresh", () => {
    const make = vi.fn(() => SECRET_A);
    expect(tabSecret("agile-toolkit:vote-room:", "ABCDEFGHJKMN", A, make)).toBe(SECRET_A);
    expect(window.sessionStorage.getItem(`agile-toolkit:vote-room:secret:ABCDEFGHJKMN:${A}`)).toBe(
      SECRET_A
    );
    expect(tabSecret("agile-toolkit:vote-room:", "ABCDEFGHJKMN", A, make)).toBe(SECRET_A);
    expect(make).toHaveBeenCalledTimes(1);
    // Another room or member gets its own.
    tabSecret("agile-toolkit:vote-room:", "ABCDEFGHJKMN", B, () => SECRET_B);
    expect(tabSecret("agile-toolkit:vote-room:", "ABCDEFGHJKMN", B, make)).toBe(SECRET_B);
  });

  it("makes a new one when the stored one isn't valid for the caller", () => {
    window.sessionStorage.setItem("p:secret:C:m", "a".repeat(30));
    // Valid for the wall's 16 to 64 rule, not for a vote's exactly 21.
    expect(tabSecret("p:", "C", "m", () => SECRET_A, exactly21)).toBe(SECRET_A);
    expect(window.sessionStorage.getItem("p:secret:C:m")).toBe(SECRET_A);
    window.sessionStorage.setItem("p:secret:C:m", "short");
    expect(tabSecret("p:", "C", "m", () => SECRET_B)).toBe(SECRET_B);
  });

  it("keeps the wall's key exactly as it was", () => {
    expect(wallTabSecret("ABCDEFGHJKMN", A, () => SECRET_A)).toBe(SECRET_A);
    expect(window.sessionStorage.getItem(`agile-toolkit:wall-room:secret:ABCDEFGHJKMN:${A}`)).toBe(
      SECRET_A
    );
  });

  it("works from memory alone when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(tabSecret("p:", "C", "m", () => SECRET_A)).toBe(SECRET_A);
  });
});
