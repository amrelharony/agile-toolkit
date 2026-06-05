/**
 * PAT operation-capability ladder (access_level).
 *
 * read < write < intent — a token at a given level may invoke any action
 * whose category is at or below it.
 */

import { describe, it, expect } from "vitest";
import {
  isAccessLevel,
  levelAllowsCategory,
  coerceAccessLevel,
  ACCESS_LEVELS,
} from "@/lib/mcp/capability";

describe("isAccessLevel", () => {
  it("accepts the three valid levels", () => {
    for (const l of ACCESS_LEVELS) expect(isAccessLevel(l)).toBe(true);
  });
  it("rejects anything else", () => {
    for (const v of ["", "admin", "READ", null, undefined, 1, {}]) {
      expect(isAccessLevel(v)).toBe(false);
    }
  });
});

describe("levelAllowsCategory", () => {
  it("full allows read, write, and intent", () => {
    expect(levelAllowsCategory("full", "read")).toBe(true);
    expect(levelAllowsCategory("full", "write")).toBe(true);
    expect(levelAllowsCategory("full", "intent")).toBe(true);
  });

  it("write allows read + write but NOT intent", () => {
    expect(levelAllowsCategory("write", "read")).toBe(true);
    expect(levelAllowsCategory("write", "write")).toBe(true);
    expect(levelAllowsCategory("write", "intent")).toBe(false);
  });

  it("read allows only read", () => {
    expect(levelAllowsCategory("read", "read")).toBe(true);
    expect(levelAllowsCategory("read", "write")).toBe(false);
    expect(levelAllowsCategory("read", "intent")).toBe(false);
  });
});

describe("coerceAccessLevel", () => {
  it("passes through the three valid levels unchanged", () => {
    for (const l of ACCESS_LEVELS) expect(coerceAccessLevel(l)).toBe(l);
  });

  it("defaults null/undefined to 'full' (pre-0022 back-compat)", () => {
    expect(coerceAccessLevel(null)).toBe("full");
    expect(coerceAccessLevel(undefined)).toBe("full");
  });

  it("fails CLOSED to 'read' for any unrecognised non-null value", () => {
    // A malformed level must restrict, never escalate to full privilege.
    for (const v of ["", "writ", "admin", "READ", "Full", "intent "]) {
      expect(coerceAccessLevel(v)).toBe("read");
    }
  });
});
