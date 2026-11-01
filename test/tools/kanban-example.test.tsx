import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KanbanCard } from "@/lib/stores/workspace-types";

/**
 * Kanban: "Load an example" fills an empty board (and "Clear example"
 * removes only those cards), and the board exports as Markdown.
 */

const spies = vi.hoisted(() => ({
  log: vi.fn(),
  sonify: vi.fn(),
  markdown: undefined as string | undefined,
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    spies.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: spies.sonify }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log }),
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
import { toMarkdown } from "@/app/(tools)/kanban/markdown";
import { buildExample } from "@/app/(tools)/kanban/example";

const NOW = new Date(2026, 9, 18, 12);
const LIMITS = { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 };

const card = (id: string, title: string, extra: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title,
  column: "backlog",
  class: "standard",
  createdAt: "2026-10-01T09:00:00.000Z",
  ...extra,
});

const board = () =>
  (useWorkspaceStore.getState().kanbanBoards ?? []).find((b) => b.id === "kanban:current");

beforeEach(() => {
  spies.log.mockClear();
  spies.sonify.mockClear();
  spies.markdown = undefined;
  useWorkspaceStore.setState({ kanbanBoards: [] });
});

describe("kanban toMarkdown", () => {
  it("lists every column with its WIP count, class of service and a summary", () => {
    const md = toMarkdown(
      {
        cards: [
          card("a", "Reorder", { column: "backlog" }),
          card("b", "Fix double charge", {
            column: "in_progress",
            class: "expedite",
            description: "Charged twice\non retry",
          }),
          card("c", "Sale banner", { column: "in_progress", class: "fixed_date" }),
          card("d", "Wallet payments", { column: "in_progress" }),
          card("e", "Autocomplete", { column: "in_progress" }),
          card("f", "Delivery estimate", {
            column: "done",
            startedAt: "2026-10-10T09:00:00.000Z",
            completedAt: "2026-10-13T09:00:00.000Z",
          }),
        ],
        wipLimits: LIMITS,
      },
      NOW
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Kanban — 18 Oct 2026");
    expect(md).toContain(
      "6 cards: Backlog 1, Ready 0, In progress 4, Review 0, Done 1.\n**Over WIP limit:** In progress (4/3)."
    );
    expect(lines).toContain("## Backlog (1)");
    expect(lines).toContain("## Ready (0/5 WIP)");
    expect(lines).toContain("## In progress (4/3 WIP, over limit)");
    expect(lines).toContain("## Review (0/2 WIP)");
    expect(lines).toContain("## Done (1)");
    expect(lines).toContain("- Fix double charge (Expedite) — Charged twice on retry");
    expect(lines).toContain("- Sale banner (Fixed date)");
    expect(lines).toContain("- Wallet payments");
    // 10 to 13 October, both days counted.
    expect(lines).toContain("- Delivery estimate (cycle time 4.0 days)");
    expect(lines).toContain("No cards.");
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("says so when every column is within its limit", () => {
    const md = toMarkdown({ cards: [card("a", "Reorder")], wipLimits: LIMITS }, NOW);
    expect(md).toContain("1 card: Backlog 1");
    expect(md).toContain("All columns are within their WIP limits.");
  });

  it("keeps each card on one line; pipes need no escaping outside a table", () => {
    const md = toMarkdown({ cards: [card("a", "Login | sign-up\nflow")], wipLimits: LIMITS }, NOW);
    expect(md.split("\n")).toContain("- Login | sign-up flow");
  });

  it("says there is nothing yet for an empty board", () => {
    expect(toMarkdown({ cards: [], wipLimits: LIMITS }, NOW)).toBe(
      "# Kanban — 18 Oct 2026\n\nNo cards yet.\n"
    );
  });
});

describe("kanban buildExample", () => {
  it("uses example ids and pushes In progress over its default WIP limit", () => {
    const cards = buildExample(NOW);
    expect(cards.length).toBeGreaterThanOrEqual(6);
    // Small enough to take in at a glance; five of them are done cards, so
    // cycle time and P85 have their minimum sample.
    expect(cards.length).toBeLessThanOrEqual(12);
    expect(cards.every((c) => c.id.startsWith("example-"))).toBe(true);
    expect(cards.filter((c) => c.column === "in_progress").length).toBeGreaterThan(
      LIMITS.in_progress
    );
    expect(cards.some((c) => c.class === "expedite")).toBe(true);
    expect(cards.some((c) => c.completedAt)).toBe(true);
  });
});

describe("kanban example flow", () => {
  it("loads the example, then clears only the example cards", () => {
    useWorkspaceStore.setState({
      kanbanBoards: [{ id: "kanban:current", cards: [], wipLimits: { ...LIMITS, review: 4 } }],
    });
    render(<KanbanClient />, { wrapper: TooltipProvider });
    expect(screen.queryByRole("button", { name: "Clear example" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Fix double charge when a payment retries")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear example" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(screen.getByText(/WIP limit violated/)).toBeInTheDocument();
    // Not the user's own work: nothing logged or sonified.
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.sonify).not.toHaveBeenCalled();
    expect(spies.markdown).toContain("## In progress (4/3 WIP, over limit)");

    fireEvent.change(screen.getByLabelText("New card title"), { target: { value: "My card" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(board()!.cards.map((c) => c.title)).toEqual(["My card"]);
    expect(board()!.wipLimits.review).toBe(4);
    expect(screen.queryByText("Fix double charge when a payment retries")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear example" })).toBeNull();
  });

  it("doesn't offer the example once the board has the user's cards", () => {
    useWorkspaceStore.setState({
      kanbanBoards: [{ id: "kanban:current", cards: [card("u1", "Mine")], wipLimits: LIMITS }],
    });
    render(<KanbanClient />, { wrapper: TooltipProvider });
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(spies.markdown).toContain("- Mine");
  });
});
