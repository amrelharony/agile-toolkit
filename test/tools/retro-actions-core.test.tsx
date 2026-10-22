import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { RETRO_CURRENT_ID, type RetroAction } from "@/lib/retro/actions";
import { actionsToMarkdown } from "@/app/(tools)/retro-actions/markdown";

/**
 * Retro Actions, beyond the basic flows in retro-actions.test.tsx: the
 * Markdown checklist's edge cases, the loading state, the overdue and owner
 * filters (and an empty result), owner edits on Enter, clearing a due date,
 * the status line under each action, and carrying over with no retro board
 * to carry onto.
 */

const hydration = vi.hoisted(() => ({ hydrated: true }));
const toasts = vi.hoisted(() => ({ error: [] as string[], success: [] as string[] }));

vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test" }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: {
    error: (m: string) => toasts.error.push(m),
    success: (m: string) => toasts.success.push(m),
  },
}));
vi.mock("@/lib/team/use-team-roster", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team/use-team-roster")>()),
  useWorkspaceHydrated: () => hydration.hydrated,
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

const action = (id: string, text: string, extra: Partial<RetroAction> = {}): RetroAction => ({
  id,
  boardId: RETRO_CURRENT_ID,
  retroLabel: "Current retro",
  current: true,
  text,
  assignee: "",
  done: false,
  closedByTarget: false,
  overdue: false,
  sentTo: [],
  ...extra,
});

const ARCHIVED_AT = "2026-10-05T10:00:00.000Z";
const LAST = board(
  `retro:${ARCHIVED_AT}`,
  [
    card("l1", "Pair on the flaky tests", { assignee: "Sam", dueDate: "2026-10-15" }),
    card("l2", "Shorter planning", {
      assignee: " Ann ",
      done: true,
      doneAt: "2026-10-10T09:00:00Z",
    }),
    card("l3", "Rotate the on-call", { assignee: "Ann" }),
  ],
  { archivedAt: ARCHIVED_AT }
);
const CURRENT = board(RETRO_CURRENT_ID, [
  card("c1", "Write the on-call guide", { assignee: "Priya", carriedFrom: "old-1" }),
  card("c2", "Book the offsite", { dueDate: "2026-10-22" }),
]);

const cardOf = (boardId: string, id: string) =>
  useWorkspaceStore
    .getState()
    .retroBoards?.find((b) => b.id === boardId)
    ?.cards.find((c) => c.id === id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  hydration.hydrated = true;
  toasts.error.length = 0;
  toasts.success.length = 0;
  useWorkspaceStore.setState({ retroBoards: [LAST, CURRENT], impediments: [], kanbanBoards: [] });
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({ retroBoards: [], impediments: [], kanbanBoards: [] });
});

describe("actionsToMarkdown", () => {
  it("says there are no actions yet for an empty list", () => {
    expect(actionsToMarkdown([], { open: 0, overdue: 0, done: 0 })).toBe(
      "# Retro actions\n\n0 open · 0 done\n\nNo action items yet.\n"
    );
  });

  it("groups by retro with a blank line between groups", () => {
    const md = actionsToMarkdown(
      [
        action("a", "One", { assignee: "Sam" }),
        action("b", "Two", { boardId: "retro:x", retroLabel: "4Ls · 1 Oct 2026", current: false }),
        action("c", "Three", { boardId: "retro:x", retroLabel: "4Ls · 1 Oct 2026", done: true }),
      ],
      { open: 2, overdue: 0, done: 1 }
    );
    expect(md).toBe(
      [
        "# Retro actions",
        "",
        "2 open · 1 done",
        "",
        "## Current retro",
        "",
        "- [ ] One — Owner: Sam",
        "",
        "## 4Ls · 1 Oct 2026",
        "",
        "- [ ] Two — No owner yet",
        "- [x] Three — No owner yet",
        "",
      ].join("\n")
    );
  });

  it("keeps each action on one line, whatever newlines its text or owner holds", () => {
    const md = actionsToMarkdown(
      [action("a", "Fix the\r\n  build\n\nfor good", { assignee: " Sam\nand Ann " })],
      { open: 1, overdue: 0, done: 0 }
    );
    expect(md).toContain("- [ ] Fix the build for good — Owner: Sam and Ann\n");
  });

  it("treats a blank owner as no owner", () => {
    const md = actionsToMarkdown([action("a", "One", { assignee: "   " })], {
      open: 1,
      overdue: 0,
      done: 0,
    });
    expect(md).toContain("- [ ] One — No owner yet");
  });

  it("lists the due date, overdue and done-in-linked-tool marks in order", () => {
    const md = actionsToMarkdown(
      [
        action("a", "Late", { dueDate: "2026-10-01", overdue: true, assignee: "Sam" }),
        action("b", "Closed elsewhere", { done: true, closedByTarget: true }),
      ],
      { open: 1, overdue: 1, done: 1 }
    );
    expect(md).toContain("1 open (1 overdue) · 1 done");
    expect(md).toContain("- [ ] Late — Owner: Sam · due 2026-10-01 · overdue");
    expect(md).toContain("- [x] Closed elsewhere — No owner yet · done in the linked tool");
  });
});

