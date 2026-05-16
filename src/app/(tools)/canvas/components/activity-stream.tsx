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

import { memo, useEffect, useMemo, useRef } from "react";
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
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
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
    const prev = typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null;
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
      className="fixed right-3 top-20 bottom-3 w-[300px] z-40 bg-surface border border-border rounded-lg shadow-xl flex flex-col"
      data-canvas-export-ignore="true"
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text">Activity</span>
          <span className="text-[10px] font-mono text-sub">{events.length}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close activity stream"
          className="text-sub hover:text-text"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {events.length === 0 ? (
          <div className="p-4 text-xs text-sub italic">
            No activity yet. Drag, edit, or import to see events here.
          </div>
        ) : (
          <ul className="divide-y divide-border" aria-label="Activity events">
            {events.map((e) => (
              <li key={e.id} className="p-3 text-xs">
                <div className="flex items-baseline justify-between mb-0.5">
                  <span className="font-semibold text-text">{e.author}</span>
                  <span className="text-[10px] text-sub font-mono">{relativeTime(e.at)}</span>
                </div>
                <div className="text-sub flex items-center gap-1.5">
                  <span className="text-[9px] uppercase font-bold text-accent/80 bg-accent/10 px-1.5 py-0.5 rounded">
                    {e.kind}
                  </span>
                  <span className="text-text">{e.summary}</span>
                </div>
              </li>
            ))}
          </ul>
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
