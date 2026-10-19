import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { HistoryLogger } from "@/lib/history/use-history-logger";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";

/**
 * Retro cards after adding: click (or Enter) on the text to edit it, Enter
 * saves, Escape cancels, an emptied card reverts. A pasted list adds one
 * card per line. Delete offers Undo. A room participant gets no edit
 * control; a member promoted to host does.
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
import { ParticipantBoard } from "@/app/(tools)/retro/room/participant-board";

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
    cards: [card("a", "start"), card("b", "start"), card("c", "stop")],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...overrides,
  };
}

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

const texts = () => latest.cards.map((c) => c.text);

function paste(el: HTMLElement, text: string) {
  fireEvent.paste(el, { clipboardData: { getData: () => text } });
}

beforeEach(() => {
  undo.last = null;
  toasts.info = [];
});

describe("Retro: editing a card", () => {
  it("saves on Enter, through the board's updater, and hands focus back", () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: "Card a" }));

    const box = screen.getByRole("textbox", { name: "Card text" });
    expect(box).toHaveFocus();
    expect(box).toHaveValue("Card a");
    fireEvent.change(box, { target: { value: "  Ship smaller PRs  " } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(texts()).toEqual(["Ship smaller PRs", "Card b", "Card c"]);
    expect(screen.queryByRole("textbox", { name: "Card text" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ship smaller PRs" })).toHaveFocus();
    // The card keeps everything else.
    expect(latest.cards[0]).toMatchObject({ id: "a", columnKey: "start", votes: 0 });
  });

  it("Escape cancels and leaves the card as it was", () => {
    const initial = makeBoard();
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Card b" }));
    const box = screen.getByRole("textbox", { name: "Card text" });
    fireEvent.change(box, { target: { value: "Something else" } });
    fireEvent.keyDown(box, { key: "Escape" });

    expect(latest.cards).toBe(initial.cards);
    expect(screen.getByRole("button", { name: "Card b" })).toHaveFocus();
  });

  it("an emptied card reverts instead of being wiped", () => {
    const initial = makeBoard();
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Card c" }));
    const box = screen.getByRole("textbox", { name: "Card text" });
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(latest.cards).toBe(initial.cards);
    expect(screen.getByRole("button", { name: "Card c" })).toBeInTheDocument();
  });

  it("clicking away saves, and pasted line breaks become spaces", () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: "Card a" }));
    const box = screen.getByRole("textbox", { name: "Card text" });
    fireEvent.change(box, { target: { value: "Two\nlines" } });
    fireEvent.blur(box);
    expect(texts()[0]).toBe("Two lines");
  });

  it("the Save and Cancel buttons work too", () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: "Card a" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Card text" }), {
      target: { value: "Saved by button" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(texts()[0]).toBe("Saved by button");

    fireEvent.click(screen.getByRole("button", { name: "Saved by button" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Card text" }), {
      target: { value: "Not kept" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(texts()[0]).toBe("Saved by button");
  });

  it("in Discuss, a click focuses the card and the Edit button edits it", () => {
    render(<Harness initial={makeBoard({ phase: "discuss" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Card a" }));
    expect(latest.cards[0].discussing).toBe(true);
    expect(screen.queryByRole("textbox", { name: "Card text" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit card" })[0]);
    const box = screen.getByRole("textbox", { name: "Card text" });
    fireEvent.change(box, { target: { value: "Reworded in Discuss" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(texts()[0]).toBe("Reworded in Discuss");
  });
});

describe("Retro: adding cards", () => {
  it("Enter adds and the box keeps focus for the next card", () => {
    render(<Harness initial={makeBoard({ cards: [] })} />);
    const input = screen.getByRole("textbox", { name: "New card for Start" });
    input.focus();
    fireEvent.change(input, { target: { value: "Pair more" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(texts()).toEqual(["Pair more"]);
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("a pasted list adds one card per non-empty line", () => {
    render(<Harness initial={makeBoard({ cards: [card("a", "start")] })} />);
    const input = screen.getByRole("textbox", { name: "New card for Stop" });
    paste(input, "- Late standups\n\n* Long meetings\nScope creep\n");

    expect(latest.cards.map((c) => [c.columnKey, c.text])).toEqual([
      ["start", "Card a"],
      ["stop", "Late standups"],
      ["stop", "Long meetings"],
      ["stop", "Scope creep"],
    ]);
    expect(new Set(latest.cards.map((c) => c.id)).size).toBe(4);
    expect(toasts.info).toEqual([]);
    expect(input).toHaveFocus();
  });

  it("caps a long paste at 30 cards and says how many lines were left out", () => {
    render(<Harness initial={makeBoard({ cards: [] })} />);
    const lines = Array.from({ length: 33 }, (_, i) => `Idea ${i + 1}`).join("\n");
    paste(screen.getByRole("textbox", { name: "New card for Start" }), lines);

    expect(latest.cards).toHaveLength(30);
    expect(texts().at(-1)).toBe("Idea 30");
    expect(toasts.info).toEqual([
      "Added 30 cards. 3 more lines were left out. One paste adds up to 30.",
    ]);
  });

  it("a one-line paste is left to the input", () => {
    render(<Harness initial={makeBoard({ cards: [] })} />);
    paste(screen.getByRole("textbox", { name: "New card for Start" }), "Just one");
    expect(latest.cards).toEqual([]);
  });
});

describe("Retro: delete and Undo", () => {
  it("removes the card and Undo puts it back in its place", () => {
    const initial = makeBoard();
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete card" })[1]);
    expect(texts()).toEqual(["Card a", "Card c"]);
    expect(undo.last!.label).toBe("Deleted “Card b”");

    act(() => undo.last!.revert());
    expect(latest.cards).toEqual(initial.cards);
  });
});

describe("Retro room: who can edit", () => {
  const board = makeBoard();

  it("a participant sees the cards read-only: no edit control", () => {
    render(
      <ParticipantBoard board={board} votesLeft={3} canAct onAdd={() => {}} onVote={() => {}} />
    );
    expect(screen.getByText("Card a").tagName).toBe("P");
    expect(screen.queryByRole("button", { name: "Card a" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit card" })).toBeNull();
    fireEvent.click(screen.getByText("Card a"));
    expect(screen.queryByRole("textbox", { name: "Card text" })).toBeNull();
  });

  it("a participant gets no Edit button in Discuss either", () => {
    render(
      <ParticipantBoard
        board={makeBoard({ phase: "discuss" })}
        votesLeft={3}
        canAct
        onAdd={() => {}}
        onVote={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: "Edit card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Card a" })).toBeNull();
  });

  it("a promoted host can edit, through the room", () => {
    const onEdit = vi.fn();
    render(
      <ParticipantBoard
        board={board}
        votesLeft={3}
        canAct
        onAdd={() => {}}
        onVote={() => {}}
        onEdit={onEdit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Card a" }));
    const box = screen.getByRole("textbox", { name: "Card text" });
    // The room's 500-character limit applies to edits too.
    expect(box).toHaveAttribute("maxLength", "500");
    fireEvent.change(box, { target: { value: "Fixed typo" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledWith("a", "Fixed typo");
  });

  it("a participant's paste is capped at 10 cards, one intent each", () => {
    const onAdd = vi.fn();
    render(<ParticipantBoard board={board} votesLeft={3} canAct onAdd={onAdd} onVote={() => {}} />);
    const lines = Array.from({ length: 12 }, (_, i) => `Note ${i + 1}`).join("\n");
    paste(screen.getByRole("textbox", { name: "New card for Start" }), lines);
    expect(onAdd).toHaveBeenCalledTimes(10);
    expect(onAdd).toHaveBeenLastCalledWith("start", "Note 10");
    expect(toasts.info).toEqual([
      "Added 10 cards. 2 more lines were left out. One paste adds up to 10.",
    ]);
  });
});