describe("Retro Actions tracker", () => {
  it("waits for the workspace to load before deciding there are no actions", () => {
    hydration.hydrated = false;
    render(<RetroActionsTracker />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading retro actions…");
    expect(screen.queryByText(/No action items yet/)).toBeNull();
  });

  it("shows only overdue actions under Overdue (due today is not overdue)", () => {
    render(<RetroActionsTracker />);
    fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }));
    expect(screen.getByRole("button", { name: /^Overdue/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Pair on the flaky tests")).toBeInTheDocument();
    expect(screen.queryByText("Book the offsite")).toBeNull();
    expect(screen.queryByText("Rotate the on-call")).toBeNull();
  });

  it("offers each owner once, trimmed and sorted, and says when nothing matches", () => {
    render(<RetroActionsTracker />);
    const owner = screen.getByLabelText("Owner");
    expect(
      within(owner)
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual(["Everyone", "Ann", "Priya", "Sam"]);
    fireEvent.change(owner, { target: { value: "Ann" } });
    // Open filter: only Ann's open action; her done one stays hidden.
    expect(screen.getByText("Rotate the on-call")).toBeInTheDocument();
    expect(screen.queryByText("Shorter planning")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getByText("Shorter planning")).toBeInTheDocument();

    fireEvent.change(owner, { target: { value: "Priya" } });
    fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }));
    expect(screen.getByText("Nothing matches. Try another filter.")).toBeInTheDocument();
  });

  it("describes each action: carried over, this or a past retro, done date", () => {
    render(<RetroActionsTracker />);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    const line = (text: string) => screen.getByText(text).nextElementSibling!.textContent;
    expect(line("Write the on-call guide")).toBe("Carried over · This retro");
    expect(line("Book the offsite")).toBe("This retro");
    expect(line("Pair on the flaky tests")).toBe("Overdue · Past retro");
    expect(line("Shorter planning")).toBe("Done 2026-10-10");
  });

  it("saves a trimmed owner on Enter, and nothing when it is unchanged", () => {
    render(<RetroActionsTracker />);
    const owner = screen.getByLabelText("Owner of Book the offsite");
    fireEvent.change(owner, { target: { value: "  Dev  " } });
    fireEvent.keyDown(owner, { key: "Enter" });
    expect(cardOf(RETRO_CURRENT_ID, "c2")?.assignee).toBe("Dev");
    expect(owner).toHaveValue("Dev");

    const before = useWorkspaceStore.getState().retroBoards;
    const priya = screen.getByLabelText("Owner of Write the on-call guide");
    fireEvent.change(priya, { target: { value: "Priya " } });
    fireEvent.blur(priya);
    expect(useWorkspaceStore.getState().retroBoards).toBe(before);
  });

  it("removes the due date when it is cleared", () => {
    render(<RetroActionsTracker />);
    fireEvent.change(screen.getByLabelText("Due date of Pair on the flaky tests"), {
      target: { value: "" },
    });
    const c = cardOf(LAST.id, "l1")!;
    expect("dueDate" in c).toBe(false);
    expect(screen.getByRole("button", { name: /^Overdue/ })).toHaveTextContent("0");
  });

  it("offers Carry over only for open actions from past retros", () => {
    render(<RetroActionsTracker />);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    const carry = screen.getAllByRole("button", { name: "Carry over" });
    // l1 and l3 are open in the past retro; l2 is done; c1/c2 are on this retro.
    expect(carry).toHaveLength(2);
  });

  it("asks for a retro board first when there is none to carry onto", () => {
    useWorkspaceStore.setState({ retroBoards: [LAST] });
    render(<RetroActionsTracker />);
    fireEvent.click(screen.getAllByRole("button", { name: "Carry over" })[0]);
    expect(toasts.error).toEqual(["Open the Retro board and pick a format first."]);
    expect(useWorkspaceStore.getState().retroBoards).toEqual([LAST]);
  });

  it("asks for a format first when the current board has none", () => {
    const noFormat = { ...CURRENT, format: undefined } as unknown as RetroBoard;
    useWorkspaceStore.setState({ retroBoards: [LAST, noFormat] });
    render(<RetroActionsTracker />);
    fireEvent.click(screen.getAllByRole("button", { name: "Carry over" })[0]);
    expect(toasts.error).toEqual(["Open the Retro board and pick a format first."]);
    expect(cardOf(RETRO_CURRENT_ID, "c1")).toBeDefined();
    expect(
      useWorkspaceStore.getState().retroBoards?.find((b) => b.id === RETRO_CURRENT_ID)?.cards
    ).toHaveLength(2);
  });

  it("keeps the export in step with an edit", () => {
    render(<RetroActionsTracker />);
    fireEvent.click(screen.getByLabelText("Done: Rotate the on-call"));
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("- [x] Rotate the on-call — Owner: Ann");
    expect(md).toContain("3 open (1 overdue) · 2 done");
  });
});
