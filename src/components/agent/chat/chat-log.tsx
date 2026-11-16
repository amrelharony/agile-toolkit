"use client";

/**
 * The chat's log: the comic strip itself, shared by both chats (the owner's
 * and a visitor's). It draws each lib/agent/chat-view item (chat-items) in
 * order, then whatever the chat shows after them (`children`: the empty
 * line, the thinking balloon, a notice). The confirm card shows under the
 * step it asks about (chat/tool-steps); one whose call isn't in the chat
 * shows here, after the items, so a turn never waits on a card no one sees.
 * Once a turn has settled, the latest reply gets its end right under it
 * (chat/reply-end: Copy reply, Try again, follow-ups), with what the
 * container wired for it.
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

import { Fragment, forwardRef, type ComponentType, type ReactNode, type Ref } from "react";
import type { ChatItem } from "@/lib/agent/chat-view";
import { cn } from "@/lib/utils";
import { COMPACT_LOG } from "../mascot/panel-context";
import { useChat } from "./chat-context";
import { ChatItemView, latestReply } from "./chat-items";
import { ConfirmCard } from "./confirm-card";
import type { ReplyEndProps, ReplyRetry } from "./reply-end";
import { cardUnderStep } from "./tool-steps";

/** The end of the latest reply (chat/reply-end), as the chat's container wires it. */
export interface ReplyEndWiring {
  /**
   * chat/reply-end's ReplyEnd, handed in so the chunk both chats share doesn't
   * carry it: the owner's chat imports it, a visitor's loads it with the first
   * message. Left out, or not in yet, a reply has no end.
   */
  replyEnd?: ComponentType<ReplyEndProps>;
  /** Try again, when the chat can run one now (the owner signed in, a visitor with a message left). */
  retry?: ReplyRetry;
}

export interface ChatLogProps extends ReplyEndWiring {
  /** The strip's items, from lib/agent/chat-view. */
  items: readonly ChatItem[];
  /** A turn is under way, or starting: no reply has settled, so none gets its end. */
  busy?: boolean;
  /** What the log shows after its items: the empty line, thinking, a notice. */
  children?: ReactNode;
  /** The wrapper around the log's content, whose size grows as a reply streams in. */
  contentRef?: Ref<HTMLDivElement>;
  className?: string;
}

/** The comic strip, as a log that keeps its words to itself until the turn settles. */
export const ChatLog = forwardRef<HTMLDivElement, ChatLogProps>(function ChatLog(
  { items, busy = false, replyEnd: ReplyEnd, retry, children, contentRef, className },
  ref
) {
  const { logId, profile } = useChat();
  // The latest reply, once its turn has settled: its end goes right under it.
  const end = busy || !ReplyEnd ? null : latestReply(items);
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
          <Fragment key={item.key}>
            <ChatItemView item={item} />
            {ReplyEnd && item === end?.reply && <ReplyEnd turn={end} retry={retry} />}
          </Fragment>
        ))}
        {!cardUnderStep(items) && <ConfirmCard allowApproveAll={profile === "owner"} />}
        {children}
      </div>
    </div>
  );
});
