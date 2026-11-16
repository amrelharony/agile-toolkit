/**
 * What the chat says out loud (src/components/agent/chat/use-turn-announcer.ts,
 * wired into chat-frame.tsx): one polite announcement per settled turn, with
 * the turn's own words as plain text, cut to a sensible length; nothing while
 * a reply streams; nothing for a waiting card that took focus, and "Amr needs
 * your OK: ..." for one that didn't; an error at once and assertively, with
 * nothing more for its turn; nothing for a thread loaded or a chat swapped
 * under its turn.
 *
 * A MutationObserver on the app's two live regions (LiveAnnouncerProvider)
 * counts every change a screen reader could hear while a scripted turn runs
 * through the agent store, as the client's turn writes it.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
// The parts that draw messages (the owner's chat and a visitor's runtime bring them).
import "@/components/agent/chat/strip-kit";
import { ChatProvider, useChat } from "@/components/agent/chat/chat-context";
import { ChatFrame } from "@/components/agent/chat/chat-frame";
import {
  ANNOUNCE_MAX,
  CODE_WORDS,
  NEEDS_OK,
  REST_IN_LOG,
  SPEAKER,
  TABLE_WORDS,
  clipSpoken,
  spokenText,
  turnAnnouncement,
} from "@/components/agent/chat/use-turn-announcer";
import { createChatView } from "@/lib/agent/chat-view";
import { useAgentStore, type AgentNotice } from "@/lib/agent/store";
import type {
  ChatMessage,
  ContentBlock,
  ConversationMeta,
  PendingToolUse,
} from "@/lib/agent/types";

const AT = "2026-11-12T09:00:00Z";

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
const words = (text: string): ContentBlock => ({ type: "text", text });
const call = (id: string): ContentBlock => ({
  type: "tool_use",
  id,
  name: "retro_board_add_card",
  input: { text: "flaky CI" },
});
const result = (id: string, toolUseId: string): ChatMessage => ({
  id,
  role: "tool",
  content: [{ type: "tool_result", tool_use_id: toolUseId, content: '{"ok":true}' }],
  createdAt: AT,
});

const meta = (id: string): ConversationMeta => ({
  id,
  title: "Retro help",
  toolId: null,
  createdAt: AT,
  updatedAt: AT,
  lastMessageAt: AT,
});

const card = (toolUseId: string, resolve = vi.fn()): PendingToolUse => ({
  toolUseId,
  actionId: "retro_board_add_card",
  resolvedActionId: "retro-board.add_card",
  input: { text: "flaky CI" },
  prompt: {
    verb: "Add card",
    title: "Retro Board",
    question: "Add a card to Retro Board?",
    detail: "Text: “flaky CI”",
    destructive: false,
  },
  resolve,
});

const CUT_OFF: AgentNotice = {
  tone: "note",
  kind: "cut_off",
  text: "The answer stopped short. Go on picks it up.",
};
const FAILED: AgentNotice = {
  tone: "error",
  kind: "stream_failed",
  text: "The answer stopped: the connection dropped.",
};

const store = () => useAgentStore.getState();

// ── The chat, as a container draws it ───────────────────────────────────

function Composer() {
  const { composerId } = useChat();
  return (
    <form>
      <textarea id={composerId} aria-label="Message" data-amr-composer="" />
      <button type="button">Stop answer</button>
    </form>
  );
}

function Chat() {
  const messages = useAgentStore((s) => s.messages);
  const streaming = useAgentStore((s) => s.streaming);
  const streamingId = useAgentStore((s) => s.streamingMessageId);
  const pendingId = useAgentStore((s) => s.pendingToolUse?.toolUseId ?? null);
  const [view] = useState(createChatView);
  const items = view(messages, { streamingId, busy: streaming, pendingId });
  return (
    // The log draws the confirm card, under its step; it takes focus itself
    // as it comes, when focus is on nothing (confirm-card).
    <ChatFrame items={items} busy={streaming} footer={<Composer />} />
  );
}

// ── Ears on the live regions ────────────────────────────────────────────

type Region = "polite" | "assertive";

interface Ears {
  /** What each region said: its text after each change that left it saying something. */
  heard: Record<Region, string[]>;
  /** Every change to either region, said or cleared. */
  changes(): number;
}

