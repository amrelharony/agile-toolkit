import { exampleId } from "@/components/tool-frame/example-data";
import type {
  CapacityPlan,
  Impediment,
  RetroBoard,
  Sprint,
  Story,
  StoryReadiness,
} from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { addDays } from "@/lib/impediments/model";
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
 *
 * Sprint 4's retro agreed three actions: one is done, two wait under "From
 * the last retro" beside one open impediment, each with "Add to this
 * sprint".
 */
export interface PlanningExample {
  sprints: Sprint[];
  stories: Story[];
  capacityPlans: CapacityPlan[];
  /** Sprint 4's retro, whose open actions the plan can take in. */
  retroBoards: RetroBoard[];
  /** What is in the team's way: one open impediment, one resolved. */
  impediments: Impediment[];
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

  const action = (key: string, text: string, assignee: string, extra = {}) => ({
    id: exampleId(`action-${key}`),
    columnKey: retroFormats[0].columns[0].key,
    text,
    votes: 0,
    groupedWith: null,
    isActionItem: true,
    assignee,
    discussing: false,
    ...extra,
  });
  const retroBoards: RetroBoard[] = [
    {
      // An example board: its cards are read as they are (lib/retro/actions).
      id: exampleId("retro"),
      format: retroFormats[0],
      phase: "actions",
      cards: [
        action("pairing", "Pair on every payment change", "Chloé", {
          dueDate: addDays(today, 7),
        }),
        action("staging", "Refresh the staging data before each review", ""),
        action("alerts", "Mute the noisy checkout alert", "Dev", { done: true, doneAt: at }),
      ],
      userVotes: 0,
      timerSeconds: 300,
      timerRunning: false,
      discussingIndex: 0,
      archivedAt: at,
      sprintId: last.id,
    },
  ];
  const impediments: Impediment[] = [
    {
      id: exampleId("impediment-sandbox"),
      title: "The payment sandbox is down most mornings",
      severity: "high",
      raisedAt: addDays(today, -6),
      owner: "Ben",
    },
    {
      id: exampleId("impediment-laptop"),
      title: "Elin's laptop replacement",
      severity: "low",
      raisedAt: addDays(today, -9),
      resolvedAt: addDays(today, -2),
    },
  ];

  return { sprints: all, stories, capacityPlans, retroBoards, impediments, planning };
}
