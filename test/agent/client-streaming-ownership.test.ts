/**
 * Concurrency: a superseded send must not clear the `streaming` flag that a
 * newer send now owns. ownsStreamingReset encodes which send may reset shared
 * state in sendUserMessage's finally block.
 */

import { describe, it, expect } from "vitest";
import { ownsStreamingReset } from "@/lib/agent/client";

describe("ownsStreamingReset", () => {
  it("resets when this send is still the current controller (normal finish)", () => {
    const mine = new AbortController();
    expect(ownsStreamingReset(mine, mine)).toBe(true);
  });

  it("resets when the controller was cleared (clean finish / abortInFlight)", () => {
    const mine = new AbortController();
    expect(ownsStreamingReset(null, mine)).toBe(true);
  });

  it("does NOT reset when a newer send has taken over the controller", () => {
    const mine = new AbortController();
    const newer = new AbortController();
    expect(ownsStreamingReset(newer, mine)).toBe(false);
  });
});
