import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { FacilitatorTally } from "@/components/collab/vote-room/facilitator-tally";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { QUESTIONNAIRE } from "../realtime/vote-room-fixtures";

/**
 * Counted hands or paper, entered by the facilitator: the same totals, the
 * same minN rule and the same onSave as a live round.
 */

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

function setup(minN = 3, onSave = vi.fn<(r: VoteRoundResult) => void | (() => void)>()) {
  render(
    <FacilitatorTally
      tool="health-check"
      questionnaire={QUESTIONNAIRE}
      minN={minN}
      onSave={onSave}
    />
  );
  const box = (question: RegExp, point: string) =>
    within(screen.getByRole("group", { name: question })).getByLabelText(point);
  const type = (question: RegExp, point: string, value: string) =>
    fireEvent.change(box(question, point), { target: { value } });
  const show = () => fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
  return { onSave, box, type, show };
}

describe("FacilitatorTally", () => {
  it("starts blank: nothing is counted for anyone", () => {
    const { box } = setup();
    expect(box(/Fun/, "Green")).toHaveValue(null);
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });

  it("refuses counts that aren't whole numbers, inline, with focus on the first", () => {
    const { type, show, box } = setup();
    type(/Fun/, "Green", "2.5");
    type(/Speed/, "Red", "-1");
    show();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Enter a whole number, 0 or more.",
      "Enter a whole number, 0 or more.",
    ]);
    expect(box(/Fun/, "Green")).toHaveFocus();
    expect(box(/Fun/, "Green")).toHaveAttribute("aria-invalid", "true");
  });

  it("applies the minN rule before showing anything", () => {
    const { type, show } = setup(5);
    type(/Fun/, "Green", "2");
    type(/Fun/, "Red", "2");
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Results show from 5 answers, so small groups' answers stay hidden. You've entered 4."
    );
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });

  it("needs 5 answers for Psych Safety even when no minN is passed", () => {
    const onSave = vi.fn();
    render(<FacilitatorTally tool="psych-safety" questionnaire={QUESTIONNAIRE} onSave={onSave} />);
    const box = (q: RegExp, p: string) =>
      within(screen.getByRole("group", { name: q })).getByLabelText(p);
    fireEvent.change(box(/Fun/, "Green"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Results show from 5 answers/);
    fireEvent.change(box(/Fun/, "Green"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ tool: "psych-safety", minN: 5 });
  });

  it("says 'At most 999' for a count over the cap", () => {
    const { type, show } = setup();
    type(/Fun/, "Green", "1000");
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("At most 999.");
  });

  it("refuses text a number box can't read instead of counting it as nobody", () => {
    const { type, show, box, onSave } = setup();
    type(/Fun/, "Green", "3");
    type(/Speed/, "Green", "3");
    // A browser reports "5a" or "1e" in a number box as "" with validity.badInput.
    Object.defineProperty(box(/Speed/, "Red"), "validity", {
      configurable: true,
      value: { badInput: true },
    });
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a whole number, 0 or more.");
    expect(box(/Speed/, "Red")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("locks a saved round's counts, so an edit can't become a second saved round", () => {
    const { type, show, box, onSave } = setup();
    type(/Fun/, "Green", "3");
    type(/Speed/, "Green", "3");
    show();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(box(/Fun/, "Green")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Show totals" })).toBeNull();
    type(/Fun/, "Green", "4");
    expect(screen.getByRole("button", { name: "Round saved" })).toBeDisabled();
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Enter another round" }));
    expect(box(/Fun/, "Green")).toBeEnabled();
    expect(box(/Fun/, "Green")).toHaveValue(null);
  });

  it("shows the totals, withholds thin questions, and saves once with source 'facilitator'", () => {
    const { type, show, onSave } = setup();
    type(/Fun/, "Green", "3");
    type(/Fun/, "Yellow", "1");
    type(/Speed/, "Red", "4");
    type(/Learning/, "Green", "2");
    show();
    expect(
      screen.getByText(
        "4 people answered; 2 of 3 questions have enough answers to show (3 or more)."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    fireEvent.click(screen.getByRole("button", { name: "Round saved" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const r = onSave.mock.calls[0][0];
    expect(r).toMatchObject({
      tool: "health-check",
      source: "facilitator",
      ballots: 4,
      minN: 3,
      questions: [
        { id: "fun", responses: 4, distribution: [3, 1, 0] },
        { id: "speed", responses: 4, distribution: [0, 0, 4] },
        { id: "learning", responses: 2, distribution: null },
      ],
    });
    // Another round can be entered afterwards.
    fireEvent.click(screen.getByRole("button", { name: "Enter another round" }));
    expect(screen.queryByRole("button", { name: /Save round|Round saved/ })).toBeNull();
  });

  it("offers Undo when the tool returns one, and lets the round be saved again after it", () => {
    toastMock.mockClear();
    const undo = vi.fn();
    const { type, show, box, onSave } = setup(
      3,
      vi.fn(() => undo)
    );
    type(/Fun/, "Green", "3");
    type(/Speed/, "Green", "3");
    show();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      "Saved the round",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) })
    );
    const action = (toastMock.mock.calls[0][1] as { action: { onClick: () => void } }).action;
    act(() => action.onClick());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save round" })).toBeEnabled();
    expect(box(/Fun/, "Green")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("hides stale totals when a count changes", () => {
    const { type, show } = setup();
    type(/Fun/, "Green", "3");
    type(/Speed/, "Green", "3");
    show();
    expect(screen.getByRole("button", { name: "Save round" })).toBeInTheDocument();
    type(/Fun/, "Green", "4");
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });
});
