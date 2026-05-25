import { describe, expect, it } from "vitest";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Unit tests for the HMAC sign/verify logic used by `getGuestSession`
 * in src/lib/auth/guest-session.ts. The full helper depends on
 * next/headers and the Supabase client; here we exercise the
 * cryptographic primitives directly to catch regressions in the
 * signing format.
 */

function sign(profileId: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(profileId).digest("base64url");
  return `${profileId}.${sig}`;
}

function verify(value: string, secret: string): boolean {
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const profileId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(profileId).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

describe("guest-session HMAC", () => {
  const profileId = "11111111-1111-1111-1111-111111111111";
  const secret = randomBytes(32).toString("base64url");

  it("verifies a signature it just produced", () => {
    const cookie = sign(profileId, secret);
    expect(verify(cookie, secret)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const cookie = sign(profileId, secret);
    const dot = cookie.indexOf(".");
    const tampered =
      cookie.slice(0, dot + 1) +
      (cookie.charAt(dot + 1) === "a" ? "b" : "a") +
      cookie.slice(dot + 2);
    expect(verify(tampered, secret)).toBe(false);
  });

  it("rejects a signature signed with the wrong secret", () => {
    const cookie = sign(profileId, secret);
    const otherSecret = randomBytes(32).toString("base64url");
    expect(verify(cookie, otherSecret)).toBe(false);
  });

  it("rejects a missing or malformed value", () => {
    expect(verify("", secret)).toBe(false);
    expect(verify("no-dot-here", secret)).toBe(false);
    expect(verify(".", secret)).toBe(false);
    expect(verify(`${profileId}.`, secret)).toBe(false);
  });

  it("rejects an attacker swapping in a different profile id", () => {
    // Attacker has a valid signature for profileId, tries to claim a
    // different profile id by replacing the prefix. The HMAC is keyed
    // on the profileId itself, so swapping the prefix breaks the check.
    const cookie = sign(profileId, secret);
    const sig = cookie.split(".")[1];
    const otherProfileId = "22222222-2222-2222-2222-222222222222";
    expect(verify(`${otherProfileId}.${sig}`, secret)).toBe(false);
  });
});
