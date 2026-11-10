import { TICK } from "@/lib/ink/drawings/marks";
import { cn } from "@/lib/utils";
import { InkArt } from "./ink-art";

/** A tick written by hand, for a finished moment. */
export function InkTick({ className, delay = 120 }: { className?: string; delay?: number }) {
  return <InkArt drawing={TICK} className={cn("h-5 w-5 shrink-0", className)} delay={delay} />;
}
