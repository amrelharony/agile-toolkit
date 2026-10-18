import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { HistoryLogger } from "@/lib/history/use-history-logger";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";

/**
 * Retro board: deleting a card offers Undo (its grouped cards come back
 * with it), and a confirmed Clear Board can be undone too.
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
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
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
    cards: [card("a", "start"), card("b", "start", { groupedWith: "a" }), card("c", "stop")],
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

beforeEach(() => {
  undo.last = null;
});

describe("Retro card delete", () => {
  it("removes the card and its group, and Undo brings both back grouped", () => {
    const initial = makeBoard();
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete card" })[0]);

    // "Card a" also showed as b's group in b's "Group with" picker.
    expect(screen.queryAllByText("Card a")).toHaveLength(0);
    expect(screen.queryAllByText("Card b")).toHaveLength(0);
    expect(latest.cards.map((c) => c.id)).toEqual(["c"]);
    expect(undo.last!.label).toBe("Deleted “Card a”");

    act(() => undo.last!.revert());
    // Back in place, with b still grouped under a.
    expect(latest.cards).toEqual(initial.cards);
    expect(screen.getAllByRole("button", { name: "Delete card" })).toHaveLength(3);
  });
});

describe("Retro Clear Board undo", () => {
  it("restores the cards, votes and phase", () => {
    const initial = makeBoard({ phase: "vote", userVotes: 2 });
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear Board/ }));
    const dialog = screen.getByRole("dialog", { name: "Clear all cards?" });
    expect(dialog).toHaveTextContent(/3 cards/);
    expect(dialog).not.toHaveTextContent(/can't be undone/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear board" }));

    expect(screen.queryByText("Card a")).toBeNull();
    expect(undo.last!.label).toBe("Cleared 3 cards");

    act(() => undo.last!.revert());
    expect(latest.cards).toEqual(initial.cards);
    expect(latest).toMatchObject({ phase: "vote", userVotes: 2 });
    expect(screen.getByText("1 votes remaining")).toBeInTheDocument();
  });
});
