// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Next aliases "server-only" at build time; outside Next it is just a marker.
vi.mock("server-only", () => ({}));

import {
  COMIC_LINK_TOKEN_SHA256,
  isComicTokenFormat,
  isValidComicTokenEdge,
} from "@/lib/comic/token";
import * as access from "@/lib/comic/access";

/**
 * The edge (Web Crypto) twin of access.ts's token check, which the
 * middleware runs to route /comic/<token>. Only a hash of the real token is
 * in the repo, so these tests mint their own token and pass its hash in —
 * the real token never appears here.
 */

const TEST_TOKEN = randomBytes(24).toString("base64url");
const TEST_HASH = createHash("sha256").update(TEST_TOKEN).digest("hex");

describe("isValidComicTokenEdge", () => {
  it("accepts the token whose hash is allowed", async () => {
    expect(TEST_TOKEN).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await isValidComicTokenEdge(TEST_TOKEN, [TEST_HASH])).toBe(true);
  });

  it("accepts it among several allowed hashes, in any position, in either case", async () => {
    const other = createHash("sha256").update("another-token-0123456789AB").digest("hex");
    expect(await isValidComicTokenEdge(TEST_TOKEN, [other, TEST_HASH])).toBe(true);
    expect(await isValidComicTokenEdge(TEST_TOKEN, [TEST_HASH, other])).toBe(true);
    expect(await isValidComicTokenEdge(TEST_TOKEN, [TEST_HASH.toUpperCase()])).toBe(true);
  });

  it("rejects a well-formed token that hashes to something else", async () => {
    const wrong = randomBytes(24).toString("base64url");
    expect(await isValidComicTokenEdge(wrong, [TEST_HASH])).toBe(false);
    // One character off.
    const flipped = TEST_TOKEN.slice(0, -1) + (TEST_TOKEN.endsWith("A") ? "B" : "A");
    expect(await isValidComicTokenEdge(flipped, [TEST_HASH])).toBe(false);
  });

  it("rejects the hash itself used as the token", async () => {
    expect(await isValidComicTokenEdge(TEST_HASH, [TEST_HASH])).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 123456789012345678901234567890],
    ["an object", { token: "x" }],
    ["an array", ["x".repeat(32)]],
    ["empty", ""],
    ["too short (23 chars)", "A".repeat(23)],
    ["too long (129 chars)", "A".repeat(129)],
    ["a dot", `${TEST_TOKEN.slice(0, 30)}.x`],
    ["a slash", `${TEST_TOKEN.slice(0, 30)}/x`],
    ["percent-encoding", `${TEST_TOKEN.slice(0, 28)}%2F00`],
    ["base64 padding", `${TEST_TOKEN}==`],
    ["a non-ASCII letter", `${TEST_TOKEN.slice(0, 30)}é`],
    ["a trailing newline", `${TEST_TOKEN}\n`],
  ])("rejects %s without hashing it", async (_label, value) => {
    const digest = vi.spyOn(crypto.subtle, "digest");
    expect(await isValidComicTokenEdge(value, [TEST_HASH])).toBe(false);
    expect(digest).not.toHaveBeenCalled();
    digest.mockRestore();
  });

  it("accepts the shortest and longest allowed formats when their hash matches", async () => {
    for (const token of ["a".repeat(24), "b".repeat(128)]) {
      const hash = createHash("sha256").update(token).digest("hex");
      expect(await isValidComicTokenEdge(token, [hash])).toBe(true);
    }
  });

  it("skips malformed allowed hashes instead of throwing", async () => {
    const malformed = ["", "abc", "zz".repeat(32), TEST_HASH.slice(0, 62), `${TEST_HASH}00`];
    await expect(isValidComicTokenEdge(TEST_TOKEN, malformed)).resolves.toBe(false);
    // A good hash after the malformed ones still counts.
    expect(await isValidComicTokenEdge(TEST_TOKEN, [...malformed, TEST_HASH])).toBe(true);
  });

  it("allows nothing when no hash is configured", async () => {
    expect(await isValidComicTokenEdge(TEST_TOKEN, [])).toBe(false);
  });

  it("checks against the committed hash by default", async () => {
    // The test token is random, so it can't be the real one.
    expect(await isValidComicTokenEdge(TEST_TOKEN)).toBe(false);
  });

  it("agrees with the page's node:crypto check", async () => {
    const tokens = [TEST_TOKEN, randomBytes(24).toString("base64url"), "x".repeat(32), "short"];
    for (const token of tokens) {
      expect(await isValidComicTokenEdge(token, [TEST_HASH])).toBe(
        access.isValidComicToken(token, [TEST_HASH])
      );
    }
  });
});

describe("isComicTokenFormat", () => {
  it.each([
    ["x".repeat(32), true],
    ["Ab-_".repeat(8), true],
    ["x".repeat(23), false],
    ["x".repeat(129), false],
    [`${"x".repeat(31)}.`, false],
    [42, false],
  ])("%j → %s", (value, expected) => {
    expect(isComicTokenFormat(value)).toBe(expected);
  });
});

describe("COMIC_LINK_TOKEN_SHA256", () => {
  it("is a lowercase hex SHA-256 digest (64 chars), not a raw token", () => {
    expect(COMIC_LINK_TOKEN_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the one hash both checks use", () => {
    expect(access.COMIC_LINK_TOKEN_SHA256).toBe(COMIC_LINK_TOKEN_SHA256);
  });
});
