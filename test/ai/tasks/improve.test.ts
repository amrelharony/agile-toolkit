// @vitest-environment node
/**
 * The golden test for improve.next_experiment, and for what Improve's two AI
 * buttons send: a canned model answer gives the expected experiments, a bad
 * answer is salvaged or refused (the page then offers the fallback), the
 * fallback answers with valid experiments (each with what to expect, with
 * and without a metric) and refuses a Kata with no obstacle or target, the
 * largest input fits the body budget in 3-byte text, and the prompt keeps
 * the data inside its block. The A3's countermeasure input for Root Cause's
 * task is fitted to the same budget.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import {
  EXPERIMENTS_MAX,
  EXPERIMENT_INPUT_MAX,
  fallbackExperiments,
  fitCountermeasureInput,
  improveNextExperimentTask,
} from "@/lib/ai/tasks/improve";
import { improveNextExperimentTask as ref } from "@/lib/ai/tasks/improve.lite";
import { improveNextExperimentPrompt } from "@/lib/ai/tasks/improve.server";
import { countermeasureTask } from "@/lib/ai/tasks/root-cause";
import { a3CountermeasureInput, experimentBlocker, experimentInput } from "@/lib/improve/ai-input";
import type { Improvement, RootCauseAnalysis } from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

const task = improveNextExperimentTask;
/** Text that costs 3 bytes a counted character (a CJK letter), the most real text costs. */
const wide = (n: number) => "界".repeat(n);

const kata = (over: Partial<Improvement> = {}): Improvement => ({
  id: "improve_k",
  title: "Reviews wait too long",
  method: "kata",
  status: "open",
  owner: "Sam",
  coach: "Priya",
  background: "Every change is reviewed within a working day.",
  current: {
    text: "Most of a day",
    metric: "First-review wait",
    value: 19,
    unit: "h",
    date: "2026-11-01",
  },
  target: {
    text: "Within a morning",
    metric: "First-review wait",
    value: 8,
    unit: "h",
    date: "2026-12-04",
  },
  obstacles: [{ id: "o1", text: "Only Sam reviews payment code", status: "working" }],
  steps: [
    {
      id: "s1",
      text: "A review slot after standup",
      expect: "The wait drops below 15 h",
      result: "It fell to 15 h",
      learned: "Who reviews matters more",
      owner: "Sam",
      status: "done",
    },
  ],
  readings: [{ id: "r1", date: "2026-11-15", value: 13 }],
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-15T09:00:00.000Z",
  ...over,
});

describe("improve.next_experiment", () => {
  it("is a reasoning task for the owner and visitors alike, with its ref beside it", () => {
    expect(task).toMatchObject({ id: "improve.next_experiment", toolId: "improve", tier: "full" });
    expect(task.ownerOnly).toBeUndefined();
    expect(ref.id).toBe(task.id);
    expect(ref.fallback).toBe(task.fallback);
  });

  it("reads a typical model answer", () => {
    const answer = `Here you go:
\`\`\`json
{"experiments": [
  {"step": "Pair a second reviewer on payment changes for three days", "expect": "Payment changes get a first review the same morning"},
  {"step": "Split pull requests over 300 lines", "expect": "Smaller changes are picked up sooner"}
]}
\`\`\``;
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.experiments).toHaveLength(2);
      expect(parsed.data.experiments[1]).toEqual({
        step: "Split pull requests over 300 lines",
        expect: "Smaller changes are picked up sooner",
      });
    }
  });

  it("salvages a long or crowded answer and refuses one with nothing to try", () => {
    const many = JSON.stringify({
      experiments: Array.from({ length: 6 }, (_, i) => ({
        step: i === 0 ? "x".repeat(500) : `Try ${i}`,
        expect: `Expect ${i}`,
      })),
    });
    const parsed = parseAnswer(many, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.experiments).toHaveLength(EXPERIMENTS_MAX);
      expect(parsed.data.experiments[0].step).toHaveLength(200);
    }
    expect(parseAnswer('{"experiments": []}', task.output).ok).toBe(false);
    expect(parseAnswer("I can't help with that.", task.output).ok).toBe(false);
  });

  it("falls back to three tries, each with what to expect, with and without a metric", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.experiments).toHaveLength(3);
    expect(out.experiments[0]).toEqual({
      step: "Try one small change to “Only two people feel able to review payment code” for two days.",
      expect: "“First-review wait (median)” moves towards the target, even a little.",
    });
    for (const e of out.experiments) expect(e.expect.trim()).not.toBe("");
    const bare = fallbackExperiments("Nobody owns the queue", "", "Under a day");
    expect(bare[0].expect).toBe("The number moves towards the target, even a little.");
    expect(task.output.safeParse({ experiments: bare }).success).toBe(true);
  });

  it("keeps every fallback experiment inside the output's caps, whatever the input holds", () => {
    const out = fallbackExperiments(wide(300), wide(200), wide(1000));
    expect(task.output.safeParse({ experiments: out }).success).toBe(true);
  });

  it("refuses, rather than answer, a Kata with no obstacle or no target", () => {
    expect(() => fallbackExperiments("  ", "Wait", "Under 8 h")).toThrow(/obstacle/);
    expect(() => fallbackExperiments("One reviewer", "Wait", "")).toThrow(/target/);
  });

  it("fits the body budget at its caps in 3-byte text, so it needs no fitter", () => {
    const I = EXPERIMENT_INPUT_MAX;
    const largest = {
      challenge: wide(I.challenge),
      target: wide(I.target),
      current: wide(I.current),
      metric: wide(I.metric),
      obstacle: wide(I.obstacle),
      past: Array.from({ length: I.past }, () => ({
        step: wide(I.pastField),
        expect: wide(I.pastField),
        result: wide(I.pastField),
        learned: wide(I.pastField),
      })),
    };
    expect(task.input.safeParse(largest).success).toBe(true);
    expect(jsonBytes({ task: task.id, input: largest })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
  });

  it("builds a prompt that keeps the data inside its block", () => {
    const prompt = improveNextExperimentPrompt;
    expect(buildTaskSystem(task, prompt)).toContain("JSON");
    const user = buildTaskUser(prompt, task.input.parse(task.sample));
    expect(user.startsWith("<user_content>\n")).toBe(true);
    expect(user.endsWith("\n</user_content>")).toBe(true);
    expect(user).toContain("Obstacle we're on: Only two people feel able to review payment code.");
    expect(user).toContain("1. Tried: A review slot after standup every day.");
    const none = buildTaskUser(
      prompt,
      task.input.parse({ ...task.sample, past: [], challenge: "" })
    );
    expect(none).toContain("Past experiments: (none yet)");
    expect(none).not.toContain("Challenge:");
  });
});

