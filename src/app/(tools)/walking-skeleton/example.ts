import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import type { Layer, SkeletonData, SkeletonStep } from "./store";

/** The example's goal; "Clear example" clears the goal only while it still reads this. */
export const EXAMPLE_GOAL =
  "A shopper buys one product by card and sees an order number, end to end.";

/**
 * A shop's first walking skeleton: one product, one payment, one page back.
 * Three steps are done, from the checkout page down to the orders table.
 * Nothing deploys it yet, so the coverage check flags the missing infra
 * layer: the step teams most often leave out of a "skeleton" that then only
 * runs on a laptop.
 *
 * Every id starts with `example-`, so "Clear example" removes exactly these
 * steps and "Send to backlog" never turns them into real stories.
 */
const STEPS: [Layer, string, boolean][] = [
  ["ui", "Checkout page with one product and a Pay button", true],
  ["api", "POST /orders accepts the order and returns its id", true],
  ["data", "Save the order in the orders table", true],
  ["api", "Charge the card through the payment provider's sandbox", false],
  ["ui", "Confirmation page shows the order number", false],
];

export function buildExample(): SkeletonData {
  return {
    goal: EXAMPLE_GOAL,
    steps: STEPS.map(([layer, text, done], i) => ({
      id: exampleId(`ws-${i + 1}`),
      layer,
      text,
      done,
    })),
  };
}

/**
 * Load the example next to what's there: the user's own steps stay (after
 * the example's), and a goal they already typed isn't replaced.
 */
export function withExample(cur: SkeletonData): SkeletonData {
  const ex = buildExample();
  return {
    goal: cur.goal.trim() ? cur.goal : ex.goal,
    steps: [...ex.steps, ...cur.steps.filter((s) => !isExampleId(s.id))],
  };
}

/** The data without the example: its steps, and its goal if still unedited. */
export function withoutExample(cur: SkeletonData): SkeletonData {
  return {
    goal: cur.goal === EXAMPLE_GOAL ? "" : cur.goal,
    steps: cur.steps.filter((s: SkeletonStep) => !isExampleId(s.id)),
  };
}
