import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256, sha256Base64Url } from "@/lib/realtime/sha256";

/**
 * The synchronous SHA-256 the Retro room's locks use, against the standard
 * test vectors and Node's own implementation.
 */

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("sha256", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(hex(sha256(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(hex(sha256("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(hex(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });

  it("agrees with Node for every length across the padding boundaries, and for UTF-8", () => {
    for (let n = 0; n <= 130; n++) {
      const text = "k".repeat(n);
      expect(hex(sha256(text))).toBe(createHash("sha256").update(text).digest("hex"));
    }
    const unicode = "Café ☕ 日本 🎉";
    expect(hex(sha256(unicode))).toBe(createHash("sha256").update(unicode).digest("hex"));
  });

  it("gives unpadded base64url, 43 characters", () => {
    for (const text of ["", "abc", "V1StGXR8_Z5jdHi6B-myT"]) {
      const out = sha256Base64Url(text);
      expect(out).toBe(createHash("sha256").update(text).digest("base64url"));
      expect(out).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});
