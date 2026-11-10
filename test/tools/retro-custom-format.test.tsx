import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { RETRO_COLUMN_PALETTE, retroFormats } from "@/lib/constants/retro-formats";
import { addDays } from "@/lib/impediments/model";
import { blankRetroBoard } from "@/lib/retro/board";
import { customFormatFrom } from "@/lib/retro/custom-format";
import { SNAPSHOT_IMPORTERS } from "@/lib/share/snapshot-import";
import { goalDocId } from "@/lib/sprints/goal-doc";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";

/**
 * Retro: the Custom card in the format picker. The team names 2 to 6
 * columns, nothing starts until the draft is valid, starting saves the
 * format in this browser, and a saved format shows as its own card next
 * time, with Delete and Undo. And the one format the sprint's facts call
 * for is marked as suggested, never picked.
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
vi.mock("@/components/a11y/live-announcer", () => ({ useAnnounce: () => () => {} }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
/** What the board last handed Export: the share link's state among it. */
const exported = vi.hoisted(() => ({ last: null as null | { shareState?: unknown } }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: { shareState?: unknown }) => {
    exported.last = props;
    return null;
  },
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test-run" }),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
    React.createElement("div", { ...strip(props), ref })
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: () => Div }),
  };
});

import { RetroClient } from "@/app/(tools)/retro/retro-client";
import { useRetroFormatsStore } from "@/app/(tools)/retro/custom-formats-store";

const current = () =>
  (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === "retro:current");
const saved = () => useRetroFormatsStore.getState().custom;

function openCustom() {
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  return screen.getByRole("region", { name: "Your own columns" });
}

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    retroBoards: [],
    sprints: [],
    teamMembers: [],
    stories: [],
    sprintGoals: [],
    moodEntries: [],
    moodPulses: [],
    impediments: [],
    kudos: [],
  });
  useRetroFormatsStore.setState({ custom: [] });
});

