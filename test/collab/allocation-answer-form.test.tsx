import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import {
  AllocationAnswerForm,
  LEFT_TO_GIVE_ANNOUNCE_MS,
  leftToGiveText,
} from "@/components/collab/vote-room/allocation-answer-form";
import type { AllocationDraft } from "@/lib/realtime/vote-room/allocation";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { ALLOCATION_SHEET, BUY_SHEET } from "../realtime/vote-room-fixtures";

/**
 * A participant's split: blank boxes (a blank is 0), "Left to give" as they
 * type (announced when the typing pauses), inline errors on the box and
 * under the boxes, Enter sends, and nothing of the split stays after sending.
 */

function setup(sheet = ALLOCATION_SHEET, result: VoteSubmitResult = "sent") {
  const onSubmit = vi.fn<(draft: AllocationDraft) => Promise<VoteSubmitResult>>(async () => result);
  render(
    <LiveAnnouncerProvider>
      <AllocationAnswerForm sheet={sheet} onSubmit={onSubmit} />
    </LiveAnnouncerProvider>
  );
  const box = (name: RegExp) => screen.getByLabelText(name);
  const type = (name: RegExp, value: string) => fireEvent.change(box(name), { target: { value } });
  const send = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send my split" }));
    });
  };
  return { onSubmit, box, type, send };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AllocationAnswerForm", () => {
  it("starts with every box blank and says a blank is $0", () => {
    const { box } = setup();
    for (const name of [/Search/, /Exports/, /Single sign-on/, /Themes/]) {
      expect(box(name)).toHaveValue(null);
    }
    expect(
      screen.getByText(/Split \$100 across these\. Give out all of it\. A blank box is \$0\./)
    ).toBeInTheDocument();
    expect(screen.getByText("Left to give: $100.")).toBeInTheDocument();
  });

  it("follows the typing with what's left, and announces it once the typing pauses", async () => {
    vi.useFakeTimers();
    const { type } = setup();
    type(/Search/, "40");
    type(/Exports/, "30");
    expect(screen.getByText("Left to give: $30.")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(LEFT_TO_GIVE_ANNOUNCE_MS + 100);
    });
    expect(screen.getByTestId("live-polite")).toHaveTextContent("Left to give: $30.");
    type(/Themes/, "40");
    expect(screen.getByText("$10 over your $100.")).toBeInTheDocument();
    type(/Themes/, "30");
    expect(screen.getByText("All $100 given.")).toBeInTheDocument();
  });

  it("says what's wrong with a box on the box, with focus on the first", async () => {
    const { type, send, box, onSubmit } = setup(BUY_SHEET);
    type(/Search/, "2.5");
    type(/Exports/, "31");
    await send();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Enter a whole number, 0 or more.",
      "At most $30 on this one.",
    ]);
    expect(box(/Search/)).toHaveFocus();
    expect(box(/Search/)).toHaveAttribute("aria-invalid", "true");
    // The cap is said before anyone types: "At most $30."
    expect(screen.getByText("Priced 40, 10 raised At most $30.")).toBeInTheDocument();
  });

  it.each<[string, Record<string, string>, string]>([
    ["nothing", {}, "Give something to at least one item."],
    ["less than all of it", { Search: "60" }, "Give out all $100: $40 left."],
    [
      "more than the budget",
      { Search: "60", Exports: "50" },
      "You've given $110: that's $10 more than your $100.",
    ],
  ])("says so under the boxes when the split gives %s", async (_label, values, message) => {
    const { type, send, onSubmit } = setup();
    for (const [name, v] of Object.entries(values)) type(new RegExp(name), v);
    await send();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("lets Buy-a-Feature give less than the budget", async () => {
    const { type, send, onSubmit } = setup(BUY_SHEET);
    expect(
      screen.getByText(/You have \$50 to give\. You don't have to give it all\./)
    ).toBeInTheDocument();
    type(/Search/, "20");
    await send();
    expect(onSubmit).toHaveBeenCalledWith({ search: 20, export: 0, sso: 0 });
  });

  it("sends with Enter and clears the split once sent", async () => {
    const { type, box, onSubmit } = setup();
    type(/Search/, "70");
    type(/Themes/, "30");
    await act(async () => {
      fireEvent.submit(box(/Themes/).closest("form")!);
    });
    expect(onSubmit).toHaveBeenCalledWith({ search: 70, export: 0, sso: 0, themes: 30 });
    expect(box(/Search/)).toHaveValue(null);
    expect(screen.getByText("Left to give: $100.")).toBeInTheDocument();
  });

  it("keeps the split and says why when the room refuses it", async () => {
    const { type, send, box } = setup(ALLOCATION_SHEET, "closed");
    type(/Search/, "100");
    await send();
    expect(screen.getByRole("alert")).toHaveTextContent("This round has closed.");
    expect(box(/Search/)).toHaveValue(100);
  });

  it("leftToGiveText handles words as units", () => {
    expect(leftToGiveText(30, { ...ALLOCATION_SHEET, unit: "pts" })).toBe("Left to give: 70 pts.");
  });
});
