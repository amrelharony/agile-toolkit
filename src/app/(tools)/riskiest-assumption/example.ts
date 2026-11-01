import type { Assumption } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

/**
 * The assumptions behind a premium tier: one in each quadrant of the
 * matrix, one the team hasn't rated yet (it waits under "Not rated") and
 * one already validated (it has left the ranking). Ids start with
 * `example-`; "Clear example" removes exactly them, and example
 * assumptions never go to the Hypothesis Tracker.
 */
export function buildExample(): Assumption[] {
  const id = (key: string) => exampleId(`ra-${key}`);
  return [
    {
      id: id("pay"),
      statement: "Teams will pay $20 a month for the premium tier",
      riskLevel: 5,
      evidenceLevel: 1,
      testIdea: "A pricing page with a waitlist button, shown to 200 visitors",
      description: "The whole business case rests on it.",
      status: "untested",
    },
    {
      id: id("admins"),
      statement: "Admins will set up SSO themselves",
      riskLevel: 4,
      evidenceLevel: 4,
      testIdea: "Watch three admins try the setup guide",
      status: "untested",
    },
    {
      id: id("reports"),
      statement: "Leads want the weekly report as a PDF",
      riskLevel: 2,
      evidenceLevel: 2,
      status: "untested",
    },
    {
      id: id("dark"),
      statement: "Some users prefer a dark theme",
      riskLevel: 1,
      evidenceLevel: 5,
      status: "untested",
    },
    {
      id: id("seats"),
      statement: "Contractors shouldn't count as seats",
      testIdea: "Ask five customers how they count contractors",
      status: "untested",
    },
    {
      id: id("trial"),
      statement: "A trial is needed before teams buy",
      riskLevel: 4,
      evidenceLevel: 2,
      status: "validated",
      description: "8 of 10 customers in interviews asked for one.",
    },
  ];
}
