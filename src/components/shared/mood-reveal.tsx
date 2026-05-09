"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { moodScrollReveal } from "@/lib/emotion/gsap";
import type { MoodScrollRevealOptions } from "@/lib/emotion/gsap";
import { cn } from "@/lib/utils";

interface MoodRevealProps extends MoodScrollRevealOptions {
  children: ReactNode;
  /** Selector for the child elements to stagger.  Defaults to `> *`. */
  childSelector?: string;
  className?: string;
  /** Disable the effect entirely (useful for SSR-heavy subtrees). */
  disabled?: boolean;
}

/** Max time to wait for GSAP before forcing children visible. */
const GSAP_FALLBACK_MS = 2_500;

/**
 * Wraps a block of content and scroll-reveals its immediate children using the
 * current emotion profile's ease + stagger.  If GSAP can't load (network
 * failure, blocked chunk), a safety timer forces children visible so the
 * layout never silently disappears.
 *
 * Reveal runs once per mount.  Consumers that need re-animation on prop
 * changes (e.g., filter switches that swap children) should pass a `key`
 * so React remounts the component.
 */
export function MoodReveal({
  children,
  childSelector = ":scope > *",
  className,
  disabled = false,
  ...options
}: MoodRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;

    // Scope the selector to children of this container so multiple reveal
    // zones on the same page don't fight for the same nodes.
    const nodes = Array.from(el.querySelectorAll<HTMLElement>(childSelector));
    if (nodes.length === 0) return;

    let killed = false;
    let tweenStarted = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tween: any = null;

    // Safety fallback: if GSAP doesn't successfully attach the tween within
    // GSAP_FALLBACK_MS, force the nodes visible.  Prevents the "whole page
    // stays invisible forever" failure mode when GSAP's dynamic chunk fails.
    const fallbackTimer = window.setTimeout(() => {
      if (killed || tweenStarted) return;
      for (const n of nodes) {
        n.style.opacity = "1";
        n.style.transform = "none";
      }
    }, GSAP_FALLBACK_MS);

    void moodScrollReveal(nodes, options).then((t) => {
      if (killed) {
        t?.scrollTrigger?.kill?.();
        t?.kill?.();
        return;
      }
      if (!t) {
        // moodScrollReveal returned null — force visibility explicitly.
        for (const n of nodes) {
          n.style.opacity = "1";
          n.style.transform = "none";
        }
        window.clearTimeout(fallbackTimer);
        return;
      }
      tweenStarted = true;
      window.clearTimeout(fallbackTimer);
      tween = t;
    });

    return () => {
      killed = true;
      window.clearTimeout(fallbackTimer);
      tween?.scrollTrigger?.kill?.();
      tween?.kill?.();
    };
    // options intentionally excluded from deps: reveal runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, childSelector]);

  return (
    <div ref={ref} className={cn(className)}>
      {children}
    </div>
  );
}
