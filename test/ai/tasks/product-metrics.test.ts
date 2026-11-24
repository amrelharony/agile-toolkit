// @vitest-environment node
/**
 * The golden test for product-metrics.suggest: a canned model answer gives
 * the expected metrics, a bad answer is salvaged or refused (the page then
 * offers the fallback), the fallback answers every framework with valid
 * metrics and leaves out names the team has, and the largest input fits
 * the route's body budget in 3-byte text.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  SUGGEST_EXISTING_MAX,
  productMetricsSuggestFallback,
  productMetricsSuggestTask,
} from "@/lib/ai/tasks/product-metrics";
import { productMetricsSuggestPrompt } from "@/lib/ai/tasks/product-metrics.server";
import { productMetricsSuggestTask as ref } from "@/lib/ai/tasks/product-metrics.lite";

const task = productMetricsSuggestTask;

describe("product-metrics.suggest", () => {
  it("is a small list task for the owner and visitors alike", () => {
    expect(task).toMatchObject({
      id: "product-metrics.suggest",
      toolId: "product-metrics",
      tier: "flash",
      effort: "low",
      maxTokens: 4096,
    });
    expect(task.ownerOnly).toBeUndefined();
    expect(ref.fallback).toBe(task.fallback);
  });

  it("reads a typical model answer", () => {
    const answer = `Here you go:
\`\`\`json
{"metrics": [
  {"name": "Teams with a weekly retro", "definition": "Teams that held a retro in the week.", "unit": "teams", "direction": "increase", "role": "north-star"},
  {"name": "First retros", "direction": "increase", "role": "input"}
]}
\`\`\``;
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.metrics).toHaveLength(2);
      expect(parsed.data.metrics[1]).toEqual({
        name: "First retros",
        direction: "increase",
        role: "input",
      });
    }
  });

  it("salvages a long or crowded answer and refuses one with no metrics", () => {
    const many = JSON.stringify({
      metrics: Array.from({ length: 10 }, (_, i) => ({
        name: i === 0 ? "x".repeat(300) : `Metric ${i}`,
        direction: "increase",
      })),
    });
    const parsed = parseAnswer(many, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.metrics).toHaveLength(8);
      expect(parsed.data.metrics[0].name).toHaveLength(120);
    }
    expect(parseAnswer('{"metrics": []}', task.output).ok).toBe(false);
    expect(parseAnswer("Sorry, I can't.", task.output).ok).toBe(false);
  });

  it("falls back to our templates for each framework, without names the team has", () => {
    const ns = productMetricsSuggestFallback(task.input.parse(task.sample));
    expect(task.output.safeParse(ns).success).toBe(true);
    expect(ns.metrics.filter((m) => m.role === "north-star")).toHaveLength(1);
    expect(ns.metrics.map((m) => m.name)).not.toContain("Retros per active team");
    const heart = productMetricsSuggestFallback({
      framework: "heart",
      product: "A retro tool",
      feature: "Action follow-up",
      existing: [],
    });
    expect(heart.metrics.map((m) => m.heartCategory)).toEqual([
      "happiness",
      "engagement",
      "adoption",
      "retention",
      "task-success",
    ]);
    expect(heart.metrics[0].name).toContain("Action follow-up");
    const aarrr = productMetricsSuggestFallback({ framework: "aarrr", product: "P", existing: [] });
    expect(aarrr.metrics.map((m) => m.aarrrStage)).toEqual([
      "acquisition",
      "activation",
      "retention",
      "referral",
      "revenue",
    ]);
    const all = productMetricsSuggestFallback({
      framework: "aarrr",
      product: "P",
      existing: aarrr.metrics.map((m) => m.name.toUpperCase()),
    });
    expect(all.metrics).toHaveLength(1);
    expect(task.output.safeParse(all).success).toBe(true);
  });

  it("keeps the fallback inside the output's caps with a long feature, and throws on bad input", () => {
    const long = productMetricsSuggestFallback({
      framework: "heart",
      product: "P",
      feature: "f".repeat(120),
      existing: [],
    });
    expect(task.output.safeParse(long).success).toBe(true);
    expect(() =>
      productMetricsSuggestFallback({ framework: "nope" as "heart", product: "P", existing: [] })
    ).toThrow();
    expect(() =>
      productMetricsSuggestFallback({ framework: "heart", product: " ", existing: [] })
    ).toThrow();
  });

  it("builds the prompt on the server, the data inside the block", () => {
    const system = buildTaskSystem(task, productMetricsSuggestPrompt);
    expect(system).toContain("numbers their product lives by");
    const user = buildTaskUser(
      productMetricsSuggestPrompt,
      task.input.parse({ framework: "heart", product: "P", feature: "F", existing: ["A"] })
    );
    expect(user).toContain("<user_content>");
    expect(user).toContain("Feature: F");
    expect(user).toContain("- A");
    expect(user).toContain("heartCategory");
  });

  it("caps its input, and its largest input fits the body budget in 3-byte text", () => {
    expect(
      task.input.safeParse({ framework: "aarrr", product: "x".repeat(601), existing: [] }).success
    ).toBe(false);
    expect(
      task.input.safeParse({
        framework: "aarrr",
        product: "x",
        existing: Array.from({ length: SUGGEST_EXISTING_MAX + 1 }, () => "m"),
      }).success
    ).toBe(false);
    const wide = "界";
    const largest = task.input.parse({
      framework: "north-star",
      product: wide.repeat(600),
      productGoal: wide.repeat(1000),
      feature: wide.repeat(120),
      existing: Array.from({ length: SUGGEST_EXISTING_MAX }, () => wide.repeat(200)),
    });
    expect(jsonBytes({ task: task.id, input: largest })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
  });
});
