/**
 * The chat's one status line (src/components/agent/chat/chat-status.tsx):
 * always mounted, a polite live region holding the turn's phase alone, in
 * the third person: "Amr is thinking…", "Amr is working in {tool}…" (or
 * "Amr is working…" for a round reaching more than one tool), "Amr is
 * writing…", and empty when idle or while a card waits (the step says
 * "Waiting for you", and the card speaks for itself). The thinking picture is
 * apart from it: a wordless, aria-hidden balloon in the log.
 *
 * Then a scripted turn with a confirm, counting every change a screen reader
 * could hear: the status line's phases, and the app's own live regions
 * (LiveAnnouncerProvider), which say the turn once when it settles and
 * nothing for a card that took focus.
 */

import { Profiler, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { ChatProvider, useChat } from "@/components/agent/chat/chat-context";
import {
  AMR_THINKING,
  AMR_WORKING,
  AMR_WRITING,
  ChatStatus,
  amrWorkingIn,
  phaseText,
} from "@/components/agent/chat/chat-status";
import { ChatStrip, useAwaitingReply } from "@/components/agent/chat/chat-strip";
import { ThinkingItemView } from "@/components/agent/chat/chat-items";
import { NEEDS_OK, SPEAKER } from "@/components/agent/chat/use-turn-announcer";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage, ContentBlock, PendingToolUse } from "@/lib/agent/types";

const AT = "2026-11-16T09:00:00Z";

const you = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  content: [{ type: "text", text }],
  createdAt: AT,
});
const amr = (id: string, content: ContentBlock[]): ChatMessage => ({
  id,
  role: "assistant",
  content,
  createdAt: AT,
});
const words = (text: string, note?: true): ContentBlock => ({ type: "text", text, note });
const addCard = (id: string): ContentBlock => ({
  type: "tool_use",
  id,
  name: "tool_retro_add_card",
  input: { text: "flaky CI" },
});
const result = (id: string, toolUseId: string): ChatMessage => ({
  id,
  role: "tool",
  content: [{ type: "tool_result", tool_use_id: toolUseId, content: '{"added":true}' }],
  createdAt: AT,
});

/** The card for `toolUseId`, whose answer clears it as the client's settle does (once). */
const card = (toolUseId: string, settled = { done: false }): PendingToolUse => ({
  toolUseId,
  actionId: "tool_retro_add_card",
  resolvedActionId: "tool.retro.add_card",
  input: { text: "flaky CI" },
  prompt: {
    verb: "Add card",
    title: "Retro Board",
    question: "Add a card to Retro Board?",
    detail: "Text: “flaky CI”",
    destructive: false,
  },
  resolve: () => {
    if (settled.done) return;
    settled.done = true;
    useAgentStore.getState().setPendingToolUse(null);
  },
});

const store = () => useAgentStore.getState();

beforeEach(() => {
  store().reset();
  useAgentStore.setState({ chatProfile: "owner", open: true });
});

afterEach(() => {
  store().reset();
  useAgentStore.setState({ open: false });
});

// ── The phases ──────────────────────────────────────────────────────────