describe("Custom format", () => {
  it("opens a form for the team's own columns, starting with the name field", () => {
    render(<RetroClient />);
    const toggle = screen.getByRole("button", { name: "Custom" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const form = openCustom();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(form).getByLabelText("Format name")).toHaveFocus();
    expect(within(form).getAllByLabelText(/^Column \d$/)).toHaveLength(3);

    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Your own columns" })).toBeNull();
    expect(current()).toBeUndefined();
  });

  it("says what's missing and starts nothing until the draft is valid", () => {
    render(<RetroClient />);
    const form = openCustom();
    fireEvent.click(within(form).getByRole("button", { name: "Start retro" }));
    expect(within(form).getByText("Name the format.")).toBeInTheDocument();
    expect(within(form).getAllByText("Name this column.")).toHaveLength(3);
    expect(within(form).getByLabelText("Format name")).toHaveFocus();
    expect(current()).toBeUndefined();
    expect(saved()).toEqual([]);
  });

  it("adds columns up to 6 and removes them down to 2", () => {
    render(<RetroClient />);
    const form = openCustom();
    const add = () => within(form).queryByRole("button", { name: "Add column" });
    fireEvent.click(add()!);
    expect(within(form).getByLabelText("Column 4")).toHaveFocus();
    fireEvent.click(add()!);
    fireEvent.click(add()!);
    expect(within(form).getAllByLabelText(/^Column \d$/)).toHaveLength(6);
    expect(add()).toBeNull();

    for (let i = 0; i < 4; i++) {
      fireEvent.click(within(form).getAllByRole("button", { name: /^Remove column/ })[0]);
    }
    expect(within(form).getAllByLabelText(/^Column \d$/)).toHaveLength(2);
    expect(within(form).queryByRole("button", { name: /^Remove column/ })).toBeNull();
  });

  it("starts a board in the team's columns and saves the format in this browser", () => {
    render(<RetroClient />);
    const form = openCustom();
    fireEvent.change(within(form).getByLabelText("Format name"), {
      target: { value: "Team pulse" },
    });
    fireEvent.change(within(form).getByLabelText("Column 1"), { target: { value: "Wins" } });
    fireEvent.change(within(form).getByLabelText("Column 2"), { target: { value: "Worries" } });
    fireEvent.change(within(form).getByLabelText("Column 3"), { target: { value: "Ideas" } });
    fireEvent.click(within(form).getByRole("button", { name: "Start retro" }));

    const board = current()!;
    expect(board.format.id).toMatch(/^custom-/);
    expect(board.format.name).toBe("Team pulse");
    expect(board.format.columns.map((c) => [c.key, c.label, c.color])).toEqual([
      ["wins", "Wins", RETRO_COLUMN_PALETTE[0]],
      ["worries", "Worries", RETRO_COLUMN_PALETTE[1]],
      ["ideas", "Ideas", RETRO_COLUMN_PALETTE[2]],
    ]);
    expect(saved()).toEqual([
      { id: board.format.id, name: "Team pulse", columns: ["Wins", "Worries", "Ideas"] },
    ]);
    // The board is drawn in those columns, empty ones included.
    for (const label of ["New card for Wins", "New card for Worries", "New card for Ideas"]) {
      expect(screen.getByRole("textbox", { name: label })).toBeInTheDocument();
    }
  });

  it("shows a saved format as its own card, which starts the same board", () => {
    useRetroFormatsStore.setState({
      custom: [{ id: "custom-saved0001", name: "Team pulse", columns: ["Wins", "Worries"] }],
    });
    render(<RetroClient />);
    expect(screen.getByText("Your own columns: Wins and Worries.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Team pulse" }));
    expect(current()?.format).toMatchObject({
      id: "custom-saved0001",
      name: "Team pulse",
      columns: [
        { key: "wins", label: "Wins" },
        { key: "worries", label: "Worries" },
      ],
    });
  });

  it("deletes a saved format with Undo", () => {
    const pulse = { id: "custom-saved0001", name: "Team pulse", columns: ["Wins", "Worries"] };
    const other = { id: "custom-saved0002", name: "Other", columns: ["A", "B"] };
    useRetroFormatsStore.setState({ custom: [pulse, other] });
    render(<RetroClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete the Team pulse format" }));
    expect(saved()).toEqual([other]);
    expect(screen.queryByRole("button", { name: "Team pulse" })).toBeNull();
    expect(undo.last?.label).toBe("Deleted the “Team pulse” format");
    act(() => undo.last!.revert());
    expect(saved()).toEqual([pulse, other]);
    expect(screen.getByRole("button", { name: "Team pulse" })).toBeInTheDocument();
  });

  it("puts the custom columns and Votes each in the board's share link", () => {
    const pulse = customFormatFrom(
      { name: "Team pulse", columns: ["Wins", "Worries"] },
      "custom-saved0001"
    );
    useWorkspaceStore.setState({
      retroBoards: [
        {
          ...blankRetroBoard(pulse, { votesPerPerson: 5 }),
          cards: [
            {
              id: "w1",
              columnKey: "worries",
              text: "Flaky CI",
              votes: 0,
              groupedWith: null,
              isActionItem: false,
              assignee: "",
              discussing: false,
            },
          ],
        },
      ],
    });
    render(<RetroClient />);
    // The link as someone opens it, through the importer.
    const link = () => JSON.parse(JSON.stringify(exported.last?.shareState));
    expect(link()).toMatchObject({ format: { id: "custom-saved0001" }, votesPerPerson: 5 });
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Votes each person has" })).getByRole("radio", {
        name: "8 votes",
      })
    );
    const shared = link();
    useWorkspaceStore.setState({ retroBoards: [] });
    expect(SNAPSHOT_IMPORTERS.retro.importState(shared)).toBeTypeOf("function");
    const copy = useWorkspaceStore.getState().retroBoards!.find((b) => b.archivedAt)!;
    expect(copy.format).toEqual(pulse);
    expect(copy.votesPerPerson).toBe(8);
    expect(copy.cards.map((c) => [c.columnKey, c.text])).toEqual([["worries", "Flaky CI"]]);
  });

  it("saves the same columns once, moving them to the front", () => {
    const pulse = { id: "custom-saved0001", name: "Team pulse", columns: ["Wins", "Worries"] };
    const other = { id: "custom-saved0002", name: "Other", columns: ["A", "B"] };
    useRetroFormatsStore.setState({ custom: [other, pulse] });
    render(<RetroClient />);
    const form = openCustom();
    fireEvent.click(within(form).getAllByRole("button", { name: /^Remove column/ })[2]);
    fireEvent.change(within(form).getByLabelText("Format name"), {
      target: { value: "team pulse" },
    });
    fireEvent.change(within(form).getByLabelText("Column 1"), { target: { value: "wins" } });
    fireEvent.change(within(form).getByLabelText("Column 2"), { target: { value: "WORRIES" } });
    fireEvent.click(within(form).getByRole("button", { name: "Start retro" }));
    expect(saved().map((f) => f.id)).toEqual(["custom-saved0001", "custom-saved0002"]);
    expect(current()?.format.id).toBe("custom-saved0001");
  });
});

