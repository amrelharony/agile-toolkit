/**
 * Pure helpers for the "Agile at Work" comic reader: page/spread layout,
 * render sizing, deep links, labels and keyboard mapping. No React, no
 * pdf.js — everything here is unit-tested in test/comic/reader-math.test.ts.
 *
 * Page numbers are 1-based throughout, like the PDF and the UI.
 */

/** Coerce anything into a valid page number in 1..numPages. */
export function clampPage(page: number, numPages: number): number {
  const last = Number.isFinite(numPages) && numPages >= 1 ? Math.floor(numPages) : 1;
  if (!Number.isFinite(page)) return 1;
  return Math.min(last, Math.max(1, Math.floor(page)));
}

/**
 * The pages shown together with `page`.
 *
 * Single mode shows one page. Spread mode follows a printed book: the cover
 * (page 1) sits alone, then pairs 2–3, 4–5, … With an even page count the
 * last page has no partner and sits alone too.
 */
export function viewFor(page: number, numPages: number, spread: boolean): number[] {
  const p = clampPage(page, numPages);
  if (!spread || p === 1) return [p];
  const n = Math.max(1, Math.floor(numPages));
  if (p % 2 === 0) return p + 1 <= n ? [p, p + 1] : [p];
  return [p - 1, p];
}

/** The view after the one containing `page`; the same view at the end. */
export function nextView(page: number, numPages: number, spread: boolean): number[] {
  const view = viewFor(page, numPages, spread);
  const last = view[view.length - 1];
  if (last >= numPages) return view;
  return viewFor(last + 1, numPages, spread);
}

/** The view before the one containing `page`; the same view at the start. */
export function prevView(page: number, numPages: number, spread: boolean): number[] {
  const view = viewFor(page, numPages, spread);
  if (view[0] <= 1) return view;
  return viewFor(view[0] - 1, numPages, spread);
}

/**
 * Pages worth rendering ahead of time: the neighbouring views, next first
 * (readers mostly go forward), never the pages already on screen.
 */
