import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { SHEET } from "@/components/agent/mascot/engine/sprite-poses";
import { cn } from "@/lib/utils";

/** Half the sheet's cell, so he stays sharp on a phone screen. */
const SCALE = 0.5;

/**
 * Amr standing still: the first frame of his sprite sheet, the only character
 * art on these pages. Decorative, so whatever sits beside it names him.
 */
export function AmrPortrait({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("shrink-0 bg-no-repeat", className)}
      style={{
        width: SHEET.cellW * SCALE,
        height: SHEET.cellH * SCALE,
        backgroundImage: `url(${MASCOT_SPRITE_URL})`,
        backgroundSize: `${SHEET.columns * SHEET.cellW * SCALE}px ${SHEET.rows * SHEET.cellH * SCALE}px`,
        backgroundPosition: "0 0",
      }}
    />
  );
}
