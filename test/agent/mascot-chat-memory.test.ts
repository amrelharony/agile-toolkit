/**
 * A visitor's AI chat says "Not saved" under the message box. So it may move
 * Amr's mood for the tab, but it leaves no count in what he remembers between
 * visits (localStorage "mascot_memory"). The owner's chat is counted as before.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { loadMemory } from "@/lib/agent/mascot/memory";
import { __resetMindForTests, feel, getMind } from "@/lib/agent/mascot/mind";
import { useMascotChatReactions } from "@/lib/agent/mascot/use-chat-reactions";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";

let seq = 0;
const message = (role: ChatMessage["role"], text: string): ChatMessage => ({
  id: `m${++seq}`,
  role,
  content: [{ type: "text", text }],
  createdAt: "2026-11-10T08:00:00.000Z",
});

/** One exchange the way the client drives the store: the question, the stream, the reply. */
function exchange(question: string, reply: string): void {
  act(() => {
    useAgentStore.getState().appendMessage(message("user", question));
    useAgentStore.getState().setStreaming(true);
  });
  act(() => {
    useAgentStore.getState().appendMessage(message("assistant", reply));
    useAgentStore.getState().setStreaming(false);
  });
}

const saved = () => loadMemory(localStorage)!.counts;

describe("what a chat leaves in Amr's memory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 10, 0));
    localStorage.clear();
    __resetMindForTests();
    useAgentStore.getState().reset();
    useAgentStore.getState().setChatProfile("owner");
  });
  afterEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.getState().setChatProfile("owner");
    __resetMindForTests();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("a visitor's chat moves his mood and is not counted", () => {
    const note = vi.spyOn(getMind().brain, "note");
    renderHook(() => useMascotChatReactions());
    useAgentStore.getState().setChatProfile("visitor");

    exchange("Thanks! How do I run a retro?", "Start with what went well.");
    exchange("And after that?", "Pick one thing to change.");
    vi.advanceTimersByTime(5000);

    expect(note.mock.calls.map(([event]) => event)).toEqual(["thanked", "chatted", "chatted"]);
    expect(saved().chatted).toBeUndefined();
    expect(saved().thanked).toBeUndefined();
  });

  it("a visitor's chat leaves the counts he already had as they were", () => {
    feel("pat");
    vi.advanceTimersByTime(2000);
    renderHook(() => useMascotChatReactions());
    useAgentStore.getState().setChatProfile("visitor");

    exchange("thank you, what is WSJF?", "It ranks work by cost of delay over size.");
    vi.advanceTimersByTime(5000);

    expect(saved()).toEqual({ pat: 1 });
  });

  it("the owner's chat is counted, as before", () => {
    renderHook(() => useMascotChatReactions());

    exchange("Thanks! How do I run a retro?", "Start with what went well.");
    vi.advanceTimersByTime(5000);

    expect(saved()).toMatchObject({ chatted: 1, thanked: 1 });
  });
});
