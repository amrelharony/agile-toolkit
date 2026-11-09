/**
 * conversationTitle derives a thread title from the first user message;
 * generateTitle upgrades it with a short model-written one.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { conversationTitle, conversationToMarkdown, titleSlug } from "@/lib/agent/persist";
import { cleanTitle, generateTitle } from "@/lib/agent/client";
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

describe("generateTitle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for low reasoning with room to finish it, and reads the title from content", async () => {
    const posts: Array<Record<string, unknown>> = [];
    const stream = [
      { choices: [{ delta: { reasoning_content: "Let me think of a title…" } }] },
      { choices: [{ delta: { content: '"Sprint Planning Chat"' } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]
      .map(
        (e) => `data: ${JSON.stringify(e)}

`
      )
      .join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (!init || init.method === "GET") {
          return Response.json({ mode: "server", model: "openclaw", provider: "openclaw" });
        }
        posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(
          `${stream}data: [DONE]

`,
          { status: 200 }
        );
      })
    );

    const title = await generateTitle("Help me plan sprint 47", "Sure, let's plan it.");
    expect(title).toBe("Sprint Planning Chat");
    expect(posts).toHaveLength(1);
    expect(posts[0].reasoning_effort).toBe("low");
    // Reasoning counts against max_tokens: 320 used to run out before the title.
    expect(posts[0].max_tokens).toBeGreaterThanOrEqual(1024);
    expect(posts[0]).not.toHaveProperty("tools");
    expect(posts[0]).not.toHaveProperty("tool_choice");
  });
});
