/**
 * The chat's side of the companion scenes: Amr holds out two options and waits
 * while a visitor's Approve or Deny card waits for them, and a no from the
 * visitor is answered like any answer (a nod), not like a failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { VisitorAiConsent } from "@/components/agent/mascot/visitor-ai-consent";
import {
  DECISION_END_MS,
  DECISION_HOLD,
  resetCompanion,
  troubleRecent,
} from "@/lib/agent/mascot/companion";
import { __resetMindForTests } from "@/lib/agent/mascot/mind";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { useMascotChatReactions } from "@/lib/agent/mascot/use-chat-reactions";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage, PendingToolUse } from "@/lib/agent/types";

const card = (): PendingToolUse => ({
  toolUseId: "t1",
  actionId: "workspace_card_add",
  resolvedActionId: "workspace.card.add",
  input: {},
  summary: "Add a card",
  resolve: () => undefined,
});

let seq = 0;
const toolResult = (content: string, isError: boolean): ChatMessage => ({
  id: `m${++seq}`,
  role: "tool",
  content: [{ type: "tool_result", tool_use_id: "t1", content, is_error: isError }],
  createdAt: "2026-11-10T08:00:00.000Z",
});

describe("the chat and the companion scenes", () => {
  const holding = () => useMascotStore.getState().holds.includes(DECISION_HOLD);
  const queue = () => useMascotStore.getState().reactionQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    __resetMindForTests();
    resetCompanion();
    useMascotStore.getState().reset();
    useAgentStore.getState().reset();
  });
  afterEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.getState().setChatProfile("owner");
    resetCompanion();
    __resetMindForTests();
    vi.useRealTimers();
  });

  it("waits with the two options while a visitor's card waits, and lets go when it's answered", () => {
    useAgentStore.getState().setChatProfile("visitor");
    renderHook(() => useMascotChatReactions());
    act(() => useAgentStore.getState().setPendingToolUse(card()));
    expect(holding()).toBe(true);
    act(() => useAgentStore.getState().setPendingToolUse(null));
    act(() => vi.advanceTimersByTime(DECISION_END_MS));
    expect(holding()).toBe(false);
  });

  it("doesn't for the owner's card, which has a third answer (Approve all)", () => {
    useAgentStore.getState().setChatProfile("owner");
    renderHook(() => useMascotChatReactions());
    act(() => useAgentStore.getState().setPendingToolUse(card()));
    expect(holding()).toBe(false);
  });

  it("lets go when the chat goes away with a card still up", () => {
    useAgentStore.getState().setChatProfile("visitor");
    const { unmount } = renderHook(() => useMascotChatReactions());
    act(() => useAgentStore.getState().setPendingToolUse(card()));
    unmount();
    act(() => vi.advanceTimersByTime(DECISION_END_MS));
    expect(holding()).toBe(false);
  });

  it("waits while the consent card is up, and lets go once it's gone (either answer unmounts it)", () => {
    const { unmount } = render(
      createElement(VisitorAiConsent, { question: "", onAgree: () => {}, onDecline: () => {} })
    );
    expect(holding()).toBe(true);
    unmount();
    act(() => vi.advanceTimersByTime(DECISION_END_MS));
    expect(holding()).toBe(false);
  });

  it("nods at a no from the visitor: a choice, not a failure", () => {
    renderHook(() => useMascotChatReactions());
    act(() =>
      useAgentStore
        .getState()
        .appendMessage(toolResult("User denied execution of workspace.card.add.", true))
    );
    expect(queue()).toEqual(["nod"]);
    expect(troubleRecent()).toBe(false);
  });

  it("still shakes his head at a real failure, and keeps the light-hearted scenes away", () => {
    renderHook(() => useMascotChatReactions());
    act(() => useAgentStore.getState().appendMessage(toolResult("Invalid input: title", true)));
    expect(queue()).toEqual(["headShake"]);
    expect(troubleRecent()).toBe(true);
  });
});
