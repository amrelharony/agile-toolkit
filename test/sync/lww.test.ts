import { describe, expect, it } from "vitest";
import { compareIso, getClientId, lwwPick } from "@/lib/sync/lww";

/**
 * Smoke tests for the last-write-wins primitives shared by the blob and
 * entity sync adapters. These are pure functions plus a cached client id.
 */

describe("compareIso", () => {
  it("returns positive when a is newer than b", () => {
    expect(compareIso("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z")).toBeGreaterThan(0);
  });

  it("returns negative when b is newer than a", () => {
    expect(compareIso("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")).toBeLessThan(0);
  });

  it("returns zero on equal timestamps", () => {
    expect(compareIso("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(0);
  });

  it("returns zero when either side is unparseable", () => {
    expect(compareIso("not a date", "2026-01-01T00:00:00Z")).toBe(0);
    expect(compareIso("2026-01-01T00:00:00Z", "garbage")).toBe(0);
  });
});

describe("lwwPick", () => {
  it("picks the side with the newer timestamp (a wins)", () => {
    const a = { updated_at: "2026-01-02T00:00:00Z", value: "a" };
    const b = { updated_at: "2026-01-01T00:00:00Z", value: "b" };
    expect(lwwPick(a, b)).toBe(a);
  });

  it("picks the side with the newer timestamp (b wins)", () => {
    const a = { updated_at: "2026-01-01T00:00:00Z", value: "a" };
    const b = { updated_at: "2026-01-02T00:00:00Z", value: "b" };
    expect(lwwPick(a, b)).toBe(b);
  });

  it("ties go to b (the incoming/remote side)", () => {
    const a = { updated_at: "2026-01-01T00:00:00Z", value: "local" };
    const b = { updated_at: "2026-01-01T00:00:00Z", value: "remote" };
    expect(lwwPick(a, b)).toBe(b);
  });
});

describe("getClientId", () => {
  it("returns a stable id across calls in the same module load", () => {
    const first = getClientId();
    const second = getClientId();
    const third = getClientId();
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("returns a non-empty string", () => {
    const id = getClientId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
