"use client";

/**
 * Bridges the agent conversation (useAgentStore) to the mascot (useMascotStore):
 *   • talks while the agent streams, his mouth following the chunks' rhythm,
 *   • plays a "thinking" reaction when a turn starts,
 *   • shifts mood to the reply's sentiment when the turn ends (and beams at a
 *     warm reply),
 *   • nods on a successful tool result, head-shakes on a tool error,
 *   • looks concerned when the turn fails or a limit is reached (the owner's
 *     rate limit, or a visitor's daily allowance / the visitor AI's fallback),
 *   • bows when he's thanked.
 *
 * Pure UI glue — the sentiment scoring it relies on is unit-tested separately
 * (sentiment.ts). Call once from the mascot assistant.
 */

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "./store";
import { analyzeSentiment } from "./sentiment";

/** A reply warmer than this (sentiment valence, 0..1) gets a happy face. */
const WARM_REPLY = 0.75;
/** A message that thanks him. */
const THANKS = /\b(thanks|thank you|thx|ty|cheers|shukran)\b/i;

/** Whether a chat message thanks Amr. */
export function isThanks(text: string): boolean {
  return THANKS.test(text);
}

export function useMascotChatReactions(): void {
  const streaming = useAgentStore((s) => s.streaming);
  const messages = useAgentStore((s) => s.messages);
  const error = useAgentStore((s) => s.error);
  const limited = useAgentStore(
    (s) =>
      s.rateLimit?.limited === true || s.visitorFallback !== null || s.visitorQuota?.remaining === 0
  );
  const wasStreaming = useRef(false);
  const toolCount = useRef(0);
  const userCount = useRef(0);

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
        if (s.valence > WARM_REPLY) mascot.queueReaction("happy");
      }
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  // Every streamed chunk is a beat of his mouth.
  useEffect(() => {
    if (streaming) useMascotStore.getState().pulseSpeech();
  }, [messages, streaming]);

  // A failed turn or a spent rate limit: a concerned look.
  useEffect(() => {
    if (error || limited) useMascotStore.getState().queueReaction("concerned");
  }, [error, limited]);

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

  // Thanked: a polite bow.
  useEffect(() => {
    const userMsgs = messages.filter((m) => m.role === "user");
    // One new message (a conversation loaded from history isn't a thank-you).
    if (userMsgs.length === userCount.current + 1) {
      const text = userMsgs[userMsgs.length - 1].content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      if (isThanks(text)) useMascotStore.getState().queueReaction("bow");
    }
    userCount.current = userMsgs.length;
  }, [messages]);
}
