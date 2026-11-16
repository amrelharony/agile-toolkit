import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import {
  ChoiceAnswerForm,
  choiceInstruction,
  dotsLeftText,
} from "@/components/collab/vote-room/choice-answer-form";
import { RankAnswerForm, ordinal } from "@/components/collab/vote-room/rank-answer-form";
import { NumberAnswerForm, readNumberBox } from "@/components/collab/vote-room/number-answer-form";
import { ChoiceResults, choiceSummary } from "@/components/collab/vote-room/choice-results";
import { RankResults } from "@/components/collab/vote-room/rank-results";
import { NumberResults } from "@/components/collab/vote-room/number-results";
import {
  SavedRoundResults,
  kindSpreadNote,
  resultKeepable,
  roundMarkdown,
} from "@/components/collab/vote-room/round-views";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import type { ChoiceRoundResult } from "@/lib/realtime/vote-room/choice";
import type { NumberRoundResult } from "@/lib/realtime/vote-room/number";
import {
  DOTS_SHEET,
  MULTI_SHEET,
  NUMBER_SHEET,
  POLL_SHEET,
  RANK_SHEET,
} from "../realtime/vote-room-kind-fixtures";

/**
 * Quick Vote's answer forms and results, phone first: nothing picked to
 * start with, inline errors, the draft cleared once sent; results say the
 * leader in a sentence, with the spread only when the room sent it.
 */

type Submit = (draft: Record<string, number | null>) => Promise<VoteSubmitResult>;

