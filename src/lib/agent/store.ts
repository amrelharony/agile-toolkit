"use client";

import { create } from "zustand";
import type { ChatMessage, ConversationMeta, PendingToolUse } from "./types";

interface AgentState {
  open: boolean;
  /** Currently-loaded conversation, or null for a fresh draft. */
  activeConversationId: string | null;
  activeMeta: ConversationMeta | null;
  /** Messages in the active conversation, in chronological order. */
  messages: ChatMessage[];
  /** Set true while a Claude request is streaming. */
  streaming: boolean;
  /** Tool_use blocks awaiting user approval (one at a time). */
  pendingToolUse: PendingToolUse | null;
  /** When true, write actions execute without per-action confirmation
   *  until the sheet is closed. Read actions never prompt. */
  autoApprove: boolean;
  /** Recent error message surfaced inline (cleared on next send). */
  error: string | null;
}

interface AgentActions {
  openSheet(): void;
  closeSheet(): void;
  toggleSheet(): void;
  setAutoApprove(v: boolean): void;
  setActiveConversation(meta: ConversationMeta | null, messages: ChatMessage[]): void;
  appendMessage(msg: ChatMessage): void;
  patchLastAssistant(content: ChatMessage["content"]): void;
  setStreaming(v: boolean): void;
  setPendingToolUse(p: PendingToolUse | null): void;
  setError(e: string | null): void;
  reset(): void;
}

export const useAgentStore = create<AgentState & AgentActions>()((set) => ({
  open: false,
  activeConversationId: null,
  activeMeta: null,
  messages: [],
  streaming: false,
  pendingToolUse: null,
  autoApprove: false,
  error: null,

  openSheet: () => set({ open: true }),
  // BUG-G1: also reset autoApprove on close. The docstring promised
  // "until the sheet is closed" but the prior implementation kept the
  // flag set across close/reopen, silently widening write-approval
  // beyond what the user opted into.
  closeSheet: () => set({ open: false, pendingToolUse: null, autoApprove: false }),
  toggleSheet: () => set((s) => ({ open: !s.open })),
  setAutoApprove: (v) => set({ autoApprove: v }),

  setActiveConversation: (meta, messages) =>
    set({
      activeConversationId: meta?.id ?? null,
      activeMeta: meta,
      messages,
      pendingToolUse: null,
      error: null,
    }),

  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  patchLastAssistant: (content) =>
    set((s) => {
      // Find the last assistant message and replace its content. If there
      // isn't one yet, create one. Used by the streaming loop to grow the
      // assistant's response as deltas arrive.
      const idx = [...s.messages].reverse().findIndex((m) => m.role === "assistant");
      if (idx === -1) {
        return {
          messages: [
            ...s.messages,
            {
              id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              role: "assistant",
              content,
              createdAt: new Date().toISOString(),
            },
          ],
        };
      }
      const realIdx = s.messages.length - 1 - idx;
      const next = s.messages.slice();
      next[realIdx] = { ...next[realIdx], content };
      return { messages: next };
    }),

  setStreaming: (v) => set({ streaming: v }),
  setPendingToolUse: (p) => set({ pendingToolUse: p }),
  setError: (e) => set({ error: e }),

  reset: () =>
    set({
      activeConversationId: null,
      activeMeta: null,
      messages: [],
      streaming: false,
      pendingToolUse: null,
      // BUG-G1: reset autoApprove on full reset too.
      autoApprove: false,
      error: null,
    }),
}));
