import * as React from "react";
import { cn } from "@/lib/utils";

type EyebrowElement = "p" | "span" | "div" | "h2" | "h3" | "h4" | "dt";

export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  as?: EyebrowElement;
}

/**
 * Small label above or beside content ("Total capacity", "Last 7 days").
 *
 * Replaces the hand-rolled `font-mono text-[10px] uppercase tracking-wider`
 * pattern (279 lines, much of it at 8–10 px): 12 px sans, semibold, a little
 * letter-spacing, muted colour. Keep the text short; uppercase is fine for
 * one or two words.
 */
export function Eyebrow({ as: Tag = "p", className, ...props }: EyebrowProps) {
  return (
    <Tag
      className={cn("text-xs font-semibold uppercase tracking-wide text-sub", className)}
      {...props}
    />
  );
}
