/**
 * How the chat drives Amr's figure (lib/agent/mascot/use-chat-reactions.ts):
 * he talks only while his words stream, watches while a card waits (panel
 * open or closed), nods only at a result the live turn adds, frowns only at
 * real errors and limits, and the chat's writes never re-render the hook's
 * host per streamed chunk.
 */

import { Profiler } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { MascotChatReactions } from "@/components/agent/mascot/mascot-chat-reactions";
import { __resetMindForTests, getMind } from "@/lib/agent/mascot/mind";
import { NEUTRAL_MOOD, useMascotStore } from "@/lib/agent/mascot/store";
import { useMascotChatReactions } from "@/lib/agent/mascot/use-chat-reactions";
import { useAgentStore, type AgentNotice } from "@/lib/agent/store";
import type {
  ChatMessage,
  ContentBlock,
  ConversationMeta,
  PendingToolUse,
} from "@/lib/agent/types";

let seq = 0;
const at = "2026-11-10T08:00:00.000Z";
const msg = (role: ChatMessage["role"], content: ContentBlock[]): ChatMessage => ({
  id: `m${++seq}`,
  role,
  content,
  createdAt: at,
});
const text = (t: string): ContentBlock => ({ type: "text", text: t });
const call = (id: string): ContentBlock => ({
  type: "tool_use",
  id,
  name: "retro_actions_add",
  input: { title: "Fix the build" },
});
const result = (id: string, isError = false): ContentBlock => ({
  type: "tool_result",
  tool_use_id: id,
  content: isError ? "failed" : "ok",
  ...(isError ? { is_error: true } : {}),
});
const thread = (id: string): ConversationMeta => ({
  id,
  title: `Thread ${id}`,
  toolId: null,
  createdAt: at,
  updatedAt: at,
  lastMessageAt: at,
});

/** A saved thread whose turns ran tools: one result went fine, one failed. */
function savedThreadWithTools(): ChatMessage[] {
  return [
    msg("user", [text("thanks, add an action")]),
    msg("assistant", [text("Adding it."), call("t1")]),
    msg("tool", [result("t1")]),
    msg("assistant", [text("And the second."), call("t2")]),
    msg("tool", [result("t2", true)]),
    msg("assistant", [text("One of them failed.")]),
  ];
}

const agent = () => useAgentStore.getState();
const mascot = () => useMascotStore.getState();
const queue = () => mascot().reactionQueue;
const watching = () => mascot().holds.includes("watching");

/** The client's way to open a round's reply: append it empty, then point the turn at it. */
function openReply(): string {
  const reply = msg("assistant", []);
  act(() => {
    agent().appendMessage(reply);
    agent().setStreamingMessageId(reply.id);
  });
  return reply.id;
}

function pending(): PendingToolUse {
  return {
    toolUseId: "t9",
    actionId: "retro_actions_delete",
    resolvedActionId: "retro.actions.delete",
    input: {},
    prompt: {
      verb: "Delete",
      title: "Retro Actions",
      question: "Delete this from Retro Actions?",
      detail: "",
      destructive: true,
    },
    resolve: vi.fn(),
  };
}

function clearAll(): void {
  act(() => {
    agent().reset();
    agent().setChatProfile("owner");
    agent().setRateLimit(null);
    agent().setVisitorQuota(null);
    agent().setVisitorFallback(null);
    agent().closeSheet();
    mascot().reset();
  });
}

beforeEach(() => {
  localStorage.clear();
  __resetMindForTests();
  clearAll();
});
afterEach(() => {
  clearAll();
  __resetMindForTests();
  localStorage.clear();
});

describe("tool results", () => {
  it("opening a saved thread with tool results makes him neither nod nor shake his head", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().setActiveConversation(thread("a"), savedThreadWithTools()));
    // Another thread from History, and the same one reloaded.
    act(() => agent().setActiveConversation(thread("b"), savedThreadWithTools()));
    act(() => agent().setActiveConversation(thread("b"), savedThreadWithTools()));

    expect(queue()).not.toContain("nod");
    expect(queue()).not.toContain("headShake");
    // Its thank-you is history too.
    expect(queue()).not.toContain("bow");
  });

  it("nods at a result the live turn adds, after a loaded thread, and shakes his head at a failed one", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().setActiveConversation(thread("a"), savedThreadWithTools()));
    act(() => agent().setStreaming(true));
    act(() => agent().appendMessage(msg("tool", [result("t3")])));
    expect(queue().filter((r) => r === "nod")).toHaveLength(1);

    act(() => agent().appendMessage(msg("tool", [result("t4"), result("t5", true)])));
    expect(queue()).toContain("headShake");
  });

  it("a result added with no turn running is not news either", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().appendMessage(msg("tool", [result("t1")])));
    expect(queue()).not.toContain("nod");
  });
});