let observers: MutationObserver[] = [];

function listen(): Ears {
  const heard: Record<Region, string[]> = { polite: [], assertive: [] };
  let changes = 0;
  for (const region of ["polite", "assertive"] as const) {
    const node = screen.getByTestId(`live-${region}`);
    const observer = new MutationObserver((records) => {
      changes += records.length;
      const text = node.textContent ?? "";
      if (text) heard[region].push(text);
    });
    observer.observe(node, { childList: true, characterData: true, subtree: true });
    observers.push(observer);
  }
  return { heard, changes: () => changes };
}

function mount(): Ears {
  render(
    <LiveAnnouncerProvider>
      <ChatProvider profile="owner">
        <Chat />
      </ChatProvider>
    </LiveAnnouncerProvider>
  );
  return listen();
}

/** Longer than the announcer's own wait (50 ms) before it fills a region. */
const quiet = () => act(() => new Promise<void>((done) => setTimeout(done, 80)));

/** The reader sends a question: the client adds it, clears the notice and starts streaming, at once. */
async function ask(id: string, text: string) {
  act(() => {
    store().appendMessage(you(id, text));
    store().setNotice(null);
    store().setStreaming(true);
  });
  await quiet();
}

/** A reply starts in its own message, streamed by id. */
async function replyIn(id: string, content: ContentBlock[] = []) {
  act(() => {
    store().appendMessage(amr(id, content));
    store().setStreamingMessageId(id);
  });
  await quiet();
}

/** One streamed flush: the reply's content so far. */
async function flush(id: string, content: ContentBlock[]) {
  act(() => store().patchMessage(id, content));
  await quiet();
}

/** The turn is over: the client clears streaming last, after any notice. */
async function settle(notice?: AgentNotice) {
  act(() => {
    if (notice) store().setNotice(notice);
    store().setStreaming(false);
  });
  await quiet();
}

beforeEach(() => {
  store().reset();
  useAgentStore.setState({ chatProfile: "owner", open: true });
});

afterEach(() => {
  observers.forEach((observer) => observer.disconnect());
  observers = [];
  store().reset();
  useAgentStore.setState({ open: false });
});

// ── A turn ──────────────────────────────────────────────────────────────

