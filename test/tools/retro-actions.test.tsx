import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Impediment, RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { RETRO_CURRENT_ID } from "@/lib/retro/actions";

/**
 * Retro Actions: the follow-up list across retros — filters, done (also
 * when the linked impediment is resolved), owner and due date edits, and
 * carrying a past action onto the current board.
 */

const logs = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: (action: string) => logs.push(action), toolRunId: "test" }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));

import { RetroActionsTracker } from "@/app/(tools)/retro-actions/tracker";

const card = (id: string, text: string, extra: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text,
  votes: 0,
  groupedWith: null,
  isActionItem: true,
  assignee: "",
  discussing: false,
  ...extra,
});
const board = (id: string, cards: RetroCard[], extra: Partial<RetroBoard> = {}): RetroBoard => ({
  id,
  format: retroFormats[0],
  phase: "actions",
  cards,
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
  ...extra,
});

const LAST = board(
  "retro:2026-10-05T10:00:00.000Z",
  [
    card("l1", "Pair on the flaky tests", { assignee: "Sam", dueDate: "2026-10-15" }),
    card("l2", "Shorter planning", { done: true, doneAt: "2026-10-10T09:00:00.000Z" }),
    card("l3", "Fix the staging sandbox", {
      sentTo: [{ route: "impediment", targetId: "imp-1", at: "2026-10-06" }],
    }),
  ],
  { archivedAt: "2026-10-05T10:00:00.000Z" }
);
const CURRENT = board(
  RETRO_CURRENT_ID,
  [card("c1", "Write the on-call guide", { assignee: "Priya" })],
  {
    previousRetroId: LAST.id,
  }
);
const IMP_OPEN: Impediment = {
  id: "imp-1",
  title: "Staging sandbox",
  severity: "high",
  raisedAt: "2026-10-06",
};

const state = () => useWorkspaceStore.getState();
const cardOf = (boardId: string, id: string) =>
  state()
    .retroBoards?.find((b) => b.id === boardId)
    ?.cards.find((c) => c.id === id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  logs.length = 0;
  useWorkspaceStore.setState({
    retroBoards: [LAST, CURRENT],
    impediments: [IMP_OPEN],
    kanbanBoards: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({ retroBoards: [], impediments: [], kanbanBoards: [] });
});

describe("Retro Actions", () => {
  it("opens on the open actions, current retro first, with the counts", () => {
    render(<RetroActionsTracker />);
    const open = screen.getByRole("button", { name: /^Open/ });
    expect(open).toHaveAttribute("aria-pressed", "true");
    expect(open).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /^Overdue/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^Done/ })).toHaveTextContent("1");

    const sections = screen.getAllByRole("region");
    expect(sections[0]).toHaveAccessibleName("Current retro");
    expect(within(sections[0]).getByText("Write the on-call guide")).toBeInTheDocument();
    expect(sections[1]).toHaveAccessibleName("Start / Stop / Continue · 5 Oct 2026");
    expect(within(sections[1]).getByText("Pair on the flaky tests")).toBeInTheDocument();
    expect(within(sections[1]).getByText(/Overdue/)).toBeInTheDocument();
    expect(screen.queryByText("Shorter planning")).toBeNull();
  });

  it("filters by done and by owner", () => {
    render(<RetroActionsTracker />);
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(screen.getByText("Shorter planning")).toBeInTheDocument();
    expect(screen.queryByText("Pair on the flaky tests")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.change(screen.getByLabelText("Filter by owner"), { target: { value: "Sam" } });
    expect(screen.getByText("Pair on the flaky tests")).toBeInTheDocument();
    expect(screen.queryByText("Write the on-call guide")).toBeNull();
  });

  it("marks an action done on its own (archived) board, and open again", () => {
    render(<RetroActionsTracker />);
    fireEvent.click(screen.getByLabelText("Done: Pair on the flaky tests"));
    expect(cardOf(LAST.id, "l1")).toMatchObject({ done: true });
    expect(cardOf(LAST.id, "l1")?.doneAt).toBeTruthy();
    expect(logs).toContain("action_done");
    // The row's "Done <day>" button starts with "Done" too.
    const filters = screen.getByRole("group", { name: "Show" });
    fireEvent.click(within(filters).getByRole("button", { name: /^Done/ }));
    fireEvent.click(screen.getByLabelText("Done: Pair on the flaky tests"));
    expect(cardOf(LAST.id, "l1")?.done).toBeUndefined();
    expect(logs).toContain("action_reopened");
  });

  it("closes an action by itself once the impediment it was sent to is resolved", () => {
    const { rerender } = render(<RetroActionsTracker />);
    expect(screen.getByLabelText("Done: Fix the staging sandbox")).not.toBeChecked();
    useWorkspaceStore.setState({ impediments: [{ ...IMP_OPEN, resolvedAt: "2026-10-20" }] });
    rerender(<RetroActionsTracker />);
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    const box = screen.getByLabelText("Done: Fix the staging sandbox");
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.getByText(/Done in the linked tool/)).toBeInTheDocument();
  });

  it("edits the owner and the due date in place", () => {
    render(<RetroActionsTracker />);
    fireEvent.click(screen.getByRole("button", { name: /^Owner of Write the on-call guide:/ }));
    const owner = screen.getByLabelText("Owner of Write the on-call guide");
    fireEvent.change(owner, { target: { value: "Dev" } });
    fireEvent.blur(owner);
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("Dev");
    const due = screen.getByLabelText("Due date of Write the on-call guide");
    fireEvent.change(due, { target: { value: "2026-11-01" } });
    fireEvent.blur(due);
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.dueDate).toBe("2026-11-01");
  });

  it("carries a past action onto the current board", () => {
    render(<RetroActionsTracker />);
    const past = screen.getAllByRole("region")[1];
    fireEvent.click(within(past).getAllByRole("button", { name: /^Carry over / })[0]);
    const current = state().retroBoards?.find((b) => b.id === RETRO_CURRENT_ID);
    expect(current?.cards.map((c) => c.carriedFrom)).toContain("l1");
    expect(logs).toContain("action_carried_over");
    // The carried copy replaces the archived one in the list.
    expect(screen.getAllByText("Pair on the flaky tests")).toHaveLength(1);
  });

  it("exports the list as a Markdown checklist", () => {
    render(<RetroActionsTracker />);
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Retro actions");
    expect(md).toContain("3 open (1 overdue) · 1 done");
    expect(md).toContain("- [ ] Pair on the flaky tests — Owner: Sam · due 2026-10-15 · overdue");
    expect(md).toContain("- [x] Shorter planning — No owner yet");
  });

  it("points at the Retro board when there are no actions yet", () => {
    useWorkspaceStore.setState({ retroBoards: [] });
    render(<RetroActionsTracker />);
    expect(screen.getByRole("link", { name: "Open the Retro board" })).toHaveAttribute(
      "href",
      "/retro"
    );
  });
});
