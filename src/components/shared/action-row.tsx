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
        // Stack everything full-width below sm (640 px) — the old `max-xs`
        // breakpoint (< 375 px) only saved the smallest iPhones; iPhone-12 /
        // Android-mid still landed with 3 wrapped buttons stretching across
        // the row at awkward widths. `max-sm` covers every phone-class
        // viewport so each action gets a full-width target.
        "max-sm:flex-col max-sm:items-stretch max-sm:[&>*]:w-full",
        className
      )}
    >
      {left && <div className="flex flex-wrap items-center gap-2 max-sm:contents">{left}</div>}
      <div className="flex flex-wrap items-center gap-2 max-sm:contents">{children}</div>
    </div>
  );
}
