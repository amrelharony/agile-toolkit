import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { PairAnswerForm } from "@/components/collab/vote-room/pair-answer-form";
import { pairDraftKey, type PairDraft } from "@/lib/realtime/vote-room/pair";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { PAIR_SHEET } from "../realtime/vote-room-fixtures";

/**
 * A participant's Kano answers: two questions per feature, nothing picked,
 * a feature answered whole or not at all, inline errors on the missing
 * half with focus on the first, Enter sends, and the draft clears.
 */

function setup(result: VoteSubmitResult = "sent") {
  const onSubmit = vi.fn<(draft: PairDraft) => Promise<VoteSubmitResult>>(async () => result);
  render(<PairAnswerForm sheet={PAIR_SHEET} onSubmit={onSubmit} />);
  const feature = (name: RegExp) => screen.getByRole("group", { name });
  const half = (name: RegExp, which: 0 | 1) =>
    within(feature(name)).getAllByRole("radiogroup")[which];
  const pick = (name: RegExp, which: 0 | 1, label: string) =>
    fireEvent.click(within(half(name, which)).getByRole("radio", { name: label }));
  const send = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    });
  };
  return { onSubmit, feature, half, pick, send };
}

describe("PairAnswerForm", () => {
  it("asks both questions about every feature, with nothing picked", () => {
    const { feature, half } = setup();
    for (const name of [/Dark mode/, /CSV export/, /Emoji reactions \(optional\)/]) {
      expect(
        within(feature(name)).getByRole("radiogroup", { name: "If it has this, how do you feel?" })
      ).toBeInTheDocument();
      expect(
        within(feature(name)).getByRole("radiogroup", {
          name: "If it doesn't have this, how do you feel?",
        })
      ).toBeInTheDocument();
      for (const which of [0, 1] as const) {
        const radios = within(half(name, which)).getAllByRole("radio");
        expect(radios.map((r) => r.textContent)).toEqual([
          "I like it",
          "I expect it",
          "I'm neutral",
          "I can live with it",
          "I dislike it",
        ]);
        for (const r of radios) expect(r).toHaveAttribute("aria-checked", "false");
      }
    }
    expect(screen.getByText("Across the whole app")).toBeInTheDocument();
    expect(screen.getByText("Leave both blank to skip.")).toBeInTheDocument();
  });

  it("marks the missing halves of required features, focusing the first", async () => {
    const { pick, send, half, onSubmit } = setup();
    pick(/Dark mode/, 0, "I like it");
    await send();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Pick an answer.",
      "Pick an answer.",
      "Pick an answer.",
    ]);
    expect(within(half(/Dark mode/, 1)).getAllByRole("radio")[0]).toHaveFocus();
  });

  it("asks for both or neither on an optional feature", async () => {
    const { pick, send, onSubmit } = setup();
    pick(/Dark mode/, 0, "I like it");
    pick(/Dark mode/, 1, "I dislike it");
    pick(/CSV export/, 0, "I expect it");
    pick(/CSV export/, 1, "I expect it");
    pick(/Emoji/, 1, "I'm neutral");
    await send();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Answer both, or leave both blank to skip."
    );
  });

  it("sends with Enter, an optional feature skipped, and clears the draft", async () => {
    const { pick, half, onSubmit } = setup();
    pick(/Dark mode/, 0, "I like it");
    pick(/Dark mode/, 1, "I dislike it");
    pick(/CSV export/, 0, "I expect it");
    pick(/CSV export/, 1, "I expect it");
    const radio = within(half(/CSV export/, 1)).getByRole("radio", { name: "I expect it" });
    await act(async () => {
      fireEvent.keyDown(radio, { key: "Enter" });
    });
    expect(onSubmit).toHaveBeenCalledWith({
      [pairDraftKey("dark", "first")]: 0,
      [pairDraftKey("dark", "second")]: 4,
      [pairDraftKey("export", "first")]: 1,
      [pairDraftKey("export", "second")]: 1,
      [pairDraftKey("emoji", "first")]: null,
      [pairDraftKey("emoji", "second")]: null,
    });
    for (const r of within(half(/Dark mode/, 0)).getAllByRole("radio")) {
      expect(r).toHaveAttribute("aria-checked", "false");
    }
  });

  it("says why when the room refuses the answers", async () => {
    const { pick, send } = setup("already-answered");
    pick(/Dark mode/, 0, "I like it");
    pick(/Dark mode/, 1, "I dislike it");
    pick(/CSV export/, 0, "I expect it");
    pick(/CSV export/, 1, "I expect it");
    await send();
    expect(screen.getByRole("alert")).toHaveTextContent("You've already answered this round.");
  });
});
