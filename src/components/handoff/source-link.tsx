"use client";

/**
 * "From retro": a small link on an item another tool sent here, back to the
 * tool it came from. Renders nothing for an item with no known source.
 */

import Link from "@/components/motion/transition-link";
import { CornerUpLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { sourceHref, sourceLabel } from "@/lib/handoffs/registry";
import type { HandoffRef } from "@/lib/handoffs/types";

export function SourceLink({
  sourceRef,
  className,
}: {
  sourceRef: HandoffRef | undefined;
  className?: string;
}) {
  const label = sourceLabel(sourceRef);
  const href = sourceHref(sourceRef);
  if (!label || !href) return null;
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-sub underline-offset-2 hover:text-accent hover:underline",
        className
      )}
    >
      <CornerUpLeft className="h-3 w-3" aria-hidden="true" />
      {label}
    </Link>
  );
}
