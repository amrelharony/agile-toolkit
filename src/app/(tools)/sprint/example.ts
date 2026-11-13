import { exampleId } from "@/components/tool-frame/example-data";
import type {
  Impediment,
  InterruptItem,
  RetroBoard,
  RetroCard,
  SprintReview,
  StandupEntry,
  Story,
  TeamMember,
} from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { exampleSprints, type ExampleSprints } from "@/lib/sprints/example";
import { dayDate, todayIso } from "@/lib/sprints/series";

/**
 * The cockpit's example, shown in memory only: it is never written to the
 * workspace (fake sprints and stories would feed velocity, the dashboard and
 * agents). Sprint 5 of lib/sprints/example is on day 5 of 14 today.
 *
 * The board holds 32 points: two stories (13 points) were done on days 2
 * and 4, so 19 are left against an ideal of 22.5, 3.5 points ahead. "Refund
 * flow" is blocked, one story has no points yet, the sandbox impediment is
 * escalated and the legal copy is a day overdue; a third impediment was
 * resolved on day 1. Three of the five people have posted today. Sprint 4's
 * retro left two open actions, and Sprint 5 has no review or retro yet.
 * Sprint 5 keeps a 5-point interrupt buffer, and two interrupts have used 4
 * of it, so the goal check says to watch the buffer, the blocked story and
 * the impediments.
 */
export interface CockpitExample extends ExampleSprints {
  stories: Story[];
  impediments: Impediment[];
  standupEntries: StandupEntry[];
  teamMembers: TeamMember[];
  retroBoards: RetroBoard[];
  reviews: SprintReview[];
  interruptItems: InterruptItem[];
}

/** The example's interrupt buffer on Sprint 5. */
export const EXAMPLE_BUFFER_POINTS = 5;

export function buildExample(today: string = todayIso()): CockpitExample {
  const sprints = exampleSprints(today);
  const current = { ...sprints.current, interruptBuffer: { points: EXAMPLE_BUFFER_POINTS } };
  const base: ExampleSprints = {
    ...sprints,
    current,
    sprints: sprints.sprints.map((s) => (s.id === current.id ? current : s)),
  };
  // Noon UTC is the same calendar day in nearly every time zone.
  const onDay = (day: number) => `${dayDate(current, day) ?? today}T12:00:00.000Z`;
  const daysAgo = (n: number) => dayDate({ startDate: today }, -n) ?? today;
  const previous = base.sprints[base.sprints.length - 2];

  const planned: Omit<Story, "sprintId">[] = [
    {
      id: exampleId("s1"),
      title: "Save a card at checkout",
      points: 8,
      status: "done",
      owner: "Amira",
      startedAt: onDay(0),
      doneAt: onDay(2),
    },
    {
      id: exampleId("s2"),
      title: "Pay with a saved card",
      points: 5,
      status: "done",
      owner: "Ben",
      startedAt: onDay(1),
      doneAt: onDay(4),
    },
    {
      id: exampleId("s3"),
      title: "Remove a saved card",
      points: 3,
      status: "review",
      owner: "Chloé",
      startedAt: onDay(3),
    },
    {
      id: exampleId("s4"),
      title: "Refund flow",
      points: 8,
      status: "in_progress",
      owner: "Dev",
      startedAt: onDay(2),
      blocked: true,
    },
    { id: exampleId("s5"), title: "Card expiry reminders", points: 5, status: "todo" },
    {
      id: exampleId("s6"),
      title: "Saved card nicknames",
      points: 3,
      status: "in_progress",
      owner: "Elin",
      startedAt: onDay(4),
    },
    { id: exampleId("s7"), title: "Fraud checks on saved cards", status: "todo" },
  ];
  const stories: Story[] = planned.map((s) => ({ ...s, sprintId: current.id }));

  const impediments: Impediment[] = [
    {
      id: exampleId("i1"),
      title: "Payment sandbox returns 500s under load",
      severity: "high",
      raisedAt: daysAgo(3),
      escalatedAt: daysAgo(1),
      owner: "Ben",
      category: "external",
    },
    {
      id: exampleId("i2"),
      title: "Waiting on legal copy for the refund screen",
      severity: "medium",
      raisedAt: daysAgo(4),
      dueDate: daysAgo(1),
      category: "organizational",
    },
    {
      id: exampleId("i3"),
      title: "Staging certificate expired",
      severity: "low",
      raisedAt: daysAgo(5),
      resolvedAt: daysAgo(4),
      owner: "Elin",
      category: "technical",
    },
  ];

  const entry = (key: string, member: string, yesterday: string, plan: string, blockers = "") => ({
    id: exampleId(key),
    member,
    date: today,
    yesterday,
    today: plan,
    blockers,
    timestamp: 0,
  });
  const standupEntries: StandupEntry[] = [
    entry("e1", "Amira", "Finished the saved-card form", "Pairing on payment"),
    entry("e2", "Ben", "Load-tested the sandbox", "Chasing the sandbox 500s", "Sandbox 500s"),
    entry("e3", "Chloé", "Refund flow designs", "Review of “Remove a saved card”"),
  ];

  const teamMembers: TeamMember[] = ["Amira", "Ben", "Chloé", "Dev", "Elin"].map((name, i) => ({
    id: exampleId(`m${i + 1}`),
    name,
  }));

  // Sprint 4's retro, archived on its last day.
  const action = (
    key: string,
    text: string,
    assignee: string,
    extra: Partial<RetroCard> = {}
  ): RetroCard => ({
    id: exampleId(key),
    columnKey: "start",
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
      id: exampleId("retro-4"),
      archivedAt: `${previous.endDate}T16:00:00.000Z`,
      format: retroFormats[0],
      phase: "actions",
      cards: [
        action("a1", "Pair on the payment work", "Amira", { done: true, doneAt: onDay(1) }),
        action("a2", "Ask legal for copy before planning", "Ben", { dueDate: daysAgo(2) }),
        action("a3", "Book a sandbox load test each sprint", "Dev"),
      ],
      userVotes: 0,
      timerSeconds: 0,
      timerRunning: false,
      discussingIndex: 0,
    },
  ];

  const interruptItems: InterruptItem[] = [
    {
      id: exampleId("int1"),
      sprintId: current.id,
      title: "Card payments failing for one bank",
      kind: "incident",
      size: 3,
      emergency: true,
      loggedAt: onDay(2),
      resolvedAt: onDay(3),
    },
    {
      id: exampleId("int2"),
      sprintId: current.id,
      title: "Support asks for a refunds export",
      kind: "request",
      size: 1,
      emergency: false,
      loggedAt: onDay(4),
    },
  ];

  return {
    ...base,
    stories,
    impediments,
    standupEntries,
    teamMembers,
    retroBoards,
    reviews: [],
    interruptItems,
  };
}
