/**
 * Where Amr stands, and how the things beside him point back at him.
 *
 * The sizes and gaps that place his button and his chat panel (mascot-assistant
 * reads them back), plus small pure helpers for the comic tails: which side of
 * the screen he's on, which edge of the panel faces him and how far along it his
 * centre line runs, which way his outside bubble's tail points, and where the
 * panel's entrance grows from. And his corners as Move Amr offers them: in
 * words, and where an arrow key sends him. And the panel's layouts on short and
 * narrow screens (float, phone sheet, side), the visible box they fit in, and
 * where Amr docks in the sheet.
 *
 * Pure numbers and strings, no React and no DOM. It imports only
 * engine/figure-metrics.ts (which has no imports), so code in the static shell
 * (his bubble, the moment chip) can use it without pulling in the sprite engine.
 *
 * Every helper takes the corner he is drawn in (`placed`: his chosen corner, or
 * the other side when he has stepped aside for a control), so a flip moves the
 * tails with him.
 */

import { FIGURE_BOTTOM, FIGURE_TOP, SHEET } from "./engine/figure-metrics";

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
/** Size of Amr's box inside that button: one sheet cell at an exact 12:13. */
export const MASCOT_BOX: Readonly<{ w: number; h: number }> = { w: 132, h: 143 };
/** Phones get a smaller figure, with space kept for him (phoneBandHeight). */
export const MASCOT_BOX_PHONE: Readonly<{ w: number; h: number }> = { w: 96, h: 104 };
/**
 * The "Ask Amr" launcher plate (globals.css `.comic-name-plate[data-launcher]`),
 * which stands in his spot until his figure is in, and while it can't load: its
 * box in px, which his button sets as its minimum size. 44 px is the plate's
 * floor (2.75rem); the width holds the lettered "Ask Amr" with the plate's
 * padding and line. Larger text grows the plate past these, never clips it.
 */
export const LAUNCHER_PLATE: Readonly<{ w: number; h: number }> = { w: 108, h: 44 };
/**
 * How much of the empty box (in sheet px) may sit past the screen edge: all the
 * space below his feet when parked at the bottom, most of the headroom when
 * parked at the top. A margin is left there because he jumps into it.
 */
export const FEET_TRIM = SHEET.cellH - FIGURE_BOTTOM;
export const HEAD_TRIM = 16;
/**
 * The part of the box that takes clicks: the figure, not the transparent space
 * around it. Fractions of the box width are left clear on each side.
 */
export const HIT_SIDE = 0.28;
/** Breathing room between the mascot's silhouette and the panel. */
export const PANEL_GAP = 6;
/** Offset of the chat panel from his side of the screen (past any safe area). */
export const PANEL_SIDE = 16;
/** On a short screen the panel gets shorter, down to this: its title row, a few lines, the input. */
export const PANEL_MIN_H = 160;
/** Room kept between the panel and the header, or the screen's far edge. */
export const PANEL_MARGIN = 8;

/** The panel's two sizes: its usual card, and the larger one Enlarge gives on md and up. */
export type PanelSizeName = "normal" | "large";

/**
 * The chat panel's width and height, as CSS lengths. The one place they live:
 * the panel's style sets them, and panelPos fits that height between Amr and
 * the header (it gets shorter, down to PANEL_MIN_H, when there isn't room).
 * Enlarge switches to `large`, only on screens md and wider.
 */
export const PANEL_SIZE: Readonly<
  Record<PanelSizeName, Readonly<{ width: string; height: string }>>
> = {
  normal: { width: "min(92vw, 380px)", height: "min(68vh, 560px)" },
  large: { width: "min(92vw, 640px)", height: "min(85vh, 760px)" },
};

/** The side of the screen he stands on in this corner. */
export function amrSide(c: AmrCorner): AmrSide {
  return c.endsWith("Left") ? "left" : "right";
}

/** The screen edge he stands against in this corner. */
export function amrEdge(c: AmrCorner): AmrEdge {
  return c.startsWith("top") ? "top" : "bottom";
}

/**
 * The corner a side and an edge name: where the mascot store's `placed` says
 * he is drawn, as the helpers here take it.
 */
export function cornerAt(p: Readonly<{ side: AmrSide; edge: AmrEdge }>): AmrCorner {
  return `${p.edge}${p.side === "left" ? "Left" : "Right"}`;
}

/** The same edge, the other side of the screen (where he steps aside to). */
export function otherSide(c: AmrCorner): AmrCorner {
  return `${amrEdge(c)}${amrSide(c) === "left" ? "Right" : "Left"}` as AmrCorner;
}

