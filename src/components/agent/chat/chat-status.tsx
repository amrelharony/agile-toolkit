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
 *   "Amr is working…"                the same, for a round whose calls reach
 *                                    more than one tool (the client runs them
 *                                    one by one and answers them all at once,
 *                                    so no one tool name would be right)
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
 * aria-hidden thinking balloon in the log (chat/thinking-item).
 * Compact (a phone's keyboard up), it leaves the screen but still speaks.
 *
 * It reads the store itself, as one string, so a streamed chunk that leaves
 * the phase as it was draws nothing, and the container around it never reads
 * the messages (test/agent/chat-stream-renders.test.tsx). A tool's name in
 * words comes from the strip kit (chat/strip-kit, through its holder), which
 * is in before any call is: a visitor's first paint doesn't carry the names.
 *
 * Runtime parts (the agent store), so this lives in chat/, which every-page
 * code may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useAgentStore } from "@/lib/agent/store";
import type { ToolLabel } from "@/lib/agent/tool-label";
import type { ChatMessage } from "@/lib/agent/types";
import { cn } from "@/lib/utils";
import { noReplyYet } from "./chat-strip";
import { useStripKit } from "./strip-kit-ref";

/** While Amr is still to begin his reply, and between a turn's rounds. */
export const AMR_THINKING = "Amr is thinking…";
/** While his words stream in. */
export const AMR_WRITING = "Amr is writing…";
/** While a call to `tool` (its name in words) is written or runs. */
export const amrWorkingIn = (tool: string) => `Amr is working in ${tool}…`;
/** While a round's calls, to more than one tool, are written or run. */
export const AMR_WORKING = "Amr is working…";

/**
 * The status line's words for the chat as it stands: `busy` is a turn under
 * way (or starting), `waiting` a confirm card showing, `label` a tool's name
 * in words (lib/agent/tool-label, from the strip kit). Empty when idle or
 * while the card waits.
 */
export function phaseText(
  messages: readonly ChatMessage[],
  busy: boolean,
  waiting: boolean,
  label?: ((name: string) => ToolLabel) | null
): string {
  if (!busy || waiting) return "";
  if (noReplyYet(messages)) return AMR_THINKING;
  // The reply so far ends with what Amr is doing now: a call, or his words.
  const content = messages[messages.length - 1].content;
  const block = content.at(-1);
  if (block?.type === "tool_use") {
    // No names to say them with: never so, since a call exists only once the
    // runtime, and with it the kit, is in.
    if (!label) return AMR_WORKING;
    // Every call in the message is this round's, and the client runs them
    // one at a time with no word of which, so name a tool only if it is the
    // one tool they all reach.
    const tools = new Set(
      content.flatMap((c) => (c.type === "tool_use" ? [label(c.name).tool] : []))
    );
    return tools.size === 1 ? amrWorkingIn(label(block.name).tool) : AMR_WORKING;
  }
  if (block?.type === "text" && !block.note && block.text.trim()) return AMR_WRITING;
  return AMR_THINKING;
}

/** The chat's status line, under the composer: the turn's phase in words (see the file comment). */
export function ChatStatus({ busy }: { busy: boolean }) {
  const label = useStripKit()?.toolLabel ?? null;
  const text = useAgentStore((s) => phaseText(s.messages, busy, s.pendingToolUse !== null, label));
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
