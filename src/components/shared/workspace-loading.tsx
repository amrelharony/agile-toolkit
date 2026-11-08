import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Below desktop width the placeholder holds about a phone screen's height.
 * The server can't read this browser's saved data, so every workspace tool
 * renders this first and swaps in the real tool after hydration. A short
 * placeholder let that swap push Related tools and How this works down by up
 * to 3,000 px after the first paint (CLS up to 0.46 on phones). Holding
 * 60% of the small viewport keeps whatever sits below it off the first
 * screen, so the swap moves nothing the reader can see; the tools that
 * replace it are taller than that on a phone. Desktop is unchanged.
 */
export const WORKSPACE_LOADING_RESERVE = "max-lg:min-h-[60svh]";

/**
 * "Loading …" while this browser's saved workspace loads: one line in a card,
 * announced as a status, that reserves the tool's room on phones and tablets
 * (see WORKSPACE_LOADING_RESERVE). Server-safe, so it is in the first HTML.
 */
export function WorkspaceLoading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-center justify-center rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub",
        WORKSPACE_LOADING_RESERVE,
        className
      )}
    >
      {children}
    </p>
  );
}
