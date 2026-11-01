import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { FacilitatorAllocation } from "@/components/collab/vote-room/facilitator-allocation";
import type { SaveAllocationRound } from "@/components/collab/vote-room/save-round";
import type { AllocationRoundResult } from "@/lib/realtime/vote-room/allocation";
import { ALLOCATION_SHEET, BUY_SHEET } from "../realtime/vote-room-fixtures";

/**
 * An allocation round without a live room: paper splits folded one by one
 * (only the totals kept, the last split undoable, the spread from 5), or
 * totals only (the spread unknown). Same minN rule and save as live.
 */

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

function setup(sheet = ALLOCATION_SHEET, onSave = vi.fn<SaveAllocationRound>()) {
  const renderResults = vi.fn((r: AllocationRoundResult) => <p>Preview of {r.ballots}</p>);
  render(
    <LiveAnnouncerProvider>
      <FacilitatorAllocation
        tool={sheet === BUY_SHEET ? "buy-a-feature" : "hundred-dollar-test"}
        sheet={sheet}
        onSave={onSave}
        renderResults={renderResults}
      />
    </LiveAnnouncerProvider>
  );
  const box = (name: RegExp) => screen.getByLabelText(name);
  const type = (name: RegExp, value: string) => fireEvent.change(box(name), { target: { value } });
  const add = () => fireEvent.click(screen.getByRole("button", { name: "Add split" }));
  const show = () => fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
  const split = (amounts: Record<string, string>) => {
    for (const [name, v] of Object.entries(amounts)) type(new RegExp(name), v);
    add();
  };
  return { onSave, renderResults, box, type, add, show, split };
}

const SPLITS: Record<string, string>[] = [
  { Search: "40", Exports: "30", "Single sign-on": "20", Themes: "10" },
  { Search: "100" },
  { Search: "25", Exports: "25", "Single sign-on": "25", Themes: "25" },
  { Exports: "50", "Single sign-on": "50" },
  { Search: "10", Exports: "20", "Single sign-on": "30", Themes: "40" },
];

