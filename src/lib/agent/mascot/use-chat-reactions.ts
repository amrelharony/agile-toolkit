"use client";

/**
 * Bridges the agent conversation (useAgentStore) to the mascot (useMascotStore):
 *   • talks (the review pose) while the agent streams,
 *   • plays a "thinking" reaction when a turn starts,
 *   • shifts mood to the reply's sentiment when the turn ends,
 *   • nods on a successful tool result, head-shakes on a tool error.
 *
 * Pure UI glue — the sentiment scoring it relies on is unit-tested separately
 * (sentiment.ts). Call once from the mascot assistant.
 */

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "./store";
import { analyzeSentiment } from "./sentiment";

export function useMascotChatReactions(): void {
  const streaming = useAgentStore((s) => s.streaming);
  const messages = useAgentStore((s) => s.messages);
  const wasStreaming = useRef(false);
  const toolCount = useRef(0);

  // Talk while streaming; think on start; mood-from-reply on end.
  useEffect(() => {
    const mascot = useMascotStore.getState();
    mascot.setTalking(streaming);

    if (streaming && !wasStreaming.current) {
      mascot.queueReaction("thinking");
    } else if (!streaming && wasStreaming.current) {
      const msgs = useAgentStore.getState().messages;
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      const text = (lastAssistant?.content ?? [])
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      if (text.trim()) {
        const s = analyzeSentiment(text);
        // Dampen the reply's valence swing (the source uses ×0.3) so the mascot
        // drifts mood gently rather than lurching message to message.
        mascot.setMood({ valence: 0.5 + (s.valence - 0.5) * 0.3, energy: s.energy });
      }
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  // Nod on a successful tool result, head-shake on an error.
  useEffect(() => {
    const toolMsgs = messages.filter((m) => m.role === "tool");
    if (toolMsgs.length > toolCount.current) {
      const newest = toolMsgs[toolMsgs.length - 1];
      const isError = newest.content.some((c) => c.type === "tool_result" && c.is_error);
      useMascotStore.getState().queueReaction(isError ? "headShake" : "nod");
    }
    toolCount.current = toolMsgs.length;
  }, [messages]);
}
