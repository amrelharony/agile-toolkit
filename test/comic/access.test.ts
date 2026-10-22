// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Next aliases "server-only" at build time; outside Next it is just a marker.
vi.mock("server-only", () => ({}));

import { COMIC_LINK_TOKEN_SHA256, isValidComicToken } from "@/lib/comic/access";

/**
 * The private comic link's token check. Only a hash of the real token is in
 * the repo, so these tests mint their own token and pass its hash in — the
 * real token never appears here.
 */

const TEST_TOKEN = randomBytes(24).toString("base64url");
const TEST_HASH = createHash("sha256").update(TEST_TOKEN).digest("hex");

describe("isValidComicToken", () => {
  it("accepts the token whose hash is allowed", () => {
    expect(TEST_TOKEN).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(isValidComicToken(TEST_TOKEN, [TEST_HASH])).toBe(true);
  });

  it("accepts it among several allowed hashes, in any position", () => {
    const other = createHash("sha256").update("another-token-0123456789AB").digest("hex");
    expect(isValidComicToken(TEST_TOKEN, [other, TEST_HASH])).toBe(true);
    expect(isValidComicToken(TEST_TOKEN, [TEST_HASH, other])).toBe(true);
  });

  it("rejects a well-formed token that hashes to something else", () => {
    const wrong = randomBytes(24).toString("base64url");
    expect(isValidComicToken(wrong, [TEST_HASH])).toBe(false);
    // One character off.
    const flipped = TEST_TOKEN.slice(0, -1) + (TEST_TOKEN.endsWith("A") ? "B" : "A");
    expect(isValidComicToken(flipped, [TEST_HASH])).toBe(false);
  });

  it("rejects the hash itself used as the token", () => {
    expect(isValidComicToken(TEST_HASH, [TEST_HASH])).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 123456789012345678901234567890],
    ["an object", { token: "x" }],
    ["an array", ["AbCdEf0123456789_-AbCdEf"]],
  ])("rejects %s without hashing it", (_label, value) => {
    expect(isValidComicToken(value, [TEST_HASH])).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["too short (23 chars)", "A".repeat(23)],
    ["too long (129 chars)", "A".repeat(129)],
    ["a dot", `${TEST_TOKEN.slice(0, 30)}.x`],
    ["a slash", `${TEST_TOKEN.slice(0, 30)}/x`],
    ["a space", `${TEST_TOKEN.slice(0, 30)} x`],
    ["percent-encoding", `${TEST_TOKEN.slice(0, 28)}%2F00`],
    ["base64 padding", `${TEST_TOKEN}==`],
    ["a non-ASCII letter", `${TEST_TOKEN.slice(0, 30)}é`],
    ["a trailing newline", `${TEST_TOKEN}\n`],
  ])("rejects a token with %s", (_label, value) => {
    expect(isValidComicToken(value, [TEST_HASH])).toBe(false);
  });

  it("accepts the shortest and longest allowed formats when their hash matches", () => {
    for (const token of ["a".repeat(24), "b".repeat(128)]) {
      const hash = createHash("sha256").update(token).digest("hex");
      expect(isValidComicToken(token, [hash])).toBe(true);
    }
  });

  it("skips malformed allowed hashes instead of throwing on a length mismatch", () => {
    const malformed = ["", "abc", "zz".repeat(32), TEST_HASH.slice(0, 62), `${TEST_HASH}00`];
    expect(() => isValidComicToken(TEST_TOKEN, malformed)).not.toThrow();
    expect(isValidComicToken(TEST_TOKEN, malformed)).toBe(false);
    // A good hash after the malformed ones still counts.
    expect(isValidComicToken(TEST_TOKEN, [...malformed, TEST_HASH])).toBe(true);
  });

  it("allows nothing when no hash is configured", () => {
    expect(isValidComicToken(TEST_TOKEN, [])).toBe(false);
  });

  it("checks against the committed hash by default", () => {
    // The test token is random, so it can't be the real one.
    expect(isValidComicToken(TEST_TOKEN)).toBe(false);
  });
});

describe("COMIC_LINK_TOKEN_SHA256", () => {
  it("is a lowercase hex SHA-256 digest (64 chars), not a raw token", () => {
    expect(COMIC_LINK_TOKEN_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
