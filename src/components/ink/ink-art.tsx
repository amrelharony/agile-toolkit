import { Fragment, type CSSProperties } from "react";
import type { InkDrawing } from "@/lib/ink/types";
import { SPOT_PEN } from "@/lib/ink/types";
import { washEdgePath, washPath } from "@/lib/ink/wash";
import { cn } from "@/lib/utils";

interface InkArtProps {
  drawing: InkDrawing;
  className?: string;
  /**
   * Line boil (the hand-animation wobble) while the nearest `.ink-host` is
   * hovered with a mouse. Off under reduced motion and in high contrast.
   */
  boil?: boolean;
  /** Draw it finished, with no ink-in: for art that repeats down a page. */
  still?: boolean;
  /** Milliseconds before the first stroke starts. */
  delay?: number;
  /** Rough time the whole drawing takes to ink in. */
  pace?: number;
}

/** Per-element custom properties the ink keyframes read. */
function delayStyle(ms: number): CSSProperties {
  return { "--ink-delay": `${Math.round(ms)}ms` } as CSSProperties;
}

/**
 * Hand-inked spot art from a drawing in lib/ink/drawings (DNA-SPEC §9).
 *
 * Not a client component and no hooks, on purpose: server pages (EmptyState,
 * the 404) render it into their HTML, so the ink draws itself at first paint
 * with no JavaScript. Every colour is a theme token class, the SVG is
 * decorative (`aria-hidden`), and pointer events pass through it, so it never
 * gets in the way of a control or of Amr's hit test.
 */
export function InkArt({
  drawing,
  className,
  boil = false,
  still = false,
  delay = 0,
  pace = 900,
}: InkArtProps) {
  const pen = drawing.pen ?? SPOT_PEN;
  const strokes = drawing.strokes;
  const step = strokes.length > 1 ? Math.min(140, pace / (strokes.length - 1)) : 0;
  return (
    <svg
      viewBox={drawing.viewBox}
      className={cn("ink-art", boil && "ink-boil", still && "ink-still", className)}
      aria-hidden="true"
      focusable="false"
      data-ink={drawing.name}
    >
      {drawing.washes?.map((w, i) => (
        <g key={`w${i}`} className={cn("ink-wash-group", drawing.bleed && "ink-bleed")}>
          <path
            className={`ink-wash ink-fill-${w.tone}`}
            d={washPath(w)}
            style={delayStyle(delay)}
          />
          <path
            className={`ink-wash-edge ink-tone-${w.tone}`}
            d={washEdgePath(w)}
            style={delayStyle(delay)}
          />
        </g>
      ))}
      {strokes.map((s, i) => {
        const at = delay + i * step;
        return (
          <Fragment key={i}>
            {s.fill && (
              <path
                className={`ink-fill ink-fill-${s.fill}`}
                d={s.fillD ?? s.d}
                style={delayStyle(at + step)}
              />
            )}
            <path
              className={`ink-line ink-tone-${s.tone ?? "ink"}`}
              d={s.d}
              pathLength={1}
              strokeWidth={s.w ?? pen}
              style={delayStyle(at)}
            />
          </Fragment>
        );
      })}
    </svg>
  );
}
