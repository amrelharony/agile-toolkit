import { SCRIBBLE } from "@/lib/ink/drawings/marks";
import { cn } from "@/lib/utils";
import { InkArt } from "./ink-art";

/**
 * A pen writing, resting and lifting off, over and over: the ink version of a
 * spinner for loading placeholders. Reduced motion shows it written, still.
 */
export function InkScribble({ className }: { className?: string }) {
  return (
    <InkArt drawing={SCRIBBLE} className={cn("ink-scribble h-4 w-16", className)} pace={500} />
  );
}
