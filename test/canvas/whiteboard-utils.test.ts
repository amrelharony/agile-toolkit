import { describe, it, expect } from "vitest";
import { makeActivityId } from "@/app/(tools)/canvas/lib/whiteboard-utils";

/**
 * Characterization tests for the whiteboard pure helpers.
 */

describe("makeActivityId", () => {
  it("produces an act_-prefixed 12-char hex suffix (crypto path)", () => {
    // jsdom/Node provides crypto.randomUUID, so the uuid branch runs.
    expect(makeActivityId()).toMatch(/^act_[0-9a-f]{12}$/);
  });
  it("is collision-resistant across a burst of calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(makeActivityId());
    expect(ids.size).toBe(1000);
  });
});
