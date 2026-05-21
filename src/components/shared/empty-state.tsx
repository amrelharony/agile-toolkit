"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /**
   * Optional Lucide icon rendered above the message at 40 × 40 px,
   * centred, 40 % opacity. Matches the pattern used across the toolkit.
   */
  icon?: LucideIcon;
  /**
   * Primary message — usually a single sentence ending with a CTA hint
   * (e.g. "No ADRs yet. Click 'New ADR' to record your first decision.").
   * Accepts ReactNode so call sites can use `<>` for inline emphasis.
   */
  children: React.ReactNode;
  /**
   * Padding inside the card. `lg` (default) = `p-8`, matches the most
   * common variant. `xl` = `p-12` for the bigger empty pages.
   */
  padding?: "md" | "lg" | "xl";
  /** Pass-through to the outer Card (e.g. `flex-1` for grid stretching). */
  className?: string;
  /**
   * Optional inline action — typically a `<Button>` rendered below the
   * message. Used when the empty state has a single primary call-to-action.
   */
  action?: React.ReactNode;
}

const PADDING: Record<NonNullable<EmptyStateProps["padding"]>, string> = {
  md: "p-6",
  lg: "p-8",
  xl: "p-12",
};

/**
 * Standardised "nothing here yet" placeholder used in 10+ tools.
 *
 * Replaces the recurring pattern:
 *
 *   <Card className="bg-surface border-border">
 *     <CardContent className="p-8 text-center text-sub">
 *       <Icon className="w-10 h-10 mx-auto mb-3 opacity-40" />
 *       Friendly message + CTA hint.
 *     </CardContent>
 *   </Card>
 *
 * Why a primitive: nine tools used the exact same JSX with only the icon
 * + message text varying. Centralising means a future visual tweak
 * (padding, icon size, opacity, optional action button) lands in one
 * file instead of nine.
 *
 * Mobile-first: padding stays the same — phones already render this card
 * full-width inside `.container-tool`'s 12 px gutter, and the centred
 * icon + short message read fine on narrow viewports without per-screen
 * tweaking.
 */
export function EmptyState({
  icon: Icon,
  children,
  padding = "lg",
  className,
  action,
}: EmptyStateProps) {
  return (
    <Card className={cn("bg-surface border-border", className)}>
      <CardContent className={cn("text-center text-sub", PADDING[padding])}>
        {Icon && (
          <Icon
            className="w-10 h-10 mx-auto mb-3 opacity-40"
            aria-hidden="true"
          />
        )}
        {/* Announce the empty state to screen readers when this card replaces
            a previously populated one (e.g. user filters down to zero rows).
            Without role="status" the SR-only transition is silent. */}
        <div role="status">{children}</div>
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </CardContent>
    </Card>
  );
}