describe("Suggested for this sprint", () => {
  const TODAY = todayIso();
  // Ended two days ago: its retro window is open, so the picker names it.
  const S1: Sprint = {
    id: "s1",
    name: "Sprint 12",
    startDate: addDays(TODAY, -15),
    endDate: addDays(TODAY, -2),
    pointsPlanned: 0,
    status: "active",
  };
  const story = (id: string, points: number, status: Story["status"]): Story => ({
    id,
    title: id,
    points,
    status,
    sprintId: "s1",
  });
  const missedGoal = {
    id: goalDocId("s1"),
    businessObjective: "",
    goal: "Ship sign-in",
    criteria: [],
    keyResults: [],
    sprintId: "s1",
    outcome: { met: "not-met" as const, decidedAt: TODAY },
  };

  it("marks the format the sprint's facts call for, with the reason, and picks nothing", () => {
    useWorkspaceStore.setState({ sprints: [S1], sprintGoals: [missedGoal] });
    render(<RetroClient />);
    expect(
      screen.getByText(
        "Sprint 12 didn't meet its goal: look at what held it back and what lies ahead."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Suggested for this sprint: Sailboat.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sailboat" })).toHaveAccessibleDescription(
      /^Suggested for this sprint/
    );
    expect(screen.getAllByText("Suggested for this sprint")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Start / Stop / Continue" })
    ).not.toHaveAccessibleDescription(/Suggested/);
    // A hint only: no board until someone picks.
    expect(current()).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Mad / Sad / Glad" }));
    expect(current()?.format.id).toBe("mad-sad-glad");
  });

  it("follows the sprint picked under Retro for, and says nothing without one", () => {
    useWorkspaceStore.setState({
      sprints: [S1],
      stories: [story("a", 5, "done"), story("b", 8, "in_progress"), story("c", 7, "todo")],
    });
    render(<RetroClient />);
    expect(screen.getByText("Suggested for this sprint: DAKI.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sprint 12 left 15 of 20 committed points unfinished: agree what to drop, add, keep and improve."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(screen.queryByText(/Suggested for this sprint/)).toBeNull();
  });

  it("calls no running sprint's open work unfinished", () => {
    // Sprint 12's retro is under Past retros, so the picker names Sprint 13,
    // which started yesterday: all its stories are still to do.
    const S2: Sprint = {
      id: "s2",
      name: "Sprint 13",
      startDate: addDays(TODAY, -1),
      endDate: addDays(TODAY, 12),
      pointsPlanned: 0,
      status: "active",
    };
    const archived = {
      ...blankRetroBoard(retroFormats[0], { sprintId: "s1" }),
      id: "retro:archived-12",
      archivedAt: new Date(Date.now() - 3_600_000).toISOString(),
      cards: [
        {
          id: "k1",
          columnKey: "start",
          text: "Pair on reviews",
          votes: 0,
          groupedWith: null,
          isActionItem: false,
          assignee: "",
          discussing: false,
        },
      ],
    };
    useWorkspaceStore.setState({
      sprints: [S1, S2],
      retroBoards: [archived],
      stories: [
        { ...story("a", 8, "todo"), sprintId: "s2" },
        { ...story("b", 12, "todo"), sprintId: "s2" },
      ],
    });
    render(<RetroClient />);
    expect(screen.getByRole("combobox", { name: "Retro for" })).toHaveTextContent("Sprint 13");
    expect(screen.queryByText(/Suggested for this sprint/)).toBeNull();
  });
});
