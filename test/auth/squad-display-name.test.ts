import { describe, expect, it } from "vitest";
import { sanitizeDisplayName } from "@/lib/squads/validate";

describe("sanitizeDisplayName", () => {
  it("accepts a plain ASCII name", () => {
    expect(sanitizeDisplayName("Alice")).toBe("Alice");
  });

  it("accepts unicode names (NFC-normalised)", () => {
    // 'á' as composed (U+00E1) vs decomposed (U+0061 + U+0301)
    const composed = "Sofiá";
    const decomposed = "Sofiá";
    expect(sanitizeDisplayName(composed)).toBe(composed);
    expect(sanitizeDisplayName(decomposed)).toBe(composed); // NFC normalises
  });

  it("strips control characters", () => {
    expect(sanitizeDisplayName("Bob\x00\x01")).toBe("Bob");
    expect(sanitizeDisplayName("Bob\x7f")).toBe("Bob");
  });

  it("strips bidi override characters (Trojan-Source-style attacks)", () => {
    // RLO (U+202E) flips display order — attacker uses it to make
    // "evil_user" render as "resu_live". Strip it.
    const malicious = "Bob‮OlleH";
    const cleaned = sanitizeDisplayName(malicious);
    expect(cleaned).toBe("BobOlleH");
    expect(cleaned).not.toContain("‮");
  });

  it("strips zero-width LRM/RLM markers", () => {
    expect(sanitizeDisplayName("A‎lice")).toBe("Alice");
    expect(sanitizeDisplayName("A‏lice")).toBe("Alice");
  });

  it("strips 2018-era isolate markers (LRI/RLI/FSI/PDI)", () => {
    expect(sanitizeDisplayName("X⁦Y⁩Z")).toBe("XYZ");
  });

  it("strips line/paragraph separators", () => {
    expect(sanitizeDisplayName("line1 line2")).toBe("line1line2");
    expect(sanitizeDisplayName("p1 p2")).toBe("p1p2");
  });

  it("rejects empty and oversized input", () => {
    expect(sanitizeDisplayName("")).toBeNull();
    expect(sanitizeDisplayName("   ")).toBeNull();
    expect(sanitizeDisplayName("x".repeat(61))).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(sanitizeDisplayName(null)).toBeNull();
    expect(sanitizeDisplayName(123)).toBeNull();
    expect(sanitizeDisplayName({ name: "Bob" })).toBeNull();
  });
});
