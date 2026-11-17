"use client";

/**
 * Keeps a chat's log on its newest line while the reader is there, and
 * leaves it alone while they read further up (design 1.3 item 7).
 *
 *   following   the reader is at the end of the log (within STICK_THRESHOLD),
 *               or was when it last grew: as a reply streams in, a card
 *               arrives or the log itself gets shorter (a phone's keyboard
 *               coming up), the log is pinned to its end again. A
 *               ResizeObserver on the log and on its content sees each
 *               change; nothing waits for a message count.
 *   reading     the reader went up (a scroll toward the top, a wheel or a
 *               finger pulling down, an arrow or Page Up key): nothing new
 *               moves the log. They follow again by coming back down to the
 *               end, by the Latest button (scrollToLatest), or by sending a
 *               message of their own (stick).
 *
 * A resize is never taken for the reader going up. Content that shrinks can
 * pull the scroll position back (the browser clamps it to the new end, or
 * keeps a line above in place); a scroll that comes with a shorter log, or
 * that ends at the very end, is the layout's, not the reader's. Only the
 * reader leaves following.
 *
 * Every scroll this hook writes waits for one animation frame, and a frame
 * writes once: however many resizes, new items and calls arrive between two
 * frames, the log moves at most once, after reading its size once. Pins are
 * instant (a smooth scroll would trail the words it follows); the Latest
 * button glides there, and under prefers-reduced-motion jumps. While that
 * glide runs, a pin re-aims it at the new end instead of cutting it short
 * (the button's row going away grows the log the frame the glide starts),
 * and leaves it be while the end stays where it is headed; it is over once
 * it lands or the reader leaves, and pins are instant again.
 *
 * The short panel: when the chat's root scrolls too (a landscape phone,
 * where the log's floor and the footer don't fit), `reveal` brings the log
 * back into the root's view with root.scrollTo, moving it only as far as
 * needed ("nearest"). Never scrollIntoView: that scrolls every scroller
 * around the log, the page included, and on iOS pans the visual viewport.
 *
 * Hidden: under Amr's Scenes view the chat stays mounted but hidden
 * (`visible` false, from chat-visibility), and a hidden log can't scroll, so
 * nothing is written while it is. When it is in view again it follows from
 * its newest line (stick), wherever the reader had been.
 *
 * Runtime-free (React only), but part of the chat, so it lives in chat/,
 * which every-page code may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** How close to the end of the log, in px, still counts as being at the end. */
export const STICK_THRESHOLD = 48;

/** A finger's travel, in px, that says which way the reader is pulling. */
const TOUCH_SLOP = 4;

/** Keys that scroll a log toward its top. */
const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

export interface StickToBottom {
  /**
   * The reader is at the end of the log, or following it as it grows. The
   * frame shows the Latest button while this is false.
   */
  atBottom: boolean;
  /**
   * Back to the newest line, following again: the Latest button. Smooth,
   * instant under prefers-reduced-motion.
   */
  scrollToLatest(): void;
  /** Follow again from here and pin at once: a new chat, the reader's own message. */
  stick(): void;
  /**
   * Something new is in the log: while the reader follows, pin it and, when
   * the chat's root scrolls (a short panel), bring the log into its view.
   */
  reveal(): void;
}

export interface StickToBottomOptions {
  /** The log's content, which grows as a reply streams in. */
  contentRef: RefObject<HTMLElement | null>;
  /** The chat's root, which scrolls only when the panel is too short for the log and the footer. */
  rootRef?: RefObject<HTMLElement | null>;
  /**
   * Whether the chat is in view (chat-visibility): false while Amr's Scenes
   * view covers it, mounted. Nothing is written while it is hidden.
   */
  visible?: boolean;
}

interface Seen {
  top: number;
  height: number;
}

