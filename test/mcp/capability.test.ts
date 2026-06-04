/**
 * PAT operation-capability ladder (access_level).
 *
 * read < write < intent — a token at a given level may invoke any action
 * whose category is at or below it.
 */

import { describe, it, expect } from "vitest";
import { isAccessLevel, levelAllowsCategory, ACCESS_LEVELS } from "@/lib/mcp/capability";

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
