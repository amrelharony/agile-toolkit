import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmCard } from "@/components/agent/chat/confirm-card";
import { useAgentStore } from "@/lib/agent/store";
import type { ConfirmPrompt } from "@/lib/agent/types";

/**
 * The decision panel: the step as its tab, a lettered question, the arguments
 * in words, and verb buttons. "{Verb}, and don't ask again until I close" is
 * the owner's alone, never on a destructive card (those always ask), and every
 * button is 44 px on a coarse pointer.
 */

const ADD: ConfirmPrompt = {
  verb: "Add card",
  title: "Retro Board",
  question: "Add a card to Retro Board?",
  detail: "Column: “went-well” · Text: “flaky CI”",
  destructive: false,
};
const DELETE: ConfirmPrompt = {
  verb: "Delete",
  title: "Risk Register",
  question: "Delete this risk?",
  detail: "",
  destructive: true,
  confirmLabel: "Delete this risk",
};

/** Show a card for `prompt`; its resolver is a spy. */
function waiting(prompt: ConfirmPrompt): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  act(() => {
    useAgentStore.setState({
      pendingToolUse: {
        toolUseId: "c1",
        actionId: "tool_retro_add_card",
        resolvedActionId: "tool.retro.add_card",
        input: {},
        prompt,
        resolve,
      },
    });
  });
  return resolve;
}

afterEach(() => {
  useAgentStore.setState({ pendingToolUse: null, autoApprove: false });
});

const APPROVE_ALL = /don't ask again until I close/;

describe("ConfirmCard", () => {
  it("draws nothing while no change waits", () => {
    const { container } = render(<ConfirmCard allowApproveAll />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the step as its tab, a lettered question and the arguments in words", () => {
    render(<ConfirmCard allowApproveAll />);
    waiting(ADD);
    const card = screen.getByRole("group", { name: "Add a card to Retro Board?" });
    expect(card).toHaveAccessibleDescription("Column: “went-well” · Text: “flaky CI”");
    const question = screen.getByRole("heading", { level: 3, name: "Add a card to Retro Board?" });
    expect(question).toHaveClass("font-display");
    expect(card.querySelector("[data-confirm-step]")).toHaveTextContent("Retro Board · Add card");
    expect(card.querySelector(".panel")).toHaveClass("shadow-md");
    // Sentence case: no ALL-CAPS label left from the old card.
    expect(card.outerHTML).not.toMatch(/uppercase|Confirm action/);
  });

  it("names the owner's Approve all with the verb, and it turns Approve all on", () => {
    render(<ConfirmCard allowApproveAll />);
    const resolve = waiting(ADD);
    const all = screen.getByRole("button", {
      name: "Add card, and don't ask again until I close",
    });
    fireEvent.click(all);
    expect(useAgentStore.getState().autoApprove).toBe(true);
    expect(resolve).toHaveBeenCalledWith(true);
  });

  it("approves with the verb and denies with Not now", () => {
    render(<ConfirmCard allowApproveAll />);
    const resolve = waiting(ADD);
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    expect(resolve).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(resolve).toHaveBeenLastCalledWith(false);
    expect(useAgentStore.getState().autoApprove).toBe(false);
  });

  it("offers visitors no Approve all", () => {
    render(<ConfirmCard />);
    waiting(ADD);
    expect(screen.getByRole("button", { name: "Add card" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: APPROVE_ALL })).toBeNull();
  });

  it("is 44 px on a coarse pointer, and long labels wrap", () => {
    render(<ConfirmCard allowApproveAll />);
    waiting(ADD);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toHaveClass("pointer-coarse:min-h-11", "whitespace-normal");
      expect(button).not.toHaveClass("whitespace-nowrap");
    }
  });

  it("draws a destructive change with the destructive button and no Approve all", () => {
    render(<ConfirmCard allowApproveAll />);
    const resolve = waiting(DELETE);
    expect(
      screen.getByRole("heading", { level: 3, name: "Delete this risk?" })
    ).toBeInTheDocument();
    const verb = screen.getByRole("button", { name: "Delete this risk" });
    expect(verb).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByRole("button", { name: "Not now" })).toHaveAttribute(
      "data-variant",
      "outline"
    );
    expect(screen.queryByRole("button", { name: APPROVE_ALL })).toBeNull();
    // No detail to describe it with.
    expect(screen.getByRole("group")).not.toHaveAttribute("aria-describedby");
    fireEvent.click(verb);
    expect(resolve).toHaveBeenCalledWith(true);
  });

  it("draws an ordinary change's verb as the default button", () => {
    render(<ConfirmCard allowApproveAll />);
    waiting(ADD);
    expect(screen.getByRole("button", { name: "Add card" })).toHaveAttribute(
      "data-variant",
      "default"
    );
  });

  it("denies on Escape, but not on one already handled or still composing", () => {
    render(<ConfirmCard />);
    const resolve = waiting(ADD);
    fireEvent.keyDown(window, { key: "Escape", isComposing: true });
    const handled = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", handled, { capture: true });
    fireEvent.keyDown(window, { key: "Escape" });
    window.removeEventListener("keydown", handled, { capture: true });
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(resolve).toHaveBeenCalledWith(false);
  });

  it("leaves an Escape on the page behind the panel alone, and denies on one from inside it", () => {
    // The owner's panel floats non-modal over the tool page: an Escape a page
    // field uses must not answer the card.
    const pageField = document.createElement("input");
    document.body.appendChild(pageField);
    render(
      <div data-agent-sheet-root="">
        <ConfirmCard allowApproveAll />
      </div>
    );
    const resolve = waiting(ADD);
    try {
      fireEvent.keyDown(pageField, { key: "Escape" });
      expect(resolve).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByRole("button", { name: "Not now" }), { key: "Escape" });
      expect(resolve).toHaveBeenCalledWith(false);
    } finally {
      pageField.remove();
    }
  });

  it("denies on an Escape from Amr himself or with nothing focused", () => {
    const amr = document.createElement("button");
    amr.setAttribute("data-vt-hold", "amr");
    document.body.appendChild(amr);
    render(<ConfirmCard />);
    const resolve = waiting(ADD);
    try {
      fireEvent.keyDown(amr, { key: "Escape" });
      expect(resolve).toHaveBeenLastCalledWith(false);
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(resolve).toHaveBeenCalledTimes(2);
    } finally {
      amr.remove();
    }
  });
});
