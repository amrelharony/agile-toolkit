// @vitest-environment node
/**
 * Golden tests for Relative Sizing's AI tasks: the prompt the server
 * builds (totals only, never who), a typical answer read into the output,
 * a bad one salvaged or refused, and the fallbacks without a model.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  RELATIVE_SIZING_AI as CAP,
  fallbackDiscuss,
  fallbackSplit,
  sizingDiscussTask,
  sizingSplitTask,
} from "@/lib/ai/tasks/relative-sizing";
import { sizingDiscussPrompt, sizingSplitPrompt } from "@/lib/ai/tasks/relative-sizing.server";

describe("relative-sizing.discuss", () => {
  it("is a quick task, open to visitors (the room's AI stays with the host)", () => {
    expect(sizingDiscussTask).toMatchObject({
      toolId: "relative-sizing",
      tier: "flash",
      maxTokens: 4096,
    });
    expect(sizingDiscussTask.ownerOnly).toBeUndefined();
  });

  it("sends the story with the room's totals per bucket", () => {
    const user = buildTaskUser(
      sizingDiscussPrompt,
      sizingDiscussTask.input.parse(sizingDiscussTask.sample)
    );
    expect(user).toContain("Story: Pay with a saved card");
    expect(user).toContain("People per bucket: 1 ×0, 2 ×0, 3 ×2, 5 ×0, 8 ×3, 13 ×1, 21 ×0");
    expect(buildTaskSystem(sizingDiscussTask, sizingDiscussPrompt)).toContain("never ask who");
  });

  it("reads a typical answer, keeping three", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        questions: ["What hides in 8?", "Is the bank API known?", "Split it?", "Four"],
      }),
      sizingDiscussTask.output
    );
    expect(parsed.ok && parsed.data.questions).toHaveLength(3);
    expect(parseAnswer('{"questions": []}', sizingDiscussTask.output).ok).toBe(false);
  });

  it("falls back to questions from the lowest and highest bucket used", () => {
    const out = fallbackDiscuss(sizingDiscussTask.sample);
    expect(out.questions).toEqual([
      "What would make it a 3?",
      "What do the 13s see that the 3s don't?",
      "Could part of it be a 3 on its own?",
    ]);
    // No counts: the board's ends.
    expect(fallbackDiscuss({ ...sizingDiscussTask.sample, counts: [] }).questions[0]).toBe(
      "What would make it a 1?"
    );
    // One bucket used: its neighbours.
    expect(
      fallbackDiscuss({ ...sizingDiscussTask.sample, counts: [0, 0, 0, 4] }).questions[1]
    ).toBe("What do the 8s see that the 3s don't?");
    expect(sizingDiscussTask.output.safeParse(out).success).toBe(true);
  });
});

describe("relative-sizing.split", () => {
  it("sends the story, its bucket and notes", () => {
    const user = buildTaskUser(
      sizingSplitPrompt,
      sizingSplitTask.input.parse(sizingSplitTask.sample)
    );
    expect(user).toContain("Sized as: 21");
    expect(user).toContain("Notes: Customers ask for CSV and OFX files.");
  });

  it("keeps the titles of an answer with an unknown pattern refused", () => {
    expect(
      parseAnswer(JSON.stringify({ titles: ["A", "B"], pattern: "data" }), sizingSplitTask.output)
        .ok
    ).toBe(true);
    expect(
      parseAnswer(JSON.stringify({ titles: ["A"], pattern: "magic" }), sizingSplitTask.output).ok
    ).toBe(false);
  });

  it("falls back to Backlog Health's split patterns, two stories each", () => {
    const out = fallbackSplit(sizingSplitTask.sample);
    expect(out.titles).toHaveLength(CAP.titlesOut);
    expect(out.pattern).toBe("path");
    expect(sizingSplitTask.output.safeParse(out).success).toBe(true);
    expect(() => fallbackSplit({ title: " ", notes: "", bucket: "" })).toThrow();
  });

  it("fits the body budget at every cap, in 3-byte text", () => {
    const wide = (n: number) => "語".repeat(n);
    const split = { title: wide(CAP.title), notes: wide(CAP.notes), bucket: wide(CAP.label) };
    expect(sizingSplitTask.input.safeParse(split).success).toBe(true);
    expect(jsonBytes({ task: sizingSplitTask.id, input: split })).toBeLessThanOrEqual(
      TOOL_AI_BODY_BUDGET
    );
  });
});
