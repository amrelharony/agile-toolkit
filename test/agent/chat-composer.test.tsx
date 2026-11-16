/**
 * The composer both chats share (src/components/agent/chat/chat-composer.tsx,
 * design 1.3 item 8): keys by pointer (bare Enter sends only with a mouse,
 * Ctrl/Cmd+Enter always, never mid-composition), a box that stays editable
 * while Amr answers, one Send/Stop button that ignores held keys and presses
 * right after it swaps, a touch screen's box letting go of focus after a tap
 * on Send, autosize to its cap, a still mic whose dictation adds to the box,
 * a status row whose one live part is its note, the characters left said at
 * 100 and at none, 44 px controls on touch, and focus after New chat or a
 * consent yes, even on a touch screen.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatProvider } from "@/components/agent/chat/chat-context";
import {
  ANNOUNCE_LEFT,
  COUNTER_FROM,
  ChatComposer,
  KEY_HINT,
  SEND_LABEL,
  STOP_LABEL,
  SWAP_GUARD_MS,
  charactersLeft,
  cutTo,
  focusComposerAfterNewChat,
  type ChatComposerProps,
} from "@/components/agent/chat/chat-composer";
import {
  DICTATE_LABEL,
  DictateButton,
  LISTENING_NOTE,
} from "@/components/agent/chat/dictate-button";
import { DANCE_NOTE } from "@/components/agent/mascot/engine/customization/chat-commands";
import { useAgentStore, type ChatProfile } from "@/lib/agent/store";

const h = vi.hoisted(() => ({
  announce: vi.fn(),
  onSend: vi.fn<(text: string, raw: string) => void>(),
  onStop: vi.fn(),
}));

vi.mock("@/components/a11y/live-announcer", () => ({
  useAnnounce: () => h.announce,
}));

type Props = Partial<ChatComposerProps> & { profile?: ChatProfile };

function Composer({ profile = "owner", ...props }: Props) {
  return (
    <ChatProvider profile={profile}>
      <ChatComposer busy={false} onSend={h.onSend} onStop={h.onStop} {...props} />
    </ChatProvider>
  );
}

/** The composer inside a panel whose visible box is `visible` px tall. */
function InPanel({ visible, ...props }: Props & { visible: number }) {
  return (
    <div data-amr-layout="sheet" style={{ ["--amr-visible-h" as string]: `${visible}px` }}>
      <Composer {...props} />
    </div>
  );
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const draft = (profile: ChatProfile = "owner") => useAgentStore.getState().drafts[profile];
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const sendButton = () => document.querySelector<HTMLButtonElement>("[data-chat-send]")!;

/** The page on a touch screen: (pointer: coarse) matches, nothing else does. */
const touchScreen = () =>
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList
  );

/** A clock the test moves by hand (the swap guard reads Date.now). */
function handClock() {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    tick(ms: number) {
      now += ms;
    },
  };
}

