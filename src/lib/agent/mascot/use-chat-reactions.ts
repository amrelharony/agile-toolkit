"use client";

/**
 * Bridges the agent conversation (useAgentStore) to the mascot (useMascotStore):
 *   • talks only while his reply's text streams, his mouth following the
 *     writes' rhythm: not while a tool runs, while a call is being written,
 *     or while a card waits for the user,
 *   • holds "watching" while a confirm card waits for the user's OK, with the
 *     panel open or closed (the turn goes on when it closes),
 *   • plays a "thinking" reaction when a turn starts,
 *   • shifts mood to the reply's sentiment when the turn ends (and beams at a
 *     warm reply),
 *   • nods on a successful tool result, head-shakes on a tool error, and nods
 *     too when the visitor said no (Not now, a closed card): a choice, not a
 *     failure; but only for a result the live turn adds to the thread on
 *     screen: a thread opened from History, resumed, or switched to is
 *     history, not news,
 *   • looks concerned at a real error or a limit (the owner's rate limit, a
 *     visitor's daily allowance, the visitor AI's fallback), never at a gentle
 *     note (an answer cut short, every tool round used),
 *   • holds out the two options and waits while a visitor's confirm card (its verb or Not now)
 *     waits for them (companion.ts; the owner's card has a third choice),
 *   • bows when he's thanked.
 *
 * A reply and a thank-you also move his mood. The owner's are counted in what he
 * remembers between visits; a visitor's are not (see feelChat).
 *
 * It never selects the messages array: streamed text patches it once per
 * animation frame, and whoever selects it re-renders on every write. The held
 * states (talking, watching, trouble) are primitive selectors, so the hook
 * renders a few times a turn; the moments that come from the messages (a
 * write, a tool result, a thank-you, the turn's start and end) are read from
 * a store subscription, which renders nothing. Mount it once, through
 * <MascotChatReactions /> (components/agent/mascot/mascot-chat-reactions.tsx),
 * so even those few renders stay out of the assistant's shell.
 *
 * Pure UI glue — the sentiment scoring it relies on is unit-tested separately
 * (sentiment.ts).
 */

import { useEffect, useRef } from "react";
import type { ChatNoticeKind } from "@/lib/agent/client";
import { useAgentStore, type AgentNotice } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import { awaitDecision, isDeclined, noteTrouble } from "./companion";
import { feel, getMind } from "./mind";
import { useMascotStore } from "./store";
import { analyzeSentiment } from "./sentiment";

/** A reply warmer than this (sentiment valence, 0..1) gets a happy face. */
const WARM_REPLY = 0.75;
/** A message that thanks him. */
const THANKS = /\b(thanks|thank you|thx|ty|cheers|shukran)\b/i;

type AgentStoreState = ReturnType<typeof useAgentStore.getState>;

/**
 * Notices of a limit reached, which earn a concerned look whatever their tone.
 * They are errors today; the frown doesn't hang on that.
 */
const LIMIT_KINDS: ReadonlySet<string> = new Set([
  "usage_limit",
  "visitor_limit",
  "visitor_peak_limit",
  "site_limit",
  "site_peak_limit",
] satisfies readonly ChatNoticeKind[]);

/**
 * A chat moment moves his mood. The owner's is also counted in what he remembers.
 * A visitor's AI chat says "Not saved", so it leaves no count in this browser.
 */
function feelChat(event: "chatted" | "thanked"): void {
  if (useAgentStore.getState().chatProfile === "visitor") getMind().brain.note(event);
  else feel(event);
}

/** Whether a chat message thanks Amr. */
export function isThanks(text: string): boolean {
  return THANKS.test(text);
}

function textOf(m: ChatMessage): string {
  return m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

/** The message with this id, looked for from the end (the live reply is last, or nearly). */
function messageById(messages: readonly ChatMessage[], id: string): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].id === id) return messages[i];
  return undefined;
}

/**
 * Whether his reply's text is streaming now: a turn is live, no card waits,
 * and the reply the turn writes to has text and no tool call yet. The model
 * writes its words before its calls, so once a call shows up he's done
 * talking for that round; between rounds no reply is being written at all.
 */
function isSpeaking(s: AgentStoreState): boolean {
  if (!s.streaming || s.pendingToolUse !== null || s.streamingMessageId === null) return false;
  const reply = messageById(s.messages, s.streamingMessageId);
  if (!reply) return false;
  let text = false;
  for (const c of reply.content) {
    if (c.type === "tool_use") return false;
    if (c.type === "text" && c.text.trim().length > 0) text = true;
  }
  return text;
}

/** A limit reached: the owner's rate limit, a visitor's allowance spent, or the visitor AI's fallback. */
function isLimited(s: AgentStoreState): boolean {
  return (
    s.rateLimit?.limited === true || s.visitorFallback !== null || s.visitorQuota?.remaining === 0
  );
}

/** Whether a notice earns a concerned look: a real error, or a limit reached. A gentle note never does. */
function frownsAt(n: AgentNotice | null): boolean {
  return n !== null && (n.tone === "error" || LIMIT_KINDS.has(n.kind));
}

