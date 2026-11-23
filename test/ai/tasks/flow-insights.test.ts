// @vitest-environment node
/**
 * The golden test for flow-insights.classify: a canned answer gives a type,
 * repeat work and a reason per short id; a bad item is dropped while the
 * rest are kept; unknown or repeated ids are dropped against what was sent;
 * the fallback answers from the page's rules, then title words; and the
 * largest input, in 3-byte text, fits the body budget once fitted.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  CLASSIFY_ITEMS_MAX,
  CLASSIFY_TAGS_MAX,
  CLASSIFY_TAG_MAX,
  CLASSIFY_TEXT_MAX,
  CLASSIFY_TITLE_MAX,
  classifyFallback,
  cleanClassified,
  fitClassifyInput,
  flowInsightsClassifyTask,
  type ClassifyInput,
} from "@/lib/ai/tasks/flow-insights";
import { flowInsightsClassifyPrompt } from "@/lib/ai/tasks/flow-insights.server";

const task = flowInsightsClassifyTask;

describe("flow-insights.classify", () => {
  it("is a quick task with room for sixty answers", () => {
    expect(task).toMatchObject({ tier: "flash", effort: "low", maxTokens: 6144 });
  });

  it("reads a typical model answer", () => {
    const answer = JSON.stringify({
      items: [
        { id: "i1", type: "feature", failure: false, reason: "New way to pay." },
        { id: "i2", type: "defect", failure: true, reason: "Fixes wrong totals; reopened." },
        { id: "i3", type: "debt", failure: false, reason: "An SDK upgrade." },
      ],
    });
    const parsed = parseAnswer(`Here you go:\n${answer}`, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.data.items.map((i) => i.type)).toEqual(["feature", "defect", "debt"]);
  });

  it("drops an item with an unknown type and keeps the rest", () => {
    const answer = JSON.stringify({
      items: [
        { id: "i1", type: "chore", failure: false, reason: "x" },
        { id: "i2", type: "risk", failure: false, reason: "A spike." },
      ],
    });
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.items.map((i) => i.id)).toEqual(["i2"]);
    expect(parseAnswer("no json here", task.output).ok).toBe(false);
  });

  it("keeps only the ids it sent, each once", () => {
    const out = cleanClassified(
      [
        { id: "i1", type: "feature", failure: false, reason: "a" },
        { id: "i9", type: "defect", failure: true, reason: "b" },
        { id: "i1", type: "debt", failure: false, reason: "c" },
      ],
      new Set(["i1", "i2"])
    );
    expect(out).toEqual([{ id: "i1", type: "feature", failure: false, reason: "a" }]);
  });

  it("falls back to the page's rules, then title words, with a valid answer", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    const byId = Object.fromEntries(out.items.map((i) => [i.id, i]));
    expect(byId.i1).toMatchObject({ type: "feature", failure: false });
    // No rule fires on "Totals wrong…", so it reads as a feature, but it was reopened.
    expect(byId.i2).toMatchObject({ type: "feature", failure: true });
    expect(byId.i2.reason).toMatch(/reopened/);
    expect(byId.i3).toMatchObject({ type: "debt", failure: false });
    expect(byId.i4).toMatchObject({ type: "risk" });
    expect(byId.i4.reason).toBe("Its tags say so.");
    const fix = classifyFallback({
      items: [{ id: "i1", title: "Fix the login crash", tags: [], reopened: false }],
    });
    expect(fix.items[0]).toMatchObject({ type: "defect", failure: true });
    const sent = classifyFallback({
      items: [{ id: "i1", title: "Rotate keys", tags: [], from: "threat-model", reopened: false }],
    });
    expect(sent.items[0]).toMatchObject({ type: "risk" });
    expect(() => classifyFallback({ items: [] })).toThrow();
  });

  it("fits the largest input, in 3-byte text, inside the body budget", () => {
    const cjk = (n: number) => "数".repeat(n);
    const largest: ClassifyInput = {
      items: Array.from({ length: CLASSIFY_ITEMS_MAX }, (_, i) => ({
        id: `i${i + 1}`,
        title: cjk(CLASSIFY_TITLE_MAX),
        text: cjk(CLASSIFY_TEXT_MAX),
        tags: Array.from({ length: CLASSIFY_TAGS_MAX }, () => cjk(CLASSIFY_TAG_MAX)),
        from: "bug-triage",
        reopened: true,
      })),
    };
    expect(task.input.safeParse(largest).success).toBe(true);
    const size = (input: ClassifyInput) => jsonBytes({ task: task.id, input });
    expect(size(largest)).toBeGreaterThan(TOOL_AI_BODY_BUDGET);
    const fitted = fitClassifyInput(largest);
    expect(size(fitted)).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
    expect(task.input.safeParse(fitted).success).toBe(true);
    // Tags and notes go first, from the last item up, before whole items: every item still fits.
    expect(fitted.items).toHaveLength(CLASSIFY_ITEMS_MAX);
    const last = fitted.items[CLASSIFY_ITEMS_MAX - 1];
    expect(last.tags).toEqual([]);
    expect(last.text).toBeUndefined();
    expect(fitted.items[0].tags).toHaveLength(CLASSIFY_TAGS_MAX);
    // The input it was given is left as it was.
    expect(largest.items[CLASSIFY_ITEMS_MAX - 1].tags).toHaveLength(CLASSIFY_TAGS_MAX);
    const small = { items: [largest.items[0]] };
    expect(fitClassifyInput(small, TOOL_AI_BODY_BUDGET)).toBe(small);
  });

  it("builds a prompt with the items as data", () => {
    const sample = task.input.parse(task.sample);
    expect(buildTaskSystem(task, flowInsightsClassifyPrompt)).toMatch(/feature/);
    const user = buildTaskUser(flowInsightsClassifyPrompt, sample);
    expect(user).toContain("i2: Totals wrong when a voucher is removed | reopened");
    expect(user).toContain("i4: Spike: fraud checks for new cards | tags: spike");
  });
});
