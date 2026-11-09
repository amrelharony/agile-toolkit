import type { CSSProperties, ReactNode } from "react";
import { HIGHLIGHT_MARKS, type HighlightMark } from "@/lib/ink/highlight-marks";
import type { InkTone } from "@/lib/ink/types";
import { cn } from "@/lib/utils";

interface InkHighlightProps {
  children: ReactNode;
  /**
   * A marker underline (any length of text), a double one (the quick return
   * stroke a marker makes) or a loose circle (a short word or number).
   */
  mark?: HighlightMark;
  tone?: InkTone;
  /** Milliseconds before the pen starts. */
  delay?: number;
  className?: string;
}

/**
 * A hand-drawn mark on a phrase, the way you'd mark up a printed page: the text
 * stays a real text node and the ink is a decorative SVG stretched over it.
 *
 * The ink is a pressure-tapered outline, drawn ahead of time by perfect-freehand
 * (lib/ink/highlight-marks.ts), revealed by a mask whose wide pen stroke draws
 * along the same path, so the line appears to be written rather than wiped. No
 * hooks: server pages can use it. The mask id comes from the mark's name; two
 * identical marks on one page share a mask of identical geometry, which is
 * harmless.
 */
export function InkHighlight({
  children,
  mark = "underline",
  tone = "accent",
  delay = 500,
  className,
}: InkHighlightProps) {
  const shape = HIGHLIGHT_MARKS[mark];
  const id = `ink-hl-${mark}`;
  return (
    <span className={cn("ink-hl", className)}>
      {children}
      <svg
        viewBox={shape.viewBox}
        preserveAspectRatio="none"
        className={cn("ink-art ink-hl-mark", mark === "circle" ? "ink-hl-circle" : "ink-hl-under")}
        aria-hidden="true"
        focusable="false"
        data-ink={`highlight-${mark}`}
      >
        <mask id={id} maskUnits="userSpaceOnUse">
          <path
            className="ink-line ink-hl-pen"
            d={shape.centre}
            pathLength={1}
            stroke="white"
            strokeWidth={shape.reveal}
            style={{ "--ink-delay": `${delay}ms` } as CSSProperties}
          />
        </mask>
        <path className={`ink-hl-ink ink-fill-${tone}`} d={shape.outline} mask={`url(#${id})`} />
      </svg>
    </span>
  );
}
