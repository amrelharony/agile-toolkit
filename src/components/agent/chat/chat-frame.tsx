"use client";

/**
 * The chat's frame, shared by both chats (the owner's and a visitor's): the
 * log's direct parent, holding the log, the Latest button and the composer's
 * footer, in that order, as one flex column.
 *
 *   root     h-full min-h-0 flex-col overflow-y-auto: in a tall panel nothing
 *            overflows here, the log takes the rest and scrolls inside
 *            itself; in a short one (a landscape phone, about 160 px) the log
 *            keeps its floor, the footer its height, and this root scrolls, so
 *            the composer and its buttons stay in reach. A scroller for the
 *            phone sheet's CSS (data-amr-scroll), keeping its scrolling to
 *            itself.
 *   log      chat-log, followed while the reader is at its end
 *            (use-stick-to-bottom): a resize, a streamed word or a new card
 *            pins it there again; reading further up, nothing moves it.
 *   Latest   while the reader is not at the end: a button in the flow just
 *            before the composer (never over the log or under docked Amr).
 *            It takes the log back to its newest line and hands focus to the
 *            composer, since it goes away as it does; not after a tap on a
 *            touch screen, where the box taking focus would raise the
 *            keyboard over the very lines the reader asked for.
 *   footer   the composer's row (`footer`: the message form and the lines
 *            under it), shrink-0 so it never gives up its height; while Amr
 *            is docked in the phone's sheet it makes room for him on his side
 *            and is at least as tall as he is.
 *
 * Something new in the log (an item, a turn starting or ending) also brings
 * the log back into the root's view when the root scrolls, with
 * root.scrollTo, never scrollIntoView. A different chat (a thread opened,
 * the first message) and the reader's own new message follow the log again.
 * Under Amr's Scenes view the chat stays mounted but hidden
 * (chat-visibility): nothing scrolls while it is, and when it shows again
 * the log follows from its newest line and comes back into the root's view.
 *
 * Speaking. Nothing in the log is live; the frame speaks for it through the
 * app's announcer (use-turn-announcer): once when a turn settles (`busy`
 * going false), with the turn's words; once for a waiting card that didn't
 * take focus; and an error at once, assertively. Never per streamed chunk.
 *
 * Focus. A control that takes itself away hands focus to the composer, caret
 * at the end, before it goes (the chat context's focusComposer): Latest does
 * here, except after a tap on a touch screen (a key press there still hands
 * focus over); Try again, Go on, starters and follow-ups do where they are
 * drawn.
 * The safety net catches any other case: when what had focus inside the
 * frame is taken out of the page and focus is left on nothing (the body),
 * the composer takes it, except on a coarse pointer, where a text field
 * taking focus raises the keyboard over the strip (as useInitialFocus never
 * focuses it there): focus stays where the removal left it. Focus the reader
 * moved themselves is never pulled back. A focusout says focus left (where
 * the browser sends one for a removed element), and a MutationObserver
 * catches a removal that sends none (Firefox, jsdom).
 *
 * Runtime parts (the log reaches the markdown renderer), so this lives in
 * chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts).
 */

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatItem } from "@/lib/agent/chat-view";
import { cn } from "@/lib/utils";
import { useChatVisible } from "../chat-visibility";
import { DOCK_FOOTER_IN_PX3 } from "../mascot/panel-context";
import { onTouchScreen, useChat } from "./chat-context";
import { ChatLog } from "./chat-log";
import { useStickToBottom } from "./use-stick-to-bottom";
import { useTurnAnnouncer } from "./use-turn-announcer";

export interface ChatFrameProps {
  /** The strip's items, from lib/agent/chat-view. */
  items: readonly ChatItem[];
  /**
   * A turn is under way, or starting: the log can grow with nothing new in its
   * items yet. The turn is spoken once when this goes false.
   */
  busy?: boolean;
  /** What the log shows after its items: the empty line, thinking, a notice. */
  children?: ReactNode;
  /** The composer's row: the message form, and the lines and buttons under it. */
  footer: ReactNode;
  /** The root's own padding, when the view around it gives none (px-3 py-2). */
  className?: string;
}

