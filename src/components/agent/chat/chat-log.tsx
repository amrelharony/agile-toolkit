"use client";

/**
 * The chat's log: the comic strip itself, shared by both chats (the owner's
 * and a visitor's). It draws each lib/agent/chat-view item (chat-items) in
 * order, then whatever the chat shows after them (`children`: the empty
 * line, the thinking balloon, the confirm card, a notice).
 *
 *   role="log", named "Conversation"
 *   aria-live="off"   a log is polite by default, which would read out every
 *                     streamed word, every step and every re-render. The chat
 *                     speaks once per settled turn instead, through its one
 *                     status line and announcer, so nothing in here is live.
 *   id                the chat context's logId, for the controls that point
 *                     at it (the Latest button's aria-controls)
 *
 * It is a scroller (data-amr-scroll, for the phone sheet's CSS) with a floor,
 * so in a short panel the chat's root scrolls instead of the log collapsing
 * to nothing; compact (a phone's keyboard up), the floor drops to 3rem. Its
 * content sits in one wrapper, `contentRef`, whose size the frame's
 * scroll-follow watches (use-stick-to-bottom): a reply growing in place
 * changes no message count, only that size.
 *
 * Runtime parts (chat-items reaches the markdown renderer), so this lives in
 * chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts).
 */

import { forwardRef, type ReactNode, type Ref } from "react";
import type { ChatItem } from "@/lib/agent/chat-view";
import { cn } from "@/lib/utils";
import { COMPACT_LOG } from "../mascot/panel-context";
import { useChat } from "./chat-context";
import { ChatItemView } from "./chat-items";

export interface ChatLogProps {
  /** The strip's items, from lib/agent/chat-view. */
  items: readonly ChatItem[];
  /** What the log shows after its items: the empty line, thinking, the confirm card, a notice. */
  children?: ReactNode;
  /** The wrapper around the log's content, whose size grows as a reply streams in. */
  contentRef?: Ref<HTMLDivElement>;
  className?: string;
}

/** The comic strip, as a log that keeps its words to itself until the turn settles. */
export const ChatLog = forwardRef<HTMLDivElement, ChatLogProps>(function ChatLog(
  { items, children, contentRef, className },
  ref
) {
  const { logId } = useChat();
  return (
    <div
      ref={ref}
      id={logId}
      role="log"
      aria-label="Conversation"
      aria-live="off"
      data-amr-scroll=""
      className={cn(
        "min-h-[6rem] flex-1 overflow-y-auto overscroll-contain px-1 py-2",
        COMPACT_LOG,
        className
      )}
    >
      <div ref={contentRef} data-chat-content="" className="space-y-3">
        {items.map((item) => (
          <ChatItemView key={item.key} item={item} />
        ))}
        {children}
      </div>
    </div>
  );
});
