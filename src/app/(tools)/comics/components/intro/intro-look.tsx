import { cn } from "@/lib/utils";
import look from "./intro-look.module.css";

/**
 * The look a drawn book wears in the comic intros (DNA-SPEC lines 11 and 13):
 * paper grain, flat comic light, the stepped shade of a turning face, page
 * edges and a ground shadow, plus the cover's lettering. Static parts: a scene
 * moves one by passing its own animation class, so the scene's timing tests
 * read it. Not a client component, so the server page renders them into the
 * intro's static HTML.
 *
 * Each part is decorative (aria-hidden) and carries data-look, which is how
 * high contrast takes them all away (globals.css BOOK LOOK). Put them inside a
 * face, never on an element that keeps the 3D space open, which they would
 * flatten. A part fills the positioned face it sits in; later content paints
 * over it unless the scene lifts it above.
 */

/** Paper grain on a face: still, faint, through the page paper's own speck tile. */
export function Grain({ className }: { className?: string }) {
  return <span aria-hidden="true" data-look="grain" className={cn(look.grain, className)} />;
}

/**
 * Flat comic light across a face: a shade with one clear slanted stripe (in
 * Night, a faint lightening). `trackClassName` moves or places the stripe;
 * without it, the stripe rests in the middle of the face.
 */
export function Light({
  className,
  trackClassName,
}: {
  className?: string;
  trackClassName?: string;
}) {
  return (
    <span aria-hidden="true" data-look="light" className={cn(look.light, className)}>
      <span className={cn(look.track, trackClassName)}>
        <span className={look.slant}>
          <span className={look.lightShade} />
          <span className={look.lightStripe} />
          <span className={look.lightShade} />
        </span>
      </span>
    </span>
  );
}

/** The shade of a face turning away from the light. Clear until its scene steps it up. */
export function TurnShade({ className }: { className?: string }) {
  return <span aria-hidden="true" data-look="turn" className={cn(look.turn, className)} />;
}

/**
 * Four fine lines along a page block's right and bottom edges, in the hard
 * offset its scene gives as --look-edge-x and --look-edge-y.
 */
export function PageEdges({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" data-look="edges" className={cn(look.edges, className)}>
      <span className={look.edge} />
      <span className={look.edge} />
      <span className={look.edge} />
      <span className={look.edge} />
    </span>
  );
}

/** A flat, hard-edged shadow under a box the size of the book. */
export function Ground({ className }: { className?: string }) {
  return <span aria-hidden="true" data-look="ground" className={cn(look.ground, className)} />;
}

/**
 * The cover's own words, sized from --book-w: the hinge, "Agile at Work", the
 * title rule and, unless left out, the byline. What a cover shows until its art
 * arrives, so it stays in high contrast (it carries no data-look).
 */
export function CoverLettering({ byline = true }: { byline?: boolean }) {
  return (
    <div className={look.lettering}>
      <span aria-hidden="true" className={look.hinge} />
      <p className={cn(look.title, "font-display font-bold text-text")}>
        <span className={look.line}>Agile</span> <span className={look.line}>at Work</span>
      </p>
      <span aria-hidden="true" className={look.titleRule} />
      {byline ? (
        <p className={cn(look.byline, "font-display font-medium text-text")}>
          <span className={look.line}>Workplace comics</span>{" "}
          <span className={look.line}>by Amr Elharony</span>
        </p>
      ) : null}
    </div>
  );
}
