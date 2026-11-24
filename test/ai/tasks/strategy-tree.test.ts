// @vitest-environment node
/**
 * The golden test for strategy-tree.draft: a canned model answer gives the
 * expected branches, a crowded answer is salvaged and a bad one refused,
 * the fallback answers each shape with bracket templates in its caps (and
 * refuses a shape it doesn't know), and the largest input fits the body.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  TREE_DRAFT_BRANCHES_MAX,
  branchSize,
  fallbackStrategyBranches,
  strategyTreeDraftTask,
  type TreeDraftInput,
} from "@/lib/ai/tasks/strategy-tree";
import { strategyTreeDraftTask as ref } from "@/lib/ai/tasks/strategy-tree.lite";
import { strategyTreeDraftPrompt } from "@/lib/ai/tasks/strategy-tree.server";

const task = strategyTreeDraftTask;
const input = (over: Partial<TreeDraftInput> = {}): TreeDraftInput => ({
  format: "lean-value-tree",
  root: "Good dinners without the planning",
  context: "",
  existing: [],
  ...over,
});

describe("strategy-tree.draft", () => {
  it("is a reasoning task, with its ref's fallback", () => {
    expect(task).toMatchObject({
      id: "strategy-tree.draft",
      toolId: "strategy-tree",
      tier: "full",
      effort: "high",
      maxTokens: 8192,
    });
    expect(task.ownerOnly).toBeUndefined();
    expect(ref.fallback).toBe(task.fallback);
  });

  it("reads a typical model answer", () => {
    const answer = `{"branches": [
      {"text": "Customers order again within a month", "measure": "Repeat rate", "children": [
        {"text": "Favourites make reordering easy", "measure": "Reorders", "children": [
          {"text": "Favourites on the home screen", "measure": "Taps"}
        ]}
      ]}
    ]}`;
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.branches[0].children[0].children[0]).toEqual({
        text: "Favourites on the home screen",
        measure: "Taps",
      });
      expect(branchSize(parsed.data.branches[0])).toBe(3);
    }
  });

  it("salvages a crowded answer and refuses one with no branches", () => {
    const crowded = JSON.stringify({
      branches: Array.from({ length: 6 }, (_, i) => ({
        text: `Branch ${i}`,
        children: Array.from({ length: 5 }, (_, j) => ({
          text: `Child ${j}`,
          children: Array.from({ length: 5 }, () => ({ text: "Leaf" })),
        })),
      })),
    });
    const parsed = parseAnswer(crowded, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.branches.length).toBeLessThanOrEqual(TREE_DRAFT_BRANCHES_MAX);
      expect(task.output.safeParse(parsed.data).success).toBe(true);
      for (const b of parsed.data.branches) expect(branchSize(b)).toBeLessThanOrEqual(13);
    }
    expect(parseAnswer('{"branches": []}', task.output).ok).toBe(false);
  });

  it.each(["dibb", "lean-value-tree", "hoshin"] as const)(
    "falls back to 2 × 2 × 1 bracket templates for %s, a measure where the level has one",
    (format) => {
      const out = fallbackStrategyBranches(input({ format }));
      expect(task.output.safeParse(out).success).toBe(true);
      expect(out.branches).toHaveLength(2);
      expect(out.branches.every((b) => b.children.length === 2)).toBe(true);
      expect(out.branches.every((b) => b.children.every((c) => c.children.length === 1))).toBe(
        true
      );
      expect(out.branches[0].text).toContain("Good dinners without the planning");
      const all = out.branches.flatMap((b) => [
        b,
        ...b.children,
        ...b.children.flatMap((c) => c.children),
      ]);
      expect(all.every((p) => p.text.startsWith("[") && p.text.endsWith("]"))).toBe(true);
    }
  );

  it("puts a measure only where the shape measures", () => {
    const dibb = fallbackStrategyBranches(input({ format: "dibb" }));
    expect(dibb.branches[0].measure).toBeUndefined();
    expect(dibb.branches[0].children[0].children[0].measure).toBe("[How you'll measure it]");
    const hoshin = fallbackStrategyBranches(input({ format: "hoshin" }));
    expect(hoshin.branches[0].measure).toBeDefined();
    expect(hoshin.branches[0].children[0].measure).toBeUndefined();
  });

  it("cuts a 200-character root into the bracket, and refuses an unknown shape", () => {
    const out = fallbackStrategyBranches(input({ root: "r".repeat(200) }));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.branches[0].text.length).toBeLessThanOrEqual(200);
    expect(() =>
      fallbackStrategyBranches({ ...input(), format: "swot" as unknown as "dibb" })
    ).toThrow();
  });

  it("fits the route's body at its largest input, in 3-byte text", () => {
    const s = (n: number) => "語".repeat(n);
    const big = task.input.parse({
      format: "hoshin",
      root: s(200),
      measure: s(200),
      context: s(2000),
      existing: Array.from({ length: 20 }, () => s(200)),
    });
    expect(jsonBytes({ task: task.id, input: big })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
  });

  it("builds the prompt by shape on the server, the data inside the block", () => {
    const system = buildTaskSystem(task, strategyTreeDraftPrompt);
    expect(system).toContain("Never name people or owners");
    const user = buildTaskUser(
      strategyTreeDraftPrompt,
      task.input.parse({ format: "dibb", root: "R", context: "C", existing: ["E"] })
    );
    expect(user).toContain("Shape: DIBB. The root is the data.");
    expect(user).toContain("Level 3 is a bet: What you'll try, small enough to learn from.");
    expect(user.endsWith("Already on the tree at level 1:\n- E\n</user_content>")).toBe(true);
  });

  it("caps its input", () => {
    expect(task.input.safeParse(input({ root: "" })).success).toBe(false);
    expect(
      task.input.safeParse(input({ existing: Array.from({ length: 21 }, () => "e") })).success
    ).toBe(false);
    expect(task.input.safeParse({ ...input(), format: "impact-map" }).success).toBe(false);
  });
});
