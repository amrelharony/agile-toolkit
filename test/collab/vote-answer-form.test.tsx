import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { VoteAnswerForm } from "@/components/collab/vote-room/vote-answer-form";
import type { AnswerDraft } from "@/lib/realtime/vote-room/protocol";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { QUESTIONNAIRE } from "../realtime/vote-room-fixtures";

/**
 * A participant's answer form: nothing chosen to start with, inline errors
 * with focus on the first missing answer, Enter sends, optional questions
 * can be skipped, and nothing of the draft stays after sending.
 */

function setup(result: VoteSubmitResult = "sent", disabledReason: string | null = null) {
  const onSubmit = vi.fn<(draft: AnswerDraft) => Promise<VoteSubmitResult>>(async () => result);
  render(
    <VoteAnswerForm
      questionnaire={QUESTIONNAIRE}
      onSubmit={onSubmit}
      disabledReason={disabledReason}
    />
  );
  const group = (name: RegExp) => screen.getByRole("radiogroup", { name });
  const pick = (name: RegExp, label: string) =>
    fireEvent.click(within(group(name)).getByRole("radio", { name: label }));
  const send = () => fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
  return { onSubmit, group, pick, send };
}

describe("VoteAnswerForm", () => {
  it("starts with every question unset", () => {
    const { group } = setup();
    for (const name of [/Fun/, /Speed/, /Learning/]) {
      for (const radio of within(group(name)).getAllByRole("radio")) {
        expect(radio).toHaveAttribute("aria-checked", "false");
      }
    }
  });

  it("shows inline errors and focuses the first unanswered required question", async () => {
    const { onSubmit, pick, send, group } = setup();
    pick(/Speed/, "Red");
    await act(async () => send());
    expect(onSubmit).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual(["Pick an answer."]);
    // Fun is the first question left unanswered: its first option takes focus.
    expect(within(group(/Fun/)).getAllByRole("radio")[0]).toHaveFocus();
  });

  it("sends with Enter, lets an optional question be skipped, and clears the draft", async () => {
    const { onSubmit, pick, group } = setup();
    pick(/Fun/, "Green");
    pick(/Speed/, "Yellow");
    const radio = within(group(/Speed/)).getByRole("radio", { name: "Yellow" });
    await act(async () => {
      fireEvent.keyDown(radio, { key: "Enter" });
    });
    expect(onSubmit).toHaveBeenCalledWith({ fun: 2, speed: 1, learning: null });
    // The answers are gone from the form once sent.
    for (const r of within(group(/Fun/)).getAllByRole("radio")) {
      expect(r).toHaveAttribute("aria-checked", "false");
    }
  });

  it("marks optional questions in their name and lets a chosen answer be cleared", () => {
    const { pick, group } = setup();
    // A screen reader hears "optional" with the question, not only as loose text.
    expect(group(/Learning/)).toHaveAccessibleName("3. Learning (optional)");
    expect(group(/Fun/)).toHaveAccessibleName("1. Fun");
    expect(screen.getByText(/Leave it blank to skip/)).toBeInTheDocument();
    pick(/Learning/, "Red");
    expect(within(group(/Learning/)).getByRole("radio", { name: "Red" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: /Clear 3\. Learning/ }));
    expect(within(group(/Learning/)).getByRole("radio", { name: "Red" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("describes each question's group by its hint and, once shown, its error", async () => {
    const { send, group, pick } = setup();
    expect(group(/Fun/)).toHaveAccessibleDescription("We love going to work");
    expect(group(/Learning/)).toHaveAccessibleDescription("Leave it blank to skip.");
    expect(group(/Speed/)).not.toHaveAttribute("aria-describedby");
    await act(async () => send());
    expect(group(/Fun/)).toHaveAccessibleDescription("We love going to work Pick an answer.");
    expect(group(/Speed/)).toHaveAccessibleDescription("Pick an answer.");
    // Answered: the error goes, and so does its part of the description.
    pick(/Speed/, "Green");
    expect(group(/Speed/)).not.toHaveAttribute("aria-describedby");
    expect(group(/Fun/)).toHaveAccessibleDescription("We love going to work Pick an answer.");
  });

  it("says why a send was refused", async () => {
    const { pick, send } = setup("closed");
    pick(/Fun/, "Green");
    pick(/Speed/, "Green");
    await act(async () => send());
    expect(screen.getByRole("alert")).toHaveTextContent("This round has closed.");
  });

  it("shows a disabled reason and doesn't send", async () => {
    const { onSubmit, pick } = setup("sent", "The room is full, so you can watch only.");
    pick(/Fun/, "Green");
    pick(/Speed/, "Green");
    expect(screen.getByText("The room is full, so you can watch only.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send answers" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
