import { exampleId } from "@/components/tool-frame/example-data";
import type { Sprint, Story, StoryStatus, StoryStatusChange } from "@/lib/stores/workspace-types";
import { EXAMPLE_SPRINT_PREFIX } from "@/lib/sprints/example";
import { addDays } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";

/** The example sprint has run this many days before today. */
const ELAPSED = 9;
const LENGTH = 14;

type Row = {
  title: string;
  points: number;
  owner?: string;
  blocked?: boolean;
  /** Moves after To do, as [status, day of the sprint], oldest first. */
  moves: [StoryStatus, number][];
};

/**
 * A checkout team on day 10 of a two-week sprint. Stories keep moving into
 * Review, but reviews aren't being finished: the Review band widens from 1
 * story to 4 while 4 stories are done, which is what the verdict points at.
 */
const ROWS: Row[] = [
  {
    title: "Pay with a saved card",
    points: 5,
    owner: "Amira",
    moves: [
      ["in_progress", 0],
      ["review", 2],
      ["done", 3],
    ],
  },
  {
    title: "Receipts by email",
    points: 3,
    owner: "Ben",
    moves: [
      ["in_progress", 1],
      ["review", 3],
      ["done", 5],
    ],
  },
  {
    title: "Card expiry reminders",
    points: 3,
    owner: "Chloé",
    moves: [
      ["in_progress", 1],
      ["review", 4],
      ["done", 7],
    ],
  },
  {
    title: "Refund flow",
    points: 8,
    owner: "Dev",
    moves: [
      ["in_progress", 2],
      ["review", 5],
    ],
  },
  {
    title: "Remove a saved card",
    points: 2,
    owner: "Elin",
    moves: [
      ["in_progress", 3],
      ["review", 6],
    ],
  },
  {
    title: "Split payments",
    points: 8,
    owner: "Amira",
    moves: [
      ["in_progress", 4],
      ["review", 7],
    ],
  },
  {
    title: "Saved card nicknames",
    points: 2,
    owner: "Ben",
    moves: [
      ["in_progress", 5],
      ["review", 8],
    ],
  },
  {
    title: "Fraud checks on new cards",
    points: 5,
    owner: "Chloé",
    moves: [
      ["in_progress", 6],
      ["done", 8],
    ],
  },
  { title: "Apple Pay at checkout", points: 5, owner: "Dev", moves: [["in_progress", 7]] },
  {
    title: "Wallet payments on Android",
    points: 5,
    owner: "Elin",
    blocked: true,
    moves: [["in_progress", 8]],
  },
  { title: "Address autocomplete", points: 3, moves: [] },
  { title: "Gift cards at checkout", points: 5, moves: [] },
];

export interface CfdExample {
  sprint: Sprint;
  stories: Story[];
}

/**
 * The Sprint board example, shown in memory only: the sprint has an
 * `example-preview-sprint-` id and the stories `example-` ids, and neither
 * is ever written to the workspace, so fake stories never reach the user's
 * sprints, the burndown or agents. Every move is at noon local time on its
 * day, so the chart reads the same in any time zone.
 */
export function buildExample(today: string = todayIso()): CfdExample {
  const start = addDays(today, -ELAPSED) as string;
  const at = (day: number) => new Date(`${addDays(start, day)}T12:00:00`).toISOString();
  const sprint: Sprint = {
    id: `${EXAMPLE_SPRINT_PREFIX}cfd`,
    name: "Sprint 12",
    startDate: start,
    endDate: addDays(start, LENGTH - 1) as string,
    goal: "Customers can pay with a saved card",
    pointsPlanned: ROWS.reduce((sum, r) => sum + r.points, 0),
    status: "active",
  };
  const stories = ROWS.map((r, i): Story => {
    const history: StoryStatusChange[] = [{ status: "todo", from: "backlog", at: at(0) }];
    let prev: StoryStatus = "todo";
    for (const [status, day] of r.moves) {
      history.push({ status, from: prev, at: at(day) });
      prev = status;
    }
    const started = r.moves[0];
    const done = r.moves.find(([s]) => s === "done");
    return {
      id: exampleId(`cfd-story-${i + 1}`),
      title: r.title,
      points: r.points,
      status: prev,
      sprintId: sprint.id,
      ...(r.owner ? { owner: r.owner } : {}),
      ...(r.blocked ? { blocked: true } : {}),
      ...(started ? { startedAt: at(started[1]) } : {}),
      ...(done ? { doneAt: at(done[1]) } : {}),
      statusHistory: history,
      sprintHistory: [{ sprintId: sprint.id, at: at(0), points: r.points }],
    };
  });
  return { sprint, stories };
}