/** His four corners in reading order, as Move Amr lists them. */
export const AMR_CORNERS: readonly AmrCorner[] = [
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
];

/** A corner in words, as Move Amr names it and the announcement says it: "Top left". */
export function cornerName(c: AmrCorner): string {
  return `${amrEdge(c) === "top" ? "Top" : "Bottom"} ${amrSide(c)}`;
}

/**
 * Where an arrow key sends him from `c` (his button has focus): up or down
 * picks the edge and keeps his side, left or right picks the side and keeps
 * his edge. `c` itself when he is already there; null for any other key.
 */
export function cornerAfterKey(c: AmrCorner, key: string): AmrCorner | null {
  const side = amrSide(c) === "left" ? "Left" : "Right";
  const edge = amrEdge(c);
  switch (key) {
    case "ArrowUp":
      return `top${side}`;
    case "ArrowDown":
      return `bottom${side}`;
    case "ArrowLeft":
      return `${edge}Left`;
    case "ArrowRight":
      return `${edge}Right`;
    default:
      return null;
  }
}

/**
 * How far his centre line runs in from the panel's edge on his side, in px.
 * Both are offset from the same side of the screen (BUTTON_SIDE, PANEL_SIDE, and
 * the same safe area), so this holds on any screen: 58 for the desktop figure,
 * 40 for a phone's, 46 for the launcher plate.
 */
export function amrCentreInPanel(phone: boolean, figure: boolean): number {
  const width = figure ? (phone ? MASCOT_BOX_PHONE : MASCOT_BOX).w : LAUNCHER_PLATE.w;
  return BUTTON_SIDE + width / 2 - PANEL_SIDE;
}

/** What the panel's tail needs to know about him. */
export interface PanelTailState {
  /** A phone's figure (MASCOT_BOX_PHONE) rather than the desktop one. */
  phone: boolean;
  /** His figure is drawn. False while the launcher shows: there's no Amr to point at. */
  figure: boolean;
  /** He's being carried. The panel stays at his corner, so a tail would point at nothing. */
  dragging: boolean;
}

/** The panel's tail, as the panel's data-tail, data-tail-from and --tail-at want it. */
export interface PanelTail {
  /** The panel's edge facing him: down for a bottom corner (the panel sits above him), up for a top one. */
  tail: "up" | "down";
  /** The end of that edge `at` counts from: his side. */
  from: AmrSide;
  /**
   * px from the panel's edge on his side to his centre line, where the tip points.
   * The tail's CSS --tail-at counts to the near side of its triangle, so the
   * panel sets it half the tail's width short of this.
   */
  at: number;
}

/**
 * The panel's tail toward Amr, or null when it is hidden: while the launcher
 * shows instead of his figure, and while he's being carried.
 */
export function panelTail(c: AmrCorner, s: PanelTailState): PanelTail | null {
  if (!s.figure || s.dragging) return null;
  return {
    tail: amrEdge(c) === "top" ? "up" : "down",
    from: amrSide(c),
    at: amrCentreInPanel(s.phone, true),
  };
}

/** His outside bubble's tail, as its data-tail and data-tail-from want it. */
export interface BubbleTail {
  tail: "left" | "right" | "up" | "down";
  /** The end the CSS's --tail-at counts from (its default 1rem stays). */
  from: "top" | "bottom" | "left" | "right";
}

/**
 * Which way his outside bubble's tail points. The bubble stands where the
 * moment chip does (momentChipPosition):
 * - Larger screens: level with him, on the inside of his corner, so the tail is
 *   on the edge facing him (right when he's on the right) and counted from his
 *   screen edge (the top for a top corner).
 * - Phones: just past his band, so the tail points at him (down for a bottom
 *   corner, up for a top one) from the end on his side.
 */
export function bubbleTail(c: AmrCorner, phone: boolean): BubbleTail {
  const side = amrSide(c);
  const edge = amrEdge(c);
  if (phone) return { tail: edge === "top" ? "up" : "down", from: side };
  return { tail: side, from: edge };
}

/**
 * Where the panel's entrance grows from (its transform-origin): the point on
 * the edge facing him, in line with his centre. That is where the tail meets
 * the panel when it shows; with the launcher, it is in line with the launcher.
 */
export function panelOrigin(c: AmrCorner, s: Pick<PanelTailState, "phone" | "figure">): string {
  const at = amrCentreInPanel(s.phone, s.figure);
  const x = amrSide(c) === "right" ? `calc(100% - ${at}px)` : `${at}px`;
  return `${x} ${amrEdge(c) === "top" ? "0%" : "100%"}`;
}

