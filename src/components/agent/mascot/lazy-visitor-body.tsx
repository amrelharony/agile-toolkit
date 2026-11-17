"use client";

/**
 * The open panel's visitor body (visitor-body: the tool finder, the consent
 * card and the visitor panel), loaded on demand so Amr's own chunk, which
 * every page loads, doesn't carry it.
 *
 * One import, shared: mascot-assistant fetches it ahead (prefetchVisitorBody)
 * when the browser is idle after Amr mounts and when a pointer or focus first
 * reaches him, so opening the panel almost never waits. Once it has loaded,
 * a panel opening draws the body at once. Until then the body's place holds
 * a plain box of the same size (the panel keeps its height, nothing jumps),
 * named for screen readers. If the import fails (offline, or a tab left open
 * across a deploy), a narration caption says so and Try again imports it
 * again; a failed import is never kept, so the next try or prefetch starts
 * afresh. Try again goes when pressed, so it hands focus to Amr's name plate
 * first, and to the new Try again if the import fails once more.
 */

import { useEffect, useRef, useState } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Narration } from "@/components/agent/comic/comic-parts";
import { Button } from "@/components/ui/button";
import { AMR_PANEL_TITLE_ID } from "./panel-header";
import type { VisitorBodyProps } from "./visitor-body";

type VisitorBodyModule = typeof import("./visitor-body");

/** Read by screen readers in the body's place while it loads. */
export const VISITOR_BODY_LOADING = "Loading the tool finder…";

/** Narration when the body's code couldn't load. */
export const VISITOR_BODY_LOAD_NOTE =
  "The tool finder couldn't load. Check your connection and try again.";

let loaded: VisitorBodyModule | null = null;
let loading: Promise<VisitorBodyModule> | null = null;

/** Imports the visitor body once; after a failure the next call tries again. */
export function loadVisitorBody(): Promise<VisitorBodyModule> {
  if (!loading) {
    loading = import("./visitor-body").then(
      (m) => (loaded = m),
      (err: unknown) => {
        loading = null;
        throw err;
      }
    );
  }
  return loading;
}

/** Fetches the visitor body ahead of the panel. A failure waits for the panel to try again. */
export function prefetchVisitorBody(): void {
  loadVisitorBody().catch(() => {});
}

export function LazyVisitorBody(props: VisitorBodyProps) {
  const [body, setBody] = useState(() => loaded);
  const [failed, setFailed] = useState(false);
  const announce = useAnnounce();
  /** Try again had focus when pressed: the next Try again takes it back. */
  const retried = useRef(false);
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (body || failed) return;
    let live = true;
    loadVisitorBody().then(
      (m) => {
        if (live) setBody(m);
      },
      () => {
        if (!live) return;
        setFailed(true);
        announce(VISITOR_BODY_LOAD_NOTE, "assertive");
      }
    );
    return () => {
      live = false;
    };
  }, [body, failed, announce]);

  // A Try again that failed once more: focus back on the new Try again, from
  // the name plate that held it (or the page, with no plate), unless the
  // visitor has moved it on since.
  useEffect(() => {
    if (!failed || !retried.current) return;
    retried.current = false;
    const at = document.activeElement;
    if (!at || at === document.body || at.id === AMR_PANEL_TITLE_ID) retryRef.current?.focus();
  }, [failed]);

  if (body) return <body.VisitorBody {...props} />;
  if (failed) {
    return (
      <div className="px-4 py-3">
        <Narration
          tone="error"
          actions={
            <Button
              ref={retryRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                // The button is about to go: hand focus to the name plate
                // (tabIndex -1), so it never drops to the page.
                if (document.activeElement === e.currentTarget) {
                  retried.current = true;
                  document.getElementById(AMR_PANEL_TITLE_ID)?.focus();
                }
                setFailed(false);
              }}
            >
              Try again
            </Button>
          }
        >
          {VISITOR_BODY_LOAD_NOTE}
        </Narration>
      </div>
    );
  }
  return (
    <div className="h-full" aria-busy="true">
      <span className="sr-only">{VISITOR_BODY_LOADING}</span>
    </div>
  );
}
