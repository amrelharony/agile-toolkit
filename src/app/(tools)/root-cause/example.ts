import { exampleId } from "@/lib/utils/example-id";
import type { RootCauseAnalysis } from "@/lib/stores/workspace-types";

/**
 * Two analyses a checkout team might hold: a 5 Whys that reached its root
 * cause and a countermeasure, and a fishbone of why checkout errors went
 * unnoticed, with counts for its Pareto chart. Example ids throughout, so
 * nothing counts as the team's and Clear example takes them all away.
 */
export function buildExample(now: Date = new Date()): RootCauseAnalysis[] {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return [
    {
      id: exampleId("rca-rollbacks"),
      title: "Releases rolled back the same day",
      problem:
        "Two of the last three releases were rolled back within hours, each after a database migration failed in production.",
      method: "five-whys",
      whys: [
        { id: exampleId("why-1"), text: "A database migration failed in production." },
        {
          id: exampleId("why-2"),
          text: "The migration had never run against production-sized data.",
        },
        {
          id: exampleId("why-3"),
          text: "Staging is seeded with a few hundred rows, not millions.",
        },
        {
          id: exampleId("why-4"),
          text: "Nobody owns keeping staging's data close to production's.",
        },
      ],
      causes: [],
      rootCause: "Nobody owns keeping staging's data close to production's.",
      countermeasure:
        "Rehearse every migration on a nightly copy of production's data before release.\nCheck: no rollback caused by a migration over the next three releases.",
      createdAt: at(6),
      updatedAt: at(2),
    },
    {
      id: exampleId("rca-checkout"),
      title: "Checkout errors noticed late",
      problem:
        "Customers saw checkout errors for about two hours on 3 November before anyone on the team knew.",
      method: "fishbone",
      whys: [],
      causes: [
        {
          id: exampleId("cause-1"),
          category: "Measurement",
          text: "No alert on the checkout error rate",
          count: 6,
        },
        {
          id: exampleId("cause-2"),
          category: "Measurement",
          text: "The dashboard shows yesterday's numbers",
          count: 3,
        },
        {
          id: exampleId("cause-3"),
          category: "People",
          text: "The on-call engineer was new and not onboarded",
          count: 2,
        },
        {
          id: exampleId("cause-4"),
          category: "Process",
          text: "Support tickets reach the team only once a day",
          count: 4,
        },
        {
          id: exampleId("cause-5"),
          category: "Environment",
          text: "The payment provider changed its error codes",
          count: 1,
        },
        {
          id: exampleId("cause-6"),
          category: "Tools",
          text: "Error logs are split across two services",
          count: 1,
        },
      ],
      rootCause: "No alert on the checkout error rate",
      createdAt: at(4),
      updatedAt: at(1),
    },
  ];
}