// ---------------------------------------------------------------------------
// Phone layouts: the sheet, the side panel, the visible box, Amr's dock.
// ---------------------------------------------------------------------------

/**
 * How the panel is laid out on this screen, height first:
 * - `side`: a short screen (a landscape phone, or a desktop zoomed far in). The
 *   panel runs from top to bottom beside Amr, who stays in his corner.
 * - `sheet`: a phone held upright. The panel fills the visible box, and Amr
 *   docks in its bottom corner.
 * - `float`: everything else. The card above or below him (panelPos).
 */
export type AmrLayout = "float" | "sheet" | "side";

/** A screen this short or shorter, px, gets the side layout, whatever its width. */
export const SIDE_LAYOUT_MAX_H = 500;
/** A screen this narrow or narrower, px, gets the sheet: phone width (breakpoints.ts PHONE_MAX_PX). */
export const SHEET_LAYOUT_MAX_W = 639;

/**
 * The layout for a screen of this size, px. Pass its size without a keyboard
 * (the layout viewport), so a keyboard coming up never changes the layout.
 */
export function panelLayout(viewport: Readonly<{ width: number; height: number }>): AmrLayout {
  if (viewport.height <= SIDE_LAYOUT_MAX_H) return "side";
  if (viewport.width <= SHEET_LAYOUT_MAX_W) return "sheet";
  return "float";
}

/**
 * The visible area's top and bottom edges, px, as use-visible-area's
 * readVisibleArea gives them: `top` from the screen's top (under the header),
 * `bottom` from its bottom (above the keyboard or the home indicator), each
 * with its gap. Spelled out here so this file stays free of imports.
 */
export interface VisibleInsets {
  top: number;
  bottom: number;
}

/** The screen's side safe areas, px: a landscape phone's notch or camera cutout. */
export interface SideSafeArea {
  left: number;
  right: number;
}

/**
 * The box the panel and the docked Amr fit in: each edge's distance from the
 * screen's edge, px (the way a fixed box's top, right, bottom and left read),
 * and its size.
 */
export interface VisibleBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The visible box on a screen of this size (the layout viewport, px): from the
 * visible area's top to its bottom, and BUTTON_SIDE in from each side past the
 * side safe areas, in line with Amr's button, so the sheet's edge and his side
 * offset agree.
 */
export function visibleBox(
  viewport: Readonly<{ width: number; height: number }>,
  insets: Readonly<VisibleInsets>,
  sides: Readonly<SideSafeArea> = { left: 0, right: 0 }
): VisibleBox {
  const left = BUTTON_SIDE + Math.max(0, sides.left);
  const right = BUTTON_SIDE + Math.max(0, sides.right);
  return {
    top: insets.top,
    right,
    bottom: insets.bottom,
    left,
    width: Math.max(0, viewport.width - left - right),
    height: Math.max(0, viewport.height - insets.top - insets.bottom),
  };
}

/** Under this visible height, px, the panel goes compact even with no keyboard up. */
export const COMPACT_BELOW_H = 360;

/**
 * Compact mode: the keyboard is up, or the visible box is short. The panel then
 * starts from the top of what can be seen, over the site header, and its header
 * shrinks to one row.
 */
export function isCompact(keyboardUp: boolean, box: Readonly<Pick<VisibleBox, "height">>): boolean {
  return keyboardUp || box.height < COMPACT_BELOW_H;
}

/** In compact mode the panel starts this far below the top of what can be seen, px. */
export const COMPACT_TOP = 4;

/**
 * Where the panel's top goes: compact (isCompact), and the top of what can be
 * seen (use-visible-area's `viewTop`: iOS pans it down to a focused field).
 */
export interface PanelTop {
  compact: boolean;
  viewTop: number;
}

function panelTopPx(box: Readonly<VisibleBox>, top: Readonly<PanelTop>): number {
  return top.compact ? top.viewTop + COMPACT_TOP : box.top;
}