beforeEach(() => {
  h.announce.mockClear();
  h.onSend.mockClear();
  h.onStop.mockClear();
  useAgentStore.getState().reset();
  useAgentStore.getState().setDraft("owner", "");
  useAgentStore.getState().setDraft("visitor", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  useAgentStore.getState().reset();
  delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe("the box", () => {
  it("is one row of its chat's draft, labelled, with a new line on a phone's return key and dir auto", () => {
    useAgentStore.getState().setDraft("visitor", "kept from before");
    render(<Composer profile="visitor" />);
    expect(box()).toHaveValue("kept from before");
    expect(box()).toHaveAttribute("rows", "1");
    expect(box()).toHaveAttribute("enterkeyhint", "enter");
    expect(box()).toHaveAttribute("dir", "auto");
    expect(box()).toHaveAttribute("placeholder", "Ask Amr…");
    expect(box()).toHaveAttribute("data-amr-composer");
    // The chat context finds it by its id.
    expect(box().id).not.toBe("");
    type("and the timer");
    expect(draft("visitor")).toBe("and the timer");
    expect(draft("owner")).toBe("");
  });

  it("stays editable while Amr answers: only sending waits", () => {
    useAgentStore.getState().setDraft("owner", "next question");
    render(<Composer busy />);
    expect(box()).not.toBeDisabled();
    expect(box()).not.toHaveAttribute("readonly");
    type("next question, and more");
    expect(draft()).toBe("next question, and more");
    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true })).toBe(false);
    expect(h.onSend).not.toHaveBeenCalled();
    expect(draft()).toBe("next question, and more");
  });

  it("grows to its cap, 35% of a short visible box, and scrolls past it", () => {
    const tall = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(1000);
    render(<InPanel visible={300} />);
    type("a long message ".repeat(80));
    // jsdom lays nothing out: one line is 24 px (1.5 × 16), with no padding.
    expect(box().style.height).toBe(`${300 * 0.35}px`);
    expect(box().style.overflowY).toBe("auto");
    tall.mockReturnValue(24);
    type("short");
    expect(box().style.height).toBe("24px");
    expect(box().style.overflowY).toBe("hidden");
  });
});

describe("keys", () => {
  it("sends on a bare Enter with a mouse, emptying the box and keeping focus in it", () => {
    render(<Composer />);
    expect(box()).toHaveFocus();
    type("  Plan the sprint ");
    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(false);
    expect(h.onSend).toHaveBeenCalledWith("Plan the sprint", "  Plan the sprint ");
    expect(box()).toHaveValue("");
    expect(box()).toHaveFocus();
  });

  it("leaves Shift+Enter to the box as a new line, and an empty box sends nothing", () => {
    render(<Composer />);
    type("first line");
    expect(fireEvent.keyDown(box(), { key: "Enter", shiftKey: true })).toBe(true);
    expect(h.onSend).not.toHaveBeenCalled();
    type("   ");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(h.onSend).not.toHaveBeenCalled();
  });

  it("makes a bare Enter a new line on a touch screen, where Ctrl+Enter or Cmd+Enter still sends", () => {
    touchScreen();
    render(<Composer />);
    type("two lines");
    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(true);
    expect(h.onSend).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true })).toBe(false);
    expect(h.onSend).toHaveBeenCalledTimes(1);
    type("again");
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    expect(h.onSend).toHaveBeenCalledTimes(2);
  });

  it("sends nothing while an input method is composing", () => {
    render(<Composer />);
    type("日本");
    expect(fireEvent.keyDown(box(), { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 })).toBe(true);
    expect(h.onSend).not.toHaveBeenCalled();
    expect(draft()).toBe("日本");
  });

  it("sends once for a held Enter: its repeats are cancelled, so no blank lines either", () => {
    render(<Composer />);
    type("once");
    fireEvent.keyDown(box(), { key: "Enter" });
    // The box it just emptied: a repeat types no new line into it.
    expect(fireEvent.keyDown(box(), { key: "Enter", repeat: true })).toBe(false);
    expect(draft()).toBe("");
    type("twice?");
    expect(fireEvent.keyDown(box(), { key: "Enter", repeat: true })).toBe(false);
    expect(fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true, repeat: true })).toBe(false);
    expect(h.onSend).toHaveBeenCalledTimes(1);
    expect(draft()).toBe("twice?");
    // A held Shift+Enter is still the box's own new line.
    expect(fireEvent.keyDown(box(), { key: "Enter", shiftKey: true, repeat: true })).toBe(true);
  });

  it("says the keys on a fine pointer only, and the chat's own words after them", () => {
    render(<Composer footnote="Amr asks before deleting or resetting anything" />);
    const hint = screen.getByText(KEY_HINT, { exact: false });
    expect(hint).toHaveClass("pointer-coarse:hidden");
    expect(hint.parentElement).toHaveTextContent(
      `${KEY_HINT} · Amr asks before deleting or resetting anything`
    );
  });
});

