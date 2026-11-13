// @vitest-environment node
/**
 * The golden test for interrupt-buffer.classify: a canned answer gives a
 * kind and size per title, a bad item is dropped, and the fallback sorts
 * every title by keywords.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { interruptClassifyTask } from "@/lib/ai/tasks/interrupt-buffer";
import { interruptClassifyPrompt } from "@/lib/ai/tasks/interrupt-buffer.server";

const task = interruptClassifyTask;

describe("interrupt-buffer.classify", () => {
  it("is a small, quick task", () => {
    expect(task).toMatchObject({ tier: "flash", effort: "low", maxTokens: 4096 });
  });

  it("reads a typical model answer", () => {
    const parsed = parseAnswer(
      '```json\n{"items":[{"index":0,"kind":"incident","size":8},{"index":1,"kind":"request","size":3,"reason":"New report"},{"index":2,"kind":"support"}]}\n```',
      task.output
    );
    expect(parsed).toEqual({
      ok: true,
      data: {
        items: [
          { index: 0, kind: "incident", size: 8 },
          { index: 1, kind: "request", size: 3, reason: "New report" },
          { index: 2, kind: "support" },
        ],
      },
    });
  });

  it("drops an item with an unknown kind or an impossible size", () => {
    const parsed = parseAnswer(
      '{"items":[{"index":0,"kind":"panic"},{"index":1,"kind":"bug","size":500},{"index":2,"kind":"bug","size":2}]}',
      task.output
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.items).toEqual([{ index: 2, kind: "bug", size: 2 }]);
  });

  it("falls back to keyword rules for every title", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.items).toEqual([
      { index: 0, kind: "incident", size: 8 },
      { index: 1, kind: "request" },
      { index: 2, kind: "support", size: 1 },
    ]);
  });

  it("builds the prompt on the server, the titles numbered inside the block", () => {
    expect(buildTaskSystem(task, interruptClassifyPrompt)).toContain('"incident"');
    expect(buildTaskUser(interruptClassifyPrompt, { titles: ["A", "B"] })).toBe(
      "<user_content>\nInterrupts:\n0. A\n1. B\n</user_content>"
    );
  });

  it("caps its input", () => {
    expect(task.input.safeParse({ titles: [] }).success).toBe(false);
    expect(task.input.safeParse({ titles: Array.from({ length: 21 }, () => "x") }).success).toBe(
      false
    );
  });
});
