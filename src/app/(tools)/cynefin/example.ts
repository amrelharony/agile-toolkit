import type { CynefinItem } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

/**
 * A board a product team might keep: one problem per domain, each placed
 * from the guided questions, and a second complex one, so the board shows
 * what's waiting to be tested. Ids start with `example-`; "Clear example"
 * removes exactly them, and example items never go to the Hypothesis
 * Tracker.
 */
export function buildExample(now: string): CynefinItem[] {
  return [
    {
      id: exampleId("cy-certs"),
      title: "Renew the TLS certificates before they expire",
      domain: "clear",
      rationale: "There's a runbook and anyone on call has done it.",
      answers: { crisis: "no", known: "yes" },
      loggedAt: now,
    },
    {
      id: exampleId("cy-db"),
      title: "Queries slow down every month-end close",
      domain: "complicated",
      rationale:
        "A database specialist can profile it and find the cause before we change anything.",
      answers: { crisis: "no", known: "no", analysable: "yes", emergent: "no" },
      loggedAt: now,
    },
    {
      id: exampleId("cy-pricing"),
      title: "Customers churn after the new pricing page",
      domain: "complex",
      rationale: "We can't predict how customers react to price changes; we'll learn by trying.",
      answers: { crisis: "no", known: "no", analysable: "no", emergent: "yes" },
      loggedAt: now,
    },
    {
      id: exampleId("cy-onboarding"),
      title: "New teams stop using the tool after week two",
      domain: "complex",
      rationale: "Several causes interact; small experiments will show which matter.",
      answers: { crisis: "no", known: "no", emergent: "yes" },
      loggedAt: now,
    },
    {
      id: exampleId("cy-outage"),
      title: "Checkout is down in one region",
      domain: "chaotic",
      rationale: "Customers can't pay right now: restore service first, then find out why.",
      answers: { crisis: "yes" },
      loggedAt: now,
    },
    {
      id: exampleId("cy-roadmap"),
      title: "Should the mobile app be rebuilt?",
      domain: "confused",
      rationale: "Half the team sees a technical fix, half a product bet: split it up.",
      answers: { crisis: "no", disagree: "yes" },
      loggedAt: now,
    },
  ];
}
