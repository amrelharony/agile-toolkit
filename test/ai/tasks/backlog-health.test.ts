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
import {
  REVIEW_BODY_BUDGET,
  REVIEW_STORIES_MAX,
  backlogHealthReviewTask,
  fallbackReview,
  fitReviewInput,
} from "@/lib/ai/tasks/backlog-health";
import { TOOL_AI_VISITOR_MAX_BODY_BYTES } from "@/lib/ai/contract";
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
      "<user_content>\nThe top of the backlog: the first 10 stories. Too big: more than 13 points.\nStories, in backlog order:\n- id: s1\n  title: Pay\n  points: 3\n  acceptance criteria: none\n</user_content>"
    );
    expect(
      buildTaskUser(
        backlogHealthReviewPrompt,
        task.input.parse({ stories: [{ id: "s1", title: "Pay" }], topN: 3, tooBigPoints: 8 })
      )
    ).toContain("The top of the backlog: the first 3 stories. Too big: more than 8 points.");
  });

  it("flags missing criteria only near the top, and too big by the page's limit", () => {
    const stories = [
      { id: "a", title: "Pay with a saved card", points: 3 },
      { id: "b", title: "Refund a payment from the phone", points: 11 },
      { id: "c", title: "Export the takings as a file", points: 2 },
    ];
    const out = fallbackReview({ stories, topN: 1, tooBigPoints: 8 });
    expect(task.output.safeParse(out).success).toBe(true);
    const byId = Object.fromEntries(out.stories.map((s) => [s.id, s]));
    expect(byId.a.flags.map((f) => f.flag)).toEqual(["no-criteria"]);
    expect(byId.a.gwt.length).toBeGreaterThan(0);
    // Below the top: no criteria is fine, so no flag and no drafted scenarios.
    expect(byId.b.flags.map((f) => f.flag)).toEqual(["too-big"]);
    expect(byId.b.gwt).toEqual([]);
    expect(byId.c).toBeUndefined();
    // With the defaults, 11 points fits a sprint.
    expect(
      fallbackReview({ stories: [{ ...stories[1], criteria: "Refunded once." }] }).stories
    ).toEqual([]);
  });

  it("trims the largest valid input to fit a visitor's request, keeping the top", () => {
    // 40 stories at every cap, in a 2-byte script, with lines in the text.
    const wide = (n: number) => "ج\n".repeat(n).slice(0, n).replace(/\s+$/, "x");
    const stories = Array.from({ length: REVIEW_STORIES_MAX }, (_, i) => ({
      id: `story_${String(i).padStart(54, "0")}`,
      title: `${i} ${wide(190)}`,
      description: wide(500),
      points: 3,
      criteria: wide(500),
    }));
    const input = task.input.parse({ stories, topN: 10 });
    const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
    expect(bytes({ task: task.id, input })).toBeGreaterThan(TOOL_AI_VISITOR_MAX_BODY_BYTES);
    const fitted = fitReviewInput(input);
    expect(task.input.safeParse(fitted).success).toBe(true);
    expect(bytes({ task: task.id, input: fitted })).toBeLessThanOrEqual(REVIEW_BODY_BUDGET);
    expect(REVIEW_BODY_BUDGET).toBeLessThan(TOOL_AI_VISITOR_MAX_BODY_BYTES);
    // The top stories stay, with their criteria; descriptions went first, from the bottom.
    expect(fitted.stories[0]).toMatchObject({
      id: stories[0].id,
      criteria: input.stories[0].criteria,
    });
    expect(fitted.stories.at(-1)?.description).toBeUndefined();
    expect(fitted.stories.every((s, i) => s.criteria === input.stories[i].criteria)).toBe(true);
    expect(fitted.stories.length).toBeGreaterThan(10);
    expect(fitted.topN).toBe(10);
    // Past the descriptions, whole stories go from the bottom, never the first.
    const tight = fitReviewInput(input, 20_000);
    expect(bytes({ task: task.id, input: tight })).toBeLessThanOrEqual(20_000);
    expect(tight.stories.length).toBeLessThan(REVIEW_STORIES_MAX);
    expect(tight.stories[0].id).toBe(stories[0].id);
    // An input that already fits comes back as it is.
    const small = task.input.parse(task.sample);
    expect(fitReviewInput(small)).toBe(small);
  });

  it("caps its input at 40 stories", () => {
    const stories = Array.from({ length: 41 }, (_, i) => ({ id: `s${i}`, title: "T" }));
    expect(task.input.safeParse({ stories }).success).toBe(false);
    expect(task.input.safeParse({ stories: stories.slice(0, 40) }).success).toBe(true);
  });
});
