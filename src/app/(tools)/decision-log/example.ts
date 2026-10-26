import type { Decision } from "@/lib/stores/workspace-types";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { exampleId, isExampleId } from "@/lib/utils/example-id";

/** `days` before `today`, as "YYYY-MM-DD". */
function daysBefore(today: string, days: number): string {
  const n = isoDayNumber(today);
  return n === null ? today : isoFromDayNumber(n - days);
}

/**
 * A log a platform team might keep, one record per form: an ADR replaced
 * by a later one, a DACI proposal with its people and options waiting on
 * the Approver, and a RAPID decision taken and written down. The rows
 * carry `example-` ids and their own numbers, which the team's sequence
 * never counts, and "Clear example" removes exactly them. Days are
 * relative to `today` so the example never reads as stale.
 */
export function buildExample(today: string): Decision[] {
  const oldHosting = exampleId("adr-heroku");
  const newHosting = exampleId("adr-ecs");
  return [
    {
      id: oldHosting,
      title: "Host the API on Heroku",
      context: "We need the API online this quarter, and nobody on the team runs servers.",
      decision: "We will deploy the API to Heroku with one web dyno and managed Postgres.",
      consequences: "Fast to start; the bill grows with traffic and we can't tune the runtime.",
      status: "superseded",
      date: daysBefore(today, 120),
      template: "adr",
      number: 1,
      options: [
        { id: exampleId("adr-heroku-o0"), text: "Heroku" },
        { id: exampleId("adr-heroku-o1"), text: "AWS ECS", note: "Too much to learn for now" },
      ],
      chosenOptionId: exampleId("adr-heroku-o0"),
      decider: "Priya",
      decidedAt: daysBefore(today, 116),
      supersededBy: newHosting,
    },
    {
      id: exampleId("daci-flags"),
      title: "Pick a feature-flag service",
      context: "Flags are toggled by hand in config files, and two releases went out half-on.",
      decision: "",
      status: "proposed",
      date: daysBefore(today, 5),
      template: "daci",
      number: 2,
      options: [
        {
          id: exampleId("daci-flags-o0"),
          text: "LaunchDarkly",
          note: "Most features, highest cost",
        },
        { id: exampleId("daci-flags-o1"), text: "Unleash", note: "Open source, self-hosted" },
        { id: exampleId("daci-flags-o2"), text: "Build our own" },
      ],
      recommendation: "Unleash: it covers what we use, we can host it, and it costs half as much.",
      decider: "Ben",
      roles: { driver: ["Ana"], contributor: ["Chen", "Dee"], informed: ["Support team"] },
    },
    {
      id: exampleId("rapid-weekly"),
      title: "Move releases to weekly",
      context: "Releases every two weeks bundle too much; hotfixes jump the queue.",
      decision:
        "We release every Wednesday from the next sprint, with a release note in the channel.",
      consequences: "Smaller releases; QA plans a weekly regression slot.",
      status: "accepted",
      date: daysBefore(today, 40),
      template: "rapid",
      number: 3,
      decider: "Morgan",
      roles: {
        recommend: ["Priya"],
        agree: ["Sam"],
        perform: ["Release team"],
        input: ["Support", "QA"],
      },
      decidedAt: daysBefore(today, 33),
      implementedAt: daysBefore(today, 26),
    },
    {
      id: newHosting,
      title: "Move the API to AWS ECS",
      context: "Traffic tripled; Heroku costs more than the rest of our tools together.",
      decision: "We will run the API on ECS Fargate behind a load balancer, with RDS Postgres.",
      consequences: "Lower cost at our size; the team owns the deploy pipeline now.",
      status: "accepted",
      date: daysBefore(today, 20),
      template: "adr",
      number: 4,
      decider: "Priya",
      decidedAt: daysBefore(today, 14),
    },
  ];
}

/** The example's rows in a list. */
export function exampleRows<T extends { id: string }>(list: readonly T[]): T[] {
  return list.filter((d) => isExampleId(d.id));
}
