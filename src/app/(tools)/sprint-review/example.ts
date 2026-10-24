import { exampleId } from "@/components/tool-frame/example-data";
import type { Sprint, SprintGoal, SprintReview, Story } from "@/lib/stores/workspace-types";
import { goalDocId } from "@/lib/sprints/goal-doc";
import { reviewDocId } from "@/lib/sprints/review-doc";
import { endDateFor, todayIso } from "@/lib/sprints/series";
import { STANDARD_CHECKLIST } from "./constants";
import { demoIdFor } from "./doc";

/**
 * The example review, held in memory only (the page's example mode): its
 * own sprint, stories and goal, so a visitor can add done stories to the
 * demo, capture feedback and tick the checklist without one fake review
 * reaching a real sprint (the cockpit and the next steps would take it for
 * a review held). Nothing in it can be sent to the backlog.
 *
 * A mobile checkout team's Sprint 12, reviewed today: 8 of its 10 stories
 * are done, 34 of 40 points, and Sprint Goal records that it met its goal.
 * Three done stories are on the demo script already, with a before-and-
 * after look at checkout speed that isn't timed yet; the other five done
 * stories wait under "Done in Sprint 12". Stakeholders left one piece of
 * praise, one concern and one suggestion, and six of the eight checklist
 * items are ready.
 */
export interface ReviewExample {
  sprint: Sprint;
  stories: Story[];
  goals: SprintGoal[];
  review: SprintReview;
}

const STORIES: [
  key: string,
  title: string,
  points: number,
  status: Story["status"],
  owner?: string,
][] = [
  ["1", "Pay with a saved card", 8, "done", "Amira"],
  ["2", "Save a card at checkout", 5, "done", "Ben"],
  ["3", "Remove a saved card", 3, "done", "Chloé"],
  ["4", "Card expiry reminders", 3, "done", "Dev"],
  ["5", "Receipts by email", 3, "done", "Elin"],
  ["6", "Saved cards on Android", 5, "done", "Ben"],
  ["7", "Clear message for a declined card", 2, "done", "Chloé"],
  ["8", "Checkout loads in under 2 seconds", 5, "done", "Dev"],
  ["9", "Saved card nicknames", 3, "in_progress", "Elin"],
  ["10", "Apple Pay at checkout", 3, "todo"],
];

function shiftBack(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function buildExample(today: string = todayIso()): ReviewExample {
  const startDate = shiftBack(today, 13);
  const sprint: Sprint = {
    id: exampleId("sr-sprint-12"),
    name: "Sprint 12",
    startDate,
    endDate: endDateFor(startDate, 13),
    goal: "Returning shoppers can pay with a saved card in one tap",
    pointsPlanned: 40,
    status: "completed",
  };
  const at = `${today}T09:00:00.000Z`;
  const stories: Story[] = STORIES.map(([key, title, points, status, owner]) => ({
    id: exampleId(`sr-story-${key}`),
    title,
    points,
    status,
    sprintId: sprint.id,
    ...(owner ? { owner } : {}),
    ...(status === "done" ? { doneAt: at } : {}),
  }));
  const story = (key: string) => stories.find((s) => s.id === exampleId(`sr-story-${key}`))!;

  const goals: SprintGoal[] = [
    {
      id: goalDocId(sprint.id),
      sprintId: sprint.id,
      businessObjective: "Win back mobile shoppers who give up at the payment step.",
      goal: sprint.goal ?? "",
      criteria: [],
      keyResults: [],
      outcome: {
        met: "met",
        note: "Saved cards are live on iOS and Android; nicknames move to Sprint 13.",
        decidedAt: today,
      },
    },
  ];

  const review: SprintReview = {
    id: reviewDocId(sprint.id),
    sprintId: sprint.id,
    sprintName: sprint.name,
    sprintNumber: "12",
    meetingDate: today,
    features: [
      {
        id: demoIdFor(story("1").id),
        name: story("1").title,
        description: "One tap on the payment step for a shopper with a saved card.",
        acceptanceCriteria:
          "Given a saved card, when I tap Pay, then the order is placed without typing the card again.",
        timeMinutes: 6,
      },
      {
        id: demoIdFor(story("2").id),
        name: story("2").title,
        description: "Ticking “Save this card” keeps it for next time.",
        acceptanceCriteria: "The card is stored by the payment provider, never in our database.",
        timeMinutes: 4,
      },
      {
        id: demoIdFor(story("6").id),
        name: story("6").title,
        description: "The same flow on a mid-range Android phone.",
        acceptanceCriteria: "",
        timeMinutes: 3,
      },
      {
        id: exampleId("sr-demo-speed"),
        name: "Checkout speed, before and after",
        description: "The payment step's load time over the sprint.",
        acceptanceCriteria: "",
        timeMinutes: 0,
      },
    ],
    feedbackItems: [
      {
        id: exampleId("sr-feedback-1"),
        stakeholder: "Priya, Head of Payments",
        feedback: "One-tap pay feels instant. Roll it out to every shopper this week.",
        category: "positive",
      },
      {
        id: exampleId("sr-feedback-2"),
        stakeholder: "Marco, Support lead",
        feedback: "Support can't see which saved card a customer paid with.",
        category: "concern",
      },
      {
        id: exampleId("sr-feedback-3"),
        stakeholder: "Lena, Product marketing",
        feedback: "Let shoppers name their cards, like “Work card”.",
        category: "suggestion",
      },
    ],
    checklistItems: STANDARD_CHECKLIST.map((label, i) => ({
      id: exampleId(`sr-check-${i + 1}`),
      label,
      checked: i < 6,
    })),
    committed: 0,
    completed: 0,
    totalBacklog: 0,
    backlogDone: 0,
  };

  return { sprint, stories, goals, review };
}
