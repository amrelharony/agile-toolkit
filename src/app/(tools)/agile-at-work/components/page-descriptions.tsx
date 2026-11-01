"use client";

import { lineText } from "@/lib/comic/content";
import type { ReaderComic } from "../hooks/use-comic-content";

/**
 * Screen-reader text for the pages on screen: each page's lettering, linked
 * from its image by aria-describedby, so a page reads as its description
 * (the alt) followed by what is said on it.
 *
 * Rendered outside the page crossfade: while the old view fades out both
 * views are mounted, and ids inside them would repeat. While the visible
 * Transcript panel is open the same text is on screen, so this copy is
 * `hidden` (browse mode won't read it twice); a hidden element still
 * provides the description it is referenced for.
 */
export function PageDescriptions({ comic }: { comic: ReaderComic }) {
  const pages = comic.viewTranscripts.filter((t) => t.lines.length > 0);
  if (!pages.length) return null;
  return (
    <div className="sr-only" hidden={comic.transcriptOpen}>
      {pages.map((t) => (
        <div key={t.page} id={comic.descriptionId(t.page)}>
          {t.lines.map((line, i) => (
            // Lines have no id of their own, and their order is fixed.
            <p key={i}>{lineText(line)}</p>
          ))}
        </div>
      ))}
    </div>
  );
}