describe("the Send/Stop button", () => {
  it("is one element, Send or Stop answer, aria-disabled (never disabled) when it can't act", () => {
    const view = render(<Composer />);
    const button = sendButton();
    expect(button).toHaveAccessibleName(SEND_LABEL);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("type", "button");
    type("go");
    expect(button).not.toHaveAttribute("aria-disabled");

    view.rerender(<Composer busy />);
    expect(sendButton()).toBe(button);
    expect(button).toHaveAccessibleName(STOP_LABEL);
    expect(button).not.toHaveAttribute("aria-disabled");

    // A turn still loading has nothing to stop yet.
    view.rerender(<Composer busy canStop={false} />);
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("does nothing when aria-disabled", () => {
    render(<Composer ready={false} />);
    type("signed out");
    fireEvent.click(sendButton());
    expect(h.onSend).not.toHaveBeenCalled();
    expect(draft()).toBe("signed out");
  });

  it("ignores a press within 400 ms of a swap, either way", () => {
    const clock = handClock();
    const view = render(<Composer />);
    type("Plan it");
    view.rerender(<Composer busy />);
    // A double click meant for Send lands on Stop: ignored.
    fireEvent.click(sendButton());
    clock.tick(SWAP_GUARD_MS - 1);
    fireEvent.click(sendButton());
    expect(h.onStop).not.toHaveBeenCalled();
    clock.tick(1);
    fireEvent.click(sendButton());
    expect(h.onStop).toHaveBeenCalledTimes(1);

    // The answer ends: a press meant for Stop never sends the draft.
    view.rerender(<Composer />);
    expect(sendButton()).toHaveAccessibleName(SEND_LABEL);
    fireEvent.click(sendButton());
    expect(h.onSend).not.toHaveBeenCalled();
    clock.tick(SWAP_GUARD_MS);
    fireEvent.click(sendButton());
    expect(h.onSend).toHaveBeenCalledWith("Plan it", "Plan it");
  });

  it("presses once for a held key: its repeats are cancelled", () => {
    render(<Composer />);
    expect(fireEvent.keyDown(sendButton(), { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(sendButton(), { key: "Enter", repeat: true })).toBe(false);
    expect(fireEvent.keyDown(sendButton(), { key: " ", repeat: true })).toBe(false);
    // Other keys held on it still do what they do.
    expect(fireEvent.keyDown(sendButton(), { key: "Tab", repeat: true })).toBe(true);
  });

  it("lets go of the box after a tap on Send on a touch screen, so the keyboard goes down", () => {
    touchScreen();
    render(<Composer />);
    box().focus();
    type("from a phone");
    fireEvent.click(sendButton(), { detail: 1 });
    expect(h.onSend).toHaveBeenCalledTimes(1);
    expect(box()).not.toHaveFocus();
  });

  it("keeps focus and the caret in the box through a click with a mouse, on Send and on Stop", () => {
    const clock = handClock();
    const view = render(<Composer />);
    box().focus();
    type("from a desk");
    // Chromium and Firefox would move focus to the button on mousedown: cancelled.
    expect(fireEvent.mouseDown(sendButton(), { button: 0 })).toBe(false);
    fireEvent.click(sendButton(), { detail: 1 });
    expect(h.onSend).toHaveBeenCalledTimes(1);
    expect(box()).toHaveFocus();

    // The button is Stop now: typing goes on in the box, and a click stops.
    view.rerender(<Composer busy />);
    expect(box()).toHaveFocus();
    type("and then");
    box().setSelectionRange(3, 3);
    clock.tick(SWAP_GUARD_MS);
    expect(fireEvent.mouseDown(sendButton(), { button: 0 })).toBe(false);
    fireEvent.click(sendButton(), { detail: 1 });
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(box()).toHaveFocus();
    expect(box().selectionStart).toBe(3);

    // Another mouse button, or focus elsewhere, is left alone.
    expect(fireEvent.mouseDown(sendButton(), { button: 2 })).toBe(true);
    sendButton().focus();
    expect(fireEvent.mouseDown(sendButton(), { button: 0 })).toBe(true);
  });

  it("leaves a touch screen's mousedown alone, so a tap still lets go of the box", () => {
    touchScreen();
    render(<Composer />);
    box().focus();
    type("from a phone");
    expect(fireEvent.mouseDown(sendButton(), { button: 0 })).toBe(true);
  });

  it("is 44 px on a touch screen, and so is the mic", () => {
    (window as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
    render(<Composer mic={DictateButton} />);
    for (const control of [sendButton(), screen.getByRole("button", { name: DICTATE_LABEL })]) {
      expect(control).toHaveClass("min-h-[44px]", "min-w-[44px]");
    }
  });
});

describe("chat commands", () => {
  it("acts out dance itself: the box empties and the live note says so, and nothing is sent", () => {
    render(<Composer />);
    type("/dance");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(h.onSend).not.toHaveBeenCalled();
    expect(box()).toHaveValue("");
    const note = document.querySelector("[data-composer-note]")!;
    expect(note).toHaveTextContent(DANCE_NOTE);
    expect(note).toHaveAttribute("aria-live", "polite");

    // Dance again: the same words are a new node, so the live span says them again.
    const first = note.firstElementChild;
    expect(first).toHaveTextContent(DANCE_NOTE);
    type("dance");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(note).toHaveTextContent(DANCE_NOTE);
    expect(note.firstElementChild).not.toBeNull();
    expect(note.firstElementChild).not.toBe(first);
    expect(note.children).toHaveLength(1);

    // The next send takes the note away.
    type("what next?");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(note).toBeEmptyDOMElement();
    expect(h.onSend).toHaveBeenCalledWith("what next?", "what next?");
  });
});

describe("the status row", () => {
  it("has one live part, the note: the tool and the chat's own status sit outside it", () => {
    render(
      <Composer
        tool="Retro Board"
        status={<span data-testid="allowance">12 of 25 left today</span>}
        maxLength={2000}
      />
    );
    const row = document.querySelector<HTMLElement>("[data-composer-status]")!;
    const live = row.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveAttribute("data-composer-note");
    expect(row).toHaveTextContent("On Retro Board · 12 of 25 left today");
    expect(live[0]).not.toContainElement(screen.getByTestId("allowance"));
    expect(screen.getByText("On Retro Board").closest("[aria-live]")).toBeNull();
    // Nothing in the row is a status of its own: the chat's one status line is apart.
    expect(row.querySelector('[role="status"]')).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("counts the characters left near the limit, in the box's description, said at 100 and at none", () => {
    render(<Composer profile="visitor" maxLength={2000} />);
    type("a".repeat(2000 - COUNTER_FROM - 1));
    expect(document.querySelector("[data-composer-left]")).toBeNull();
    expect(box()).not.toHaveAttribute("aria-describedby");

    type("a".repeat(2000 - COUNTER_FROM));
    const left = document.querySelector<HTMLElement>("[data-composer-left]")!;
    expect(left).toHaveTextContent(charactersLeft(COUNTER_FROM));
    expect(box()).toHaveAttribute("aria-describedby", left.id);
    expect(left.closest("[aria-live]")).toBeNull();
    expect(h.announce).not.toHaveBeenCalled();

    type("a".repeat(2000 - ANNOUNCE_LEFT - 1));
    expect(h.announce).not.toHaveBeenCalled();
    type("a".repeat(2000 - ANNOUNCE_LEFT));
    expect(h.announce).toHaveBeenCalledTimes(1);
    expect(h.announce).toHaveBeenLastCalledWith("100 characters left");
    type("a".repeat(1990));
    expect(h.announce).toHaveBeenCalledTimes(1);
    type("a".repeat(2000));
    expect(h.announce).toHaveBeenCalledTimes(2);
    expect(h.announce).toHaveBeenLastCalledWith("No characters left");
    expect(document.querySelector("[data-composer-left]")).toHaveTextContent("No characters left");
    // Back under the limit and up to it again: said again, once.
    type("a".repeat(1999));
    type("a".repeat(2000));
    expect(h.announce).toHaveBeenCalledTimes(3);
  });

  it("says when a paste was cut to the limit", () => {
    render(<Composer profile="visitor" maxLength={2000} />);
    type("a".repeat(1990));
    box().setSelectionRange(1990, 1990);
    fireEvent.paste(box(), { clipboardData: { getData: () => "b".repeat(20) } });
    expect(document.querySelector("[data-composer-note]")).toHaveTextContent(cutTo(2000));
    expect(cutTo(2000)).toBe("Cut to 2,000 characters");
  });

  it("says nothing of a paste that fits", () => {
    render(<Composer profile="visitor" maxLength={2000} />);
    type("a".repeat(1990));
    box().setSelectionRange(1990, 1990);
    fireEvent.paste(box(), { clipboardData: { getData: () => "b".repeat(10) } });
    expect(document.querySelector("[data-composer-note]")).toBeEmptyDOMElement();
  });
});

/** A stand-in for the browser's SpeechRecognition, keeping the last one made. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = true;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
  /** What the browser heard so far, in one result. */
  hear(transcript: string, isFinal = false) {
    const result = Object.assign([{ transcript }], { isFinal });
    this.onresult?.({ results: [result] });
  }
}

describe("the mic", () => {
  beforeEach(() => {
    (window as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
  });

  it("is a still toggle named Dictate: aria-pressed and a Listening note, never a pulse", () => {
    const view = render(<Composer mic={DictateButton} />);
    const mic = screen.getByRole("button", { name: DICTATE_LABEL });
    expect(mic).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(mic);
    expect(mic).toHaveAccessibleName(DICTATE_LABEL);
    expect(mic).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector("[data-composer-note]")).toHaveTextContent(LISTENING_NOTE);
    expect(view.container.innerHTML).not.toMatch(/animate-/);
    // Pressed again, it stops, and the note goes with it.
    fireEvent.click(mic);
    expect(FakeRecognition.last?.stop).toHaveBeenCalled();
    expect(mic).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("[data-composer-note]")).toBeEmptyDOMElement();
  });

  it("adds what it hears after what was typed, as the words firm up", () => {
    useAgentStore.getState().setDraft("owner", "Add to the retro:");
    render(<Composer mic={DictateButton} />);
    fireEvent.click(screen.getByRole("button", { name: DICTATE_LABEL }));
    act(() => FakeRecognition.last!.hear("flaky"));
    expect(draft()).toBe("Add to the retro: flaky");
    act(() => FakeRecognition.last!.hear("flaky CI builds", true));
    expect(draft()).toBe("Add to the retro: flaky CI builds");
  });

  it("stops at a send, and drops what it hears after, so the message sent never comes back", () => {
    render(<Composer mic={DictateButton} />);
    const mic = screen.getByRole("button", { name: DICTATE_LABEL });
    fireEvent.click(mic);
    const rec = FakeRecognition.last!;
    act(() => rec.hear("plan"));
    expect(draft()).toBe("plan");
    // Enter while the words are still firming up.
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(h.onSend).toHaveBeenCalledWith("plan", "plan");
    expect(rec.stop).toHaveBeenCalled();
    expect(mic).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("[data-composer-note]")).toBeEmptyDOMElement();
    // The recognizer's last word comes in late: dropped.
    act(() => rec.hear("plan the sprint", true));
    expect(draft()).toBe("");
  });

  it("stops at a chat command sent from the box too", () => {
    render(<Composer mic={DictateButton} />);
    fireEvent.click(screen.getByRole("button", { name: DICTATE_LABEL }));
    const rec = FakeRecognition.last!;
    act(() => rec.hear("dance"));
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(h.onSend).not.toHaveBeenCalled();
    expect(rec.stop).toHaveBeenCalled();
    act(() => rec.hear("dance", true));
    expect(draft()).toBe("");
    expect(document.querySelector("[data-composer-note]")).toHaveTextContent(DANCE_NOTE);
  });

  it("lets the reader's typing win: it stops and drops what it hears after", () => {
    render(<Composer mic={DictateButton} />);
    fireEvent.click(screen.getByRole("button", { name: DICTATE_LABEL }));
    const rec = FakeRecognition.last!;
    act(() => rec.hear("flaky"));
    type("flaky x");
    act(() => rec.hear("flaky CI", true));
    expect(draft()).toBe("flaky x");
    expect(rec.stop).toHaveBeenCalled();
    act(() => rec.hear("flaky CI builds", true));
    expect(draft()).toBe("flaky x");
  });

  it("keeps the words still to come when its own press stops it", () => {
    render(<Composer mic={DictateButton} />);
    const mic = screen.getByRole("button", { name: DICTATE_LABEL });
    fireEvent.click(mic);
    const rec = FakeRecognition.last!;
    act(() => rec.hear("add a"));
    fireEvent.click(mic);
    expect(rec.stop).toHaveBeenCalled();
    act(() => rec.hear("add a card", true));
    expect(draft()).toBe("add a card");
  });

  it("works while Amr answers, and cuts what it hears to the box's limit", () => {
    render(<Composer busy mic={DictateButton} maxLength={10} profile="visitor" />);
    fireEvent.click(screen.getByRole("button", { name: DICTATE_LABEL }));
    act(() => FakeRecognition.last!.hear("a sentence far too long"));
    expect(draft("visitor")).toBe("a sentence");
    expect(document.querySelector("[data-composer-note]")).toHaveTextContent(cutTo(10));
  });

  it("says a failure in plain words in the note", () => {
    render(<Composer mic={DictateButton} />);
    fireEvent.click(screen.getByRole("button", { name: DICTATE_LABEL }));
    act(() => FakeRecognition.last!.onerror?.({ error: "not-allowed" }));
    expect(document.querySelector("[data-composer-note]")).toHaveTextContent(
      /Microphone access was blocked\./
    );
  });

  it("moves to the box's leading side below 360 px", () => {
    render(<Composer mic={DictateButton} />);
    const wrap = screen.getByRole("button", { name: DICTATE_LABEL }).parentElement!;
    expect(wrap).toHaveClass("max-[359px]:order-first");
    expect(wrap.parentElement?.tagName).toBe("FORM");
  });

  it("isn't there where the browser has no dictation", () => {
    delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
    render(<Composer mic={DictateButton} />);
    expect(screen.queryByRole("button", { name: DICTATE_LABEL })).toBeNull();
  });
});

describe("focus", () => {
  it("takes no focus as it opens on a touch screen, so no keyboard rises", () => {
    touchScreen();
    render(<Composer />);
    expect(box()).not.toHaveFocus();
  });

  it("takes focus as it opens when the reader asked to type, even on a touch screen", () => {
    touchScreen();
    useAgentStore.getState().setDraft("visitor", "half");
    render(<Composer profile="visitor" takeFocus />);
    expect(box()).toHaveFocus();
    expect(box().selectionStart).toBe(4);
  });

  it("New chat puts focus in the box showing, even on a touch screen", () => {
    touchScreen();
    render(<Composer />);
    expect(box()).not.toHaveFocus();
    focusComposerAfterNewChat();
    expect(box()).toHaveFocus();
  });

  it("New chat from History puts focus in the box that mounts next, but not one long after", () => {
    touchScreen();
    const clock = handClock();
    focusComposerAfterNewChat();
    const first = render(<Composer />);
    expect(box()).toHaveFocus();
    first.unmount();

    // Asked once: the next box to mount takes nothing.
    const second = render(<Composer />);
    expect(box()).not.toHaveFocus();
    second.unmount();

    // A request no box came for in time is dropped.
    focusComposerAfterNewChat();
    clock.tick(5000);
    render(<Composer />);
    expect(box()).not.toHaveFocus();
  });
});
