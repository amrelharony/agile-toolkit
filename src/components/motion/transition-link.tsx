"use client";

/**
 * next/link, plus a cross-fade when the page changes
 * (lib/motion/page-transition.ts). Every internal link in src renders this
 * (test/motion/link-coverage.test.ts), so the rules live in one place.
 *
 * It calls no next/navigation hook: the router hook throws where no app
 * router is mounted, and cards render in tests that have none. The router
 * comes from the navigator RouteSignal registers; with none registered, or
 * when a rule keeps the change instant, the click is left to next/link as
 * it was. prefetch={false} means the page is not loaded ahead, so it is
 * always instant.
 */

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import { pushWithTransition } from "@/lib/motion/page-transition";

export type TransitionLinkProps = ComponentPropsWithoutRef<typeof Link> & {
  /**
   * This is a card's main link, whose frame is to grow into the new page's
   * header. Nothing reads it yet; it only stays off the anchor.
   */
  frame?: boolean;
};

const TransitionLink = forwardRef<HTMLAnchorElement, TransitionLinkProps>(function TransitionLink(
  // `frame` is taken out so it never reaches the anchor.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  { frame, onClick, ...props },
  ref
) {
  return (
    <Link
      {...props}
      ref={ref}
      onClick={(event) => {
        // The caller's own handler first, as next/link does: it may stop the change.
        onClick?.(event);
        const a = event.currentTarget;
        const href = a.getAttribute("href");
        // A new tab, a download or a modified click stays the browser's.
        const plainClick =
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          (!a.target || a.target === "_self") &&
          !a.hasAttribute("download");
        if (
          !event.defaultPrevented &&
          plainClick &&
          href &&
          pushWithTransition(href, {
            replace: props.replace,
            scroll: props.scroll,
            source: a,
            prefetch: props.prefetch,
          })
        ) {
          // Taken over: next/link sees this and stays out of it.
          event.preventDefault();
        }
      }}
    />
  );
});

export default TransitionLink;
