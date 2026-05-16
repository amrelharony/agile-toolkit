"use client";

/**
 * Find on board (Cmd+F).
 *
 * A power-user shortcut every Miro/Figma user expects. Opens a small
 * search overlay anchored to the top-center of the canvas; matches are
 * computed live via `searchObjects` against all text-bearing objects
 * (sticky, text, shape content, frame label, connector label, embed
 * URL, image alt). Enter cycles forward, Shift+Enter cycles backward.
 *
 * Pressing a result pans + zooms the camera to centre that object
 * via `fitToRects` and selects it. The bar stays open so the user
 * can keep scanning.
 *
 * Auto-closes on Esc (also commits any unsaved camera focus to the
 * last hit). Esc is captured so the canvas-level Esc handler doesn't
 * also clear the selection at the same time.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, ChevronDown, ChevronUp } from "lucide-react";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { searchObjects, type SearchHit } from "@/lib/whiteboard/search";
import { fitToRects } from "@/lib/whiteboard/canvas-transform";
import type { Camera } from "@/lib/geometry/bbox";

interface FindBarProps {
  objects: readonly WhiteboardObject[];
  viewportSize: { w: number; h: number };
  onPanToRect: (camera: Camera) => void;
  onSelect: (ids: string[]) => void;
  onClose: () => void;
}

function FindBarImpl({ objects, viewportSize, onPanToRect, onSelect, onClose }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  // Debounced version of `query` — `searchObjects` runs against ALL
  // objects on every change. At 1000+ objects + fast typing this can
  // burn ~5000 ops/sec and lag the input. 120 ms feels instant while
  // letting fast typists race ahead before we recompute.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    if (query === debouncedQuery) return;
    const h = setTimeout(() => setDebouncedQuery(query), 120);
    return () => clearTimeout(h);
  }, [query, debouncedQuery]);
  // Current result cursor — Enter advances. `null` means "no hit selected
  // yet"; first Enter jumps to index 0.
  const [cursor, setCursor] = useState(0);

  // Auto-focus the input on mount + select existing text so a second
  // Cmd+F opens fresh.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
  }, []);

  const hits = useMemo<SearchHit[]>(() => searchObjects(objects, debouncedQuery), [objects, debouncedQuery]);

  // Clamp cursor when hits change (e.g. typing narrows results).
  useEffect(() => {
    if (cursor >= hits.length) setCursor(0);
  }, [hits.length, cursor]);

  /** Pan + select to a specific hit index. Defensive: if a peer
   * deleted the target object between the search and the click,
   * `objects` no longer contains it. We re-check ownership here so
   * we don't set a ghost selection. */
  const goToHit = (idx: number) => {
    if (hits.length === 0 || viewportSize.w === 0) return;
    const clamped = ((idx % hits.length) + hits.length) % hits.length;
    setCursor(clamped);
    const hit = hits[clamped];
    // Verify the hit is still in the live object list. If the object
    // was deleted (locally or by a peer) since the search ran, skip
    // the selection — selecting a phantom id would confuse the
    // property panel / selection handles.
    if (!objects.some((o) => o.id === hit.id)) return;
    const camera = fitToRects([hit.rect], viewportSize.w, viewportSize.h, 0.6);
    if (camera) onPanToRect(camera);
    onSelect([hit.id]);
  };

  return (
    <div
      role="search"
      aria-label="Find on board"
      className="absolute top-3 right-3 z-30 flex flex-col bg-surface/95 border border-border rounded-lg shadow-xl backdrop-blur-sm w-[320px] max-w-[90vw]"
      data-canvas-export-ignore="true"
      // Esc captured so the canvas-level shortcut handler doesn't clear
      // the selection at the same time.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="w-4 h-4 text-sub flex-shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find on board…"
          aria-label="Find on board query"
          className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-sub"
          onKeyDown={(e) => {
            // Enter cycles forward; Shift+Enter cycles backward.
            // ↓/↑ also navigate (matches browser find / VS Code).
            // stopPropagation so canvas-level shortcuts don't fire
            // through the find bar (Esc handled at the wrapper).
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (hits.length === 0) return;
              goToHit(e.shiftKey ? cursor - 1 : cursor + 1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              e.stopPropagation();
              if (hits.length > 0) goToHit(cursor + 1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();
              if (hits.length > 0) goToHit(cursor - 1);
            }
            // Stop space + letter keys from triggering canvas tool
            // shortcuts. `keyboard.ts` already skips input/textarea
            // targets, but we still want a clean barrier here.
            e.stopPropagation();
          }}
        />
        <span className="text-[10px] font-mono text-sub tabular-nums whitespace-nowrap">
          {hits.length > 0 ? `${cursor + 1}/${hits.length}` : "0/0"}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => goToHit(cursor - 1)}
            disabled={hits.length === 0}
            aria-label="Previous match"
            className="w-5 h-5 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronUp className="w-3 h-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => goToHit(cursor + 1)}
            disabled={hits.length === 0}
            aria-label="Next match"
            className="w-5 h-5 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronDown className="w-3 h-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close find bar"
            className="w-5 h-5 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Results list — only renders when there's something to show. */}
      {query.trim().length > 0 && (
        <div
          className="max-h-[220px] overflow-y-auto"
          role="listbox"
          aria-label="Find results"
        >
          {hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-sub italic">No matches</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                type="button"
                role="option"
                aria-selected={cursor === i}
                onClick={() => goToHit(i)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                  cursor === i
                    ? "bg-accent/10 text-text"
                    : "text-sub hover:bg-surface-deep hover:text-text"
                }`}
              >
                <span className="font-mono text-[9px] uppercase text-sub flex-shrink-0">
                  {h.type}
                </span>
                <span className="truncate flex-1">{h.preview}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export const FindBar = memo(FindBarImpl);
