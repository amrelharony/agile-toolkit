/**
 * isSuppressed must tolerate non-Element event targets. A keydown can target
 * `document` / `window` (nothing focused, or a synthetic dispatch), which have
 * no getAttribute/parentElement — walking them previously threw
 * `TypeError: cur.getAttribute is not a function` and broke the keydown router.
 */

import { describe, it, expect } from "vitest";
import { isSuppressed } from "@/lib/sonification/event-router";

describe("isSuppressed", () => {
  it("does not throw and returns false for non-Element targets", () => {
    expect(() => isSuppressed(document)).not.toThrow();
    expect(() => isSuppressed(window)).not.toThrow();
    expect(isSuppressed(document)).toBe(false);
    expect(isSuppressed(window)).toBe(false);
    expect(isSuppressed(null)).toBe(false);
  });

  it("returns false for an element that doesn't opt out", () => {
    expect(isSuppressed(document.createElement("button"))).toBe(false);
  });

  it("returns true when the element opts out via data-no-sound", () => {
    const el = document.createElement("button");
    el.setAttribute("data-no-sound", "true");
    expect(isSuppressed(el)).toBe(true);
  });

  it("inherits suppression from an ancestor", () => {
    const parent = document.createElement("div");
    parent.setAttribute("data-no-sound", "true");
    const child = document.createElement("span");
    parent.appendChild(child);
    expect(isSuppressed(child)).toBe(true);
  });
});
