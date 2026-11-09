import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InkScribble } from "@/components/ink/ink-scribble";

/**
 * Below tablet width (phones) the placeholder holds about a phone screen's
 * height. The server can't read this browser's saved data, so every
 * workspace tool renders this first and swaps in the real tool after
 * hydration. A short placeholder let that swap push Related tools and How
 * this works down by up to 3,000 px after the first paint (CLS up to 0.46 on
 * phones). Holding 60% of the small viewport keeps whatever sits below it off
 * the first screen, so the swap moves little the reader can see.
 *
 * Phones only: on a tablet (768 px and up, landscape phones too) the first
 * screen is tall enough that the short visitor empty states (Sprint
 * Planning's, Burndown's) are far shorter than 60% of it, so the reserve
 * would pull Related tools up into view after hydration instead. Those
 * widths measured no layout shift with the one-line card, so they keep it,
 * and so does desktop.
 */
export const WORKSPACE_LOADING_RESERVE = "max-md:min-h-[60svh]";

/**
 * For tools whose hydrated page is taller than any first screen (Kanban,
 * Capacity Planner, the Sprint Cockpit and the home card): from md up the
 * placeholder also holds a full screen, so Related tools and the sections
 * below start off-screen and stay there after the swap. Measured at 768x1024
 * and 1280x800, where the one-line card let the swap shift them by 0.13-0.23.
 * Short tools must not use it: their hydrated empty state would pull the
 * content below up into view instead.
 */
export const WORKSPACE_LOADING_RESERVE_TALL = "md:min-h-[100svh]";

/**
 * "Loading …" while this browser's saved workspace loads: one line in a card
 * under a pen that writes, rests and lifts off (InkScribble), announced as a
 * status, that reserves the tool's room on phones (see
 * WORKSPACE_LOADING_RESERVE). Server-safe, so it is in the first HTML.
 */
export function WorkspaceLoading({
  children,
  className,
  tall = false,
}: {
  children: ReactNode;
  className?: string;
  /** Also reserve a full screen from md up (see WORKSPACE_LOADING_RESERVE_TALL). */
  tall?: boolean;
}) {
  return (
    <p
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub",
        WORKSPACE_LOADING_RESERVE,
        tall && WORKSPACE_LOADING_RESERVE_TALL,
        className
      )}
    >
      <InkScribble />
      <span>{children}</span>
    </p>
  );
}
