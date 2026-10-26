import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FacilitatorTally } from "@/components/collab/vote-room/facilitator-tally";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { QUESTIONNAIRE } from "../realtime/vote-room-fixtures";

/**
 * Counted hands or paper, entered by the facilitator: the same totals, the
 * same minN rule and the same onSave as a live round.
 */

function setup(minN = 3) {
  const onSave = vi.fn<(r: VoteRoundResult) => void>();
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
      "Results show from 5 answers, so nobody's answer can be picked out. You've entered 4."
    );
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
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
