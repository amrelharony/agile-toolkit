import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { HistoryLogger } from "@/lib/history/use-history-logger";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";

/**
 * Retro facilitator mode, for one shared screen: "Voting as" gives each
 * person their own vote budget ("Me" keeps the single one), the facilitator
 * can step back a phase without losing votes, cards can be added in any
 * phase, and the resets clear everyone's votes.
 */

const announced = vi.hoisted(() => [] as string[]);
const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/components/a11y/live-announcer", () => ({
  useAnnounce: () => (message: string) => announced.push(message),
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

import { Board } from "@/app/(tools)/retro/components/board";
import { RetroClient } from "@/app/(tools)/retro/retro-client";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const logger: HistoryLogger = { log: () => {}, toolRunId: "test-run" };
const format = retroFormats[0]; // Start / Stop / Continue

function card(id: string, columnKey: string, overrides: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey,
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...overrides,
  };
}

function makeBoard(overrides: Partial<BoardState> = {}): BoardState {
  return {
    format,
    phase: "vote",
    cards: [card("a", "start"), card("b", "stop")],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...overrides,
  };
}

// The board as the harness last rendered it.
let latest: BoardState;

function Harness({ initial }: { initial: BoardState }) {
  const [state, setState] = useState(initial);
  latest = state;
  return (
    <Board
      state={state}
      onUpdate={(updater) => setState((prev) => updater(prev))}
      onReset={() => {}}
      logger={logger}
    />
  );
}

function setRoster(...names: string[]) {
  useWorkspaceStore.setState({
    teamMembers: names.map((name, i) => ({ id: `m${i}`, name })),
  });
}

const picker = () => screen.getByRole("radiogroup", { name: "Voting as" });
const voteButtons = () => screen.getAllByRole("button", { name: /vote for this card/ });

beforeEach(() => {
  announced.length = 0;
  undo.last = null;
  useWorkspaceStore.setState({ teamMembers: [], retroBoards: [] });
});

