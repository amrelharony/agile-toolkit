import { exampleId } from "@/components/tool-frame/example-data";
import type {
  KanbanCard,
  KanbanClassOfService,
  KanbanColumnId,
} from "@/lib/stores/workspace-types";

const DAY_MS = 24 * 60 * 60 * 1000;

type Row = {
  title: string;
  description?: string;
  column: KanbanColumnId;
  class: KanbanClassOfService;
  /** Days ago the card was created / started / finished. */
  created: number;
  started?: number;
  completed?: number;
};

/**
 * A mobile checkout team mid-sprint. An expedite bug jumped the queue and
 * pushed In Progress over its default limit of 3, which is what the WIP
 * warning is for. One fixed-date card, one intangible upgrade, two done
 * cards so cycle time has something to show.
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
  },
  {
    title: "Holiday sale banner in the cart",
    description: "Has to ship before the sale starts.",
    column: "in_progress",
    class: "fixed_date",
    created: 7,
    started: 4,
  },
  {
    title: "Wallet payments on Android",
    column: "in_progress",
    class: "standard",
    created: 9,
    started: 5,
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
    started: 6,
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
];

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
  }));
}
