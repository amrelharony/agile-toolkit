import type { ScaleStep } from "@/components/shared/scale-picker";

/**
 * The 1–5 scales a debt item is rated on, each value with what it means,
 * so a 4 means the same for every item. Impact is how much the debt slows
 * the team; effort is how much work paying it down is (not story points:
 * a story sent to the backlog is estimated there).
 */
export const DEBT_IMPACT_STEPS: readonly ScaleStep[] = [
  { value: 1, meaning: "Barely noticed" },
  { value: 2, meaning: "Slows a task now and then" },
  { value: 3, meaning: "Slows the team most sprints" },
  { value: 4, meaning: "Slows every sprint, or causes rework" },
  { value: 5, meaning: "Blocks work or causes incidents" },
];

export const DEBT_EFFORT_STEPS: readonly ScaleStep[] = [
  { value: 1, meaning: "Under a day" },
  { value: 2, meaning: "A few days" },
  { value: 3, meaning: "About a sprint" },
  { value: 4, meaning: "Several sprints" },
  { value: 5, meaning: "A project of its own" },
];

export const DEBT_IMPACT_HINT = "1 barely noticed · 3 slows most sprints · 5 blocks work.";
export const DEBT_EFFORT_HINT = "1 under a day · 3 about a sprint · 5 a project of its own.";
