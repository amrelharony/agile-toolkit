import { readFileSync } from "node:fs";
import path from "node:path";
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
  detail: "Column: Went well · Text: “flaky CI”",
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
    expect(card).toHaveAccessibleDescription("Column: Went well · Text: “flaky CI”");
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

  it("has no Escape of its own: the panel's Escape order denies it (mascot-escape.test)", () => {
    // Inside the panel or out, with nothing focused or on the card itself:
    // the card alone answers no Escape. The shell denies a waiting card first,
    // before History or closing, and only for an Escape meant for the panel.
    render(
      <div role="dialog" aria-label="Amr">
        <ConfirmCard allowApproveAll />
      </div>
    );
    const resolve = waiting(ADD);
    expect(
      fireEvent.keyDown(screen.getByRole("button", { name: "Not now" }), { key: "Escape" })
    ).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(resolve).not.toHaveBeenCalled();
    const card = readFileSync(
      path.resolve(__dirname, "../../src/components/agent/chat/confirm-card.tsx"),
      "utf8"
    );
    expect(card).not.toMatch(/addEventListener|onKeyDown/);
    // Never the shell's markers: held-layers-css.test.ts counts every
    // data-vt-hold="…" in src, and the bundle budget finds the mascot chunk
    // by data-agent-sheet-root.
    expect(card).not.toContain("data-vt-hold");
    expect(card).not.toContain("data-agent-sheet-root");
  });
});
