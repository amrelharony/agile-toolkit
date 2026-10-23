import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import type { Okr, SprintGoal } from "@/lib/stores/workspace-types";

/** The example's linked OKR. It is never written to the OKRs list: the tool shows it read-only. */
export const EXAMPLE_OKR_ID = exampleId("sg-okr-1");

/**
 * A mobile checkout team's two-week sprint. Two criteria pass every SMART
 * check; one has no number or deadline, and one isn't ticked as relevant,
 * so the badges have something to say. The goal links one OKR instead of
 * copying key results into the goal.
 */
export function buildExample(): Omit<SprintGoal, "id" | "sprintId"> {
  return {
    businessObjective:
      "Win back mobile shoppers who give up at the payment step, where we lose the most orders.",
    goal: "Returning shoppers can pay with a saved card in one tap on iOS and Android by the end of Sprint 14.",
    criteria: [
      {
        id: exampleId("sg-criterion-1"),
        text: "Saved cards appear at checkout for 100% of signed-in shoppers on iOS and Android by end of sprint",
        relevantChecked: true,
      },
      {
        id: exampleId("sg-criterion-2"),
        text: "Paying with a saved card takes under 10 seconds on a mid-range phone by sprint end",
        relevantChecked: true,
      },
      {
        id: exampleId("sg-criterion-3"),
        text: "Card details stay with the payment provider and are never stored in our database",
        relevantChecked: true,
      },
      {
        id: exampleId("sg-criterion-4"),
        text: "QA signs off on 12 payment test cases, including declined and expired cards, before the sprint review",
        relevantChecked: false,
      },
    ],
    keyResults: [],
    okrIds: [EXAMPLE_OKR_ID],
  };
}

/** The OKR the example links, shown read-only while the example is loaded. */
export function buildExampleOkr(): Okr {
  return {
    id: EXAMPLE_OKR_ID,
    objective: "Make paying on mobile effortless",
    quarter: "Q4 2026",
    keyResults: [
      {
        id: exampleId("sg-kr-1"),
        title: "Returning shoppers who pay with a saved card",
        current: 12,
        target: 30,
        unit: "%",
      },
      {
        id: exampleId("sg-kr-2"),
        title: "Shoppers who finish the payment step",
        current: 78,
        target: 85,
        unit: "%",
      },
    ],
  };
}

/** Key results the example typed before goals linked OKRs; an old loaded example still clears. */
const LEGACY_EXAMPLE_KEY_RESULTS = [
  "30% of returning shoppers pay with a saved card in the first week",
  "Payment-step drop-off falls from 22% to 15%",
  "No card numbers found in logs or the database by the security scan",
];

/**
 * "Clear example": drop the example's criteria and OKR link, and its
 * objective, goal and key results while they still read as the example's.
 * Anything the user typed or linked stays.
 */
export function withoutExample(doc: SprintGoal): SprintGoal {
  const ex = buildExample();
  const okrIds = (doc.okrIds ?? []).filter((id) => !isExampleId(id));
  return {
    ...doc,
    businessObjective: doc.businessObjective === ex.businessObjective ? "" : doc.businessObjective,
    goal: doc.goal === ex.goal ? "" : doc.goal,
    criteria: doc.criteria.filter((c) => !isExampleId(c.id)),
    keyResults: doc.keyResults.filter(
      (kr) => kr.trim() && !LEGACY_EXAMPLE_KEY_RESULTS.includes(kr)
    ),
    ...(doc.okrIds ? { okrIds } : {}),
  };
}