function wrap(ui: React.ReactNode) {
  return render(<LiveAnnouncerProvider>{ui}</LiveAnnouncerProvider>);
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe("ChoiceAnswerForm", () => {
  it("single: nothing picked to start, one radio per option, sends the one picked", async () => {
    const onSubmit = vi.fn<Submit>(async () => "sent");
    wrap(<ChoiceAnswerForm sheet={POLL_SHEET} onSubmit={onSubmit} />);
    expect(screen.getByText("Pick one.")).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    for (const r of radios) expect(r).not.toBeChecked();
    await click(screen.getByRole("button", { name: "Send answer" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Pick an option.");
    await click(screen.getByRole("radio", { name: /Cafe/ }));
    await click(screen.getByRole("radio", { name: /Online/ }));
    await click(screen.getByRole("button", { name: "Send answer" }));
    expect(onSubmit).toHaveBeenCalledWith({ room: 0, cafe: 0, online: 1 });
    // Nothing of the answer stays.
    for (const r of screen.getAllByRole("radio")) expect(r).not.toBeChecked();
  });

  it("multi: turns the rest off once the limit is picked, and says so", async () => {
    const onSubmit = vi.fn<Submit>(async () => "sent");
    wrap(<ChoiceAnswerForm sheet={MULTI_SHEET} onSubmit={onSubmit} />);
    expect(screen.getByText("Pick up to 2.")).toBeInTheDocument();
    await click(screen.getByRole("checkbox", { name: "Flaky tests" }));
    await click(screen.getByRole("checkbox", { name: "Planning" }));
    expect(screen.getByRole("checkbox", { name: "On-call" })).toBeDisabled();
    expect(screen.getByText(/You've picked 2/)).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Send answer" }));
    expect(onSubmit).toHaveBeenCalledWith({ a: 1, b: 0, c: 1, d: 0 });
  });

  it("dots: steppers with what's left, never past the budget", async () => {
    const onSubmit = vi.fn<Submit>(async () => "sent");
    wrap(<ChoiceAnswerForm sheet={DOTS_SHEET} onSubmit={onSubmit} />);
    expect(screen.getByText("3 dots left.")).toBeInTheDocument();
    const more = (name: string) => screen.getByRole("button", { name: `One more dot on ${name}` });
    await click(more("Flaky tests"));
    await click(more("Flaky tests"));
    await click(more("Demos"));
    expect(screen.getByText("All 3 dots placed.")).toBeInTheDocument();
    expect(more("On-call")).toBeDisabled();
    await click(screen.getByRole("button", { name: "One dot fewer on Flaky tests" }));
    expect(screen.getByText("1 dot left.")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Send answer" }));
    expect(onSubmit).toHaveBeenCalledWith({ a: 1, b: 0, c: 0, d: 1 });
  });

  it("says what each mode asks, and what a refused send means", async () => {
    expect(choiceInstruction({ ...MULTI_SHEET, limit: 4 })).toBe("Pick as many as you like.");
    expect(dotsLeftText(0, 1)).toBe("1 dot left.");
    const onSubmit = vi.fn<Submit>(async () => "closed");
    wrap(<ChoiceAnswerForm sheet={POLL_SHEET} onSubmit={onSubmit} />);
    await click(screen.getByRole("radio", { name: /Cafe/ }));
    await click(screen.getByRole("button", { name: "Send answer" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This round has closed.");
  });
});

describe("RankAnswerForm", () => {
  it("builds the order by taps, moves, takes back, and sends every place", async () => {
    const onSubmit = vi.fn<Submit>(async () => "sent");
    wrap(<RankAnswerForm sheet={RANK_SHEET} onSubmit={onSubmit} />);
    expect(screen.getByText("Nothing placed yet.")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Send my order" }));
    expect(screen.getByRole("alert")).toHaveTextContent("4 still to place");
    expect(onSubmit).not.toHaveBeenCalled();
    const place = (name: RegExp) =>
      within(screen.getByRole("list", { name: "Still to place" })).getByRole("button", { name });
    await click(place(/Fewer bugs/));
    // Focus moves to what took the placed option's spot in the list.
    expect(document.activeElement).toBe(place(/Happier team/));
    await click(place(/Ship faster/));
    await click(place(/Lower cost/));
    await click(screen.getByRole("button", { name: "Move Lower cost up" }));
    await click(screen.getByRole("button", { name: "Take Fewer bugs out of your order" }));
    await click(place(/Fewer bugs/));
    await click(place(/Happier team/));
    expect(screen.getByRole("heading", { name: /Your order \(4 of 4\)/ })).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Send my order" }));
    // Lower cost moved above Ship faster, Fewer bugs taken out and put back last-but-one.
    expect(onSubmit).toHaveBeenCalledWith({ cost: 0, speed: 1, quality: 2, joy: 3 });
    expect(screen.getByText("Nothing placed yet.")).toBeInTheDocument();
    expect(ordinal(2)).toBe("2nd");
  });
});

describe("NumberAnswerForm", () => {
  it("starts blank, steps from the middle, checks the range, and sends the number", async () => {
    const onSubmit = vi.fn<Submit>(async () => "sent");
    wrap(<NumberAnswerForm sheet={NUMBER_SHEET} onSubmit={onSubmit} />);
    const box = screen.getByLabelText(/Your answer \(%\)/);
    expect(box).toHaveValue("");
    expect(screen.getByText(/From 0% to 100%\. Whole numbers\./)).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Send answer" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number.");
    await click(screen.getByRole("button", { name: "Up by 1" }));
    expect(box).toHaveValue("50");
    await click(screen.getByRole("button", { name: "Up by 1" }));
    expect(box).toHaveValue("51");
    fireEvent.change(box, { target: { value: "120" } });
    await click(screen.getByRole("button", { name: "Send answer" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number from 0% to 100%.");
    fireEvent.change(box, { target: { value: "4.5" } });
    await click(screen.getByRole("button", { name: "Send answer" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a whole number.");
    fireEvent.change(box, { target: { value: "42" } });
    await click(screen.getByRole("button", { name: "Send answer" }));
    expect(onSubmit).toHaveBeenCalledWith({ value: 42 });
    expect(box).toHaveValue("");
  });

  it("reads a comma as a decimal point and refuses anything else", () => {
    expect(readNumberBox("3,5")).toBe(3.5);
    expect(readNumberBox("")).toBeNull();
    expect(Number.isNaN(readNumberBox("3a"))).toBe(true);
  });
});

describe("results", () => {
  it("choice: the leader in a sentence and a table to view", () => {
    const revealed = [
      { total: 2, backers: null },
      { total: 1, backers: null },
      { total: 0, backers: null },
    ];
    expect(choiceSummary(POLL_SHEET, revealed, 3)).toBe("Most picked Meeting room (2 of 3, 67%).");
    wrap(<ChoiceResults sheet={POLL_SHEET} revealed={revealed} minN={3} ballots={3} />);
    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByText("3 people answered.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /table/i })).toBeInTheDocument();
  });

  it("choice: a dot round says when who-put-dots-where is missing", () => {
    wrap(
      <ChoiceResults
        sheet={DOTS_SHEET}
        revealed={[
          { total: 4, backers: null },
          { total: 3, backers: null },
          { total: 1, backers: null },
          { total: 1, backers: null },
        ]}
        minN={3}
        ballots={3}
      />
    );
    expect(screen.getByText(/shows from 5 answers/)).toBeInTheDocument();
  });

  it("rank: most points first, with the average place", () => {
    wrap(
      <RankResults
        sheet={RANK_SHEET}
        revealed={[{ points: 8 }, { points: 6 }, { points: 4 }, { points: 0 }]}
        ballots={3}
      />
    );
    expect(
      screen.getByText(/Top: Ship faster \(8 points, average place 1\.3\)\./)
    ).toBeInTheDocument();
  });

  it("number: the median always, the spread only when sent", () => {
    const { unmount } = wrap(
      <NumberResults
        sheet={NUMBER_SHEET}
        revealed={{ count: 3, median: 40, spread: null }}
        minN={3}
      />
    );
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText(/show from 5 answers/)).toBeInTheDocument();
    expect(screen.queryByText("Lowest")).toBeNull();
    unmount();
    wrap(
      <NumberResults
        sheet={NUMBER_SHEET}
        revealed={{
          count: 5,
          median: 30,
          spread: { min: 10, q1: 20, q3: 40, max: 50, histogram: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] },
        }}
        minN={3}
      />
    );
    expect(screen.getByText("Lowest")).toBeInTheDocument();
    expect(screen.getByText("20% to 40%")).toBeInTheDocument();
  });

  it("a saved round of each new kind shows, keeps, and turns into Markdown", () => {
    const choice: ChoiceRoundResult = {
      kind: "choice",
      roundId: "round_000001",
      tool: "quick-vote",
      sheetId: POLL_SHEET.id,
      title: POLL_SHEET.title,
      mode: "single",
      limit: 1,
      closedAt: "2026-11-12T10:00:00.000Z",
      minN: 3,
      ballots: 3,
      source: "live",
      options: POLL_SHEET.options.map((o, i) => ({
        id: o.id,
        text: o.text,
        total: [2, 1, 0][i],
        backers: null,
      })),
    };
    const number: NumberRoundResult = {
      kind: "number",
      roundId: "round_000002",
      tool: "quick-vote",
      sheetId: NUMBER_SHEET.id,
      title: NUMBER_SHEET.title,
      min: 0,
      max: 100,
      decimals: 0,
      unit: "%",
      closedAt: "2026-11-12T10:00:00.000Z",
      minN: 3,
      ballots: 3,
      source: "live",
      median: 40,
      spread: null,
    };
    expect(resultKeepable(choice)).toBe(true);
    expect(resultKeepable(number)).toBe(true);
    expect(roundMarkdown(choice)).toContain("# Where should we hold the retro?");
    expect(roundMarkdown(number)).toContain("Median: 40%.");
    const { unmount } = wrap(<SavedRoundResults result={choice} />);
    expect(screen.getByText("Most picked Meeting room (2 of 3, 67%).")).toBeInTheDocument();
    unmount();
    wrap(<SavedRoundResults result={number} />);
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("warns the host of each kind's second threshold before Reveal", () => {
    expect(kindSpreadNote("allocation", 5)).toMatch(/Who gave each item something/);
    expect(kindSpreadNote("choice", 5, true)).toMatch(/put a dot on each option/);
    expect(kindSpreadNote("choice", 5, false)).toBeNull();
    expect(kindSpreadNote("number", 5)).toMatch(/lowest, the highest and the spread/);
    expect(kindSpreadNote("rank", 5)).toBeNull();
    expect(kindSpreadNote("scale", 5)).toBeNull();
  });
});
