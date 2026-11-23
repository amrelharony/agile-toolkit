import type { AbTest } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";
import { exampleId } from "@/lib/utils/example-id";

/**
 * Two of a product team's tests: a shorter sign-up form that has run its
 * plan (10% today, +20% worth finding, 95% and 80%: 3,841 a version, two
 * weeks at 800 visitors a day) with its counts in and no decision yet, and
 * an annual-plan banner still being planned. Days count back from `today`.
 * Ids start with `example-`; "Clear example" removes exactly them, and
 * neither links to a hypothesis or a metric of the team's.
 */
export function buildExample(today: string, now = new Date().toISOString()): AbTest[] {
  const ago = (n: number) => addDays(today, -n) ?? today;
  return [
    {
      id: exampleId("ab-signup"),
      name: "Shorter sign-up form",
      question: "Does cutting the sign-up form to three fields get more visitors to sign up?",
      metricName: "sign-up conversion",
      plan: {
        baseline: 0.1,
        mde: 0.2,
        mdeMode: "relative",
        confidence: 0.95,
        power: 0.8,
        sided: "two",
        dailyTraffic: 800,
      },
      variants: [
        { id: "a", name: "A", visitors: 4020, conversions: 402 },
        { id: "b", name: "B", visitors: 3980, conversions: 477 },
      ],
      guardrails: [{ name: "Error rate", why: "Fewer fields mustn't mean more failed sign-ups." }],
      status: "done",
      startedOn: ago(12),
      endedOn: ago(2),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: exampleId("ab-annual"),
      name: "Annual plan banner",
      question: "Does a banner on the billing page move people to the annual plan?",
      metricName: "annual plan take-up",
      plan: {
        baseline: 0.04,
        mde: 0.25,
        mdeMode: "relative",
        confidence: 0.95,
        power: 0.8,
        sided: "two",
        dailyTraffic: 1200,
      },
      variants: [
        { id: "a", name: "A", visitors: 0, conversions: 0 },
        { id: "b", name: "B", visitors: 0, conversions: 0 },
      ],
      status: "planned",
      createdAt: now,
      updatedAt: now,
    },
  ];
}
