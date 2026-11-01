// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  VIP_COOKIE_MAX_AGE,
  VIP_COOKIE_PATH,
  VIP_KEY_HASHES,
  isVipKey,
  normalizeVipKey,
} from "@/lib/vip/book-access";

/**
 * The VIP gate: a key from the link printed in the book whose SHA-256 is
 * listed. Tests use their own key and hash — the real key never appears in
 * the repo, only its hash.
 */

const KEY = "testkey12345";
const HASHES = [createHash("sha256").update(KEY).digest("hex")];

describe("isVipKey", () => {
  it("accepts a key whose hash is listed", async () => {
    expect(await isVipKey(KEY, HASHES)).toBe(true);
  });

  it("tolerates case and surrounding spaces from a typed-in link", async () => {
    expect(await isVipKey("  TESTKEY12345 ", HASHES)).toBe(true);
  });

  it("rejects other keys, empty values and absurdly long input", async () => {
    expect(await isVipKey("testkey12346", HASHES)).toBe(false);
    expect(await isVipKey("", HASHES)).toBe(false);
    expect(await isVipKey("   ", HASHES)).toBe(false);
    expect(await isVipKey(undefined, HASHES)).toBe(false);
    expect(await isVipKey(null, HASHES)).toBe(false);
    expect(await isVipKey(KEY.repeat(10), HASHES)).toBe(false);
  });

  it("does not accept a hash in place of the key", async () => {
    expect(await isVipKey(HASHES[0], HASHES)).toBe(false);
  });

  it("rejects the test key against the real list", async () => {
    expect(await isVipKey(KEY)).toBe(false);
  });
});

describe("normalizeVipKey", () => {
  it("lowercases and trims, and drops what can't be a key", () => {
    expect(normalizeVipKey(" AbC ")).toBe("abc");
    expect(normalizeVipKey("")).toBeNull();
    expect(normalizeVipKey("x".repeat(65))).toBeNull();
  });
});

describe("the real key list", () => {
  it("holds SHA-256 hex digests only, never a plain key", () => {
    expect(VIP_KEY_HASHES.length).toBeGreaterThan(0);
    for (const hash of VIP_KEY_HASHES) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the access cookie", () => {
  it("covers the whole site, so any tool can offer VIP features", () => {
    expect(VIP_COOKIE_PATH).toBe("/");
  });

  it("lasts as long as a browser allows (400 days)", () => {
    expect(VIP_COOKIE_MAX_AGE).toBe(34_560_000);
  });
});
