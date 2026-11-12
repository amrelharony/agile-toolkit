// @vitest-environment node
/**
 * The golden test for backlog-health.review: a canned answer gives flags,
 * splits and scenarios per story; a bad item is dropped while the rest are
 * kept; and the fallback answers from the page's own rules and the split
 * patterns.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { backlogHealthReviewTask, fallbackReview } from "@/lib/ai/tasks/backlog-health";
import { backlogHealthReviewPrompt } from "@/lib/ai/tasks/backlog-health.server";

const task = backlogHealthReviewTask;

describe("backlog-health.review", () => {
  it("is a reasoning task with room for a long answer", () => {
    expect(task).toMatchObject({ tier: "full", effort: "high", maxTokens: 8192 });
  });

  it("reads a typical model answer", () => {
    const answer = JSON.stringify({
      stories: [
        {
          id: "story_b",
          flags: [{ flag: "vague", reason: "Fix what about checkout?" }],
          splits: [],
          gwt: [
            {
              given: "a shopper with a full cart",
              when: "they press Pay",
              then: "the order is placed",
            },
          ],
        },
        {
          id: "story_c",
          flags: [{ flag: "too-big", reason: "Two file types and currency conversion" }],
          splits: ["Import orders from CSV", "Import orders from Excel", "Convert order currency"],
          gwt: [],
        },
      ],
    });
    const parsed = parseAnswer(`Sure.\n${answer}`, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.stories.map((s) => s.id)).toEqual(["story_b", "story_c"]);
      expect(parsed.data.stories[1].splits).toHaveLength(3);
    }
  });

  it("drops a story with an unknown flag and keeps the others", () => {
    const answer = JSON.stringify({
      stories: [
        { id: "a", flags: [{ flag: "ugly", reason: "x" }], splits: [], gwt: [] },
        { id: "b", flags: [{ flag: "vague", reason: "y" }], splits: [], gwt: [] },
      ],
    });
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // The bad flag is dropped inside the story, which stays with no flags.
      expect(parsed.data.stories.find((s) => s.id === "a")?.flags).toEqual([]);
      expect(parsed.data.stories.find((s) => s.id === "b")?.flags).toHaveLength(1);
    }
    expect(parseAnswer("no json here", task.output).ok).toBe(false);
  });

  it("falls back to the page's rules, the split patterns and draft scenarios", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    const byId = Object.fromEntries(out.stories.map((s) => [s.id, s]));
    expect(byId.story_a.flags.map((f) => f.flag)).toEqual(["no-criteria"]);
    expect(byId.story_a.gwt.length).toBeGreaterThan(0);
    expect(byId.story_b.flags.map((f) => f.flag)).toEqual(["vague", "no-criteria"]);
    expect(byId.story_c.flags.map((f) => f.flag)).toEqual(["too-big"]);
    expect(byId.story_c.splits).toEqual([
      "Import orders from CSV and Excel files with currency conversion: the main path only",
      "Import orders from CSV and Excel files with currency conversion: errors and rare cases",
      "Import orders from CSV and Excel files with currency conversion: one kind of data first",
      "Import orders from CSV and Excel files with currency conversion: the other kinds of data",
    ]);
    expect(byId.story_c.gwt).toEqual([]);
    // A story that needs nothing is left out.
    expect(
      fallbackReview({
        stories: [
          { id: "ok", title: "Pay with a saved card", points: 3, criteria: "Charged once" },
        ],
      })
    ).toEqual({ stories: [] });
  });

  it("builds the prompt on the server, the stories inside the block", () => {
    const system = buildTaskSystem(task, backlogHealthReviewPrompt);
    expect(system).toContain("Given/When/Then");
    expect(system).toContain('"too-big"');
    const user = buildTaskUser(
      backlogHealthReviewPrompt,
      task.input.parse({ stories: [{ id: "s1", title: "Pay", points: 3 }] })
    );
    expect(user).toBe(
      "<user_content>\nStories, in backlog order:\n- id: s1\n  title: Pay\n  points: 3\n  acceptance criteria: none\n</user_content>"
    );
  });

  it("caps its input at 40 stories", () => {
    const stories = Array.from({ length: 41 }, (_, i) => ({ id: `s${i}`, title: "T" }));
    expect(task.input.safeParse({ stories }).success).toBe(false);
    expect(task.input.safeParse({ stories: stories.slice(0, 40) }).success).toBe(true);
  });
});