/** A fixed box's offsets from the screen's edges, px, as a style object takes them. */
export interface SheetPos {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The phone sheet: the visible box, under the header and above the keyboard or
 * home indicator. Compact, it starts COMPACT_TOP below the top of what can be
 * seen instead, over the site header.
 */
export function sheetPos(box: Readonly<VisibleBox>, top: Readonly<PanelTop>): SheetPos {
  return { top: panelTopPx(box, top), right: box.right, bottom: box.bottom, left: box.left };
}

/** The most a side-layout panel spans across the screen, px. */
export const SIDE_PANEL_MAX_W = 420;

/** The side-layout panel: anchored top and bottom, on his side, with its width. */
export interface SidePos {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  width: number;
}

/**
 * The side layout's panel: from the visible box's top (or, compact, from the
 * top of what can be seen) to its bottom, beside Amr in his corner, PANEL_GAP
 * clear of his figure (or of the launcher plate when that stands in for him),
 * and as wide as the room past him allows, up to SIDE_PANEL_MAX_W. He stays in
 * his corner at his usual size: `phone` picks MASCOT_BOX_PHONE, as panelTail
 * and panelOrigin do.
 */
export function sidePos(
  c: AmrCorner,
  box: Readonly<VisibleBox>,
  amr: Readonly<Pick<PanelTailState, "phone" | "figure">>,
  top: Readonly<PanelTop>
): SidePos {
  const side = amrSide(c);
  const w = (amr.phone ? MASCOT_BOX_PHONE : MASCOT_BOX).w;
  // From his side of the box (where his button stands) to his figure's inner edge.
  const reach = amr.figure ? w * (1 - HIT_SIDE) : LAUNCHER_PLATE.w;
  const offset = box[side] + reach + PANEL_GAP;
  const width = Math.max(0, Math.min(SIDE_PANEL_MAX_W, box.width - reach - PANEL_GAP));
  const vertical = { top: panelTopPx(box, top), bottom: box.bottom, width };
  return side === "left" ? { ...vertical, left: offset } : { ...vertical, right: offset };
}

/**
 * How far inside the sheet's edges the docked Amr stands, px: his feet above its
 * bottom edge, his figure in from its side edge.
 */
export const DOCK_INSET = BUTTON_INSET;
/** Room kept between the docked Amr's figure and the views beside him, px. */
export const DOCK_GAP = 8;

/** The docked button's place: fixed, offset from the screen's bottom and his side. */
export interface DockedButtonPos {
  position: "fixed";
  bottom: number;
  left?: number;
  right?: number;
}

/**
 * Amr docked in the sheet: in its bottom corner on his side (a top corner docks
 * at the bottom too, so he never covers Close; his chosen corner returns when
 * the sheet closes), at MASCOT_BOX_PHONE, never scaled. His feet stand
 * DOCK_INSET above the box's bottom edge, and his figure (the hit span, not the
 * box's clear sides, which may run past the screen's edge) DOCK_INSET in from
 * its side edge.
 *
 * `box` is the visible box while he rides the keyboard (the composer has
 * focus). Otherwise pass its `bottom` at use-visible-area's `restBottom`, where
 * the box's bottom is with no keyboard: he stays put.
 */
export function dockedButtonPos(
  c: AmrCorner,
  box: Readonly<Pick<VisibleBox, "left" | "right" | "bottom">>
): DockedButtonPos {
  const scale = MASCOT_BOX_PHONE.h / SHEET.cellH;
  const bottom = box.bottom + DOCK_INSET - FEET_TRIM * scale;
  const side = amrSide(c);
  const offset = box[side] + DOCK_INSET - MASCOT_BOX_PHONE.w * HIT_SIDE;
  return side === "left"
    ? { position: "fixed", bottom, left: offset }
    : { position: "fixed", bottom, right: offset };
}

/** What the sheet's views keep clear for the docked Amr. */
export interface DockInsets {
  /** The side he docks on: the gutter goes on this side. */
  side: AmrSide;
  /**
   * px to keep clear on that side, from the sheet's outer edge: his figure (its
   * hit span, DOCK_INSET in from the edge) plus DOCK_GAP. The views' own
   * padding and the panel's line only add to the room.
   */
  gutter: number;
  /**
   * The least height of the views' footer (the composer's row), px from the
   * sheet's bottom edge: his feet's inset plus his figure's height, so he stands
   * beside the composer, never over the log.
   */
  footer: number;
}

/** The gutter and footer the sheet's views keep for Amr docked on `c`'s side. */
export function dockInsets(c: AmrCorner): DockInsets {
  const scale = MASCOT_BOX_PHONE.h / SHEET.cellH;
  const hitWidth = MASCOT_BOX_PHONE.w * (1 - 2 * HIT_SIDE);
  const figureHeight = (FIGURE_BOTTOM - FIGURE_TOP) * scale;
  return {
    side: amrSide(c),
    gutter: Math.ceil(DOCK_INSET + hitWidth + DOCK_GAP),
    footer: Math.ceil(DOCK_INSET + figureHeight),
  };
}
