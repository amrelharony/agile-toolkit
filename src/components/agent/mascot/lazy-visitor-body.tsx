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
 * afresh.
 */

import { useEffect, useState } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Narration } from "@/components/agent/comic/comic-parts";
import { Button } from "@/components/ui/button";
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

  if (body) return <body.VisitorBody {...props} />;
  if (failed) {
    return (
      <div className="px-4 py-3">
        <Narration
          tone="error"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => setFailed(false)}>
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
