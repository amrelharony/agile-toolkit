"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ToolHistoryDrawer } from "@/components/history/tool-history-drawer";
import { UndoRedoControls } from "@/components/history/undo-redo-controls";
import { SavedChip } from "@/components/data/saved-chip";
import { HowItWorks } from "@/components/tool-frame/how-it-works";
import { RelatedTools } from "@/components/tool-frame/related-tools";
import { PresentButton } from "@/components/presentation/presentation-mode";
import { FavoriteButton } from "@/components/tool-frame/favorite-button";
import { InkArt } from "@/components/ink/ink-art";
import { useToolArt } from "@/components/ink/tool-art-context";
import type { InkDrawing } from "@/lib/ink/types";
import { growFrom } from "@/lib/motion/grow-from";
import { isFrameLanding, takeGrowSpot } from "@/lib/motion/page-transition";
import { cn } from "@/lib/utils";

// Only a tool's own page (toolId) shows these. The insight and next-step
// rules import most tools' stores between them: about 190 kB gzipped that a
// page without a toolId (the comics, the book, VIP) used to download and parse
// before it could respond. Both render nothing until this browser's workspace
// has loaded, so loading them on the client only leaves the server HTML as it
// was. "How this works" is in that HTML, so it stays static: server-rendered
// behind next/dynamic, hydration would leave it for later, and an early context
// update (auth settling) would swap it for an empty fallback until its chunk
// came, moving the tool up and back down. Its own code is small; the guide
// text already loads on demand.
const InsightsEngine = dynamic(
  () => import("@/components/shared/insights-engine").then((m) => m.InsightsEngine),
  { ssr: false }
);
const NextStepCard = dynamic(
  () => import("@/components/tool-frame/next-step").then((m) => m.NextStepCard),
  { ssr: false }
);

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ToolPageWrapperProps {
  title: string;
  description: string;
  category?: string;
  toolId?: string;
  showInsights?: boolean;
  /** Hide the per-tool history drawer (defaults to on when toolId is set). */
  showHistory?: boolean;
  /**
   * The header's spot drawing (lib/ink/drawings). Defaults to the tool's own
   * drawing, which its route layout provides (components/ink/tool-art.tsx); a
   * page outside a tool's route (the comic, the book, VIP) passes its own.
   * `null` leaves the header without one.
   */
  art?: InkDrawing | null;
  children: React.ReactNode;
}

/**
 * Universal wrapper for every tool page.
 *
 * Mobile-first layout decisions:
 *
 *   - Container: `.container-tool` provides fluid padding (12 → 16 → 24 →
 *     32 px) and a 1280-px max width so the hero never sits oddly
 *     centred on ultrawide monitors.
 *   - Heading: uses Tailwind's fluid clamp() scale (`text-fluid-h2`) so
 *     the title scales smoothly between mobile and desktop without
 *     dragging in three separate breakpoint utilities.
 *   - Toolbar: stacks below the title on viewports narrower than 640 px,
 *     where header crowding made undo/redo + history pills overlap the
 *     description text. From `sm:` upwards the toolbar floats to the
 *     right of the title as before.
 *   - Description: capped at `max-w-prose` (≈ 65ch) so wide monitors get
 *     readable line lengths instead of single 200-char lines.
 *   - Entrance: a CSS translate-only rise. It used to be a framer-motion
 *     fade from `opacity: 0`, which the server rendered into the HTML, so
 *     every tool page stayed invisible until the JS bundle hydrated. The
 *     rise leaves no transform behind once it ends (fill `backwards`, see
 *     tailwind.config.ts): a leftover transform made this div the
 *     containing block for every `position: fixed` element inside a tool,
 *     so on a scrolled page drag overlays drew off-screen and drops missed.
 *     Don't add a transform, filter or `will-change` to this div for the
 *     same reason.
 *   - Art: a hand-inked spot drawing (components/ink) beside the title, in a
 *     fixed box (44 → 64 → 80 px) that's in the server HTML, so nothing moves
 *     when it inks itself in. The header is its `.ink-host`: hovering it with
 *     a mouse makes the line boil.
 *   - Layering: `isolate` keeps the stacking context the leftover transform
 *     used to give this div, without making it a containing block for fixed
 *     elements. A tool's own z-indexes (the canvas's pins, selection handles
 *     and property panel sit at 9990-10000) stay inside the page, under the
 *     sticky header, Amr, and dialogs and menus portalled to <body>.
 *   - Arrival from a card (lib/motion/page-transition.ts): the header is the
 *     `data-vt-target` a tapped card's frame grows into. When that frame
 *     lands, it is the entrance, so the root leaves the rise out (decided
 *     once, on the first render; a later render never brings it back, or the
 *     page would jump after the frame landed). When no view transition
 *     carried the frame, the header grows from the card's spot instead
 *     (lib/motion/grow-from.ts), alongside the rise. The server render is
 *     unchanged.
 */
export function ToolPageWrapper({
  title,
  description,
  toolId,
  showInsights = true,
  showHistory = true,
  art,
  children,
}: ToolPageWrapperProps) {
  const showToolbar = showHistory && Boolean(toolId);
  const toolArt = useToolArt();
  const drawing = art === undefined ? toolArt : (art ?? undefined);
  const headerRef = useRef<HTMLElement>(null);
  const [frameLanded] = useState(isFrameLanding);

  useIsomorphicLayoutEffect(() => {
    let live = true;
    // Next puts the new page's scroll in place later in this same commit (its
    // scroll handler wraps the page, so it runs after this effect). A
    // microtask runs once the commit is done and before the first paint, and
    // never waits for a frame, which a held page change would pause.
    queueMicrotask(() => {
      const header = headerRef.current;
      if (!live || !header) return;
      const spot = takeGrowSpot();
      if (spot) growFrom(header, spot);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className={cn("container-tool isolate", !frameLanded && "motion-safe:animate-rise")}>
      {/* Header row — title + toolbar */}
      <header
        ref={headerRef}
        data-vt-target=""
        className="panel ink-host mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-start sm:gap-4 gap-3 px-4 py-4 sm:px-6 sm:py-5"
      >
        <div className="flex flex-1 min-w-0 items-start gap-3 sm:gap-4">
          {drawing && (
            <InkArt
              drawing={drawing}
              boil
              className="h-11 w-11 shrink-0 sm:h-16 sm:w-16 lg:h-20 lg:w-20"
            />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-text leading-tight text-fluid-h2 mb-1 sm:mb-2">
              {title}
            </h1>
            <p className="text-fluid-body text-sub max-w-prose">{description}</p>
          </div>
        </div>
        {toolId && (
          <div data-chrome="tool-toolbar" className="shrink-0 flex items-center gap-2 flex-wrap">
            <FavoriteButton toolId={toolId} toolName={title} />
            <PresentButton />
            {/* Where this tool's data lives, and the way to back it up. */}
            <SavedChip />
            {showToolbar && (
              <div
                className="flex items-center gap-2"
                // "group", not "toolbar": a toolbar promises arrow-key movement
                // between its controls, which this row doesn't implement.
                role="group"
                aria-label="Tool history controls"
              >
                <UndoRedoControls toolId={toolId} />
                <ToolHistoryDrawer toolId={toolId} />
              </div>
            )}
          </div>
        )}
      </header>

      {toolId && <HowItWorks toolId={toolId} />}
      {showInsights && toolId && (
        <div data-chrome="insights">
          <InsightsEngine toolId={toolId} limit={2} />
        </div>
      )}
      {children}
      {toolId && <NextStepCard toolId={toolId} />}
      {toolId && <RelatedTools toolId={toolId} />}
    </div>
  );
}