interface Pending {
  /** Pin the log to its end, this way, unless the reader has left by then. */
  pin: ScrollBehavior | null;
  /** Bring the log into the root's view. */
  reveal: boolean;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** How far the log is from its end, in px. */
function distanceToEnd(el: HTMLElement): number {
  return el.scrollHeight - el.clientHeight - el.scrollTop;
}

function scrollElTo(el: HTMLElement, top: number, behavior: ScrollBehavior) {
  if (typeof el.scrollTo === "function") el.scrollTo({ top, behavior });
  else el.scrollTop = top;
}

/**
 * Where a scroller's view has to start so a part of its content is in it,
 * moving as little as possible (scrollIntoView's "nearest", for one
 * scroller): null when it is in view already, or covers the whole view.
 * All values in px along the scroller's content.
 */
export function nearestTop(
  viewTop: number,
  viewHeight: number,
  partTop: number,
  partHeight: number
): number | null {
  const viewEnd = viewTop + viewHeight;
  const partEnd = partTop + partHeight;
  if (partTop >= viewTop && partEnd <= viewEnd) return null;
  if (partTop <= viewTop && partEnd >= viewEnd) return null;
  // Above the view and fits, or below it and taller: its top edge leads.
  if (
    (partTop < viewTop && partHeight <= viewHeight) ||
    (partEnd > viewEnd && partHeight > viewHeight)
  ) {
    return partTop;
  }
  return partEnd - viewHeight;
}

/**
 * Whether a scroller inside the log, between the target and the log, can
 * still go up itself (owner Details, a long code block): it takes the
 * reader's scroll, and the log stays where it is.
 */
function innerScrollerTakes(target: EventTarget | null, log: HTMLElement): boolean {
  for (let node = target instanceof Element ? target : null; node && node !== log; ) {
    if (node instanceof HTMLElement && node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

/** A field that takes arrow keys for its own caret. */
function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Follow the log at `scrollRef` (a scroller) while the reader is at its end.
 * See the file comment for the rules.
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLElement | null>,
  { contentRef, rootRef, visible = true }: StickToBottomOptions
): StickToBottom {
  const [atBottom, setAtBottom] = useState(true);
  /** In view; set before paint, so a frame already asked for sees it. */
  const inView = useRef(visible);
  /** It was hidden since it last followed from its end. */
  const wasHidden = useRef(!visible);
  const stuck = useRef(true);
  const shown = useRef(true);
  const seen = useRef<Seen>({ top: 0, height: 0 });
  const pending = useRef<Pending>({ pin: null, reveal: false });
  const frame = useRef<number | null>(null);
  /**
   * The end the Latest button's glide is headed for: -1 once asked for and
   * not yet started, null when no glide runs.
   */
  const glide = useRef<number | null>(null);

  /** Follow, or stop following; React hears only a change. */
  const follow = useCallback((on: boolean) => {
    stuck.current = on;
    // The reader left: their scroll ends any glide.
    if (!on) glide.current = null;
    if (shown.current !== on) {
      shown.current = on;
      setAtBottom(on);
    }
  }, []);

  /** Where the log stood when this hook last looked. */
  const note = useCallback((el: HTMLElement) => {
    seen.current = { top: el.scrollTop, height: el.scrollHeight };
  }, []);

  /** The one frame's writes: the log first, then the root. */
  const flush = useCallback(() => {
    frame.current = null;
    const { pin, reveal } = pending.current;
    pending.current = { pin: null, reveal: false };
    const el = scrollRef.current;
    // Hidden, it can't scroll: it follows from its end once it shows again.
    if (!el?.isConnected || !inView.current) return;
    // The reader may have left since this was asked for: their scroll wins.
    if (pin && stuck.current) {
      const end = Math.max(0, el.scrollHeight - el.clientHeight);
      const away = Math.abs(end - el.scrollTop) > 0.5;
      if (pin === "smooth") {
        // The glide: at the end, it is over; headed for this end already,
        // scrolling again would only restart its easing.
        if (!away) glide.current = null;
        else if (glide.current !== end) {
          scrollElTo(el, end, "smooth");
          glide.current = end;
        }
      } else {
        glide.current = null;
        if (away) scrollElTo(el, end, pin);
      }
    }
    const root = rootRef?.current;
    if (reveal && stuck.current && root && root.scrollHeight - root.clientHeight > 1) {
      const view = root.getBoundingClientRect();
      const log = el.getBoundingClientRect();
      const top = log.top - view.top - root.clientTop + root.scrollTop;
      const to = nearestTop(root.scrollTop, root.clientHeight, top, log.height);
      if (to !== null) scrollElTo(root, Math.max(0, to), "instant");
    }
    note(el);
  }, [note, rootRef, scrollRef]);

  const schedule = useCallback(
    (pin: ScrollBehavior | null, reveal = false) => {
      const next = pending.current;
      // An instant pin wins over a glide asked for in the same frame.
      if (pin) next.pin = next.pin === "instant" ? "instant" : pin;
      if (reveal) next.reveal = true;
      if (frame.current === null) frame.current = window.requestAnimationFrame(flush);
    },
    [flush]
  );

  /** A pin that keeps the log at its end: re-aiming the Latest glide while it runs, else instant. */
  const pinWay = useCallback(
    (): ScrollBehavior => (glide.current !== null ? "smooth" : "instant"),
    []
  );

  const stick = useCallback(() => {
    // The reader's own message or a new chat jumps, glide or not.
    glide.current = null;
    follow(true);
    schedule("instant");
  }, [follow, schedule]);

  const scrollToLatest = useCallback(() => {
    follow(true);
    const jump = prefersReducedMotion();
    glide.current = jump ? null : -1;
    schedule(jump ? "instant" : "smooth");
  }, [follow, schedule]);

  const reveal = useCallback(() => {
    if (stuck.current) schedule(pinWay(), true);
  }, [pinWay, schedule]);

  useLayoutEffect(() => {
    inView.current = visible;
  }, [visible]);

  // Back from under the Scenes view: follow again from the newest line.
  useEffect(() => {
    if (!visible) {
      wasHidden.current = true;
      return;
    }
    if (!wasHidden.current) return;
    wasHidden.current = false;
    stick();
  }, [visible, stick]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    note(el);

    /** The reader is heading up: stop following, unless there's nothing above or an inner scroller takes it. */
    const leave = (target: EventTarget | null) => {
      if (stuck.current && el.scrollTop > 0 && !innerScrollerTakes(target, el)) follow(false);
    };

    const onScroll = () => {
      const { scrollTop: top, scrollHeight: height } = el;
      const dist = distanceToEnd(el);
      const last = seen.current;
      // Up, with no less content than before, and not at the very end: the
      // reader. Less content (a clamp, a line above kept in place) is the
      // layout's, and a bounce back to the end (iOS) is not a step away.
      const wentUp = top < last.top - 1 && height >= last.height && dist > 1;
      if (wentUp) follow(false);
      else if (dist <= STICK_THRESHOLD) follow(true);
      // The glide landed: growth after it pins at once again.
      if (dist <= 1) glide.current = null;
      note(el);
    };

    // Intent arrives before the scroll it causes: a pin in between would
    // cut the browser's own glide short and pull the reader back.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) leave(e.target);
    };
    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y === undefined || touchY === null) return;
      // A finger pulling down scrolls the log toward its top.
      if (y > touchY + TOUCH_SLOP) leave(e.target);
      touchY = y;
    };
    const onTouchEnd = () => {
      touchY = null;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (UP_KEYS.has(e.key) && !e.altKey && !isTextField(e.target)) leave(e.target);
    };

    const passive = { passive: true } as const;
    el.addEventListener("scroll", onScroll, passive);
    el.addEventListener("wheel", onWheel, passive);
    el.addEventListener("touchstart", onTouchStart, passive);
    el.addEventListener("touchmove", onTouchMove, passive);
    el.addEventListener("touchend", onTouchEnd, passive);
    el.addEventListener("touchcancel", onTouchEnd, passive);
    el.addEventListener("keydown", onKeyDown);

    // A resize re-pins a log that was following (re-aiming a glide under
    // way), and otherwise never moves it: it can only bring the reader back
    // once the log ends where they are.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => {
        if (stuck.current) schedule(pinWay());
        else if (distanceToEnd(el) <= 1) follow(true);
      });
      observer.observe(el);
      const content = contentRef.current;
      if (content) observer.observe(content);
    }

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("keydown", onKeyDown);
      observer?.disconnect();
      if (frame.current !== null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, [contentRef, follow, note, pinWay, schedule, scrollRef]);

  // No ResizeObserver (an old browser): follow after every render instead,
  // which is when the log's content can have changed.
  useEffect(() => {
    if (typeof ResizeObserver !== "function" && stuck.current) schedule(pinWay());
  });

  return { atBottom, scrollToLatest, stick, reveal };
}
