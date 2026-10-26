import { Grid3X3 } from "lucide-react";
import type { MethodToolConfig } from "@/components/prioritization/method-tool";
import { VALUE_EFFORT_ACTIONS } from "@/lib/history/event-actions";
import { buildExample } from "./example";

/**
 * The tool for the shared method shell's pieces (its add, save, delete and
 * example actions, and the row editor). A title alone is a valid item: it
 * waits under "Not placed yet" until it gets a value and an effort.
 */
export const VE_CONFIG: MethodToolConfig = {
  methodId: "value-effort",
  toolId: "value-effort-matrix",
  title: "Value vs Effort Matrix",
  description:
    "Place items by value (the backlog's Fibonacci value, 8 or more is high) and effort (1–10, 6 or more is high) into Quick Wins, Big Bets, Fill-Ins and Time Wasters.",
  icon: Grid3X3,
  noun: { one: "item", many: "items" },
  titleLabel: "Item title",
  titlePlaceholder: "e.g. Saved filters on the board",
  submitLabel: "Add",
  listLabel: "Items by quadrant, do-first order",
  emptyText:
    "No items yet. Add one above (a title is enough to start), or load an example to see a filled matrix.",
  history: {
    ITEM_ADDED: VALUE_EFFORT_ACTIONS.ITEM_ADDED,
    ITEM_UPDATED: VALUE_EFFORT_ACTIONS.ITEM_UPDATED,
    ITEM_REMOVED: VALUE_EFFORT_ACTIONS.ITEM_REMOVED,
  },
  allowTitleOnly: true,
  buildExample: () => buildExample(),
};
