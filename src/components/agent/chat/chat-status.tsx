"use client";

/**
 * The chat's one status line, shared by both chats' footers (the owner's
 * agent-conversation, the visitor's visitor-agent-panel): what Amr is doing
 * in the turn under way, as narration in the third person, and nothing else.
 *
 *   "Amr is thinking…"               from the send until his reply begins, and
 *                                    between a turn's rounds
 *   "Amr is working in Retro Board…" while a tool call is written or runs
 *                                    (the tool's name from lib/agent/tool-label)
 *   "Amr is writing…"                while his words stream in
 *   empty                            between turns, and while a card waits:
 *                                    "Waiting for you" is that step's own
 *                                    state, and the card says the rest (it
 *                                    takes focus, or the announcer reads it)
 *
 * Always mounted, empty when idle, so a screen reader hears each change (a
 * live region mounted with its words is often missed). Its text is the phase
 * alone: the reply itself is read once, when the turn settles
 * (use-turn-announcer). The picture is apart from it: the wordless,
 * aria-hidden thinking balloon in the log (chat-items ThinkingItemView).
 * Compact (a phone's keyboard up), it leaves the screen but still speaks.
 *
 * It reads the store itself, as one string, so a streamed chunk that leaves
 * the phase as it was draws nothing, and the container around it never reads
 * the messages (test/agent/chat-stream-renders.test.tsx).
 *
 * Runtime parts (the agent store), so this lives in chat/, which every-page
 * code may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useAgentStore } from "@/lib/agent/store";
import { toolLabel } from "@/lib/agent/tool-label";
import type { ChatMessage } from "@/lib/agent/types";
import { cn } from "@/lib/utils";
import { noReplyYet } from "./chat-strip";

/** While Amr is still to begin his reply, and between a turn's rounds. */
export const AMR_THINKING = "Amr is thinking…";
/** While his words stream in. */
export const AMR_WRITING = "Amr is writing…";
/** While a call to `tool` (its name in words) is written or runs. */
export const amrWorkingIn = (tool: string) => `Amr is working in ${tool}…`;

/**
 * The status line's words for the chat as it stands: `busy` is a turn under
 * way (or starting), `waiting` a confirm card showing. Empty when idle or
 * while the card waits.
 */
export function phaseText(
  messages: readonly ChatMessage[],
  busy: boolean,
  waiting: boolean
): string {
  if (!busy || waiting) return "";
  if (noReplyYet(messages)) return AMR_THINKING;
  // The reply so far ends with what Amr is doing now: a call, or his words.
  const block = messages[messages.length - 1].content.at(-1);
  if (block?.type === "tool_use") return amrWorkingIn(toolLabel(block.name).tool);
  if (block?.type === "text" && !block.note && block.text.trim()) return AMR_WRITING;
  return AMR_THINKING;
}

/** The chat's status line, under the composer: the turn's phase in words (see the file comment). */
export function ChatStatus({ busy }: { busy: boolean }) {
  const text = useAgentStore((s) => phaseText(s.messages, busy, s.pendingToolUse !== null));
  return (
    <p
      role="status"
      data-chat-status=""
      className={cn("mt-1.5 text-xs text-sub empty:mt-0", "group-data-[amr-compact]/amr:sr-only")}
    >
      {text || null}
    </p>
  );
}
