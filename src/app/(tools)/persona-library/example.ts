import { exampleId } from "@/lib/utils/example-id";
import type { Persona } from "@/lib/stores/workspace-types";

/**
 * Three made-up personas for a meal-kit app: Maya, a parent who works
 * shifts (the main persona, with some evidence), Tom, an office manager
 * ordering team lunches (also served, still a guess), and Riley, a deal
 * hunter who cancels after the first discount (who the app is not for).
 * Nobody real; every word is ours.
 */
export function buildExample(now: Date = new Date()): Persona[] {
  const at = now.toISOString();
  return [
    {
      id: exampleId("persona-maya"),
      name: "Maya",
      role: "Parent of two who works shifts",
      summary:
        "Maya cooks for a family of four around a rota that changes every week, and wants dinner to be one less thing to plan.",
      tier: "primary",
      evidence: "some",
      goals: [
        "Get a healthy dinner on the table in 30 minutes",
        "Plan the week's meals in one go, on her break",
        "Cook things both children will eat",
      ],
      pains: [
        "Recipes that need ingredients she has to buy separately",
        "Deliveries that arrive while she is at work",
        "Throwing away food when a shift runs late",
      ],
      behaviours: [
        "Orders on Sunday evening for the whole week",
        "Plans on her phone, a few minutes at a time",
        "Skips a week when the rota is busy",
      ],
      quote: "If I have to think about dinner after a late shift, we end up with toast.",
      context: "Orders from her phone on breaks; cooks at about 6 pm, often in a hurry.",
      tags: ["families", "time-poor", "mobile"],
      createdAt: at,
      updatedAt: at,
    },
    {
      id: exampleId("persona-tom"),
      name: "Tom",
      role: "Office manager ordering team lunches",
      summary:
        "Tom feeds a team of twenty on Fridays and is the one who hears about it when something is missing.",
      tier: "secondary",
      evidence: "assumed",
      goals: ["Order for twenty people without a spreadsheet", "Stay inside a monthly budget"],
      pains: [
        "Collecting dietary needs from everyone each time",
        "Invoices that don't match the order",
      ],
      behaviours: ["Orders on Thursday for Friday", "Reuses last week's order when it went well"],
      quote: "I just need it to arrive on time and suit everyone.",
      tags: ["teams", "budget"],
      createdAt: at,
      updatedAt: at,
    },
    {
      id: exampleId("persona-riley"),
      name: "Riley",
      role: "Deal hunter who cancels after the first discount",
      summary:
        "Riley signs up for every introductory offer and leaves before paying full price. Winning Riley costs more than it brings in.",
      tier: "anti",
      evidence: "some",
      goals: ["Get the biggest first-box discount"],
      pains: ["Subscriptions that are hard to cancel"],
      behaviours: ["Compares offers on deal sites", "Cancels within two weeks"],
      tags: ["discounts", "churn"],
      createdAt: at,
      updatedAt: at,
    },
  ];
}
