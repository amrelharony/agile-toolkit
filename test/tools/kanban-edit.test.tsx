import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Kanban cards after adding: click the title (or Enter on it) to edit the
 * title and description, Enter saves, Escape cancels, an emptied title
 * reverts. A pasted list adds one card per line, the add box keeps focus,
 * delete offers Undo, and moving by select still works.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
const toasts = vi.hoisted(() => ({ info: [] as string[] }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(() => "t", {
    info: (m: string, o?: { description?: string }) => {
      toasts.info.push(`${m} ${o?.description ?? ""}`.trim());
      return "t";
    },
    error: () => "t",
    success: () => "t",
    dismiss: () => {},
  }),
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
const card = (id: string, title: string, description?: string) => ({
  id,
  title,
  ...(description ? { description } : {}),
  column: "backlog" as const,
  class: "standard" as const,
  createdAt: now,
});

const cards = () =>
  (useWorkspaceStore.getState().kanbanBoards ?? []).find((b) => b.id === "kanban:current")!.cards;
const titles = () => cards().map((c) => c.title);

function paste(el: HTMLElement, text: string) {
  fireEvent.paste(el, { clipboardData: { getData: () => text } });
}

beforeEach(() => {
  undo.last = null;
  toasts.info = [];
  useWorkspaceStore.setState({
    kanbanBoards: [
      {
        id: "kanban:current",
        cards: [
          card("a", "Login page", "Email and password"),
          card("b", "Checkout flow"),
          card("c", "Search"),
        ],
        wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
      },
    ],
  });
});

describe("Kanban: editing a card", () => {
  it("saves the title and description and hands focus back", () => {
    render(<KanbanClient />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole("button", { name: "Login page" }));

    const title = screen.getByRole("textbox", { name: "Card title" });
    const description = screen.getByRole("textbox", { name: "Card description" });
    expect(title).toHaveFocus();
    expect(description).toHaveValue("Email and password");

    fireEvent.change(title, { target: { value: "Sign-in page" } });
    fireEvent.change(description, { target: { value: "Email, password and SSO" } });
    fireEvent.keyDown(title, { key: "Enter" });

    expect(cards()[0]).toMatchObject({
      id: "a",
      title: "Sign-in page",
      description: "Email, password and SSO",
      column: "backlog",
    });
    expect(screen.getByRole("button", { name: "Sign-in page" })).toHaveFocus();
    expect(screen.getByText("Email, password and SSO")).toBeInTheDocument();
  });

  it("Ctrl+Enter saves from the description, and a card can get its first description", () => {
    render(<KanbanClient />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const description = screen.getByRole("textbox", { name: "Card description" });
    fireEvent.change(description, { target: { value: "Line one\nLine two" } });
    // Plain Enter is a new line: still editing.
    fireEvent.keyDown(description, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Card description" })).toBeInTheDocument();
    fireEvent.keyDown(description, { key: "Enter", ctrlKey: true });
    expect(cards()[2].description).toBe("Line one\nLine two");
  });

  it("an emptied description is removed", () => {
    render(<KanbanClient />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole("button", { name: "Login page" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Card description" }), {
      target: { value: "  " },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Card title" }), { key: "Enter" });
    expect("description" in cards()[0]).toBe(false);
  });

  it("Escape cancels", () => {
    const before = cards();
    render(<KanbanClient />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole("button", { name: "Checkout flow" }));
    const title = screen.getByRole("textbox", { name: "Card title" });
    fireEvent.change(title, { target: { value: "Something else" } });
    fireEvent.keyDown(title, { key: "Escape" });

    expect(cards()).toBe(before);
    expect(screen.getByRole("button", { name: "Checkout flow" })).toHaveFocus();
  });

  it("an emptied title reverts", () => {
    const before = cards();
    render(<KanbanClient />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole("button", { name: "Checkout flow" }));
    const title = screen.getByRole("textbox", { name: "Card title" });
    fireEvent.change(title, { target: { value: "" } });
    fireEvent.keyDown(title, { key: "Enter" });

    expect(cards()).toBe(before);
    expect(screen.getByRole("button", { name: "Checkout flow" })).toBeInTheDocument();
  });
});

describe("Kanban: adding cards", () => {
  it("Add keeps the cursor in the title box for the next card", () => {
    render(<KanbanClient />, { wrapper: TooltipProvider });
    const input = screen.getByRole("textbox", { name: "New card title" });
    fireEvent.change(input, { target: { value: "Payments" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(titles()).toEqual(["Login page", "Checkout flow", "Search", "Payments"]);
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("a pasted list adds one Backlog card per line", () => {
    render(<KanbanClient />, { wrapper: TooltipProvider });
    paste(
      screen.getByRole("textbox", { name: "New card title" }),
      "Reports\n\n- Exports\nAudit log"
    );
    expect(titles()).toEqual([
      "Login page",
      "Checkout flow",
      "Search",
      "Reports",
      "Exports",
      "Audit log",
    ]);
    expect(
      cards()
        .slice(3)
        .every((c) => c.column === "backlog" && c.class === "standard")
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Audit log" })).toBeInTheDocument();
    expect(toasts.info).toEqual([]);
  });

  it("caps a long paste and says how many lines were left out", () => {
    render(<KanbanClient />, { wrapper: TooltipProvider });
    const lines = Array.from({ length: 31 }, (_, i) => `Task ${i + 1}`).join("\n");
    paste(screen.getByRole("textbox", { name: "New card title" }), lines);
    expect(cards()).toHaveLength(3 + 30);
    expect(toasts.info).toEqual([
      "Added 30 cards. 1 more line was left out. One paste adds up to 30.",
    ]);
  });
});

describe("Kanban: delete and Undo", () => {
  it("removes the card and Undo restores it in place, edits and all", () => {
    render(<KanbanClient />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole("button", { name: "Login page" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Card title" }), {
      target: { value: "Sign-in page" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Card title" }), { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Remove Sign-in page" }));
    expect(titles()).toEqual(["Checkout flow", "Search"]);
    expect(undo.last!.label).toBe("Deleted “Sign-in page”");

    act(() => undo.last!.revert());
    expect(titles()).toEqual(["Sign-in page", "Checkout flow", "Search"]);
  });

  it("still moves cards by select", () => {
    render(<KanbanClient />, { wrapper: TooltipProvider });
    expect(screen.getByRole("combobox", { name: "Move Search" })).toBeInTheDocument();
  });

  it("keeps a card's selects and title easy to tap on phones and touch screens", () => {
    render(<KanbanClient />, { wrapper: TooltipProvider });
    // 36 px below sm, 44 px on any touch screen; the 28 px row is for a mouse
    // from sm up. Move is the way to move a card without dragging.
    for (const name of ["Move Search", "Class of service for Search"]) {
      const select = screen.getByRole("combobox", { name });
      expect(select).toHaveClass("h-9", "sm:h-7", "pointer-coarse:min-h-11");
      expect(select).not.toHaveClass("pointer-coarse:min-h-9");
      expect(select).not.toHaveClass("xs:h-7");
    }
    // The title is a 36 px target on touch, not a 16 px line of text.
    expect(screen.getByRole("button", { name: "Search" })).toHaveClass("pointer-coarse:py-2.5");
  });
});
