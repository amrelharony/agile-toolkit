"use client";

import { motion } from "framer-motion";
import { InsightsEngine } from "@/components/shared/insights-engine";
import { ToolHistoryDrawer } from "@/components/history/tool-history-drawer";
import { UndoRedoControls } from "@/components/history/undo-redo-controls";

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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="container-tool"
    >
      {/* Header row — title + toolbar */}
      <header className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-start sm:gap-4 gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-text leading-tight text-glow text-fluid-h2 mb-1 sm:mb-2">
            {title}
          </h1>
          <p className="text-fluid-body text-sub max-w-prose">
            {description}
          </p>
        </div>
        {showToolbar && (
          <div
            className="shrink-0 flex items-center gap-2 flex-wrap"
            role="toolbar"
            aria-label="Tool history controls"
          >
            <UndoRedoControls toolId={toolId!} />
            <ToolHistoryDrawer toolId={toolId!} />
          </div>
        )}
      </header>

      {showInsights && toolId && <InsightsEngine toolId={toolId} limit={2} />}
      {children}
    </motion.div>
  );
}
