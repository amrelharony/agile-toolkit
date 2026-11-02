"use client";

/**
 * Activity stream panel (Phase 32).
 *
 * Reads `whiteboardActivityLog` from the workspace store, filtered to
 * the active board. Displays a reverse-chronological list with author
 * + summary + relative timestamp. Click an entry to highlight any
 * referenced object on the canvas (future — currently just dismissed).
 *
 * The log is a rolling 200-event ring per board (see workspace-store
 * `appendWhiteboardActivity`). Persisted to localStorage.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";

// R10-deferred: render in chunks of 50 instead of mounting up to 200
// rows at once.
const ACTIVITY_INITIAL_RENDER = 50;
const ACTIVITY_RENDER_CHUNK = 50;
import { X, Activity } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

interface Props {
  boardId: string;
  onClose: () => void;
}

function ActivityStreamImpl({ boardId, onClose }: Props) {
  const log = useWorkspaceStore((s) => s.whiteboardActivityLog ?? []);
  const events = useMemo(() => {
    // Filter to this board, sort by `at` descending.
    return log
      .filter((e) => e.boardId === boardId)
      .slice()
      .sort((a, b) => b.at - a.at);
  }, [log, boardId]);
  const [renderLimit, setRenderLimit] = useState(ACTIVITY_INITIAL_RENDER);
  // R11-fix: reset only when the oldest event id changes — proxy for
  // "filter / board switched", NOT for "a new event arrived". The
  // previous reset-on-`events`-identity fired on every peer move, drag,
  // or text edit, bouncing the user back to the first 50 mid-scroll
  // and making "Load more" unreachable on a busy board.
  const oldestId = events.length > 0 ? events[events.length - 1].id : null;
  useEffect(() => {
    setRenderLimit(ACTIVITY_INITIAL_RENDER);
  }, [oldestId, boardId]);

  // Stable callback ref so the keydown effect doesn't re-register on
  // every parent render. The canvas typically passes an inline
  // `onClose={() => setShowActivity(false)}` which changes identity
  // each render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc closes the panel for keyboard users. Bubble phase + INPUT
  // guard so we don't fight in-progress IME composition / native
  // autocomplete in any nested input (the panel itself has none today,
  // but matches the canvas-wide Esc convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus restore — when the panel unmounts, return focus to whatever
  // element was focused before it opened (typically the toolbar button
  // that toggled it). Keyboard / screen-reader users expect to land
  // back where they were.
  useEffect(() => {
    const prev =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    return () => {
      prev?.focus?.();
    };
  }, []);

  return (
    <div
      // Side drawer — not a modal: the canvas behind remains usable
      // (no backdrop, no focus trap), so `role="complementary"` is the
      // accurate landmark. Screen readers expose it as a peer region.
      role="complementary"
      aria-label="Board activity"
      className="fixed right-3 top-20 bottom-3 w-[min(18.75rem,calc(100vw-1.5rem))] z-40 bg-surface border border-border rounded-lg shadow-xl flex flex-col pr-safe pb-safe"
      data-canvas-export-ignore="true"
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text">Activity</span>
          <span className="text-xs font-mono text-sub">{events.length}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close activity stream"
          className="text-sub hover:text-text min-touch-coarse inline-flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto overscroll-contain-strict">
        {events.length === 0 ? (
          <div className="p-4 text-xs text-sub italic">
            No activity yet. Drag, edit, or import to see events here.
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border" aria-label="Activity events">
              {/* R10-deferred: chunk-render. The activity log can reach
                  ~200 events per board; mounting them all on every
                  open burns CPU for items the user won't scroll to.
                  Default to the most recent N + Load More. */}
              {events.slice(0, renderLimit).map((e) => (
                <li key={e.id} className="p-3 text-xs">
                  <div className="flex items-baseline justify-between mb-0.5">
                    <span className="font-semibold text-text">{e.author}</span>
                    <span className="text-xs text-sub font-mono">{relativeTime(e.at)}</span>
                  </div>
                  <div className="text-sub flex items-center gap-1.5">
                    <span className="text-xs uppercase font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                      {e.kind}
                    </span>
                    <span className="text-text">{e.summary}</span>
                  </div>
                </li>
              ))}
            </ul>
            {events.length > renderLimit && (
              <div className="p-3 text-center border-t border-border">
                <button
                  type="button"
                  onClick={() => setRenderLimit((n) => n + ACTIVITY_RENDER_CHUNK)}
                  className="text-xs text-accent hover:text-accent underline-offset-2 hover:underline"
                >
                  Load {Math.min(ACTIVITY_RENDER_CHUNK, events.length - renderLimit)} more
                </button>
                <div className="text-xs text-sub mt-1">
                  Showing {renderLimit} of {events.length}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function relativeTime(at: number): string {
  const now = Date.now();
  const sec = Math.floor((now - at) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  // For older events, show ISO date only.
  return new Date(at).toLocaleDateString();
}

export const ActivityStream = memo(ActivityStreamImpl);
