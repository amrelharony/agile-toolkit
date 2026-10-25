import { exampleId } from "@/components/tool-frame/example-data";
import type { KanbanCard, KanbanColumnId } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import type { WorkItem } from "./types";

type CardRow = {
  title: string;
  column: KanbanColumnId;
  /** Days ago it was started and (in Done) finished. */
  started: number;
  done?: number;
  assignee?: string;
  blocked?: boolean;
};

/**
 * Seven weeks of a team's Flow board: 14 cards finished, most in 2 to 6
 * days with a couple of long ones, and three still in progress, one of
 * them blocked and older than the 85th percentile.
 */
const CARDS: CardRow[] = [
  { title: "Guest checkout", column: "done", started: 49, done: 45 },
  { title: "Promo codes at checkout", column: "done", started: 46, done: 43 },
  { title: "Order confirmation emails", column: "done", started: 44, done: 40 },
  { title: "Saved addresses", column: "done", started: 41, done: 31 },
  { title: "Show delivery estimate in the cart", column: "done", started: 36, done: 33 },
  { title: "Fix tax rounding on split shipments", column: "done", started: 33, done: 33 },
  { title: "Gift messages", column: "done", started: 30, done: 26 },
  { title: "Reorder from order history", column: "done", started: 27, done: 22 },
  { title: "Wishlist sharing", column: "done", started: 23, done: 20 },
  { title: "Low-stock badges", column: "done", started: 19, done: 17 },
  { title: "Faster product search", column: "done", started: 18, done: 6 },
  { title: "Cart reminders", column: "done", started: 12, done: 9 },
  { title: "Size guide", column: "done", started: 9, done: 7 },
  { title: "Fix double charge when a payment retries", column: "done", started: 4, done: 3 },
  {
    title: "Wallet payments on Android",
    column: "in_progress",
    started: 12,
    assignee: "Chloé",
    blocked: true,
  },
  { title: "Saved cards for returning shoppers", column: "review", started: 5, assignee: "Dev" },
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
}

/**
 * The example, shown in memory only: cards with `example-` ids that never
 * reach the Flow board, and typed items that never reach the tool's store.
 * Stamps are at noon local time, so every day reads the same anywhere.
 */
export function buildExample(today: string = todayIso()): CycleTimeExample {
  const day = (ago: number) => addDays(today, -ago) as string;
  const at = (ago: number) => new Date(`${day(ago)}T12:00:00`).toISOString();
  const cards = CARDS.map(
    (r, i): KanbanCard => ({
      id: exampleId(`cycle-card-${i + 1}`),
      title: r.title,
      column: r.column,
      class: "standard",
      createdAt: at(r.started + 2),
      startedAt: at(r.started),
      ...(r.done !== undefined ? { completedAt: at(r.done), columnSince: at(r.done) } : {}),
      ...(r.assignee ? { assignee: r.assignee } : {}),
      ...(r.blocked ? { blocked: true } : {}),
    })
  );
  const items = TYPED.map(
    ([name, started, done], i): WorkItem => ({
      id: exampleId(`cycle-typed-${i + 1}`),
      name,
      startDate: day(started),
      endDate: day(done),
    })
  );
  return { cards, items };
}
