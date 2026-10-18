import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { HistoryLogger } from "@/lib/history/use-history-logger";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";

/**
 * Retro board safety + keyboard access: the two resets that discard cards
 * confirm first (but not on an empty board), and the format picker and
 * icon-only controls are real, named buttons.
 */

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
import { FormatSelector } from "@/app/(tools)/retro/components/format-selector";
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
    phase: "write",
    cards: [card("a", "start"), card("b", "stop")],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...overrides,
  };
}

function Harness({ initial, onReset = () => {} }: { initial: BoardState; onReset?: () => void }) {
  const [state, setState] = useState(initial);
  return (
    <Board
      state={state}
      onUpdate={(updater) => setState((prev) => updater(prev))}
      onReset={onReset}
      logger={logger}
    />
  );
}

describe("New Retro", () => {
  it("confirms before discarding a board that has cards", () => {
    const onReset = vi.fn();
    render(<Harness initial={makeBoard()} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));
    expect(onReset).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Start a new retro?" });
    expect(dialog).toHaveTextContent(/2 cards/);
    expect(dialog).toHaveTextContent(/move to Past retros/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Start new retro" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the confirmation is cancelled", () => {
    const onReset = vi.fn();
    render(<Harness initial={makeBoard()} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onReset).not.toHaveBeenCalled();
  });

  it("resets an empty board straight away", () => {
    const onReset = vi.fn();
    render(<Harness initial={makeBoard({ cards: [] })} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Clear Board", () => {
  it("confirms before removing every card", () => {
    render(<Harness initial={makeBoard({ phase: "vote", userVotes: 2 })} />);
    expect(screen.getByText("Card a")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear Board/ }));
    // Nothing is cleared until the user confirms.
    expect(screen.getByText("Card a")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Clear all cards?" });
    expect(dialog).toHaveTextContent(/2 cards/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear board" }));
    expect(screen.queryByText("Card a")).toBeNull();
    expect(screen.queryByText("Card b")).toBeNull();
    // Back to the Write phase, where the add-card inputs live.
    expect(screen.getAllByPlaceholderText("Add a card…")).toHaveLength(format.columns.length);
  });

  it("clears an empty board straight away", () => {
    render(<Harness initial={makeBoard({ cards: [], phase: "vote" })} />);

    fireEvent.click(screen.getByRole("button", { name: /Clear Board/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByPlaceholderText("Add a card…")).toHaveLength(format.columns.length);
  });
});

describe("board controls", () => {
  it("names each column's add-card button", () => {
    render(<Harness initial={makeBoard()} />);
    for (const col of format.columns) {
      expect(screen.getByRole("button", { name: `Add card to ${col.label}` })).toBeInTheDocument();
    }
  });

  it("exposes the action-item toggle as a named, pressed-state button", () => {
    render(<Harness initial={makeBoard({ phase: "actions", cards: [card("a", "start")] })} />);
    const toggle = screen.getByRole("button", { name: "Action item" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Action item" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

describe("FormatSelector", () => {
  it("renders every format as a button named after it", () => {
    const onSelect = vi.fn();
    render(<FormatSelector onSelect={onSelect} />);

    for (const fmt of retroFormats) {
      const button = screen.getByRole("button", { name: fmt.name });
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
    }

    const last = retroFormats[retroFormats.length - 1];
    fireEvent.click(screen.getByRole("button", { name: last.name }));
    expect(onSelect).toHaveBeenCalledWith(last);
  });
});

describe("Past retros", () => {
  it("New Retro keeps the finished board and its actions under Past retros", () => {
    const actionCard = card("b", "stop", {
      text: "Fix the flaky CI job",
      isActionItem: true,
      assignee: "Sam",
    });
    useWorkspaceStore.setState({
      retroBoards: [
        { id: "retro:current", ...makeBoard({ cards: [card("a", "start"), actionCard] }) },
      ],
    });
    render(<RetroClient />);

    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));
    const dialog = screen.getByRole("dialog", { name: "Start a new retro?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start new retro" }));

    const boards = useWorkspaceStore.getState().retroBoards ?? [];
    expect(boards.find((b) => b.id === "retro:current")).toBeUndefined();
    expect(boards.filter((b) => b.archivedAt)).toHaveLength(1);

    const past = screen.getByRole("region", { name: "Past retros" });
    expect(within(past).getByText("Fix the flaky CI job")).toBeInTheDocument();
    expect(within(past).getByText(/Sam/)).toBeInTheDocument();
  });
});
