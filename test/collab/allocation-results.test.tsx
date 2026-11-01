import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  AllocationResults,
  allocationChartSummary,
  allocationItemSummary,
  allocationVerdict,
} from "@/components/collab/vote-room/allocation-results";
import { SavedRoundResults } from "@/components/collab/vote-room/round-views";
import type {
  AllocationRoundResult,
  RevealedAllocation,
} from "@/lib/realtime/vote-room/allocation";
import { ALLOCATION_SHEET, BUY_SHEET } from "../realtime/vote-room-fixtures";

/**
 * A revealed allocation round: the verdict, the averages as a chart with a
 * table, "kept / over" for capped items, and the spread only from 5
 * answers (or a plain note when the totals were typed by hand).
 */

const FIVE: RevealedAllocation[] = [
  { total: 175, backers: 4, bands: [1, 1, 1, 1, 1] },
  { total: 125, backers: 4, bands: [1, 0, 2, 2, 0] },
  { total: 125, backers: 4, bands: [1, 0, 2, 2, 0] },
  { total: 75, backers: 3, bands: [2, 1, 1, 1, 0] },
];
const THREE: RevealedAllocation[] = [
  { total: 165, backers: null, bands: null },
  { total: 55, backers: null, bands: null },
  { total: 45, backers: null, bands: null },
  { total: 35, backers: null, bands: null },
];

