// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  COLOR_EDITION_COOKIE_MAX_AGE,
  COLOR_EDITION_COOKIE_PATH,
  COLOR_EDITION_KEY_HASHES,
  isColorEditionKey,
  normalizeColorEditionKey,
} from "@/lib/comic/color-edition-access";
import { COLOR_EDITION_PDF_PATH, COLOR_EDITION_ROUTE } from "@/lib/comic/agile-at-work";

/**
 * The colour edition's gate: a key from the printed QR link whose SHA-256 is
 * listed. Tests use their own key and hash — the real key never appears in
 * the repo, only its hash.
 */

const KEY = "testkey12345";
const HASHES = [createHash("sha256").update(KEY).digest("hex")];

describe("isColorEditionKey", () => {
  it("accepts a key whose hash is listed", async () => {
    expect(await isColorEditionKey(KEY, HASHES)).toBe(true);
  });

  it("tolerates case and surrounding spaces from a typed-in link", async () => {
    expect(await isColorEditionKey("  TESTKEY12345 ", HASHES)).toBe(true);
  });

  it("rejects other keys, empty values and absurdly long input", async () => {
    expect(await isColorEditionKey("testkey12346", HASHES)).toBe(false);
    expect(await isColorEditionKey("", HASHES)).toBe(false);
    expect(await isColorEditionKey("   ", HASHES)).toBe(false);
    expect(await isColorEditionKey(undefined, HASHES)).toBe(false);
    expect(await isColorEditionKey(null, HASHES)).toBe(false);
    expect(await isColorEditionKey(KEY.repeat(10), HASHES)).toBe(false);
  });

  it("does not accept a hash in place of the key", async () => {
    expect(await isColorEditionKey(HASHES[0], HASHES)).toBe(false);
  });

  it("rejects the test key against the real list", async () => {
    expect(await isColorEditionKey(KEY)).toBe(false);
  });
});

describe("normalizeColorEditionKey", () => {
  it("lowercases and trims, and drops what can't be a key", () => {
    expect(normalizeColorEditionKey(" AbC ")).toBe("abc");
    expect(normalizeColorEditionKey("")).toBeNull();
    expect(normalizeColorEditionKey("x".repeat(65))).toBeNull();
  });
});

describe("the real key list", () => {
  it("holds SHA-256 hex digests only, never a plain key", () => {
    expect(COLOR_EDITION_KEY_HASHES.length).toBeGreaterThan(0);
    for (const hash of COLOR_EDITION_KEY_HASHES) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the access cookie", () => {
  it("is scoped to the colour page and its PDF", () => {
    expect(COLOR_EDITION_COOKIE_PATH).toBe(COLOR_EDITION_ROUTE);
    expect(COLOR_EDITION_PDF_PATH.startsWith(`${COLOR_EDITION_COOKIE_PATH}/`)).toBe(true);
  });

  it("lasts as long as a browser allows (400 days)", () => {
    expect(COLOR_EDITION_COOKIE_MAX_AGE).toBe(34_560_000);
  });
});
