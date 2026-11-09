import type { LucideIcon } from "lucide-react";
import { AmrStill } from "@/components/shared/amr-still";
import { InkArt } from "@/components/ink/ink-art";
import { PUDDLE } from "@/lib/ink/drawings/marks";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /**
   * Optional Lucide icon, small, above the message inside the balloon.
   */
  icon?: LucideIcon;
  /**
   * Primary message — usually a single sentence ending with a CTA hint
   * (e.g. "No ADRs yet. Click 'New ADR' to record your first decision.").
   * Accepts ReactNode so call sites can use `<>` for inline emphasis.
   */
  children: React.ReactNode;
  /**
   * Padding inside the balloon. `lg` (default) suits most screens, `xl` the
   * bigger empty pages.
   */
  padding?: "md" | "lg" | "xl";
  /** Pass-through to the outer row (e.g. `flex-1` for grid stretching). */
  className?: string;
  /**
   * Optional inline action — typically a `<Button>` rendered below the
   * message. Used when the empty state has a single primary call-to-action.
   */
  action?: React.ReactNode;
}

const PADDING: Record<NonNullable<EmptyStateProps["padding"]>, string> = {
  // Mobile-first: tighter on phones, where the padding would eat a third of the
  // viewport beside Amr.
  md: "p-3 sm:p-4",
  lg: "p-4 sm:p-6",
  xl: "p-6 sm:p-10",
};

/**
 * "Nothing here yet", said by Amr: his still frame beside a speech balloon that
 * holds the tool's own message. Used by nearly 100 screens, so the words stay
 * the call site's. On a narrow column the balloon wraps under him.
 *
 * Not a client component, on purpose: server pages pass it an icon, and a
 * function can't cross into a client component. A page that does that only fails
 * on a live request, because the build never renders a dynamic page.
 */
export function EmptyState({
  icon: Icon,
  children,
  padding = "lg",
  className,
  action,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-wrap items-end gap-x-4 gap-y-2", className)}>
      {/* Amr stands on a little watercolour wash, so he's on the page, not floating. */}
      <span className="relative block shrink-0">
        <InkArt
          drawing={PUDDLE}
          className="absolute -bottom-1.5 left-1/2 h-4 w-24 -translate-x-1/2"
        />
        <AmrStill />
      </span>
      <div
        className={cn("balloon min-w-0 grow basis-48 text-center font-display", PADDING[padding])}
      >
        {Icon && <Icon className="mx-auto mb-2 h-5 w-5 text-sub" aria-hidden="true" />}
        {/* Announce the empty state to screen readers when this card replaces
            a previously populated one (e.g. user filters down to zero rows).
            Without role="status" the SR-only transition is silent. */}
        <div role="status">{children}</div>
        {action && <div className="mt-4 flex justify-center font-sans">{action}</div>}
      </div>
    </div>
  );
}
