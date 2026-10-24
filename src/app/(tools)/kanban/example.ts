import { exampleId } from "@/components/tool-frame/example-data";
import type {
  KanbanCard,
  KanbanClassOfService,
  KanbanColumnId,
  Sprint,
  Story,
  StoryStatus,
  StoryStatusChange,
} from "@/lib/stores/workspace-types";
import { exampleSprints } from "@/lib/sprints/example";
import { todayIso } from "@/lib/sprints/series";

const DAY_MS = 24 * 60 * 60 * 1000;

type Row = {
  title: string;
  description?: string;
  column: KanbanColumnId;
  class: KanbanClassOfService;
  /** Days ago the card was created / started / finished / entered its column. */
  created: number;
  started?: number;
  completed?: number;
  since?: number;
  assignee?: string;
  blocked?: boolean;
};

/**
 * A mobile checkout team mid-sprint. An expedite bug jumped the queue and
 * pushed In Progress over its default limit of 3, which is what the WIP
 * warning is for. One fixed-date card, one intangible upgrade, a blocked
 * card waiting on another team, and five done cards (MIN_SAMPLE.distribution)
 * so the average cycle time and its 85th percentile show: 2 to 6 days, so
 * the card in Review, in work for 8 days, is tinted as ageing.
 */
const ROWS: Row[] = [
  {
    title: "One-tap reorder from order history",
    column: "backlog",
    class: "standard",
    created: 3,
  },
  {
    title: "Upgrade the payments SDK",
    description: "The current version stops getting security fixes next quarter.",
    column: "ready",
    class: "intangible",
    created: 6,
  },
  {
    title: "Fix double charge when a payment retries",
    description: "Some shoppers are charged twice when the first attempt times out.",
    column: "in_progress",
    class: "expedite",
    created: 1,
    started: 1,
    assignee: "Amira",
  },
  {
    title: "Holiday sale banner in the cart",
    description: "Has to ship before the sale starts.",
    column: "in_progress",
    class: "fixed_date",
    created: 7,
    started: 4,
    assignee: "Ben",
  },
  {
    title: "Wallet payments on Android",
    description: "Waiting on the payments team's sandbox keys.",
    column: "in_progress",
    class: "standard",
    created: 9,
    started: 5,
    assignee: "Chloé",
    blocked: true,
  },
  {
    title: "Address autocomplete",
    column: "in_progress",
    class: "standard",
    created: 8,
    started: 2,
  },
  {
    title: "Saved cards for returning shoppers",
    column: "review",
    class: "standard",
    created: 12,
    started: 8,
    since: 2,
    assignee: "Dev",
  },
  {
    title: "Show delivery estimate in the cart",
    column: "done",
    class: "standard",
    created: 14,
    started: 10,
    completed: 7,
  },
  {
    title: "Fix tax rounding on split shipments",
    column: "done",
    class: "standard",
    created: 9,
    started: 6,
    completed: 1,
  },
  // Added after the rows above, so their example ids stay what they were.
  {
    title: "Guest checkout",
    column: "done",
    class: "standard",
    created: 21,
    started: 18,
    completed: 12,
  },
  {
    title: "Promo codes at checkout",
    column: "done",
    class: "standard",
    created: 16,
    started: 13,
    completed: 9,
  },
  {
    title: "Order confirmation emails",
    column: "done",
    class: "standard",
    created: 8,
    started: 5,
    completed: 3,
  },
];

/** The Flow board example: cards with `example-` ids, which "Clear example" removes. */
export function buildExample(now: Date = new Date()): KanbanCard[] {
  const daysAgo = (n: number) => new Date(now.getTime() - n * DAY_MS).toISOString();
  return ROWS.map((r, i) => ({
    id: exampleId(`kanban-${i + 1}`),
    title: r.title,
    ...(r.description ? { description: r.description } : {}),
    column: r.column,
    class: r.class,
    createdAt: daysAgo(r.created),
    ...(r.started !== undefined ? { startedAt: daysAgo(r.started) } : {}),
    ...(r.completed !== undefined ? { completedAt: daysAgo(r.completed) } : {}),
    ...(r.since !== undefined ? { columnSince: daysAgo(r.since) } : {}),
    ...(r.assignee ? { assignee: r.assignee } : {}),
    ...(r.blocked ? { blocked: true } : {}),
  }));
}

