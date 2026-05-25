import { describe, expect, it } from "vitest";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Unit tests for the HMAC sign/verify logic used by `getGuestSession`
 * in src/lib/auth/guest-session.ts. The full helper depends on
 * next/headers and the Supabase client; here we exercise the
 * cryptographic primitives directly to catch regressions in the
 * signing format.
 */

const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function signLegacy(profileId: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(profileId).digest("base64url");
  return `${profileId}.${sig}`;
}

function signCurrent(profileId: string, secret: string, iatSec?: number): string {
  const iat = iatSec ?? Math.floor(Date.now() / 1000);
  const payload = `${profileId}.${iat}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verify(value: string, secret: string, now = Date.now()): boolean {
  const parts = value.split(".");
  if (parts.length === 3) {
    const [profileId, iatStr, sig] = parts;
    if (!profileId || !iatStr || !sig) return false;
    const iat = Number(iatStr);
    if (!Number.isFinite(iat) || !Number.isInteger(iat) || iat <= 0) return false;
    const nowSec = Math.floor(now / 1000);
    if (iat > nowSec + 60) return false;
    if (nowSec - iat > COOKIE_MAX_AGE_SECONDS) return false;
    const expected = createHmac("sha256", secret)
      .update(`${profileId}.${iatStr}`)
      .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  if (parts.length === 2) {
    const [profileId, sig] = parts;
    if (!profileId || !sig) return false;
    const expected = createHmac("sha256", secret).update(profileId).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  return false;
}

describe("guest-session HMAC (legacy 2-part)", () => {
  const profileId = "11111111-1111-1111-1111-111111111111";
  const secret = randomBytes(32).toString("base64url");

  it("verifies a signature it just produced", () => {
    const cookie = signLegacy(profileId, secret);
    expect(verify(cookie, secret)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const cookie = signLegacy(profileId, secret);
    const dot = cookie.indexOf(".");
    const tampered =
      cookie.slice(0, dot + 1) +
      (cookie.charAt(dot + 1) === "a" ? "b" : "a") +
      cookie.slice(dot + 2);
    expect(verify(tampered, secret)).toBe(false);
  });

  it("rejects a signature signed with the wrong secret", () => {
    const cookie = signLegacy(profileId, secret);
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
    const cookie = signLegacy(profileId, secret);
    const sig = cookie.split(".")[1];
    const otherProfileId = "22222222-2222-2222-2222-222222222222";
    expect(verify(`${otherProfileId}.${sig}`, secret)).toBe(false);
  });
});

describe("guest-session HMAC (current 3-part w/ iat)", () => {
  const profileId = "11111111-1111-1111-1111-111111111111";
  const secret = randomBytes(32).toString("base64url");

  it("verifies a freshly issued cookie", () => {
    const cookie = signCurrent(profileId, secret);
    expect(verify(cookie, secret)).toBe(true);
  });

  it("rejects when the embedded iat is older than COOKIE_MAX_AGE", () => {
    const ancientIat = Math.floor(Date.now() / 1000) - COOKIE_MAX_AGE_SECONDS - 100;
    const cookie = signCurrent(profileId, secret, ancientIat);
    expect(verify(cookie, secret)).toBe(false);
  });

  it("rejects when the embedded iat is in the future (clock skew/tamper)", () => {
    const futureIat = Math.floor(Date.now() / 1000) + 3600;
    const cookie = signCurrent(profileId, secret, futureIat);
    expect(verify(cookie, secret)).toBe(false);
  });

  it("rejects when the signature was made for a different iat (replay-with-fresh-iat)", () => {
    const oldIat = Math.floor(Date.now() / 1000) - 1000;
    const cookie = signCurrent(profileId, secret, oldIat);
    const [pid, , sig] = cookie.split(".");
    // Try to "refresh" the iat without re-signing.
    const freshIat = Math.floor(Date.now() / 1000);
    const tampered = `${pid}.${freshIat}.${sig}`;
    expect(verify(tampered, secret)).toBe(false);
  });

  it("rejects a non-numeric iat", () => {
    const sig = createHmac("sha256", secret).update(`${profileId}.notanumber`).digest("base64url");
    expect(verify(`${profileId}.notanumber.${sig}`, secret)).toBe(false);
  });

  it("rejects when the signature is from the wrong secret", () => {
    const cookie = signCurrent(profileId, secret);
    const otherSecret = randomBytes(32).toString("base64url");
    expect(verify(cookie, otherSecret)).toBe(false);
  });
});
