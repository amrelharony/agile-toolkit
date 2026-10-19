import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Kanban: removing a card offers Undo, and Undo puts the card back in its
 * old place in the column.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { KanbanClient } from "@/app/(tools)/kanban/kanban-client";

const now = "2026-10-01T09:00:00.000Z";
const card = (id: string, title: string) => ({
  id,
  title,
  column: "backlog" as const,
  class: "standard" as const,
  createdAt: now,
});

const titles = () =>
  (useWorkspaceStore.getState().kanbanBoards ?? [])
    .find((b) => b.id === "kanban:current")!
    .cards.map((c) => c.title);

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    kanbanBoards: [
      {
        id: "kanban:current",
        cards: [card("a", "Login page"), card("b", "Checkout flow"), card("c", "Search")],
        wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
      },
    ],
  });
});

describe("Kanban card delete", () => {
  it("removes the card, names it in the toast, and Undo restores it in place", () => {
    render(<KanbanClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Checkout flow" }));

    expect(screen.queryByText("Checkout flow")).toBeNull();
    expect(titles()).toEqual(["Login page", "Search"]);
    expect(undo.last!.label).toBe("Deleted “Checkout flow”");

    act(() => undo.last!.revert());
    expect(screen.getByText("Checkout flow")).toBeInTheDocument();
    expect(titles()).toEqual(["Login page", "Checkout flow", "Search"]);
  });
});
