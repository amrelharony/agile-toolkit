import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOME,
  chooseNudge,
  controlsUnder,
  placeRect,
  type NudgeInput,
  type Rect,
} from "@/components/agent/mascot/mascot-nudge";

/**
 * Amr steps aside for the page's controls (mobile audit, 8 November 2026): at
 * 360x640 his hit box [283,547,42x89] sat on the retro timer's Start, and a tap
 * there opened his chat instead of starting the timer. The page is mocked as
 * boxes; elementsFromPoint returns what's under a point, topmost first.
 */

const VIEWPORT = { width: 360, height: 640, minTop: 56 };
/** His hit box at home on a 360 px phone. */
const HOME_BOX: Rect = { left: 283, top: 547, width: 42, height: 89 };

let page: { el: Element; box: Rect }[] = [];
let amr: HTMLElement;

function place(el: Element, box: Rect): Element {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => ({}),
  } as DOMRect);
  document.body.appendChild(el);
  page.push({ el, box });
  return el;
}

function control(tag: string, box: Rect, attrs: Record<string, string> = {}): Element {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return place(el, box);
}

const elementsFromPoint = vi.fn((x: number, y: number) => {
  const under = page
    .filter(
      ({ box }) =>
        x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height
    )
    .map(({ el }) => el)
    .reverse(); // later boxes paint on top
  // Amr himself is on top of everything at home.
  const inAmr =
    x >= HOME_BOX.left &&
    x <= HOME_BOX.left + HOME_BOX.width &&
    y >= HOME_BOX.top &&
    y <= HOME_BOX.top + HOME_BOX.height;
  return [...(inAmr ? [amr] : []), ...under, document.body, document.documentElement];
});

function input(over: Partial<NudgeInput> = {}): NudgeInput {
  return {
    home: HOME_BOX,
    current: HOME,
    edge: "bottom",
    viewport: VIEWPORT,
    elementsFromPoint,
    ignore: (el) => el === amr || amr.contains(el),
    ...over,
  };
}

function setup() {
  page = [];
  document.body.innerHTML = "";
  amr = document.createElement("span");
  amr.setAttribute("data-mascot-hit", "");
  document.body.appendChild(amr);
}

afterEach(() => {
  vi.restoreAllMocks();
  elementsFromPoint.mockClear();
  document.body.innerHTML = "";
});

describe("placeRect", () => {
  it("lifts him off his edge and mirrors him to the other side", () => {
    expect(placeRect(HOME_BOX, { flip: false, lift: 48 }, "bottom", 360)).toEqual({
      ...HOME_BOX,
      top: 499,
    });
    expect(placeRect(HOME_BOX, { flip: true, lift: 0 }, "bottom", 360)).toEqual({
      ...HOME_BOX,
      left: 35,
    });
    // Parked under the header, a lift moves him down, away from it.
    expect(placeRect({ ...HOME_BOX, top: 70 }, { flip: false, lift: 48 }, "top", 360).top).toBe(
      118
    );
  });
});

describe("controlsUnder", () => {
  it("looks through Amr to the control a tap would have reached", () => {
    setup();
    const start = control("button", { left: 278, top: 547, width: 45, height: 44 });
    const found = controlsUnder(HOME_BOX, input());
    expect(found.map((c) => c.control)).toEqual([start]);
    expect(found[0].centre).toBe(true);
    expect(elementsFromPoint).toHaveBeenCalledTimes(15);
  });

  it("skips disabled controls, plain content and barely-grazed big controls", () => {
    setup();
    control("button", { left: 290, top: 560, width: 30, height: 30 }, { disabled: "" });
    control(
      "div",
      { left: 280, top: 600, width: 60, height: 30 },
      { role: "button", "aria-disabled": "true" }
    );
    control("p", { left: 0, top: 540, width: 360, height: 20 });
    // A full-width field whose last few px reach under his box: under 5% of it.
    control("input", { left: 16, top: 610, width: 271, height: 44 });
    expect(controlsUnder(HOME_BOX, input())).toEqual([]);
  });
});

describe("chooseNudge", () => {
  it("stays home when nothing is under him", () => {
    setup();
    control("p", { left: 0, top: 500, width: 360, height: 140 });
    expect(chooseNudge(input())).toEqual(HOME);
  });

  it("steps up off the retro timer's Start button", () => {
    setup();
    // At 360x640, Vote phase: Start sits under his figure, nothing above it.
    control("button", { left: 278, top: 547, width: 45, height: 44 });
    control("button", { left: 12, top: 600, width: 50, height: 40 }); // Reset, bottom left
    // One step up still covers Start, the other side covers Reset: the other
    // side, one step up, is the smallest clear move.
    expect(chooseNudge(input())).toEqual({ flip: true, lift: 48 });
    // Something there too: two steps up on his own side.
    control("button", { left: 30, top: 500, width: 60, height: 44 });
    expect(chooseNudge(input())).toEqual({ flip: false, lift: 96 });
  });

  it("takes the smallest clear move: one step up before the other side", () => {
    setup();
    control("a", { left: 300, top: 600, width: 30, height: 30 }, { href: "/x" });
    expect(chooseNudge(input())).toEqual({ flip: false, lift: 48 });
  });

  it("goes to the other side when stepping up can't clear the control", () => {
    setup();
    // A tall control down the right edge.
    control("button", { left: 300, top: 300, width: 40, height: 340 });
    expect(chooseNudge(input())).toEqual({ flip: true, lift: 0 });
  });

  it("only steps up or down once the visitor has put him on a side", () => {
    setup();
    control("button", { left: 300, top: 300, width: 40, height: 340 });
    const n = chooseNudge(input({ allowFlip: false }));
    expect(n.flip).toBe(false);
    expect(elementsFromPoint.mock.calls.every(([x]) => x > 200)).toBe(true);
  });

  it("keeps where he stepped to while it's clear, and goes home once home is clear", () => {
    setup();
    control("button", { left: 300, top: 600, width: 30, height: 30 });
    // He's on the other side already, which is clear: no hop to the first clear spot.
    expect(chooseNudge(input({ current: { flip: true, lift: 0 } }))).toEqual({
      flip: true,
      lift: 0,
    });
    // The control scrolled away: back home.
    setup();
    expect(chooseNudge(input({ current: { flip: true, lift: 0 } }))).toEqual(HOME);
  });

  it("never steps above the header, and stays put when every spot is alike", () => {
    setup();
    control("button", { left: 250, top: 450, width: 110, height: 190 });
    control("button", { left: 0, top: 450, width: 110, height: 190 });
    // Only home and the other side fit below a header ending at 500.
    expect(chooseNudge(input({ viewport: { ...VIEWPORT, minTop: 500 } }))).toEqual(HOME);
    const asked = elementsFromPoint.mock.calls.map(([, y]) => y);
    expect(Math.min(...asked)).toBeGreaterThanOrEqual(500);
  });

  it("with nowhere clear, moves off the control he'd block most", () => {
    setup();
    // Home sits on a small Delete button's middle; the other side on a corner of a bigger one.
    control("button", { left: 290, top: 560, width: 22, height: 22 });
    control("button", { left: 0, top: 540, width: 60, height: 100 });
    expect(chooseNudge(input({ viewport: { ...VIEWPORT, minTop: 500 } }))).toEqual({
      flip: true,
      lift: 0,
    });
  });
});