describe("AllocationResults", () => {
  it("leads with a one-sentence verdict", () => {
    expect(allocationVerdict(ALLOCATION_SHEET, FIVE, 5)).toBe(
      "5 people split $100 each. Search got the most: $175 in all, $35 on average."
    );
    expect(allocationVerdict(ALLOCATION_SHEET, [FIVE[1], FIVE[2], FIVE[3], FIVE[3]], 5)).toBe(
      "5 people split $100 each. Search and Exports got the most: $125 each in all, $25 on average."
    );
    expect(allocationItemSummary("Search", FIVE[0], ALLOCATION_SHEET, 5)).toBe(
      "Search: $175 in all, $35 on average, from 4 of 5 people."
    );
    expect(allocationItemSummary("Search", THREE[0], ALLOCATION_SHEET, 3)).toBe(
      "Search: $165 in all, $55 on average."
    );
  });

  it("sums the chart up in one sentence, however many items", () => {
    expect(allocationChartSummary(ALLOCATION_SHEET, FIVE, 5)).toBe(
      "Highest average: Search, $35. Lowest: Themes, $15."
    );
    expect(allocationChartSummary(ALLOCATION_SHEET, [FIVE[1], FIVE[2], FIVE[3], FIVE[3]], 5)).toBe(
      "Highest average: Search and Exports, $25. Lowest: Single sign-on and Themes, $15."
    );
    const even = ALLOCATION_SHEET.items.map(() => ({ total: 75, backers: null, bands: null }));
    expect(allocationChartSummary(ALLOCATION_SHEET, even, 3)).toBe("Every item averaged $25.");
    const twenty = {
      ...ALLOCATION_SHEET,
      items: Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, text: `Item ${i}` })),
    };
    const rows = twenty.items.map((_, i) => ({
      total: i === 0 ? 120 : 20,
      backers: null,
      bands: null,
    }));
    expect(allocationChartSummary(twenty, rows, 5).split(". ").length).toBe(2);
  });

  it("shows the averages as a figure with a summary and a table", () => {
    render(<AllocationResults sheet={ALLOCATION_SHEET} revealed={FIVE} minN={3} ballots={5} />);
    const figure = screen.getByRole("figure", { name: "Average per person, of $100" });
    expect(figure).toHaveAccessibleDescription(
      "Highest average: Search, $35. Lowest: Themes, $15."
    );
    fireEvent.click(within(figure).getByRole("button", { name: /table/i }));
    const table = within(figure).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent)
    ).toEqual(["Item", "Total", "Average", "People who gave something", "Middle half"]);
    expect(within(table).getByRole("row", { name: /Search/ })).toHaveTextContent(
      "Search$175$354$1–$10 to $26–$50"
    );
  });

  it("puts the spread in Advanced analysis from 5 answers", () => {
    render(<AllocationResults sheet={ALLOCATION_SHEET} revealed={FIVE} minN={3} ballots={5} />);
    expect(screen.getByText("How the amounts were spread")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "People per band, per item" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent)
    ).toEqual(["Item", "$0", "$1–$10", "$11–$25", "$26–$50", "$51–$100", "Middle half"]);
    expect(within(table).getByRole("row", { name: /Themes/ })).toHaveTextContent("Themes2111");
  });

  it("says the spread needs more answers under 5, and shows no bands", () => {
    render(<AllocationResults sheet={ALLOCATION_SHEET} revealed={THREE} minN={3} ballots={3} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "It needed 2 more answers to see how the amounts were spread."
    );
    expect(screen.queryByText("How the amounts were spread")).toBeNull();
    expect(screen.queryByRole("table", { name: "People per band, per item" })).toBeNull();
  });

  it.each([3, 4, 6])(
    "says the spread isn't known for totals typed by hand, from %i people too",
    (ballots) => {
      const typed = THREE.map((r) => ({ ...r }));
      render(
        <AllocationResults
          sheet={ALLOCATION_SHEET}
          revealed={typed}
          minN={3}
          ballots={ballots}
          spreadKnown={false}
        />
      );
      expect(
        screen.getByText(
          "The totals were entered by hand, so how the amounts were spread isn't known."
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(/It needed/)).toBeNull();
    }
  );

  it("shows a saved round of typed totals as typed, from the result alone", () => {
    const result: AllocationRoundResult = {
      kind: "allocation",
      roundId: "tally-1",
      tool: "hundred-dollar-test",
      sheetId: ALLOCATION_SHEET.id,
      title: ALLOCATION_SHEET.title,
      budget: 100,
      unit: "$",
      spendAll: true,
      closedAt: "2026-10-26T10:00:00.000Z",
      minN: 3,
      ballots: 3,
      source: "facilitator",
      spreadKnown: false,
      bandEdges: [0, 1, 11, 26, 51],
      items: ALLOCATION_SHEET.items.map((x, i) => ({
        id: x.id,
        text: x.text,
        total: THREE[i].total,
        backers: null,
        bands: null,
      })),
    };
    render(<SavedRoundResults result={result} />);
    expect(screen.getByText(/entered by hand/)).toBeInTheDocument();
    expect(screen.queryByText(/It needed/)).toBeNull();
  });

  it("doesn't blame typed totals for a spread a live round left out", () => {
    render(<AllocationResults sheet={ALLOCATION_SHEET} revealed={THREE} minN={3} ballots={6} />);
    expect(screen.getByText("How the amounts were spread wasn't shared.")).toBeInTheDocument();
    expect(screen.queryByText(/entered by hand/)).toBeNull();
  });

  it("splits a capped item's total into kept and refunded", () => {
    render(
      <AllocationResults
        sheet={BUY_SHEET}
        revealed={[
          { total: 70, backers: null, bands: null },
          { total: 20, backers: null, bands: null },
          { total: 10, backers: null, bands: null },
        ]}
        minN={3}
        ballots={3}
      />
    );
    expect(screen.getByText("Search: $60 kept, $10 over: refunded.")).toBeInTheDocument();
    expect(screen.queryByText(/Exports: .* kept/)).toBeNull();
  });

  it("moves focus to its heading when asked", () => {
    render(
      <AllocationResults
        sheet={ALLOCATION_SHEET}
        revealed={FIVE}
        minN={3}
        ballots={5}
        focusHeading
      />
    );
    expect(screen.getByRole("heading", { name: "Results" })).toHaveFocus();
  });
});
