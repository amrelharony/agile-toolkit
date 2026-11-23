"use client";

/**
 * The comic strip fed from the agent store, for both chats' containers (the
 * owner's agent-conversation, the visitor's visitor-agent-panel): the chat's
 * frame (chat-frame: the log, the Latest button, the composer's footer) with
 * the store's messages turned into items (lib/agent/chat-view).
 *
 * The view that makes the items comes from the strip kit (chat/strip-kit,
 * through its holder chat/strip-kit-ref), not from an import here: the
 * owner's chat brings the kit statically, so its strip makes one view per
 * mount, as it always did; a visitor's brings it with the runtime, before
 * its first message. With no kit yet there is no message to turn into items
 * (a visitor's messages come only from that runtime), so the strip hands the
 * frame no items, and a visitor's first paint carries no chat view and no
 * markdown parser.
 *
 * Streaming. A streamed chunk patches one message in the store. Only this
 * component reads the messages, so only it renders again: the container
 * around it reads plain values that a chunk leaves as they were (busy, the
 * notice, the draft, whether a reply has begun), so it doesn't, and the
 * footer and the log's after-items it handed down are the same elements, so
 * React skips them too. The view keeps every unchanged item's identity
 * (createChatView), and each item is memoised (chat-items), so of the strip
 * only the reply still growing draws again. Amr's own shell never hears a
 * chunk (test/agent/chat-stream-renders.test.tsx).
 *
 * Also here, for both containers: whether Amr is still to begin his reply
 * (the thinking balloon). The chat's one status line, which says it in words,
 * is chat-status, outside the log, which is never live (chat-log).
 *
 * Runtime parts (the agent store, the kit's holder), so this lives in chat/,
 * which every-page code may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useMemo } from "react";
import type { ChatItem } from "@/lib/agent/chat-view";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import { ChatFrame, type ChatFrameProps } from "./chat-frame";
import { useStripKit } from "./strip-kit-ref";

/** The items while there is no kit, and so no message: one empty list, kept by identity. */
const NO_ITEMS: readonly ChatItem[] = Object.freeze([]);

/**
 * The chat's items from the store, each kept by identity while it doesn't
 * change. Reads the store's values a step needs (the reply streaming now,
 * whether a turn is under way, the call whose card is showing) and where a
 * picked-up thread's scene caption goes, as plain ids.
 */
export function useChatItems(): readonly ChatItem[] {
  const messages = useAgentStore((s) => s.messages);
  const streamingId = useAgentStore((s) => s.streamingMessageId);
  const streaming = useAgentStore((s) => s.streaming);
  const pendingId = useAgentStore((s) => s.pendingToolUse?.toolUseId ?? null);
  const resumedAfter = useAgentStore((s) => s.resumedAfter);
  // One view per chat on screen and kit: it keeps only what its last call
  // made. The owner's kit is in from the start; a visitor's comes with the
  // runtime, before any message.
  const kit = useStripKit();
  const view = useMemo(() => kit?.createChatView() ?? null, [kit]);
  return useMemo(
    () =>
      view ? view(messages, { streamingId, busy: streaming, pendingId, resumedAfter }) : NO_ITEMS,
    [view, messages, streamingId, streaming, pendingId, resumedAfter]
  );
}

/** A turn's reply has nothing to show yet: just sent, or between its rounds before a word. */
export function noReplyYet(messages: readonly ChatMessage[]): boolean {
  const last = messages.at(-1);
  return !last || last.role !== "assistant" || last.content.length === 0;
}

/**
 * Amr is still to begin his reply while `busy` (a turn under way, or one
 * starting): true from the send until his first word or step arrives, and
 * between a turn's rounds. A plain value, so a streamed chunk changes nothing.
 */
export function useAwaitingReply(busy: boolean): boolean {
  return useAgentStore((s) => busy && noReplyYet(s.messages));
}

export type ChatStripProps = Omit<ChatFrameProps, "items">;

/** The chat's frame with the store's items in its log. */
export function ChatStrip(props: ChatStripProps) {
  const items = useChatItems();
  return <ChatFrame {...props} items={items} />;
}
