import type {
  WeightedCriterion,
  WeightedMatrix,
  WeightedOption,
} from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

export interface WeightedExample {
  matrix: WeightedMatrix;
  criteria: WeightedCriterion[];
  options: WeightedOption[];
}

/**
 * "Pick a feature-flag vendor": four weighted criteria and three options.
 * LaunchDarkly and Unleash finish close (within 5 %: the tie warning), and
 * the in-house build has one cell left empty, so its total reads as partial
 * and it can't take the star. Every id starts with `example-`; "Clear
 * example" deletes the matrix, which takes its rows with it.
 */
export function buildExample(now: string): WeightedExample {
  const matrixId = exampleId("matrix-flags");
  const c = (key: string) => exampleId(`crit-${key}`);
  return {
    matrix: {
      id: matrixId,
      name: "Feature-flag vendor",
      question: "Which feature-flag service do we adopt?",
      createdAt: now,
    },
    criteria: [
      {
        id: c("cost"),
        name: "Cost",
        weight: 3,
        matrixId,
        low: "Over budget",
        high: "Well under budget",
      },
      {
        id: c("sdk"),
        name: "SDK coverage",
        weight: 2,
        matrixId,
        low: "Our stack missing",
        high: "Every stack we use",
      },
      {
        id: c("hosting"),
        name: "Self-hosting",
        weight: 2,
        matrixId,
        low: "SaaS only",
        high: "Runs in our cloud",
      },
      {
        id: c("support"),
        name: "Support",
        weight: 1,
        matrixId,
        low: "Forums only",
        high: "24/7 with an SLA",
      },
    ],
    options: [
      {
        id: exampleId("opt-launchdarkly"),
        name: "LaunchDarkly",
        matrixId,
        scores: { [c("cost")]: 6, [c("sdk")]: 10, [c("hosting")]: 5, [c("support")]: 10 },
        note: "Most features; priced per seat.",
      },
      {
        id: exampleId("opt-unleash"),
        name: "Unleash",
        matrixId,
        scores: { [c("cost")]: 8, [c("sdk")]: 7, [c("hosting")]: 9, [c("support")]: 3 },
      },
      {
        id: exampleId("opt-inhouse"),
        name: "Build our own",
        matrixId,
        scores: { [c("cost")]: 6, [c("sdk")]: 4, [c("hosting")]: 10 },
        note: "Support not scored yet: who would run it?",
      },
    ],
  };
}