describe("talking", () => {
  it("talks only while his reply's text streams", () => {
    renderHook(() => useMascotChatReactions());
    const talking = () => mascot().talking;

    act(() => agent().setStreaming(true));
    expect(talking()).toBe(false); // thinking, nothing written yet
    const first = openReply();
    expect(talking()).toBe(false);
    act(() => agent().patchMessage(first, [text("Let me add that.")]));
    expect(talking()).toBe(true);
    // The round turns to a call: his words for it are done.
    act(() => agent().patchMessage(first, [text("Let me add that."), call("t1")]));
    expect(talking()).toBe(false);
    // The tool runs between rounds: no reply is being written.
    act(() => agent().setStreamingMessageId(null));
    act(() => agent().appendMessage(msg("tool", [result("t1")])));
    expect(talking()).toBe(false);
    // The next round writes again.
    const second = openReply();
    act(() => agent().patchMessage(second, [text("Done.")]));
    expect(talking()).toBe(true);
    act(() => agent().setStreaming(false));
    expect(talking()).toBe(false);
  });

  it("each write of his words is a beat of his mouth, and nothing else is", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().setStreaming(true));
    const reply = openReply();
    const before = mascot().speechPulse;
    act(() => agent().patchMessage(reply, [text("One")]));
    act(() => agent().patchMessage(reply, [text("One two")]));
    act(() => agent().patchMessage(reply, [text("One two three")]));
    expect(mascot().speechPulse - before).toBe(3);

    // The call that follows is written, but not by his mouth.
    act(() => agent().patchMessage(reply, [text("One two three"), call("t1")]));
    expect(mascot().speechPulse - before).toBe(3);
  });

  it("stops talking when he leaves the page's chat", () => {
    const { unmount } = renderHook(() => useMascotChatReactions());
    act(() => agent().setStreaming(true));
    const reply = openReply();
    act(() => agent().patchMessage(reply, [text("Hello")]));
    expect(mascot().talking).toBe(true);
    unmount();
    expect(mascot().talking).toBe(false);
  });
});

describe("a card waiting for the user's OK", () => {
  it("holds 'watching' with the panel closed, and not talking, until the card is answered", () => {
    renderHook(() => useMascotChatReactions());
    expect(agent().open).toBe(false);
    act(() => agent().setStreaming(true));
    const reply = openReply();
    act(() => agent().patchMessage(reply, [text("I can delete that.")]));
    expect(mascot().talking).toBe(true);

    act(() => agent().setPendingToolUse(pending()));
    expect(watching()).toBe(true);
    expect(mascot().talking).toBe(false);

    act(() => agent().setPendingToolUse(null));
    expect(watching()).toBe(false);
  });

  it("keeps watching when the page's typing watch lets go of the same hold", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().setStreaming(true));
    act(() => agent().setPendingToolUse(pending()));
    // engine/interactions/page.ts: typing on the page stopped.
    act(() => mascot().setHold("watching", false));
    expect(watching()).toBe(true);
  });

  it("lets go when the card goes with the turn (New chat)", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().setStreaming(true));
    act(() => agent().setPendingToolUse(pending()));
    act(() => agent().reset());
    expect(watching()).toBe(false);
  });
});

