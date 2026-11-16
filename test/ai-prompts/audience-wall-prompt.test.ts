// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateAudienceWallPrompts } from "@/lib/ai-prompts/audience-wall";
import type { WallSession } from "@/lib/audience-wall/model";

/**
 * Audience Wall's copyable prompts read the newest wall: its question and
 * anonymous posts as user content, best first, at most 60, with a note
 * when some are left out.
 */

const wall = (posts: WallSession["posts"]): WallSession => ({
  id: "wall_1",
  kind: "questions",
  prompt: "What should we ask?",
  savedAt: "2026-11-12T10:00:00.000Z",
  source: "room",
  posts,
  themes: [],
  sent: [],
});

describe("generateAudienceWallPrompts", () => {
  it("offers nothing without a wall that has posts", () => {
    expect(generateAudienceWallPrompts([])).toEqual([]);
    expect(generateAudienceWallPrompts([wall([])])).toEqual([]);
  });

  it("puts the question and the posts, best first, inside the user content", () => {
    const prompts = generateAudienceWallPrompts([
      wall([
        { id: "p1", text: "Who owns `onboarding`?", votes: 1, merged: [], answered: true },
        { id: "p2", text: "When is the release?", votes: 5, merged: [] },
      ]),
    ]);
    expect(prompts.map((p) => p.id)).toEqual([
      "audience-wall-read",
      "audience-wall-answer-plan",
      "audience-wall-backlog",
    ]);
    const text = prompts[1].prompt;
    expect(text).toContain("<user_content>");
    expect(text).toContain("Question: What should we ask?");
    expect(text.indexOf("When is the release? (5 votes)")).toBeLessThan(
      text.indexOf("Who owns 'onboarding'? (1 vote, answered)")
    );
  });

  it("caps the posts at 60 and says how many were left out", () => {
    const many = Array.from({ length: 65 }, (_, i) => ({
      id: `p${i + 1}`,
      text: `Post ${i + 1}`,
      votes: 0,
      merged: [],
    }));
    const [read] = generateAudienceWallPrompts([wall(many)]);
    expect(read.prompt).toContain("(5 more posts left out.)");
    expect(read.prompt).not.toContain("Post 61");
  });
});
