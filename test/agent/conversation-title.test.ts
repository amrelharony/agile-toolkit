/**
 * conversationTitle derives a thread title from the first user message.
 */

import { describe, it, expect } from "vitest";
import { conversationTitle } from "@/lib/agent/persist";

describe("conversationTitle", () => {
  it("collapses whitespace and trims", () => {
    expect(conversationTitle("  create   a\n sprint ")).toBe("create a sprint");
  });

  it("falls back for empty input", () => {
    expect(conversationTitle("   ")).toBe("New conversation");
    expect(conversationTitle("")).toBe("New conversation");
  });

  it("truncates long titles with an ellipsis", () => {
    const out = conversationTitle("a".repeat(80));
    expect(out.length).toBe(58); // 57 chars + the ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("keeps short titles as-is", () => {
    expect(conversationTitle("List my sprints")).toBe("List my sprints");
  });
});