/** The log, the Latest button and the composer's footer, as one scrolling column. */
export function ChatFrame({ items, busy = false, children, footer, className }: ChatFrameProps) {
  const chat = useChat();
  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // False while Amr's Scenes view covers the chat (mounted, hidden).
  const visible = useChatVisible();
  const { atBottom, scrollToLatest, stick, reveal } = useStickToBottom(logRef, {
    contentRef,
    rootRef,
    visible,
  });
  useTurnAnnouncer({ items, busy, rootRef });

  // A different chat, or the chat filling from empty: follow from its end.
  const first = items[0]?.key ?? null;
  useEffect(() => {
    if (first !== null) stick();
  }, [first, stick]);

  // The reader's own new message: they are back at the latest, wherever
  // they were reading.
  const last = items.at(-1);
  const sent = last?.kind === "you" ? last.key : null;
  useEffect(() => {
    if (sent !== null) stick();
  }, [sent, stick]);

  // Something new, or the chat back in view: in a short panel, the log back
  // into the root's view (only while the reader follows; an empty chat stays
  // on the composer).
  const count = items.length;
  useEffect(() => {
    if (visible && (count > 0 || busy)) reveal();
  }, [count, busy, reveal, visible]);

  // The safety net (see the file comment). The chat context keeps its
  // identity (it changes only with the profile), so this is set up once.
  const { focusComposer } = chat;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const doc = root.ownerDocument;
    /** What had focus inside the frame, while it still might. */
    let held: Element | null = null;
    const rescue = () => {
      if (!held) return;
      if (held.isConnected) {
        // Still in the page: focus went where the reader sent it.
        held = null;
        return;
      }
      held = null;
      const active = doc.activeElement;
      if (active && active !== doc.body) return;
      // On a touch screen a text field taking focus raises the keyboard over
      // the strip the reader was looking at (a tapped Approve on Android):
      // leave focus where the removal left it.
      if (onTouchScreen(doc)) return;
      focusComposer();
    };
    const onFocusIn = (e: FocusEvent) => {
      held = e.target instanceof Element ? e.target : null;
    };
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget;
      // Elsewhere in the frame: its focusin takes over. Out of it: let go.
      if (to instanceof Node) {
        if (!root.contains(to)) held = null;
        return;
      }
      // To nothing: taken away, or a click on something that takes no focus.
      queueMicrotask(rescue);
    };
    const removals = new MutationObserver(() => {
      if (held && !held.isConnected) rescue();
    });
    removals.observe(root, { childList: true, subtree: true });
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      removals.disconnect();
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, [focusComposer]);

  const latest = (e: MouseEvent) => {
    // Focus first: the button goes as the log reaches its end. Not after a
    // tap on a touch screen: there a tap means "show me the newest", and the
    // box taking focus would raise the keyboard (compact mode, the log at its
    // floor) over it; as with the safety net, focus stays where the tap left
    // it. A key press (detail 0) still hands focus over.
    const tap = e.detail > 0 && onTouchScreen(rootRef.current?.ownerDocument);
    if (!tap) focusComposer();
    scrollToLatest();
  };

  return (
    <div
      ref={rootRef}
      data-amr-scroll=""
      data-chat-frame=""
      className={cn("flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain", className)}
    >
      <ChatLog ref={logRef} contentRef={contentRef} items={items}>
        {children}
      </ChatLog>
      {!atBottom && (
        <div className="mt-2 flex shrink-0 justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-controls={chat.logId}
            data-chat-latest=""
            onClick={latest}
          >
            <ArrowDown aria-hidden="true" />
            Latest
          </Button>
        </div>
      )}
      {/* Docked Amr (the phone's sheet) stands beside this, in its gutter. */}
      <div
        data-chat-footer=""
        className={cn("mt-2 shrink-0 border-t border-border pt-3", DOCK_FOOTER_IN_PX3)}
      >
        {footer}
      </div>
    </div>
  );
}
