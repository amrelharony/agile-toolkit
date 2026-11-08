import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { BoardPhase, RetroCard } from "@/app/(tools)/retro/types";

/**
 * Retro card controls on phones: the vote heart, Delete and the Discuss-phase
 * Edit pencil get a 44×44 hit area on coarse pointers (min-touch-coarse) while
 * the glyph and the row height stay as they were (the negative margin hands
 * the extra height to the card's padding). Desktop sizes are untouched.
 */

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

import { RetroCardItem } from "@/app/(tools)/retro/components/retro-card-item";

const format = retroFormats[0];
const column = format.columns[0];

function card(id: string, overrides: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey: column.key,
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...overrides,
  };
}

function renderCard(
  phase: BoardPhase,
  handlers: { onVote?: () => void; onDelete?: () => void } = {}
) {
  const a = card("a");
  const cards = [a, card("b")];
  return render(
    <RetroCardItem
      card={a}
      allCards={cards}
      column={column}
      phase={phase}
      canVote
      onVote={handlers.onVote ?? vi.fn()}
      onDelete={handlers.onDelete ?? vi.fn()}
      onGroup={vi.fn()}
      onToggleAction={vi.fn()}
      onAssigneeChange={vi.fn()}
      onToggleDiscussing={vi.fn()}
      onEdit={vi.fn()}
    />
  );
}

/** Any utility min-height/min-width (min-h-6, md:min-h-0, …) outranks min-touch-coarse. */
const UTILITY_MIN = /(?:^|\s)(?:[\w-]+:)*min-[hw]-/;

function expectTouchSized(button: HTMLElement) {
  expect(button).toHaveClass(
    "min-touch-coarse",
    "pointer-coarse:-my-3",
    "inline-flex",
    "items-center",
    "justify-center"
  );
  expect(button.className).not.toMatch(UTILITY_MIN);
}

describe("Retro card controls: touch sizing", () => {
  it("the vote heart gets a 44px touch area in Vote and still votes", () => {
    const onVote = vi.fn();
    renderCard("vote", { onVote });
    const vote = screen.getByRole("button", { name: /vote for this card/ });
    expectTouchSized(vote);
    // The visible pill keeps its desktop padding.
    expect(vote).toHaveClass("px-1.5", "py-0.5");
    fireEvent.click(vote);
    expect(onVote).toHaveBeenCalledWith("a");
  });

  it("Delete gets a 44px touch area in Write and still deletes", () => {
    const onDelete = vi.fn();
    renderCard("write", { onDelete });
    const del = screen.getByRole("button", { name: "Delete card" });
    expectTouchSized(del);
    expect(del).toHaveClass("p-1");
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledWith("a");
  });

  it("in Discuss, Edit and vote both get a 44px touch area; Edit stays 24px on desktop", () => {
    renderCard("discuss");
    const edit = screen.getByRole("button", { name: "Edit card" });
    expectTouchSized(edit);
    expect(edit).toHaveClass("h-6", "w-6", "relative", "z-10");
    // Still sounds and ticks like the ghost Button it was (sonification + haptics routers).
    expect(edit).toHaveAttribute("data-variant", "ghost");
    expect(edit).toHaveAttribute("data-haptic", "tick");
    expectTouchSized(screen.getByRole("button", { name: /vote for this card/ }));

    fireEvent.click(edit);
    expect(screen.getByRole("textbox", { name: "Card text" })).toBeInTheDocument();
  });
});
