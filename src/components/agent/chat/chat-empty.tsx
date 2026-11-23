"use client";

/**
 * The empty chat, shared by both chats' logs (the owner's and a visitor's): a
 * narration caption told in the third person (never a balloon, which holds
 * only the model's words, and never a new line in Amr's voice), then up to
 * three starters (suggestion-chips) that the container picks for the page
 * the reader is on (lib/agent/owner-starters, lib/agent/visitor-starters).
 *
 *   held   the owner's chat is still looking for a thread to resume (once a
 *          page load, agent-conversation): nothing shows until that has
 *          settled, so no starter flashes up before a thread loads over it
 *   short  the log has little room (the 160 px panel of a landscape phone,
 *          a phone's keyboard up): `short` in place of `line`, and one
 *          starter, so the composer stays in reach
 *
 * Short is read off the log's own height, which its content never changes
 * (the log takes the room the panel leaves it, down to its floor), so
 * collapsing never feeds back. A ResizeObserver follows it, before paint.
 * Not live (the log never is), and nothing moves in.
 *
 * Runtime parts (the starters reach the agent store), so this lives in
 * chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts).
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Narration } from "../comic/comic-parts";
import { SuggestionChips } from "./suggestion-chips";

/** The most starters an empty chat shows. */
export const MAX_STARTERS = 3;

/**
 * A log shorter than this many rem has room for one line and one starter
 * only. The 160 px panel's log sits at its 6rem floor; the full empty state
 * (two lines and three starters at 44 px) needs about 14rem.
 */
export const SHORT_LOG_REM = 15;

export interface ChatEmptyProps {
  /** The narration line, in the third person. */
  line: string;
  /** Its one-line form, for a short log. */
  short: string;
  /** The reader's own questions, the page's first: at most MAX_STARTERS show. */
  starters: readonly string[];
  /** The owner's resume check hasn't settled yet: show nothing so far. */
  held?: boolean;
}

/** The log around `el` has little room (see SHORT_LOG_REM), followed as it resizes. */
function useShortLog(el: RefObject<HTMLElement>): boolean {
  const [short, setShort] = useState(false);
  useLayoutEffect(() => {
    const log = el.current?.closest<HTMLElement>('[role="log"]');
    const view = log?.ownerDocument.defaultView;
    if (!log || !view) return;
    const measure = () => {
      const rem = parseFloat(view.getComputedStyle(log.ownerDocument.documentElement).fontSize);
      const h = log.clientHeight;
      // No height at all: not laid out (hidden), so nothing to go by.
      setShort(h > 0 && h < SHORT_LOG_REM * (rem || 16));
    };
    measure();
    if (typeof view.ResizeObserver !== "function") return;
    const watch = new view.ResizeObserver(measure);
    watch.observe(log);
    return () => watch.disconnect();
  }, [el]);
  return short;
}

/** The empty chat: a narration line and the starters (see the file comment). */
export function ChatEmpty({ line, short, starters, held = false }: ChatEmptyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const compact = useShortLog(ref);
  const shown = starters.slice(0, compact ? 1 : MAX_STARTERS);
  return (
    <div
      ref={ref}
      hidden={held}
      className="space-y-2"
      data-chat-empty=""
      data-short={compact ? "" : undefined}
    >
      {!held && (
        <>
          <Narration>{compact ? short : line}</Narration>
          {shown.length > 0 && <SuggestionChips starters={shown} />}
        </>
      )}
    </div>
  );
}
