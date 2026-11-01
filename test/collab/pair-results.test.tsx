import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  PAIR_CELL_MAX_FILL,
  PairResults,
  pairCellFill,
  pairResultsVerdict,
  pairSummary,
} from "@/components/collab/vote-room/pair-results";
import { jointIndex, type RevealedPair } from "@/lib/realtime/vote-room/pair";
import { PAIR_SHEET } from "../realtime/vote-room-fixtures";

/**
 * A revealed Kano round: per feature a 5 × 5 grid of answer pairs with a
 * summary and a table, "not enough answers" for a withheld feature, and
 * each question on its own in Advanced analysis.
 */

const joint = new Array<number>(25).fill(0);
joint[jointIndex(0, 4, 5)] = 4;
joint[jointIndex(1, 4, 5)] = 2;
joint[jointIndex(2, 2, 5)] = 1;

const REVEALED: RevealedPair[] = [
  { responses: 7, joint },
  { responses: 7, joint },
  { responses: 2, joint: null },
];

describe("PairResults", () => {
  it("summarises a feature by its most common pair, ties said as such", () => {
    expect(pairSummary(joint, PAIR_SHEET, 7)).toBe(
      "Most common pair: I like it / I dislike it (4 of 7)."
    );
    const tie = joint.slice();
    tie[jointIndex(1, 4, 5)] = 4;
    expect(pairSummary(tie, PAIR_SHEET, 9)).toBe(
      "Most common pairs: I like it / I dislike it and I expect it / I dislike it (4 each, of 9)."
    );
    expect(pairSummary(new Array(25).fill(0), PAIR_SHEET, 0)).toBe("No answers.");
    expect(pairResultsVerdict(REVEALED, 7, 3)).toBe(
      "7 people answered; 2 of 3 items have enough answers to show (3 or more)."
    );
    expect(pairResultsVerdict([REVEALED[2]], 2, 3)).toBe(
      "2 people answered, but no item has the 3 answers it needs to show."
    );
  });

  it("shows each feature's grid as a figure with a table of the answer pairs", () => {
    render(<PairResults sheet={PAIR_SHEET} revealed={REVEALED} minN={3} ballots={7} />);
    const figure = screen.getByRole("figure", { name: "1. Dark mode" });
    expect(figure).toHaveAccessibleDescription(
      "Most common pair: I like it / I dislike it (4 of 7)."
    );
    fireEvent.click(within(figure).getByRole("button", { name: /table/i }));
    const table = within(figure).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent)
    ).toEqual([
      "First answer ↓, second answer →",
      "I like it",
      "I expect it",
      "I'm neutral",
      "I can live with it",
      "I dislike it",
    ]);
    expect(within(table).getByRole("row", { name: /^I like it/ })).toHaveTextContent(
      "I like it00004"
    );
    expect(
      screen.getByText(/Rows: If it has this, how do you feel\? Columns: If it doesn't have this/)
    ).toBeInTheDocument();
  });

  it("says a withheld feature needed more answers, and shows no grid for it", () => {
    render(<PairResults sheet={PAIR_SHEET} revealed={REVEALED} minN={3} ballots={7} />);
    expect(screen.queryByRole("figure", { name: "3. Emoji reactions" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "It needed 1 more answer to see its results."
    );
    expect(
      screen.getByText(/Withheld: 2 answers, and an item shows its results from 3/)
    ).toBeInTheDocument();
  });

  it("puts each question on its own in Advanced analysis", () => {
    render(<PairResults sheet={PAIR_SHEET} revealed={REVEALED} minN={3} ballots={7} />);
    expect(screen.getByText("Each question on its own")).toBeInTheDocument();
    const tables = screen.getAllByRole("table", { name: "Dark mode" });
    expect(within(tables[0]).getByRole("row", { name: /^I dislike it/ })).toHaveTextContent(
      "I dislike it06"
    );
  });

  it("moves focus to its heading when asked", () => {
    render(
      <PairResults sheet={PAIR_SHEET} revealed={REVEALED} minN={3} ballots={7} focusHeading />
    );
    expect(screen.getByRole("heading", { name: "Results" })).toHaveFocus();
  });

  it("caps a cell's shading so the count on it stays readable in every theme", () => {
    expect(pairCellFill(0, 4)).toBe(0);
    expect(pairCellFill(4, 4)).toBe(PAIR_CELL_MAX_FILL);
    expect(PAIR_CELL_MAX_FILL).toBeLessThanOrEqual(0.4);
    expect(pairCellFill(1, 4)).toBeGreaterThan(0);
    expect(pairCellFill(1, 4)).toBeLessThan(pairCellFill(2, 4));
    render(<PairResults sheet={PAIR_SHEET} revealed={REVEALED} minN={3} ballots={7} />);
    const fills = within(screen.getByRole("figure", { name: "1. Dark mode" }))
      .getAllByText((_, el) => el?.hasAttribute("data-pair-fill") === true)
      .map((el) => Number((el as HTMLElement).style.opacity));
    expect(fills).toHaveLength(25);
    expect(Math.max(...fills)).toBe(PAIR_CELL_MAX_FILL);
  });

  it("wraps the answer labels instead of cutting them off at phone width", () => {
    render(<PairResults sheet={PAIR_SHEET} revealed={[REVEALED[0]]} minN={3} ballots={7} />);
    const figure = screen.getByRole("figure", { name: "1. Dark mode" });
    const labels = within(figure).getAllByText("I can live with it");
    // A column header and a row label, both whole.
    expect(labels).toHaveLength(2);
    for (const el of labels) expect(el).not.toHaveClass("truncate");
  });
});
