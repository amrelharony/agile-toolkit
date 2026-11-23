// @vitest-environment node
/**
 * The golden test for ebm-dashboard.measures: a canned model answer gives
 * the expected measures, a bad answer is salvaged or refused, the
 * fallback answers every area with our own ideas minus the names the team
 * has, and the largest input fits the body budget in 3-byte text.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { EBM_VALUE_AREAS } from "@/lib/stores/workspace-types";
import { MEASURE_IDEAS, ideaNamed } from "@/lib/ebm/ideas";
import {
  MEASURES_EXISTING_MAX,
  ebmMeasuresFallback,
  ebmMeasuresTask,
} from "@/lib/ai/tasks/ebm-dashboard";
import { ebmMeasuresPrompt } from "@/lib/ai/tasks/ebm-dashboard.server";
import { ebmMeasuresTask as ref } from "@/lib/ai/tasks/ebm-dashboard.lite";

const task = ebmMeasuresTask;

describe("ebm-dashboard.measures", () => {
  it("is a small list task for the owner and visitors alike", () => {
    expect(task).toMatchObject({
      id: "ebm-dashboard.measures",
      toolId: "ebm-dashboard",
      tier: "flash",
      effort: "low",
      maxTokens: 4096,
    });
    expect(task.ownerOnly).toBeUndefined();
    expect(ref.fallback).toBe(task.fallback);
  });

  it("reads a typical model answer", () => {
    const parsed = parseAnswer(
      '{"measures": [{"name": "Days to first feedback", "definition": "From idea to a customer seeing it.", "unit": "days", "direction": "decrease"}]}',
      task.output
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.measures).toEqual([
        {
          name: "Days to first feedback",
          definition: "From idea to a customer seeing it.",
          unit: "days",
          direction: "decrease",
        },
      ]);
    }
  });

  it("salvages a crowded answer and refuses an empty one", () => {
    const many = JSON.stringify({
      measures: Array.from({ length: 7 }, (_, i) => ({ name: `M${i}`, direction: "increase" })),
    });
    const parsed = parseAnswer(many, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.measures).toHaveLength(5);
    expect(parseAnswer('{"measures": []}', task.output).ok).toBe(false);
  });

  it("falls back to the area's own ideas, without names the team has", () => {
    for (const area of EBM_VALUE_AREAS) {
      const out = ebmMeasuresFallback({ area, product: "", existing: [] });
      expect(task.output.safeParse(out).success, area).toBe(true);
      expect(out.measures.map((m) => m.name)).toEqual(MEASURE_IDEAS[area].map((i) => i.name));
    }
    const out = ebmMeasuresFallback(task.input.parse(task.sample));
    expect(out.measures.map((m) => m.name)).not.toContain("Median cycle time");
    const every = ebmMeasuresFallback({
      area: "time-to-market",
      product: "",
      existing: MEASURE_IDEAS["time-to-market"].map((i) => i.name),
    });
    expect(every.measures).toHaveLength(1);
    expect(() =>
      ebmMeasuresFallback({ area: "nope" as "time-to-market", product: "", existing: [] })
    ).toThrow();
  });

  it("answers names that find their idea again, so a sourced idea keeps its source", () => {
    for (const area of EBM_VALUE_AREAS) {
      const out = ebmMeasuresFallback({ area, product: "", existing: [] });
      for (const m of out.measures) {
        expect(ideaNamed(area, m.name), m.name).toBe(
          MEASURE_IDEAS[area].find((i) => i.name === m.name)
        );
      }
    }
    expect(ideaNamed("time-to-market", "  median CYCLE   time ")?.source).toBe("cycle-time-median");
    expect(ideaNamed("current-value", "Median cycle time")).toBeUndefined();
  });

  it("builds the prompt on the server, the data inside the block", () => {
    const system = buildTaskSystem(task, ebmMeasuresPrompt);
    expect(system).toContain("key value area");
    const user = buildTaskUser(
      ebmMeasuresPrompt,
      task.input.parse({ area: "unrealized-value", product: "P", strategicGoal: "S", existing: [] })
    );
    expect(user).toContain("<user_content>");
    expect(user).toContain("unrealized value");
    expect(user).toContain("Strategic goal: S");
    expect(user).toContain("(none yet)");
  });

  it("caps its input, and its largest input fits the body budget in 3-byte text", () => {
    expect(
      task.input.safeParse({ area: "current-value", product: "x".repeat(601), existing: [] })
        .success
    ).toBe(false);
    const wide = "界";
    const largest = task.input.parse({
      area: "ability-to-innovate",
      product: wide.repeat(600),
      productGoal: wide.repeat(1000),
      strategicGoal: wide.repeat(1000),
      existing: Array.from({ length: MEASURES_EXISTING_MAX }, () => wide.repeat(200)),
    });
    expect(jsonBytes({ task: task.id, input: largest })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
  });
});
