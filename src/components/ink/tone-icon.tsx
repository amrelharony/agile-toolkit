import type { ReactNode } from "react";
import { InkArt } from "./ink-art";
import { seedFrom } from "@/lib/ink/rng";
import { TONE_VAR, type InkDrawing, type InkTone } from "@/lib/ink/types";
import { cn } from "@/lib/utils";

/** The wash under an icon: a blob of its own per key, drawn still. */
function iconWash(tone: InkTone, key: string): InkDrawing {
  return {
    name: "tile-wash",
    viewBox: "0 0 48 48",
    washes: [{ cx: 24, cy: 25, rx: 21, ry: 18, seed: seedFrom(key), tone }],
    strokes: [],
  };
}

interface ToneIconProps {
  /** The section's watercolour (lib/ink/drawings/section-tone SECTION_TONE). */
  tone: InkTone;
  /**
   * What seeds the blob, usually the tool id, so a tool's wash keeps its shape
   * wherever its icon appears.
   */
  seedKey: string;
  /** The icon itself, sized by the caller. */
  children: ReactNode;
  /** The box: its size and the icon's font size. Defaults to a 44 px tile. */
  className?: string;
}

/**
 * A tool's icon on a watercolour wash in its section's colour, in that colour
 * (DNA-SPEC §9): the tool cards on home, the job cards, "More in <section>".
 *
 * Server-safe, no hooks. The wash bleeds a little past the box (128 % of it),
 * as ToolCard's always did, without moving the layout. Decorative: the box is
 * `aria-hidden`, since the tool's name sits beside it.
 */
export function ToneIcon({ tone, seedKey, children, className }: ToneIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex h-11 w-11 shrink-0 items-center justify-center text-lg",
        className
      )}
      style={{ color: TONE_VAR[tone] }}
    >
      <InkArt
        drawing={iconWash(tone, seedKey)}
        still
        className="absolute -left-[14%] -top-[14%] h-[128%] w-[128%]"
      />
      <span className="relative flex">{children}</span>
    </span>
  );
}