describe("Voting as", () => {
  it("gives each person an independent budget and shows what each has left", () => {
    setRoster("Priya", "Sam");
    render(<Harness initial={makeBoard()} />);

    const group = picker();
    expect(within(group).getByRole("radio", { name: "Me (single voter)" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(within(group).getByRole("radio", { name: "Priya · 3 left" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Sam · 3 left" })).toBeInTheDocument();
    // A roster means no typing names in.
    expect(screen.queryByLabelText("Add a voter")).toBeNull();

    fireEvent.click(within(group).getByRole("radio", { name: "Priya · 3 left" }));
    expect(screen.getByText("3 votes remaining for Priya")).toBeInTheDocument();

    for (let i = 0; i < 3; i++) fireEvent.click(voteButtons()[0]);
    expect(within(picker()).getByRole("radio", { name: "Priya · 0 left" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByText("0 votes remaining for Priya")).toBeInTheDocument();
    expect(announced).toContain("Priya has used all 3 votes.");
    for (const button of voteButtons()) expect(button).toBeDisabled();
    // A fourth vote for Priya does nothing.
    fireEvent.click(voteButtons()[1]);
    expect(latest.cards.find((c) => c.id === "b")!.votes).toBe(0);

    // Sam still has all three, and the card totals add up across people.
    fireEvent.click(within(picker()).getByRole("radio", { name: "Sam · 3 left" }));
    expect(screen.getByText("3 votes remaining for Sam")).toBeInTheDocument();
    fireEvent.click(voteButtons()[0]);
    fireEvent.click(voteButtons()[1]);
    expect(within(picker()).getByRole("radio", { name: "Sam · 1 left" })).toBeInTheDocument();
    expect(within(picker()).getByRole("radio", { name: "Priya · 0 left" })).toBeInTheDocument();

    expect(latest.votesBy).toEqual({ Priya: 3, Sam: 2 });
    expect(latest.cards.map((c) => c.votes)).toEqual([4, 1]);
    // Per-person votes don't touch the single-voter budget.
    expect(latest.userVotes).toBe(0);
    expect(within(picker()).getByRole("radio", { name: "Me (single voter)" })).toBeInTheDocument();
  });

  it("lets the facilitator type voters in when there is no roster", () => {
    render(<Harness initial={makeBoard()} />);

    expect(screen.getByRole("link", { name: "set up your team" })).toHaveAttribute("href", "/team");
    fireEvent.change(screen.getByLabelText("Add a voter"), { target: { value: "  Alex " } });
    fireEvent.click(screen.getByRole("button", { name: "Add voter" }));

    // Added, picked, and kept on the board so the name survives a reload.
    expect(within(picker()).getByRole("radio", { name: "Alex · 3 left" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(latest.votesBy).toEqual({ Alex: 0 });

    fireEvent.click(voteButtons()[1]);
    expect(within(picker()).getByRole("radio", { name: "Alex · 2 left" })).toBeInTheDocument();
    expect(latest.votesBy).toEqual({ Alex: 1 });

    // The same name again (any case) picks Alex instead of adding a twin.
    fireEvent.click(within(picker()).getByRole("radio", { name: "Me (single voter)" }));
    fireEvent.change(screen.getByLabelText("Add a voter"), { target: { value: "alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Add voter" }));
    expect(within(picker()).getAllByRole("radio")).toHaveLength(2);
    expect(within(picker()).getByRole("radio", { name: "Alex · 2 left" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(latest.votesBy).toEqual({ Alex: 1 });
  });

  it("keeps today's single budget in Me mode", () => {
    setRoster("Priya");
    render(<Harness initial={makeBoard()} />);

    expect(screen.getByText("3 votes remaining")).toBeInTheDocument();
    for (let i = 0; i < 3; i++) fireEvent.click(voteButtons()[0]);

    expect(screen.getByText("0 votes remaining")).toBeInTheDocument();
    expect(latest.userVotes).toBe(3);
    expect(latest.votesBy).toBeUndefined();
    expect(latest.cards[0].votes).toBe(3);
    expect(announced).toContain("You have used all 3 votes.");
    for (const button of voteButtons()) expect(button).toBeDisabled();
    // Priya's budget is untouched.
    expect(within(picker()).getByRole("radio", { name: "Priya · 3 left" })).toBeInTheDocument();
  });

  it("only shows in the Vote phase", () => {
    setRoster("Priya");
    render(<Harness initial={makeBoard({ phase: "discuss" })} />);
    expect(screen.queryByRole("radiogroup", { name: "Voting as" })).toBeNull();
  });
});

describe("Previous phase", () => {
  it("steps back from Vote to Write and keeps everyone's votes", () => {
    setRoster("Priya");
    const initial = makeBoard({
      userVotes: 1,
      votesBy: { Priya: 2 },
      cards: [card("a", "start", { votes: 2 }), card("b", "stop", { votes: 1 })],
    });
    render(<Harness initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: /Previous phase/ }));
    expect(latest.phase).toBe("write");
    expect(latest.cards).toEqual(initial.cards);
    expect(latest).toMatchObject({ userVotes: 1, votesBy: { Priya: 2 } });
    expect(screen.getByText("Votes cast so far are kept.")).toBeInTheDocument();
    expect(announced).toContain("Back to the Write phase. Votes cast so far are kept.");
    // Write is the first phase: nothing to go back to.
    expect(screen.queryByRole("button", { name: /Previous phase/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Next Phase/ }));
    expect(latest.phase).toBe("vote");
    expect(announced).toContain("Vote phase. Vote on cards (max 3).");
    expect(screen.getByText("2 votes remaining")).toBeInTheDocument();
    expect(within(picker()).getByRole("radio", { name: "Priya · 1 left" })).toBeInTheDocument();
  });

  it("steps back from Actions to Discuss", () => {
    render(<Harness initial={makeBoard({ phase: "actions" })} />);
    expect(screen.queryByRole("button", { name: /Next Phase/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Previous phase/ }));
    expect(latest.phase).toBe("discuss");
    expect(announced).toContain("Back to the Discuss phase.");
  });
});

describe("Add a card after Write", () => {
  it("adds a late card in the Discuss phase", () => {
    render(<Harness initial={makeBoard({ phase: "discuss" })} />);
    // Collapsed by default, one button per column.
    expect(screen.queryAllByPlaceholderText("Add a card…")).toHaveLength(0);

    const toggle = screen.getByRole("button", { name: "Add a card to Start" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const input = screen.getByRole("textbox", { name: "New card for Start" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Late idea: pair on reviews" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("Late idea: pair on reviews")).toBeInTheDocument();
    const added = latest.cards.find((c) => c.text === "Late idea: pair on reviews");
    expect(added).toMatchObject({ columnKey: "start", votes: 0, groupedWith: null });
    expect(latest.phase).toBe("discuss");

    // Escape closes it and puts focus back on the button.
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New card for Start" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("textbox", { name: "New card for Start" })).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it("keeps the Write phase's always-open inputs", () => {
    render(<Harness initial={makeBoard({ phase: "write" })} />);
    expect(screen.getAllByPlaceholderText("Add a card…")).toHaveLength(format.columns.length);
    expect(screen.queryByRole("button", { name: /^Add a card to/ })).toBeNull();
  });
});

describe("Resets clear votesBy", () => {
  it("Clear Board drops everyone's votes, and Undo brings them back", () => {
    setRoster("Priya");
    const initial = makeBoard({
      userVotes: 1,
      votesBy: { Priya: 2, Alex: 0 },
      cards: [card("a", "start", { votes: 3 })],
    });
    render(<Harness initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: /Clear Board/ }));
    const dialog = screen.getByRole("dialog", { name: "Clear all cards?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear board" }));

    expect("votesBy" in latest).toBe(false);
    expect(latest).toMatchObject({ userVotes: 0, phase: "write", cards: [] });

    act(() => undo.last!.revert());
    expect(latest).toMatchObject({ userVotes: 1, phase: "vote", votesBy: { Priya: 2, Alex: 0 } });
    expect(within(picker()).getByRole("radio", { name: "Priya · 1 left" })).toBeInTheDocument();
    expect(within(picker()).getByRole("radio", { name: "Alex · 3 left" })).toBeInTheDocument();
  });

  it("a new retro starts with no per-person votes", () => {
    useWorkspaceStore.setState({
      retroBoards: [
        {
          id: "retro:current",
          ...makeBoard({ votesBy: { Priya: 3 }, cards: [card("a", "start", { votes: 3 })] }),
        },
      ],
    });
    render(<RetroClient />);

    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));
    const dialog = screen.getByRole("dialog", { name: "Start a new retro?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start new retro" }));
    fireEvent.click(screen.getByRole("button", { name: format.name }));

    const current = (useWorkspaceStore.getState().retroBoards ?? []).find(
      (b) => b.id === "retro:current"
    );
    expect(current).toBeDefined();
    expect(current!.votesBy).toBeUndefined();
    expect(current!.userVotes).toBe(0);
  });
});