describe("a streamed turn", () => {
  it("is announced exactly once, when it settles, and never while it streams", async () => {
    const ears = mount();
    await ask("u1", "How do I run a retro?");
    await replyIn("a1");
    for (const text of [
      "Start",
      "Start with **what went",
      "Start with **what went well**. Then ask",
      "Start with **what went well**. Then ask what to change.",
    ]) {
      await flush("a1", [words(text)]);
      expect(ears.changes()).toBe(0);
    }

    await settle();
    expect(ears.heard.polite).toEqual([
      `${SPEAKER} Start with what went well. Then ask what to change.`,
    ]);
    expect(ears.heard.assertive).toEqual([]);

    // Nothing after it, however long the chat sits.
    await quiet();
    expect(ears.heard.polite).toHaveLength(1);
  });

  it("has no live region of its own: the log is off and nothing inside it speaks", async () => {
    mount();
    await ask("u1", "How do I run a retro?");
    await replyIn("a1", [words("Start with what went well.")]);
    const frame = document.querySelector("[data-chat-frame]") as HTMLElement;
    expect(screen.getByRole("log", { name: "Conversation" })).toHaveAttribute("aria-live", "off");
    expect(frame.querySelectorAll('[aria-live]:not([aria-live="off"])')).toHaveLength(0);
    expect(frame.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(0);
  });

  it("speaks only the turn's own words, across its tool rounds, never an earlier reply", async () => {
    act(() =>
      store().setActiveConversation(meta("c1"), [
        you("u0", "Hi"),
        amr("a0", [words("Hello. Ask me about retros.")]),
      ])
    );
    const ears = mount();
    await quiet();
    expect(ears.changes()).toBe(0);

    await ask("u1", "Add a card saying flaky CI.");
    await replyIn("a1", [words("Adding it now.")]);
    await flush("a1", [words("Adding it now."), call("t1")]);
    act(() => store().appendMessage(result("r1", "t1")));
    await replyIn("a2");
    await flush("a2", [words("Done: the card is on the board.")]);
    expect(ears.changes()).toBe(0);

    await settle();
    expect(ears.heard.polite).toEqual([
      `${SPEAKER} Adding it now. Done: the card is on the board.`,
    ]);
  });

  it("says nothing for a turn that ends with no new words (Stop before the reply)", async () => {
    const ears = mount();
    await ask("u1", "How do I run a retro?");
    await settle();
    expect(ears.changes()).toBe(0);
  });

  it("puts the note the turn ended with into its one announcement", async () => {
    const ears = mount();
    await ask("u1", "List every retro format.");
    await replyIn("a1", [words("Here are the main ones: Start, Stop, Continue")]);
    await settle(CUT_OFF);
    expect(ears.heard.polite).toEqual([
      `${SPEAKER} Here are the main ones: Start, Stop, Continue. ${CUT_OFF.text}`,
    ]);
    expect(ears.heard.assertive).toEqual([]);
  });

  it("reads the round limit's stand-in as narration, with no speaker (a visitor's whole turn)", async () => {
    const standIn =
      "Amr used all 6 tool rounds for this request before he could sum up. This turn ran 6 tool calls; 1 failed (`retro.add_card`). Send a follow-up and he'll carry on.";
    const ears = mount();
    await ask("u1", "Read my board.");
    await replyIn("a1", [call("t1")]);
    act(() => store().appendMessage(result("r1", "t1")));
    act(() => store().appendMessage(amr("a2", [{ type: "text", text: standIn, note: true }])));
    await quiet();
    expect(ears.changes()).toBe(0);

    await settle();
    expect(ears.heard.polite).toEqual([
      "Amr used all 6 tool rounds for this request before he could sum up. This turn ran 6 tool calls; 1 failed (retro.add_card). Send a follow-up and he'll carry on.",
    ]);
    expect(ears.heard.polite[0]).not.toContain(SPEAKER);
  });

  it("reads Amr's words, then the stand-in, then the owner's round-limit note", async () => {
    const limit: AgentNotice = {
      tone: "note",
      kind: "round_limit",
      text: "Amr reached his limit of 10 tool rounds for one request. Send a follow-up and he'll carry on.",
    };
    const ears = mount();
    await ask("u1", "Tidy the retro.");
    await replyIn("a1", [words("Tidying it now."), call("t1")]);
    act(() => store().appendMessage(result("r1", "t1")));
    act(() =>
      store().appendMessage(
        amr("a2", [{ type: "text", text: "Amr used all 10 tool rounds.", note: true }])
      )
    );
    await settle(limit);
    expect(ears.heard.polite).toEqual([
      `${SPEAKER} Tidying it now. Amr used all 10 tool rounds. ${limit.text}`,
    ]);
  });

  it("reads a long reply up to a sentence, then points to the conversation", async () => {
    const sentence = "Pick one action and give it a clear owner before the retro ends.";
    const long = Array.from({ length: 12 }, () => sentence).join(" ");
    const ears = mount();
    await ask("u1", "What next?");
    await replyIn("a1", [words(long)]);
    await settle();

    expect(ears.heard.polite).toHaveLength(1);
    const [said] = ears.heard.polite;
    expect(said.startsWith(`${SPEAKER} ${sentence}`)).toBe(true);
    expect(said.endsWith(`retro ends. ${REST_IN_LOG}`)).toBe(true);
    expect(said.length).toBeLessThanOrEqual(SPEAKER.length + ANNOUNCE_MAX + REST_IN_LOG.length + 2);
  });
});

// ── A waiting card ──────────────────────────────────────────────────────

describe("a waiting card", () => {
  it("is not announced when it takes focus as it comes; the turn still speaks once at the end", async () => {
    const ears = mount();
    await ask("u1", "Add a card saying flaky CI.");
    await replyIn("a1", [call("t1")]);
    act(() => store().setPendingToolUse(card("t1")));
    await quiet();

    expect(document.activeElement?.closest("[data-confirm-card]")).not.toBeNull();
    expect(ears.changes()).toBe(0);

    // Approved: the card goes, the change runs, and Amr says what he did.
    act(() => store().setPendingToolUse(null));
    act(() => store().appendMessage(result("r1", "t1")));
    await replyIn("a2", [words("Added. The card is on your board.")]);
    expect(ears.changes()).toBe(0);

    await settle();
    expect(ears.heard.polite).toEqual([`${SPEAKER} Added. The card is on your board.`]);
    expect(ears.heard.assertive).toEqual([]);
  });

  it("is announced once when it doesn't take focus, and focus stays where it was", async () => {
    const ears = mount();
    await ask("u1", "Add a card saying flaky CI.");
    const box = screen.getByRole("textbox", { name: "Message" });
    act(() => box.focus());
    await replyIn("a1", [call("t1")]);
    act(() => store().setPendingToolUse(card("t1")));
    await quiet();

    expect(ears.heard.polite).toEqual([`${NEEDS_OK} Add a card to Retro Board?`]);
    expect(document.activeElement).toBe(box);

    // The same card again (a new object for the same call): not said again.
    act(() => store().setPendingToolUse(card("t1")));
    await quiet();
    expect(ears.heard.polite).toHaveLength(1);
  });
});

// ── Errors ──────────────────────────────────────────────────────────────

describe("an error", () => {
  it("is announced at once and assertively, and its turn says nothing politely", async () => {
    const ears = mount();
    await ask("u1", "How do I run a retro?");
    await replyIn("a1", [words("Start with what")]);
    await settle(FAILED);

    expect(ears.heard.assertive).toEqual([FAILED.text]);
    expect(ears.heard.polite).toEqual([]);
  });

  it("that comes before the turn ends is still said once", async () => {
    const ears = mount();
    await ask("u1", "How do I run a retro?");
    act(() => store().setNotice(FAILED));
    await quiet();
    expect(ears.heard.assertive).toEqual([FAILED.text]);

    await settle();
    expect(ears.heard.assertive).toHaveLength(1);
    expect(ears.heard.polite).toEqual([]);
  });

  it("already showing when the chat opens is not said again", async () => {
    act(() => {
      store().setActiveConversation(meta("c1"), [you("u1", "Hi")]);
      store().setNotice(FAILED);
    });
    const ears = mount();
    await quiet();
    expect(ears.changes()).toBe(0);
  });

  it("marked quiet is left to what took its place: neither it nor its turn is said", async () => {
    const ears = mount();
    await ask("u1", "How do I run a retro?");
    await settle({
      tone: "error",
      kind: "visitor_limit",
      text: "You've used all of today's messages with Amr.",
      quiet: true,
    });
    expect(ears.heard.assertive).toEqual([]);
    expect(ears.heard.polite).toEqual([]);

    // A quiet note with no turn under way says nothing either.
    act(() => store().setNotice({ tone: "note", kind: "round_limit", text: "Hm.", quiet: true }));
    await quiet();
    expect(ears.heard.polite).toEqual([]);
  });
});

// ── Chats that didn't settle here ───────────────────────────────────────

describe("a chat", () => {
  it("loaded from History says nothing, nor does another thread opened later", async () => {
    act(() =>
      store().setActiveConversation(meta("c1"), [
        you("u1", "How do I run a retro?"),
        amr("a1", [words("Start with what went well.")]),
      ])
    );
    const ears = mount();
    await quiet();
    act(() =>
      store().setActiveConversation(meta("c2"), [
        you("u2", "What is a sprint goal?"),
        amr("a2", [words("One sentence on why the sprint matters.")]),
      ])
    );
    await quiet();
    expect(ears.changes()).toBe(0);
  });

  it("opened mid-turn speaks the whole reply when the turn settles", async () => {
    act(() => {
      store().appendMessage(you("u1", "How do I run a retro?"));
      store().setStreaming(true);
      store().appendMessage(amr("a1", [words("Start with what went well.")]));
      store().setStreamingMessageId("a1");
    });
    const ears = mount();
    await flush("a1", [words("Start with what went well. Then ask what to change.")]);
    expect(ears.changes()).toBe(0);

    await settle();
    expect(ears.heard.polite).toEqual([
      `${SPEAKER} Start with what went well. Then ask what to change.`,
    ]);
  });

  it("swapped under its turn (New chat, another thread) says nothing for that turn", async () => {
    const ears = mount();
    await ask("u1", "How do I run a retro?");
    await replyIn("a1", [words("Start with what went well.")]);
    act(() => store().reset());
    await quiet();
    expect(ears.changes()).toBe(0);

    await ask("u2", "And after that?");
    await replyIn("a2", [words("Pick one action.")]);
    act(() =>
      store().setActiveConversation(meta("c9"), [
        you("u9", "Old question"),
        amr("a9", [words("An old answer.")]),
      ])
    );
    await quiet();
    expect(ears.changes()).toBe(0);
  });
});

// ── The words ───────────────────────────────────────────────────────────

describe("the words read out", () => {
  it("are the reply's text without markdown marks", () => {
    expect(
      spokenText("Open **Retro Board** and add `flaky CI`. See [the guide](/retro) or *ask*.")
    ).toBe("Open Retro Board and add flaky CI. See the guide or ask.");
  });

  it("read headings, list items and quotes as sentences", () => {
    expect(
      spokenText(
        "### Steps\n\n1. Open the board\n2. Add a card\n   - one per idea\n\n> Keep it short"
      )
    ).toBe("Steps. Open the board. Add a card. one per idea. Keep it short.");
  });

  it("name a table or code instead of reading it", () => {
    expect(spokenText("Here it is:\n\n| Day | Owner |\n| --- | --- |\n| Mon | Sam |")).toBe(
      `Here it is: ${TABLE_WORDS}`
    );
    expect(spokenText("Run this:\n\n```sh\nnpm test\n```")).toBe(`Run this: ${CODE_WORDS}`);
  });

  it("keep a right-to-left reply as written", () => {
    expect(spokenText("ابدأ بما سار بشكل جيد. ثم اسأل ماذا نغير؟")).toBe(
      "ابدأ بما سار بشكل جيد. ثم اسأل ماذا نغير؟"
    );
  });

  it("are cut between words when no sentence ends early enough", () => {
    const run = Array.from({ length: 80 }, (_, n) => `word${n}`).join(" ");
    const said = clipSpoken(run);
    expect(said.endsWith(`… ${REST_IN_LOG}`)).toBe(true);
    expect(said.length).toBeLessThanOrEqual(ANNOUNCE_MAX + REST_IN_LOG.length + 2);
    // Whole words only: the last one kept is complete.
    const kept = said.slice(0, said.indexOf("…")).split(" ").at(-1);
    expect(run.split(" ")).toContain(kept);
  });

  it("leave a short reply whole, and say nothing for nothing", () => {
    expect(clipSpoken("Done.")).toBe("Done.");
    expect(turnAnnouncement([])).toBeNull();
    expect(turnAnnouncement(["   "], "")).toBeNull();
    expect(turnAnnouncement([], CUT_OFF.text)).toBe(CUT_OFF.text);
    expect(turnAnnouncement([], null, ["  "])).toBeNull();
    expect(turnAnnouncement([], null, ["Amr used all `6` rounds."])).toBe("Amr used all 6 rounds.");
  });

  it("never speak in Amr's first person: the announcer's own lines are narration", () => {
    for (const line of [SPEAKER, NEEDS_OK, REST_IN_LOG, TABLE_WORDS, CODE_WORDS]) {
      expect(line).not.toMatch(/\b(I|I'm|I'll|I've|me|my)\b/);
    }
  });
});
