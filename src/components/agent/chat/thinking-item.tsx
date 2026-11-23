"use client";

/**
 * Amr about to answer, the one strip item a chat draws before it has any
 * message: the thinking balloon, while a turn starts (the visitor's runtime
 * still loading) and until his reply's first words or steps arrive. Apart
 * from the other items (chat-items, which the strip kit brings: see
 * chat/strip-kit), so a visitor's chat draws it on its first paint without
 * carrying the rest. AMR_SIDE is his side of the log, which the other items'
 * balloons stand on too.
 *
 * Only the comic's chat-only parts (../comic/strip-parts), never comic-parts,
 * so nothing here rides on every page (test/agent/bundle-boundary.test.ts).
 */

import { memo } from "react";
import { ThinkingBalloon } from "../comic/strip-parts";

/** Amr's side of the log: a balloon stands there, mirrored when he moves, with room for its tail. */
export const AMR_SIDE =
  "ml-3.5 mr-auto group-data-[amr-side=right]/amr:ml-auto group-data-[amr-side=right]/amr:mr-3.5";

/**
 * Amr about to answer (a turn under way, no words or steps of its reply yet):
 * his balloon on his side with a pen scribbling in it and no words. Hidden
 * from assistive tech; the chat's status line says it in words.
 */
export const ThinkingItemView = memo(function ThinkingItemView() {
  return (
    <div className="flex" data-chat-item="thinking">
      <ThinkingBalloon className={AMR_SIDE} />
    </div>
  );
});