describe("a concerned look", () => {
  const note = (kind: string): AgentNotice => ({ tone: "note", kind, text: "A gentle note." });
  const error = (kind: string): AgentNotice => ({ tone: "error", kind, text: "It failed." });
  const frowns = () => queue().filter((r) => r === "concerned").length;

  it("never at a gentle note", () => {
    renderHook(() => useMascotChatReactions());
    for (const kind of ["cut_off", "no_answer", "round_limit", "repeated_failure", "live_room"]) {
      act(() => agent().setNotice(note(kind)));
    }
    expect(frowns()).toBe(0);
  });

  it("at each real error as it arrives, not when it clears", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().setNotice(error("stream_failed")));
    expect(frowns()).toBe(1);
    act(() => agent().setNotice(null));
    expect(frowns()).toBe(1);
    act(() => agent().setNotice(error("stream_failed")));
    expect(frowns()).toBe(2);
  });

  it("at a limit reached: the owner's rate limit, a visitor's allowance, the fallback", () => {
    renderHook(() => useMascotChatReactions());
    act(() =>
      agent().setRateLimit({
        dailyUsed: 10,
        dailyMax: 10,
        weeklyUsed: 10,
        weeklyMax: 50,
        monthlyUsed: 10,
        monthlyMax: 200,
        limited: true,
      })
    );
    expect(frowns()).toBe(1);
    act(() => agent().setRateLimit(null));
    act(() =>
      agent().setVisitorQuota({
        remaining: 0,
        limit: 20,
        peak: false,
        peakRemaining: null,
        peakLimit: null,
        peakEndsAt: null,
      })
    );
    expect(frowns()).toBe(2);
    act(() => agent().setVisitorQuota(null));
    act(() => agent().setVisitorFallback("site_limit"));
    expect(frowns()).toBe(3);
  });

  it("at a limit's notice whatever its tone", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().setNotice(note("visitor_limit")));
    expect(frowns()).toBe(1);
  });

  it("not at an error the chat already showed when he mounted", () => {
    act(() => agent().setNotice(error("stream_failed")));
    renderHook(() => useMascotChatReactions());
    expect(frowns()).toBe(0);
  });
});

describe("the turn's end", () => {
  const WARM = "Wonderful! That is a fantastic, brilliant, amazing result. Great work, well done!";

  it("feels the reply the turn wrote", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().setStreaming(true));
    const reply = openReply();
    act(() => agent().patchMessage(reply, [text(WARM)]));
    act(() => agent().setStreaming(false));
    expect(mascot().mood).not.toEqual(NEUTRAL_MOOD);
  });

  it("feels nothing when another thread opened mid-turn: its replies are history", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().setActiveConversation(thread("a"), []));
    act(() => agent().setStreaming(true));
    openReply();
    act(() =>
      agent().setActiveConversation(thread("b"), [
        msg("user", [text("hi")]),
        msg("assistant", [text(WARM)]),
      ])
    );
    expect(agent().streaming).toBe(false);
    expect(mascot().mood).toEqual(NEUTRAL_MOOD);
    expect(queue()).not.toContain("happy");
  });

  it("a visitor's turn cleared mid-answer leaves nothing to feel, and no count", () => {
    const noted = vi.spyOn(getMind().brain, "note");
    renderHook(() => useMascotChatReactions());
    act(() => agent().setChatProfile("visitor"));
    act(() => agent().setStreaming(true));
    const reply = openReply();
    act(() => agent().patchMessage(reply, [text(WARM)]));
    act(() => agent().reset());
    expect(noted).not.toHaveBeenCalledWith("chatted");
    expect(mascot().mood).toEqual(NEUTRAL_MOOD);
  });

  it("a turn that failed before any reply doesn't feel the last turn's reply again", () => {
    renderHook(() => useMascotChatReactions());
    act(() => agent().appendMessage(msg("assistant", [text(WARM)])));
    act(() => agent().setStreaming(true));
    act(() => agent().setStreaming(false));
    expect(mascot().mood).toEqual(NEUTRAL_MOOD);
  });
});

describe("renders", () => {
  it("streamed writes never re-render the host: only a change of what he shows does", () => {
    let commits = 0;
    render(
      <Profiler id="reactions" onRender={() => commits++}>
        <MascotChatReactions />
      </Profiler>
    );
    act(() => agent().setStreaming(true));
    const reply = openReply();
    act(() => agent().patchMessage(reply, [text("Hel")]));
    const talkingStarted = commits;
    for (let i = 0; i < 20; i++) {
      act(() => agent().patchMessage(reply, [text(`Hello ${"word ".repeat(i)}`)]));
    }
    expect(commits).toBe(talkingStarted);
    expect(mascot().talking).toBe(true);
  });

  it("the assistant's shell renders the null child instead of calling the hook", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/agent/mascot/mascot-assistant.tsx"),
      "utf8"
    );
    expect(src).toContain("<MascotChatReactions />");
    expect(src).not.toMatch(/useMascotChatReactions\s*\(/);
  });
});
