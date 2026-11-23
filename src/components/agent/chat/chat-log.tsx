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
 * The parts that draw messages (the items, latestReply, the card and
 * cardUnderStep) come from the strip kit (chat/strip-kit, through its holder
 * chat/strip-kit-ref), not from imports here: the owner's chat brings the kit
 * statically, a visitor's with the runtime, before its first message. With
 * no kit yet there is no message to draw (a visitor's messages come only
 * from that runtime), so the log holds its `children` alone, in the same two
 * wrappers.
 *
 *   role="log", named "Conversation"
 *   aria-live="off"   a log is polite by default, which would read out every
 *                     streamed word, every step and every re-render. The chat
 *                     speaks once per settled turn instead, through its one
 *                     status line and announcer, so nothing in here is live.
 *   id                the chat context's logId, for the controls that point
 *                     at it (the Latest button's aria-controls)
 *   tabIndex=0        a keyboard stop of its own, so the keys can scroll it
 *                     when nothing in it takes focus (a visitor's chat once
 *                     the messages have run out: the strip ends on the refused
 *                     question, with no reply end to Tab to). Its ring is drawn
 *                     inside its edge (high contrast's too), where the frame's
 *                     scrolling can't cut it off, and over the strip: the log
 *                     is its own stack (isolate) with its content at the
 *                     bottom of it (-z-10), so a balloon scrolled under the top
 *                     or bottom edge never paints over the line. Nothing
 *                     focuses it from code: the log is never a view's first
 *                     focus (use-panel-focus).
 *
 * It is a scroller (data-amr-scroll, for the phone sheet's CSS) with a floor,
 * so in a short panel the chat's root scrolls instead of the log collapsing
 * to nothing; compact (a phone's keyboard up), the floor drops to 3rem. Its
 * content sits in one wrapper, `contentRef`, whose size the frame's
 * scroll-follow watches (use-stick-to-bottom): a reply growing in place
 * changes no message count, only that size.
 *
 * Runtime parts (the chat context and the kit's holder), so this lives in
 * chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts).
 */

import { Fragment, forwardRef, type ComponentType, type ReactNode, type Ref } from "react";
import type { ChatItem } from "@/lib/agent/chat-view";
import { cn } from "@/lib/utils";
import { COMPACT_LOG } from "../mascot/panel-context";
import { useChat } from "./chat-context";
import type { ReplyEndProps, ReplyRetry } from "./reply-end";
import { useStripKit } from "./strip-kit-ref";

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
  // The parts that draw messages; none yet means no message to draw.
  const kit = useStripKit();
  // The latest reply, once its turn has settled: its end goes right under it.
  const end = busy || !ReplyEnd || !kit ? null : kit.latestReply(items);
  return (
    <div
      ref={ref}
      id={logId}
      role="log"
      aria-label="Conversation"
      aria-live="off"
      tabIndex={0}
      data-amr-scroll=""
      className={cn(
        "isolate min-h-[6rem] flex-1 overflow-y-auto overscroll-contain px-1 py-2",
        // The site's own focus line (globals.css :focus-visible, high
        // contrast's heavier one too), moved inside the edge.
        "focus-visible:!outline-offset-[-3px]",
        COMPACT_LOG,
        className
      )}
    >
      {/* Below the log's own focus line in its stack (the balloons are positioned, so they would paint over it). */}
      <div ref={contentRef} data-chat-content="" className="relative -z-10 space-y-3">
        {kit &&
          items.map((item) => (
            <Fragment key={item.key}>
              <kit.ChatItemView item={item} />
              {ReplyEnd && item === end?.reply && <ReplyEnd turn={end} retry={retry} />}
            </Fragment>
          ))}
        {kit && !kit.cardUnderStep(items) && (
          <kit.ConfirmCard allowApproveAll={profile === "owner"} />
        )}
        {children}
      </div>
    </div>
  );
});
