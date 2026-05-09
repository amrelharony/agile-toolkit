"use client";

import { cn } from "@/lib/utils";

interface ActionRowProps {
  /** The action cluster — typically AI prompt + Export + Reset / Add. */
  children: React.ReactNode;
  /** Optional left-side content (sometimes a dropdown filter, badge, etc.). */
  left?: React.ReactNode;
  className?: string;
}

/**
 * Standardised "tool action row" used at the top of every tool body.
 *
 * Replaces the ~30 inline copies of:
 *   <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
 *     <AiPromptGenerator config={...} />
 *     <ExportButton .../>
 *     <Button>Reset</Button>
 *   </div>
 *
 * Mobile-first behaviour:
 *   - Children are right-aligned on `sm:` (640 px+) — the original visual
 *     intent on desktop.
 *   - Stacks full-width on smaller phones (< 375 px) so each button gets a
 *     comfortable touch area instead of cramming into a 280 px row.
 *   - `flex-wrap` so 4+ children break to a second line gracefully on
 *     mid-size screens without overflowing.
 *
 * Use `left` for any leading content (filter chip, status badge) — it
 * pushes the children cluster to the right via the `justify-between`
 * default that activates when both are present.
 */
export function ActionRow({ children, left, className }: ActionRowProps) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-2",
        // Justify-between when there's left content; otherwise right-align.
        left ? "justify-between" : "justify-end",
        // On the smallest phones the wrap can leave 1 button orphaned —
        // stack everything full-width below xs to keep tap targets sane.
        "max-xs:flex-col max-xs:items-stretch max-xs:[&>*]:w-full",
        className
      )}
    >
      {left && <div className="flex items-center gap-2">{left}</div>}
      <div className="flex flex-wrap items-center gap-2 max-xs:contents">
        {children}
      </div>
    </div>
  );
}
