import { exampleId } from "@/components/tool-frame/example-data";
import type { SprintGoal } from "@/lib/stores/workspace-types";

/**
 * A mobile checkout team's two-week sprint. Two criteria pass every SMART
 * check; one has no number or deadline, and one isn't ticked as relevant,
 * so the badges have something to say.
 */
export function buildExample(): Omit<SprintGoal, "id"> {
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
    keyResults: [
      "30% of returning shoppers pay with a saved card in the first week",
      "Payment-step drop-off falls from 22% to 15%",
      "No card numbers found in logs or the database by the security scan",
    ],
  };
}
