import { describe, expect, it } from "vitest";
import {
  sanitizeDisplayName,
  sanitizeSquadName,
  isValidGuestPathSegment,
} from "@/lib/squads/validate";

describe("sanitizeSquadName", () => {
  it("accepts a normal name", () => {
    expect(sanitizeSquadName("Squad Alpha")).toBe("Squad Alpha");
  });

  it("strips bidi/zero-width characters like display names", () => {
    expect(sanitizeSquadName("Team‮evilSPACE")).toBe("TeamevilSPACE");
    expect(sanitizeSquadName("A​B")).toBe("AB");
  });

  it("rejects empty or whitespace-only input", () => {
    expect(sanitizeSquadName("")).toBeNull();
    expect(sanitizeSquadName("   ")).toBeNull();
  });

  it("accepts up to 80 chars and rejects 81", () => {
    expect(sanitizeSquadName("a".repeat(80))).toBe("a".repeat(80));
    expect(sanitizeSquadName("a".repeat(81))).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(sanitizeSquadName(null)).toBeNull();
    expect(sanitizeSquadName(undefined)).toBeNull();
    expect(sanitizeSquadName(42)).toBeNull();
  });

  it("is symmetric with sanitizeDisplayName on the stripped char set", () => {
    const probe = "X​Y‮Z";
    expect(sanitizeSquadName(probe)).toBe("XYZ");
    expect(sanitizeDisplayName(probe)).toBe("XYZ");
  });
});

describe("isValidGuestPathSegment", () => {
  it("accepts a sane UUID-shaped segment", () => {
    expect(isValidGuestPathSegment("11111111-1111-1111-1111-111111111111")).toBe(true);
  });

  it("accepts a 200-char segment but rejects 201", () => {
    expect(isValidGuestPathSegment("a".repeat(200))).toBe(true);
    expect(isValidGuestPathSegment("a".repeat(201))).toBe(false);
  });

  it("rejects control characters", () => {
    expect(isValidGuestPathSegment("foo\x00bar")).toBe(false);
    expect(isValidGuestPathSegment("foo\x7f")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidGuestPathSegment(null)).toBe(false);
    expect(isValidGuestPathSegment(undefined)).toBe(false);
    expect(isValidGuestPathSegment(42)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidGuestPathSegment("")).toBe(false);
  });
});
