import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FacilitatorPair } from "@/components/collab/vote-room/facilitator-pair";
import type { SavePairRound } from "@/components/collab/vote-room/save-round";
import { jointIndex, type PairRoundResult } from "@/lib/realtime/vote-room/pair";
import { PAIR_SHEET } from "../realtime/vote-room-fixtures";

/**
 * Kano without a live room: a 5 × 5 grid per feature (one tick per paper
 * answer pair), the same minN rule, joints per feature only, and the same
 * save with source "facilitator".
 */

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

function setup(onSave = vi.fn<SavePairRound>()) {
  const renderResults = vi.fn((r: PairRoundResult) => <p>Categories for {r.items.length}</p>);
  render(
    <FacilitatorPair
      tool="kano-model"
      sheet={PAIR_SHEET}
      onSave={onSave}
      renderResults={renderResults}
    />
  );
  const cell = (feature: string, first: string, second: string) =>
    screen.getByLabelText(`${feature}: ${first}, then ${second}`);
  const type = (feature: string, first: string, second: string, value: string) =>
    fireEvent.change(cell(feature, first, second), { target: { value } });
  const show = () => fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
  return { onSave, renderResults, cell, type, show };
}

describe("FacilitatorPair", () => {
  it("starts with 25 blank boxes per feature", () => {
    const { cell } = setup();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(75);
    expect(cell("Dark mode", "I like it", "I dislike it")).toHaveValue(null);
  });

  it("refuses counts that aren't whole numbers, on the feature, with focus on the first box", () => {
    const { type, show, cell } = setup();
    type("CSV export", "I like it", "I like it", "1.5");
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter whole numbers, 0 or more, in every box."
    );
    expect(cell("CSV export", "I like it", "I like it")).toHaveFocus();
    expect(cell("CSV export", "I like it", "I like it")).toHaveAttribute("aria-invalid", "true");
  });

  it("ties each feature's error to its boxes", () => {
    const { type, show, cell } = setup();
    type("CSV export", "I like it", "I like it", "1.5");
    show();
    const box = cell("CSV export", "I like it", "I like it");
    expect(box).toHaveAccessibleDescription("Enter whole numbers, 0 or more, in every box.");
    // A box that's fine isn't described by the error.
    expect(cell("CSV export", "I like it", "I expect it")).not.toHaveAttribute("aria-describedby");
  });

  it("marks a box over the cap on the box, with focus on it", () => {
    const { type, show, cell } = setup();
    type("Dark mode", "I like it", "I like it", "3");
    type("CSV export", "I expect it", "I dislike it", "1000");
    show();
    const box = cell("CSV export", "I expect it", "I dislike it");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveFocus();
    expect(box).toHaveAccessibleDescription("At most 999 in a box.");
    expect(screen.getByRole("alert")).toHaveTextContent("At most 999 in a box.");
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });

  it("says both when a feature has an unreadable box and one over the cap", () => {
    const { type, show } = setup();
    type("Dark mode", "I like it", "I like it", "1.5");
    type("Dark mode", "I like it", "I expect it", "1000");
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter whole numbers, 0 or more, in every box. At most 999 in a box."
    );
  });

  it("applies the minN rule before showing anything", () => {
    const { type, show } = setup();
    type("Dark mode", "I like it", "I dislike it", "2");
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Results show from 3 answers, so small groups' answers stay hidden. You've entered 2."
    );
  });

  it("shows the joints, withholds a thin feature, and saves once with source 'facilitator'", () => {
    const { type, show, onSave, renderResults } = setup();
    type("Dark mode", "I like it", "I dislike it", "3");
    type("Dark mode", "I expect it", "I dislike it", "1");
    type("CSV export", "I'm neutral", "I'm neutral", "4");
    type("Emoji reactions", "I like it", "I like it", "1");
    show();
    expect(
      screen.getByText("4 people answered; 2 of 3 items have enough answers to show (3 or more).")
    ).toBeInTheDocument();
    expect(screen.getByText("Categories for 3")).toBeInTheDocument();
    expect(renderResults).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    fireEvent.click(screen.getByRole("button", { name: "Round saved" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const r = onSave.mock.calls[0][0];
    expect(r).toMatchObject({
      kind: "pair",
      tool: "kano-model",
      source: "facilitator",
      ballots: 4,
      minN: 3,
    });
    expect(r.items[0].joint![jointIndex(0, 4, 5)]).toBe(3);
    expect(r.items[0].joint![jointIndex(1, 4, 5)]).toBe(1);
    expect(r.items[2]).toEqual({ id: "emoji", text: "Emoji reactions", responses: 1, joint: null });
    // Locked until another round.
    expect(screen.getAllByRole("spinbutton")[0]).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Enter another round" }));
    expect(screen.getAllByRole("spinbutton")[0]).toBeEnabled();
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(null);
  });

  it("hides stale totals when a count changes", () => {
    const { type, show } = setup();
    type("Dark mode", "I like it", "I dislike it", "3");
    type("CSV export", "I like it", "I dislike it", "3");
    show();
    expect(screen.getByRole("button", { name: "Save round" })).toBeInTheDocument();
    type("Dark mode", "I like it", "I dislike it", "4");
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
  });
});
