import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ChatProvider, useChat } from "@/components/agent/chat/chat-context";
import { ChatStrip } from "@/components/agent/chat/chat-strip";
import { ConfirmCard } from "@/components/agent/chat/confirm-card";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage, ConfirmPrompt } from "@/lib/agent/types";

/**
 * The decision panel: the step as its tab, a lettered question, the arguments
 * in words, and verb buttons. "{Verb}, and don't ask again until I close" is
 * the owner's alone, never on a destructive card (those always ask), and every
 * button is 44 px on a coarse pointer.
 *
 * Its focus rule, in a chat as both containers draw it: a coming card takes
 * focus only from nothing, Send/Stop or the log (else the announcer reads it,
 * chat-announce.test), never from someone typing; once decided, focus goes
 * on to the message box on a fine pointer and to the step's caption on a
 * touch screen. It is brought into view with each scroller's scrollTo.
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

// ── In a chat: focus and view ───────────────────────────────────────────

const AT = "2026-11-16T09:00:00Z";
const CHAT: ChatMessage[] = [
  { id: "u1", role: "user", content: [{ type: "text", text: "Add flaky CI" }], createdAt: AT },
  {
    id: "a1",
    role: "assistant",
    content: [
      { type: "tool_use", id: "c1", name: "tool_retro_add_card", input: { text: "flaky CI" } },
    ],
    createdAt: AT,
  },
];

/** The owner's composer: its draft in the store, as agent-conversation keeps it. */
function Footer() {
  const { composerId } = useChat();
  const draft = useAgentStore((s) => s.drafts.owner);
  return (
    <form>
      <textarea
        id={composerId}
        aria-label="Message"
        data-amr-composer=""
        value={draft}
        onChange={(e) => useAgentStore.getState().setDraft("owner", e.target.value)}
      />
      <button type="button" data-chat-send="">
        Stop answer
      </button>
    </form>
  );
}

function Chat() {
  return (
    <ChatProvider profile="owner">
      <ChatStrip busy footer={<Footer />}>
        <button type="button">In the log</button>
      </ChatStrip>
    </ChatProvider>
  );
}

/** A card for the chat's call, whose answer clears it as the client's settle does (once). */
function cardComes(): ReturnType<typeof vi.fn> {
  let settled = false;
  const resolve = vi.fn(() => {
    if (settled) return;
    settled = true;
    useAgentStore.getState().setPendingToolUse(null);
  });
  act(() => {
    useAgentStore.getState().setPendingToolUse({
      toolUseId: "c1",
      actionId: "tool_retro_add_card",
      resolvedActionId: "tool.retro.add_card",
      input: { text: "flaky CI" },
      prompt: ADD,
      resolve,
    });
  });
  return resolve;
}

function mountChat() {
  useAgentStore.setState({ streaming: true, messages: CHAT, chatProfile: "owner" });
  render(<Chat />);
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const theCard = () => screen.getByRole("group", { name: "Add a card to Retro Board?" });

/** The page on a touch screen: (pointer: coarse) matches, nothing else does. */
function onTouchScreen() {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  );
}

describe("ConfirmCard in a chat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAgentStore.getState().reset();
  });

  it("takes focus as it comes when focus is on nothing", () => {
    mountChat();
    cardComes();
    expect(document.activeElement).toBe(theCard());
    // Its group reads its question and detail, and sits right under its step.
    expect(theCard()).toHaveAttribute("tabindex", "-1");
    expect(theCard().closest('[data-chat-item="steps"]')).not.toBeNull();
  });

  it("takes focus from Send/Stop and from inside the log", () => {
    mountChat();
    act(() => screen.getByRole("button", { name: "Stop answer" }).focus());
    cardComes();
    expect(document.activeElement).toBe(theCard());

    act(() => useAgentStore.getState().setPendingToolUse(null));
    act(() => screen.getByRole("button", { name: "In the log" }).focus());
    cardComes();
    expect(document.activeElement).toBe(theCard());
  });

  it("leaves focus and the draft alone while someone types", () => {
    mountChat();
    fireEvent.change(box(), { target: { value: "and rename the sprint" } });
    act(() => {
      box().focus();
      box().setSelectionRange(4, 4);
    });
    cardComes();
    expect(document.activeElement).toBe(box());
    expect(box()).toHaveValue("and rename the sprint");
    expect(box().selectionStart).toBe(4);
    expect(useAgentStore.getState().drafts.owner).toBe("and rename the sprint");
    // The card is there all the same, for the announcer to read out.
    expect(theCard()).toBeInTheDocument();
  });

  it("hands focus to the message box, caret at the end, after a keyboard decision", () => {
    mountChat();
    fireEvent.change(box(), { target: { value: "next" } });
    for (const [name, approved] of [
      ["Add card", true],
      ["Not now", false],
      ["Add card, and don't ask again until I close", true],
    ] as const) {
      const resolve = cardComes();
      expect(document.activeElement).toBe(theCard());
      // A key press clicks with detail 0.
      fireEvent.click(screen.getByRole("button", { name }));
      expect(resolve.mock.calls[0]).toEqual([approved]);
      expect(screen.queryByRole("group")).toBeNull();
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(box());
      expect(box().selectionStart).toBe(4);
      act(() => {
        box().blur();
        useAgentStore.setState({ autoApprove: false });
      });
    }
  });

  it("hands focus to the step's caption on a touch screen, so no keyboard comes up", () => {
    onTouchScreen();
    mountChat();
    const resolve = cardComes();
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    expect(resolve).toHaveBeenCalledWith(true);
    const caption = document.querySelector('[data-chat-item="steps"] [data-tool-steps]');
    expect(document.activeElement).toBe(caption);
    expect(caption).toHaveTextContent("Retro Board · Add card");
    expect(document.activeElement).not.toBe(box());
  });

  it("is brought into view with the log's own scrollTo, never scrollIntoView", () => {
    const intoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: intoView,
    });
    try {
      mountChat();
      const log = screen.getByRole("log", { name: "Conversation" });
      // The reader is at the top of a log 600 px tall in a 200 px view; the card is near its end.
      Object.defineProperty(log, "scrollHeight", { configurable: true, value: 600 });
      Object.defineProperty(log, "clientHeight", { configurable: true, value: 200 });
      const scrollTo = vi.fn();
      Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo });
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement
      ) {
        if (this === log) return new DOMRect(0, 100, 300, 200);
        if (this.matches("[data-confirm-card]")) return new DOMRect(0, 550, 300, 120);
        return new DOMRect(0, 0, 0, 0);
      });
      cardComes();
      // Its top 450 px down the log, its end at 570: the view moves to end there.
      expect(scrollTo).toHaveBeenCalledWith({ top: 370, behavior: "instant" });
      expect(intoView).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("scrolls nothing when drawn alone, outside a chat, and still takes focus from nothing", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<ConfirmCard allowApproveAll />);
    waiting(ADD);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("group"));
  });
});
