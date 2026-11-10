import { exampleId } from "@/components/tool-frame/example-data";
import type { CapacityPlan, Sprint, Story, StoryReadiness } from "@/lib/stores/workspace-types";
import { exampleSprints } from "@/lib/sprints/example";
import { endDateFor, todayIso } from "@/lib/sprints/series";
import { capacityPlanIdFor } from "@/lib/sprints/capacity";

/**
 * The example plan, shown in memory only (./writer.ts): four finished
 * sprints from lib/sprints/example, and Sprint 5 being planned from today.
 *
 * Sprint 4 closed with two stories unfinished, which wait under "Left over"
 * until they're carried over. Velocity is 31.3 points; Ben's conference and
 * Elin's long weekend leave 90% of a normal sprint, so the forecast is 28
 * points. "Fill to capacity" then takes "Remove a saved card", "Split
 * payments" and "Saved card nicknames", and names the two it skips: Apple
 * Pay is too big for what's left, and the fraud checks aren't estimated.
 */
export interface PlanningExample {
  sprints: Sprint[];
  stories: Story[];
  capacityPlans: CapacityPlan[];
  /** The sprint being planned. */
  planning: Sprint;
}

const ready = (at: string): StoryReadiness => ({
  checked: ["value", "criteria", "sized"],
  ready: true,
  updatedAt: at,
});
const notReady = (at: string): StoryReadiness => ({
  checked: ["value"],
  ready: false,
  updatedAt: at,
});

export function buildExample(today: string = todayIso()): PlanningExample {
  // Dated so Sprint 4 ends today and Sprint 5 starts today.
  const { sprints, current } = exampleSprints(endDateFor(today, 5));
  const planning: Sprint = { ...current, status: "planned", pointsPlanned: 0 };
  const all = sprints.map((s) => (s.id === current.id ? planning : s));
  const last = all[all.length - 2];
  const at = `${today}T09:00:00.000Z`;

  const stories: Story[] = [
    {
      id: exampleId("story-1"),
      title: "Refund flow",
      points: 5,
      status: "in_progress",
      sprintId: last.id,
      owner: "Amira",
      startedAt: at,
      readiness: ready(at),
    },
    {
      id: exampleId("story-2"),
      title: "Card expiry reminders",
      points: 3,
      status: "todo",
      sprintId: last.id,
      readiness: ready(at),
    },
    {
      id: exampleId("story-3"),
      title: "Pay with a saved card",
      points: 8,
      status: "todo",
      sprintId: planning.id,
      owner: "Ben",
      readiness: ready(at),
      // What "Details" on a row holds: criteria, notes and the ticket key.
      acceptanceCriteria:
        "- A returning customer sees their saved cards at checkout\n- Paying with one asks for the security code only\n- A declined card says why, and offers another",
      notes: "Cards are stored by the payment provider, never by us.",
      ticketKey: "PAY-12",
    },
    {
      id: exampleId("story-4"),
      title: "Receipts by email",
      points: 3,
      status: "todo",
      sprintId: planning.id,
      readiness: ready(at),
    },
    {
      id: exampleId("story-5"),
      title: "Remove a saved card",
      points: 5,
      status: "backlog",
      priorityScore: 9,
      readiness: ready(at),
    },
    {
      id: exampleId("story-6"),
      title: "Apple Pay at checkout",
      points: 13,
      status: "backlog",
      priorityScore: 8,
      readiness: notReady(at),
    },
    {
      id: exampleId("story-7"),
      title: "Fraud checks on new cards",
      status: "backlog",
      priorityScore: 7,
    },
    {
      id: exampleId("story-8"),
      title: "Split payments",
      points: 8,
      status: "backlog",
      priorityScore: 5,
      readiness: ready(at),
    },
    {
      id: exampleId("story-9"),
      title: "Saved card nicknames",
      points: 2,
      status: "backlog",
      priorityScore: 3,
    },
  ];

  const member = (key: string, name: string, daysOff: number) => ({
    id: exampleId(`member-${key}`),
    name,
    role: "Developer",
    availability: 100,
    daysOff,
  });
  const capacityPlans: CapacityPlan[] = [
    {
      id: capacityPlanIdFor(planning.id),
      sprintId: planning.id,
      members: [
        member("amira", "Amira", 0),
        member("ben", "Ben", 2),
        member("chloe", "Chloé", 0),
        member("dev", "Dev", 0),
        member("elin", "Elin", 3),
      ],
      config: {
        sprintDays: 10,
        ceremonyOverhead: 15,
        focusFactor: 0.8,
        hoursPerDay: 8,
        pointsCommitted: "",
      },
    },
  ];

  return { sprints: all, stories, capacityPlans, planning };
}
