/**
 * Amr's corners, and where his button stands in one: the little of his
 * geometry the static shell needs. The moment chip finds his corner
 * (cornerAt), and AmrBoundary's stand-in plate takes his button's place.
 *
 * No imports, on purpose. webpack keeps every export a chunk uses in the
 * module that holds it, so while the shell imported these from amr-geometry,
 * every page's first paint carried all of amr-geometry (his panel, sheet and
 * dock maths) and engine/figure-metrics with it. amr-geometry re-exports
 * everything here, so the rest of Amr's code reads them from there.
 */

/**
 * The corner Amr is parked in. The same union as MascotCorner in the mascot
 * store, spelled out here so this file stays free of imports.
 */
export type AmrCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
/** The side of the screen he stands on. */
export type AmrSide = "left" | "right";
/** The screen edge he stands against. */
export type AmrEdge = "top" | "bottom";

/** Inset of the float button from its corner's edge. */
export const BUTTON_INSET = 4;
/** Offset of the float button from its side of the screen (past any safe area). */
export const BUTTON_SIDE = 8;
/**
 * The "Ask Amr" launcher plate (globals.css `.comic-name-plate[data-launcher]`),
 * which stands in his spot until his figure is in, and while it can't load: its
 * box in px, which his button sets as its minimum size. 44 px is the plate's
 * floor (2.75rem); the width holds the lettered "Ask Amr" with the plate's
 * padding and line. Larger text grows the plate past these, never clips it, so
 * they are floors: the room the sheet's dock and the side panel keep for it
 * follows the drawn plate (amr-geometry's launcherPlateCss, sidePos's `plateW`).
 */
export const LAUNCHER_PLATE: Readonly<{ w: number; h: number }> = { w: 108, h: 44 };

/**
 * The corner a side and an edge name: where the mascot store's `placed` says
 * he is drawn, as amr-geometry's helpers take it.
 */
export function cornerAt(p: Readonly<{ side: AmrSide; edge: AmrEdge }>): AmrCorner {
  return `${p.edge}${p.side === "left" ? "Left" : "Right"}`;
}
