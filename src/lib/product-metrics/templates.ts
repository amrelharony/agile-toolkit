/**
 * Product Metrics' own metric templates, the answer without AI to "Ask
 * Amr" (`product-metrics.suggest`): a North Star with three inputs, the
 * five HEART categories for one feature, and the five funnel stages. Every
 * name and definition is our own wording, kept generic so the person
 * renames it for their product.
 *
 * Pure, and free of zod: the task's lite module imports it.
 */

import type {
  AarrrStage,
  HeartCategory,
  MetricDirection,
  MetricRole,
} from "@/lib/stores/workspace-types";

/** The frameworks Ask Amr suggests for. */
export const METRIC_FRAMEWORKS = ["north-star", "heart", "aarrr"] as const;
export type MetricFramework = (typeof METRIC_FRAMEWORKS)[number];

/** One suggested metric, as the task's output holds it. */
export interface SuggestedMetric {
  name: string;
  definition?: string;
  unit?: string;
  direction: MetricDirection;
  role?: MetricRole;
  heartCategory?: HeartCategory;
  goal?: string;
  signal?: string;
  aarrrStage?: AarrrStage;
}

/** The output's caps. */
export const SUGGESTED_NAME_MAX = 120;
export const SUGGESTED_DEFINITION_MAX = 300;
export const SUGGESTED_UNIT_MAX = 40;
export const SUGGESTED_GOAL_MAX = 200;
export const SUGGESTED_MAX = 8;

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

const NORTH_STAR: SuggestedMetric[] = [
  {
    name: "People who got real value this week",
    definition:
      "Count the people who did the thing the product is for at least once in the week, not only those who logged in.",
    unit: "people",
    direction: "increase",
    role: "north-star",
  },
  {
    name: "New people who reach a first success",
    definition: "People who finish the main task for the first time in the week.",
    unit: "people",
    direction: "increase",
    role: "input",
  },
  {
    name: "Times an active person comes back each week",
    definition: "The average number of days in the week an active person uses the product.",
    unit: "days",
    direction: "increase",
    role: "input",
  },
  {
    name: "Share of started tasks that are finished",
    definition: "Of the main tasks people start, the share they finish in the same visit.",
    unit: "%",
    direction: "increase",
    role: "input",
  },
];

const HEART: { category: HeartCategory; make: (f: string) => SuggestedMetric }[] = [
  {
    category: "happiness",
    make: (f) => ({
      name: `People who rate ${f} 4 or 5 out of 5`,
      definition: `Ask one short question after people use ${f}, and count the share who answer 4 or 5.`,
      unit: "%",
      direction: "increase",
      heartCategory: "happiness",
      goal: `People enjoy using ${f}.`,
      signal: "They rate it well when asked.",
    }),
  },
  {
    category: "engagement",
    make: (f) => ({
      name: `Uses of ${f} per active person each week`,
      definition: `How many times in a week a person who uses ${f} comes back to it.`,
      unit: "uses",
      direction: "increase",
      heartCategory: "engagement",
      goal: `${f} becomes part of how people work.`,
      signal: "They use it more than once a week.",
    }),
  },
  {
    category: "adoption",
    make: (f) => ({
      name: `People using ${f} for the first time each week`,
      definition: `Count the people who try ${f} for the first time in the week.`,
      unit: "people",
      direction: "increase",
      heartCategory: "adoption",
      goal: `People who would gain from ${f} find it.`,
      signal: "They try it soon after it is offered.",
    }),
  },
  {
    category: "retention",
    make: (f) => ({
      name: `People still using ${f} four weeks later`,
      definition: `Of the people who first used ${f} four weeks ago, the share who used it again this week.`,
      unit: "%",
      direction: "increase",
      heartCategory: "retention",
      goal: `People keep coming back to ${f}.`,
      signal: "They use it again weeks after they first did.",
    }),
  },
  {
    category: "task-success",
    make: (f) => ({
      name: `${f} tasks finished without an error`,
      definition: `Of the tasks people start in ${f}, the share they finish with no error or retry.`,
      unit: "%",
      direction: "increase",
      heartCategory: "task-success",
      goal: `People get the job done in ${f} quickly.`,
      signal: "They finish without errors or giving up.",
    }),
  },
];

const AARRR: SuggestedMetric[] = [
  {
    name: "Visitors who sign up",
    definition: "People who create an account in the period.",
    unit: "people",
    direction: "increase",
    aarrrStage: "acquisition",
  },
  {
    name: "Sign-ups who finish setup",
    definition: "Of the period's sign-ups, the people who reach their first good result.",
    unit: "people",
    direction: "increase",
    aarrrStage: "activation",
  },
  {
    name: "People active again a week later",
    definition: "Of the people who finished setup, those who came back in the week after.",
    unit: "people",
    direction: "increase",
    aarrrStage: "retention",
  },
  {
    name: "People who invite someone",
    definition: "People who send at least one invite or share in the period.",
    unit: "people",
    direction: "increase",
    aarrrStage: "referral",
  },
  {
    name: "People who pay",
    definition: "People who start paying in the period.",
    unit: "people",
    direction: "increase",
    aarrrStage: "revenue",
  },
];

/** A name as compared with the existing ones: trimmed, spaces collapsed, any case. */
const nameKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** A suggestion within the output's caps. */
function capped(m: SuggestedMetric): SuggestedMetric {
  return {
    ...m,
    name: cut(m.name, SUGGESTED_NAME_MAX),
    ...(m.definition !== undefined
      ? { definition: cut(m.definition, SUGGESTED_DEFINITION_MAX) }
      : {}),
    ...(m.unit !== undefined ? { unit: cut(m.unit, SUGGESTED_UNIT_MAX) } : {}),
    ...(m.goal !== undefined ? { goal: cut(m.goal, SUGGESTED_GOAL_MAX) } : {}),
    ...(m.signal !== undefined ? { signal: cut(m.signal, SUGGESTED_GOAL_MAX) } : {}),
  };
}

/**
 * The templates for a framework, with any name already in `existing` left
 * out. When every template is already there, the first one stays (the
 * page reads it as already set), so the answer is never empty. Throws on a
 * framework it doesn't know.
 */
export function metricTemplates(input: {
  framework: MetricFramework;
  feature?: string;
  existing: readonly string[];
}): SuggestedMetric[] {
  let all: SuggestedMetric[];
  if (input.framework === "north-star") all = NORTH_STAR;
  else if (input.framework === "aarrr") all = AARRR;
  else if (input.framework === "heart") {
    const feature = (input.feature ?? "").replace(/\s+/g, " ").trim() || "the feature";
    all = HEART.map((h) => h.make(feature));
  } else {
    throw new Error("Pick North Star, HEART or the funnel first.");
  }
  const taken = new Set(input.existing.map(nameKey));
  const left = all.map(capped).filter((m) => !taken.has(nameKey(m.name)));
  return (left.length > 0 ? left : [capped(all[0])]).slice(0, SUGGESTED_MAX);
}
