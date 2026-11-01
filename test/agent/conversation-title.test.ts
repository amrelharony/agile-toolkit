/**
 * conversationTitle derives a thread title from the first user message.
 */

import { describe, it, expect } from "vitest";
import { conversationTitle, conversationToMarkdown, titleSlug } from "@/lib/agent/persist";
import { cleanTitle } from "@/lib/agent/client";
import type { ChatMessage } from "@/lib/agent/types";

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

describe("titleSlug", () => {
  it("slugifies for a filename", () => {
    expect(titleSlug("Sprint 47 Planning!")).toBe("sprint-47-planning");
  });
  it("falls back when empty after stripping", () => {
    expect(titleSlug("***")).toBe("conversation");
  });
});

describe("cleanTitle", () => {
  it("strips quotes, a Title: prefix, and trailing punctuation", () => {
    expect(cleanTitle('"Sprint Planning Chat"')).toBe("Sprint Planning Chat");
    expect(cleanTitle("Title: Agile Roles Overview.")).toBe("Agile Roles Overview");
  });
  it("takes only the first line and caps length", () => {
    expect(cleanTitle("My Title\nsome rambling explanation")).toBe("My Title");
    expect(cleanTitle("a".repeat(80)).endsWith("…")).toBe(true);
  });
});

describe("conversationToMarkdown", () => {
  const msgs: ChatMessage[] = [
    { id: "1", role: "user", content: [{ type: "text", text: "hi there" }], createdAt: "" },
    { id: "2", role: "assistant", content: [{ type: "text", text: "**Hello!**" }], createdAt: "" },
  ];
  it("renders a portable markdown transcript", () => {
    const md = conversationToMarkdown("My Thread", msgs);
    expect(md).toContain("# My Thread");
    expect(md).toContain("**You:**");
    expect(md).toContain("hi there");
    expect(md).toContain("**Amr:**");
    expect(md).toContain("**Hello!**");
  });
});