/* ── Sprint board example ─────────────────────────────────────────────── */

type StoryRow = {
  title: string;
  points?: number;
  owner?: string;
  blocked?: boolean;
  /** The moves it went through, as [status, days ago], oldest first. */
  moves: [StoryStatus, number][];
};

/**
 * Sprint 5 of the example sprints (lib/sprints/example), on day 5: four
 * stories in progress against the default limit of 3, one of them blocked,
 * one waiting for review for three days, and one not estimated yet.
 */
const STORY_ROWS: StoryRow[] = [
  {
    title: "Pay with a saved card",
    points: 8,
    owner: "Amira",
    moves: [
      ["todo", 5],
      ["in_progress", 4],
      ["review", 3],
    ],
  },
  {
    title: "Receipts by email",
    points: 3,
    owner: "Ben",
    moves: [
      ["todo", 5],
      ["in_progress", 4],
      ["review", 2],
      ["done", 1],
    ],
  },
  {
    title: "Card expiry reminders",
    points: 3,
    owner: "Chloé",
    moves: [
      ["todo", 5],
      ["in_progress", 3],
      ["done", 2],
    ],
  },
  {
    title: "Refund flow",
    points: 5,
    owner: "Dev",
    moves: [
      ["todo", 5],
      ["in_progress", 2],
    ],
  },
  {
    title: "Remove a saved card",
    points: 5,
    owner: "Elin",
    blocked: true,
    moves: [
      ["todo", 5],
      ["in_progress", 4],
    ],
  },
  {
    title: "Split payments",
    points: 8,
    owner: "Amira",
    moves: [
      ["todo", 5],
      ["in_progress", 1],
    ],
  },
  {
    title: "Saved card nicknames",
    points: 2,
    owner: "Ben",
    moves: [
      ["todo", 5],
      ["in_progress", 0],
    ],
  },
  { title: "Fraud checks on new cards", moves: [["todo", 5]] },
  { title: "Apple Pay at checkout", points: 3, moves: [["todo", 5]] },
];

export interface SprintBoardExample {
  sprint: Sprint;
  stories: Story[];
}

/**
 * The Sprint board example, shown in memory only (./sprint-writer.ts): the
 * sprint has an `example-preview-sprint-` id and the stories `example-`
 * ids, and neither is ever written to the workspace, so fake stories never
 * reach the user's sprints, the burndown or agents.
 */
export function buildSprintExample(
  today: string = todayIso(),
  now: Date = new Date()
): SprintBoardExample {
  const { current } = exampleSprints(today);
  const daysAgo = (n: number) => new Date(now.getTime() - n * DAY_MS).toISOString();
  const stories = STORY_ROWS.map((r, i): Story => {
    const history: StoryStatusChange[] = r.moves.map(([status, ago], j) => ({
      status,
      ...(j > 0 ? { from: r.moves[j - 1][0] } : { from: "backlog" as const }),
      at: daysAgo(ago),
    }));
    const status = r.moves[r.moves.length - 1][0];
    const started = r.moves.find(([s]) => s !== "todo" && s !== "backlog");
    return {
      id: exampleId(`sprint-story-${i + 1}`),
      title: r.title,
      ...(r.points !== undefined ? { points: r.points } : {}),
      status,
      sprintId: current.id,
      ...(r.owner ? { owner: r.owner } : {}),
      ...(r.blocked ? { blocked: true } : {}),
      ...(started ? { startedAt: daysAgo(started[1]) } : {}),
      ...(status === "done" ? { doneAt: daysAgo(r.moves[r.moves.length - 1][1]) } : {}),
      statusHistory: history,
    };
  });
  return { sprint: current, stories };
}
