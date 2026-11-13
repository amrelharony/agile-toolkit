import { exampleId } from "@/components/tool-frame/example-data";
import type { KanbanCard, KanbanColumnChange, KanbanColumnId } from "@/lib/stores/workspace-types";
import { DEFAULT_WAITING, addDays, type StageId } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import type { WorkItem } from "./types";

type CardRow = {
  title: string;
  column: KanbanColumnId;
  /** Days ago it was started, moved to Review and (in Done) finished. */
  started: number;
  review?: number;
  done?: number;
  /** The hours of those three moves, when not noon. */
  hours?: [start: number, review: number, done: number];
  assignee?: string;
  blocked?: boolean;
};

/**
 * Seven weeks of a team's Flow board: 14 cards finished, most in 2 to 6
 * days with a couple of long ones, and three still in progress, one of
 * them blocked and older than the 85th percentile. Every card's moves are
 * recorded (Ready, In progress, Review, Done), so Time in each status can
 * read them: Review holds a good part of the time, longest for "Saved
 * addresses", which waited four days for a reviewer.
 */
const CARDS: CardRow[] = [
  { title: "Guest checkout", column: "done", started: 49, review: 46, done: 45 },
  { title: "Promo codes at checkout", column: "done", started: 46, review: 44, done: 43 },
  { title: "Order confirmation emails", column: "done", started: 44, review: 42, done: 40 },
  { title: "Saved addresses", column: "done", started: 41, review: 35, done: 31 },
  {
    title: "Show delivery estimate in the cart",
    column: "done",
    started: 36,
    review: 34,
    done: 33,
  },
  {
    title: "Fix tax rounding on split shipments",
    column: "done",
    started: 33,
    review: 33,
    done: 33,
    hours: [9, 13, 16],
  },
  { title: "Gift messages", column: "done", started: 30, review: 28, done: 26 },
  { title: "Reorder from order history", column: "done", started: 27, review: 25, done: 22 },
  { title: "Wishlist sharing", column: "done", started: 23, review: 21, done: 20 },
  { title: "Low-stock badges", column: "done", started: 19, review: 18, done: 17 },
  { title: "Faster product search", column: "done", started: 18, review: 9, done: 6 },
  { title: "Cart reminders", column: "done", started: 12, review: 11, done: 9 },
  { title: "Size guide", column: "done", started: 9, review: 8, done: 7 },
  {
    title: "Fix double charge when a payment retries",
    column: "done",
    started: 4,
    review: 3,
    done: 3,
    hours: [12, 10, 15],
  },
  {
    title: "Wallet payments on Android",
    column: "in_progress",
    started: 12,
    assignee: "Chloé",
    blocked: true,
  },
  {
    title: "Saved cards for returning shoppers",
    column: "review",
    started: 5,
    review: 2,
    assignee: "Dev",
  },
  { title: "Address autocomplete", column: "in_progress", started: 1, assignee: "Amira" },
];

/** Two items typed by hand: work done in another team's tracker. */
const TYPED: [name: string, startedAgo: number, doneAgo: number][] = [
  ["Payments provider migration (platform team)", 38, 29],
  ["Accessibility audit fixes", 15, 11],
];

export interface CycleTimeExample {
  cards: KanbanCard[];
  items: WorkItem[];
  /** The example's own waiting statuses (the default, Review and a stint in Done), kept apart from the person's. */
  waiting: StageId[];
}

/**
 * The example, shown in memory only: cards with `example-` ids that never
 * reach the Flow board, and typed items that never reach the tool's store.
 * Stamps are at noon local time, so every day reads the same anywhere.
 */
export function buildExample(today: string = todayIso()): CycleTimeExample {
  const day = (ago: number) => addDays(today, -ago) as string;
  const at = (ago: number, hour = 12) =>
    new Date(`${day(ago)}T${String(hour).padStart(2, "0")}:00:00`).toISOString();
  const cards = CARDS.map((r, i): KanbanCard => {
    const [startHour, reviewHour, doneHour] = r.hours ?? [12, 12, 12];
    const startedAt = at(r.started, startHour);
    const reviewAt = r.review !== undefined ? at(r.review, reviewHour) : undefined;
    const doneAt = r.done !== undefined ? at(r.done, doneHour) : undefined;
    const history: KanbanColumnChange[] = [
      { column: "ready", from: "backlog", at: at(r.started + 1) },
      { column: "in_progress", from: "ready", at: startedAt },
      ...(reviewAt
        ? [{ column: "review" as const, from: "in_progress" as const, at: reviewAt }]
        : []),
      ...(doneAt
        ? [
            {
              column: "done" as const,
              from: reviewAt ? ("review" as const) : ("in_progress" as const),
              at: doneAt,
            },
          ]
        : []),
    ];
    return {
      id: exampleId(`cycle-card-${i + 1}`),
      title: r.title,
      column: r.column,
      class: "standard",
      createdAt: at(r.started + 2),
      startedAt,
      ...(doneAt ? { completedAt: doneAt } : {}),
      columnSince: history[history.length - 1].at,
      history,
      ...(r.assignee ? { assignee: r.assignee } : {}),
      ...(r.blocked ? { blocked: true } : {}),
    };
  });
  const items = TYPED.map(
    ([name, started, done], i): WorkItem => ({
      id: exampleId(`cycle-typed-${i + 1}`),
      name,
      startDate: day(started),
      endDate: day(done),
    })
  );
  // The page's default: Review waits for a reviewer here too. A copy, so the example's marking stays its own.
  return { cards, items, waiting: [...DEFAULT_WAITING] };
}
