import type { CSSProperties, ReactNode } from "react";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { POSES, SHEET, type SpritePose } from "@/components/agent/mascot/engine/sprite-poses";
import { panelImageUrl } from "@/lib/comics/images";
import type { IntroKind } from "@/lib/comics/intro";
import type { StoryCover } from "@/lib/comics/types";
import { cn } from "@/lib/utils";

/**
 * What every intro is built from: the overlay with its Skip button, Amr's frames
 * and windows onto real panels. No art is drawn here: the scenes animate the
 * story panels and Amr's sprite sheet, and letter the rest in the comic's hand.
 *
 * None of these is a client component: the server episode page renders them, and
 * the overlay is in the HTML from the start, so the head script's attribute can
 * show it before any script loads (see lib/comics/intro.ts).
 */

/**
 * The full-screen overlay. Hidden unless <html> carries this kind (globals.css),
 * so it costs nothing on a later visit.
 *
 * Render it outside ToolPageWrapper: the wrapper's entrance leaves a transform on
 * it, and a fixed overlay inside one would cover the wrapper, not the screen.
 *
 * `className` must give the overlay exactly one animation, the scene's exit: its
 * end is what ends the intro, so an entrance on the overlay itself would end it
 * early. Animate children for everything else, and don't set `display`.
 */
export function IntroOverlay({
  kind,
  label,
  className,
  children,
}: {
  kind: IntroKind;
  /** The dialog's name for screen readers. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-intro-overlay={kind}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-nosnippet=""
      className={cn("intro-overlay", className)}
    >
      {children}
      <button
        type="button"
        data-intro-skip=""
        className="intro-skip min-h-11 rounded-full border-2 border-border bg-card px-4 text-sm font-semibold text-text shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Skip intro
      </button>
    </div>
  );
}

/**
 * Amr playing one of his poses, at `width` px wide. The frames step by CSS. To
 * move him, animate a wrapper: this element's own animation is his frames.
 */
export function IntroAmr({
  pose,
  width,
  className,
  style,
}: {
  pose: SpritePose;
  width: number;
  className?: string;
  style?: CSSProperties;
}) {
  const { row, frames, fps } = POSES[pose];
  const height = Math.round((width * SHEET.cellH) / SHEET.cellW);
  return (
    <span
      aria-hidden="true"
      data-amr-pose={pose}
      className={cn("intro-amr", className)}
      style={
        {
          width,
          height,
          backgroundImage: `url(${MASCOT_SPRITE_URL})`,
          backgroundSize: `${width * SHEET.columns}px ${height * SHEET.rows}px`,
          backgroundPosition: `0 ${-row * height}px`,
          "--cell-w": `${width}px`,
          "--frames": frames,
          "--loop": `${frames / fps}s`,
          ...style,
        } as CSSProperties
      }
    />
  );
}

/**
 * A window onto one real panel, at the 768 px size every page uses, so the
 * intro and the page share one download. Lazy by default, so a hidden overlay
 * on a later visit loads nothing; `eager` is for a scene whose windows open
 * within the first second and whose page shows the same panels anyway.
 * Decorative: the page underneath carries the panel's description, and the
 * dialog hides the page only while the intro plays.
 */
export function IntroPanel({
  panel,
  className,
  style,
  loading = "lazy",
}: {
  panel: StoryCover;
  className?: string;
  style?: CSSProperties;
  loading?: "lazy" | "eager";
}) {
  return (
    <span className={cn("intro-window panel", className)} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the same plain file the page shows (see ComicPanels) */}
      <img
        src={panelImageUrl(panel.pathSmall)}
        width={panel.width}
        height={panel.height}
        alt=""
        loading={loading}
        decoding="async"
      />
    </span>
  );
}
