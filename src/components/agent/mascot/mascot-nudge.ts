/**
 * Amr steps aside for the page's controls.
 *
 * He stands over the page in a corner, and his figure takes taps (a poke, a pat,
 * the panel). On a phone that corner often holds a control the visitor wants: the
 * retro timer's Start at 360 px, a card's Delete or vote button, an empty state's
 * "Create the sprint". A tap meant for it opened his chat instead (mobile audit,
 * 8 November 2026). So before he settles, he looks at what is under his figure
 * and, if a control is, he moves: a little up from his edge, or to the other side
 * of the screen, whichever clears it with the smallest move. He never hides.
 *
 * Pure apart from reading the boxes of the elements it's handed, so it's tested
 * with a mocked `elementsFromPoint` (test/agent/mascot-nudge.test.ts).
 */

/** A box in viewport (client) px. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where he stands relative to his corner: moved to the other side and/or lifted off his edge. */
export interface Nudge {
  /** On the other side of the screen (left for a right corner, and the reverse). */
  flip: boolean;
  /** Px away from his edge: up from the bottom, down from the header. */
  lift: number;
}

/** His own spot in his corner. */
export const HOME: Nudge = { flip: false, lift: 0 };

/**
 * The places he tries, smallest move first: a step up, the other side, then
 * bigger steps. A step is about half his figure on a phone, so one step clears a
 * row of 44 px controls.
 */
export const NUDGE_CANDIDATES: readonly Nudge[] = [
  HOME,
  { flip: false, lift: 48 },
  { flip: true, lift: 0 },
  { flip: true, lift: 48 },
  { flip: false, lift: 96 },
  { flip: true, lift: 96 },
  { flip: false, lift: 144 },
  { flip: true, lift: 144 },
];

/** What a tap there is meant for. Plain text, images and cards without a role don't count. */
export const CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "[role='slider']",
  "[role='combobox']",
].join(",");

/**
 * A control he covers this little of (and not its middle) is still easy to tap:
 * the end of a full-width field, the corner of a big card link.
 */
export const MIN_SHARE = 0.05;
/** With nowhere clear, he only moves for a gain bigger than this. */
const KEEP_MARGIN = 0.05;
/** Points sampled across his box: columns × rows, inset from its edges. */
const GRID = { cols: 3, rows: 5, inset: 3 } as const;

export function sameNudge(a: Nudge, b: Nudge): boolean {
  return a.flip === b.flip && a.lift === b.lift;
}

/**
 * His box at `n`, from where it is at HOME. `edge` is the screen edge his corner
 * is on; the other side is the mirror image across the viewport.
 */
export function placeRect(
  home: Rect,
  n: Nudge,
  edge: "top" | "bottom",
  viewportWidth: number
): Rect {
  return {
    left: n.flip ? viewportWidth - home.left - home.width : home.left,
    top: edge === "bottom" ? home.top - n.lift : home.top + n.lift,
    width: home.width,
    height: home.height,
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
}

function isEnabled(control: Element): boolean {
  if (control.matches(":disabled")) return false;
  return !control.closest("[aria-disabled='true'], [inert]");
}

/** A control under his box, with how much of it he covers. */
export interface Covered {
  control: Element;
  /** Share of the control's box under his (0-1). */
  share: number;
  /** He'd sit on its middle, where taps go. */
  centre: boolean;
}

export interface HitTesting {
  /** document.elementsFromPoint, or a stand-in. */
  elementsFromPoint: (x: number, y: number) => Element[];
  /** Amr's own elements (his figure, his panel): looked through, never counted. */
  ignore: (el: Element) => boolean;
}

/** The enabled controls a tap on `rect` would have reached if he weren't there. */
export function controlsUnder(rect: Rect, hit: HitTesting): Covered[] {
  const seen = new Map<Element, Covered | null>();
  const { cols, rows, inset } = GRID;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = rect.left + inset + ((rect.width - 2 * inset) * i) / (cols - 1);
      const y = rect.top + inset + ((rect.height - 2 * inset) * j) / (rows - 1);
      // The topmost element that isn't him is what the tap would reach.
      const top = hit.elementsFromPoint(x, y).find((el) => !hit.ignore(el));
      const control = top?.closest(CONTROL_SELECTOR);
      if (!control || seen.has(control)) continue;
      if (!isEnabled(control)) {
        seen.set(control, null);
        continue;
      }
      const r = control.getBoundingClientRect();
      const area = r.width * r.height;
      if (area <= 0) {
        seen.set(control, null);
        continue;
      }
      const box = { left: r.left, top: r.top, width: r.width, height: r.height };
      seen.set(control, {
        control,
        share: overlapArea(rect, box) / area,
        centre: contains(rect, box.left + box.width / 2, box.top + box.height / 2),
      });
    }
  }
  return Array.from(seen.values()).filter(
    (c): c is Covered => c !== null && (c.centre || c.share >= MIN_SHARE)
  );
}

/** How much he'd be in the way: the share of each control he covers, plus one per middle. */
export function coverageScore(covered: readonly Covered[]): number {
  return covered.reduce((sum, c) => sum + c.share + (c.centre ? 1 : 0), 0);
}

export interface NudgeInput extends HitTesting {
  /** His hit box at HOME, in viewport px. */
  home: Rect;
  /** Where he stands now (kept when it's still clear, so he doesn't hop about). */
  current: Nudge;
  /** The screen edge his corner is on. */
  edge: "top" | "bottom";
  /** The viewport, and the lowest top he may reach (the header's bottom). */
  viewport: { width: number; height: number; minTop: number };
  /** False once the visitor has put him on a side themselves: then he only steps up or down. */
  allowFlip?: boolean;
}

/**
 * Where he should stand: at home if nothing is under him there; else where he is
 * if that's still clear; else the first clear place, smallest move first. With
 * nowhere clear, the place least in the way, though he stays put unless the gain
 * is worth the move.
 */
export function chooseNudge(input: NudgeInput): Nudge {
  const { home, edge, viewport, allowFlip = true } = input;
  const fits = (n: Nudge) => {
    const r = placeRect(home, n, edge, viewport.width);
    return (
      r.left >= 0 &&
      r.left + r.width <= viewport.width &&
      r.top >= viewport.minTop &&
      r.top + r.height <= viewport.height
    );
  };
  const options = NUDGE_CANDIDATES.filter((n) => n === HOME || ((allowFlip || !n.flip) && fits(n)));
  const scores = new Map<Nudge, number>();
  const score = (n: Nudge) => {
    let s = scores.get(n);
    if (s === undefined) {
      s = coverageScore(controlsUnder(placeRect(home, n, edge, viewport.width), input));
      scores.set(n, s);
    }
    return s;
  };

  if (score(HOME) === 0) return HOME;
  const current = options.find((n) => sameNudge(n, input.current));
  if (current && score(current) === 0) return current;
  const clear = options.find((n) => score(n) === 0);
  if (clear) return clear;

  const best = options.reduce((a, b) => (score(b) < score(a) ? b : a));
  const stay = current ?? HOME;
  if (score(stay) <= score(best) + KEEP_MARGIN) return stay;
  if (score(HOME) <= score(best) + KEEP_MARGIN) return HOME;
  return best;
}