export function prefetchPages(page: number, numPages: number, spread: boolean): number[] {
  const visible = new Set(viewFor(page, numPages, spread));
  const out: number[] = [];
  for (const p of [...nextView(page, numPages, spread), ...prevView(page, numPages, spread)]) {
    if (!visible.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Spreads may shrink each page by at most this much versus single mode. */
const SPREAD_MIN_HEIGHT_RATIO = 0.85;

/**
 * Auto layout: use two-page spreads only on a wide stage AND only when
 * putting two pages side by side keeps them nearly as tall as one page
 * alone (a landscape stage). `aspect` is the page's width / height.
 */
export function shouldUseSpread(
  stageW: number,
  stageH: number,
  aspect: number,
  minW = 900
): boolean {
  if (!(stageW >= minW) || !(stageH > 0) || !(aspect > 0) || !Number.isFinite(aspect)) {
    return false;
  }
  const singleH = Math.min(stageH, stageW / aspect);
  const spreadH = Math.min(stageH, stageW / 2 / aspect);
  return spreadH >= SPREAD_MIN_HEIGHT_RATIO * singleH;
}

/** Longest canvas edge we render — larger canvases fail on mobile GPUs. */
export const MAX_CANVAS_EDGE = 4096;
/** Canvas area cap (iOS Safari refuses canvases above 16,777,216 px). */
export const MAX_CANVAS_AREA = 16_777_216;
/** Above 2× the extra pixels cost memory without a visible gain. */
const MAX_DPR = 2;

interface CanvasLimits {
  maxEdge?: number;
  maxArea?: number;
}

/** The largest scale the canvas limits allow for a page of pageW × pageH. */
function scaleCap(pageW: number, pageH: number, limits: CanvasLimits = {}): number {
  const { maxEdge = MAX_CANVAS_EDGE, maxArea = MAX_CANVAS_AREA } = limits;
  return Math.min(maxEdge / Math.max(pageW, pageH), Math.sqrt(maxArea / (pageW * pageH)));
}

function validSize(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v) && v > 0);
}

/**
 * Render scale for a page (pageW × pageH at scale 1) shown inside a CSS box
 * of boxW × boxH: fit the box, multiply by the device pixel ratio (at most
 * 2) and by the pinch-zoom factor (`zoom`, see `zoomStep`), then cap the
 * canvas size. Returns 0 when any size is unusable (e.g. the stage hasn't
 * been measured yet) so callers can skip rendering.
 */
export function fitScale(
  opts: {
    pageW: number;
    pageH: number;
    boxW: number;
    boxH: number;
    dpr: number;
    /** Pinch-zoom factor; anything below 1 (or unusable) counts as 1. */
    zoom?: number;
  } & CanvasLimits
): number {
  const { pageW, pageH, boxW, boxH, dpr, zoom = 1 } = opts;
  if (!validSize(pageW, pageH, boxW, boxH)) return 0;
  const ratio = Number.isFinite(dpr) && dpr > 0 ? Math.min(Math.max(dpr, 1), MAX_DPR) : 1;
  // Zoomed in, one CSS px spans `zoom` times the screen pixels, so the
  // pixel-ratio cap above applies per screen pixel, before the zoom.
  const magnify = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
  const fit = Math.min(boxW / pageW, boxH / pageH);
  return Math.min(fit * ratio * magnify, scaleCap(pageW, pageH, opts));
}

/** visualViewport.scale above this means the page is pinch-zoomed. */
export const ZOOM_EPSILON = 1.01;
/** Zoom is rendered for in half steps, so small pinches reuse a render. */
const ZOOM_STEP = 0.5;

/**
 * The pinch-zoom factor to render pages for: 1 when not zoomed (or the
 * scale is unusable), otherwise the zoom rounded up to the next half step,
 * so a page is never undersampled at the zoom it was rendered for.
 */
export function zoomStep(scale: number): number {
  if (!Number.isFinite(scale) || scale <= ZOOM_EPSILON) return 1;
  return Math.ceil(scale / ZOOM_STEP) * ZOOM_STEP;
}

/** Width buckets are 256 px wide, so small resizes reuse earlier renders. */
export const WIDTH_BUCKET = 256;

/** Round a pixel width up to the next multiple of 256 (0 for no width). */
export function widthBucket(px: number): number {
  if (!Number.isFinite(px) || px <= 0) return 0;
  return Math.ceil(px / WIDTH_BUCKET) * WIDTH_BUCKET;
}

/**
 * Scale that renders a page `bucket` pixels wide — the top of its bucket,
 * so the image is never undersampled anywhere inside the bucket — still
 * within the canvas limits.
 */
export function scaleForBucket(bucket: number, pageW: number, pageH: number): number {
  if (!validSize(bucket, pageW, pageH)) return 0;
  return Math.min(bucket / pageW, scaleCap(pageW, pageH));
}

const PAGE_HASH_RE = /^#page=(\d+)$/;

/**
 * Read `#page=N`. Anything else (other hashes, page 0, junk) is null so a
 * stray anchor never moves the reader. With `numPages`, the page is clamped
 * to the comic's length.
 */
export function parsePageHash(hash: string, numPages?: number): number | null {
  const match = PAGE_HASH_RE.exec(hash);
  if (!match) return null;
  const page = Number(match[1]);
  if (!Number.isFinite(page) || page < 1) return null;
  return numPages === undefined ? page : clampPage(page, numPages);
}

export function pageHash(page: number): string {
  return `#page=${page}`;
}

/** "Page 1 of 24" or "Pages 2–3 of 24". */
export function pageLabel(view: readonly number[], numPages: number): string {
  if (view.length >= 2) return `Pages ${view[0]}–${view[view.length - 1]} of ${numPages}`;
  return `Page ${view[0] ?? 1} of ${numPages}`;
}

export type ReaderKeyAction =
  | "prev"
  | "next"
  | "first"
  | "last"
  | "toggle-fullscreen"
  | "exit-immersive";

/** The parts of a KeyboardEvent the mapping reads. */
export interface ReaderKeyEvent {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

export interface ReaderKeyContext {
  /** Focus is on the reader stage. */
  focused: boolean;
  /** The reader is in native fullscreen or the immersive overlay. */
  fullscreen: boolean;
  /**
   * The reader's own root. Ancestors from here up are ignored by the
   * widget-role check, so the immersive overlay's own role="dialog" does
   * not silence the reader.
   */
  boundary?: Element | null;
}

/** Widgets that own the arrow keys (and Space) while focused. */
const KEY_OWNING_ROLES = new Set([
  "menu",
  "menubar",
  "listbox",
  "tablist",
  "radiogroup",
  "dialog",
  "slider",
]);

function asElement(target: EventTarget | null): Element | null {
  const el = target as Element | null;
  return el && typeof el.closest === "function" ? el : null;
}

function isEditable(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const editable = el.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}

function insideKeyOwningWidget(el: Element, boundary: Element | null | undefined): boolean {
  for (let node: Element | null = el; node && node !== boundary; node = node.parentElement) {
    const role = node.getAttribute("role");
    if (role && KEY_OWNING_ROLES.has(role)) return true;
  }
  return false;
}

/** Elements Space activates; the reader must not steal that key from them. */
function isActivatable(el: Element): boolean {
  return el.closest("button, a[href], summary, [role='button'], [role='link']") !== null;
}

/**
 * Map a keydown to a reader action, or null to leave the key alone.
 *
 *   - Never with Meta/Ctrl/Alt held: Cmd+K, Cmd+J, Cmd+Z and browser
 *     shortcuts keep working.
 *   - Never from text fields, or from widgets that own the arrow keys
 *     (menus, listboxes, tabs, radio groups, dialogs, the page slider).
 *   - ←/→ work anywhere else on the page.
 *   - Home/End, PageUp/PageDown, Space/Shift+Space and F only while the
 *     reader stage has focus or the reader is fullscreen — single-key
 *     shortcuts must be scoped to the component (WCAG 2.1.4), and Home/End
 *     would otherwise hijack page scrolling.
 *   - Escape leaves the immersive overlay.
 */
export function readerKeyAction(e: ReaderKeyEvent, ctx: ReaderKeyContext): ReaderKeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || e.isComposing) return null;

  if (e.key === "Escape" || e.key === "Esc") return ctx.fullscreen ? "exit-immersive" : null;

  const el = asElement(e.target);
  if (el && (isEditable(el) || insideKeyOwningWidget(el, ctx.boundary))) return null;

  switch (e.key) {
    case "ArrowLeft":
      return "prev";
    case "ArrowRight":
      return "next";
  }

  if (!ctx.focused && !ctx.fullscreen) return null;

  switch (e.key) {
    case "Home":
      return "first";
    case "End":
      return "last";
    case "PageUp":
      return "prev";
    case "PageDown":
      return "next";
    case " ":
    case "Spacebar":
      if (el && isActivatable(el)) return null;
      return e.shiftKey ? "prev" : "next";
    case "f":
    case "F":
      return "toggle-fullscreen";
    default:
      return null;
  }
}