describe("phaseText", () => {
  const asked = [you("u1", "Add flaky CI to my retro")];

  it("is empty between turns, whatever the chat holds", () => {
    expect(phaseText([], false, false)).toBe("");
    expect(phaseText([...asked, amr("a1", [words("Done.")])], false, false)).toBe("");
  });

  it("says Amr is thinking from the send until his reply begins", () => {
    // A visitor's turn still starting has no message of its own yet.
    expect(phaseText([], true, false)).toBe(AMR_THINKING);
    expect(phaseText(asked, true, false)).toBe(AMR_THINKING);
    expect(phaseText([...asked, amr("a1", [])], true, false)).toBe(AMR_THINKING);
    expect(phaseText([...asked, amr("a1", [words("  ")])], true, false)).toBe(AMR_THINKING);
  });

  it("names the tool while a call is written or runs", () => {
    const calling = [...asked, amr("a1", [words("Adding it."), addCard("c1")])];
    expect(phaseText(calling, true, false)).toBe("Amr is working in Retro Board…");
    expect(amrWorkingIn("Retro Board")).toBe("Amr is working in Retro Board…");
  });

  it("names no one tool for a round whose calls reach more than one", () => {
    // The client runs a round's calls one at a time and answers them together,
    // so while the retro card is added the last call is the sprint's.
    const createSprint: ContentBlock = {
      type: "tool_use",
      id: "c2",
      name: "workspace_sprint_create",
      input: {},
    };
    const mixed = [...asked, amr("a1", [words("On it."), addCard("c1"), createSprint])];
    expect(phaseText(mixed, true, false)).toBe(AMR_WORKING);
    expect(phaseText([...asked, amr("a1", [addCard("c1"), createSprint])], true, false)).toBe(
      AMR_WORKING
    );
    // Two calls to the same tool still name it.
    const twice = [...asked, amr("a1", [addCard("c1"), addCard("c2")])];
    expect(phaseText(twice, true, false)).toBe("Amr is working in Retro Board…");
  });

  it("is empty while a card waits: the step and the card say it", () => {
    const calling = [...asked, amr("a1", [addCard("c1")])];
    expect(phaseText(calling, true, true)).toBe("");
  });

  it("says Amr is thinking again between rounds, and writing as his words stream in", () => {
    const answered = [...asked, amr("a1", [addCard("c1")]), result("t1", "c1")];
    expect(phaseText(answered, true, false)).toBe(AMR_THINKING);
    expect(phaseText([...answered, amr("a2", [words("Added")])], true, false)).toBe(AMR_WRITING);
  });

  it("reads a client's narration block as no words of his", () => {
    const standIn = [...asked, amr("a1", [words("Amr used all 6 tool rounds.", true)])];
    expect(phaseText(standIn, true, false)).toBe(AMR_THINKING);
  });

  it("never speaks in Amr's first person", () => {
    for (const line of [AMR_THINKING, AMR_WRITING, AMR_WORKING, amrWorkingIn("Retro Board")]) {
      expect(line).not.toMatch(/\b(I|I'm|me|my)\b/);
      expect(line.startsWith("Amr ")).toBe(true);
    }
  });
});

// ── The line ────────────────────────────────────────────────────────────

describe("ChatStatus", () => {
  it("is always mounted as one polite status, empty when idle", () => {
    render(<ChatStatus busy={false} />);
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveAttribute("data-chat-status", "");
    // Compact (a phone's keyboard up): off the screen, still heard.
    expect(status).toHaveClass("group-data-[amr-compact]/amr:sr-only");
    expect(status.className).not.toMatch(/(^|\s)(hidden|invisible)(\s|$)|animate-/);
  });

  it("holds the phase text only, and draws nothing again for a chunk that keeps it", () => {
    let renders = 0;
    act(() => {
      store().appendMessage(you("u1", "How do I run a retro?"));
      store().setStreaming(true);
    });
    render(
      <Profiler id="status" onRender={() => renders++}>
        <ChatStatus busy />
      </Profiler>
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(AMR_THINKING);
    expect(status.children).toHaveLength(0);

    act(() => store().appendMessage(amr("a1", [words("Start")])));
    expect(status).toHaveTextContent(AMR_WRITING);
    const drawn = renders;
    for (const text of [
      "Start with",
      "Start with what went well.",
      "Start with what went well. Then",
    ]) {
      act(() => store().patchMessage("a1", [words(text)]));
    }
    expect(renders).toBe(drawn);
    // The reply's words are never in it: they are read once, as the turn settles.
    expect(status).toHaveTextContent(/^Amr is writing…$/);
  });
});

// ── A scripted turn with a confirm ──────────────────────────────────────

function Footer() {
  const { composerId } = useChat();
  const streaming = useAgentStore((s) => s.streaming);
  return (
    <>
      <form>
        <textarea id={composerId} aria-label="Message" data-amr-composer="" readOnly={streaming} />
        <button type="button" data-chat-send="">
          {streaming ? "Stop answer" : "Send"}
        </button>
      </form>
      <ChatStatus busy={streaming} />
    </>
  );
}

/** The chat as both containers draw it: the strip, the thinking balloon, the footer with the status. */
function Chat({ children }: { children?: ReactNode }) {
  const streaming = useAgentStore((s) => s.streaming);
  const awaiting = useAwaitingReply(streaming);
  return (
    <ChatProvider profile="owner">
      <ChatStrip busy={streaming} footer={<Footer />}>
        {awaiting && <ThinkingItemView />}
        {children}
      </ChatStrip>
    </ChatProvider>
  );
}

/** Longer than the announcer's own wait (50 ms) before it fills a region. */
const quiet = () => act(() => new Promise<void>((done) => setTimeout(done, 80)));

let observers: MutationObserver[] = [];
afterEach(() => {
  observers.forEach((o) => o.disconnect());
  observers = [];
});

/** Every text a live region showed after a change, in order ("" for a change that emptied it). */
function hear(node: HTMLElement): string[] {
  const heard: string[] = [];
  const observer = new MutationObserver(() => heard.push(node.textContent ?? ""));
  observer.observe(node, { childList: true, characterData: true, subtree: true });
  observers.push(observer);
  return heard;
}

describe("a scripted turn with a confirm", () => {
  it("says each phase once, and the app's announcer says the turn once at its end", async () => {
    render(
      <LiveAnnouncerProvider>
        <Chat />
      </LiveAnnouncerProvider>
    );
    const status = screen.getByRole("status");
    const phases = hear(status);
    const polite = hear(screen.getByTestId("live-polite"));
    const assertive = hear(screen.getByTestId("live-assertive"));
    const log = screen.getByRole("log", { name: "Conversation" });
    // The only live regions: the status line and the app's own two. None in the log.
    expect(log).toHaveAttribute("aria-live", "off");
    expect(log.querySelectorAll('[role="status"], [role="alert"], [aria-live]')).toHaveLength(0);
    expect(log.contains(status)).toBe(false);

    // Asked: thinking, the scribble balloon in the log hidden from a screen reader.
    act(() => {
      store().appendMessage(you("u1", "Add flaky CI to my retro"));
      store().setStreaming(true);
    });
    await quiet();
    expect(log.querySelector('[data-thinking=""]')).toHaveAttribute("aria-hidden", "true");

    // The call streams in, then waits for its card.
    act(() => {
      store().appendMessage(amr("a1", [addCard("c1")]));
      store().setStreamingMessageId("a1");
    });
    await quiet();
    act(() => store().patchMessage("a1", [words("Adding it."), addCard("c1")]));
    await quiet();
    act(() => store().setPendingToolUse(card("c1")));
    await quiet();
    // Focus was on nothing: the card took it, so it is not announced.
    expect(document.activeElement?.closest("[data-confirm-card]")).not.toBeNull();
    expect(polite).toEqual([]);

    // Approved from the keyboard: focus goes on to the message box.
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message" }));
    await quiet();
    act(() => store().appendMessage(result("t1", "c1")));
    await quiet();
    act(() => {
      store().appendMessage(amr("a2", [words("Added")]));
      store().setStreamingMessageId("a2");
    });
    await quiet();
    for (const text of [
      "Added it",
      "Added it to Went well.",
      "Added it to Went well. Anything else?",
    ]) {
      act(() => store().patchMessage("a2", [words(text)]));
      await quiet();
    }
    act(() => store().setStreaming(false));
    await quiet();

    expect(phases).toEqual([
      AMR_THINKING,
      "Amr is working in Retro Board…",
      "",
      "Amr is working in Retro Board…",
      AMR_THINKING,
      AMR_WRITING,
      "",
    ]);
    expect(polite.filter(Boolean)).toEqual([
      `${SPEAKER} Adding it. Added it to Went well. Anything else?`,
    ]);
    expect(polite.some((text) => text.startsWith(NEEDS_OK))).toBe(false);
    expect(assertive.filter(Boolean)).toEqual([]);
  });

  it("is quiet while the card waits for someone typing, and the announcer reads the card once", async () => {
    render(
      <LiveAnnouncerProvider>
        <Chat />
      </LiveAnnouncerProvider>
    );
    const phases = hear(screen.getByRole("status"));
    const polite = hear(screen.getByTestId("live-polite"));
    act(() => {
      store().appendMessage(you("u1", "Add flaky CI to my retro"));
      store().setStreaming(true);
      store().appendMessage(amr("a1", [addCard("c1")]));
    });
    const box = screen.getByRole("textbox", { name: "Message" });
    act(() => box.focus());
    act(() => store().setPendingToolUse(card("c1")));
    await quiet();
    expect(document.activeElement).toBe(box);
    expect(phases.at(-1)).toBe("");
    expect(polite.filter(Boolean)).toEqual([`${NEEDS_OK} Add a card to Retro Board?`]);
  });
});
