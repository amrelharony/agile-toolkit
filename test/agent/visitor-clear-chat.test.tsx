/**
 * Clear chat in a visitor's chat (mascot/visitor-clear-chat, as
 * mascot/visitor-agent-panel wires it into the panel header). A visitor's
 * chat is never saved, so a clear goes through undoable(), whose toast offers
 * Undo, and leaves "Chat cleared · Undo" in the log: its Undo takes focus and
 * stays until the next message goes out. Either Undo puts the chat back while
 * it is still empty, and hands focus to Clear chat again; once a new message
 * has gone out there is nothing to put back, and the toast goes too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  toast: Object.assign(
    vi.fn<(label: unknown, opts?: { action?: { onClick(): void } }) => string>(() => "toast-1"),
    { dismiss: vi.fn<(id: unknown) => void>() }
  ),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/utils/toast", () => ({ toast: h.toast }));
vi.mock("@/lib/agent/visitor-runtime", () => ({
  sendVisitorMessage: vi.fn(async () => {}),
  abortInFlight: vi.fn(),
  retryVisitorTurn: vi.fn(async () => true),
  visitorGoOn: vi.fn(async () => true),
  canRetryLastTurn: vi.fn(() => true),
}));

import VisitorAgentPanel from "@/components/agent/mascot/visitor-agent-panel";
import { CHAT_CLEARED } from "@/components/agent/mascot/visitor-clear-chat";
import { PanelChrome } from "@/components/agent/mascot/panel-chrome";
import { PanelHeader } from "@/components/agent/mascot/panel-header";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";

const AT = "2026-11-16T09:00:00Z";
const CHAT: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    content: [{ type: "text", text: "How do I run a retro?" }],
    createdAt: AT,
  },
  {
    id: "a1",
    role: "assistant",
    content: [{ type: "text", text: "Start with what went well." }],
    createdAt: AT,
  },
];

function renderChat() {
  return render(
    <PanelChrome>
      <PanelHeader onClose={() => {}} />
      <VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />
    </PanelChrome>
  );
}

const header = () => document.querySelector<HTMLElement>("[data-panel-header]")!;
const clearButton = () => within(header()).getByRole("button", { name: "Clear chat" });
const caption = () => document.querySelector<HTMLElement>("[data-chat-cleared]");

/** The visitor's chat with a question and its answer, and a note under them. */
function chatUnderWay() {
  act(() => {
    useAgentStore.setState({ chatProfile: "visitor", messages: CHAT });
    useAgentStore
      .getState()
      .setNotice({ tone: "note", kind: "cut_off", text: "Amr's answer was cut short." });
  });
}

/** Clear chat, and wait for its caption (its chunk loads on the first press here). */
async function clear() {
  fireEvent.click(clearButton());
  await waitFor(() => expect(caption()).not.toBeNull());
  return caption()!;
}

beforeEach(() => {
  h.toast.mockClear();
  h.toast.dismiss.mockClear();
  useAgentStore.getState().reset();
  useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
  useAgentStore.getState().setDraft("visitor", "");
});

afterEach(() => {
  useAgentStore.getState().reset();
  useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
});

describe("Clear chat in a visitor's chat", () => {
  it("is offered in the header only while there is something to clear", () => {
    renderChat();
    expect(within(header()).queryByRole("button", { name: "Clear chat" })).toBeNull();
    chatUnderWay();
    expect(clearButton()).toBeInTheDocument();
  });

  it("empties the chat with an Undo toast, and leaves a focused Undo in a narration caption", async () => {
    renderChat();
    chatUnderWay();
    const shown = await clear();
    expect(useAgentStore.getState().messages).toEqual([]);
    expect(useAgentStore.getState().notice).toBeNull();
    // The toast: undoable()'s, named for what happened.
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast.mock.calls[0][0]).toBe(CHAT_CLEARED);
    expect(h.toast.mock.calls[0][1]).toMatchObject({ kind: "undo", action: { label: "Undo" } });
    // The caption: the narrator's line in the log, its Undo holding focus.
    expect(shown).toHaveAttribute("data-voice", "narration");
    expect(shown).toHaveTextContent(CHAT_CLEARED);
    expect(screen.getByRole("log", { name: "Conversation" })).toContainElement(shown);
    const undo = within(shown).getByRole("button", { name: "Undo" });
    expect(undo).toHaveFocus();
    expect(undo).toHaveClass("pointer-coarse:min-h-11");
    // Clear chat itself goes with the messages.
    expect(within(header()).queryByRole("button", { name: "Clear chat" })).toBeNull();
  });

  it("Undo puts the chat back as it was, and hands focus to Clear chat", async () => {
    renderChat();
    chatUnderWay();
    act(() => useAgentStore.setState({ visitorFallback: "site_busy" }));
    act(() => useAgentStore.getState().setDraft("visitor", "and the timer?"));
    const shown = await clear();
    expect(useAgentStore.getState().visitorFallback).toBeNull();
    expect(useAgentStore.getState().drafts.visitor).toBe("");

    fireEvent.click(within(shown).getByRole("button", { name: "Undo" }));
    const s = useAgentStore.getState();
    expect(s.messages).toEqual(CHAT);
    expect(s.notice).toMatchObject({ kind: "cut_off" });
    expect(s.visitorFallback).toBe("site_busy");
    expect(s.drafts.visitor).toBe("and the timer?");
    expect(caption()).toBeNull();
    expect(clearButton()).toHaveFocus();
    // Nothing is left to undo: the toast goes too.
    expect(h.toast.dismiss).toHaveBeenCalledWith("toast-1");
  });

  it("the toast's Undo does the same, and the caption goes", async () => {
    renderChat();
    chatUnderWay();
    await clear();
    act(() => h.toast.mock.calls[0][1]!.action!.onClick());
    expect(useAgentStore.getState().messages).toEqual(CHAT);
    expect(caption()).toBeNull();
  });

  it("stays until the next message goes out, which leaves nothing to undo", async () => {
    renderChat();
    chatUnderWay();
    await clear();
    // Closing and opening the panel keeps it, and its Undo doesn't take focus again.
    const box = screen.getByLabelText("Message");
    box.focus();
    act(() => useAgentStore.getState().closeSheet());
    act(() => useAgentStore.getState().openSheet());
    expect(caption()).not.toBeNull();
    expect(box).toHaveFocus();

    // The visitor asks something new (as the runtime would put it in).
    const next: ChatMessage = {
      id: "u2",
      role: "user",
      content: [{ type: "text", text: "What is WSJF?" }],
      createdAt: AT,
    };
    act(() => useAgentStore.setState({ messages: [next] }));
    expect(caption()).toBeNull();
    expect(h.toast.dismiss).toHaveBeenCalledWith("toast-1");
    // A late Undo from the toast puts nothing over the new chat.
    act(() => h.toast.mock.calls[0][1]!.action!.onClick());
    expect(useAgentStore.getState().messages).toEqual([next]);
  });

  it("stops the answer under way through the store before the chat empties", async () => {
    renderChat();
    chatUnderWay();
    const abortTurn = vi.fn();
    act(() => {
      useAgentStore.setState({ streaming: true });
      useAgentStore.getState().setAbortTurn(abortTurn);
    });
    await clear();
    expect(abortTurn).toHaveBeenCalledTimes(1);
    expect(abortTurn).toHaveBeenCalledWith("reset");
    expect(useAgentStore.getState().streaming).toBe(false);
  });
});
