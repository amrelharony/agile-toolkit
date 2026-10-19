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
  // Current result cursor — Enter advances. -1 means "no hit selected
  // yet"; first Enter jumps to index 0 (otherwise initialising to 0
  // would make first Enter jump to hit #2 because we'd do (0 + 1) %
  // length). Render shows 0/N while cursor is -1.
  const [cursor, setCursor] = useState(-1);

  // Stable onClose ref so the window-level Esc effect below doesn't
  // re-register on every parent render — the canvas commonly passes
  // an inline `onClose={() => setShowFind(false)}`.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Auto-focus the input on mount + select existing text so a second
  // Cmd+F opens fresh.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
  }, []);

  // Window-level Esc handler. Previously Esc only fired when focus was
  // INSIDE the find bar (onKeyDown on the wrapper div), so a user who
  // had clicked back onto the canvas couldn't dismiss the bar via Esc.
  // We close when:
  //   1. Esc hits the find-bar input itself (looking up via the
  //      `data-find-bar` attribute on the wrapper).
  //   2. Esc fires outside any text input — i.e. the canvas, a
  //      non-input element, or nothing focused.
  // We still skip Esc when focus is in a foreign INPUT/TEXTAREA so we
  // don't steal the IME dismissal / browser-autocomplete dismissal
  // from someone editing a sticky's title.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const insideFindBar =
        target && target.tagName === "INPUT" && target.closest("[data-find-bar]");
      const inForeignInput =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) &&
        !insideFindBar;
      if (insideFindBar) {
        // Esc in the find bar input — close.
        e.stopPropagation();
        onCloseRef.current();
      } else if (!inForeignInput) {
        // Esc outside any input (canvas / non-input element) — close.
        e.stopPropagation();
        onCloseRef.current();
      }
      // Otherwise: Esc is in some unrelated input. Let it through.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = useMemo<SearchHit[]>(
    () => searchObjects(objects, debouncedQuery),
    [objects, debouncedQuery]
  );

  // Clamp cursor when hits change (e.g. typing narrows results). Reset
  // to -1 ("no hit selected yet") so the next Enter jumps to hit #1,
  // not hit #2.
  useEffect(() => {
    if (hits.length === 0) {
      if (cursor !== -1) setCursor(-1);
    } else if (cursor >= hits.length) {
      setCursor(-1);
    }
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

  /** Enter / Shift+Enter handler. Special-cases the initial cursor=-1
   * state so the FIRST Enter lands on hit #1 instead of hit #2 (which
   * is what the naïve `cursor + 1` formula produces from cursor=0). */
  const advance = (direction: 1 | -1) => {
    if (hits.length === 0) return;
    if (cursor === -1) {
      goToHit(direction === 1 ? 0 : hits.length - 1);
      return;
    }
    goToHit(cursor + direction);
  };

  return (
    <div
      role="search"
      aria-label="Find on board"
      data-find-bar=""
      className="absolute top-3 right-3 z-30 flex flex-col bg-surface/95 border border-border rounded-lg shadow-xl backdrop-blur-sm w-[min(20rem,calc(100vw-1.5rem))]"
      data-canvas-export-ignore="true"
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
          // Combobox pattern (WAI-ARIA APG): the input drives a listbox
          // of results below. `aria-controls` ties them together so
          // screen readers announce "10 results" when the user types,
          // and `aria-activedescendant` tracks the current cursor row
          // inside the listbox without moving focus off the input.
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={query.trim().length > 0 && hits.length > 0}
          aria-controls="find-bar-results"
          aria-activedescendant={
            cursor >= 0 && hits[cursor] ? `find-bar-hit-${hits[cursor].id}` : undefined
          }
          className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-sub"
          onKeyDown={(e) => {
            // Enter cycles forward; Shift+Enter cycles backward.
            // ↓/↑ also navigate (matches browser find / VS Code).
            // stopPropagation so canvas-level shortcuts don't fire
            // through the find bar (Esc handled at window level).
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              advance(e.shiftKey ? -1 : 1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              e.stopPropagation();
              advance(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();
              advance(-1);
            }
            // Stop space + letter keys from triggering canvas tool
            // shortcuts. `keyboard.ts` already skips input/textarea
            // targets, but we still want a clean barrier here.
            e.stopPropagation();
          }}
        />
        <span className="text-xs font-mono text-sub tabular-nums whitespace-nowrap">
          {hits.length > 0 ? `${cursor === -1 ? 0 : cursor + 1}/${hits.length}` : "0/0"}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => advance(-1)}
            disabled={hits.length === 0}
            aria-label="Previous match"
            className="w-5 h-5 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronUp className="w-3 h-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => advance(1)}
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
          id="find-bar-results"
          className="max-h-[220px] overflow-y-auto overscroll-contain-strict"
          role="listbox"
          aria-label="Find results"
        >
          {hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-sub italic">No matches</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                id={`find-bar-hit-${h.id}`}
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
                <span className="font-mono text-xs uppercase text-sub flex-shrink-0">{h.type}</span>
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
