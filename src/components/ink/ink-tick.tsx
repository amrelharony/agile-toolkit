import { TICK } from "@/lib/ink/drawings/marks";
import { cn } from "@/lib/utils";
import { InkArt } from "./ink-art";

/**
 * A tick written by hand, for a finished moment. `still` draws it finished,
 * with no ink-in: for a tick that is being shown again (a remount, a loaded
 * chat) rather than for the moment itself.
 */
export function InkTick({
  className,
  delay = 120,
  still = false,
}: {
  className?: string;
  delay?: number;
  still?: boolean;
}) {
  return (
    <InkArt
      drawing={TICK}
      className={cn("h-5 w-5 shrink-0", className)}
      delay={delay}
      still={still}
    />
  );
}
