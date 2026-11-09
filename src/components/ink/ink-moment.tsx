import { DONE_STAMP, FLOURISH, HEART, STAR } from "@/lib/ink/drawings/marks";
import { cn } from "@/lib/utils";
import { InkArt } from "./ink-art";

/** Each mark at its usual size: a fixed box, so inking in moves nothing. */
const MOMENT_MARKS = {
  stamp: { drawing: DONE_STAMP, size: "h-7 w-12" },
  heart: { drawing: HEART, size: "h-5 w-5" },
  flourish: { drawing: FLOURISH, size: "h-3 w-20" },
  star: { drawing: STAR, size: "h-5 w-5" },
} as const;

export type MomentMark = keyof typeof MOMENT_MARKS;

/**
 * An ink moment (DNA-SPEC §9): a small mark drawn in place, once, when
 * something gets finished, beside the text that already says so. A Done
 * stamp for a closed sprint, a heart for a sent kudos, a flourish under a
 * result, a star for an objective at 100%; InkTick is the plain tick.
 *
 * It inks in when it appears and then stays still: no boil, no loop, never
 * fixed or full-screen, no sound, no XP or toast. That's why it's allowed on
 * quiet routes, where Amr holds back: a still mark in place interrupts
 * nothing. Amr stays the only celebration that moves. Decorative
 * (`aria-hidden` via InkArt); reduced motion shows it finished and high
 * contrast draws it as plain line art, both from the ink CSS.
 */
export function InkMoment({
  mark,
  className,
  delay = 120,
}: {
  mark: MomentMark;
  className?: string;
  /** Milliseconds before the pen starts, to follow another mark. */
  delay?: number;
}) {
  const { drawing, size } = MOMENT_MARKS[mark];
  return (
    <InkArt
      drawing={drawing}
      className={cn("shrink-0", size, className)}
      delay={delay}
      pace={600}
    />
  );
}
