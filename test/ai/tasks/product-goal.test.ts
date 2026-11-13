// @vitest-environment node
/**
 * The golden test for product-goal.draft: a canned model answer gives the
 * expected goals, a bad answer is salvaged or refused (the page then offers
 * the fallback), and the fallback answers every input with valid goals.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import {
  GOAL_DRAFT_MAX,
  commonTheme,
  fallbackGoals,
  productGoalDraftTask,
} from "@/lib/ai/tasks/product-goal";
import { productGoalDraftPrompt } from "@/lib/ai/tasks/product-goal.server";

const task = productGoalDraftTask;

describe("product-goal.draft", () => {
  it("is a reasoning task for the owner and visitors alike", () => {
    expect(task).toMatchObject({ id: "product-goal.draft", toolId: "product-goal", tier: "full" });
    expect(task.ownerOnly).toBeUndefined();
  });

  it("reads a typical model answer", () => {
    const answer = `Here are three options:
\`\`\`json
{"goals": [
  {"statement": "Shop owners take every payment on their phone, with no card machine", "why": "Card machines cost them money and sales", "measures": ["Share of shops with no card machine", "Payments a day per shop"]},
  {"statement": "Shop owners see yesterday's money in their bank every morning", "measures": ["Payouts that arrive next day"]}
]}
\`\`\``;
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.goals).toHaveLength(2);
      expect(parsed.data.goals[1]).toEqual({
        statement: "Shop owners see yesterday's money in their bank every morning",
        measures: ["Payouts that arrive next day"],
      });
    }
  });

  it("salvages a long or crowded answer and refuses one with no goals", () => {
    const many = JSON.stringify({
      goals: Array.from({ length: 5 }, (_, i) => ({
        statement: i === 0 ? "x".repeat(400) : `Goal ${i}`,
        measures: ["a", "b", "c", "d", "e", "f"],
      })),
    });
    const parsed = parseAnswer(many, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.goals).toHaveLength(GOAL_DRAFT_MAX);
      expect(parsed.data.goals[0].statement).toHaveLength(300);
    }
    expect(parseAnswer('{"goals": []}', task.output).ok).toBe(false);
    expect(parseAnswer("I can't help with that.", task.output).ok).toBe(false);
  });

  it("falls back to templates built from the vision and the backlog", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.goals).toHaveLength(3);
    expect(out.goals[0].statement).toContain("small shop owners take payments anywhere");
    expect(out.goals[2].statement).toBe(
      "Make payout work so well that customers choose us for it."
    );
    const blank = fallbackGoals({ vision: "", stories: [] });
    expect(blank).toHaveLength(2);
    expect(blank[0].statement).toMatch(/\[who\]/);
    expect(task.output.safeParse({ goals: blank }).success).toBe(true);
    expect(commonTheme(["Refund a payment", "Partial refund", "Pay"])).toBe("refund");
    expect(commonTheme(["One", "Two"])).toBe("");
  });

  it("keeps every fallback draft inside the output's caps, whatever the input holds", () => {
    // A long word in two titles is no theme; long titles and a long vision are cut.
    const long = "x".repeat(190);
    const codes = fallbackGoals({ vision: "", stories: [`Pay ${long}`, `Refund ${long}`] });
    expect(task.output.safeParse({ goals: codes }).success).toBe(true);
    expect(codes).toHaveLength(2);
    expect(commonTheme([`Pay ${long}`, `Refund ${long}`])).toBe("");
    const word = "y".repeat(30);
    const themed = fallbackGoals({
      vision: `${"Shops ".repeat(330)}take payments.`,
      stories: [`Pay ${word}`, `Refund ${word}`],
    });
    expect(task.output.safeParse({ goals: themed }).success).toBe(true);
    expect(themed[2].measures[0]).toBe(`Customers who use ${word} each month`);
    for (const g of themed) {
      expect(g.statement.length).toBeLessThanOrEqual(300);
      expect(g.measures.every((m) => m.length <= 200)).toBe(true);
    }
  });

  it("builds the prompt on the server, the data inside the block", () => {
    const system = buildTaskSystem(task, productGoalDraftPrompt);
    expect(system).toContain("Product Goal");
    expect(system).toContain("not a list of features");
    const user = buildTaskUser(
      productGoalDraftPrompt,
      task.input.parse({ vision: "V", stories: ["A", "B"], current: "Old goal" })
    );
    expect(user).toBe(
      "<user_content>\nProduct vision: V\nCurrent goal: Old goal\nBacklog story titles:\n- A\n- B\n</user_content>"
    );
  });

  it("caps its input", () => {
    expect(task.input.safeParse({ vision: "x".repeat(2001), stories: [] }).success).toBe(false);
    expect(
      task.input.safeParse({ vision: "", stories: Array.from({ length: 31 }, () => "s") }).success
    ).toBe(false);
  });
});