describe("what the Kata's button sends", () => {
  it("composes the target and where it stands at the latest reading, with no names", () => {
    const input = experimentInput(kata())!;
    expect(task.input.safeParse(input).success).toBe(true);
    expect(input).toEqual({
      challenge: "Every change is reviewed within a working day.",
      target: "Within a morning: First-review wait 8 h by 2026-12-04",
      current: "Most of a day: First-review wait 13 h on 2026-11-15",
      metric: "First-review wait",
      obstacle: "Only Sam reviews payment code",
      past: [
        {
          step: "A review slot after standup",
          expect: "The wait drops below 15 h",
          result: "It fell to 15 h",
          learned: "Who reviews matters more",
        },
      ],
    });
    // Owners and the coach never travel (the obstacle's own words may name someone).
    expect(JSON.stringify(input)).not.toContain("Priya");
  });

  it("cuts each field to its cap and keeps the last 10 experiments", () => {
    const steps = Array.from({ length: 14 }, (_, i) => ({
      id: `s${i}`,
      text: `Try ${i} ${"x".repeat(400)}`,
      status: "done" as const,
    }));
    const input = experimentInput(
      kata({
        background: "y".repeat(1000),
        obstacles: [{ id: "o1", text: "z".repeat(1000), status: "working" }],
        steps,
      })
    )!;
    expect(task.input.safeParse(input).success).toBe(true);
    expect(input.past).toHaveLength(10);
    expect(input.past[0].step.startsWith("Try 4")).toBe(true);
    expect(input.obstacle).toHaveLength(EXPERIMENT_INPUT_MAX.obstacle);
  });

  it("waits for an obstacle being worked on and a target", () => {
    expect(experimentBlocker(kata({ obstacles: [] }))).toBe("Pick the obstacle you're on first.");
    expect(experimentBlocker(kata({ target: { text: "" } }))).toBe("Set the target first.");
    expect(experimentInput(kata({ obstacles: [] }))).toBeNull();
  });
});

describe("what the A3's button sends to root-cause.countermeasure", () => {
  const a3 = kata({ method: "a3", title: "Releases wait six days.", analysis: "" });
  const analysis = {
    id: "rca_1",
    title: "Releases",
    problem: "Slow",
    method: "five-whys",
    rootCause: "The regression pass is manual",
    whys: [{ id: "w1", text: "Releases wait for the pass" }],
    causes: [
      { id: "c1", category: "Process", text: "Manual pass", count: 3 },
      { id: "c2", category: "Tools", text: "No test data", count: 5 },
    ],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
  } as RootCauseAnalysis;

  it("waits for a cause, then sends the problem, the cause, the whys and the top Pareto causes", () => {
    expect(a3CountermeasureInput(a3)).toBeNull();
    const input = a3CountermeasureInput(a3, analysis)!;
    expect(countermeasureTask.input.safeParse(input).success).toBe(true);
    expect(input).toEqual({
      problem:
        "Releases wait six days. Every change is reviewed within a working day. Most of a day: First-review wait 19 h on 2026-11-01",
      rootCause: "The regression pass is manual",
      whys: ["Releases wait for the pass"],
      causes: ["No test data", "Manual pass"],
    });
    expect(a3CountermeasureInput({ ...a3, analysis: "Our own words" }, analysis)!.rootCause).toBe(
      "Our own words"
    );
  });

  it("fits the largest input in 3-byte text into the body budget, keeping the problem and cause", () => {
    const largest = {
      problem: wide(1000),
      rootCause: wide(1000),
      whys: Array.from({ length: 20 }, () => wide(1000)),
      causes: Array.from({ length: 20 }, () => wide(300)),
    };
    expect(jsonBytes({ task: countermeasureTask.id, input: largest })).toBeGreaterThan(
      TOOL_AI_BODY_BUDGET
    );
    const fitted = fitCountermeasureInput(largest);
    expect(jsonBytes({ task: countermeasureTask.id, input: fitted })).toBeLessThanOrEqual(
      TOOL_AI_BODY_BUDGET
    );
    expect(fitted.problem).toBe(largest.problem);
    expect(fitted.rootCause).toBe(largest.rootCause);
    expect(countermeasureTask.input.safeParse(fitted).success).toBe(true);
    const small = { problem: "P", rootCause: "R", whys: ["W"], causes: ["C"] };
    expect(fitCountermeasureInput(small)).toBe(small);
  });
});
