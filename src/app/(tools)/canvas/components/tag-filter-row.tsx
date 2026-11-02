"use client";

/**
 * Tag filter chip row (Phase 26).
 *
 * Shows every tag currently used by any object on the active board.
 * Clicking a chip toggles it in the canvas-store `tagFilter`. When
 * `tagFilter` is non-empty, the WhiteboardCanvas dims any object
 * whose `tags` doesn't intersect the filter set.
 *
 * Lives just below the top toolbar; hidden when no object has any
 * tags (empty-state collapse keeps the chrome quiet for unconfigured
 * boards).
 */

import { memo, useMemo } from "react";
import { X, Tag } from "lucide-react";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { useCanvasStore } from "../use-canvas-store";

interface Props {
  objects: readonly WhiteboardObject[];
}

function TagFilterRowImpl({ objects }: Props) {
  const tagFilter = useCanvasStore((s) => s.tagFilter);
  const toggleTagFilter = useCanvasStore((s) => s.toggleTagFilter);
  const setTagFilter = useCanvasStore((s) => s.setTagFilter);

  // Union of all tags used by any object on the active board, with
  // count per tag for a quick "popularity" hint.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of objects) for (const t of o.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [objects]);

  const tags = useMemo(() => {
    // sort: active filter first, then by descending count, then alpha
    const entries = Array.from(counts.entries());
    entries.sort((a, b) => {
      const aActive = tagFilter.includes(a[0]) ? 1 : 0;
      const bActive = tagFilter.includes(b[0]) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
    return entries;
  }, [counts, tagFilter]);

  if (tags.length === 0) return null;

  return (
    <div
      data-canvas-export-ignore="true"
      // maskImage fades out the right edge of the chip strip when it
      // overflows horizontally, so users get a visual hint that more
      // chips are scrollable. Both `maskImage` and the vendor-prefixed
      // `WebkitMaskImage` are set for Safari < 15.4.
      style={{
        maskImage: "linear-gradient(to right, black 0%, black calc(100% - 24px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, black 0%, black calc(100% - 24px), transparent 100%)",
      }}
      className="absolute top-14 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-surface/95 border border-border rounded-lg px-2 py-1 shadow-md backdrop-blur-sm z-10 max-w-[80vw] overflow-x-auto"
      aria-label="Filter objects by tag"
    >
      <Tag className="w-3 h-3 text-sub flex-shrink-0" aria-hidden="true" />
      {tags.map(([t, n]) => {
        const active = tagFilter.includes(t);
        return (
          <button
            key={t}
            type="button"
            aria-pressed={active}
            onClick={() => toggleTagFilter(t)}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono transition-colors ${
              active
                ? "bg-accent/20 text-accent border border-accent/50"
                : "bg-surface-deep text-sub border border-transparent hover:text-text hover:border-border"
            }`}
          >
            {t}
            <span className={`text-xs ${active ? "text-accent" : "text-sub"}`}>{n}</span>
          </button>
        );
      })}
      {tagFilter.length > 0 && (
        <button
          type="button"
          aria-label="Clear tag filter"
          onClick={() => setTagFilter([])}
          className="min-touch-coarse -m-1 p-1 ml-1 text-sub hover:text-text"
        >
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export const TagFilterRow = memo(TagFilterRowImpl);
