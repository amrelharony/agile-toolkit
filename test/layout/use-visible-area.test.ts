import { readFileSync } from "node:fs";
import path from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  KEYBOARD_UP_PX,
  SAFE_AREA_PROBE_STYLE,
  VISIBLE_GAP,
  keyboardHeight,
  measureVisibleArea,
  readHeaderBottom,
  readSafeArea,
  readVisibleArea,
  useVisibleArea,
} from "@/lib/layout/use-visible-area";

/**
 * The visible area (chat revamp PR 8, audit phone-keyboard-covers-composer):
 * the keyboard's height from the two viewports, kb = clientHeight - vv.offsetTop
 * - vv.height, with a pinch-zoom guard, and the visible area's edges under the
 * measured header and above the keyboard or home indicator. Amr's phone sheet
 * is placed from these numbers, so the composer and Close stay in view.
 */

/** iPhone-sized layout viewport: 375 by 812, the header's bottom at 56 px. */
const PHONE = { clientHeight: 812, headerBottom: 56 };

describe("keyboardHeight", () => {
  it("is 0 with no visual viewport, or with nothing covering the layout viewport", () => {
    expect(keyboardHeight(812, null)).toBe(0);
    expect(keyboardHeight(812, undefined)).toBe(0);
    expect(keyboardHeight(812, { height: 812, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("is what the visual viewport's bottom edge leaves uncovered", () => {
    expect(keyboardHeight(812, { height: 512, offsetTop: 0, scale: 1 })).toBe(300);
  });

  it("is 0 while pinch-zoomed: at scale 2 the visual viewport follows the zoom", () => {
    expect(keyboardHeight(812, { height: 406, offsetTop: 0, scale: 2 })).toBe(0);
    expect(keyboardHeight(812, { height: 300, offsetTop: 100, scale: 2 })).toBe(0);
    // Zoomed out a little is zoomed too; within a hundredth of 1 isn't.
    expect(keyboardHeight(812, { height: 512, offsetTop: 0, scale: 0.98 })).toBe(0);
    expect(keyboardHeight(812, { height: 512, offsetTop: 0, scale: 1.005 })).toBe(300);
  });

  it("counts a stand-in with no scale as not zoomed", () => {
    expect(keyboardHeight(640, { height: 340, offsetTop: 0 })).toBe(300);
  });

  it("is never negative: a visual viewport taller than the layout one (a toolbar tucked away)", () => {
    expect(keyboardHeight(812, { height: 860, offsetTop: 0, scale: 1 })).toBe(0);
  });
});

describe("readVisibleArea", () => {
  it("with no keyboard: from under the header to above the screen's bottom, a gap each side", () => {
    const area = readVisibleArea({ ...PHONE, viewport: { height: 812, offsetTop: 0, scale: 1 } });
    expect(area).toEqual({
      kb: 0,
      keyboardUp: false,
      viewTop: 0,
      top: 56 + VISIBLE_GAP,
      bottom: VISIBLE_GAP,
      restBottom: VISIBLE_GAP,
    });
  });

  it("keeps clear of the home indicator (375x812, inset 34)", () => {
    const area = readVisibleArea({
      ...PHONE,
      viewport: { height: 812, offsetTop: 0, scale: 1 },
      safeBottom: 34,
    });
    expect(area.bottom).toBe(42);
    expect(area.restBottom).toBe(42);
  });

  it("with a keyboard: the bottom edge sits above it, and restBottom stays where it was", () => {
    const area = readVisibleArea({
      ...PHONE,
      viewport: { height: 512, offsetTop: 0, scale: 1 },
      safeBottom: 34,
    });
    expect(area.kb).toBe(300);
    expect(area.keyboardUp).toBe(true);
    // The keyboard covers the home indicator: its inset no longer counts.
    expect(area.bottom).toBe(300 + VISIBLE_GAP);
    expect(area.restBottom).toBe(34 + VISIBLE_GAP);
    expect(area.top).toBe(56 + VISIBLE_GAP);
  });

  it("offsetTop 180: iOS has panned the page down to the field, which is not keyboard", () => {
    // The keyboard takes 300 px; the visual viewport (332 px) starts 180 px down.
    const area = readVisibleArea({ ...PHONE, viewport: { height: 332, offsetTop: 180, scale: 1 } });
    expect(area.kb).toBe(300);
    expect(area.viewTop).toBe(180);
    // The header has gone up out of sight: the area starts where the view does.
    expect(area.top).toBe(180 + VISIBLE_GAP);
    expect(area.bottom).toBe(300 + VISIBLE_GAP);
    // What's between them is exactly what can be seen, less the gaps.
    expect(812 - area.top - area.bottom).toBe(332 - 2 * VISIBLE_GAP);
  });

  it("a small pan that leaves the header in view still starts under the header", () => {
    const area = readVisibleArea({ ...PHONE, viewport: { height: 492, offsetTop: 20, scale: 1 } });
    expect(area.kb).toBe(300);
    expect(area.top).toBe(56 + VISIBLE_GAP);
  });

  it("a Firefox-style shrink (the layout viewport shrinks with it) reads as no keyboard", () => {
    // Fixed boxes already stop above the keyboard: nothing needs moving.
    const area = readVisibleArea({
      clientHeight: 512,
      headerBottom: 56,
      viewport: { height: 512, offsetTop: 0, scale: 1 },
      safeBottom: 34,
    });
    expect(area.kb).toBe(0);
    expect(area.keyboardUp).toBe(false);
    expect(area.bottom).toBe(34 + VISIBLE_GAP);
  });

  it("pinch-zoomed: no keyboard, and the zoom's pan is not followed", () => {
    const area = readVisibleArea({
      ...PHONE,
      viewport: { height: 300, offsetTop: 250, scale: 2 },
      safeBottom: 34,
    });
    expect(area.kb).toBe(0);
    expect(area.keyboardUp).toBe(false);
    expect(area.viewTop).toBe(0);
    expect(area.top).toBe(56 + VISIBLE_GAP);
    expect(area.bottom).toBe(34 + VISIBLE_GAP);
  });

  it(`counts a keyboard as up only past ${KEYBOARD_UP_PX} px`, () => {
    expect(KEYBOARD_UP_PX).toBe(100);
    const at = (kb: number) =>
      readVisibleArea({ ...PHONE, viewport: { height: 812 - kb, offsetTop: 0, scale: 1 } });
    expect(at(0).keyboardUp).toBe(false);
    expect(at(60).keyboardUp).toBe(false);
    expect(at(100).keyboardUp).toBe(false);
    expect(at(100.5).keyboardUp).toBe(true);
    expect(at(101).keyboardUp).toBe(true);
    expect(at(260).keyboardUp).toBe(true);
    // A toolbar's difference still moves the edge above it.
    expect(at(60).kb).toBe(60);
    expect(at(60).bottom).toBe(60 + VISIBLE_GAP);
  });

  it("never puts the bottom edge on the home indicator for a sliver of difference", () => {
    const area = readVisibleArea({
      ...PHONE,
      viewport: { height: 811.5, offsetTop: 0, scale: 1 },
      safeBottom: 34,
    });
    expect(area.kb).toBe(0.5);
    expect(area.bottom).toBe(34 + VISIBLE_GAP);
  });

  it("keeps the view's top below a notch, and works with no visual viewport at all", () => {
    const area = readVisibleArea({
      clientHeight: 812,
      headerBottom: 0,
      viewport: null,
      safeTop: 47,
    });
    expect(area).toMatchObject({ kb: 0, keyboardUp: false, viewTop: 47, top: 47 + VISIBLE_GAP });
  });
});

describe("reading the page", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "visualViewport");
    Reflect.deleteProperty(document.documentElement, "clientHeight");
    document.body.innerHTML = "";
  });

  function header(bottom: number): HTMLElement {
    const el = document.createElement("header");
    el.setAttribute("data-chrome", "header");
    el.getBoundingClientRect = () => ({ bottom }) as DOMRect;
    document.body.append(el);
    return el;
  }

  function probe(px: { top: number; right: number; bottom: number; left: number }): HTMLElement {
    const el = document.createElement("span");
    el.style.paddingTop = `${px.top}px`;
    el.style.paddingRight = `${px.right}px`;
    el.style.paddingBottom = `${px.bottom}px`;
    el.style.paddingLeft = `${px.left}px`;
    document.body.append(el);
    return el;
  }

  it("styles the probe from every safe area, and reads them back as px", () => {
    expect(SAFE_AREA_PROBE_STYLE).toEqual({
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingRight: "env(safe-area-inset-right, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      paddingLeft: "env(safe-area-inset-left, 0px)",
    });
    expect(readSafeArea(probe({ top: 47, right: 0, bottom: 34, left: 0 }))).toEqual({
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    });
    expect(readSafeArea(null)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("measures the header's bottom: 0 without one, or once it has gone up out of sight", () => {
    expect(readHeaderBottom()).toBe(0);
    const el = header(96);
    expect(readHeaderBottom()).toBe(96);
    el.getBoundingClientRect = () => ({ bottom: -40 }) as DOMRect;
    expect(readHeaderBottom()).toBe(0);
  });

  it("puts the numbers together: viewports, header and safe areas", () => {
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      get: () => 812,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { height: 332, offsetTop: 180, scale: 1 },
    });
    header(56);
    const area = measureVisibleArea(probe({ top: 0, right: 0, bottom: 34, left: 0 }));
    expect(area).toEqual({
      kb: 300,
      keyboardUp: true,
      viewTop: 180,
      top: 188,
      bottom: 308,
      restBottom: 42,
    });
  });

  it("falls back to innerHeight where the layout has no height to read (jsdom), and to no probe", () => {
    expect(document.documentElement.clientHeight).toBe(0);
    const area = measureVisibleArea();
    expect(area).toEqual({
      kb: 0,
      keyboardUp: false,
      viewTop: 0,
      top: VISIBLE_GAP,
      bottom: VISIBLE_GAP,
      restBottom: VISIBLE_GAP,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { height: window.innerHeight - 250, offsetTop: 0, scale: 1 },
    });
    expect(measureVisibleArea().kb).toBe(250);
  });
});

describe("useVisibleArea, moved out of the command palette", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("is null where there is no visual viewport", () => {
    const { result } = renderHook(() => useVisibleArea(true));
    expect(result.current).toBeNull();
  });

  it("follows the visual viewport while active", () => {
    class FakeVisualViewport extends EventTarget {
      height = 640;
      offsetTop = 0;
    }
    const vv = new FakeVisualViewport();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    const { result } = renderHook(() => useVisibleArea(true));
    expect(result.current).toEqual({ height: 640, offsetTop: 0 });
    act(() => {
      vv.height = 340;
      vv.offsetTop = 20;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ height: 340, offsetTop: 20 });
  });

  it("is the one command.tsx uses: it imports it back and declares none of its own", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../src/components/ui/command.tsx"),
      "utf8"
    );
    expect(src).toMatch(/import \{ useVisibleArea \} from "@\/lib\/layout\/use-visible-area";/);
    expect(src).not.toMatch(/function useVisibleArea\b/);
    expect(src).not.toMatch(/interface VisibleArea\b/);
  });
});