/**
 * The one message just added to the end of the thread on screen, or null. A
 * thread opened, resumed, switched to or emptied swaps the whole array (or
 * its id), so it never counts as one added: loaded history isn't news.
 */
function appendedOne(s: AgentStoreState, prev: AgentStoreState): ChatMessage | null {
  if (s.activeConversationId !== prev.activeConversationId) return null;
  const n = prev.messages.length;
  if (s.messages.length !== n + 1) return null;
  if (n > 0 && s.messages[n - 1] !== prev.messages[n - 1]) return null;
  return s.messages[n];
}

export function useMascotChatReactions(): void {
  const talking = useAgentStore(isSpeaking);
  const waiting = useAgentStore((s) => s.pendingToolUse !== null);
  // A visitor's card has exactly two answers: its verb and Not now.
  const choosing = useAgentStore((s) => s.pendingToolUse !== null && s.chatProfile === "visitor");
  const notice = useAgentStore((s) => s.notice);
  const limited = useAgentStore(isLimited);

  // Talk only while his words stream.
  useEffect(() => {
    useMascotStore.getState().setTalking(talking);
  }, [talking]);
  useEffect(() => () => useMascotStore.getState().setTalking(false), []);

  // A card waits for the user's OK: he watches, panel open or closed. The
  // page's typing watch shares the hold and lets go of it when typing stops,
  // so while the card waits he takes it back.
  useEffect(() => {
    if (!waiting) return;
    useMascotStore.getState().setHold("watching", true);
    const unsubscribe = useMascotStore.subscribe((m) => {
      if (!m.holds.includes("watching")) m.setHold("watching", true);
    });
    return () => {
      unsubscribe();
      useMascotStore.getState().setHold("watching", false);
    };
  }, [waiting]);

  // A card waiting for the visitor: the two options, then he waits, until they
  // answer. The held scene shows over the watching pose (sprite-poses.ts).
  useEffect(() => {
    awaitDecision("approve", choosing);
  }, [choosing]);
  useEffect(() => () => awaitDecision("approve", false), []);

  // A real error or a limit reached: a concerned look, once each time one
  // arrives (never for what the chat held when he mounted).
  const trouble = useRef({ notice, limited });
  useEffect(() => {
    const prev = trouble.current;
    trouble.current = { notice, limited };
    const arrived = (notice !== prev.notice && frownsAt(notice)) || (limited && !prev.limited);
    if (!arrived) return;
    noteTrouble();
    useMascotStore.getState().queueReaction("concerned");
  }, [notice, limited]);

  // The moments the messages bring, read as they happen.
  useEffect(() => {
    /**
     * The live turn (null between turns): whose chat it runs in, and the
     * replies it wrote, oldest first.
     */
    let turn: { profile: AgentStoreState["chatProfile"]; replies: string[] } | null = null;
    const wrote = (id: string) => {
      if (turn && turn.replies[turn.replies.length - 1] !== id) turn.replies.push(id);
    };
    return useAgentStore.subscribe((s, prev) => {
      const mascot = useMascotStore.getState();
      const added = s.messages === prev.messages ? null : appendedOne(s, prev);

      // A turn starts: he thinks.
      if (s.streaming && !prev.streaming) {
        turn = { profile: s.chatProfile, replies: [] };
        mascot.queueReaction("thinking");
      }
      if (s.streaming) {
        if (added?.role === "assistant") wrote(added.id);
        if (s.streamingMessageId !== null) wrote(s.streamingMessageId);
      }

      // A turn ends: his mood follows the last reply it wrote that the chat
      // on screen still holds. New chat or another thread ended it otherwise,
      // and there is no reply to feel; the chat changing hands ended someone
      // else's turn.
      if (!s.streaming && prev.streaming) {
        const ended = turn;
        turn = null;
        let msg: ChatMessage | undefined;
        if (ended && ended.profile === s.chatProfile) {
          for (let i = ended.replies.length - 1; i >= 0 && !msg; i--) {
            msg = messageById(s.messages, ended.replies[i]);
          }
        }
        const text = msg ? textOf(msg) : "";
        if (text.trim()) {
          feelChat("chatted");
          const sentiment = analyzeSentiment(text);
          // Dampen the reply's valence swing (the source uses ×0.3) so the mascot
          // drifts mood gently rather than lurching message to message.
          mascot.setMood({
            valence: 0.5 + (sentiment.valence - 0.5) * 0.3,
            energy: sentiment.energy,
          });
          if (sentiment.valence > WARM_REPLY) mascot.queueReaction("happy");
        }
      }

      if (s.messages === prev.messages) return;

      // Every write of his words is a beat of his mouth.
      if (isSpeaking(s)) mascot.pulseSpeech();

      if (!added) return;
      // A result the live turn just added: a nod, or a head-shake on an error.
      if (added.role === "tool" && s.streaming) {
        const failed = added.content.some(
          (c) => c.type === "tool_result" && c.is_error && !isDeclined(c)
        );
        if (failed) noteTrouble();
        mascot.queueReaction(failed ? "headShake" : "nod");
      }
      // Thanked: a polite bow.
      if (added.role === "user" && isThanks(textOf(added))) {
        feelChat("thanked");
        mascot.queueReaction("bow");
      }
    });
  }, []);
}
