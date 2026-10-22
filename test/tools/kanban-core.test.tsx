import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KanbanCard } from "@/lib/stores/workspace-types";

/**
 * Kanban gap-filling: the Markdown edges (legacy columns, unlimited queues,
 * cycle-time guards), the example's timestamps, the KPI row, add-form
 * validation and caps, moving cards by select (start / completion stamps),
 * class of service, and the WIP-limit inputs.
 */

const undo = vi.hoisted(() => ({ label: "" }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void }) => {
    undo.label = a.label;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { KanbanClient } from "@/app/(tools)/kanban/kanban-client";
import { toMarkdown } from "@/app/(tools)/kanban/markdown";
import { buildExample } from "@/app/(tools)/kanban/example";
import { KANBAN_DESCRIPTION_MAX, KANBAN_TITLE_MAX } from "@/app/(tools)/kanban/card-text";

const KB_ID = "kanban:current";
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

const board = () => (useWorkspaceStore.getState().kanbanBoards ?? []).find((b) => b.id === KB_ID);
const stored = (id: string) => board()!.cards.find((c) => c.id === id)!;
const seed = (cards: KanbanCard[], wipLimits = LIMITS) =>
  useWorkspaceStore.setState({ kanbanBoards: [{ id: KB_ID, cards, wipLimits }] });

/** A KPI tile's value and hint, found by its label. */
function kpi(label: string) {
  const value = screen.getByText(label).parentElement!.nextElementSibling!;
  return { value: value.textContent, hint: value.nextElementSibling?.textContent ?? null };
}

function choose(trigger: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: trigger }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  undo.label = "";
  useWorkspaceStore.setState({ kanbanBoards: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("kanban toMarkdown edges", () => {
  it("files a card from a column that no longer exists under Backlog", () => {
    const legacy = card("x", "Old lane card", { column: "qa" as KanbanCard["column"] });
    const md = toMarkdown({ cards: [legacy, card("a", "Fresh")], wipLimits: LIMITS }, NOW);
    expect(md).toContain("2 cards: Backlog 2, Ready 0, In progress 0, Review 0, Done 0.");
    expect(md.split("## Backlog (2)\n\n")[1]).toMatch(/^- Old lane card\n- Fresh\n/);
  });

  it("never applies a WIP limit to Backlog or Done", () => {
    const md = toMarkdown(
      {
        cards: [card("a", "One"), card("b", "Two"), card("c", "Three", { column: "done" })],
        wipLimits: { ...LIMITS, backlog: 1, done: 0 },
      },
      NOW
    );
    expect(md).toContain("All columns are within their WIP limits.");
    expect(md).toContain("## Backlog (2)");
    expect(md).not.toContain("over limit");
  });

  it("treats a missing WIP limit as no limit", () => {
    const md = toMarkdown(
      {
        cards: [card("a", "A", { column: "review" }), card("b", "B", { column: "review" })],
        wipLimits: { backlog: 0, ready: 5, in_progress: 3, done: 0 } as typeof LIMITS,
      },
      NOW
    );
    expect(md).toContain("## Review (2)");
    expect(md).toContain("All columns are within their WIP limits.");
  });

  it("guards the cycle-time tag: done only, both stamps, valid dates, never negative", () => {
    const lines = toMarkdown(
      {
        cards: [
          // Clock skew: completed before started → 0, not negative.
          card("a", "Skewed", {
            column: "done",
            startedAt: "2026-10-10T09:00:00.000Z",
            completedAt: "2026-10-09T09:00:00.000Z",
          }),
          card("b", "Bad dates", { column: "done", startedAt: "nope", completedAt: "nope" }),
          card("c", "Never started", { column: "done", completedAt: "2026-10-09T09:00:00.000Z" }),
          // Not done: no cycle time even with both stamps.
          card("d", "Reviewing", {
            column: "review",
            startedAt: "2026-10-01T09:00:00.000Z",
            completedAt: "2026-10-02T09:00:00.000Z",
          }),
          card("e", "Half day", {
            column: "done",
            class: "intangible",
            startedAt: "2026-10-01T00:00:00.000Z",
            completedAt: "2026-10-01T12:00:00.000Z",
          }),
        ],
        wipLimits: LIMITS,
      },
      NOW
    ).split("\n");
    expect(lines).toContain("- Skewed (cycle time 0.0 days)");
    expect(lines).toContain("- Bad dates");
    expect(lines).toContain("- Never started");
    expect(lines).toContain("- Reviewing");
    expect(lines).toContain("- Half day (Intangible, cycle time 0.5 days)");
  });

  it("collapses CRLF and padded newlines in titles and descriptions", () => {
    const md = toMarkdown(
      {
        cards: [card("a", "  Line one \r\n  line two  ", { description: "Why:\r\n\r\n  money" })],
        wipLimits: LIMITS,
      },
      NOW
    );
    expect(md.split("\n")).toContain("- Line one line two — Why: money");
  });
});

describe("kanban buildExample timestamps", () => {
  it("stamps every card relative to now, in created → started → completed order", () => {
    const cards = buildExample(NOW);
    const t = (s?: string) => (s ? new Date(s).getTime() : NaN);
    for (const c of cards) {
      expect(t(c.createdAt)).toBeLessThanOrEqual(NOW.getTime());
      if (c.startedAt) expect(t(c.startedAt)).toBeGreaterThanOrEqual(t(c.createdAt));
      if (c.completedAt) expect(t(c.completedAt)).toBeGreaterThanOrEqual(t(c.startedAt));
      // Only Done cards are finished; In Progress and Review ones are started.
      expect(Boolean(c.completedAt)).toBe(c.column === "done");
      if (c.column === "in_progress" || c.column === "review") expect(c.startedAt).toBeTruthy();
      if (c.column === "backlog" || c.column === "ready") expect(c.startedAt).toBeUndefined();
    }
    // Fixed ids, so loading twice in a row can't duplicate under new ids.
    expect(buildExample(NOW).map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });
});

describe("Kanban board: empty and seeded", () => {
  it("shows zeroed KPIs, default limits and no warning on a new board", () => {
    render(<KanbanClient />);
    expect(screen.getByText(/No cards yet\./)).toBeInTheDocument();
    expect(kpi("Cycle avg")).toEqual({ value: "0.0d", hint: "±0.0" });
    expect(kpi("P85").value).toBe("0.0d");
    expect(kpi("Last 7 days").value).toBe("0");
    expect(kpi("Next week").value).toBe("—");
    expect(screen.queryByText(/WIP limit violated/)).toBeNull();
    expect(screen.queryByText("Weekly throughput")).toBeNull();
    expect(screen.getByLabelText("WIP limit for Ready")).toHaveValue(5);
    expect(screen.getByLabelText("WIP limit for In Progress")).toHaveValue(3);
    expect(screen.getByLabelText("WIP limit for Review")).toHaveValue(2);
    // Backlog and Done are queues: no limit box.
    expect(screen.queryByLabelText("WIP limit for Backlog")).toBeNull();
    expect(screen.queryByLabelText("WIP limit for Done")).toBeNull();
  });

  it("derives cycle time, P85 and last-7-days throughput from done cards", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z"));
    seed([
      // 3 days, finished 5 days ago: counts toward the last 7 days.
      card("a", "Recent", {
        column: "done",
        startedAt: "2026-10-10T12:00:00.000Z",
        completedAt: "2026-10-13T12:00:00.000Z",
      }),
      // 1 day, finished 16 days ago: outside the window.
      card("b", "Older", {
        column: "done",
        startedAt: "2026-10-01T12:00:00.000Z",
        completedAt: "2026-10-02T12:00:00.000Z",
      }),
      card("c", "Doing", { column: "in_progress", startedAt: "2026-10-15T12:00:00.000Z" }),
    ]);
    render(<KanbanClient />);
    expect(kpi("Cycle avg")).toEqual({ value: "2.0d", hint: "±1.4" });
    expect(kpi("P85").value).toBe("3.0d");
    expect(kpi("Last 7 days").value).toBe("1");
    // Two different weeks of completions: the chart and a forecast appear.
    expect(screen.getByText("Weekly throughput")).toBeInTheDocument();
    expect(kpi("Next week").value).toMatch(/^\d+$/);
  });

  it("shows a card from a column that no longer exists in Backlog instead of crashing", () => {
    seed([card("x", "Old lane card", { column: "qa" as KanbanCard["column"] })]);
    render(<KanbanClient />);
    expect(screen.getByRole("button", { name: "Old lane card" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Move Old lane card" })).toBeInTheDocument();
  });

  it("names every column over its limit, with counts", () => {
    seed(
      [
        card("a", "R1", { column: "ready" }),
        card("b", "R2", { column: "ready" }),
        card("c", "V1", { column: "review" }),
        card("d", "V2", { column: "review" }),
        card("e", "V3", { column: "review" }),
      ],
      { ...LIMITS, ready: 1 }
    );
    render(<KanbanClient />);
    expect(screen.getByText(/WIP limit violated/).parentElement).toHaveTextContent(
      "WIP limit violated: Ready (2/1), Review (3/2)"
    );
  });
});

describe("Kanban add form", () => {
  it("ignores a blank title and trims what it stores", () => {
    render(<KanbanClient />);
    const title = screen.getByRole("textbox", { name: "New card title" });
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(board()).toBeUndefined();

    fireEvent.change(title, { target: { value: "  Payments  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "New card description" }), {
      target: { value: "   " },
    });
    fireEvent.keyDown(title, { key: "Enter" });
    const [added] = board()!.cards;
    expect(added).toMatchObject({ title: "Payments", column: "backlog", class: "standard" });
    expect(added.description).toBeUndefined();
    expect(added.startedAt).toBeUndefined();
    // A new board keeps the default limits.
    expect(board()!.wipLimits).toEqual(LIMITS);
  });

  it("adds from the description with Ctrl+Enter, but not plain Enter", () => {
    render(<KanbanClient />);
    fireEvent.change(screen.getByRole("textbox", { name: "New card title" }), {
      target: { value: "Exports" },
    });
    const description = screen.getByRole("textbox", { name: "New card description" });
    fireEvent.change(description, { target: { value: "CSV first" } });
    fireEvent.keyDown(description, { key: "Enter" });
    expect(board()).toBeUndefined();
    fireEvent.keyDown(description, { key: "Enter", ctrlKey: true });
    expect(board()!.cards.map((c) => [c.title, c.description])).toEqual([["Exports", "CSV first"]]);
  });

  it("caps an over-long title and description at the form's limits", () => {
    render(<KanbanClient />);
    fireEvent.change(screen.getByRole("textbox", { name: "New card title" }), {
      target: { value: "t".repeat(KANBAN_TITLE_MAX + 50) },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "New card description" }), {
      target: { value: "d".repeat(KANBAN_DESCRIPTION_MAX + 50) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const [added] = board()!.cards;
    expect(added.title).toHaveLength(KANBAN_TITLE_MAX);
    expect(added.description).toHaveLength(KANBAN_DESCRIPTION_MAX);
  });

  it("shortens a long title in the delete toast", () => {
    // 39th character is a space: cut there, trimmed, then the ellipsis.
    const long = "Migrate every legacy payment providers to the new gateway";
    seed([card("a", long)]);
    render(<KanbanClient />);
    fireEvent.click(screen.getByRole("button", { name: `Remove ${long}` }));
    expect(undo.label).toBe("Deleted “Migrate every legacy payment providers…”");
    expect(board()!.cards).toEqual([]);
  });
});

describe("Kanban moves and class of service", () => {
  it("stamps the start on In Progress and the finish on Done", () => {
    seed([card("a", "Login")]);
    render(<KanbanClient />);
    choose("Move Login", "In Progress");
    expect(stored("a").column).toBe("in_progress");
    const started = stored("a").startedAt;
    expect(started).toBeTruthy();
    expect(stored("a").completedAt).toBeUndefined();

    choose("Move Login", "Done");
    expect(stored("a").column).toBe("done");
    // Keeps its original start.
    expect(stored("a").startedAt).toBe(started);
    expect(stored("a").completedAt).toBeTruthy();
  });

  it("drops the finish when a card leaves Done, and the start when it goes back to Ready", () => {
    seed([
      card("a", "Login", {
        column: "done",
        startedAt: "2026-10-10T09:00:00.000Z",
        completedAt: "2026-10-12T09:00:00.000Z",
      }),
    ]);
    render(<KanbanClient />);
    choose("Move Login", "Review");
    expect(stored("a").column).toBe("review");
    expect(stored("a").completedAt).toBeUndefined();
    expect(stored("a").startedAt).toBe("2026-10-10T09:00:00.000Z");

    choose("Move Login", "Ready");
    expect(stored("a").startedAt).toBeUndefined();
  });

  it("changes a card's class of service", () => {
    seed([card("a", "Hotfix"), card("b", "Other")]);
    render(<KanbanClient />);
    choose("Class of service for Hotfix", "Expedite");
    expect(stored("a").class).toBe("expedite");
    expect(stored("b").class).toBe("standard");
  });
});

describe("Kanban WIP limits", () => {
  const limitOf = (col: keyof typeof LIMITS) => board()!.wipLimits[col];

  it("commits on blur, and an over-limit column is flagged right away", () => {
    seed([card("a", "R1", { column: "ready" }), card("b", "R2", { column: "ready" })]);
    render(<KanbanClient />);
    const ready = screen.getByLabelText("WIP limit for Ready");
    fireEvent.change(ready, { target: { value: "1" } });
    // Still a draft: nothing written yet.
    expect(limitOf("ready")).toBe(5);
    fireEvent.blur(ready);
    expect(limitOf("ready")).toBe(1);
    expect(screen.getByText(/WIP limit violated/).parentElement).toHaveTextContent("Ready (2/1)");
  });

  it("puts the limit back when the box is emptied", () => {
    seed([]);
    render(<KanbanClient />);
    const review = screen.getByLabelText("WIP limit for Review");
    fireEvent.change(review, { target: { value: "" } });
    fireEvent.blur(review);
    expect(review).toHaveValue(2);
    expect(limitOf("review")).toBe(2);
  });

  it("rounds down and caps at 999", () => {
    seed([]);
    render(<KanbanClient />);
    const ready = screen.getByLabelText("WIP limit for Ready");
    fireEvent.change(ready, { target: { value: "2.7" } });
    fireEvent.blur(ready);
    expect(limitOf("ready")).toBe(2);
    expect(ready).toHaveValue(2);
    fireEvent.change(ready, { target: { value: "5000" } });
    fireEvent.blur(ready);
    expect(limitOf("ready")).toBe(999);
    expect(ready).toHaveValue(999);
  });

  // Bug: a negative or same-after-rounding entry stayed in the box while the
  // board kept the old limit, so the box showed a limit nobody was using.
  it("never shows a number the board isn't using", () => {
    seed([]);
    render(<KanbanClient />);
    const ready = screen.getByLabelText("WIP limit for Ready");
    fireEvent.change(ready, { target: { value: "-3" } });
    fireEvent.blur(ready);
    expect(limitOf("ready")).toBe(5);
    expect(ready).toHaveValue(5);

    fireEvent.change(ready, { target: { value: "5.4" } });
    fireEvent.blur(ready);
    expect(limitOf("ready")).toBe(5);
    expect(ready).toHaveValue(5);
  });

  it("In Progress: commits on blur and keeps the limit when emptied or negative", () => {
    seed([]);
    render(<KanbanClient />);
    const doing = screen.getByLabelText("WIP limit for In Progress");
    fireEvent.change(doing, { target: { value: "" } });
    // Can be cleared while typing.
    expect(doing).toHaveValue(null);
    fireEvent.blur(doing);
    expect(doing).toHaveValue(3);
    expect(limitOf("in_progress")).toBe(3);

    fireEvent.change(doing, { target: { value: "-1" } });
    fireEvent.blur(doing);
    expect(limitOf("in_progress")).toBe(3);
    expect(doing).toHaveValue(3);

    fireEvent.change(doing, { target: { value: "4" } });
    fireEvent.keyDown(doing, { key: "Enter" });
    fireEvent.blur(doing);
    expect(limitOf("in_progress")).toBe(4);
    expect(doing).toHaveValue(4);
  });

  it("a limit of 0 means no limit", () => {
    seed([card("a", "R1", { column: "review" }), card("b", "R2", { column: "review" })], {
      ...LIMITS,
      review: 1,
    });
    render(<KanbanClient />);
    expect(screen.getByText(/WIP limit violated/)).toBeInTheDocument();
    const review = screen.getByLabelText("WIP limit for Review");
    fireEvent.change(review, { target: { value: "0" } });
    fireEvent.blur(review);
    expect(limitOf("review")).toBe(0);
    expect(screen.queryByText(/WIP limit violated/)).toBeNull();
  });
});
