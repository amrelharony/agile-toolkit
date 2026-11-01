import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUY_FEATURE_ACTIONS,
  EISENHOWER_ACTIONS,
  HUNDRED_DOLLAR_ACTIONS,
  PRIORITIZER_ACTIONS,
  WEIGHTED_DECISION_ACTIONS,
  isMilestoneAction,
} from "@/lib/history/event-actions";

/**
 * The Prioritize & decide history actions the upgraded pages log live in
 * the shared catalog, with the strings the pages logged before they were
 * listed (stored history rows keep them).
 */

const page = (tool: string, file: string) =>
  readFileSync(join(process.cwd(), "src", "app", "(tools)", tool, file), "utf8");

describe("the Prioritize & decide history actions", () => {
  it("keep the strings the pages logged", () => {
    expect(PRIORITIZER_ACTIONS.ORDER_SAVED).toBe("order_saved");
    expect(WEIGHTED_DECISION_ACTIONS.MATRIX_ADDED).toBe("matrix_added");
    expect(WEIGHTED_DECISION_ACTIONS.MATRIX_REMOVED).toBe("matrix_removed");
    // Every edit logged a move before: that string stays for moves.
    expect(EISENHOWER_ACTIONS.TASK_MOVED).toBe("task_moved");
    expect(EISENHOWER_ACTIONS.TASK_UPDATED).toBe("task_updated");
    expect(BUY_FEATURE_ACTIONS.ROUND_SAVED).toBe("round_saved");
    expect(HUNDRED_DOLLAR_ACTIONS.ROUND_SAVED).toBe("round_saved");
  });

  it("are not milestones", () => {
    expect(isMilestoneAction("prioritizer", PRIORITIZER_ACTIONS.ORDER_SAVED)).toBe(false);
    expect(isMilestoneAction("eisenhower", EISENHOWER_ACTIONS.TASK_UPDATED)).toBe(false);
    expect(isMilestoneAction("buy-a-feature", BUY_FEATURE_ACTIONS.ROUND_SAVED)).toBe(false);
    expect(isMilestoneAction("hundred-dollar-test", HUNDRED_DOLLAR_ACTIONS.ROUND_SAVED)).toBe(
      false
    );
    expect(isMilestoneAction("weighted-decision", WEIGHTED_DECISION_ACTIONS.MATRIX_ADDED)).toBe(
      false
    );
  });

  it("come from the catalog on the pages", () => {
    const prioritizer = page("prioritizer", "prioritizer-client.tsx");
    expect(prioritizer).toContain("PRIORITIZER_ACTIONS.ORDER_SAVED");
    expect(prioritizer).not.toContain('"order_saved"');

    const weighted = page("weighted-decision", "weighted-decision-client.tsx");
    expect(weighted).toContain("WEIGHTED_DECISION_ACTIONS.MATRIX_ADDED");
    expect(weighted).toContain("WEIGHTED_DECISION_ACTIONS.MATRIX_REMOVED");
    expect(weighted).not.toMatch(/"matrix_(added|removed)"/);

    // A saved round has its own action now, not a purchase or an amount change.
    const buy = page("buy-a-feature", "buy-a-feature-client.tsx");
    const hundred = page("hundred-dollar-test", "hundred-dollar-test-client.tsx");
    expect(buy).toContain("BUY_FEATURE_ACTIONS.ROUND_SAVED");
    expect(hundred).toContain("HUNDRED_DOLLAR_ACTIONS.ROUND_SAVED");
    for (const src of [buy, hundred]) expect(src).not.toMatch(/round: true/);

    const eisenhower = page("eisenhower", "config.ts");
    expect(eisenhower).toContain("EISENHOWER_ACTIONS.TASK_UPDATED");
    expect(eisenhower).toContain("EISENHOWER_ACTIONS.TASK_MOVED");
  });
});
