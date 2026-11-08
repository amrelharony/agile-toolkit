"use client";

import { InsightsEngine } from "@/components/shared/insights-engine";
import { ToolHistoryDrawer } from "@/components/history/tool-history-drawer";
import { UndoRedoControls } from "@/components/history/undo-redo-controls";
import { SavedChip } from "@/components/data/saved-chip";
import { HowItWorks } from "@/components/tool-frame/how-it-works";
import { RelatedTools } from "@/components/tool-frame/related-tools";
import { NextStepCard } from "@/components/tool-frame/next-step";
import { PresentButton } from "@/components/presentation/presentation-mode";
import { FavoriteButton } from "@/components/tool-frame/favorite-button";

interface ToolPageWrapperProps {
  title: string;
  description: string;
  category?: string;
  toolId?: string;
  showInsights?: boolean;
  /** Hide the per-tool history drawer (defaults to on when toolId is set). */
  showHistory?: boolean;
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
 *   - Layering: `isolate` keeps the stacking context the leftover transform
 *     used to give this div, without making it a containing block for fixed
 *     elements. A tool's own z-indexes (the canvas's pins, selection handles
 *     and property panel sit at 9990-10000) stay inside the page, under the
 *     sticky header, Amr, and dialogs and menus portalled to <body>.
 */
export function ToolPageWrapper({
  title,
  description,
  toolId,
  showInsights = true,
  showHistory = true,
  children,
}: ToolPageWrapperProps) {
  const showToolbar = showHistory && Boolean(toolId);

  return (
    <div className="container-tool isolate motion-safe:animate-rise">
      {/* Header row — title + toolbar */}
      <header className="panel mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-start sm:gap-4 gap-3 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-text leading-tight text-fluid-h2 mb-1 sm:mb-2">
            {title}
          </h1>
          <p className="text-fluid-body text-sub max-w-prose">{description}</p>
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
