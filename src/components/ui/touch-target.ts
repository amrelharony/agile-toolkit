/**
 * Touch sizes for text links (WCAG 2.5.8, and 2.5.5's 44 px where a page can
 * afford it).
 *
 * A link inside a running sentence keeps the inline exception and gets no
 * padding. A standalone link (a link list, a footer, a link-only row, a
 * "Sign in" or "Back" text link) gets a 44 px target on touch screens. Every
 * class here is behind `pointer-coarse:`, so mouse and trackpad layouts stay
 * exactly as they were, at any width (a landscape phone or a tablet is wide
 * but still touch).
 */

/**
 * A standalone text link: 44 px tall on touch screens, still in line with
 * whatever sits beside it. Pairs with an existing `inline-flex items-center`
 * (the extra classes are then harmless) or with a bare inline link.
 */
export const TOUCH_LINK =
  "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center";

/**
 * A link that names a list row (a tool name over its one-line description):
 * on touch screens its tap area stretches over the whole row, so a thumb on
 * the description opens it too, and the rows keep their reading layout. The
 * row needs TOUCH_ROW (it positions the stretch and sets the 44 px floor).
 */
export const TOUCH_ROW_LINK =
  "pointer-coarse:after:absolute pointer-coarse:after:inset-0 pointer-coarse:after:content-['']";

/** The list row a TOUCH_ROW_LINK stretches over: at least 44 px tall on touch. */
export const TOUCH_ROW = "pointer-coarse:relative pointer-coarse:min-h-11";
