import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  VoteResults,
  questionSummary,
  resultsVerdict,
} from "@/components/collab/vote-room/vote-results";
import { QUESTIONNAIRE } from "../realtime/vote-room-fixtures";

/**
 * A revealed round: a chart per question with a summary and a table, the
 * withheld questions said plainly, mean and median tucked away.
 */

const REVEALED = [
  { responses: 4, distribution: [2, 1, 1] },
  { responses: 4, distribution: [2, 2, 0] },
  { responses: 2, distribution: null },
];

describe("VoteResults", () => {
  it("gives a one-sentence verdict", () => {
    render(<VoteResults questionnaire={QUESTIONNAIRE} revealed={REVEALED} minN={3} ballots={4} />);
    expect(
      screen.getByText(
        "4 people answered; 2 of 3 questions have enough answers to show (3 or more)."
      )
    ).toBeInTheDocument();
  });

  it("charts each revealed question with a summary and a table", () => {
    render(<VoteResults questionnaire={QUESTIONNAIRE} revealed={REVEALED} minN={3} ballots={4} />);
    const fun = screen.getByRole("figure", { name: "1. Fun" });
    expect(fun).toHaveAccessibleDescription("Most chose Green (2 of 4, 50%).");
    fireEvent.click(within(fun).getByRole("button", { name: /view as table/i }));
    const table = within(fun).getByRole("table");
    expect(
      within(table)
        .getAllByRole("row")
        .map((r) => r.textContent)
    ).toEqual(["AnswerPeopleShare", "Green250%", "Yellow125%", "Red125%"]);
    expect(screen.getByRole("figure", { name: "2. Speed" })).toHaveAccessibleDescription(
      "Split between Green and Yellow (2 each, of 4)."
    );
  });

  it("withholds a question under minN, saying how many more it needs", () => {
    render(<VoteResults questionnaire={QUESTIONNAIRE} revealed={REVEALED} minN={3} ballots={4} />);
    expect(screen.queryByRole("figure", { name: "3. Learning" })).toBeNull();
    expect(
      screen.getByText("Collect 1 more answer to see this question's results.")
    ).toBeInTheDocument();
    expect(screen.getByText(/Withheld: 2 answers, fewer than 3/)).toBeInTheDocument();
  });

  it("puts mean and median in Advanced analysis, on the scale's values", () => {
    render(<VoteResults questionnaire={QUESTIONNAIRE} revealed={REVEALED} minN={3} ballots={4} />);
    const details = screen.getByText("Mean and median").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    const rows = within(details)
      .getAllByRole("row")
      .map((r) => r.textContent);
    expect(rows).toEqual(["QuestionAnswersMeanMedian", "Fun41.251.5", "Speed41.51.5"]);
  });

  it("words the verdict for every case", () => {
    expect(resultsVerdict([{ responses: 3, distribution: [1, 1, 1] }], 3, 3)).toBe(
      "3 people answered."
    );
    expect(
      resultsVerdict(
        [
          { responses: 3, distribution: [1, 1, 1] },
          { responses: 3, distribution: [3, 0, 0] },
        ],
        3,
        3
      )
    ).toBe("3 people answered; every question has enough answers to show.");
    expect(resultsVerdict([{ responses: 2, distribution: null }], 3, 3)).toBe(
      "3 people answered, but no question has the 3 answers it needs to show."
    );
    expect(questionSummary([0, 0, 0], QUESTIONNAIRE, 0)).toBe("No answers.");
  });
});