describe("FacilitatorAllocation: paper splits", () => {
  it("starts blank, adds each split to the totals and clears it", () => {
    const { box, split } = setup();
    expect(box(/Search/)).toHaveValue(null);
    expect(screen.getByText("No splits added yet.")).toBeInTheDocument();
    split(SPLITS[0]);
    expect(screen.getByText("1 split added.")).toBeInTheDocument();
    expect(box(/Search/)).toHaveValue(null);
    expect(box(/Themes/)).toHaveValue(null);
  });

  it("refuses a split that breaks the sheet's rules, saying why", () => {
    const { split, type, add } = setup();
    split({ Search: "60" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A split gives out all $100: this one is $40 short."
    );
    type(/Exports/, "50");
    add();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This split gives $110, $10 more than $100."
    );
    expect(screen.getByText("No splits added yet.")).toBeInTheDocument();
  });

  it("puts a box's mistake on the box", () => {
    const { split, box } = setup(BUY_SHEET);
    split({ Exports: "31" });
    expect(screen.getByRole("alert")).toHaveTextContent("At most $30 on this one.");
    expect(box(/Exports/)).toHaveFocus();
    split({ Search: "2.5" });
    expect(box(/Search/)).toHaveAttribute("aria-invalid", "true");
  });

  it("names the budget, as the hint does, when a cap is above it", () => {
    const { split } = setup(BUY_SHEET);
    // Search's cap is $60, each player's budget $50: the hint and the error both say $50.
    expect(screen.getAllByText("At most $50.").length).toBeGreaterThan(0);
    split({ Search: "61" });
    expect(screen.getByRole("alert")).toHaveTextContent("At most $50 on this one.");
    expect(screen.queryByText(/At most \$60/)).toBeNull();
  });

  it("counts a split still in the boxes when Show totals is pressed", () => {
    const { split, type, show, onSave } = setup();
    split(SPLITS[0]);
    split(SPLITS[1]);
    for (const [name, v] of Object.entries(SPLITS[2])) type(new RegExp(name), v);
    show();
    expect(screen.getByText("3 splits added.")).toBeInTheDocument();
    expect(screen.getByText(/^3 people split \$100 each\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(onSave.mock.calls[0][0].ballots).toBe(3);
  });

  it("shows no totals while the split in the boxes can't be added, saying why", () => {
    const { split, type, show } = setup();
    for (const s of SPLITS.slice(0, 3)) split(s);
    type(/Search/, "60");
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A split gives out all $100: this one is $40 short."
    );
    expect(screen.getByText("3 splits added.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });

  it("won't show totals past a box the browser can't read, though React sees it blank", () => {
    const { split, show, box } = setup();
    for (const s of SPLITS.slice(0, 3)) split(s);
    // A browser reports "5a" in a number box as "" with validity.badInput.
    Object.defineProperty(box(/Exports/), "validity", {
      value: { badInput: true },
      configurable: true,
    });
    show();
    expect(box(/Exports/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });

  it("hides results once a box changes, so they can't be saved stale", () => {
    const { split, type, show } = setup();
    for (const s of SPLITS.slice(0, 3)) split(s);
    show();
    expect(screen.getByRole("button", { name: "Save round" })).toBeInTheDocument();
    type(/Search/, "50");
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });

  it("asks before switching to totals discards the splits, and keeps them on Cancel", () => {
    const { split } = setup();
    split(SPLITS[0]);
    split(SPLITS[1]);
    fireEvent.click(screen.getByRole("button", { name: "Totals only" }));
    const dialog = screen.getByRole("dialog", { name: "Switch to Totals only?" });
    expect(dialog).toHaveTextContent("The 2 splits added so far are discarded.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Paper splits" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("2 splits added.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Totals only" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByRole("button", { name: "Totals only" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByLabelText(/People who split the budget/)).toBeInTheDocument();
  });

  it("asks before switching back clears typed totals", () => {
    const { type } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Totals only" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    type(/Search/, "300");
    fireEvent.click(screen.getByRole("button", { name: "Paper splits" }));
    expect(screen.getByRole("dialog", { name: "Switch to Paper splits?" })).toHaveTextContent(
      "The totals typed so far are cleared."
    );
  });

  it("announces each split once: the counter isn't a live region", () => {
    vi.useFakeTimers();
    try {
      const { split } = setup();
      split(SPLITS[0]);
      expect(screen.getByText("1 split added.")).not.toHaveAttribute("role");
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Split 1 added. Its amounts are cleared; only the totals are kept."
      );
      expect(screen.queryAllByRole("status")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a sheet the counting can't use, saying why", () => {
    setup({ ...BUY_SHEET, budget: 6 });
    expect(
      screen.getByText(
        "These splits can't be counted: Each person's budget needs to be a whole number from 10 to 9,999."
      )
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });

  it("takes the last split out again with Undo last split", () => {
    const { split } = setup();
    split(SPLITS[0]);
    split(SPLITS[1]);
    expect(screen.getByText("2 splits added.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo last split" }));
    expect(screen.getByText("1 split added.")).toBeInTheDocument();
    // Only the one before the last is kept.
    expect(screen.getByRole("button", { name: "Undo last split" })).toBeDisabled();
  });

  it("applies the minN rule, shows the totals, and the spread only from 5", () => {
    const { split, show, renderResults } = setup();
    split(SPLITS[0]);
    split(SPLITS[1]);
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Results show from 3 people, so small groups' splits stay hidden. You've entered 2."
    );
    split(SPLITS[2]);
    show();
    expect(
      screen.getByText(/3 people split \$100 each\. Search got the most: \$165/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/It needed 2 more answers to see how the amounts were spread/)
    ).toBeInTheDocument();
    expect(renderResults).toHaveBeenCalled();
    expect(screen.getByText("Preview of 3")).toBeInTheDocument();
    split(SPLITS[3]);
    split(SPLITS[4]);
    show();
    expect(screen.getByText("How the amounts were spread")).toBeInTheDocument();
  });

  it("saves once with source 'facilitator', locks, and starts over on request", () => {
    const { split, show, onSave, box } = setup();
    for (const s of SPLITS) split(s);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const r = onSave.mock.calls[0][0];
    expect(r).toMatchObject({
      kind: "allocation",
      tool: "hundred-dollar-test",
      source: "facilitator",
      ballots: 5,
      minN: 3,
    });
    expect(r.items[0]).toEqual({
      id: "search",
      text: "Search",
      total: 175,
      backers: 4,
      bands: [1, 1, 1, 1, 1],
    });
    expect(box(/Search/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Round saved" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Enter another round" }));
    expect(box(/Search/)).toBeEnabled();
    expect(screen.getByText("No splits added yet.")).toBeInTheDocument();
  });

  it("offers Undo when the tool returns one, and keeps Save round when it refuses", () => {
    toastMock.mockClear();
    const undo = vi.fn();
    const onSave = vi.fn<SaveAllocationRound>(() => undo);
    const { split, show } = setup(ALLOCATION_SHEET, onSave);
    for (const s of SPLITS.slice(0, 3)) split(s);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    const action = (toastMock.mock.calls[0][1] as { action: { onClick: () => void } }).action;
    act(() => action.onClick());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save round" })).toBeEnabled();
    onSave.mockImplementation(() => false);
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(screen.getByRole("button", { name: "Save round" })).toBeEnabled();
  });
});

describe("FacilitatorAllocation: totals only", () => {
  function totalsMode(sheet = ALLOCATION_SHEET) {
    const s = setup(sheet);
    fireEvent.click(screen.getByRole("button", { name: "Totals only" }));
    expect(screen.getByRole("button", { name: "Totals only" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    return s;
  }

  it("takes each item's total and the people, and never shows a spread", () => {
    const { type, show, onSave } = totalsMode();
    type(/Search/, "300");
    type(/Exports/, "300");
    type(/Single sign-on/, "200");
    type(/Themes/, "200");
    type(/People who split the budget/, "10");
    show();
    expect(
      screen.getByText(
        "The totals were entered by hand, so how the amounts were spread isn't known."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    const r = onSave.mock.calls[0][0];
    expect(r.ballots).toBe(10);
    expect(r.spreadKnown).toBe(false);
    expect(r.items.every((x) => x.bands === null && x.backers === null)).toBe(true);
  });

  it("says the spread isn't known for 3 people too, not that it needed 5", () => {
    const { type, show } = totalsMode();
    type(/Search/, "300");
    type(/People who split the budget/, "3");
    show();
    expect(
      screen.getByText(
        "The totals were entered by hand, so how the amounts were spread isn't known."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/It needed/)).toBeNull();
  });

  it("hides results once the people change", () => {
    const { type, show } = totalsMode();
    type(/Search/, "300");
    type(/People who split the budget/, "3");
    show();
    expect(screen.getByRole("button", { name: "Save round" })).toBeInTheDocument();
    type(/People who split the budget/, "4");
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });

  it.each<[string, Record<string, string>, string]>([
    [
      "totals that don't add up to people × $100",
      { Search: "250", People: "3" },
      "Everyone gives out all $100, so the totals add up to $300 for 3 people. These add up to $250.",
    ],
    [
      "too few people",
      { Search: "200", People: "2" },
      "Results show from 3 people, so small groups' splits stay hidden. You've entered 2.",
    ],
  ])("refuses %s", (_label, values, message) => {
    const { type, show } = totalsMode();
    for (const [name, v] of Object.entries(values)) {
      type(name === "People" ? /People who split the budget/ : new RegExp(name), v);
    }
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });

  it("puts a total over people × cap on its box, and asks for the people", () => {
    const { type, show, box } = totalsMode(BUY_SHEET);
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter how many people split the budget: a whole number, 1 or more."
    );
    type(/People who split the budget/, "3");
    type(/Exports/, "91");
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("At most $90 from 3 people.");
    expect(box(/Exports/)).toHaveFocus();
  });
});
